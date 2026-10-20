-- Offline receipts retain the sale time while preserving all existing checkout
-- permissions, price validation, idempotency and inventory posting guards.
do $migration$
declare
  definition text;
  old_fragment text := $old$  v_now := clock_timestamp();
  v_sale_date := (v_now at time zone 'Asia/Bangkok')::date;$old$;
  new_fragment text := $new$  v_now := clock_timestamp();
  if v_sale_data ? 'offlineOccurredAt' then
    if v_sale_data ? 'offlineCashShiftId' and not exists(
      select 1 from public.cash_shifts s where s.id::text=v_sale_data->>'offlineCashShiftId'
        and s.opened_by=(select auth.uid()) and s.warehouse_id=p_warehouse_id and s.status='open'
    ) then
      raise exception 'offline cash shift was closed or changed; review the pending receipt';
    end if;
    if jsonb_typeof(v_sale_data->'offlineOccurredAt') <> 'string'
       or (v_sale_data->>'offlineOccurredAt') !~ '^\d{4}-\d{2}-\d{2}T' then
      raise exception 'invalid offline sale time';
    end if;
    if (v_sale_data->>'offlineOccurredAt')::timestamptz > v_now + interval '5 minutes'
       or (v_sale_data->>'offlineOccurredAt')::timestamptz < v_now - interval '30 days' then
      raise exception 'offline sale time is outside the accepted range';
    end if;
    v_sale_data := jsonb_set(v_sale_data, '{offlineReceivedAt}', to_jsonb(v_now), true);
    v_now := (v_sale_data->>'offlineOccurredAt')::timestamptz;
    v_sale_data := jsonb_set(v_sale_data, '{offlineRef}', to_jsonb('OFF-' || v_request_id::text), true);
  end if;
  v_sale_date := (v_now at time zone 'Asia/Bangkok')::date;$new$;
begin
  select pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure) into definition;
  if strpos(definition,old_fragment)=0 then raise exception 'checkout timestamp block not found'; end if;
  execute replace(definition,old_fragment,new_fragment);
end;
$migration$;
revoke execute on function public.complete_sale(uuid,text,bigint,jsonb,jsonb,text) from public,anon;
grant execute on function public.complete_sale(uuid,text,bigint,jsonb,jsonb,text) to authenticated;
