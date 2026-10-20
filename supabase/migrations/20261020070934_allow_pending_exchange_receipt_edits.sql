-- Allow receipt preparation between the two supplier exchange posting stages.
-- Keep the existing owner/RLS, revision checks and posted-history guards.
CREATE OR REPLACE FUNCTION private.protect_inventory_document_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_data jsonb := coalesce(old.data, '{}'::jsonb);
  v_new_data jsonb := case when tg_op = 'UPDATE'
    then coalesce(new.data, '{}'::jsonb) else '{}'::jsonb end;
  v_reference_type text := case tg_table_name
    when 'goods_receipts' then 'goods_receipt'
    when 'product_returns' then 'product_return'
    when 'product_exchanges' then 'product_exchange'
    else null
  end;
  v_has_ledger boolean := false;
  v_old_posted boolean := private.inventory_document_is_posted(
    tg_table_name, v_old_data
  );
  v_new_posted boolean := case when tg_op = 'UPDATE' then
    private.inventory_document_is_posted(tg_table_name, v_new_data)
    else false end;
  v_metadata_write boolean :=
    current_setting('pepos.inventory_metadata_write', true) = 'on';
begin
  if current_setting('pepos.maintenance_reset', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_reference_type is not null then
    select exists(
      select 1
      from public.inventory_lot_movements movement
      where movement.reference_type = v_reference_type
        and movement.reference_id = old.id
    ) into v_has_ledger;
  end if;

  if tg_op = 'DELETE' then
    if v_old_posted or v_has_ledger then
      raise exception 'inventory-posted document history cannot be deleted';
    end if;
    return old;
  end if;

  if tg_table_name = 'goods_receipts'
     and (to_jsonb(new) -> 'created_by') is distinct from
         (to_jsonb(old) -> 'created_by') then
    raise exception 'goods receipt creator is immutable';
  end if;

  if v_metadata_write and tg_table_name = 'goods_receipts' then
    if not v_old_posted
       or not v_new_posted
       or coalesce(v_new_data ->> 'status', '') <> 'ชำระเรียบร้อย'
       or jsonb_typeof(v_new_data -> 'payment') <> 'object'
       or (v_new_data - 'payment' - 'status') is distinct from
          (v_old_data - 'payment' - 'status')
       or (to_jsonb(new) - 'data' - 'updated_at') is distinct from
          (to_jsonb(old) - 'data' - 'updated_at') then
      raise exception 'only posted goods receipt payment metadata may be changed';
    end if;
    return new;
  end if;

  -- The outgoing shipment is immutable, but its pending receipt is not yet
  -- stock evidence. Owners may prepare only receipt lines until receipt posts.
  -- All shipment fields, statuses, flags and posting timestamps stay unchanged.
  if tg_table_name = 'product_exchanges'
     and private.is_current_owner()
     and v_old_data ->> 'status' = 'ส่งไปเปลี่ยนแล้ว'
     and v_new_data ->> 'status' = 'ส่งไปเปลี่ยนแล้ว'
     and private.jsonb_flag_is_true(v_old_data, 'outgoingApplied')
     and not private.jsonb_flag_is_true(v_old_data, 'incomingApplied')
     and jsonb_typeof(v_new_data -> 'incomingItems') = 'array'
     and (not (v_new_data ? 'unreturnedItems')
          or jsonb_typeof(v_new_data -> 'unreturnedItems') = 'array')
     and (v_new_data - 'incomingItems' - 'unreturnedItems' - 'updatedAt')
         is not distinct from
         (v_old_data - 'incomingItems' - 'unreturnedItems' - 'updatedAt') then
    return new;
  end if;

  -- Product exchange has two valid forward-only posting stages. The second
  -- stage may extend the already-posted row only after exchange_in movements
  -- exist; it can never clear the outgoing stage.
  if tg_table_name = 'product_exchanges'
     and private.jsonb_flag_is_true(v_old_data, 'outgoingApplied')
     and not private.jsonb_flag_is_true(v_old_data, 'incomingApplied')
     and private.jsonb_flag_is_true(v_new_data, 'outgoingApplied')
     and private.jsonb_flag_is_true(v_new_data, 'incomingApplied')
     and exists(
       select 1
       from public.inventory_lot_movements movement
       where movement.reference_type = 'product_exchange'
         and movement.reference_id = old.id
         and movement.movement_type = 'exchange_in'
     ) then
    return new;
  end if;

  if v_old_posted then
    if new.data is distinct from old.data then
      raise exception 'inventory-posted document is immutable';
    end if;
    return new;
  end if;

  -- Applied flags are monotonic. The first transition is accepted only after
  -- the posting RPC has already written the authoritative movement rows. The
  -- transfer RPC is owner-only and marks a transaction-local trusted flag.
  if private.jsonb_flag_is_true(v_old_data, 'stockApplied')
     and not private.jsonb_flag_is_true(v_new_data, 'stockApplied') then
    raise exception 'stockApplied cannot be reverted';
  end if;
  if private.jsonb_flag_is_true(v_old_data, 'outgoingApplied')
     and not private.jsonb_flag_is_true(v_new_data, 'outgoingApplied') then
    raise exception 'outgoingApplied cannot be reverted';
  end if;
  if private.jsonb_flag_is_true(v_old_data, 'incomingApplied')
     and not private.jsonb_flag_is_true(v_new_data, 'incomingApplied') then
    raise exception 'incomingApplied cannot be reverted';
  end if;

  if v_new_posted and not v_old_posted then
    if tg_table_name = 'transfers' then
      if current_setting('pepos.inventory_posting', true) <> 'on' then
        raise exception 'transfer must be posted through apply_inventory_transfer';
      end if;
    elsif not v_has_ledger then
      raise exception 'document cannot be marked posted without inventory movements';
    end if;
    return new;
  end if;

  if v_has_ledger then
    raise exception 'document has inventory movements and must remain posted';
  end if;

  return new;
end;
$function$
