-- Complete, server-snapshot backups. No business data is changed by migration.
-- Auth accounts/credentials and transient recovery challenges are intentionally
-- excluded. Restore requires the referenced accounts to exist; never remap users.
create or replace function private.store_backup_tables()
returns text[] language sql immutable set search_path='' as $$
  select array[
    'public.warehouses','public.categories','public.brands','public.units',
    'public.products','public.contacts','public.sales_representatives',
    'public.cash_shifts','public.sales','public.sale_items','public.promotions',
    'public.quotations','public.invoices_ar','public.credit_notes',
    'public.purchase_orders','public.goods_receipts','public.purchase_orders_full',
    'public.product_returns','public.product_exchanges','public.transfers',
    'public.standalone_tax_invoices','public.inspection_lists',
    'public.inventory_lots','public.inventory_balances','public.inventory_lot_movements',
    'public.inventory_count_adjustments','public.inventory_count_adjustment_lines',
    'public.product_unit_changes','private.inventory_lot_detail_audit',
    'public.notes','public.representative_activity_items','public.sales_representative_products',
    'public.favorites','public.profile_warehouse_access','public.profile_page_permissions',
    'public.settings','private.sale_document_sequences','private.cash_shift_sequences'
  ]::text[]
$$;
create or replace function private.store_backup_history_tables()
returns text[] language sql immutable set search_path='' as $$
  select array['public.audit_logs','private.audit_logs_archive','public.print_events','private.operation_ledger']::text[]
$$;
revoke all on function private.store_backup_tables(),private.store_backup_history_tables() from public,anon,authenticated;

