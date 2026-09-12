-- Permanent business conflicts must not be reported as serialization failures.
-- PostgREST 14 retries SQLSTATE 40001 indefinitely; PT409 returns HTTP 409.
-- Preserve the existing authorization checks, signatures and permissions.

CREATE OR REPLACE FUNCTION public.owner_update_mobile_product_details_revisioned(p_product_id bigint, p_expected_revision bigint, p_warehouse_id bigint, p_lot_id bigint, p_product_data jsonb, p_price numeric, p_cost numeric, p_expiry date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception using errcode='PT409', message='REVISION_CONFLICT',
      detail='ข้อมูลสินค้าเปลี่ยนแล้ว กรุณาเปิดสินค้านี้ใหม่ก่อนบันทึก เพื่อไม่เขียนทับข้อมูลล่าสุด';
  end if;
  v_result:=public.owner_update_mobile_product_details(
    p_product_id,p_warehouse_id,p_lot_id,p_product_data,p_price,p_cost,p_expiry
  );
  select * into v_product from public.products where id=p_product_id;
  return v_result||jsonb_build_object('product',to_jsonb(v_product));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_revisioned_document(p_request_id uuid, p_table text, p_id text, p_data jsonb, p_expected_revision bigint, p_delete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payload jsonb;
  v_cached jsonb;
  v_result jsonb;
  v_revision bigint;
  v_actor uuid := auth.uid();
  v_created_by uuid;
  v_existing_data jsonb;
  v_warehouse_id bigint;
  v_owner boolean := private.is_current_owner();
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_table not in (
    'quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts',
    'product_exchanges','purchase_orders_full','product_returns','transfers',
    'standalone_tax_invoices'
  ) then
    raise exception 'unsupported document table';
  end if;
  if btrim(coalesce(p_id, '')) = '' then
    raise exception 'document id is required';
  end if;

  if not v_owner then
    if p_table <> 'goods_receipts' then
      raise exception 'owner access required';
    end if;
    v_warehouse_id := private.document_warehouse_id(coalesce(p_data, '{}'::jsonb));
    if not private.can_current_user_receive_goods(v_warehouse_id) then
      raise exception 'warehouse receiving access denied';
    end if;
    if coalesce(p_expected_revision, 0) > 0 then
      select created_by, data into v_created_by, v_existing_data
      from public.goods_receipts
      where id = p_id;
      if not found or v_created_by is distinct from v_actor then
        raise exception 'document access denied';
      end if;
    end if;
  end if;

  v_payload := jsonb_build_object(
    'table', p_table,
    'id', p_id,
    'data', coalesce(p_data, '{}'::jsonb),
    'expectedRevision', coalesce(p_expected_revision, 0),
    'delete', coalesce(p_delete, false)
  );
  v_cached := private.begin_operation_request(
    p_request_id,
    'save_revisioned_document',
    v_payload
  );
  if v_cached is not null then
    return v_cached;
  end if;

  if coalesce(p_delete, false) then
    if coalesce(p_expected_revision, 0) <= 0 then
      raise exception 'expected revision is required for delete';
    end if;
    execute format(
      'delete from public.%I where id = $1 and revision = $2 returning revision',
      p_table
    ) into v_revision using p_id, p_expected_revision;
    if v_revision is null then
      raise exception using
        errcode = 'PT409',
        message = 'REVISION_CONFLICT';
    end if;
    v_result := jsonb_build_object(
      'id', p_id,
      'deleted', true,
      'revision', v_revision
    );
  elsif coalesce(p_expected_revision, 0) = 0 then
    execute format(
      'insert into public.%I(id, data) values ($1, $2) on conflict (id) do nothing returning revision',
      p_table
    ) into v_revision using p_id, coalesce(p_data, '{}'::jsonb);
    if v_revision is null then
      raise exception using
        errcode = 'PT409',
        message = 'REVISION_CONFLICT';
    end if;
    v_result := jsonb_build_object(
      'id', p_id,
      'deleted', false,
      'revision', v_revision
    );
  else
    execute format(
      'update public.%I set data = $2 where id = $1 and revision = $3 returning revision',
      p_table
    ) into v_revision using p_id, coalesce(p_data, '{}'::jsonb), p_expected_revision;
    if v_revision is null then
      raise exception using
        errcode = 'PT409',
        message = 'REVISION_CONFLICT';
    end if;
    v_result := jsonb_build_object(
      'id', p_id,
      'deleted', false,
      'revision', v_revision
    );
  end if;

  return private.finish_operation_request(p_request_id, v_result);
end;
$function$
;

NOTIFY pgrst, 'reload schema';
