-- Make checkout, Lot posting and the sale record one transaction. Completed
-- sales are never deleted; voiding restores the exact Lots recorded on sale.
-- Store backups can include and restore the authoritative Lot ledger.

alter table public.sales
  add column if not exists checkout_request_id uuid;

create unique index if not exists idx_sales_checkout_request
on public.sales(checkout_request_id)
where checkout_request_id is not null;

create table if not exists private.sale_document_sequences (
  sale_date date not null,
  prefix text not null,
  last_value bigint not null default 0,
  primary key (sale_date,prefix)
);

revoke all on private.sale_document_sequences from public,anon,authenticated;

create or replace function private.next_sale_reference(
  p_sale_date date,
  p_prefix text
) returns text
language plpgsql security definer set search_path=''
as $$
declare
  v_prefix text:=upper(regexp_replace(coalesce(p_prefix,'RE'),'[^A-Za-z0-9]','','g'));
  v_sequence bigint;
begin
  if v_prefix='' then v_prefix:='RE'; end if;
  v_prefix:=left(v_prefix,8);
  insert into private.sale_document_sequences(sale_date,prefix,last_value)
  values(p_sale_date,v_prefix,1)
  on conflict (sale_date,prefix) do update
    set last_value=private.sale_document_sequences.last_value+1
  returning last_value into v_sequence;
  return v_prefix||to_char(p_sale_date,'YYYYMMDD')||lpad(v_sequence::text,4,'0');
end;
$$;

revoke execute on function private.next_sale_reference(date,text) from public,anon,authenticated;

