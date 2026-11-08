-- Catalog-only maintenance. The Edge Function reauthenticates the owner.
create function public.admin_reset_shop_products(p_actor_id uuid,p_warehouse_id bigint,p_confirmation text,p_expected_count integer)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='120s' as $$
declare
  shop text; n integer; others jsonb; used boolean; t text; product_ids text[];
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and owner and level=1) then
    raise exception 'เฉพาะเจ้าของร้านเท่านั้นที่ล้างสินค้าได้';
  end if;
  perform private.lock_shop_backup_tables();
  select name into strict shop from public.warehouses where id=p_warehouse_id;
  if p_confirmation is distinct from 'ล้างสินค้า '||shop then raise exception 'ชื่อร้านที่ยืนยันไม่ตรง กรุณาเปิดหน้าล้างสินค้าใหม่';end if;
  select count(*),array_agg(id::text) into n,product_ids from public.products where coalesce(warehouse_id,1)=p_warehouse_id;
  if n=0 or n is distinct from p_expected_count then raise exception 'จำนวนสินค้าเปลี่ยน กรุณาโหลดรายการล่าสุดก่อนยืนยัน';end if;
  if exists(select 1 from public.products where coalesce(warehouse_id,1)=p_warehouse_id and stock<>0)
    or exists(select 1 from public.inventory_balances where product_id::text=any(product_ids) and stock<>0)
    or exists(select 1 from public.inventory_lots where product_id::text=any(product_ids))
    or exists(select 1 from public.inventory_lot_movements where product_id::text=any(product_ids))
    or exists(select 1 from public.inventory_count_adjustment_lines where product_id::text=any(product_ids))
    or exists(select 1 from private.inventory_lot_detail_audit where product_id::text=any(product_ids)) then
    raise exception 'ล้างสินค้าไม่ได้ เพราะสินค้ายังมีสต๊อก LOT หรือประวัติปรับสต๊อก';
  end if;
  if exists(select 1 from public.sale_items where product_id::text=any(product_ids)) then
    raise exception 'ล้างสินค้าไม่ได้ เพราะมีรายการขายที่อ้างอิงสินค้า';
  end if;
  others:=private.shop_other_fingerprints(p_warehouse_id);
  perform set_config('pepos.maintenance_reset','on',true);
  -- Keep open inspection documents, removing only the lines for this catalog.
  -- Confirmed inspections are checked below like all other posted documents.
  update public.inspection_lists r set data=jsonb_set(r.data,'{items}',coalesce((
    select jsonb_agg(item order by pos) from jsonb_array_elements(r.data->'items') with ordinality i(item,pos)
    where not coalesce(item->>'pid'=any(product_ids),false)), '[]'))
    where coalesce(nullif(r.data->>'warehouseId','')::bigint,1)=p_warehouse_id and coalesce(r.data->>'stockAdjustedAt','')=''
      and exists(select 1 from jsonb_array_elements(r.data->'items') item where item->>'pid'=any(product_ids));
  -- Documents and customer pricing can reference products inside JSON without a FK.
  foreach t in array array['sales','quotations','credit_notes','invoices_ar','purchase_orders','purchase_orders_full',
    'goods_receipts','product_returns','product_exchanges','standalone_tax_invoices','transfers','promotions','inspection_lists','contacts'] loop
    execute format('select exists(select 1 from public.%I r where private.document_product_ids(r.data) && $1)',t)
      into used using product_ids;
    if used then raise exception 'ล้างสินค้าไม่ได้ เพราะยังมีบิล เอกสาร รายการตรวจ โปรโมชั่น หรือราคาพิเศษลูกค้าที่ผูกกับสินค้า (%)',t;end if;
  end loop;
  if exists(select 1 from public.settings s cross join lateral jsonb_path_query(s.value,'$.**.pid') v
    where s.key='inspection_lists' and v #>> '{}' = any(product_ids)) then
    raise exception 'ล้างสินค้าไม่ได้ เพราะยังมีรายการตรวจสินค้าที่อ้างอิงสินค้า';
  end if;
  delete from public.product_unit_changes h using public.products p where p.id=h.product_id and coalesce(p.warehouse_id,1)=p_warehouse_id;
  delete from public.products where coalesce(warehouse_id,1)=p_warehouse_id;
  get diagnostics n=row_count;
  if n<>p_expected_count or others<>private.shop_other_fingerprints(p_warehouse_id) then
    raise exception 'ข้อมูลร้านเปลี่ยนระหว่างตรวจสอบ ระบบยกเลิกการล้างทั้งหมด';
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,warehouse_id,summary)
    values(p_actor_id,'delete','store_reset',p_warehouse_id::text,p_warehouse_id,'ล้างสินค้า '||n||' รายการ · '||shop);
  insert into public.settings(key,value) values('shop_maintenance:'||p_warehouse_id,jsonb_build_object('epoch',gen_random_uuid()))
    on conflict(key) do update set value=excluded.value,updated_at=clock_timestamp();
  return jsonb_build_object('ok',true,'warehouseId',p_warehouse_id,'deleted',n);
end $$;
revoke all on function public.admin_reset_shop_products(uuid,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.admin_reset_shop_products(uuid,bigint,text,integer) to service_role;
