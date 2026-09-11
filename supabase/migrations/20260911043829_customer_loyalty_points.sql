-- Use the immutable sale snapshot as the points ledger. No duplicate sale
-- table, mutable browser balance, scheduled full-table deletion or new backup
-- format is needed. Expired cycles are excluded at read AND checkout time.
create or replace function private.preserve_customer_loyalty_joined_at()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_joined timestamptz;
begin
  if current_setting('pepos.maintenance_reset',true)='on' and new.data ? 'loyaltyJoinedAt' then
    v_joined:=(new.data->>'loyaltyJoinedAt')::timestamptz;
  elsif tg_op='UPDATE' then
    v_joined:=coalesce((old.data->>'loyaltyJoinedAt')::timestamptz,old.created_at);
  else
    v_joined:=new.created_at;
  end if;
  new.data:=jsonb_set(coalesce(new.data,'{}'::jsonb),'{loyaltyJoinedAt}',to_jsonb(v_joined),true);
  return new;
end $$;
revoke all on function private.preserve_customer_loyalty_joined_at() from public,anon,authenticated;
create trigger zz_preserve_customer_loyalty_joined_at before insert or update on public.contacts
for each row execute function private.preserve_customer_loyalty_joined_at();
-- Original registration date, not feature activation date. Existing bills
-- are intentionally not retroactively awarded points.
update public.contacts set data=jsonb_set(data,'{loyaltyJoinedAt}',to_jsonb(created_at),true)
where not (data ? 'loyaltyJoinedAt');

create index sales_loyalty_cycle_idx on public.sales
  ((data->'loyalty'->>'customerId'),(data->'loyalty'->>'periodStart'))
  where status='done' and data ? 'loyalty';

create or replace function private.loyalty_cycle(p_joined timestamptz,p_at timestamptz)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  v_join date:=(p_joined at time zone 'Asia/Bangkok')::date;
  v_today date:=(p_at at time zone 'Asia/Bangkok')::date;
  v_years integer;
  v_start date;
  v_end date;
begin
  v_years:=greatest(0,extract(year from v_today)::int-extract(year from v_join)::int);
  v_start:=(v_join+make_interval(years=>v_years))::date;
  if v_start>v_today and v_years>0 then v_years:=v_years-1; end if;
  v_start:=(v_join+make_interval(years=>v_years))::date;
  -- Always anchor to the original date (including February 29), not the
  -- previously shortened anniversary in a non-leap year.
  v_end:=(v_join+make_interval(years=>v_years+1))::date;
  return jsonb_build_object('joinedOn',v_join,'periodStart',v_start,'expiresOn',v_end,
    'expiresAt',v_end::timestamp at time zone 'Asia/Bangkok');
end $$;
revoke all on function private.loyalty_cycle(timestamptz,timestamptz) from public,anon,authenticated;

