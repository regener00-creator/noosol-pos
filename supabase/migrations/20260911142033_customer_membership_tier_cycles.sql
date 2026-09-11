-- Customer tiers follow each customer's membership anniversary instead of
-- resetting on January 1. Calendar month/year filters still control the bill
-- history below; only tier totals and averages use the active member cycle.
create or replace function public.get_customer_purchase_history(
  p_customer_ids text[],
  p_year integer,
  p_month integer default null,
  p_page integer default 1,
  p_include_bills boolean default false,
  p_warehouse_id bigint default null
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  v_from date;
  v_until date;
  v_count bigint := 0;
  v_page integer;
  v_summaries jsonb;
  v_bills jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.can_current_user_page('contacts',p_warehouse_id,'view') then
    raise exception 'CUSTOMER_HISTORY_PERMISSION_DENIED' using errcode='42501';
  end if;
  if coalesce(cardinality(p_customer_ids),0) not between 1 and 100
     or p_year is null or p_year not between 1900 and 9998
     or (p_month is not null and p_month not between 1 and 12)
     or (p_include_bills and cardinality(p_customer_ids)<>1) then
    raise exception 'INVALID_CUSTOMER_HISTORY_FILTER' using errcode='22023';
  end if;
  v_from := make_date(p_year,coalesce(p_month,1),1);
  v_until := (v_from + case when p_month is null then interval '1 year' else interval '1 month' end)::date;

  -- Calculate the current anniversary window independently for every customer;
  -- a batch may contain customers who joined on different dates.
  with requested as (
    select c.id,
      (coalesce(nullif(c.data->>'loyaltyJoinedAt','')::timestamptz,c.created_at)
        at time zone 'Asia/Bangkok')::date as joined_on
    from public.contacts c
    where c.id::text=any(p_customer_ids) and c.type in ('customer','both')
  ), raw_cycles as (
    select r.*,
      greatest(0,extract(year from v_today)::integer-extract(year from r.joined_on)::integer) as raw_years
    from requested r
  ), cycles as (
    select r.*,
      case
        when (r.joined_on+make_interval(years=>r.raw_years))::date>v_today and r.raw_years>0
          then r.raw_years-1
        else r.raw_years
      end as cycle_years
    from raw_cycles r
  ), cycle_bounds as (
    select c.id,
      (c.joined_on+make_interval(years=>c.cycle_years))::date as membership_start,
      (c.joined_on+make_interval(years=>c.cycle_years+1))::date as membership_end
    from cycles c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'customerId',c.id::text,
    'lifetimeTotal',coalesce(a.lifetime_total,0),
    'membershipCycleTotal',coalesce(a.membership_cycle_total,0),
    'membershipElapsedMonths',least(12,greatest(1,
      extract(year from age(v_today,c.membership_start))::integer*12
      +extract(month from age(v_today,c.membership_start))::integer+1)),
    'membershipPeriodStart',c.membership_start,
    'membershipPeriodEnd',c.membership_end,
    'periodTotal',coalesce(a.period_total,0),
    'periodBills',coalesce(a.period_bills,0)
  ) order by c.id),'[]'::jsonb) into v_summaries
  from cycle_bounds c
  left join lateral (
    select sum(s.total) filter(where s.status='done') lifetime_total,
      sum(s.total) filter(where s.status='done' and s.sale_date>=c.membership_start
        and s.sale_date<c.membership_end and s.sale_date<=v_today) membership_cycle_total,
      sum(s.total) filter(where s.status='done' and s.sale_date>=v_from and s.sale_date<v_until) period_total,
      count(*) filter(where s.status='done' and s.sale_date>=v_from and s.sale_date<v_until) period_bills
    from public.sales s
    where coalesce(nullif(s.data->>'customerId',''),s.data->'member'->>'id')=c.id::text
      and s.status in ('done','void')
  ) a on true;

  if p_include_bills then
    select count(*) into v_count from public.sales s
    where coalesce(nullif(s.data->>'customerId',''),s.data->'member'->>'id')=p_customer_ids[1]
      and s.status in ('done','void') and s.sale_date>=v_from and s.sale_date<v_until
      and exists(select 1 from public.contacts c where c.id::text=p_customer_ids[1] and c.type in ('customer','both'));
  end if;
  v_page := least(greatest(coalesce(p_page,1),1),greatest(1,ceil(v_count::numeric/10)::integer));
  if p_include_bills then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',b.id,'ref',b.ref,'date',b.sale_date,'status',b.status,'total',b.total,
      'items',case when jsonb_typeof(b.data->'items')='array' then b.data->'items' else '[]'::jsonb end
    ) order by b.sale_date desc,b.id desc),'[]'::jsonb) into v_bills
    from (
      select s.id,s.ref,s.sale_date,s.status,s.total,s.data from public.sales s
      where coalesce(nullif(s.data->>'customerId',''),s.data->'member'->>'id')=p_customer_ids[1]
        and s.status in ('done','void') and s.sale_date>=v_from and s.sale_date<v_until
        and exists(select 1 from public.contacts c where c.id::text=p_customer_ids[1] and c.type in ('customer','both'))
      order by s.sale_date desc,s.id desc limit 10 offset (v_page-1)*10
    ) b;
  end if;
  return jsonb_build_object('asOf',v_today,'summaries',v_summaries,
    'bills',v_bills,'totalBills',v_count,'page',v_page);
