-- Customer identity is immutable: never join bills by a customer's display name.
create index if not exists sales_customer_date_idx on public.sales
  ((coalesce(nullif(data->>'customerId',''),data->'member'->>'id')),sale_date desc,id desc)
  where status in ('done','void');

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
  v_year integer := extract(year from v_today)::integer;
  v_months integer := extract(month from v_today)::integer;
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

  -- Aggregate in the database; do not download lifetime bill payloads.
  -- Invoker execution preserves both contacts and sales warehouse RLS.
  select coalesce(jsonb_agg(jsonb_build_object(
    'customerId',c.id::text,
    'lifetimeTotal',coalesce(a.lifetime_total,0),
    'currentYearTotal',coalesce(a.year_total,0),
    'periodTotal',coalesce(a.period_total,0),
    'periodBills',coalesce(a.period_bills,0)
  ) order by c.id),'[]'::jsonb) into v_summaries
  from public.contacts c
  left join lateral (
    select sum(s.total) filter(where s.status='done') lifetime_total,
      sum(s.total) filter(where s.status='done' and s.sale_date>=make_date(v_year,1,1) and s.sale_date<=v_today) year_total,
      sum(s.total) filter(where s.status='done' and s.sale_date>=v_from and s.sale_date<v_until) period_total,
      count(*) filter(where s.status='done' and s.sale_date>=v_from and s.sale_date<v_until) period_bills
    from public.sales s
    where coalesce(nullif(s.data->>'customerId',''),s.data->'member'->>'id')=c.id::text
      and s.status in ('done','void')
  ) a on true
  where c.id::text=any(p_customer_ids) and c.type in ('customer','both');

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
  return jsonb_build_object('asOf',v_today,'currentYear',v_year,'elapsedMonths',v_months,
    'summaries',v_summaries,'bills',v_bills,'totalBills',v_count,'page',v_page);
end;
$$;
revoke all on function public.get_customer_purchase_history(text[],integer,integer,integer,boolean,bigint) from public,anon;
grant execute on function public.get_customer_purchase_history(text[],integer,integer,integer,boolean,bigint) to authenticated;
