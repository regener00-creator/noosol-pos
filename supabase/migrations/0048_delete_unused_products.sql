-- Owners may permanently remove only products that have never been used.
-- The RPC checks all authoritative tables in one transaction so the browser
-- cannot bypass history, stock or LOT protections with a stale local cache.

create or replace function private.jsonb_references_product(
  p_data jsonb,
  p_product_id bigint
) returns boolean
language sql
immutable
set search_path = ''
as $$
  with recursive nodes(value) as (
    select coalesce(p_data,'null'::jsonb)
    union all
    select child.value
    from nodes parent
    cross join lateral (
      select item.value
      from jsonb_array_elements(
        case when jsonb_typeof(parent.value)='array' then parent.value else '[]'::jsonb end
      ) item
      union all
      select member.value
      from jsonb_each(
        case when jsonb_typeof(parent.value)='object' then parent.value else '{}'::jsonb end
      ) member
    ) child
  )
  select exists (
    select 1
    from nodes
    where jsonb_typeof(value)='object'
      and (
        case when value ? 'productId' and value->>'productId' ~ '^[0-9]+$' then (value->>'productId')::bigint=p_product_id else false end
        or case when value ? 'pid' and value->>'pid' ~ '^[0-9]+$' then (value->>'pid')::bigint=p_product_id else false end
        or case when value ? 'bgdBuyProductId' and value->>'bgdBuyProductId' ~ '^[0-9]+$' then (value->>'bgdBuyProductId')::bigint=p_product_id else false end
        or case when value ? 'bgdGetProductId' and value->>'bgdGetProductId' ~ '^[0-9]+$' then (value->>'bgdGetProductId')::bigint=p_product_id else false end
      )
  );
$$;

revoke all on function private.jsonb_references_product(jsonb,bigint) from public,anon,authenticated;

create or replace function public.delete_unused_product(
  p_product_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_blockers text[]:=array[]::text[];
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner level 1 required';
  end if;
  if p_product_id is null or p_product_id<=0 then
    raise exception 'invalid product id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pepos-delete-product:'||p_product_id::text,0));
  select * into v_product from public.products where id=p_product_id for update;
  if not found then
    return jsonb_build_object('deleted',false,'blockers',jsonb_build_array('ไม่พบสินค้า'));
  end if;

  if abs(coalesce(v_product.stock,0))>0.000001
     or exists(select 1 from public.inventory_balances where product_id=p_product_id and abs(coalesce(stock,0))>0.000001) then
    v_blockers:=array_append(v_blockers,'จำนวนคงเหลือในคลัง');
  end if;
  if exists(select 1 from public.sale_items where product_id=p_product_id) then
    v_blockers:=array_append(v_blockers,'ประวัติการขาย');
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
  if exists(select 1 from public.inspection_lists where private.jsonb_references_product(data,p_product_id)) then
    v_blockers:=array_append(v_blockers,'รายการตรวจสินค้า');
  end if;
  if exists(select 1 from public.promotions where private.jsonb_references_product(data,p_product_id)) then
    v_blockers:=array_append(v_blockers,'โปรโมชั่น');
  end if;
  if exists(
    select 1 from (
      select data from public.quotations union all
      select data from public.invoices_ar union all
      select data from public.credit_notes union all
      select data from public.purchase_orders union all
      select data from public.goods_receipts union all
      select data from public.product_exchanges union all
      select data from public.purchase_orders_full union all
      select data from public.product_returns union all
      select data from public.transfers union all
      select data from public.standalone_tax_invoices
    ) documents
    where private.jsonb_references_product(documents.data,p_product_id)
  ) then
    v_blockers:=array_append(v_blockers,'เอกสารสินค้า');
  end if;

  if cardinality(v_blockers)>0 then
    return jsonb_build_object('deleted',false,'blockers',to_jsonb(v_blockers));
  end if;

  delete from public.products where id=p_product_id;
  return jsonb_build_object('deleted',true,'productId',p_product_id,'name',v_product.name,'blockers','[]'::jsonb);
end;
$$;

revoke all on function public.delete_unused_product(bigint) from public,anon;
grant execute on function public.delete_unused_product(bigint) to authenticated;
