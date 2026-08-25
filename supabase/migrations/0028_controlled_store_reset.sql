-- Controlled store maintenance reset.
-- Only the service-role Edge Function can call the public RPC. The RPC verifies
-- that the requested actor is still the Level 1 owner, serializes concurrent
-- resets, records an internal audit event, and performs every database change
-- in the RPC transaction.

create table if not exists private.store_reset_audit (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('documents','factory')),
  actor_id uuid,
  actor_username text,
  row_counts jsonb not null default '{}'::jsonb,
  reset_at timestamptz not null default clock_timestamp()
);

alter table private.store_reset_audit enable row level security;
revoke all on private.store_reset_audit from public, anon, authenticated;

-- The bootstrap Edge Function may receive two nearly simultaneous requests.
-- The database remains the final guard that permits only one primary owner.
create unique index if not exists profiles_one_primary_owner
on public.profiles ((owner))
where owner=true and level=1;

-- Normal users must never delete immutable posted history. The maintenance RPC
-- sets this transaction-local flag; it is not available through any user RPC.
create or replace function private.protect_completed_sale_delete()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  if current_setting('pepos.maintenance_reset',true)='on' then
    return old;
  end if;
  if coalesce(old.status,'done')<>'hold' then
    raise exception 'completed sales cannot be deleted; void the sale instead';
  end if;
  return old;
end;
$$;

create or replace function private.protect_posted_inventory_document_delete()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  v_data jsonb:=coalesce(old.data,'{}'::jsonb);
  v_posted boolean:=false;
begin
  if current_setting('pepos.maintenance_reset',true)='on' then
    return old;
  end if;
  if tg_table_name in ('goods_receipts','product_returns') then
    v_posted:=coalesce((v_data->>'stockApplied')::boolean,false)
      or coalesce(v_data->>'status','') in ('รับสินค้าแล้ว','ชำระเรียบร้อย','คืนเรียบร้อย');
  elsif tg_table_name='product_exchanges' then
    v_posted:=coalesce((v_data->>'outgoingApplied')::boolean,false)
      or coalesce((v_data->>'incomingApplied')::boolean,false)
      or coalesce(v_data->>'status','') in ('ส่งไปเปลี่ยนแล้ว','รับสินค้ากลับแล้ว');
  elsif tg_table_name='transfers' then
    v_posted:=coalesce((v_data->>'stockApplied')::boolean,true);
  end if;

  if v_posted then
    raise exception 'inventory-posted documents cannot be deleted';
  end if;
  return old;
end;
$$;

revoke execute on function private.protect_completed_sale_delete() from public,anon,authenticated;
revoke execute on function private.protect_posted_inventory_document_delete() from public,anon,authenticated;

create or replace function public.admin_reset_store_data(
  p_mode text,
  p_actor_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_mode text:=lower(trim(coalesce(p_mode,'')));
  v_actor_username text;
  v_counts jsonb;
  v_epoch text:=gen_random_uuid()::text;
  v_table text;
  v_sequence text;
begin
  if v_mode not in ('documents','factory') then
    raise exception 'invalid reset mode';
  end if;
  if p_confirmation <> (case when v_mode='factory' then 'CONFIRM_FACTORY_RESET' else 'CONFIRM_DOCUMENT_RESET' end) then
    raise exception 'invalid reset confirmation';
  end if;

  select profile.username into v_actor_username
  from public.profiles profile
  where profile.id=p_actor_id and profile.owner=true and profile.level=1;
  if v_actor_username is null then
    raise exception 'owner access required';
  end if;

  perform pg_advisory_xact_lock(hashtext('pepos-controlled-store-reset'));
  perform set_config('pepos.maintenance_reset','on',true);

  select jsonb_build_object(
    'sales',(select count(*) from public.sales),
    'documents',
      (select count(*) from public.quotations)
      +(select count(*) from public.invoices_ar)
      +(select count(*) from public.credit_notes)
      +(select count(*) from public.purchase_orders)
      +(select count(*) from public.goods_receipts)
      +(select count(*) from public.purchase_orders_full)
      +(select count(*) from public.product_returns)
      +(select count(*) from public.product_exchanges)
      +(select count(*) from public.transfers)
      +(select count(*) from public.standalone_tax_invoices),
    'lots',(select count(*) from public.inventory_lots),
    'movements',(select count(*) from public.inventory_lot_movements),
    'products',(select count(*) from public.products),
    'users',(select count(*) from public.profiles)
  ) into v_counts;

  -- Children and immutable ledger rows are removed before their parents.
  delete from public.sale_items;
  delete from public.inventory_lot_movements;
  delete from public.inventory_lots;
  delete from public.inventory_balances;
  delete from public.product_unit_changes;
  delete from public.inspection_lists;
  delete from public.sales;
  delete from public.quotations;
  delete from public.invoices_ar;
  delete from public.credit_notes;
  delete from public.purchase_orders;
  delete from public.goods_receipts;
  delete from public.purchase_orders_full;
  delete from public.product_returns;
  delete from public.product_exchanges;
  delete from public.transfers;
  delete from public.standalone_tax_invoices;
  delete from private.sale_document_sequences;

  if v_mode='documents' then
    update public.products
    set stock=0,
        data=jsonb_set(jsonb_set(coalesce(data,'{}'::jsonb),'{stock}',to_jsonb(0),true),'{expiry}',to_jsonb(''::text),true),
        updated_at=clock_timestamp();
    delete from public.settings where key='inspection_lists';
  else
    delete from public.favorites;
    delete from public.profile_warehouse_access;
    delete from public.promotions;
    delete from public.products;
    delete from public.contacts;
    delete from public.sales_representatives;
    delete from public.categories;
    delete from public.units;
    delete from public.brands;
    delete from public.warehouses;
    delete from public.settings;
    delete from public.profiles;
  end if;

  -- This marker survives both reset modes. A stale browser compares it before
  -- syncing and discards its former local workspace instead of re-uploading it.
  insert into public.settings(key,value,updated_at)
  values('maintenance_epoch',jsonb_build_object('epoch',v_epoch,'mode',v_mode,'resetAt',clock_timestamp()),clock_timestamp())
  on conflict (key) do update set value=excluded.value,updated_at=excluded.updated_at;

  foreach v_table in array (case when v_mode='factory' then
    array['sale_items','inventory_lots','inventory_lot_movements','product_unit_changes','warehouses','categories','units','brands','products','contacts','sales_representatives']
  else
    array['sale_items','inventory_lots','inventory_lot_movements','product_unit_changes']
  end) loop
    v_sequence:=pg_get_serial_sequence('public.'||v_table,'id');
    if v_sequence is not null then
      execute format('select setval(%L,1,false)',v_sequence);
    end if;
  end loop;

  insert into private.store_reset_audit(mode,actor_id,actor_username,row_counts)
  values(v_mode,p_actor_id,v_actor_username,v_counts);

  return jsonb_build_object(
    'ok',true,
    'mode',v_mode,
    'epoch',v_epoch,
    'resetAt',clock_timestamp(),
    'counts',v_counts
  );
end;
$$;

revoke execute on function public.admin_reset_store_data(text,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_reset_store_data(text,uuid,text) to service_role;
