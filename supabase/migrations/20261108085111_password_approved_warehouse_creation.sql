-- Keep the existing warehouse defaults, access grants and allocator in one private implementation.
alter function public.owner_upsert_warehouse(bigint,text,jsonb) set schema private;
revoke all on function private.owner_upsert_warehouse(bigint,text,jsonb) from public,anon,authenticated,service_role;
revoke insert on public.warehouses from public,anon,authenticated;

create function public.owner_upsert_warehouse(p_id bigint,p_name text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required' using errcode='42501';end if;
  perform private.acquire_store_mutation_gate();
  perform 1 from public.warehouses where id=p_id for update;
  if not found then raise exception 'กรุณายืนยันรหัสผ่านเจ้าของร้านก่อนเพิ่มคลังสินค้า';end if;
  return private.owner_upsert_warehouse(p_id,p_name,p_data);
end $$;
revoke all on function public.owner_upsert_warehouse(bigint,text,jsonb) from public,anon;
grant execute on function public.owner_upsert_warehouse(bigint,text,jsonb) to authenticated;

create table private.warehouse_create_approvals(
  token uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now()+interval '15 minutes',
  created_id bigint,
  request_hash text
);
alter table private.warehouse_create_approvals enable row level security;
revoke all on private.warehouse_create_approvals from public,anon,authenticated;
create function public.issue_warehouse_create_approval(p_actor_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare approval uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and owner and level=1) then
    raise exception 'owner access required' using errcode='42501';
  end if;
  delete from private.warehouse_create_approvals where expires_at<=now();
  insert into private.warehouse_create_approvals(actor_id) values(p_actor_id) returning token into approval;
  return approval;
end $$;
revoke all on function public.issue_warehouse_create_approval(uuid) from public,anon,authenticated;
grant execute on function public.issue_warehouse_create_approval(uuid) to service_role;

create function public.create_approved_warehouse(p_approval uuid,p_name text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare grant_row private.warehouse_create_approvals%rowtype; result jsonb;
  payload_hash text:=md5(jsonb_build_array(p_name,p_data)::text);
  highest_id bigint; id_sequence regclass:=pg_get_serial_sequence('public.warehouses','id')::regclass;
begin
  if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required' using errcode='42501';end if;
  perform private.acquire_store_mutation_gate();
  select * into grant_row from private.warehouse_create_approvals where token=p_approval and actor_id=auth.uid() for update;
  if not found or grant_row.expires_at<=clock_timestamp() then
    raise exception 'กรุณากดบันทึกและยืนยันรหัสผ่านเจ้าของร้านอีกครั้ง' using errcode='PWA01';
  end if;
  if grant_row.created_id is not null then
    select to_jsonb(w) into result from public.warehouses w where id=grant_row.created_id;
    if result is null or grant_row.request_hash<>payload_hash then
      raise exception 'ใช้การยืนยันนี้ไปแล้ว กรุณายืนยันรหัสผ่านใหม่' using errcode='PWA01';
    end if;
    return result;
  end if;
  lock table public.warehouses in share row exclusive mode;
  if exists(select 1 from public.warehouses where lower(trim(name))=lower(trim(p_name))) then raise exception 'มีชื่อคลังสินค้านี้อยู่แล้ว'; end if;
  -- Legacy restores and warehouses inserted with explicit IDs can leave the allocator behind.
  select max(id) into highest_id from public.warehouses;
  if highest_id>coalesce(pg_sequence_last_value(id_sequence),0) then perform setval(id_sequence,highest_id,true);end if;
  result:=private.owner_upsert_warehouse(null,p_name,p_data);
  update private.warehouse_create_approvals set created_id=(result->>'id')::bigint,request_hash=payload_hash where token=p_approval;
  return result;
end $$;
revoke all on function public.create_approved_warehouse(uuid,text,jsonb) from public,anon;
grant execute on function public.create_approved_warehouse(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
