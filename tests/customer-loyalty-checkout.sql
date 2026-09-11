-- Full live checkout integration inside a rolled-back transaction.
-- Custom item avoids any inventory changes. No test bills/shift persist.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where owner=true limit 1),true);
do $$
#variable_conflict use_variable
declare customer_id bigint; warehouse_id bigint; base_balance numeric; cycle text;
  first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); failed_id uuid:=gen_random_uuid();
  sale jsonb; items jsonb; result jsonb; retried jsonb;
begin
  select id into customer_id from public.contacts where type in ('customer','both') order by id limit 1;
  select id into warehouse_id from public.warehouses order by id limit 1;
  if customer_id is null or warehouse_id is null then raise exception 'Need existing customer and warehouse for rollback-only test'; end if;
  if not exists(select 1 from public.cash_shifts s where s.warehouse_id=warehouse_id and s.opened_by=auth.uid() and s.status='open') then
    perform public.open_cash_shift(warehouse_id,0);
  end if;
  select (value->>'balance')::numeric,value->>'periodStart' into base_balance,cycle
    from jsonb_array_elements(public.get_customer_loyalty(array[customer_id::text],warehouse_id));
  sale:=jsonb_build_object('customerId',customer_id::text,'total',5000,'discount',0,'fee',0,'vat',0,'costTotal',5000,'cashReceived',5000,'cashChange',0,'payMethod','เงินสด');
  items:='[{"lineKey":"1","custom":true,"name":"Rollback-only loyalty integration test","qty":1,"unit":"รายการ","price":5000,"lineTotal":5000,"lineTotalGross":5000}]';
  result:=public.complete_sale(first_id,'TESTLOY',warehouse_id,sale,items,null);
  assert (result->'sale'->'loyalty'->>'earned')::int=100,'Complete sale earns server points';
  retried:=public.complete_sale(first_id,'TESTLOY',warehouse_id,sale,items,null);
  assert (retried->>'alreadyCompleted')::boolean and retried->'sale'->'loyalty'=result->'sale'->'loyalty'
    and retried->'sale'->>'id'=result->'sale'->>'id' and retried->'sale'->>'total'=result->'sale'->>'total','Idempotent retry returns unchanged points and sale';
  assert (select (value->>'balance')::numeric from jsonb_array_elements(public.get_customer_loyalty(array[customer_id::text],warehouse_id)))=base_balance+100,'Retry earns only once';
  sale:=sale||jsonb_build_object('total',900,'discount',100,'cashReceived',900,'costTotal',1000,'loyaltyRedeemed',100,'loyaltyPeriodStart',cycle);
  items:='[{"lineKey":"1","custom":true,"name":"Rollback-only redemption test","qty":1,"unit":"รายการ","price":1000,"lineTotal":1000,"lineTotalGross":1000}]';
  result:=public.complete_sale(second_id,'TESTLOY',warehouse_id,sale,items,null);
  assert (result->'sale'->>'total')::numeric=900 and (result->'sale'->'loyalty'->>'earned')::int=18,'Complete sale redeems and earns on net';
  assert (select (value->>'balance')::numeric from jsonb_array_elements(public.get_customer_loyalty(array[customer_id::text],warehouse_id)))=base_balance+18,'Post-sale balance';
  begin
    perform public.complete_sale(failed_id,'TESTLOY',warehouse_id,sale||'{"loyaltyPeriodStart":"2000-01-01"}',items,null);
    raise exception 'Expired cycle unexpectedly accepted';
  exception when others then if sqlerrm<>'LOYALTY_CYCLE_CHANGED' then raise; end if; end;
  assert not exists(select 1 from public.sales where checkout_request_id=failed_id),'Failed points validation leaves no bill';
end $$;
select 'Full checkout and idempotency checks passed; test transaction rolled back' as result;
rollback;
