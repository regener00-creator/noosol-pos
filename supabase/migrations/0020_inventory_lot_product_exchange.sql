-- Make product exchanges part of the lot ledger. Outgoing products are
-- deducted FEFO (expired lots are allowed because these are often the items
-- being returned to a supplier); incoming products create a new traceable lot.

create or replace function public.apply_product_exchange_status(
  p_exchange_id text,
  p_next_status text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_row public.product_exchanges%rowtype; v_data jsonb; v_item jsonb;
  v_product bigint; v_warehouse bigint; v_qty numeric; v_need numeric; v_take numeric;
  v_expiry date; v_lot_number text; v_line_key text; v_lot_id bigint; v_ord bigint;
  v_outgoing boolean; v_incoming boolean; v_lot record; v_cost numeric; v_stock numeric;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner permission required'; end if;
  if p_next_status not in ('ส่งไปเปลี่ยนแล้ว','รับสินค้ากลับแล้ว') then
    raise exception 'invalid product exchange status';
  end if;

  select * into v_row from public.product_exchanges where id=p_exchange_id for update;
  if not found then raise exception 'product exchange document not found'; end if;
  v_data:=coalesce(v_row.data,'{}'::jsonb);
  v_warehouse:=nullif(v_data->>'warehouseId','')::bigint;
  if v_warehouse is null then raise exception 'warehouse is required'; end if;
  v_outgoing:=coalesce((v_data->>'outgoingApplied')::boolean,false);
  v_incoming:=coalesce((v_data->>'incomingApplied')::boolean,false);
  if v_incoming then return jsonb_build_object('exchange',v_data); end if;

  if not v_outgoing then
    for v_item,v_ord in
      select value,ordinality from jsonb_array_elements(coalesce(v_data->'outgoingItems','[]'::jsonb)) with ordinality
    loop
      v_product:=nullif(v_item->>'pid','')::bigint;
      v_qty:=coalesce(nullif(v_item->>'baseQty','')::numeric,
        coalesce(nullif(v_item->>'qty','')::numeric,0)*coalesce(nullif(v_item->>'factor','')::numeric,1));
      v_line_key:='out:'||coalesce(nullif(v_item->>'lineId',''),v_ord::text);
      if v_product is null or v_qty<=0 then raise exception 'invalid outgoing item %',v_ord; end if;
      v_need:=v_qty;
      for v_lot in
        select lot.* from public.inventory_lots lot
        where lot.product_id=v_product and lot.warehouse_id=v_warehouse
          and lot.status<>'blocked' and lot.quantity_base>0
        order by lot.expiry_date asc nulls last,lot.received_at asc,lot.id asc
        for update
      loop
        exit when v_need<=0;
        v_take:=least(v_need,v_lot.quantity_base);
        update public.inventory_lots
        set quantity_base=quantity_base-v_take,
            status=case when quantity_base-v_take<=0 then 'exhausted' else status end,
            updated_at=now()
        where id=v_lot.id;
        insert into public.inventory_lot_movements(
          lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
          reference_type,reference_id,reference_line_key,note
        ) values (
          v_lot.id,v_product,v_warehouse,'exchange_out',-v_take,v_lot.quantity_base-v_take,
          'product_exchange',p_exchange_id,v_line_key,'ส่งสินค้าไปเปลี่ยน'
        ) on conflict do nothing;
        v_need:=v_need-v_take;
      end loop;
      if v_need>0 then raise exception 'insufficient lot stock for product %',v_product; end if;
      v_stock:=private.refresh_inventory_balance_from_lots(v_product,v_warehouse);
    end loop;
    v_outgoing:=true;
    v_data:=jsonb_set(v_data,'{outgoingApplied}','true'::jsonb,true);
    v_data:=jsonb_set(v_data,'{outgoingAppliedAt}',to_jsonb(now()::text),true);
  end if;

  if p_next_status='รับสินค้ากลับแล้ว' and not v_incoming then
    if jsonb_array_length(coalesce(v_data->'incomingItems','[]'::jsonb))=0 then
      raise exception 'incoming items are required';
    end if;
    for v_item,v_ord in
      select value,ordinality from jsonb_array_elements(coalesce(v_data->'incomingItems','[]'::jsonb)) with ordinality
    loop
      v_product:=nullif(v_item->>'pid','')::bigint;
      v_qty:=coalesce(nullif(v_item->>'baseQty','')::numeric,
        coalesce(nullif(v_item->>'qty','')::numeric,0)*coalesce(nullif(v_item->>'factor','')::numeric,1));
      v_expiry:=case when coalesce(v_item->>'expiry','')~'^\d{4}-\d{2}-\d{2}$' then (v_item->>'expiry')::date else null end;
      v_lot_number:=nullif(btrim(coalesce(v_item->>'lotNumber','')),'');
      v_line_key:='in:'||coalesce(nullif(v_item->>'lineId',''),v_ord::text);
      if v_product is null or v_qty<=0 or v_expiry is null then raise exception 'invalid incoming item %',v_ord; end if;
      select greatest(coalesce(product.cost,0),0) into v_cost from public.products product where product.id=v_product;
      v_lot_id:=private.create_inventory_lot(
        v_product,v_warehouse,v_qty,v_lot_number,v_expiry,v_cost,
        'product_exchange',p_exchange_id,v_line_key,now()
      );
      insert into public.inventory_lot_movements(
        lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
        reference_type,reference_id,reference_line_key,note
      )
      select v_lot_id,v_product,v_warehouse,'exchange_in',v_qty,lot.quantity_base,
        'product_exchange',p_exchange_id,v_line_key,'รับสินค้ากลับจากการเปลี่ยน'
      from public.inventory_lots lot where lot.id=v_lot_id
      on conflict do nothing;
      v_stock:=private.refresh_inventory_balance_from_lots(v_product,v_warehouse);
    end loop;
    v_incoming:=true;
    v_data:=jsonb_set(v_data,'{incomingApplied}','true'::jsonb,true);
    v_data:=jsonb_set(v_data,'{incomingAppliedAt}',to_jsonb(now()::text),true);
  end if;

  v_data:=jsonb_set(v_data,'{status}',to_jsonb(p_next_status),true);
  v_data:=jsonb_set(v_data,'{updatedAt}',to_jsonb(now()::text),true);
  update public.product_exchanges set data=v_data,updated_at=now() where id=p_exchange_id;
  return jsonb_build_object('exchange',v_data);
end;
$$;

revoke execute on function public.apply_product_exchange_status(text,text) from public,anon;
grant execute on function public.apply_product_exchange_status(text,text) to authenticated;

-- Always compare stock edits with the lot total. This also safely normalizes
-- any legacy negative balance to zero before applying the requested target.
create or replace function public.set_inventory_stock(
  p_product_id bigint, p_warehouse_id bigint, p_stock numeric
) returns numeric
language plpgsql security definer set search_path=''
as $$
declare v_current numeric; v_target numeric:=coalesce(p_stock,0);
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if v_target<0 then raise exception 'stock must not be negative'; end if;
  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access access
    where access.user_id=(select auth.uid()) and access.warehouse_id=p_warehouse_id and access.can_manage_stock
  ) then raise exception 'stock management access denied'; end if;
  v_current:=private.refresh_inventory_balance_from_lots(p_product_id,p_warehouse_id);
  if v_target=coalesce(v_current,0) then return v_target; end if;
  return public.adjust_inventory_stock(p_product_id,p_warehouse_id,v_target-coalesce(v_current,0));
end;
$$;

revoke execute on function public.set_inventory_stock(bigint,bigint,numeric) from public,anon;
grant execute on function public.set_inventory_stock(bigint,bigint,numeric) to authenticated;
