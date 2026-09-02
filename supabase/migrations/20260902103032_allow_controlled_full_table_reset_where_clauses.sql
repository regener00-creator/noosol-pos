-- Supabase's authenticator role preloads safeupdate. That protection rejects
-- UPDATE/DELETE statements without a WHERE clause, including the deliberate
-- whole-table clears inside the owner-controlled reset and restore workflows.
--
-- Keep safeupdate enabled globally. Make the destructive intent explicit only
-- inside the three functions that already enforce owner/service-role access,
-- validate their inputs, take the store-wide mutation gate, and run atomically.
do $migration$
declare
  v_signature text;
  v_definition text;
  v_original text;
begin
  foreach v_signature in array array[
    'public.admin_reset_store_data_core_20260831(text,uuid,text)',
    'public.restore_store_backup_atomic(jsonb)',
    'public.restore_store_inventory_backup(jsonb,jsonb)'
  ] loop
    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature))
    into v_definition;

    if v_definition is null then
      raise exception 'required reset function is missing: %', v_signature;
    end if;

    v_original := v_definition;
    v_definition := pg_catalog.regexp_replace(
      v_definition,
      'delete[[:space:]]+from[[:space:]]+((public|private)\.[a-z_]+)[[:space:]]*;',
      'delete from \1 where true;',
      'gi'
    );
    v_definition := pg_catalog.regexp_replace(
      v_definition,
      '(update[[:space:]]+public\.(products|inventory_balances)[[:space:]]+set[[:space:]][^;]+);',
      '\1 where true;',
      'gi'
    );

    if v_definition = v_original then
      raise exception 'no safeupdate statements were rewritten in %', v_signature;
    end if;
    if v_definition ~* 'delete[[:space:]]+from[[:space:]]+(public|private)\.[a-z_]+[[:space:]]*;' then
      raise exception 'unsafe DELETE remains in %', v_signature;
    end if;

    execute v_definition;
  end loop;
end;
$migration$;

-- CREATE OR REPLACE preserves the existing ACL. Reassert it here so a clean
-- migration replay cannot accidentally expose these destructive primitives.
revoke all on function public.admin_reset_store_data_core_20260831(text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_reset_store_data(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_reset_store_data(text, uuid, text)
  to service_role;

revoke all on function public.restore_store_backup_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function public.restore_store_backup_atomic(jsonb)
  to authenticated;

revoke all on function public.restore_store_inventory_backup(jsonb, jsonb)
  from public, anon, authenticated;

comment on function public.admin_reset_store_data(text, uuid, text)
is 'Service-role-only controlled reset wrapper. Intentional whole-table mutations use explicit WHERE clauses for safeupdate compatibility.';

comment on function public.restore_store_backup_atomic(jsonb)
is 'Owner-only all-or-nothing store restore. Intentional whole-table mutations use explicit WHERE clauses for safeupdate compatibility.';
