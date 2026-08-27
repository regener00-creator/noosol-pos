-- Keep checkout available when sellable Lots are short. Physical Lots stay
-- non-negative; the missing allocation is recorded on a zero-quantity system
-- Lot and remains part of the warehouse balance until a count reconciles it.

create or replace function private.inventory_lot_shortage_delta(
  p_product_id bigint,
  p_warehouse_id bigint
) returns numeric
language sql stable security definer set search_path=''
as $$
  select coalesce(sum(movement.quantity_delta),0)
  from public.inventory_lot_movements movement
  where movement.product_id=p_product_id
    and movement.warehouse_id=p_warehouse_id
    and movement.movement_type in (
      'sale_shortage','sale_shortage_void','stock_count_shortage_reconcile'
    )
$$;

create or replace function private.ensure_inventory_shortage_lot(
  p_product_id bigint,
  p_warehouse_id bigint
) returns bigint
language plpgsql security definer set search_path=''
as $$
declare v_lot_id bigint;
begin
  insert into public.inventory_lots(
    product_id,warehouse_id,internal_code,manufacturer_lot,expiry_date,
    quantity_base,unit_cost_base,received_at,source_type,source_id,
    source_line_key,status
  ) values (
    p_product_id,p_warehouse_id,'SHORTAGE-'||p_warehouse_id||'-'||p_product_id,
    null,null,0,0,clock_timestamp(),'sale_shortage',p_warehouse_id::text,
    p_product_id::text,'exhausted'
  )
  on conflict (source_type,source_id,source_line_key)
    where source_id is not null and source_line_key is not null
  do nothing;

  select lot.id into v_lot_id
  from public.inventory_lots lot
  where lot.source_type='sale_shortage'
    and lot.source_id=p_warehouse_id::text
    and lot.source_line_key=p_product_id::text;
  if v_lot_id is null then raise exception 'unable to create sale shortage Lot'; end if;
  return v_lot_id;
end;
$$;

revoke execute on function private.inventory_lot_shortage_delta(bigint,bigint) from public,anon,authenticated;
revoke execute on function private.ensure_inventory_shortage_lot(bigint,bigint) from public,anon,authenticated;

create or replace function private.refresh_inventory_balance_from_lots(
  p_product_id bigint,
  p_warehouse_id bigint
) returns numeric
language plpgsql security definer set search_path=''
as $$
declare v_lot_stock numeric; v_shortage numeric; v_stock numeric; v_expiry date;
begin
  select coalesce(sum(lot.quantity_base),0),
         min(lot.expiry_date) filter (where lot.quantity_base>0)
  into v_lot_stock,v_expiry
  from public.inventory_lots lot
  where lot.product_id=p_product_id and lot.warehouse_id=p_warehouse_id
    and lot.status<>'blocked' and lot.source_type<>'sale_shortage';

  v_shortage:=private.inventory_lot_shortage_delta(p_product_id,p_warehouse_id);
  v_stock:=v_lot_stock+v_shortage;

  insert into public.inventory_balances(warehouse_id,product_id,stock,expiry,updated_at)
  values(p_warehouse_id,p_product_id,v_stock,v_expiry,now())
  on conflict (warehouse_id,product_id) do update
    set stock=excluded.stock,expiry=excluded.expiry,updated_at=now();

  update public.products set stock=v_stock,updated_at=now()
  where id=p_product_id and warehouse_id=p_warehouse_id;
  return v_stock;
end;
$$;

revoke execute on function private.refresh_inventory_balance_from_lots(bigint,bigint) from public,anon,authenticated;

