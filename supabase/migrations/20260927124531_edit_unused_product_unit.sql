-- Correct a never-used catalog unit without manufacturing a conversion,
-- secondary unit, barcode reassignment or stock movement.
create function private.unused_product_unit_blockers(p_product_id bigint)
returns text[] language plpgsql stable set search_path='' as $$
declare v_blockers text[]:=array[]::text[];
begin
  if exists(select 1 from public.inventory_balances where product_id=p_product_id and coalesce(stock,0)<>0)
     or exists(select 1 from public.products where id=p_product_id and coalesce(stock,0)<>0) then
    v_blockers:=array_append(v_blockers,'จำนวนคงเหลือในคลัง');
  end if;
  if exists(select 1 from public.sale_items where product_id=p_product_id)
     or exists(select 1 from public.sales where private.jsonb_references_product(data,p_product_id)) then
    v_blockers:=array_append(v_blockers,'ประวัติขายหรือบิลพัก');
  end if;
  if exists(select 1 from public.inventory_lots where product_id=p_product_id)
     or exists(select 1 from public.inventory_lot_movements where product_id=p_product_id) then
    v_blockers:=array_append(v_blockers,'ประวัติ LOT');
  end if;
  if exists(select 1 from public.product_unit_changes where product_id=p_product_id) then
    v_blockers:=array_append(v_blockers,'ประวัติเปลี่ยนหน่วยหลัก');
  end if;
  if exists(select 1 from public.inventory_count_adjustment_lines where product_id=p_product_id) then
    v_blockers:=array_append(v_blockers,'ประวัติปรับสต๊อก');
  end if;
  if exists(select 1 from public.representative_activity_items where product_id=p_product_id and coalesce(unit,'')<>'') then
    v_blockers:=array_append(v_blockers,'ประวัติหน่วยในข้อมูลผู้แทน');
  end if;
  if exists(select 1 from (
    select data from public.quotations union all select data from public.invoices_ar
    union all select data from public.credit_notes union all select data from public.purchase_orders
    union all select data from public.goods_receipts union all select data from public.product_exchanges
    union all select data from public.purchase_orders_full union all select data from public.product_returns
    union all select data from public.transfers union all select data from public.standalone_tax_invoices
    union all select data from public.inspection_lists union all select data from public.promotions
  ) d where private.jsonb_references_product(d.data,p_product_id)) then
    v_blockers:=array_append(v_blockers,'เอกสารหรือรายการอ้างอิงสินค้า');
  end if;
  return v_blockers;
end $$;
revoke all on function private.unused_product_unit_blockers(bigint) from public,anon,authenticated;

create function public.get_product_unit_edit_status(p_product_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_product public.products%rowtype; v_blockers text[];
begin
  if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required'; end if;
  select * into v_product from public.products where id=p_product_id;
  if not found then return jsonb_build_object('canEdit',false,'blockers',jsonb_build_array('ไม่พบสินค้าบนเซิร์ฟเวอร์')); end if;
  v_blockers:=private.unused_product_unit_blockers(p_product_id);
  return jsonb_build_object('canEdit',cardinality(v_blockers)=0,'blockers',v_blockers,'revision',v_product.revision,'unit',v_product.unit);
end $$;
revoke all on function public.get_product_unit_edit_status(bigint) from public,anon,authenticated;
grant execute on function public.get_product_unit_edit_status(bigint) to authenticated;

create function public.save_unused_product_unit(p_product_id bigint,p_expected_revision bigint,p_record jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_product public.products%rowtype; v_new public.products%rowtype; v_blockers text[];
begin
  if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required'; end if;
  if p_product_id is null or p_product_id<=0 or jsonb_typeof(p_record) is distinct from 'object' then raise exception 'invalid product'; end if;
  -- Same gate as restore, acquired exclusively BEFORE row locks. All normal
  -- document/stock RPCs take its shared counterpart, so a pending concurrent
  -- receive/sale is either visible here or starts after this correction.
  perform pg_advisory_xact_lock(hashtextextended('pepos-atomic-store-restore',0));
  perform private.acquire_inventory_product_locks(array[p_product_id]);
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'ไม่พบสินค้า'; end if;
  if p_expected_revision is null or v_product.revision<>p_expected_revision then
    raise exception using errcode='P0001',message='ข้อมูลสินค้ามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด',hint='REVISION_CONFLICT';
  end if;
  v_blockers:=private.unused_product_unit_blockers(p_product_id);
  if cardinality(v_blockers)>0 then
    raise exception using errcode='P0001',message='แก้หน่วยโดยตรงไม่ได้: '||array_to_string(v_blockers,', ')||' กรุณาใช้ปุ่มเปลี่ยนหน่วยหลัก',hint='PRODUCT_ALREADY_USED';
  end if;
  v_new:=jsonb_populate_record(v_product,p_record);
  v_new.unit:=btrim(v_new.unit);
  if coalesce(v_new.unit,'')='' or coalesce(btrim(v_new.name),'')='' or v_new.price is null or v_new.price<0 or v_new.cost is null or v_new.cost<0
     or jsonb_typeof(v_new.data) is distinct from 'object' then raise exception 'ข้อมูลสินค้าไม่ครบหรือราคาไม่ถูกต้อง'; end if;
  if jsonb_typeof(coalesce(v_new.data->'units','[]'::jsonb))<>'array' then raise exception 'โครงสร้างหน่วยสินค้าไม่ถูกต้อง'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(v_new.data->'units','[]'::jsonb)) u where u->>'sub'=v_new.unit) then
    raise exception 'หน่วยหลักใหม่ซ้ำกับหน่วยเพิ่มเติม';
  end if;
  -- Only catalog metadata is writable. Stock/IDs/revisions/created_at and all
  -- historical tables remain untouched, even if supplied in the JSON payload.
  update public.products set sku=v_new.sku,name=v_new.name,category=v_new.category,brand=v_new.brand,
    product_type=v_new.product_type,warehouse_id=v_new.warehouse_id,cost=v_new.cost,price=v_new.price,
    unit=v_new.unit,data=v_new.data where id=p_product_id returning * into v_product;
  return jsonb_build_object('product',to_jsonb(v_product));
end $$;
revoke all on function public.save_unused_product_unit(bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_unused_product_unit(bigint,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
