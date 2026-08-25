-- Prevent a public race to claim the next Level 1 owner after factory reset.
-- The resetting owner's Edge Function creates a high-entropy one-time token.
-- Only its SHA-256 digest is stored, and only service-role functions can use it.

create table if not exists private.owner_bootstrap_tokens (
  id smallint primary key default 1 check (id=1),
  token_hash text not null,
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp()
);

alter table private.owner_bootstrap_tokens enable row level security;
revoke all on private.owner_bootstrap_tokens from public, anon, authenticated;

create or replace function public.admin_prepare_owner_bootstrap_token(
  p_actor_id uuid,
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if length(coalesce(p_token,'')) < 64 then
    raise exception 'invalid bootstrap token';
  end if;
  if not exists (
    select 1 from public.profiles
    where id=p_actor_id and owner=true and level=1
  ) then
    raise exception 'owner access required';
  end if;

  insert into private.owner_bootstrap_tokens(id,token_hash,expires_at,created_by,created_at)
  values(
    1,
    encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex'),
    clock_timestamp()+interval '24 hours',
    p_actor_id,
    clock_timestamp()
  )
  on conflict (id) do update set
    token_hash=excluded.token_hash,
    expires_at=excluded.expires_at,
    created_by=excluded.created_by,
    created_at=excluded.created_at;
  return true;
end;
$$;

create or replace function public.admin_validate_owner_bootstrap_token(p_token text)
returns boolean
language sql
security definer
set search_path=''
as $$
  select exists (
    select 1
    from private.owner_bootstrap_tokens
    where id=1
      and expires_at>clock_timestamp()
      and token_hash=encode(extensions.digest(convert_to(coalesce(p_token,''),'UTF8'),'sha256'),'hex')
  );
$$;

create or replace function public.admin_consume_owner_bootstrap_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_deleted boolean:=false;
begin
  delete from private.owner_bootstrap_tokens
  where id=1
    and expires_at>clock_timestamp()
    and token_hash=encode(extensions.digest(convert_to(coalesce(p_token,''),'UTF8'),'sha256'),'hex');
  v_deleted:=found;
  return v_deleted;
end;
$$;

revoke execute on function public.admin_prepare_owner_bootstrap_token(uuid,text) from public,anon,authenticated;
revoke execute on function public.admin_validate_owner_bootstrap_token(text) from public,anon,authenticated;
revoke execute on function public.admin_consume_owner_bootstrap_token(text) from public,anon,authenticated;
grant execute on function public.admin_prepare_owner_bootstrap_token(uuid,text) to service_role;
grant execute on function public.admin_validate_owner_bootstrap_token(text) to service_role;
grant execute on function public.admin_consume_owner_bootstrap_token(text) to service_role;