create or replace function public.post_sale_inventory_lots(
  p_sale_id text,
  p_warehouse_id bigint,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_item jsonb; v_ord bigint; v_product bigint; v_need numeric; v_take numeric; v_line_key text;
  v_lot record; v_shortage_lot public.inventory_lots%rowtype; v_shortage_lot_id bigint;
  v_shortage_before numeric; v_shortage_total numeric:=0;
  v_allocations jsonb:='[]'::jsonb; v_balances jsonb:='[]'::jsonb; v_stock numeric;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if p_sale_id is null or p_warehouse_id is null then raise exception 'sale and warehouse are required'; end if;
  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access access
    where access.user_id=(select auth.uid()) and access.warehouse_id=p_warehouse_id and access.can_sell
  ) then raise exception 'warehouse sale access denied'; end if;

  if exists (
    select 1 from public.inventory_lot_movements movement
    where movement.reference_type='sale' and movement.reference_id=p_sale_id
  ) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'lineKey',movement.reference_line_key,'productId',movement.product_id,'lotId',lot.id,
      'internalCode',lot.internal_code,'lotNumber',lot.manufacturer_lot,'expiry',lot.expiry_date,
      'baseQty',abs(movement.quantity_delta),'unitCostBase',lot.unit_cost_base,
      'pendingLot',(movement.movement_type='sale_shortage')
    ) order by movement.id),'[]'::jsonb)
    into v_allocations
    from public.inventory_lot_movements movement
    join public.inventory_lots lot on lot.id=movement.lot_id
    where movement.reference_type='sale' and movement.reference_id=p_sale_id;
    return jsonb_build_object('allocations',v_allocations,'alreadyApplied',true);
  end if;

  for v_item,v_ord in
    select value,ordinality from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality
  loop
    if coalesce((v_item->>'custom')::boolean,false) then continue; end if;
    v_product:=nullif(v_item->>'productId','')::bigint;
    v_need:=coalesce(nullif(v_item->>'baseQty','')::numeric,
      coalesce(nullif(v_item->>'qty','')::numeric,0)*coalesce(nullif(v_item->>'factor','')::numeric,1));
    v_line_key:=coalesce(nullif(v_item->>'lineKey',''),v_ord::text);
    if v_product is null or v_need<=0 then raise exception 'invalid sale item %',v_ord; end if;

    for v_lot in
      select * from public.inventory_lots lot
      where lot.product_id=v_product and lot.warehouse_id=p_warehouse_id
        and lot.status='active' and lot.quantity_base>0
        and lot.source_type<>'sale_shortage'
        and (lot.expiry_date is null or lot.expiry_date>=current_date)
      order by lot.expiry_date asc nulls last,lot.received_at,lot.id
      for update
    loop
      exit when v_need<=0;
      v_take:=least(v_need,v_lot.quantity_base);
      update public.inventory_lots
      set quantity_base=quantity_base-v_take,
          status=case when quantity_base-v_take<=0 then 'exhausted' else 'active' end,
          updated_at=now()
      where id=v_lot.id;
      insert into public.inventory_lot_movements(
        lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
        reference_type,reference_id,reference_line_key,note
      ) values (
        v_lot.id,v_product,p_warehouse_id,'sale',-v_take,v_lot.quantity_base-v_take,
        'sale',p_sale_id,v_line_key,'ขายสินค้า'
      );
      v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object(
        'lineKey',v_line_key,'productId',v_product,'lotId',v_lot.id,
        'internalCode',v_lot.internal_code,'lotNumber',v_lot.manufacturer_lot,
        'expiry',v_lot.expiry_date,'baseQty',v_take,
        'unitCostBase',v_lot.unit_cost_base,'pendingLot',false
      ));
      v_need:=v_need-v_take;
    end loop;

    if v_need>0 then
      v_shortage_lot_id:=private.ensure_inventory_shortage_lot(v_product,p_warehouse_id);
      select * into v_shortage_lot
      from public.inventory_lots lot where lot.id=v_shortage_lot_id for update;
      v_shortage_before:=private.inventory_lot_shortage_delta(v_product,p_warehouse_id);
      insert into public.inventory_lot_movements(
        lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
        reference_type,reference_id,reference_line_key,note
      ) values (
        v_shortage_lot_id,v_product,p_warehouse_id,'sale_shortage',-v_need,0,
        'sale',p_sale_id,v_line_key,'ขายสินค้าเกิน LOT — รอจัด LOT'
      );
      v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object(
        'lineKey',v_line_key,'productId',v_product,'lotId',v_shortage_lot_id,
        'internalCode',v_shortage_lot.internal_code,'lotNumber',null,'expiry',null,
        'baseQty',v_need,'unitCostBase',0,'pendingLot',true,
        'shortageBalanceAfter',v_shortage_before-v_need
      ));
      v_shortage_total:=v_shortage_total+v_need;
      v_need:=0;
    end if;

    v_stock:=private.refresh_inventory_balance_from_lots(v_product,p_warehouse_id);
    v_balances:=v_balances||jsonb_build_array(jsonb_build_object(
      'productId',v_product,'warehouseId',p_warehouse_id,'stock',v_stock
    ));
  end loop;
  return jsonb_build_object(
    'allocations',v_allocations,'balances',v_balances,
    'shortageBaseQty',v_shortage_total,'alreadyApplied',false
  );