create or replace function public.complete_sale(
  p_request_id uuid,
  p_ref_prefix text,
  p_warehouse_id bigint,
  p_sale jsonb,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_existing public.sales%rowtype;
  v_request_id uuid:=p_request_id;
  v_now timestamptz:=clock_timestamp();
  v_sale_date date:=(v_now at time zone 'Asia/Bangkok')::date;
  v_sale_id text;
  v_sale_ref text;
  v_posting jsonb;
  v_post_items jsonb;
  v_sale_data jsonb:=coalesce(p_sale,'{}'::jsonb);
  v_item jsonb;
  v_items jsonb:='[]'::jsonb;
  v_line_allocations jsonb;
  v_line_key text;
  v_ord bigint;
  v_member text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if v_request_id is null or p_warehouse_id is null then
    raise exception 'checkout request and warehouse are required';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then
    raise exception 'sale items are required';
  end if;

  -- Serialise retries of the same browser request. A committed checkout whose
  -- HTTP response was lost returns the existing sale instead of selling twice.
  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text,0));
  select * into v_existing
  from public.sales
  where checkout_request_id=v_request_id;
  if found then
    return jsonb_build_object('sale',coalesce(v_existing.data,'{}'::jsonb),'alreadyCompleted',true);
  end if;

  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access access
    where access.user_id=(select auth.uid())
      and access.warehouse_id=p_warehouse_id
      and access.can_sell
  ) then raise exception 'warehouse sale access denied'; end if;

  v_sale_id:='INV-'||replace(v_request_id::text,'-','');
  -- Lock products/Lots in one deterministic order so two checkouts whose
  -- carts were scanned in a different order cannot deadlock each other.
  select jsonb_agg(value order by
    coalesce(nullif(value->>'productId','')::bigint,9223372036854775807),
    coalesce(nullif(value->>'lineKey',''),ordinality::text),ordinality)
  into v_post_items
  from jsonb_array_elements(p_items) with ordinality;
  v_posting:=public.post_sale_inventory_lots(v_sale_id,p_warehouse_id,v_post_items);
  v_sale_ref:=private.next_sale_reference(v_sale_date,p_ref_prefix);

  for v_item,v_ord in
    select value,ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_line_key:=coalesce(nullif(v_item->>'lineKey',''),v_ord::text);
    select coalesce(jsonb_agg(allocation order by allocation_order),'[]'::jsonb)
    into v_line_allocations
    from (
      select value as allocation,ordinality as allocation_order
      from jsonb_array_elements(coalesce(v_posting->'allocations','[]'::jsonb)) with ordinality
      where value->>'lineKey'=v_line_key
    ) matched;
    if not coalesce((v_item->>'custom')::boolean,false) then
      v_item:=jsonb_set(v_item,'{lotAllocations}',v_line_allocations,true);
    end if;
    v_items:=v_items||jsonb_build_array(v_item);
  end loop;

  v_sale_data:=jsonb_set(v_sale_data,'{id}',to_jsonb(v_sale_id),true);
  v_sale_data:=jsonb_set(v_sale_data,'{ref}',to_jsonb(v_sale_ref),true);
  v_sale_data:=jsonb_set(v_sale_data,'{date}',to_jsonb(v_sale_date::text),true);
  v_sale_data:=jsonb_set(v_sale_data,'{time}',to_jsonb(to_char(v_now at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI:SS')),true);
  v_sale_data:=jsonb_set(v_sale_data,'{warehouseId}',to_jsonb(p_warehouse_id),true);
  v_sale_data:=jsonb_set(v_sale_data,'{status}',to_jsonb('done'::text),true);
  v_sale_data:=jsonb_set(v_sale_data,'{items}',v_items,true);
  v_sale_data:=jsonb_set(v_sale_data,'{checkoutRequestId}',to_jsonb(v_request_id::text),true);

  v_member:=case
    when jsonb_typeof(v_sale_data->'member')='object' then nullif(v_sale_data->'member'->>'name','')
    else nullif(v_sale_data->>'member','')
  end;

  insert into public.sales(
    id,ref,sale_date,sale_time,cashier,member,status,pay_method,
    discount,vat,fee,cost_total,gross_profit,cash_received,cash_change,total,
    data,checkout_request_id
  ) values (
    v_sale_id,v_sale_ref,v_sale_date,v_now,nullif(v_sale_data->>'cashier',''),v_member,'done',nullif(v_sale_data->>'payMethod',''),
    coalesce(nullif(v_sale_data->>'discount','')::numeric,0),
    coalesce(nullif(v_sale_data->>'vat','')::numeric,0),
    coalesce(nullif(v_sale_data->>'fee','')::numeric,0),
    coalesce(nullif(v_sale_data->>'costTotal','')::numeric,0),
    coalesce(nullif(v_sale_data->>'grossProfit','')::numeric,0),
    coalesce(nullif(v_sale_data->>'cashReceived','')::numeric,0),
    coalesce(nullif(v_sale_data->>'cashChange','')::numeric,0),
    coalesce(nullif(v_sale_data->>'total','')::numeric,0),
    v_sale_data,v_request_id
  );

  return jsonb_build_object(
    'sale',v_sale_data,
    'allocations',coalesce(v_posting->'allocations','[]'::jsonb),
    'alreadyCompleted',false
  );
end;
$$;

create or replace function public.void_sale(
  p_sale_id text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_sale public.sales%rowtype;
  v_data jsonb;
  v_item jsonb;
  v_allocation jsonb;
  v_lot public.inventory_lots%rowtype;
  v_product bigint;
  v_warehouse bigint;
  v_lot_id bigint;
  v_quantity numeric;
  v_line_key text;
  v_ord bigint;
  v_reversible_items integer:=0;
  v_restored_allocations integer:=0;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner access required'; end if;
  if v_reason is null then raise exception 'void reason is required'; end if;

  select * into v_sale from public.sales where id=p_sale_id for update;
  if not found then raise exception 'sale not found'; end if;
  if v_sale.status='void' then
    return jsonb_build_object('sale',coalesce(v_sale.data,'{}'::jsonb),'alreadyVoided',true);
  end if;
  if v_sale.status<>'done' then raise exception 'only completed sales can be voided'; end if;
  if v_sale.data ? 'fullTaxInvoice' or v_sale.data ? 'shortReceiptMeta' then
    raise exception 'issued sales documents must be handled before voiding';
  end if;

  v_data:=coalesce(v_sale.data,'{}'::jsonb);
  -- A sale can span several Lots. Pre-lock every affected Lot in ascending ID
  -- order so simultaneous voids use the same lock order.
  perform 1
  from public.inventory_lots lot
  where lot.id in (
    select nullif(allocation->>'lotId','')::bigint
    from jsonb_array_elements(coalesce(v_data->'items','[]'::jsonb)) item
    cross join lateral jsonb_array_elements(coalesce(item->'lotAllocations','[]'::jsonb)) allocation
    where nullif(allocation->>'lotId','') is not null
  )
  order by lot.id
  for update;
  for v_item,v_ord in
    select value,ordinality
    from jsonb_array_elements(coalesce(v_data->'items','[]'::jsonb)) with ordinality
  loop
    if coalesce((v_item->>'custom')::boolean,false) or nullif(v_item->>'productId','') is null then
      continue;
    end if;
    v_reversible_items:=v_reversible_items+1;
    if jsonb_array_length(coalesce(v_item->'lotAllocations','[]'::jsonb))=0 then
      raise exception 'sale item % has no reversible Lot allocation',v_ord;
    end if;
    v_line_key:=coalesce(nullif(v_item->>'lineKey',''),v_ord::text);
    v_product:=(v_item->>'productId')::bigint;
    v_warehouse:=coalesce(nullif(v_data->>'warehouseId','')::bigint,nullif(v_item->>'warehouseId','')::bigint);
    for v_allocation in
      select value from jsonb_array_elements(v_item->'lotAllocations')
    loop
      v_lot_id:=nullif(v_allocation->>'lotId','')::bigint;
      v_quantity:=coalesce(nullif(v_allocation->>'baseQty','')::numeric,0);
      if v_lot_id is null or v_quantity<=0 then raise exception 'invalid sale Lot allocation'; end if;
      select * into v_lot from public.inventory_lots where id=v_lot_id for update;
      if not found or v_lot.product_id<>v_product or v_lot.warehouse_id<>v_warehouse then
        raise exception 'sale Lot allocation no longer matches inventory';
      end if;
      update public.inventory_lots
      set quantity_base=quantity_base+v_quantity,
          status=case when status='blocked' then 'blocked' else 'active' end,
          updated_at=now()
      where id=v_lot_id;
      insert into public.inventory_lot_movements(
        lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
        reference_type,reference_id,reference_line_key,note
      ) values (
        v_lot_id,v_product,v_warehouse,'sale_void',v_quantity,v_lot.quantity_base+v_quantity,
        'sale_void',p_sale_id,v_line_key||':'||v_lot_id::text,'ยกเลิกบิล: '||v_reason
      );
      v_restored_allocations:=v_restored_allocations+1;
      perform private.refresh_inventory_balance_from_lots(v_product,v_warehouse);
    end loop;
  end loop;

  if v_reversible_items>0 and v_restored_allocations=0 then
    raise exception 'sale has no reversible Lot allocation';
  end if;

  v_data:=jsonb_set(v_data,'{status}',to_jsonb('void'::text),true);
  v_data:=jsonb_set(v_data,'{voidReason}',to_jsonb(v_reason),true);
  v_data:=jsonb_set(v_data,'{voidedAt}',to_jsonb(clock_timestamp()::text),true);
  v_data:=jsonb_set(v_data,'{voidedBy}',to_jsonb((select auth.uid())::text),true);
  update public.sales set status='void',data=v_data where id=p_sale_id;
  return jsonb_build_object('sale',v_data,'alreadyVoided',false,'restoredAllocations',v_restored_allocations);
end;
$$;

create or replace function public.export_store_inventory_backup()
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_lots jsonb; v_movements jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner access required'; end if;
  select coalesce(jsonb_agg(to_jsonb(lot) order by lot.id),'[]'::jsonb)
    into v_lots from public.inventory_lots lot;
  select coalesce(jsonb_agg(to_jsonb(movement) order by movement.id),'[]'::jsonb)
    into v_movements from public.inventory_lot_movements movement;
  return jsonb_build_object('lots',v_lots,'movements',v_movements,'exportedAt',clock_timestamp());
end;
$$;

create or replace function public.restore_store_inventory_backup(
  p_lots jsonb,
  p_movements jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_pair record;
  v_lot_count bigint;
  v_movement_count bigint;
  v_max_lot_id bigint;
  v_max_movement_id bigint;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner access required'; end if;
  if jsonb_typeof(coalesce(p_lots,'null'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_movements,'null'::jsonb))<>'array' then
    raise exception 'invalid inventory backup';
  end if;

  -- This function is one database transaction: an invalid foreign key or
  -- movement rolls the whole inventory restore back to its previous state.
  delete from public.inventory_lot_movements;
  delete from public.inventory_lots;

  insert into public.inventory_lots(
    id,product_id,warehouse_id,internal_code,manufacturer_lot,expiry_date,
    quantity_base,unit_cost_base,received_at,source_type,source_id,source_line_key,
    status,created_by,created_at,updated_at
  )
  select id,product_id,warehouse_id,internal_code,manufacturer_lot,expiry_date,
    quantity_base,unit_cost_base,received_at,source_type,source_id,source_line_key,
    status,created_by,created_at,updated_at
  from jsonb_to_recordset(p_lots) as lot(
    id bigint,product_id bigint,warehouse_id bigint,internal_code text,
    manufacturer_lot text,expiry_date date,quantity_base numeric,unit_cost_base numeric,
    received_at timestamptz,source_type text,source_id text,source_line_key text,
    status text,created_by uuid,created_at timestamptz,updated_at timestamptz
  );

  insert into public.inventory_lot_movements(
    id,lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
    reference_type,reference_id,reference_line_key,note,created_by,created_at
  ) overriding system value
  select id,lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
    reference_type,reference_id,reference_line_key,note,created_by,created_at
  from jsonb_to_recordset(p_movements) as movement(
    id bigint,lot_id bigint,product_id bigint,warehouse_id bigint,movement_type text,
    quantity_delta numeric,balance_after numeric,reference_type text,reference_id text,
    reference_line_key text,note text,created_by uuid,created_at timestamptz
  );

  select count(*),max(id) into v_lot_count,v_max_lot_id from public.inventory_lots;
  select count(*),max(id) into v_movement_count,v_max_movement_id from public.inventory_lot_movements;
  perform setval(pg_get_serial_sequence('public.inventory_lots','id'),coalesce(v_max_lot_id,1),v_lot_count>0);
  perform setval(pg_get_serial_sequence('public.inventory_lot_movements','id'),coalesce(v_max_movement_id,1),v_movement_count>0);

  update public.inventory_balances set stock=0,expiry=null,updated_at=now();
  update public.products product
    set stock=0,updated_at=now()
  where product.warehouse_id is not null;
  for v_pair in
    select distinct product_id,warehouse_id from public.inventory_lots
  loop
    perform private.refresh_inventory_balance_from_lots(v_pair.product_id,v_pair.warehouse_id);
  end loop;

  return jsonb_build_object('lots',v_lot_count,'movements',v_movement_count,'restoredAt',clock_timestamp());
end;
$$;

revoke execute on function public.complete_sale(uuid,text,bigint,jsonb,jsonb) from public,anon;
revoke execute on function public.void_sale(text,text) from public,anon;
revoke execute on function public.export_store_inventory_backup() from public,anon;
revoke execute on function public.restore_store_inventory_backup(jsonb,jsonb) from public,anon;
grant execute on function public.complete_sale(uuid,text,bigint,jsonb,jsonb) to authenticated;
grant execute on function public.void_sale(text,text) to authenticated;
grant execute on function public.export_store_inventory_backup() to authenticated;
grant execute on function public.restore_store_inventory_backup(jsonb,jsonb) to authenticated;