create or replace function private.backup_canonical_json(v jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
  case jsonb_typeof(v)
    when 'number' then return to_jsonb(trim_scale((v#>>'{}')::numeric));
    when 'array' then return (select coalesce(jsonb_agg(private.backup_canonical_json(value) order by ord),'[]') from jsonb_array_elements(v) with ordinality a(value,ord));
    when 'object' then return (select coalesce(jsonb_object_agg(key,private.backup_canonical_json(value)),'{}') from jsonb_each(v));
    else return v;
  end case;
end;
$$;
revoke all on function private.backup_canonical_json(jsonb) from public,anon,authenticated;

create or replace function public.export_store_backup()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_table text; v_parts text[]:=array[]::text[]; v_result jsonb;
begin
  if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required'; end if;
  foreach v_table in array private.store_backup_tables()||private.store_backup_history_tables() loop
    v_parts:=array_append(v_parts,format(
      '%L, (select coalesce(jsonb_agg(private.backup_canonical_json(to_jsonb(r)) order by private.backup_canonical_json(to_jsonb(r))::text),''[]''::jsonb) from %s r %s)',
      v_table,v_table::regclass,case when v_table='public.settings' then 'where key <> ''maintenance_epoch''' else '' end));
  end loop;
  -- One SELECT gives all tables the same MVCC snapshot, including history.
  execute 'with snapshot as (select jsonb_build_object('||array_to_string(v_parts,',')||') as tables)
    select jsonb_build_object(''format'',''pepos-pharmacy-store-backup'',''version'',3,
      ''createdAt'',statement_timestamp(),''data'',jsonb_build_object(''tables'',tables),
      ''manifest'',(select jsonb_object_agg(key,jsonb_build_object(''rows'',jsonb_array_length(value),''md5'',md5(value::text),''scope'',case when key=any(private.store_backup_history_tables()) then ''merge'' else ''replace'' end)) from jsonb_each(tables)),
      ''scope'',''store-business-and-history; auth accounts and credentials are not included'') from snapshot'
  into v_result;
  return v_result;
end;
$$;
revoke all on function public.export_store_backup() from public,anon,authenticated;
grant execute on function public.export_store_backup() to authenticated;

-- Restore preserves the historical author/time of notes. Ordinary edits keep
-- their existing audit behavior; the maintenance flag is set only inside the
-- owner-only transaction below (and resets automatically on commit/rollback).
create or replace function private.set_note_audit_fields()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if current_setting('pepos.maintenance_reset',true)='on' and private.is_current_owner() then return new; end if;
  if tg_op='INSERT' then
    new.created_by:=auth.uid(); new.updated_by:=auth.uid(); new.created_at:=clock_timestamp();
  else
    new.created_by:=old.created_by; new.created_at:=old.created_at; new.updated_by:=auth.uid();
  end if;
  new.updated_at:=clock_timestamp(); return new;
end;
$$;

create or replace function public.restore_store_backup_atomic(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='5s' set statement_timeout='120s' as $$
declare
  v_tables jsonb:=p_backup#>'{data,tables}'; v_table text; v_rows jsonb; v_manifest jsonb;
  v_order text[]:=private.store_backup_tables(); v_history text[]:=private.store_backup_history_tables();
  v_locks text; v_columns text; v_unknown boolean; v_sequence text; v_column text;
  v_epoch text:=gen_random_uuid()::text; v_counts jsonb:='{}'; v_links jsonb; v_print_links jsonb;
  v_users jsonb; v_missing_user boolean; v_fk record; v_idx int;
begin
  if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required'; end if;
  if p_backup->>'format' is distinct from 'pepos-pharmacy-store-backup' or p_backup->>'version' is distinct from '3' then
    raise exception 'ต้องใช้ไฟล์สำรองแบบครบถ้วนเวอร์ชัน 3 — ไฟล์เก่าไม่ครอบคลุมกะ NOTE และสต๊อกนอก LOT';
  end if;
  if pg_column_size(p_backup)>104857600 or jsonb_typeof(v_tables) is distinct from 'object' then raise exception 'invalid or oversized store backup'; end if;
  if exists(select 1 from jsonb_object_keys(v_tables) t where not t=any(v_order||v_history)) then raise exception 'unknown backup table'; end if;
  foreach v_table in array v_order||v_history loop
    v_rows:=v_tables->v_table; v_manifest:=p_backup->'manifest'->v_table;
    if jsonb_typeof(v_rows) is distinct from 'array' or jsonb_typeof(v_manifest) is distinct from 'object'
      or (v_manifest->>'rows')::bigint is distinct from jsonb_array_length(v_rows)
      or v_manifest->>'md5' is distinct from md5(v_rows::text) then raise exception 'incomplete or changed backup table: %',v_table; end if;
    if exists(select 1 from jsonb_array_elements(v_rows) r where jsonb_typeof(r)<>'object') then raise exception 'invalid backup rows: %',v_table; end if;
    select exists(select 1 from jsonb_array_elements(v_rows) r cross join lateral jsonb_object_keys(r) k
      where not exists(select 1 from pg_attribute a where a.attrelid=v_table::regclass and a.attnum>0 and not a.attisdropped and a.attname=k)) into v_unknown;
    if v_unknown then raise exception 'backup schema is newer than this database: %',v_table; end if;
    -- Missing columns are not silently filled with NULL/default values.
    if exists(select 1 from jsonb_array_elements(v_rows) r cross join pg_attribute a
      where a.attrelid=v_table::regclass and a.attnum>0 and not a.attisdropped and a.attgenerated='' and not r ? a.attname) then
      raise exception 'backup schema differs from this database: %',v_table;
    end if;
    -- Validate authentication references before touching any store rows.
    for v_fk in select a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      where c.contype='f' and c.conrelid=v_table::regclass and c.confrelid in ('auth.users'::regclass,'public.profiles'::regclass) loop
      select exists(select 1 from jsonb_array_elements(v_rows) r where nullif(r->>v_fk.attname,'') is not null
        and not exists(select 1 from auth.users u where u.id::text=r->>v_fk.attname)) into v_missing_user;
      if v_missing_user then raise exception 'บัญชีผู้ใช้ที่อ้างอิงในไฟล์ยังไม่มีในระบบนี้: % — หยุดก่อนเปลี่ยนข้อมูล',v_table; end if;
    end loop;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('pepos-atomic-store-restore',0));
  if not private.is_current_owner() then raise exception 'owner access required'; end if;
  select string_agg(t,',' order by t) into v_locks from unnest(v_order||v_history) t;
  execute 'lock table '||v_locks||' in access exclusive mode';
  perform set_config('pepos.maintenance_reset','on',true);
  -- Preserve current security history even when restoring an older snapshot.
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'warehouse_id',warehouse_id)),'[]') into v_links from public.audit_logs where warehouse_id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'warehouse_id',warehouse_id)),'[]') into v_print_links from public.print_events where warehouse_id is not null;
  -- Imported history must not collide with audit events generated by restore.
  foreach v_table in array v_history loop
    select pg_get_serial_sequence(v_table,attname) into v_sequence from pg_attribute where attrelid=v_table::regclass and attname='id' and not attisdropped;
    if v_sequence is not null then
      execute format('select setval(%L,greatest(coalesce((select max(id) from %s),0),coalesce((select max((r->>''id'')::bigint) from jsonb_array_elements($1) r),0),1),true)',v_sequence,v_table::regclass) using v_tables->v_table;
    end if;
  end loop;
  for v_idx in reverse array_length(v_order,1)..1 loop
    v_table:=v_order[v_idx];
    execute format('delete from %s where true',v_table::regclass);
  end loop;
  foreach v_table in array v_order||v_history loop
    v_rows:=v_tables->v_table;
    -- Product insertion seeds zero balances; replace those with the exact
    -- signed balances from backup, including negative/unallocated stock.
    if v_table='public.inventory_balances' then delete from public.inventory_balances where true; end if;
    select string_agg(quote_ident(attname),',' order by attnum) into v_columns from pg_attribute
      where attrelid=v_table::regclass and attnum>0 and not attisdropped and attgenerated='';
    execute format('insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s,$1) %s',
      v_table::regclass,v_columns,v_columns,v_table::regclass,case when v_table=any(v_history) then 'on conflict do nothing' else '' end) using v_rows;
    v_counts:=v_counts||jsonb_build_object(v_table,jsonb_array_length(v_rows));
    -- Advance all owned serial/identity sequences, including contact/LOT data.
    for v_column in select attname from pg_attribute where attrelid=v_table::regclass and attnum>0 and not attisdropped loop
      v_sequence:=pg_get_serial_sequence(v_table,v_column);
      if v_sequence is not null then execute format('select setval(%L,greatest(coalesce((select max(%I) from %s),0),1),true)',v_sequence,v_column,v_table::regclass); end if;
    end loop;
  end loop;
  update public.audit_logs a set warehouse_id=(r->>'warehouse_id')::bigint from jsonb_array_elements(v_links) r
    where a.id::text=r->>'id' and exists(select 1 from public.warehouses w where w.id=(r->>'warehouse_id')::bigint);
  update public.print_events a set warehouse_id=(r->>'warehouse_id')::bigint from jsonb_array_elements(v_print_links) r
    where a.id::text=r->>'id' and exists(select 1 from public.warehouses w where w.id=(r->>'warehouse_id')::bigint);
  -- Recheck business rows after all triggers/FKs. Never report success if a
  -- trigger changed historical values or a table was omitted from restore.
  foreach v_table in array v_order loop
    execute format('select coalesce(jsonb_agg(private.backup_canonical_json(to_jsonb(r)) order by private.backup_canonical_json(to_jsonb(r))::text),''[]''::jsonb) from %s r',v_table::regclass) into v_rows;
    if v_rows is distinct from v_tables->v_table then raise exception 'restore verification mismatch: %',v_table; end if;
  end loop;
  insert into public.settings(key,value,updated_at) values('maintenance_epoch',jsonb_build_object('epoch',v_epoch,'mode','restore','resetAt',clock_timestamp()),clock_timestamp())
    on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
  return jsonb_build_object('ok',true,'epoch',v_epoch,'counts',v_counts,'cashShiftHistoryRestored',true,'verified',true);
end;
$$;
revoke all on function public.restore_store_backup_atomic(jsonb) from public,anon,authenticated;
grant execute on function public.restore_store_backup_atomic(jsonb) to authenticated;

-- Keep the old function as an internal implementation only. The revisioned
-- SECURITY DEFINER wrapper can still call it as owner; browsers cannot.
revoke all on function public.owner_update_mobile_product_details(bigint,bigint,bigint,jsonb,numeric,numeric,date) from public,anon,authenticated;
notify pgrst,'reload schema';