end;
$$;

revoke execute on function public.post_sale_inventory_lots(text,bigint,jsonb) from public,anon,authenticated;

-- Clear any outstanding sale shortage in the same transaction immediately
-- before the existing count RPC applies the authoritative physical count.
create or replace function public.post_inventory_count_adjustment_with_shortages(
  p_warehouse_id bigint,
  p_reason text,
  p_note text,
  p_source_inspection_id text,
  p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_product bigint; v_shortage numeric; v_lot_id bigint;
  v_reconcile_ref text:='SC-PREP-'||replace(gen_random_uuid()::text,'-','');
  v_result jsonb; v_reconciled jsonb:='[]'::jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if p_warehouse_id is null then raise exception 'warehouse is required'; end if;
  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access access
    where access.user_id=(select auth.uid())
      and access.warehouse_id=p_warehouse_id and access.can_manage_stock
  ) then raise exception 'stock management access denied'; end if;
  if jsonb_typeof(coalesce(p_lines,'null'::jsonb))<>'array' then
    raise exception 'adjustment lines must be an array';
  end if;

  for v_product in
    select distinct nullif(value->>'productId','')::bigint
    from jsonb_array_elements(p_lines)
    where nullif(value->>'productId','') is not null
    order by 1
  loop
    perform lot.id from public.inventory_lots lot
    where lot.product_id=v_product and lot.warehouse_id=p_warehouse_id
    order by lot.id for update;
    v_shortage:=private.inventory_lot_shortage_delta(v_product,p_warehouse_id);
    if v_shortage < -0.000001 then
      v_lot_id:=private.ensure_inventory_shortage_lot(v_product,p_warehouse_id);
      perform lot.id from public.inventory_lots lot where lot.id=v_lot_id for update;
      insert into public.inventory_lot_movements(
        lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
        reference_type,reference_id,reference_line_key,note
      ) values (
        v_lot_id,v_product,p_warehouse_id,'stock_count_shortage_reconcile',abs(v_shortage),0,
        'stock_count_prepare',v_reconcile_ref,v_product::text,
        'เคลียร์ยอดขายที่รอจัด LOT ก่อนยืนยันตรวจนับ: '||btrim(p_reason)
      );
      v_reconciled:=v_reconciled||jsonb_build_array(jsonb_build_object(
        'productId',v_product,'quantityBase',abs(v_shortage)
      ));
    end if;
  end loop;

  v_result:=public.post_inventory_count_adjustment(
    p_warehouse_id,p_reason,p_note,p_source_inspection_id,p_lines
  );
  return v_result||jsonb_build_object('shortagesReconciled',v_reconciled);
end;
$$;

