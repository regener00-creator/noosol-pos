-- Cashier shifts: every completed sale and sale void belongs to the actor's
-- open shift in the active warehouse. Closing stores an immutable snapshot.

create table if not exists private.cash_shift_sequences (
  shift_date date primary key,
  last_value bigint not null default 0
);
revoke all on private.cash_shift_sequences from public,anon,authenticated;

create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_no text not null unique,
  warehouse_id bigint not null references public.warehouses(id),
  opened_by uuid not null references public.profiles(id),
  opened_by_name text not null,
  opened_at timestamptz not null default clock_timestamp(),
  opening_cash numeric(14,2) not null default 0 check (opening_cash>=0),
  status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid references public.profiles(id),
  closed_by_name text,
  closed_at timestamptz,
  gross_sales numeric(14,2) not null default 0,
  refunds numeric(14,2) not null default 0,
  net_sales numeric(14,2) not null default 0,
  cash_sales numeric(14,2) not null default 0,
  cash_refunds numeric(14,2) not null default 0,
  expected_cash numeric(14,2) not null default 0,
  counted_cash numeric(14,2),
  variance numeric(14,2),
  sale_count integer not null default 0,
  refund_count integer not null default 0,
  payment_summary jsonb not null default '{}'::jsonb,
  close_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint cash_shift_close_values check (
    (status='open' and closed_at is null and counted_cash is null and variance is null)
    or
    (status='closed' and closed_at is not null and counted_cash is not null and variance is not null)
  )
);

create unique index if not exists idx_cash_shifts_one_open_per_cashier
on public.cash_shifts(warehouse_id,opened_by) where status='open';
create index if not exists idx_cash_shifts_warehouse_opened
on public.cash_shifts(warehouse_id,opened_at desc);
create index if not exists idx_cash_shifts_cashier_opened
on public.cash_shifts(opened_by,opened_at desc);

alter table public.sales add column if not exists cash_shift_id uuid references public.cash_shifts(id);
alter table public.sales add column if not exists void_shift_id uuid references public.cash_shifts(id);
create index if not exists idx_sales_cash_shift on public.sales(cash_shift_id) where cash_shift_id is not null;
create index if not exists idx_sales_void_shift on public.sales(void_shift_id) where void_shift_id is not null;

create or replace function private.next_cash_shift_number(p_date date)
returns text language plpgsql security definer set search_path=''
as $$
declare v_sequence bigint;
begin
  insert into private.cash_shift_sequences(shift_date,last_value) values(p_date,1)
  on conflict (shift_date) do update set last_value=private.cash_shift_sequences.last_value+1
  returning last_value into v_sequence;
  return 'CS'||to_char(p_date,'YYYYMMDD')||lpad(v_sequence::text,4,'0');
end;
$$;
revoke execute on function private.next_cash_shift_number(date) from public,anon,authenticated;

create or replace function private.current_open_cash_shift(p_warehouse_id bigint,p_user_id uuid)
returns uuid language sql stable security definer set search_path=''
as $$
  select shift.id from public.cash_shifts shift
  where shift.warehouse_id=p_warehouse_id and shift.opened_by=p_user_id and shift.status='open'
  order by shift.opened_at desc limit 1
$$;
revoke execute on function private.current_open_cash_shift(bigint,uuid) from public,anon,authenticated;

create or replace function private.assign_cash_shift_to_sale()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid:=(select auth.uid());
  v_warehouse bigint;
  v_shift uuid;
