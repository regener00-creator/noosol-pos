-- Correct the Lot recorded on a completed sale without changing total stock.
create or replace function public.correct_sale_lot_allocation(
  p_sale_id text,
  p_item_index integer,
  p_from_lot_id bigint,
  p_to_lot_id bigint,
  p_quantity_base numeric,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_sale public.sales%rowtype;
  v_from public.inventory_lots%rowtype;
  v_to public.inventory_lots%rowtype;
  v_data jsonb;
  v_items jsonb;
  v_item jsonb;
  v_alloc jsonb;
  v_new_allocs jsonb:='[]'::jsonb;
  v_log jsonb;
  v_product bigint;
  v_warehouse bigint;
  v_line_key text;
  v_source_allocated numeric:=0;
  v_remaining numeric:=coalesce(p_quantity_base,0);
  v_alloc_qty numeric;
  v_take numeric;
  v_target_found boolean:=false;
  v_correction_id text:='LC-'||replace(gen_random_uuid()::text,'-','');
  v_reference_line_key text;
  v_stock numeric;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner access required'; end if;
  if coalesce(p_sale_id,'')='' or coalesce(p_item_index,-1)<0 then raise exception 'sale item is required'; end if;
  if p_from_lot_id is null or p_to_lot_id is null or p_from_lot_id=p_to_lot_id then raise exception 'different source and actual Lots are required'; end if;
  if coalesce(p_quantity_base,0)<=0 then raise exception 'correction quantity must be positive'; end if;

  select * into v_sale from public.sales where id=p_sale_id for update;
  if not found then raise exception 'sale not found'; end if;
  if v_sale.status<>'done' then raise exception 'only completed sales can be corrected'; end if;

  v_data:=coalesce(v_sale.data,'{}'::jsonb);
  v_items:=coalesce(v_data->'items','[]'::jsonb);
  if jsonb_typeof(v_items)<>'array' or p_item_index>=jsonb_array_length(v_items) then raise exception 'sale item not found'; end if;
  v_item:=v_items->p_item_index;
  v_product:=nullif(v_item->>'productId','')::bigint;
  v_warehouse:=coalesce(nullif(v_data->>'warehouseId','')::bigint,nullif(v_item->>'warehouseId','')::bigint);
  v_line_key:=coalesce(nullif(v_item->>'lineKey',''),(p_item_index+1)::text);
  if v_product is null or v_warehouse is null then raise exception 'sale product or warehouse is missing'; end if;

  perform lot.id from public.inventory_lots lot
  where lot.id in (p_from_lot_id,p_to_lot_id)
  order by lot.id
  for update;
  select * into v_from from public.inventory_lots where id=p_from_lot_id;
  select * into v_to from public.inventory_lots where id=p_to_lot_id;
  if v_from.id is null or v_to.id is null then raise exception 'Lot not found'; end if;
  if v_from.product_id<>v_product or v_to.product_id<>v_product then raise exception 'Lots do not match the sale product'; end if;
  if v_from.warehouse_id<>v_warehouse or v_to.warehouse_id<>v_warehouse then raise exception 'Lots do not match the sale warehouse'; end if;
  if v_to.status='blocked' then raise exception 'actual Lot is blocked'; end if;
  if v_to.quantity_base<p_quantity_base then raise exception 'actual Lot stock is insufficient'; end if;

  select coalesce(sum(coalesce(nullif(allocation->>'baseQty','')::numeric,0)),0)
  into v_source_allocated
  from jsonb_array_elements(coalesce(v_item->'lotAllocations','[]'::jsonb)) allocation
  where nullif(allocation->>'lotId','')::bigint=p_from_lot_id;
  if v_source_allocated<p_quantity_base then raise exception 'correction exceeds the Lot quantity recorded on this sale'; end if;

  for v_alloc in select value from jsonb_array_elements(coalesce(v_item->'lotAllocations','[]'::jsonb)) loop
    v_alloc_qty:=coalesce(nullif(v_alloc->>'baseQty','')::numeric,0);
    if nullif(v_alloc->>'lotId','')::bigint=p_from_lot_id and v_remaining>0 then
      v_take:=least(v_remaining,v_alloc_qty);
      v_alloc_qty:=v_alloc_qty-v_take;
      v_remaining:=v_remaining-v_take;
      if v_alloc_qty>0 then
        v_new_allocs:=v_new_allocs||jsonb_build_array(jsonb_set(v_alloc,'{baseQty}',to_jsonb(v_alloc_qty),true));
      end if;
    elsif nullif(v_alloc->>'lotId','')::bigint=p_to_lot_id and not v_target_found then
      v_new_allocs:=v_new_allocs||jsonb_build_array(jsonb_set(v_alloc,'{baseQty}',to_jsonb(v_alloc_qty+p_quantity_base),true));
      v_target_found:=true;
    else
      v_new_allocs:=v_new_allocs||jsonb_build_array(v_alloc);
    end if;
  end loop;
  if v_remaining>0 then raise exception 'sale allocation changed while correcting'; end if;
  if not v_target_found then
    v_new_allocs:=v_new_allocs||jsonb_build_array(jsonb_build_object(
      'lineKey',v_line_key,'productId',v_product,'lotId',v_to.id,'internalCode',v_to.internal_code,
      'lotNumber',v_to.manufacturer_lot,'expiry',v_to.expiry_date,'baseQty',p_quantity_base,'unitCostBase',v_to.unit_cost_base
    ));
  end if;

  update public.inventory_lots
  set quantity_base=quantity_base+p_quantity_base,
      status=case when status='blocked' then 'blocked' else 'active' end,
      updated_at=now()
  where id=v_from.id;
  update public.inventory_lots
  set quantity_base=quantity_base-p_quantity_base,
      status=case when quantity_base-p_quantity_base<=0 then 'exhausted' else 'active' end,
      updated_at=now()
  where id=v_to.id;

  v_reference_line_key:=v_line_key||':'||v_correction_id;
  insert into public.inventory_lot_movements(lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,reference_type,reference_id,reference_line_key,note)
  values(v_from.id,v_product,v_warehouse,'sale_lot_correction_restore',p_quantity_base,v_from.quantity_base+p_quantity_base,'sale_lot_correction',p_sale_id,v_reference_line_key,'คืนยอด LOT ที่ระบบตัดผิด');
  insert into public.inventory_lot_movements(lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,reference_type,reference_id,reference_line_key,note)
  values(v_to.id,v_product,v_warehouse,'sale_lot_correction_out',-p_quantity_base,v_to.quantity_base-p_quantity_base,'sale_lot_correction',p_sale_id,v_reference_line_key,'ตัด LOT ที่ขายจริง');

  v_item:=jsonb_set(v_item,'{lotAllocations}',v_new_allocs,true);
  v_items:=jsonb_set(v_items,array[p_item_index::text],v_item,false);
  v_data:=jsonb_set(v_data,'{items}',v_items,true);
  v_log:=jsonb_build_object(
    'id',v_correction_id,'at',now(),'createdBy',(select auth.uid()),'itemIndex',p_item_index,'lineKey',v_line_key,
    'productId',v_product,'productName',coalesce(v_item->>'name',''),'quantityBase',p_quantity_base,
    'quantity',p_quantity_base/nullif(coalesce(nullif(v_item->>'factor','')::numeric,1),0),'unit',coalesce(v_item->>'unit','หน่วยหลัก'),
    'fromLot',jsonb_build_object('lotId',v_from.id,'internalCode',v_from.internal_code,'lotNumber',v_from.manufacturer_lot,'expiry',v_from.expiry_date),
    'toLot',jsonb_build_object('lotId',v_to.id,'internalCode',v_to.internal_code,'lotNumber',v_to.manufacturer_lot,'expiry',v_to.expiry_date),
    'reason',nullif(btrim(coalesce(p_reason,'')),'')
  );
  v_data:=jsonb_set(v_data,'{lotCorrectionLog}',coalesce(v_data->'lotCorrectionLog','[]'::jsonb)||jsonb_build_array(v_log),true);
  update public.sales set data=v_data where id=p_sale_id;
  v_stock:=private.refresh_inventory_balance_from_lots(v_product,v_warehouse);
  return jsonb_build_object('sale',v_data,'correction',v_log,'stock',v_stock);
end;
$$;

revoke execute on function public.correct_sale_lot_allocation(text,integer,bigint,bigint,numeric,text) from public,anon;
grant execute on function public.correct_sale_lot_allocation(text,integer,bigint,bigint,numeric,text) to authenticated;
