-- Run with execute_sql/psql against a migrated database. No persistent DML.
-- Copy the actual deployed query into pg_temp and use isolated fixture tables.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where owner=true limit 1),true);
create temporary table customer_test_contacts(id bigint,type text,name text,data jsonb,created_at timestamptz);
create temporary table customer_test_sales(id text,ref text,sale_date date,status text,total numeric,data jsonb);
insert into customer_test_contacts values
  (1,'customer','Same name','{}',current_timestamp),
  (2,'customer','Same name','{}',current_timestamp);
insert into customer_test_sales
select 'B'||n,'B'||n,(current_timestamp at time zone 'Asia/Bangkok')::date,'done',7500,
  jsonb_build_object('customerId','1','items',jsonb_build_array(jsonb_build_object('name','Decolgen','qty',1,'unit','box','price',7500)))
from generate_series(1,12)n;
insert into customer_test_sales values
('VOID','VOID',(current_timestamp at time zone 'Asia/Bangkok')::date,'void',100000,'{"customerId":"1"}'),
('HOLD','HOLD',(current_timestamp at time zone 'Asia/Bangkok')::date,'hold',100000,'{"customerId":"1"}'),
('OTHER','OTHER',(current_timestamp at time zone 'Asia/Bangkok')::date,'done',450000,'{"customerId":"2"}'),
('OLD','OLD',make_date(extract(year from current_timestamp at time zone 'Asia/Bangkok')::int-1,2,1),'done',5000,'{"member":{"id":"1"},"items":[]}');
do $$
declare source text;
begin
  source:=pg_get_functiondef('public.get_customer_purchase_history(text[],integer,integer,integer,boolean,bigint)'::regprocedure);
  source:=replace(source,'public.get_customer_purchase_history','pg_temp.customer_purchase_query_test');
  source:=replace(source,'public.contacts','pg_temp.customer_test_contacts');
  source:=replace(source,'public.sales','pg_temp.customer_test_sales');
  execute source;
end $$;
do $$
declare result jsonb; y int:=extract(year from current_timestamp at time zone 'Asia/Bangkok')::int; m int:=extract(month from current_timestamp at time zone 'Asia/Bangkok')::int;
begin
  result:=pg_temp.customer_purchase_query_test(array['1'],y,m,1,true,1);
  assert (result->'summaries'->0->>'lifetimeTotal')::numeric=95000,'Lifetime excludes void/hold/other customer';
  assert (result->'summaries'->0->>'membershipCycleTotal')::numeric=90000,'Membership cycle excludes pre-registration sale';
  assert (result->'summaries'->0->>'membershipElapsedMonths')::int=1,'Registration month is membership month one';
  assert (result->'summaries'->0->>'periodTotal')::numeric=90000,'Monthly total';
  assert (result->'summaries'->0->>'periodBills')::int=12,'Completed bill count';
  assert (result->>'totalBills')::int=13,'Void appears in history, held bill does not';
  assert jsonb_array_length(result->'bills')=10,'10 bills per page';
  result:=pg_temp.customer_purchase_query_test(array['1'],y,m,2,true,1);
  assert jsonb_array_length(result->'bills')=3,'Remaining page';
  result:=pg_temp.customer_purchase_query_test(array['1'],y-1,null,1,true,1);
  assert (result->'summaries'->0->>'periodTotal')::numeric=5000,'Legacy member.id remains linked';
  assert (result->'summaries'->0->>'membershipCycleTotal')::numeric=90000,'Calendar history filter does not change membership tier';
  result:=pg_temp.customer_purchase_query_test(array['1','2'],y,null,1,false,1);
  assert jsonb_array_length(result->'summaries')=2,'Batch summaries';
  assert (result->'summaries'->1->>'membershipCycleTotal')::numeric=450000,'Same-name customers stay separate';
  assert jsonb_array_length(result->'bills')=0,'List summary does not load bills';
  result:=pg_temp.customer_purchase_query_test(array['1'],y-2,null,999,true,1);
  assert (result->>'totalBills')::int=0 and (result->>'page')::int=1,'Empty period and page bounds';
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform pg_temp.customer_purchase_query_test(array['1'],y,m,1,true,1);
    raise exception 'Unauthenticated call was not rejected';
  exception when insufficient_privilege then null;
  end;
end $$;
select 'Customer purchase SQL regression checks passed; all fixtures are temporary' as test;
rollback;