create or replace function private.customer_loyalty_snapshot(p_customer_id bigint,p_at timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_joined timestamptz; v_cycle jsonb; v_earned numeric; v_used numeric;
begin
  select coalesce((data->>'loyaltyJoinedAt')::timestamptz,created_at) into v_joined
  from public.contacts where id=p_customer_id and type in ('customer','both');
  if not found then raise exception 'LOYALTY_CUSTOMER_NOT_FOUND'; end if;
  v_cycle:=private.loyalty_cycle(v_joined,p_at);
  select coalesce(sum((data->'loyalty'->>'earned')::numeric),0),
         coalesce(sum((data->'loyalty'->>'redeemed')::numeric),0)
    into v_earned,v_used from public.sales
    where status='done' and data ? 'loyalty'
      and data->'loyalty'->>'customerId'=p_customer_id::text
      and data->'loyalty'->>'periodStart'=v_cycle->>'periodStart';
  return v_cycle||jsonb_build_object('customerId',p_customer_id::text,'earned',v_earned,'used',v_used,
    'balance',greatest(0,v_earned-v_used),'adjustmentDue',greatest(0,v_used-v_earned));
end $$;
revoke all on function private.customer_loyalty_snapshot(bigint,timestamptz) from public,anon,authenticated;

-- Only this private, authorized reader bypasses sale warehouse RLS. Cashiers
-- need the SAME global points balance to prevent cross-warehouse overspending;
-- the response does not disclose another warehouse's bills, items or revenue.
create or replace function private.read_customer_loyalty(p_customer_ids text[],p_warehouse_id bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not (
    private.is_current_owner()
    or public.can_current_user_page('contacts',p_warehouse_id,'view')
    or exists(select 1 from public.profile_warehouse_access a where a.user_id=auth.uid() and a.warehouse_id=p_warehouse_id and a.can_sell)
  ) then raise exception 'LOYALTY_ACCESS_DENIED' using errcode='42501'; end if;
  if coalesce(cardinality(p_customer_ids),0) not between 1 and 100 then
    raise exception 'INVALID_LOYALTY_CUSTOMERS' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(private.customer_loyalty_snapshot(c.id,statement_timestamp()) order by c.id),'[]'::jsonb)
    into v_result from public.contacts c where c.id::text=any(p_customer_ids) and c.type in ('customer','both');
  return v_result;
end $$;
revoke all on function private.read_customer_loyalty(text[],bigint) from public,anon;
grant execute on function private.read_customer_loyalty(text[],bigint) to authenticated;
create or replace function public.get_customer_loyalty(p_customer_ids text[],p_warehouse_id bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.read_customer_loyalty(p_customer_ids,p_warehouse_id);
$$;
revoke all on function public.get_customer_loyalty(text[],bigint) from public,anon;
grant execute on function public.get_customer_loyalty(text[],bigint) to authenticated;

create or replace function private.finalize_sale_loyalty(p_sale jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v_id text; v_customer_id bigint; v_redeem numeric; v_earned numeric; v_state jsonb; v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'LOYALTY_ACCESS_DENIED' using errcode='42501'; end if;
  if coalesce(p_sale->>'loyaltyRedeemed','0') !~ '^[0-9]{1,10}$' then raise exception 'LOYALTY_INVALID_POINTS'; end if;
  v_redeem:=coalesce((p_sale->>'loyaltyRedeemed')::numeric,0);
  p_sale:=p_sale-'loyalty'; -- Never trust a browser-supplied ledger snapshot.
  v_id:=coalesce(nullif(p_sale->>'customerId',''),p_sale->'member'->>'id');
  if v_id is null then
    if v_redeem>0 then raise exception 'LOYALTY_CUSTOMER_REQUIRED'; end if;
    return p_sale-'loyaltyRedeemed';
  end if;
  if v_id !~ '^[0-9]{1,18}$' then raise exception 'LOYALTY_CUSTOMER_NOT_FOUND'; end if;
  v_customer_id:=v_id::bigint;
  -- Checkout already holds the store gate and ordered product locks. Lock the
  -- customer last; the void hook follows the same ordering. Each subsequent
  -- statement gets a fresh READ COMMITTED snapshot after a waiting lock.
  perform 1 from public.contacts where id=v_customer_id and type in ('customer','both') for update;
  if not found then raise exception 'LOYALTY_CUSTOMER_NOT_FOUND'; end if;
  v_now:=clock_timestamp();
  v_state:=private.customer_loyalty_snapshot(v_customer_id,v_now);
  if v_redeem>0 then
    if nullif(p_sale->>'loyaltyPeriodStart','') is distinct from v_state->>'periodStart' then raise exception 'LOYALTY_CYCLE_CHANGED'; end if;
    if (p_sale->>'total')::numeric+v_redeem-(p_sale->>'fee')::numeric<1000 then raise exception 'LOYALTY_MINIMUM_1000'; end if;
    if v_redeem>(p_sale->>'discount')::numeric then raise exception 'LOYALTY_DISCOUNT_MISMATCH'; end if;
    if v_redeem>(v_state->>'balance')::numeric then raise exception 'LOYALTY_INSUFFICIENT_POINTS'; end if;
  end if;
  v_earned:=floor((p_sale->>'total')::numeric/50);
  return p_sale||jsonb_build_object('customerId',v_customer_id::text,'loyaltyRedeemed',v_redeem,
    'loyalty',jsonb_build_object('customerId',v_customer_id::text,'earned',v_earned,'redeemed',v_redeem,
      'periodStart',v_state->>'periodStart','expiresOn',v_state->>'expiresOn','recordedAt',v_now,
      'balanceAfter',greatest(0,(v_state->>'balance')::numeric-(v_state->>'adjustmentDue')::numeric-v_redeem+v_earned)));
end $$;
revoke all on function private.finalize_sale_loyalty(jsonb) from public,anon,authenticated;

-- Patch only the validated, non-idempotent-return path immediately before the
-- sale insert. Points, sale, stock and cash shift commit or roll back together.
do $migration$
declare v_definition text; v_anchor text:='  v_member := case';
begin
  select pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure) into v_definition;
  if position('private.finalize_sale_loyalty(' in v_definition)>0 then raise exception 'loyalty hook already installed'; end if;
  if position(v_anchor in v_definition)=0 then raise exception 'checkout loyalty hook anchor missing'; end if;
  execute replace(v_definition,v_anchor,E'  v_sale_data := private.finalize_sale_loyalty(v_sale_data);\n\n'||v_anchor);
end $migration$;

create or replace function private.lock_customer_loyalty_void()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status='done' and new.status='void' and old.data ? 'loyalty' then
    perform 1 from public.contacts where id::text=old.data->'loyalty'->>'customerId' for update;
  end if;
  return new;
end $$;
revoke all on function private.lock_customer_loyalty_void() from public,anon,authenticated;
create trigger zz_lock_customer_loyalty_void before update of status on public.sales
for each row execute function private.lock_customer_loyalty_void();
-- Voided sales no longer contribute earned OR redeemed points to their cycle.
-- Prior-year redemptions cannot resurrect expired points. A void can leave an
-- earned-points deficit; future earnings offset it before points are usable.