begin
  if current_setting('pepos.maintenance_reset',true)='on' or v_user is null then return new; end if;
  v_warehouse:=coalesce(nullif(new.data->>'warehouseId','')::bigint,nullif(new.data#>>'{items,0,warehouseId}','')::bigint);

  if tg_op='INSERT' and coalesce(new.status,'done')='done' then
    select shift.id into v_shift from public.cash_shifts shift
    where shift.warehouse_id=v_warehouse and shift.opened_by=v_user and shift.status='open'
    order by shift.opened_at desc limit 1 for update;
    if v_shift is null then raise exception 'cash shift required'; end if;
    new.cash_shift_id:=v_shift;
    new.data:=jsonb_set(coalesce(new.data,'{}'::jsonb),'{cashShiftId}',to_jsonb(v_shift::text),true);
  elsif tg_op='UPDATE' then
    if new.cash_shift_id is distinct from old.cash_shift_id then raise exception 'sale cash shift is immutable'; end if;
    if old.void_shift_id is not null and new.void_shift_id is distinct from old.void_shift_id then raise exception 'sale void shift is immutable'; end if;
    if old.status='done' and new.status='void' then
      select shift.id into v_shift from public.cash_shifts shift
      where shift.warehouse_id=v_warehouse and shift.opened_by=v_user and shift.status='open'
      order by shift.opened_at desc limit 1 for update;
      if v_shift is null then raise exception 'cash shift required'; end if;
      new.void_shift_id:=v_shift;
      new.data:=jsonb_set(coalesce(new.data,'{}'::jsonb),'{voidShiftId}',to_jsonb(v_shift::text),true);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.assign_cash_shift_to_sale() from public,anon,authenticated;
drop trigger if exists assign_cash_shift_to_sale on public.sales;
create trigger assign_cash_shift_to_sale before insert or update on public.sales
for each row execute function private.assign_cash_shift_to_sale();

create or replace function private.protect_cash_shift_history()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if current_setting('pepos.maintenance_reset',true)='on' then return case when tg_op='DELETE' then old else new end; end if;
  if tg_op='DELETE' then raise exception 'cash shift history cannot be deleted'; end if;
  if old.status='closed' then raise exception 'closed cash shift is immutable'; end if;
  return new;
end;
$$;
revoke execute on function private.protect_cash_shift_history() from public,anon,authenticated;
drop trigger if exists protect_cash_shift_history on public.cash_shifts;
create trigger protect_cash_shift_history before update or delete on public.cash_shifts
for each row execute function private.protect_cash_shift_history();

alter table public.cash_shifts enable row level security;
revoke all on public.cash_shifts from public,anon,authenticated;
grant select on public.cash_shifts to authenticated;
grant all on public.cash_shifts to service_role;
drop policy if exists cash_shifts_read on public.cash_shifts;
create policy cash_shifts_read on public.cash_shifts for select to authenticated using (
  (select private.is_current_owner()) or opened_by=(select auth.uid()) or closed_by=(select auth.uid())
);

create or replace function public.open_cash_shift(p_warehouse_id bigint,p_opening_cash numeric)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid:=(select auth.uid());
  v_name text;
  v_shift public.cash_shifts%rowtype;
  v_date date:=(clock_timestamp() at time zone 'Asia/Bangkok')::date;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_warehouse_id is null or coalesce(p_opening_cash,-1)<0 or p_opening_cash>999999999.99 then raise exception 'invalid opening cash'; end if;
  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access access
    where access.user_id=v_user and access.warehouse_id=p_warehouse_id and access.can_sell
  ) then raise exception 'warehouse sale access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_warehouse_id::text||':'||v_user::text,0));
  if exists(select 1 from public.cash_shifts where warehouse_id=p_warehouse_id and opened_by=v_user and status='open') then
    raise exception 'cash shift already open';
  end if;
  select coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.username)
    into v_name from public.profiles p where p.id=v_user;
  insert into public.cash_shifts(shift_no,warehouse_id,opened_by,opened_by_name,opening_cash)
  values(private.next_cash_shift_number(v_date),p_warehouse_id,v_user,coalesce(v_name,'ผู้ใช้งาน'),round(p_opening_cash,2))
  returning * into v_shift;
  return to_jsonb(v_shift);
end;
$$;

