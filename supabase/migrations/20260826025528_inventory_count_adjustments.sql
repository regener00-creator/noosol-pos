-- Stock counts and manual corrections are posted as one auditable transaction.
-- The document is immutable to browser clients; only the RPC below can write it.

create table if not exists public.inventory_count_adjustments (
  id uuid primary key default gen_random_uuid(),
  document_no text not null unique,
  warehouse_id bigint not null references public.warehouses(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) >= 3),
  note text,
  source_inspection_id text,
  status text not null default 'posted' check (status = 'posted'),
  line_count integer not null default 0 check (line_count >= 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_count_adjustment_lines (
  id bigint generated always as identity primary key,
  adjustment_id uuid not null references public.inventory_count_adjustments(id) on delete restrict,
  product_id bigint not null references public.products(id) on delete restrict,
  -- The recorded system value may be negative when this document is used to
  -- correct a historical anomaly. The counted result itself cannot be negative.
  system_stock numeric not null,
  counted_stock numeric not null check (counted_stock >= 0),
  difference numeric not null,
  unit_name text,
  selected_lot_id bigint references public.inventory_lots(id) on delete restrict,
  manufacturer_lot text,
  expiry_date date,
  allocations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(adjustment_id, product_id),
  check (difference = counted_stock - system_stock)
);

create index if not exists idx_inventory_count_adjustments_warehouse_created
on public.inventory_count_adjustments(warehouse_id, created_at desc);

create index if not exists idx_inventory_count_adjustments_created_by
on public.inventory_count_adjustments(created_by, created_at desc);

create index if not exists idx_inventory_count_adjustment_lines_product
on public.inventory_count_adjustment_lines(product_id, created_at desc);

alter table public.inventory_count_adjustments enable row level security;
alter table public.inventory_count_adjustment_lines enable row level security;

revoke all on public.inventory_count_adjustments from anon, authenticated;
revoke all on public.inventory_count_adjustment_lines from anon, authenticated;
grant select on public.inventory_count_adjustments to authenticated;
grant select on public.inventory_count_adjustment_lines to authenticated;
grant all on public.inventory_count_adjustments to service_role;
grant all on public.inventory_count_adjustment_lines to service_role;

drop policy if exists inventory_count_adjustments_read_warehouse on public.inventory_count_adjustments;
create policy inventory_count_adjustments_read_warehouse
on public.inventory_count_adjustments for select to authenticated
using (
  (select private.is_current_owner()) or exists (
    select 1
    from public.profile_warehouse_access access
    where access.user_id = (select auth.uid())
      and access.warehouse_id = inventory_count_adjustments.warehouse_id
      and access.can_manage_stock
  )
);

drop policy if exists inventory_count_adjustment_lines_read_warehouse on public.inventory_count_adjustment_lines;
create policy inventory_count_adjustment_lines_read_warehouse
on public.inventory_count_adjustment_lines for select to authenticated
using (
  exists (
    select 1
    from public.inventory_count_adjustments adjustment
    where adjustment.id = inventory_count_adjustment_lines.adjustment_id
  )
);

create or replace function public.post_inventory_count_adjustment(
  p_warehouse_id bigint,
  p_reason text,
  p_note text,
  p_source_inspection_id text,
  p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_adjustment_id uuid := gen_random_uuid();
  v_document_no text;
  v_operator_name text;
  v_now timestamptz := clock_timestamp();
  v_item jsonb;
  v_ordinal bigint;
  v_product bigint;
  v_expected numeric;
  v_target numeric;
  v_current numeric;
  v_lot_stock numeric;
  v_delta numeric;
  v_allocation_delta numeric;
  v_need numeric;
  v_take numeric;
  v_selected_lot_id bigint;
  v_lot_number text;
  v_expiry date;
  v_unit_name text;
  v_lot public.inventory_lots%rowtype;
  v_lot_id bigint;
  v_cost numeric;
  v_allocations jsonb;
  v_balances jsonb := '[]'::jsonb;
  v_line_count integer := 0;
  v_inspection_data jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if p_warehouse_id is null then raise exception 'warehouse is required'; end if;
  if char_length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'adjustment reason is required'; end if;
  if jsonb_typeof(coalesce(p_lines,'null'::jsonb)) <> 'array' then raise exception 'adjustment lines must be an array'; end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'too many adjustment lines'; end if;
  if jsonb_array_length(p_lines) = 0 and nullif(btrim(coalesce(p_source_inspection_id,'')),'') is null then
    raise exception 'adjustment lines are required';
  end if;
  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access access
    where access.user_id = (select auth.uid())
      and access.warehouse_id = p_warehouse_id
      and access.can_manage_stock
  ) then raise exception 'stock management access denied'; end if;

  select coalesce(nullif(btrim(concat_ws(' ',profile.first_name,profile.last_name)),''),profile.username,'ผู้ใช้งาน')
  into v_operator_name
  from public.profiles profile
  where profile.id = (select auth.uid());
  v_operator_name := coalesce(v_operator_name,'ผู้ใช้งาน');
  v_document_no := 'SC'||to_char(v_now at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(substr(replace(v_adjustment_id::text,'-',''),1,8));

  if nullif(btrim(coalesce(p_source_inspection_id,'')),'') is not null then
    select data into v_inspection_data
    from public.inspection_lists
    where id = p_source_inspection_id
    for update;
    if not found then raise exception 'inspection list not found'; end if;
    if coalesce(nullif(v_inspection_data->>'warehouseId','')::bigint,p_warehouse_id) <> p_warehouse_id then
      raise exception 'inspection list belongs to another warehouse';
    end if;
    if nullif(btrim(coalesce(v_inspection_data->>'stockAdjustedAt','')),'') is not null then
      raise exception 'inspection list was already posted';
    end if;
  end if;

  insert into public.inventory_count_adjustments(
    id,document_no,warehouse_id,reason,note,source_inspection_id,status,line_count,created_by,created_by_name,created_at
  ) values (
    v_adjustment_id,v_document_no,p_warehouse_id,btrim(p_reason),nullif(btrim(coalesce(p_note,'')),''),
    nullif(btrim(coalesce(p_source_inspection_id,'')),''),'posted',0,(select auth.uid()),v_operator_name,v_now
  );

  for v_item,v_ordinal in
    select value,ordinality from jsonb_array_elements(p_lines) with ordinality
  loop
    v_product := nullif(v_item->>'productId','')::bigint;
    v_expected := nullif(v_item->>'expectedStock','')::numeric;
    v_target := nullif(v_item->>'targetStock','')::numeric;
    v_selected_lot_id := nullif(v_item->>'selectedLotId','')::bigint;
    v_lot_number := nullif(btrim(coalesce(v_item->>'lotNumber','')),'');
    v_expiry := case when coalesce(v_item->>'expiry','') ~ '^\d{4}-\d{2}-\d{2}$' then (v_item->>'expiry')::date else null end;
    v_unit_name := nullif(btrim(coalesce(v_item->>'unitName','')),'');
    v_allocations := '[]'::jsonb;

    if v_product is null or v_expected is null or v_target is null or v_target < 0 then
      raise exception 'invalid adjustment line %',v_ordinal;
    end if;
    if not exists (select 1 from public.products product where product.id=v_product) then
      raise exception 'product not found on line %',v_ordinal;
    end if;
    if exists (
      select 1 from public.inventory_count_adjustment_lines line
      where line.adjustment_id=v_adjustment_id and line.product_id=v_product
    ) then raise exception 'duplicate product on line %',v_ordinal; end if;

    -- Serialize against sales, transfers and other adjustments for this product.
    perform lot.id
    from public.inventory_lots lot
    where lot.product_id=v_product and lot.warehouse_id=p_warehouse_id
    order by lot.id
    for update;
    insert into public.inventory_balances(warehouse_id,product_id,stock,updated_at)
    values(p_warehouse_id,v_product,0,v_now)
    on conflict (warehouse_id,product_id) do nothing;
    select balance.stock into v_current
    from public.inventory_balances balance
    where balance.product_id=v_product and balance.warehouse_id=p_warehouse_id
    for update;
    if abs(coalesce(v_current,0)-v_expected) > 0.000001 then
      raise exception 'stock changed before confirmation for product % (expected %, current %)',v_product,v_expected,v_current;
    end if;
    select coalesce(sum(lot.quantity_base),0) into v_lot_stock
    from public.inventory_lots lot
    where lot.product_id=v_product and lot.warehouse_id=p_warehouse_id
      and lot.status<>'blocked' and lot.quantity_base>0;
    v_delta := v_target-v_current;
    v_allocation_delta := v_target-v_lot_stock;
    if abs(v_delta) <= 0.000001 and abs(v_allocation_delta) <= 0.000001 then continue; end if;

    if v_allocation_delta > 0 then
      if v_selected_lot_id is not null then
        select * into v_lot from public.inventory_lots lot
        where lot.id=v_selected_lot_id and lot.product_id=v_product and lot.warehouse_id=p_warehouse_id
        for update;
        if not found or v_lot.status='blocked' then raise exception 'selected lot is unavailable on line %',v_ordinal; end if;
        update public.inventory_lots
        set quantity_base=quantity_base+v_allocation_delta,status='active',updated_at=v_now
        where id=v_lot.id;
        insert into public.inventory_lot_movements(
          lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
          reference_type,reference_id,reference_line_key,note
        ) values (
          v_lot.id,v_product,p_warehouse_id,'stock_count_in',v_allocation_delta,v_lot.quantity_base+v_allocation_delta,
          'stock_count',v_document_no,v_product||':'||v_lot.id,btrim(p_reason)
        );
        v_lot_number := v_lot.manufacturer_lot;
        v_expiry := v_lot.expiry_date;
        v_allocations := jsonb_build_array(jsonb_build_object(
          'lotId',v_lot.id,'lotNumber',v_lot.manufacturer_lot,'expiry',v_lot.expiry_date,'quantity',v_allocation_delta
        ));
      else
        select greatest(coalesce(product.cost,0),0) into v_cost from public.products product where product.id=v_product;
        v_lot_id := private.create_inventory_lot(
          v_product,p_warehouse_id,v_allocation_delta,v_lot_number,v_expiry,v_cost,
          'stock_count',v_document_no,v_product::text,v_now
        );
        select * into v_lot from public.inventory_lots where id=v_lot_id;
        insert into public.inventory_lot_movements(
          lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
          reference_type,reference_id,reference_line_key,note
        ) values (
          v_lot_id,v_product,p_warehouse_id,'stock_count_in',v_allocation_delta,v_lot.quantity_base,
          'stock_count',v_document_no,v_product||':'||v_lot_id,btrim(p_reason)
        );
        v_allocations := jsonb_build_array(jsonb_build_object(
          'lotId',v_lot_id,'lotNumber',v_lot_number,'expiry',v_expiry,'quantity',v_allocation_delta
        ));
      end if;
    else
      v_need := abs(v_allocation_delta);
      if v_selected_lot_id is not null then
        select * into v_lot from public.inventory_lots lot
        where lot.id=v_selected_lot_id and lot.product_id=v_product and lot.warehouse_id=p_warehouse_id
          and lot.status<>'blocked' and lot.quantity_base>0
        for update;
        if not found then raise exception 'selected lot is unavailable on line %',v_ordinal; end if;
        v_take := least(v_need,v_lot.quantity_base);
        update public.inventory_lots
        set quantity_base=quantity_base-v_take,
            status=case when quantity_base-v_take<=0 then 'exhausted' else 'active' end,
            updated_at=v_now
        where id=v_lot.id;
        insert into public.inventory_lot_movements(
          lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
          reference_type,reference_id,reference_line_key,note
        ) values (
          v_lot.id,v_product,p_warehouse_id,'stock_count_out',-v_take,v_lot.quantity_base-v_take,
          'stock_count',v_document_no,v_product||':'||v_lot.id,btrim(p_reason)
        );
        v_allocations := v_allocations||jsonb_build_array(jsonb_build_object(
          'lotId',v_lot.id,'lotNumber',v_lot.manufacturer_lot,'expiry',v_lot.expiry_date,'quantity',-v_take
        ));
        v_need := v_need-v_take;
      end if;
      for v_lot in
        select lot.* from public.inventory_lots lot
        where lot.product_id=v_product and lot.warehouse_id=p_warehouse_id
          and lot.status<>'blocked' and lot.quantity_base>0
          and (v_selected_lot_id is null or lot.id<>v_selected_lot_id)
        order by lot.expiry_date asc nulls last,lot.received_at,lot.id
        for update
      loop
        exit when v_need<=0;
        v_take := least(v_need,v_lot.quantity_base);
        update public.inventory_lots
        set quantity_base=quantity_base-v_take,
            status=case when quantity_base-v_take<=0 then 'exhausted' else 'active' end,
            updated_at=v_now
        where id=v_lot.id;
        insert into public.inventory_lot_movements(
          lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
          reference_type,reference_id,reference_line_key,note
        ) values (
          v_lot.id,v_product,p_warehouse_id,'stock_count_out',-v_take,v_lot.quantity_base-v_take,
          'stock_count',v_document_no,v_product||':'||v_lot.id,btrim(p_reason)
        );
        v_allocations := v_allocations||jsonb_build_array(jsonb_build_object(
          'lotId',v_lot.id,'lotNumber',v_lot.manufacturer_lot,'expiry',v_lot.expiry_date,'quantity',-v_take
        ));
        v_need := v_need-v_take;
      end loop;
      if v_need>0.000001 then raise exception 'insufficient lot stock for product %',v_product; end if;
    end if;

    v_current := private.refresh_inventory_balance_from_lots(v_product,p_warehouse_id);
    if abs(v_current-v_target)>0.000001 then raise exception 'stock reconciliation failed for product %',v_product; end if;
    insert into public.inventory_count_adjustment_lines(
      adjustment_id,product_id,system_stock,counted_stock,difference,unit_name,
      selected_lot_id,manufacturer_lot,expiry_date,allocations,created_at
    ) values (
      v_adjustment_id,v_product,v_expected,v_target,v_delta,v_unit_name,
      v_selected_lot_id,v_lot_number,v_expiry,v_allocations,v_now
    );
    v_line_count := v_line_count+1;
    v_balances := v_balances||jsonb_build_array(jsonb_build_object(
      'productId',v_product,'warehouseId',p_warehouse_id,'stock',v_current
    ));
  end loop;

  update public.inventory_count_adjustments
  set line_count=v_line_count
  where id=v_adjustment_id;

  if nullif(btrim(coalesce(p_source_inspection_id,'')),'') is not null then
    v_inspection_data := jsonb_set(v_inspection_data,'{stockAdjustedAt}',to_jsonb(v_now::text),true);
    v_inspection_data := jsonb_set(v_inspection_data,'{stockAdjustedBy}',to_jsonb(v_operator_name),true);
    v_inspection_data := jsonb_set(v_inspection_data,'{stockAdjustmentDocumentNo}',to_jsonb(v_document_no),true);
    v_inspection_data := jsonb_set(v_inspection_data,'{updatedAt}',to_jsonb(v_now::text),true);
    update public.inspection_lists
    set data=v_inspection_data,updated_at=v_now
    where id=p_source_inspection_id;
  end if;

  return jsonb_build_object(
    'id',v_adjustment_id,
    'documentNo',v_document_no,
    'operatorName',v_operator_name,
    'postedAt',v_now,
    'lineCount',v_line_count,
    'balances',v_balances
  );
end;
$$;

revoke execute on function public.post_inventory_count_adjustment(bigint,text,text,text,jsonb) from public,anon;
grant execute on function public.post_inventory_count_adjustment(bigint,text,text,text,jsonb) to authenticated;

-- Keep both controlled reset modes complete after adding the immutable count ledger.
create or replace function public.admin_reset_store_data(
  p_mode text,
  p_actor_id uuid,
  p_confirmation text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_mode text:=lower(trim(coalesce(p_mode,'')));
  v_actor_username text;
  v_counts jsonb;
  v_epoch text:=gen_random_uuid()::text;
  v_table text;
  v_sequence text;
begin
  if v_mode not in ('documents','factory') then raise exception 'invalid reset mode'; end if;
  if p_confirmation <> (case when v_mode='factory' then 'CONFIRM_FACTORY_RESET' else 'CONFIRM_DOCUMENT_RESET' end) then
    raise exception 'invalid reset confirmation';
  end if;
  select profile.username into v_actor_username
  from public.profiles profile
  where profile.id=p_actor_id and profile.owner=true and profile.level=1;
  if v_actor_username is null then raise exception 'owner access required'; end if;

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
      +(select count(*) from public.standalone_tax_invoices)
      +(select count(*) from public.inventory_count_adjustments),
    'lots',(select count(*) from public.inventory_lots),
    'movements',(select count(*) from public.inventory_lot_movements),
    'products',(select count(*) from public.products),
    'users',(select count(*) from public.profiles)
  ) into v_counts;

  delete from public.sale_items;
  delete from public.inventory_count_adjustment_lines;
  delete from public.inventory_count_adjustments;
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

  insert into public.settings(key,value,updated_at)
  values('maintenance_epoch',jsonb_build_object('epoch',v_epoch,'mode',v_mode,'resetAt',clock_timestamp()),clock_timestamp())
  on conflict (key) do update set value=excluded.value,updated_at=excluded.updated_at;

  foreach v_table in array (case when v_mode='factory' then
    array['sale_items','inventory_count_adjustment_lines','inventory_lots','inventory_lot_movements','product_unit_changes','warehouses','categories','units','brands','products','contacts','sales_representatives']
  else
    array['sale_items','inventory_count_adjustment_lines','inventory_lots','inventory_lot_movements','product_unit_changes']
  end) loop
    v_sequence:=pg_get_serial_sequence('public.'||v_table,'id');
    if v_sequence is not null then execute format('select setval(%L,1,false)',v_sequence); end if;
  end loop;

  insert into private.store_reset_audit(mode,actor_id,actor_username,row_counts)
  values(v_mode,p_actor_id,v_actor_username,v_counts);
  return jsonb_build_object('ok',true,'mode',v_mode,'epoch',v_epoch,'resetAt',clock_timestamp(),'counts',v_counts);
end;
$$;

revoke execute on function public.admin_reset_store_data(text,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_reset_store_data(text,uuid,text) to service_role;
