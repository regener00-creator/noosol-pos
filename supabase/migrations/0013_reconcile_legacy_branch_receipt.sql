-- Move the one legacy branch receipt that was previously added to the catalog
-- product totals (head-office rows) into its documented destination warehouse.

do $$
declare v_receipt public.goods_receipts%rowtype; v_item jsonb; v_product_id bigint; v_source bigint; v_target bigint; v_qty numeric;
begin
  select * into v_receipt from public.goods_receipts where id='RI202608240002' for update;
  if not found or coalesce(v_receipt.data->>'inventoryMigratedAt','')<>'' then return; end if;
  v_target:=nullif(v_receipt.data->>'warehouseId','')::bigint;
  if v_target is null then return; end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_receipt.data->'items','[]'::jsonb)) loop
    v_product_id:=nullif(v_item->>'productId','')::bigint;
    v_qty:=coalesce(nullif(v_item->>'qty','')::numeric,0)*coalesce(nullif(v_item->>'stockFactor','')::numeric,1);
    select warehouse_id into v_source from public.products where id=v_product_id;
    if v_product_id is null or v_source is null or v_source=v_target or v_qty<=0 then continue; end if;

    insert into public.inventory_balances(warehouse_id,product_id,stock,updated_at)
    values(v_target,v_product_id,v_qty,now())
    on conflict (warehouse_id,product_id) do update
      set stock=public.inventory_balances.stock+excluded.stock,updated_at=now();
    update public.inventory_balances
    set stock=stock-v_qty,updated_at=now()
    where warehouse_id=v_source and product_id=v_product_id and stock>=v_qty;
    if not found then raise exception 'legacy receipt source stock is insufficient for product %',v_product_id; end if;
    update public.products set stock=stock-v_qty,updated_at=now()
    where id=v_product_id and warehouse_id=v_source;
  end loop;

  update public.goods_receipts
  set data=jsonb_set(data,'{inventoryMigratedAt}',to_jsonb(now()::text),true),updated_at=now()
  where id=v_receipt.id;
end;
$$;