create or replace function public.close_cash_shift(p_shift_id uuid,p_counted_cash numeric,p_close_reason text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid:=(select auth.uid());
  v_actor_name text;
  v_shift public.cash_shifts%rowtype;
  v_gross numeric:=0; v_refunds numeric:=0; v_cash_sales numeric:=0; v_cash_refunds numeric:=0;
  v_sale_count integer:=0; v_refund_count integer:=0;
  v_expected numeric; v_variance numeric; v_payment_summary jsonb:='{}'::jsonb;
  v_reason text:=nullif(btrim(coalesce(p_close_reason,'')),'');
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if p_shift_id is null or coalesce(p_counted_cash,-1)<0 or p_counted_cash>999999999.99 then raise exception 'invalid counted cash'; end if;
  select * into v_shift from public.cash_shifts where id=p_shift_id for update;
  if not found then raise exception 'cash shift not found'; end if;
  if v_shift.status<>'open' then raise exception 'cash shift already closed'; end if;
  if v_shift.opened_by<>v_user and not (select private.is_current_owner()) then raise exception 'cash shift access denied'; end if;

  select coalesce(sum(s.total),0),count(*)::integer,
         coalesce(sum(s.total) filter(where s.pay_method='เงินสด'),0)
    into v_gross,v_sale_count,v_cash_sales
  from public.sales s where s.cash_shift_id=p_shift_id;
  select coalesce(sum(s.total),0),count(*)::integer,
         coalesce(sum(s.total) filter(where s.pay_method='เงินสด'),0)
    into v_refunds,v_refund_count,v_cash_refunds
  from public.sales s where s.void_shift_id=p_shift_id;
  select coalesce(jsonb_object_agg(summary.pay_method,jsonb_build_object(
           'sales',summary.sales,'refunds',summary.refunds,'net',summary.sales-summary.refunds,
           'saleCount',summary.sale_count,'refundCount',summary.refund_count
         )),'{}'::jsonb)
    into v_payment_summary
  from (
    select movement.pay_method,round(sum(movement.sales),2) sales,round(sum(movement.refunds),2) refunds,
           sum(movement.sale_count)::integer sale_count,sum(movement.refund_count)::integer refund_count
    from (
      select coalesce(nullif(s.pay_method,''),'ไม่ระบุ') pay_method,s.total sales,0::numeric refunds,1 sale_count,0 refund_count
      from public.sales s where s.cash_shift_id=p_shift_id
      union all
      select coalesce(nullif(s.pay_method,''),'ไม่ระบุ'),0::numeric,s.total,0,1
      from public.sales s where s.void_shift_id=p_shift_id
    ) movement group by movement.pay_method
  ) summary;

  v_expected:=round(v_shift.opening_cash+v_cash_sales-v_cash_refunds,2);
  v_variance:=round(p_counted_cash-v_expected,2);
  if abs(v_variance)>=0.01 and coalesce(length(v_reason),0)<3 then raise exception 'variance reason required'; end if;
  select coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.username)
    into v_actor_name from public.profiles p where p.id=v_user;
  update public.cash_shifts set
    status='closed',closed_by=v_user,closed_by_name=coalesce(v_actor_name,'ผู้ใช้งาน'),closed_at=clock_timestamp(),
    gross_sales=round(v_gross,2),refunds=round(v_refunds,2),net_sales=round(v_gross-v_refunds,2),
    cash_sales=round(v_cash_sales,2),cash_refunds=round(v_cash_refunds,2),expected_cash=v_expected,
    counted_cash=round(p_counted_cash,2),variance=v_variance,sale_count=v_sale_count,refund_count=v_refund_count,
    payment_summary=v_payment_summary,close_reason=v_reason,updated_at=clock_timestamp()
  where id=p_shift_id returning * into v_shift;
  return to_jsonb(v_shift);
end;
$$;

revoke execute on function public.open_cash_shift(bigint,numeric) from public,anon;
revoke execute on function public.close_cash_shift(uuid,numeric,text) from public,anon;
grant execute on function public.open_cash_shift(bigint,numeric) to authenticated;
grant execute on function public.close_cash_shift(uuid,numeric,text) to authenticated;

drop trigger if exists audit_cash_shifts_changes on public.cash_shifts;
create trigger audit_cash_shifts_changes after insert or update or delete on public.cash_shifts
for each row execute function private.capture_audit_log('cash_shifts');

