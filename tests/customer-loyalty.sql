-- Actual deployed functions against temporary fixtures; no persistent DML.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where owner=true limit 1),true);
create temporary table loyalty_test_contacts(id bigint primary key,type text,data jsonb,created_at timestamptz);
create temporary table loyalty_test_sales(id text,status text,data jsonb);
do $$
declare source text; signature text;
begin
  foreach signature in array array['private.loyalty_cycle(timestamp with time zone,timestamp with time zone)',
    'private.customer_loyalty_snapshot(bigint,timestamp with time zone)','private.finalize_sale_loyalty(jsonb)',
    'private.preserve_customer_loyalty_joined_at()','private.lock_customer_loyalty_void()'] loop
    source:=pg_get_functiondef(signature::regprocedure);
    source:=replace(source,'private.loyalty_cycle','pg_temp.loyalty_cycle');
    source:=replace(source,'private.customer_loyalty_snapshot','pg_temp.customer_loyalty_snapshot');
    source:=replace(source,'private.finalize_sale_loyalty','pg_temp.finalize_sale_loyalty');
    source:=replace(source,'private.preserve_customer_loyalty_joined_at','pg_temp.preserve_customer_loyalty_joined_at');
    source:=replace(source,'private.lock_customer_loyalty_void','pg_temp.lock_customer_loyalty_void');
    source:=replace(source,'public.contacts','pg_temp.loyalty_test_contacts');
    source:=replace(source,'public.sales','pg_temp.loyalty_test_sales');
    execute source;
  end loop;
end $$;
create trigger enrollment before insert or update on loyalty_test_contacts for each row execute function pg_temp.preserve_customer_loyalty_joined_at();
create trigger void_points before update of status on loyalty_test_sales for each row execute function pg_temp.lock_customer_loyalty_void();
insert into loyalty_test_contacts values(1,'customer','{}',now()-interval '2 months'),(2,'customer','{}',now()-interval '2 months');
do $$
declare cycle jsonb; state jsonb; sale jsonb; original jsonb; expected text; original_join text; code text;
begin
  cycle:=pg_temp.loyalty_cycle('2025-09-03 01:00+07','2026-09-02 23:59:59+07');
  assert cycle->>'periodStart'='2025-09-03' and cycle->>'expiresOn'='2026-09-03','Before anniversary';
  cycle:=pg_temp.loyalty_cycle('2025-09-03 01:00+07','2026-09-03 00:00+07');
  assert cycle->>'periodStart'='2026-09-03' and cycle->>'expiresOn'='2027-09-03','Anniversary at Thai midnight';
  cycle:=pg_temp.loyalty_cycle('2024-02-29 01:00+07','2025-02-28 00:00+07');
  assert cycle->>'periodStart'='2025-02-28','Leap day on nonleap year';
  cycle:=pg_temp.loyalty_cycle('2024-02-29 01:00+07','2028-02-28 12:00+07');
  assert cycle->>'expiresOn'='2028-02-29','Leap date stays anchored';
  select data->>'loyaltyJoinedAt' into original_join from loyalty_test_contacts where id=1;
  update loyalty_test_contacts set data='{"loyaltyJoinedAt":"2000-01-01"}' where id=1;
  assert (select data->>'loyaltyJoinedAt'=original_join from loyalty_test_contacts where id=1),'Enrollment immutable';
  update loyalty_test_contacts set data='{}' where id=1;
  assert (select data->>'loyaltyJoinedAt'=original_join from loyalty_test_contacts where id=1),'Old client preserves enrollment';
  state:=pg_temp.customer_loyalty_snapshot(1,now());expected:=state->>'periodStart';
  insert into loyalty_test_sales values('OLD','done','{"customerId":"1","total":50000}');
  assert (pg_temp.customer_loyalty_snapshot(1,now())->>'balance')::int=0,'No retroactive rewards';
  original:=jsonb_build_object('customerId','1','total',10000,'discount',0,'fee',0,'loyalty',jsonb_build_object('earned',999999));
  sale:=pg_temp.finalize_sale_loyalty(original);
  assert (sale->'loyalty'->>'earned')::int=200,'Server ignores spoofed ledger';
  insert into loyalty_test_sales values('EARN','done',sale);
  assert (pg_temp.customer_loyalty_snapshot(1,now())->>'balance')::int=200,'Earned balance';
  original:=jsonb_build_object('customerId','1','total',900,'discount',100,'fee',0,'loyaltyRedeemed',100,'loyaltyPeriodStart',expected);
  sale:=pg_temp.finalize_sale_loyalty(original);
  assert (sale->'loyalty'->>'earned')::int=18 and (sale->'loyalty'->>'redeemed')::int=100,'1000 minus 100 pays 900 earns 18';
  insert into loyalty_test_sales values('REDEEM','done',sale);
  assert (pg_temp.customer_loyalty_snapshot(1,now())->>'balance')::int=118,'Remaining balance';
  assert (pg_temp.customer_loyalty_snapshot(2,now())->>'balance')::int=0,'Other customer isolated';
  foreach code in array array['LOYALTY_INSUFFICIENT_POINTS','LOYALTY_MINIMUM_1000','LOYALTY_CYCLE_CHANGED','LOYALTY_INVALID_POINTS','LOYALTY_DISCOUNT_MISMATCH'] loop
    sale:=case code
      when 'LOYALTY_INSUFFICIENT_POINTS' then original||'{"loyaltyRedeemed":119,"discount":119}'
      when 'LOYALTY_MINIMUM_1000' then original||'{"total":899.99}'
      when 'LOYALTY_CYCLE_CHANGED' then original||'{"loyaltyPeriodStart":"2000-01-01"}'
      when 'LOYALTY_INVALID_POINTS' then original||'{"loyaltyRedeemed":1.5}'
      else original||'{"discount":0}' end;
    begin
      perform pg_temp.finalize_sale_loyalty(sale);raise exception 'Expected rejection: %',code;
    exception when others then if sqlerrm<>code then raise; end if; end;
  end loop;
  update loyalty_test_sales set status='void' where id='REDEEM';
  assert (pg_temp.customer_loyalty_snapshot(1,now())->>'balance')::int=200,'Void restores redemption/removes earning';
  update loyalty_test_sales set status='done' where id='REDEEM';
  update loyalty_test_sales set status='void' where id='EARN';
  state:=pg_temp.customer_loyalty_snapshot(1,now());
  assert (state->>'balance')::int=0 and (state->>'adjustmentDue')::int=82,'Spent earnings voided: deficit';
  state:=pg_temp.customer_loyalty_snapshot(1,(state->>'expiresAt')::timestamptz);
  assert (state->>'balance')::int=0 and (state->>'adjustmentDue')::int=0,'Old cycle expires';
  update loyalty_test_sales set status='void' where id='REDEEM';
  assert (pg_temp.customer_loyalty_snapshot(1,(state->>'periodStart')::date::timestamp at time zone 'Asia/Bangkok')->>'balance')::int=0,'Void cannot revive expired points';
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform pg_temp.finalize_sale_loyalty(original);raise exception 'Unauthenticated accepted';
  exception when insufficient_privilege then null; end;
end $$;
select 'Loyalty SQL checks passed: earning, minimum, anniversary, leap year, void, isolation, enrollment protection' as result;
rollback;
