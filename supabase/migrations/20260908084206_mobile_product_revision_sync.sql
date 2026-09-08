-- Keep the legacy endpoint for already-open clients; new clients use an
-- expected revision and receive the canonical product in the same transaction.
create or replace function public.owner_update_mobile_product_details_revisioned(
  p_product_id bigint,
  p_expected_revision bigint,
  p_warehouse_id bigint,
  p_lot_id bigint,
  p_product_data jsonb,
  p_price numeric,
  p_cost numeric,
  p_expiry date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_result jsonb;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner access required'; end if;
  perform private.acquire_store_mutation_gate();
  -- Match the existing mobile operation's lock order: LOT before product.
  if p_lot_id is not null then
    perform 1 from public.inventory_lots where id=p_lot_id for update;
  end if;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'product not found'; end if;
  if p_expected_revision is null or v_product.revision<>p_expected_revision then
    raise exception using errcode='40001', message='REVISION_CONFLICT',
      detail='ข้อมูลสินค้าเปลี่ยนแล้ว กรุณาเปิดสินค้านี้ใหม่ก่อนบันทึก เพื่อไม่เขียนทับข้อมูลล่าสุด';
  end if;
  v_result:=public.owner_update_mobile_product_details(
    p_product_id,p_warehouse_id,p_lot_id,p_product_data,p_price,p_cost,p_expiry
  );
  select * into v_product from public.products where id=p_product_id;
  return v_result||jsonb_build_object('product',to_jsonb(v_product));
end;
$$;

revoke all on function public.owner_update_mobile_product_details_revisioned(bigint,bigint,bigint,bigint,jsonb,numeric,numeric,date) from public,anon,authenticated;
grant execute on function public.owner_update_mobile_product_details_revisioned(bigint,bigint,bigint,bigint,jsonb,numeric,numeric,date) to authenticated;
