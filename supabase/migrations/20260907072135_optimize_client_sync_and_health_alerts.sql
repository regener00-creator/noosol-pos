-- Keep product caches incremental across devices. The browser stores the last
-- change_id that it applied and downloads only later product mutations.
create table if not exists public.product_change_log (
  change_id bigint generated always as identity primary key,
  product_id bigint not null,
  operation text not null check (operation in ('insert','update','delete')),
  revision bigint,
  changed_at timestamptz not null default clock_timestamp()
);

alter table public.product_change_log enable row level security;
revoke all on table public.product_change_log from public, anon, authenticated;
grant select on table public.product_change_log to authenticated;

drop policy if exists product_change_log_authenticated_read
  on public.product_change_log;
create policy product_change_log_authenticated_read
on public.product_change_log for select
to authenticated
using ((select auth.uid()) is not null);

create or replace function private.capture_product_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id bigint;
  v_revision bigint;
  v_operation text;
begin
  v_product_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_revision := case when tg_op = 'DELETE' then old.revision else new.revision end;
  v_operation := lower(tg_op);

  insert into public.product_change_log(product_id, operation, revision)
  values (v_product_id, v_operation, v_revision);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.capture_product_change()
  from public, anon, authenticated, service_role;

drop trigger if exists products_capture_change on public.products;
create trigger products_capture_change
after insert or update or delete on public.products
for each row execute function private.capture_product_change();

-- A device that has been offline longer than this window performs one full
-- product reload, then resumes small delta reads. This bounds log growth.
create or replace function private.prune_product_change_log()
returns bigint
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '2min'
as $$
declare
  v_deleted bigint := 0;
begin
  with candidates as materialized (
    select change_id
    from public.product_change_log
    where changed_at < clock_timestamp() - interval '365 days'
    order by change_id
    limit 5000
    for update skip locked
  )
  delete from public.product_change_log log
  using candidates
  where log.change_id = candidates.change_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.prune_product_change_log()
  from public, anon, authenticated, service_role;

select cron.schedule(
  'pepos-product-change-log-retention',
  '27 17 * * *',
  $cron$select private.prune_product_change_log();$cron$
);

-- Owners can close a stale conflict created by another device after reviewing
-- it from the central sync dialog.
create or replace function public.owner_resolve_sync_event(
  p_event_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.owner is true
      and profile.level = 1
  ) then
    raise exception 'owner permission required' using errcode = '42501';
  end if;

  update public.sync_events
  set status = 'resolved', resolved_at = clock_timestamp()
  where id = p_event_id and status = 'open';

  return found;
end;
$$;

revoke all on function public.owner_resolve_sync_event(uuid)
  from public, anon, authenticated;
grant execute on function public.owner_resolve_sync_event(uuid)
  to authenticated;

-- Lightweight owner-only health endpoint used once per day by the browser.
-- It avoids granting clients direct access to Postgres catalog functions.
create or replace function public.get_owner_database_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bytes bigint;
begin
  if (select auth.uid()) is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.owner is true
      and profile.level = 1
  ) then
    raise exception 'owner permission required' using errcode = '42501';
  end if;

  v_bytes := pg_database_size(current_database());
  return jsonb_build_object(
    'databaseBytes', v_bytes,
    'warningBytes', 100 * 1024 * 1024,
    'criticalBytes', 250 * 1024 * 1024,
    'level', case
      when v_bytes >= 250 * 1024 * 1024 then 'critical'
      when v_bytes >= 100 * 1024 * 1024 then 'warning'
      else 'normal'
    end,
    'checkedAt', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_owner_database_health()
  from public, anon, authenticated;
grant execute on function public.get_owner_database_health()
  to authenticated;

comment on table public.product_change_log is
  'Bounded product metadata change feed used by IndexedDB clients for delta sync.';
comment on function public.owner_resolve_sync_event(uuid) is
  'Owner-only action for closing a reviewed sync conflict from any device.';
comment on function public.get_owner_database_health() is
  'Owner-only database size check with 100 MB and 250 MB alert thresholds.';
