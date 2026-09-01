-- Keep the central audit useful without copying complete product/document JSON.
-- Updates store only recursively changed values; inserts/deletes store identity
-- and status fields instead of duplicating the source record.

create or replace function private.audit_changed_values(p_value jsonb,p_other jsonb)
returns jsonb
language plpgsql
immutable
set search_path=''
as $$
declare
  v_value jsonb:=coalesce(p_value,'null'::jsonb);
  v_other jsonb:=coalesce(p_other,'null'::jsonb);
  v_result jsonb:='{}'::jsonb;
  v_key text;
begin
  if jsonb_typeof(v_value)='object' and jsonb_typeof(v_other)='object' then
    for v_key in select key_name from jsonb_object_keys(v_value||v_other) as keys(key_name) loop
      if v_value->v_key is distinct from v_other->v_key then
        if jsonb_typeof(v_value->v_key)='object' and jsonb_typeof(v_other->v_key)='object' then
          v_result:=v_result||jsonb_build_object(v_key,private.audit_changed_values(v_value->v_key,v_other->v_key));
        else
          v_result:=v_result||jsonb_build_object(v_key,coalesce(v_value->v_key,'null'::jsonb));
        end if;
      end if;
    end loop;
    return v_result;
  end if;
  return v_value;
end;
$$;

create or replace function private.audit_identity_snapshot(p_record jsonb)
returns jsonb
language sql
immutable
set search_path=''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',coalesce(p_record->'id',p_record->'key',p_record->'user_id'),
    'name',coalesce(p_record->'name',p_record#>'{data,name}'),
    'ref',coalesce(p_record->'ref',p_record#>'{data,ref}',p_record#>'{data,number}'),
    'status',coalesce(p_record->'status',p_record#>'{data,status}'),
    'total',coalesce(p_record->'total',p_record#>'{data,total}'),
    'warehouseId',coalesce(p_record->'warehouse_id',p_record#>'{data,warehouseId}')
  ));
$$;

revoke execute on function private.audit_changed_values(jsonb,jsonb) from public,anon,authenticated;
revoke execute on function private.audit_identity_snapshot(jsonb) from public,anon,authenticated;

create or replace function private.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_name text;
  v_actor_level integer;
  v_before jsonb;
  v_after jsonb;
  v_record jsonb;
  v_changed text[] := '{}'::text[];
  v_entity_id text;
  v_warehouse_id bigint;
  v_action text := lower(tg_op);
begin
  if current_setting('pepos.maintenance_reset',true)='on' then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if v_actor_id is not null then
    select coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.username),p.level
      into v_actor_name,v_actor_level
    from public.profiles p where p.id=v_actor_id;
  end if;

  if tg_op='INSERT' then
    v_record:=to_jsonb(new);
    v_after:=private.audit_identity_snapshot(v_record);
    v_changed:=array['record'];
  elsif tg_op='DELETE' then
    v_record:=to_jsonb(old);
    v_before:=private.audit_identity_snapshot(v_record);
    v_changed:=array['record'];
  else
    v_record:=to_jsonb(new);
    v_before:=private.audit_changed_values(to_jsonb(old)-'created_at'-'updated_at',to_jsonb(new)-'created_at'-'updated_at');
    v_after:=private.audit_changed_values(to_jsonb(new)-'created_at'-'updated_at',to_jsonb(old)-'created_at'-'updated_at');
    select coalesce(array_agg(key_name order by key_name),'{}'::text[])
      into v_changed
    from jsonb_object_keys(v_before||v_after) as keys(key_name);
    if cardinality(v_changed)=0 then return new; end if;
  end if;

  v_entity_id:=coalesce(v_record->>'id',v_record->>'key',v_record->>'user_id','-');
  if coalesce(v_record->>'warehouse_id','') ~ '^[0-9]+$' then
    v_warehouse_id:=(v_record->>'warehouse_id')::bigint;
  elsif coalesce(v_record#>>'{data,warehouseId}','') ~ '^[0-9]+$' then
    v_warehouse_id:=(v_record#>>'{data,warehouseId}')::bigint;
  end if;

  insert into public.audit_logs(
    actor_id,actor_name,actor_level,action,entity_type,entity_id,warehouse_id,
    changed_fields,before_data,after_data,summary
  ) values (
    v_actor_id,v_actor_name,v_actor_level,v_action,coalesce(nullif(tg_argv[0],''),tg_table_name),v_entity_id,v_warehouse_id,
    v_changed,v_before,v_after,format('%s %s',v_action,coalesce(nullif(tg_argv[0],''),tg_table_name))
  );
  return case when tg_op='DELETE' then old else new end;
end;
$$;

revoke execute on function private.capture_audit_log() from public,anon,authenticated;
