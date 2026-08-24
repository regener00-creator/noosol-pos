-- Keep a warehouse transfer atomic and reject concurrent overdraws.

create or replace function public.transfer_inventory_stock(
  p_product_id bigint, p_from_warehouse_id bigint, p_to_warehouse_id bigint, p_quantity numeric
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_from numeric; v_to numeric; v_quantity numeric:=coalesce(p_quantity,0);
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) and not (
    exists (select 1 from public.profile_warehouse_access a where a.user_id=(select auth.uid()) and a.warehouse_id=p_from_warehouse_id and a.can_manage_stock)
    and exists (select 1 from public.profile_warehouse_access a where a.user_id=(select auth.uid()) and a.warehouse_id=p_to_warehouse_id and a.can_manage_stock)
  ) then raise exception 'stock transfer access denied'; end if;
  if p_from_warehouse_id=p_to_warehouse_id or v_quantity<=0 then raise exception 'invalid transfer'; end if;

  insert into public.inventory_balances(warehouse_id,product_id,stock,updated_at)
  values(p_from_warehouse_id,p_product_id,0,now())
  on conflict (warehouse_id,product_id) do nothing;
  insert into public.inventory_balances(warehouse_id,product_id,stock,updated_at)
  values(p_to_warehouse_id,p_product_id,0,now())
  on conflict (warehouse_id,product_id) do nothing;

  select stock into v_from
  from public.inventory_balances
  where warehouse_id=p_from_warehouse_id and product_id=p_product_id
  for update;
  if coalesce(v_from,0)<v_quantity then raise exception 'insufficient source warehouse stock'; end if;

  update public.inventory_balances
  set stock=stock-v_quantity,updated_at=now()
  where warehouse_id=p_from_warehouse_id and product_id=p_product_id
  returning stock into v_from;
  update public.inventory_balances
  set stock=stock+v_quantity,updated_at=now()
  where warehouse_id=p_to_warehouse_id and product_id=p_product_id
  returning stock into v_to;

  update public.products set stock=v_from,updated_at=now()
  where id=p_product_id and warehouse_id=p_from_warehouse_id;
  update public.products set stock=v_to,updated_at=now()
  where id=p_product_id and warehouse_id=p_to_warehouse_id;
  return jsonb_build_object('fromStock',v_from,'toStock',v_to);
end;
$$;

revoke execute on function public.transfer_inventory_stock(bigint,bigint,bigint,numeric) from public,anon;
grant execute on function public.transfer_inventory_stock(bigint,bigint,bigint,numeric) to authenticated;
