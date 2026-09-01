-- Reallocate an unchanged warehouse balance between existing Lots.
-- This is an owner-only corrective workflow: it never creates or removes
-- product stock, and every changed Lot receives an immutable movement row.

create or replace function public.reallocate_inventory_lots(
  p_product_id bigint,
  p_warehouse_id bigint,
  p_reason text,
  p_lots jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_reference_id text := 'LR'||to_char(v_now at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  v_current_balance numeric;
  v_old_total numeric;
  v_new_total numeric;
  v_input_count integer;
  v_current_count integer;
  v_changed_count integer := 0;
  v_row record;
  v_delta numeric;
  v_refreshed numeric;
  v_changes jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner access required'; end if;
  if p_product_id is null or p_warehouse_id is null then raise exception 'product and warehouse are required'; end if;
  if char_length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'reallocation reason is required'; end if;
  if jsonb_typeof(coalesce(p_lots,'null'::jsonb)) <> 'array' then raise exception 'Lots must be an array'; end if;
  v_input_count := jsonb_array_length(p_lots);
  if v_input_count < 2 then raise exception 'at least two active Lots are required'; end if;
  if v_input_count > 200 then raise exception 'too many Lots'; end if;
  if not exists (select 1 from public.products product where product.id=p_product_id) then raise exception 'product not found'; end if;
  if not exists (select 1 from public.warehouses warehouse where warehouse.id=p_warehouse_id) then raise exception 'warehouse not found'; end if;

  -- Match the lock order used by sales and stock counts: Lots by id first,
  -- then the summary balance row. This keeps transactions short and avoids
  -- two stock writers waiting on each other in opposite directions.
  perform lot.id
  from public.inventory_lots lot
  where lot.product_id=p_product_id and lot.warehouse_id=p_warehouse_id
    and lot.status<>'blocked' and lot.quantity_base>0
  order by lot.id
  for update;

  select count(*),coalesce(sum(lot.quantity_base),0)
  into v_current_count,v_old_total
  from public.inventory_lots lot
  where lot.product_id=p_product_id and lot.warehouse_id=p_warehouse_id
    and lot.status<>'blocked' and lot.quantity_base>0;

  if v_current_count <> v_input_count then raise exception 'Lot list changed before confirmation'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lots) item
    where nullif(item->>'lotId','') is null
      or nullif(item->>'expectedQuantity','') is null
      or nullif(item->>'newQuantity','') is null
      or (item->>'newQuantity')::numeric < 0
  ) then raise exception 'invalid Lot quantity'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lots) item
    group by (item->>'lotId')::bigint
    having count(*) > 1
  ) then raise exception 'duplicate Lot'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lots) item
    left join public.inventory_lots lot
      on lot.id=(item->>'lotId')::bigint
      and lot.product_id=p_product_id
      and lot.warehouse_id=p_warehouse_id
      and lot.status<>'blocked'
      and lot.quantity_base>0
    where lot.id is null
      or abs(lot.quantity_base-(item->>'expectedQuantity')::numeric)>0.000001
  ) then raise exception 'Lot quantity changed before confirmation'; end if;

  select coalesce(sum((item->>'newQuantity')::numeric),0)
  into v_new_total
  from jsonb_array_elements(p_lots) item;
  if abs(v_new_total-v_old_total)>0.000001 then raise exception 'new Lot total must equal current stock'; end if;

  insert into public.inventory_balances(warehouse_id,product_id,stock,updated_at)
  values(p_warehouse_id,p_product_id,0,v_now)
  on conflict (warehouse_id,product_id) do nothing;
  select balance.stock into v_current_balance
  from public.inventory_balances balance
  where balance.product_id=p_product_id and balance.warehouse_id=p_warehouse_id
  for update;
  if abs(coalesce(v_current_balance,0)-v_old_total)>0.000001 then
    raise exception 'warehouse balance does not match Lot total';
  end if;

  for v_row in
    select lot.id,lot.internal_code,lot.manufacturer_lot,lot.expiry_date,
           lot.quantity_base as old_quantity,(item->>'newQuantity')::numeric as new_quantity
    from jsonb_array_elements(p_lots) item
    join public.inventory_lots lot on lot.id=(item->>'lotId')::bigint
    order by lot.id
  loop
    v_delta := v_row.new_quantity-v_row.old_quantity;
    if abs(v_delta)<=0.000001 then continue; end if;
    update public.inventory_lots
    set quantity_base=v_row.new_quantity,
        status=case when v_row.new_quantity<=0 then 'exhausted' else 'active' end,
        updated_at=v_now
    where id=v_row.id;
    insert into public.inventory_lot_movements(
      lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,
      reference_type,reference_id,reference_line_key,note,created_by,created_at
    ) values (
      v_row.id,p_product_id,p_warehouse_id,
      case when v_delta>0 then 'lot_reallocation_in' else 'lot_reallocation_out' end,
      v_delta,v_row.new_quantity,'lot_reallocation',v_reference_id,v_row.id::text,
      btrim(p_reason),(select auth.uid()),v_now
    );
    v_changed_count := v_changed_count+1;
    v_changes := v_changes||jsonb_build_array(jsonb_build_object(
      'lotId',v_row.id,'internalCode',v_row.internal_code,'lotNumber',v_row.manufacturer_lot,
      'expiry',v_row.expiry_date,'oldQuantity',v_row.old_quantity,
      'newQuantity',v_row.new_quantity,'difference',v_delta
    ));
  end loop;
  if v_changed_count<2 then raise exception 'change at least two Lots while keeping the same total'; end if;

  v_refreshed := private.refresh_inventory_balance_from_lots(p_product_id,p_warehouse_id);
  if abs(v_refreshed-v_old_total)>0.000001 then raise exception 'stock reconciliation failed'; end if;

  return jsonb_build_object(
    'referenceId',v_reference_id,'productId',p_product_id,'warehouseId',p_warehouse_id,
    'totalStock',v_refreshed,'changedCount',v_changed_count,'changes',v_changes,'postedAt',v_now
  );
end;
$$;

revoke execute on function public.reallocate_inventory_lots(bigint,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.reallocate_inventory_lots(bigint,bigint,text,jsonb) to authenticated;

comment on function public.reallocate_inventory_lots(bigint,bigint,text,jsonb)
is 'Owner-only atomic reallocation of an unchanged warehouse stock total between existing active Lots.';
