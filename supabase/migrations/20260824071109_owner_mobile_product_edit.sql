-- Level 1 owners may edit product price/cost plus warehouse stock/expiry from
-- the mobile price-check page. One RPC keeps the catalog and warehouse balance
-- update atomic, while the authorization check is enforced in Postgres.

drop policy if exists authenticated_full_access on public.products;
drop policy if exists products_read_authenticated on public.products;
drop policy if exists products_insert_owner on public.products;
drop policy if exists products_update_owner on public.products;
drop policy if exists products_delete_owner on public.products;

create policy products_read_authenticated on public.products
for select to authenticated
using (true);

create policy products_insert_owner on public.products
for insert to authenticated
with check ((select private.is_current_owner()));

create policy products_update_owner on public.products
for update to authenticated
using ((select private.is_current_owner()))
with check ((select private.is_current_owner()));

create policy products_delete_owner on public.products
for delete to authenticated
using ((select private.is_current_owner()));

create or replace function public.owner_update_mobile_product(
  p_product_id bigint,
  p_warehouse_id bigint,
  p_product_data jsonb,
  p_price numeric,
  p_cost numeric,
  p_stock numeric,
  p_expiry date
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock numeric := coalesce(p_stock,0);
  v_expiry date := p_expiry;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner access required';
  end if;
  if p_product_id is null or p_warehouse_id is null then
    raise exception 'product and warehouse are required';
  end if;
  if coalesce(p_price,0) < 0 or coalesce(p_cost,0) < 0 then
    raise exception 'price and cost must not be negative';
  end if;
  if not exists (select 1 from public.warehouses where id=p_warehouse_id) then
    raise exception 'warehouse not found';
  end if;

  update public.products
  set data=(coalesce(p_product_data,'{}'::jsonb) - 'stock' - '_catalogExpiry'),
      price=coalesce(p_price,0),
      cost=coalesce(p_cost,0),
      updated_at=now()
  where id=p_product_id;
  if not found then raise exception 'product not found'; end if;

  insert into public.inventory_balances(warehouse_id,product_id,stock,expiry,updated_at)
  values(p_warehouse_id,p_product_id,v_stock,v_expiry,now())
  on conflict (warehouse_id,product_id) do update
    set stock=excluded.stock,expiry=excluded.expiry,updated_at=now();

  -- Keep the legacy flat stock column aligned only for the product's original
  -- warehouse. Current screens read inventory_balances as the authority.
  update public.products
  set stock=v_stock,updated_at=now()
  where id=p_product_id and warehouse_id=p_warehouse_id;

  return jsonb_build_object(
    'productId',p_product_id,
    'warehouseId',p_warehouse_id,
    'stock',v_stock,
    'expiry',case when v_expiry is null then null else to_char(v_expiry,'YYYY-MM-DD') end
  );
end;
$$;

revoke execute on function public.owner_update_mobile_product(bigint,bigint,jsonb,numeric,numeric,numeric,date) from public,anon;
grant execute on function public.owner_update_mobile_product(bigint,bigint,jsonb,numeric,numeric,numeric,date) to authenticated;
