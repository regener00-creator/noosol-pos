-- POS cashiers only need the selected customer's current-year tier progress.
-- Keep bill rows, item payloads, lifetime totals, and other customers out of
-- this narrowly scoped endpoint. SECURITY INVOKER preserves sales RLS.
create or replace function public.get_pos_customer_tier_progress(
  p_customer_id text,
  p_warehouse_id bigint
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  v_year integer := extract(year from v_today)::integer;
  v_months integer := extract(month from v_today)::integer;
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
  if not exists (
    select 1 from public.contacts customer
    where customer.id::text=p_customer_id and customer.type in ('customer','both')
  ) then
    raise exception 'CUSTOMER_TIER_NOT_FOUND' using errcode='22023';
  end if;

  select coalesce(sum(sale.total),0)
    into v_total
  from public.sales sale
  where sale.status='done'
    and sale.sale_date>=make_date(v_year,1,1)
    and sale.sale_date<=v_today
    and coalesce(nullif(sale.data->>'customerId',''),sale.data->'member'->>'id')=p_customer_id;

  return jsonb_build_object(
    'asOf',v_today,
    'currentYear',v_year,
    'elapsedMonths',v_months,
    'summaries',jsonb_build_array(jsonb_build_object(
      'customerId',p_customer_id,
      'currentYearTotal',v_total
    )),
    'bills','[]'::jsonb,
    'totalBills',0,
    'page',1
  );
end;
$$;
revoke all on function public.get_pos_customer_tier_progress(text,bigint) from public,anon;
grant execute on function public.get_pos_customer_tier_progress(text,bigint) to authenticated;