end;
$$;
revoke all on function public.get_customer_purchase_history(text[],integer,integer,integer,boolean,bigint) from public,anon;
grant execute on function public.get_customer_purchase_history(text[],integer,integer,integer,boolean,bigint) to authenticated;

-- POS receives only the selected customer's active-cycle aggregate, not bill
-- rows or lifetime revenue. SECURITY INVOKER preserves sales/contact RLS.
create or replace function public.get_pos_customer_tier_progress(
  p_customer_id text,
  p_warehouse_id bigint
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  v_joined timestamptz;
  v_joined_on date;
  v_years integer;
  v_period_start date;
  v_period_end date;
  v_elapsed_months integer;
  v_total numeric := 0;
begin
  if auth.uid() is null or not (
    (select private.is_current_owner())
    or exists (
      select 1
      from public.profile_warehouse_access access
      where access.user_id = (select auth.uid())
        and access.warehouse_id = p_warehouse_id
        and access.can_sell
    )
  ) then
    raise exception 'CUSTOMER_TIER_PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_customer_id is null or p_customer_id !~ '^[0-9]{1,18}$' or p_warehouse_id is null then
    raise exception 'INVALID_CUSTOMER_TIER_FILTER' using errcode='22023';
  end if;

  select coalesce(nullif(customer.data->>'loyaltyJoinedAt','')::timestamptz,customer.created_at)
    into v_joined
  from public.contacts customer
  where customer.id::text=p_customer_id and customer.type in ('customer','both');
  if not found then raise exception 'CUSTOMER_TIER_NOT_FOUND' using errcode='22023'; end if;

  v_joined_on := (v_joined at time zone 'Asia/Bangkok')::date;
  v_years := greatest(0,extract(year from v_today)::integer-extract(year from v_joined_on)::integer);
  if (v_joined_on+make_interval(years=>v_years))::date>v_today and v_years>0 then
    v_years := v_years-1;
  end if;
  v_period_start := (v_joined_on+make_interval(years=>v_years))::date;
  v_period_end := (v_joined_on+make_interval(years=>v_years+1))::date;
  v_elapsed_months := least(12,greatest(1,
    extract(year from age(v_today,v_period_start))::integer*12
    +extract(month from age(v_today,v_period_start))::integer+1));

  select coalesce(sum(sale.total),0)
    into v_total
  from public.sales sale
  where sale.status='done'
    and sale.sale_date>=v_period_start
    and sale.sale_date<v_period_end
    and sale.sale_date<=v_today
    and coalesce(nullif(sale.data->>'customerId',''),sale.data->'member'->>'id')=p_customer_id;

  return jsonb_build_object(
    'asOf',v_today,
    'summaries',jsonb_build_array(jsonb_build_object(
      'customerId',p_customer_id,
      'membershipCycleTotal',v_total,
      'membershipElapsedMonths',v_elapsed_months,
      'membershipPeriodStart',v_period_start,
      'membershipPeriodEnd',v_period_end
    ))
  );
end;
$$;
revoke all on function public.get_pos_customer_tier_progress(text,bigint) from public,anon;
grant execute on function public.get_pos_customer_tier_progress(text,bigint) to authenticated;