-- Keep both reset modes complete after adding shift documents.
create or replace function public.admin_reset_store_data(p_mode text,p_actor_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_mode text:=lower(trim(coalesce(p_mode,''))); v_actor_username text; v_counts jsonb;
  v_epoch text:=gen_random_uuid()::text; v_table text; v_sequence text;
begin
  if v_mode not in ('documents','factory') then raise exception 'invalid reset mode'; end if;
  if p_confirmation<>(case when v_mode='factory' then 'CONFIRM_FACTORY_RESET' else 'CONFIRM_DOCUMENT_RESET' end) then raise exception 'invalid reset confirmation'; end if;
  select profile.username into v_actor_username from public.profiles profile where profile.id=p_actor_id and profile.owner=true and profile.level=1;
  if v_actor_username is null then raise exception 'owner access required'; end if;
  perform pg_advisory_xact_lock(hashtext('pepos-controlled-store-reset'));
  perform set_config('pepos.maintenance_reset','on',true);
  select jsonb_build_object(
    'sales',(select count(*) from public.sales),'cashShifts',(select count(*) from public.cash_shifts),
    'documents',(select count(*) from public.quotations)+(select count(*) from public.invoices_ar)+(select count(*) from public.credit_notes)+(select count(*) from public.purchase_orders)+(select count(*) from public.goods_receipts)+(select count(*) from public.purchase_orders_full)+(select count(*) from public.product_returns)+(select count(*) from public.product_exchanges)+(select count(*) from public.transfers)+(select count(*) from public.standalone_tax_invoices)+(select count(*) from public.inventory_count_adjustments),
    'lots',(select count(*) from public.inventory_lots),'movements',(select count(*) from public.inventory_lot_movements),'products',(select count(*) from public.products),'users',(select count(*) from public.profiles)
  ) into v_counts;
  delete from public.sale_items;
  delete from public.inventory_count_adjustment_lines; delete from public.inventory_count_adjustments;
  delete from public.inventory_lot_movements; delete from public.inventory_lots; delete from public.inventory_balances;
  delete from public.product_unit_changes; delete from public.inspection_lists; delete from public.sales; delete from public.cash_shifts;
  delete from public.quotations; delete from public.invoices_ar; delete from public.credit_notes; delete from public.purchase_orders;
  delete from public.goods_receipts; delete from public.purchase_orders_full; delete from public.product_returns; delete from public.product_exchanges;
  delete from public.transfers; delete from public.standalone_tax_invoices; delete from private.sale_document_sequences; delete from private.cash_shift_sequences;
  if v_mode='documents' then
    update public.products set stock=0,data=jsonb_set(jsonb_set(coalesce(data,'{}'::jsonb),'{stock}',to_jsonb(0),true),'{expiry}',to_jsonb(''::text),true),updated_at=clock_timestamp();
    delete from public.settings where key='inspection_lists';
  else
    delete from public.favorites; delete from public.profile_warehouse_access; delete from public.promotions; delete from public.products;
    delete from public.contacts; delete from public.sales_representatives; delete from public.categories; delete from public.units; delete from public.brands;
    delete from public.warehouses; delete from public.settings; delete from public.profiles;
  end if;
  insert into public.settings(key,value,updated_at) values('maintenance_epoch',jsonb_build_object('epoch',v_epoch,'mode',v_mode,'resetAt',clock_timestamp()),clock_timestamp())
  on conflict (key) do update set value=excluded.value,updated_at=excluded.updated_at;
  foreach v_table in array(case when v_mode='factory' then array['sale_items','inventory_count_adjustment_lines','inventory_lots','inventory_lot_movements','product_unit_changes','warehouses','categories','units','brands','products','contacts','sales_representatives'] else array['sale_items','inventory_count_adjustment_lines','inventory_lots','inventory_lot_movements','product_unit_changes'] end) loop
    v_sequence:=pg_get_serial_sequence('public.'||v_table,'id'); if v_sequence is not null then execute format('select setval(%L,1,false)',v_sequence); end if;
  end loop;
  insert into private.store_reset_audit(mode,actor_id,actor_username,row_counts) values(v_mode,p_actor_id,v_actor_username,v_counts);
  return jsonb_build_object('ok',true,'mode',v_mode,'epoch',v_epoch,'resetAt',clock_timestamp(),'counts',v_counts);
end;
$$;
revoke execute on function public.admin_reset_store_data(text,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_reset_store_data(text,uuid,text) to service_role;
