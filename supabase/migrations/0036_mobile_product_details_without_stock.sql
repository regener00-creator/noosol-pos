-- Mobile price check may edit catalog prices and one Lot expiry, but it must
-- never change inventory quantities. Stock corrections use the audited
-- inventory count adjustment workflow instead.

create or replace function public.owner_update_mobile_product_details(
  p_product_id bigint,
  p_warehouse_id bigint,
  p_lot_id bigint,
  p_product_data jsonb,
  p_price numeric,
  p_cost numeric,
  p_expiry date
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_stock numeric;
  v_expiry date;
  v_lot public.inventory_lots%rowtype;
  v_old_expiry date;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner access required'; end if;
  if p_product_id is null or p_warehouse_id is null then raise exception 'product and warehouse are required'; end if;
  if coalesce(p_price,0)<0 or coalesce(p_cost,0)<0 then raise exception 'values must not be negative'; end if;
  if not exists (select 1 from public.warehouses where id=p_warehouse_id) then raise exception 'warehouse not found'; end if;

  if p_lot_id is not null then
    select * into v_lot
    from public.inventory_lots
    where id=p_lot_id
    for update;
    if not found then raise exception 'selected lot not found'; end if;
    if v_lot.product_id<>p_product_id or v_lot.warehouse_id<>p_warehouse_id then
      raise exception 'selected lot does not belong to this product and warehouse';
    end if;
    if v_lot.status='blocked' then raise exception 'selected lot is blocked'; end if;
    v_old_expiry:=v_lot.expiry_date;
  elsif p_expiry is not null then
    raise exception 'select lot before editing expiry';
  end if;

  update public.products
  set data=(coalesce(p_product_data,'{}'::jsonb)-'stock'-'_catalogExpiry'),
      price=coalesce(p_price,0),
      cost=coalesce(p_cost,0),
      updated_at=now()
  where id=p_product_id;
  if not found then raise exception 'product not found'; end if;

  if p_lot_id is not null and v_old_expiry is distinct from p_expiry then
    update public.inventory_lots
    set expiry_date=p_expiry,updated_at=now()
    where id=p_lot_id;

    insert into private.inventory_lot_detail_audit(
      lot_id,product_id,warehouse_id,old_expiry,new_expiry,source,actor_id
    ) values (
      p_lot_id,p_product_id,p_warehouse_id,v_old_expiry,p_expiry,'mobile_price_check',(select auth.uid())
    );

    perform private.refresh_inventory_balance_from_lots(p_product_id,p_warehouse_id);
  end if;

  select balance.stock,balance.expiry
  into v_stock,v_expiry
  from public.inventory_balances balance
  where balance.product_id=p_product_id and balance.warehouse_id=p_warehouse_id;

  return jsonb_build_object(
    'productId',p_product_id,
    'warehouseId',p_warehouse_id,
    'lotId',p_lot_id,
    'stock',coalesce(v_stock,0),
    'expiry',v_expiry,
    'lotExpiry',p_expiry
  );
end;
$$;

revoke execute on function public.owner_update_mobile_product_details(bigint,bigint,bigint,jsonb,numeric,numeric,date)
from public,anon,authenticated;

grant execute on function public.owner_update_mobile_product_details(bigint,bigint,bigint,jsonb,numeric,numeric,date)
to authenticated;
