-- Product returns must remove stock from the exact lot selected in the document.

create or replace function public.apply_product_return_lots(p_return_id text)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_row public.product_returns%rowtype;
  v_data jsonb;
  v_item jsonb;
  v_warehouse bigint;
  v_product bigint;
  v_lot_id bigint;
  v_qty numeric;
  v_factor numeric;
  v_line_key text;
  v_ord bigint;
  v_stock numeric;
  v_lot public.inventory_lots%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select * into v_row
  from public.product_returns
  where id=p_return_id
  for update;

  if not found then
    raise exception 'product return not found';
  end if;

  v_data:=coalesce(v_row.data,'{}'::jsonb);
  v_warehouse:=nullif(v_data->>'warehouseId','')::bigint;
  if v_warehouse is null then
    raise exception 'warehouse is required';
  end if;

  if not (select private.is_current_owner()) and not exists (
    select 1
    from public.profile_warehouse_access access
    where access.user_id=(select auth.uid())
      and access.warehouse_id=v_warehouse
      and access.can_manage_stock
  ) then
    raise exception 'stock management access denied';
  end if;

  if coalesce(v_data->>'lotAppliedAt','')<>'' then
    return jsonb_build_object('return',v_data,'alreadyApplied',true);
  end if;

  if coalesce((v_data->>'stockApplied')::boolean,false) then
    -- A completed legacy document was already reflected in the opening balance.
    return jsonb_build_object('return',v_data,'alreadyApplied',true,'legacy',true);
  end if;

  if jsonb_array_length(coalesce(v_data->'items','[]'::jsonb))=0 then
    raise exception 'product return has no items';
  end if;

  for v_item,v_ord in
    select value,ordinality
    from jsonb_array_elements(coalesce(v_data->'items','[]'::jsonb)) with ordinality
  loop
    v_product:=nullif(v_item->>'productId','')::bigint;
    v_lot_id:=nullif(v_item->>'lotId','')::bigint;
    v_factor:=greatest(coalesce(nullif(v_item->>'stockFactor','')::numeric,1),0);
    v_qty:=coalesce(nullif(v_item->>'qty','')::numeric,0)*v_factor;
    v_line_key:=coalesce(nullif(v_item->>'lineId',''),v_ord::text);

    if v_product is null or v_lot_id is null or v_qty<=0 then
      raise exception 'invalid product return item %',v_ord;
    end if;

    select * into v_lot
    from public.inventory_lots lot
    where lot.id=v_lot_id
      and lot.product_id=v_product
      and lot.warehouse_id=v_warehouse
      and lot.status<>'blocked'
    for update;

    if not found then
      raise exception 'selected lot is unavailable for product %',v_product;
    end if;
    if v_lot.quantity_base<v_qty then
      raise exception 'insufficient quantity in selected lot for product %',v_product;
    end if;

    update public.inventory_lots
    set quantity_base=quantity_base-v_qty,
        status=case when quantity_base-v_qty<=0 then 'exhausted' else 'active' end,
        updated_at=now()
    where id=v_lot.id;

    insert into public.inventory_lot_movements(
      lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
      reference_type,reference_id,reference_line_key,note
    ) values (
      v_lot.id,v_product,v_warehouse,'return_out',-v_qty,v_lot.quantity_base-v_qty,
      'product_return',p_return_id,v_line_key,'คืนสินค้าให้ผู้จำหน่าย'
    );

    v_stock:=private.refresh_inventory_balance_from_lots(v_product,v_warehouse);
  end loop;

  v_data:=jsonb_set(v_data,'{status}',to_jsonb('คืนเรียบร้อย'::text),true);
  v_data:=jsonb_set(v_data,'{stockApplied}','true'::jsonb,true);
  v_data:=jsonb_set(v_data,'{stockAppliedAt}',to_jsonb(now()::text),true);
  v_data:=jsonb_set(v_data,'{lotAppliedAt}',to_jsonb(now()::text),true);

  update public.product_returns
  set data=v_data,updated_at=now()
  where id=p_return_id;

  return jsonb_build_object('return',v_data,'alreadyApplied',false);
end;
$$;

revoke execute on function public.apply_product_return_lots(text) from public,anon;
grant execute on function public.apply_product_return_lots(text) to authenticated;

