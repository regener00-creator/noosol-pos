-- Safe follow-up for new-table findings reported by Supabase Advisors.

create index if not exists profile_page_permissions_warehouse_idx
  on public.profile_page_permissions(warehouse_id)
  where warehouse_id is not null;

create index if not exists print_events_warehouse_idx
  on public.print_events(warehouse_id)
  where warehouse_id is not null;

drop policy if exists owner_recovery_codes_deny_authenticated
  on public.owner_recovery_codes;
create policy owner_recovery_codes_deny_authenticated
on public.owner_recovery_codes for all
to authenticated
using (false)
with check (false);

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'private.audit_logs_archive'::regclass
      and contype = 'p'
  ) then
    alter table private.audit_logs_archive
      add constraint audit_logs_archive_pkey
      primary key using index audit_logs_archive_id_idx;
  end if;
end;
$migration$;