revoke execute on function public.post_inventory_count_adjustment(bigint,text,text,text,jsonb) from authenticated;
revoke execute on function public.post_inventory_count_adjustment_with_shortages(bigint,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.post_inventory_count_adjustment_with_shortages(bigint,text,text,text,jsonb) to authenticated;

create or replace function public.void_sale(
  p_sale_id text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_sale public.sales%rowtype; v_data jsonb; v_item jsonb; v_allocation jsonb;
  v_lot public.inventory_lots%rowtype; v_product bigint; v_warehouse bigint;
  v_lot_id bigint; v_quantity numeric; v_line_key text; v_ord bigint;
  v_reversible_items integer:=0; v_restored_allocations integer:=0;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_pending boolean;
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
  perform 1 from public.inventory_lots lot
  where lot.id in (
    select nullif(allocation->>'lotId','')::bigint
    from jsonb_array_elements(coalesce(v_data->'items','[]'::jsonb)) item
    cross join lateral jsonb_array_elements(coalesce(item->'lotAllocations','[]'::jsonb)) allocation
    where nullif(allocation->>'lotId','') is not null
  ) order by lot.id for update;

  for v_item,v_ord in
    select value,ordinality from jsonb_array_elements(coalesce(v_data->'items','[]'::jsonb)) with ordinality
  loop
    if coalesce((v_item->>'custom')::boolean,false) or nullif(v_item->>'productId','') is null then continue; end if;
    v_reversible_items:=v_reversible_items+1;
    if jsonb_array_length(coalesce(v_item->'lotAllocations','[]'::jsonb))=0 then
      raise exception 'sale item % has no reversible Lot allocation',v_ord;
    end if;
    v_line_key:=coalesce(nullif(v_item->>'lineKey',''),v_ord::text);
    v_product:=(v_item->>'productId')::bigint;
    v_warehouse:=coalesce(nullif(v_data->>'warehouseId','')::bigint,nullif(v_item->>'warehouseId','')::bigint);
    for v_allocation in select value from jsonb_array_elements(v_item->'lotAllocations')
    loop
      v_lot_id:=nullif(v_allocation->>'lotId','')::bigint;
      v_quantity:=coalesce(nullif(v_allocation->>'baseQty','')::numeric,0);
      v_pending:=coalesce((v_allocation->>'pendingLot')::boolean,false);
      if v_lot_id is null or v_quantity<=0 then raise exception 'invalid sale Lot allocation'; end if;
      select * into v_lot from public.inventory_lots where id=v_lot_id for update;
      if not found or v_lot.product_id<>v_product or v_lot.warehouse_id<>v_warehouse then
        raise exception 'sale Lot allocation no longer matches inventory';
      end if;
      if v_pending or v_lot.source_type='sale_shortage' then
        insert into public.inventory_lot_movements(
          lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
          reference_type,reference_id,reference_line_key,note
        ) values (
          v_lot_id,v_product,v_warehouse,'sale_shortage_void',v_quantity,0,
          'sale_void',p_sale_id,v_line_key||':'||v_lot_id::text,'ยกเลิกยอดขายที่รอจัด LOT: '||v_reason
        );
      else
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
      end if;
      v_restored_allocations:=v_restored_allocations+1;
      perform private.refresh_inventory_balance_from_lots(v_product,v_warehouse);
    end loop;
  end loop;

  if v_reversible_items>0 and v_restored_allocations=0 then raise exception 'sale has no reversible Lot allocation'; end if;
  v_data:=jsonb_set(v_data,'{status}',to_jsonb('void'::text),true);
  v_data:=jsonb_set(v_data,'{voidReason}',to_jsonb(v_reason),true);
  v_data:=jsonb_set(v_data,'{voidedAt}',to_jsonb(clock_timestamp()::text),true);
  v_data:=jsonb_set(v_data,'{voidedBy}',to_jsonb((select auth.uid())::text),true);
  update public.sales set status='void',data=v_data where id=p_sale_id;
  return jsonb_build_object('sale',v_data,'alreadyVoided',false,'restoredAllocations',v_restored_allocations);
end;
$$;

revoke execute on function public.void_sale(text,text) from public,anon;
grant execute on function public.void_sale(text,text) to authenticated;

comment on function public.post_sale_inventory_lots(text,bigint,jsonb)
is 'Allocates sale stock by FEFO and records any missing quantity as a reversible pending Lot allocation.';
comment on function public.post_inventory_count_adjustment_with_shortages(bigint,text,text,text,jsonb)
is 'Posts an authoritative stock count and atomically reconciles any pending sale Lot shortage first.';
