-- Bound diagnostic payloads, aggregate repeated open sync failures, and run
-- retention in small lock-friendly batches. Deliberately do not rewrite the
-- products table here: exclusive table rewrites require a maintenance window.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant select, delete on table cron.job_run_details to postgres;

-- JSON payloads are diagnostics, not document storage. Keep both the RPC and
-- the table protected so a future service-role writer cannot bypass the cap.
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.print_events'::regclass
      and conname = 'print_events_metadata_bounded'
  ) then
    alter table public.print_events
      add constraint print_events_metadata_bounded
      check (
        jsonb_typeof(metadata) = 'object'
        and octet_length(metadata::text) <= 16384
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sync_events'::regclass
      and conname = 'sync_events_context_bounded'
  ) then
    alter table public.sync_events
      add constraint sync_events_context_bounded
      check (
        jsonb_typeof(context) = 'object'
        and octet_length(context::text) <= 16384
      ) not valid;
  end if;
end;
$migration$;

alter table public.print_events
  validate constraint print_events_metadata_bounded;
alter table public.sync_events
  validate constraint sync_events_context_bounded;

create index if not exists print_events_printed_at_idx
  on public.print_events(printed_at, id);
create index if not exists sync_events_occurred_at_idx
  on public.sync_events(occurred_at, id);

create or replace function public.record_print_event(
  p_document_type text,
  p_document_id text,
  p_print_kind text,
  p_copies integer,
  p_warehouse_id bigint,
  p_metadata jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_name text;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if btrim(coalesce(p_document_type, '')) = '' then
    raise exception 'document type is required';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'print metadata must be a JSON object';
  end if;
  if octet_length(v_metadata::text) > 16384 then
    raise exception 'print metadata exceeds 16 KiB';
  end if;
  if p_warehouse_id is not null
     and not private.is_current_owner()
     and not exists (
       select 1 from public.profile_warehouse_access access
       where access.user_id = v_actor
         and access.warehouse_id = p_warehouse_id
     ) then
    raise exception 'warehouse access denied';
  end if;

  select coalesce(nullif(btrim(profile.first_name), ''), profile.username, 'ผู้ใช้งาน')
  into v_name
  from public.profiles profile
  where profile.id = v_actor;

  insert into public.print_events(
    actor_id, actor_name, document_type, document_id, print_kind,
    copies, warehouse_id, metadata
  ) values (
    v_actor, v_name, left(btrim(p_document_type), 80),
    nullif(left(btrim(coalesce(p_document_id, '')), 160), ''),
    left(btrim(coalesce(p_print_kind, 'print')), 40),
    greatest(1, least(coalesce(p_copies, 1), 100)),
    p_warehouse_id,
    v_metadata
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_print_event(
  text, text, text, integer, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.record_print_event(
  text, text, text, integer, bigint, jsonb
) to authenticated;

-- The fixed-length key keeps the open-event unique index small even when a
-- message is long. actor_id remains a separate index key for account isolation.
create or replace function private.sync_event_dedupe_key(
  p_device_id text,
  p_severity text,
  p_category text,
  p_operation text,
  p_table_name text,
  p_record_id text,
  p_error_code text,
  p_message text
) returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_array(
          nullif(left(btrim(coalesce(p_device_id, '')), 120), ''),
          case when p_severity in ('info','warning','error','fatal') then p_severity else 'error' end,
          left(btrim(coalesce(p_category, 'sync')), 60),
          left(btrim(coalesce(p_operation, '')), 120),
          nullif(left(btrim(coalesce(p_table_name, '')), 80), ''),
          nullif(left(btrim(coalesce(p_record_id, '')), 160), ''),
          nullif(left(btrim(coalesce(p_error_code, '')), 80), ''),
          left(btrim(coalesce(p_message, '')), 1000)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function private.sync_event_dedupe_key(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;

alter table public.sync_events
  add column if not exists first_occurred_at timestamptz,
  add column if not exists occurrence_count bigint not null default 1,
  add column if not exists dedupe_key text;

update public.sync_events event
set first_occurred_at = coalesce(event.first_occurred_at, event.occurred_at),
    occurrence_count = greatest(event.occurrence_count, 1),
    dedupe_key = private.sync_event_dedupe_key(
      event.device_id, event.severity, event.category, event.operation,
      event.table_name, event.record_id, event.error_code, event.message
    )
where event.first_occurred_at is null
   or event.dedupe_key is null
   or event.occurrence_count < 1;

alter table public.sync_events
  alter column first_occurred_at set default clock_timestamp(),
  alter column first_occurred_at set not null;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sync_events'::regclass
      and conname = 'sync_events_occurrence_count_positive'
  ) then
    alter table public.sync_events
      add constraint sync_events_occurrence_count_positive
      check (occurrence_count > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sync_events'::regclass
      and conname = 'sync_events_dedupe_key_format'
  ) then
    alter table public.sync_events
      add constraint sync_events_dedupe_key_format
      check (dedupe_key is null or dedupe_key ~ '^[0-9a-f]{64}$') not valid;
  end if;
end;
$migration$;

alter table public.sync_events
  validate constraint sync_events_occurrence_count_positive;
alter table public.sync_events
  validate constraint sync_events_dedupe_key_format;

-- Collapse duplicates already recorded before creating the unique partial
-- index. Keep the newest id for current UI ordering and preserve first/count.
with duplicate_groups as (
  select
    actor_id,
    dedupe_key,
    (array_agg(id order by occurred_at desc, id desc))[1] as keeper_id,
    min(first_occurred_at) as first_seen,
    sum(occurrence_count) as total_occurrences
  from public.sync_events
  where status = 'open'
    and actor_id is not null
    and dedupe_key is not null
  group by actor_id, dedupe_key
  having count(*) > 1
)
update public.sync_events event
set first_occurred_at = duplicate_groups.first_seen,
    occurrence_count = duplicate_groups.total_occurrences
from duplicate_groups
where event.id = duplicate_groups.keeper_id;

with duplicate_groups as (
  select
    actor_id,
    dedupe_key,
    (array_agg(id order by occurred_at desc, id desc))[1] as keeper_id
  from public.sync_events
  where status = 'open'
    and actor_id is not null
    and dedupe_key is not null
  group by actor_id, dedupe_key
  having count(*) > 1
)
delete from public.sync_events event
using duplicate_groups
where event.status = 'open'
  and event.actor_id = duplicate_groups.actor_id
  and event.dedupe_key = duplicate_groups.dedupe_key
  and event.id <> duplicate_groups.keeper_id;

-- These rows predate this migration and were confirmed to be historical event
-- records rather than an active local queue. Preserve them, but close them so
-- the owner view reflects the current healthy sync state.
update public.sync_events event
set status = 'resolved',
    resolved_at = coalesce(event.resolved_at, clock_timestamp())
where event.status = 'open'
  and event.occurred_at < timestamptz '2026-09-01 15:36:01+00';

create unique index if not exists sync_events_open_dedupe_idx
  on public.sync_events(actor_id, dedupe_key)
  where status = 'open'
    and actor_id is not null
    and dedupe_key is not null;

create or replace function public.report_client_event(
  p_device_id text,
  p_severity text,
  p_category text,
  p_operation text,
  p_table_name text,
  p_record_id text,
  p_error_code text,
  p_message text,
  p_context jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_now timestamptz := clock_timestamp();
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_severity text := case
    when p_severity in ('info','warning','error','fatal') then p_severity
    else 'error'
  end;
  v_category text := left(btrim(coalesce(p_category, 'sync')), 60);
  v_operation text := left(btrim(coalesce(p_operation, '')), 120);
  v_table_name text := nullif(left(btrim(coalesce(p_table_name, '')), 80), '');
  v_record_id text := nullif(left(btrim(coalesce(p_record_id, '')), 160), '');
  v_error_code text := nullif(left(btrim(coalesce(p_error_code, '')), 80), '');
  v_message text := left(btrim(coalesce(p_message, '')), 1000);
  v_device_id text := nullif(left(btrim(coalesce(p_device_id, '')), 120), '');
  v_dedupe_key text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if v_operation = '' or v_message = '' then
    raise exception 'operation and message are required';
  end if;
  if jsonb_typeof(v_context) <> 'object' then
    raise exception 'sync context must be a JSON object';
  end if;
  if octet_length(v_context::text) > 16384 then
    raise exception 'sync context exceeds 16 KiB';
  end if;

  v_dedupe_key := private.sync_event_dedupe_key(
    v_device_id, v_severity, v_category, v_operation,
    v_table_name, v_record_id, v_error_code, v_message
  );

  insert into public.sync_events as existing(
    actor_id, device_id, severity, category, operation,
    table_name, record_id, error_code, message, context,
    first_occurred_at, occurrence_count, occurred_at, dedupe_key
  ) values (
    v_actor, v_device_id, v_severity, v_category, v_operation,
    v_table_name, v_record_id, v_error_code, v_message, v_context,
    v_now, 1, v_now, v_dedupe_key
  )
  on conflict (actor_id, dedupe_key)
    where status = 'open'
      and actor_id is not null
      and dedupe_key is not null
  do update
  set occurrence_count = existing.occurrence_count + 1,
      occurred_at = excluded.occurred_at,
      context = excluded.context
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.report_client_event(
  text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.report_client_event(
  text, text, text, text, text, text, text, text, jsonb
) to authenticated;

create or replace function public.resolve_sync_event(
  p_event_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_resolved boolean := false;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  update public.sync_events event
  set status = 'resolved',
      resolved_at = clock_timestamp()
  where event.id = p_event_id
    and event.status = 'open'
    and (
      event.actor_id = v_actor
      or private.is_current_owner()
    )
  returning true into v_resolved;

  return coalesce(v_resolved, false);
end;
$$;

revoke all on function public.resolve_sync_event(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_sync_event(uuid)
  to authenticated;

create or replace function public.resolve_own_sync_events(
  p_device_id text,
  p_through timestamptz default clock_timestamp()
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_device_id text := nullif(left(btrim(coalesce(p_device_id, '')), 120), '');
  v_resolved integer := 0;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if v_device_id is null then
    raise exception 'device id is required';
  end if;

  update public.sync_events event
  set status = 'resolved',
      resolved_at = clock_timestamp()
  where event.actor_id = v_actor
    and event.device_id = v_device_id
    and event.status = 'open'
    and event.occurred_at <= coalesce(p_through, clock_timestamp());
  get diagnostics v_resolved = row_count;

  return v_resolved;
end;
$$;

revoke all on function public.resolve_own_sync_events(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_own_sync_events(text, timestamptz)
  to authenticated;

insert into public.data_retention_policies(
  data_type, retention_days, archive_before_delete, note
) values
  ('operation_ledger', 2555, false, 'เก็บ request id ป้องกันธุรกรรมซ้ำ 7 ปี แม้อุปกรณ์กลับมา retry ภายหลัง'),
  ('cron_job_run_details', 30, false, 'เก็บประวัติการทำงานของงานอัตโนมัติ 30 วัน')
on conflict (data_type) do update
set retention_days = excluded.retention_days,
    archive_before_delete = excluded.archive_before_delete,
    note = excluded.note,
    updated_at = clock_timestamp();

create index if not exists operation_ledger_completed_idx
  on private.operation_ledger(completed_at, request_id)
  where completed_at is not null;

-- One call removes at most p_batch_size rows per application table. SKIP
-- LOCKED prevents a retention run from waiting on a live checkout transaction.
create or replace function private.run_data_retention(
  p_batch_size integer default 500
) returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '5min'
as $$
declare
  v_batch integer := greatest(1, least(coalesce(p_batch_size, 500), 5000));
  v_days integer;
  v_cutoff timestamptz;
  v_audit_deleted integer := 0;
  v_print_deleted integer := 0;
  v_sync_deleted integer := 0;
  v_operation_deleted integer := 0;
  v_cron_deleted integer := 0;
begin
  select retention_days into v_days
  from public.data_retention_policies
  where data_type = 'audit_logs';
  v_cutoff := clock_timestamp() - make_interval(days => coalesce(v_days, 2555));

  with candidates as materialized (
    select audit.id
    from public.audit_logs audit
    where audit.occurred_at < v_cutoff
    order by audit.occurred_at, audit.id
    limit v_batch
    for update skip locked
  ), archived as (
    insert into private.audit_logs_archive(
      id, occurred_at, actor_id, actor_name, actor_level, action,
      entity_type, entity_id, warehouse_id, changed_fields,
      before_data, after_data, source, summary, archived_at
    )
    select
      audit.id, audit.occurred_at, audit.actor_id, audit.actor_name,
      audit.actor_level, audit.action, audit.entity_type, audit.entity_id,
      audit.warehouse_id, audit.changed_fields, audit.before_data,
      audit.after_data, audit.source, audit.summary, clock_timestamp()
    from public.audit_logs audit
    join candidates on candidates.id = audit.id
    on conflict (id) do nothing
    returning id
  )
  delete from public.audit_logs audit
  using candidates
  where audit.id = candidates.id
    and (
      exists (select 1 from archived where archived.id = audit.id)
      or exists (
        select 1 from private.audit_logs_archive archive
        where archive.id = audit.id
      )
    );
  get diagnostics v_audit_deleted = row_count;

  select retention_days into v_days
  from public.data_retention_policies
  where data_type = 'print_events';
  v_cutoff := clock_timestamp() - make_interval(days => coalesce(v_days, 2555));
  with candidates as materialized (
    select event.id
    from public.print_events event
    where event.printed_at < v_cutoff
    order by event.printed_at, event.id
    limit v_batch
    for update skip locked
  )
  delete from public.print_events event
  using candidates
  where event.id = candidates.id;
  get diagnostics v_print_deleted = row_count;

  select retention_days into v_days
  from public.data_retention_policies
  where data_type = 'sync_events';
  v_cutoff := clock_timestamp() - make_interval(days => coalesce(v_days, 180));
  with candidates as materialized (
    select event.id
    from public.sync_events event
    where event.occurred_at < v_cutoff
    order by event.occurred_at, event.id
    limit v_batch
    for update skip locked
  )
  delete from public.sync_events event
  using candidates
  where event.id = candidates.id;
  get diagnostics v_sync_deleted = row_count;

  select retention_days into v_days
  from public.data_retention_policies
  where data_type = 'operation_ledger';
  v_cutoff := clock_timestamp() - make_interval(days => coalesce(v_days, 2555));
  with candidates as materialized (
    select ledger.request_id
    from private.operation_ledger ledger
    where ledger.completed_at is not null
      and ledger.completed_at < v_cutoff
    order by ledger.completed_at, ledger.request_id
    limit v_batch
    for update skip locked
  )
  delete from private.operation_ledger ledger
  using candidates
  where ledger.request_id = candidates.request_id;
  get diagnostics v_operation_deleted = row_count;

  select retention_days into v_days
  from public.data_retention_policies
  where data_type = 'cron_job_run_details';
  v_cutoff := clock_timestamp() - make_interval(days => coalesce(v_days, 30));
  with candidates as materialized (
    select run.runid
    from cron.job_run_details run
    where coalesce(run.end_time, run.start_time) < v_cutoff
      and run.status <> 'running'
    order by coalesce(run.end_time, run.start_time), run.runid
    limit greatest(v_batch, 1000)
    for update skip locked
  )
  delete from cron.job_run_details run
  using candidates
  where run.runid = candidates.runid;
  get diagnostics v_cron_deleted = row_count;

  return jsonb_build_object(
    'audit_logs_archived', v_audit_deleted,
    'print_events_deleted', v_print_deleted,
    'sync_events_deleted', v_sync_deleted,
    'operation_ledger_deleted', v_operation_deleted,
    'cron_job_runs_deleted', v_cron_deleted,
    'batch_size', v_batch,
    'finished_at', clock_timestamp()
  );
end;
$$;

revoke all on function private.run_data_retention(integer)
  from public, anon, authenticated, service_role;

-- The stable name makes this idempotent: cron.schedule replaces a job with the
-- same name instead of creating duplicates. 17:17 UTC is 00:17 in Bangkok.
select cron.schedule(
  'pepos-bounded-data-retention',
  '17 17 * * *',
  $cron$select private.run_data_retention(500);$cron$
);

comment on function private.run_data_retention(integer)
is 'Archives/deletes retained operational data in bounded SKIP LOCKED batches; never rewrites products.';
comment on column public.sync_events.occurrence_count
is 'Number of identical reports aggregated into this open event.';
comment on column public.sync_events.first_occurred_at
is 'First time this currently aggregated open event was reported; occurred_at is the latest time.';
comment on function public.resolve_sync_event(uuid)
is 'Lets an event owner or system owner close an open sync event without direct table-update permission.';
comment on function public.resolve_own_sync_events(text, timestamptz)
is 'Closes this actor and device open sync events through the successful sync time.';

-- A base-unit conversion changes the meaning of every current quantity for a
-- product. Enforce document blockers in Postgres because browser-side document
-- arrays may be lazy-loaded or date-filtered and therefore incomplete.
create or replace function private.document_data_references_product(
  p_data jsonb,
  p_product_id bigint,
  p_item_array_keys text[]
) returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_item jsonb;
  v_candidate text;
begin
  if p_product_id is null or p_product_id <= 0 then
    return false;
  end if;

  foreach v_key in array coalesce(p_item_array_keys, '{}'::text[])
  loop
    if jsonb_typeof(coalesce(p_data, '{}'::jsonb) -> v_key) <> 'array' then
      continue;
    end if;

    for v_item in
      select item.value
      from jsonb_array_elements(coalesce(p_data, '{}'::jsonb) -> v_key) item(value)
    loop
      v_candidate := case
        when coalesce(v_item ->> 'productId', '') ~ '^[1-9][0-9]{0,17}$'
          then v_item ->> 'productId'
        when coalesce(v_item ->> 'pid', '') ~ '^[1-9][0-9]{0,17}$'
          then v_item ->> 'pid'
        else null
      end;
      if v_candidate is not null and v_candidate::bigint = p_product_id then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$$;

revoke all on function private.document_data_references_product(
  jsonb, bigint, text[]
) from public, anon, authenticated, service_role;

create or replace function public.change_product_base_unit(
  p_product_id bigint,
  p_expected_old_unit text,
  p_new_unit text,
  p_conversion_factor numeric,
  p_product_data jsonb,
  p_price numeric,
  p_cost numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();

  -- Keep the core function's existing authorization contract before reading
  -- privileged document rows in this SECURITY DEFINER wrapper.
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not private.is_current_owner() then
    raise exception 'owner access required';
  end if;
  if p_product_id is null or p_product_id <= 0 then
    raise exception 'product is required';
  end if;

  if exists (
    select 1
    from public.sales sale
    where (
      coalesce(sale.status, '') = 'hold'
      or coalesce(sale.data ->> 'status', '') = 'hold'
    )
      and private.document_data_references_product(
        sale.data, p_product_id, array['items']::text[]
      )
  ) then
    raise exception 'cannot change base unit: a held sale references this product';
  end if;

  if exists (
    select 1
    from public.goods_receipts document
    where not private.inventory_document_is_posted(
      'goods_receipts', coalesce(document.data, '{}'::jsonb)
    )
      and private.document_data_references_product(
        document.data, p_product_id, array['items']::text[]
      )
  ) then
    raise exception 'cannot change base unit: a pending goods receipt references this product';
  end if;

  if exists (
    select 1
    from public.product_returns document
    where not private.inventory_document_is_posted(
      'product_returns', coalesce(document.data, '{}'::jsonb)
    )
      and private.document_data_references_product(
        document.data, p_product_id, array['items']::text[]
      )
  ) then
    raise exception 'cannot change base unit: a pending product return references this product';
  end if;

  -- Legacy transfers have no stockApplied key and status “บันทึกแล้ว”; the
  -- application treats those as already posted. Only explicit false is pending.
  if exists (
    select 1
    from public.transfers document
    where lower(coalesce(document.data ->> 'stockApplied', ''))
          in ('false', 'f', '0', 'no', 'off')
      and private.document_data_references_product(
        document.data, p_product_id, array['items']::text[]
      )
  ) then
    raise exception 'cannot change base unit: a pending transfer references this product';
  end if;

  -- An exchange remains pending after outgoing stock is posted and only stops
  -- blocking once the incoming side is applied or its completed status is set.
  if exists (
    select 1
    from public.product_exchanges document
    where not private.jsonb_flag_is_true(
      coalesce(document.data, '{}'::jsonb), 'incomingApplied'
    )
      and coalesce(document.data ->> 'status', '') <> 'รับสินค้ากลับแล้ว'
      and private.document_data_references_product(
        document.data,
        p_product_id,
        array['outgoingItems', 'incomingItems']::text[]
      )
  ) then
    raise exception 'cannot change base unit: a pending product exchange references this product';
  end if;

  return public.change_product_base_unit_core_20260831(
    p_product_id, p_expected_old_unit, p_new_unit, p_conversion_factor,
    p_product_data, p_price, p_cost
  );
end;
$$;

revoke all on function public.change_product_base_unit(
  bigint, text, text, numeric, jsonb, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.change_product_base_unit(
  bigint, text, text, numeric, jsonb, numeric, numeric
) to authenticated;

comment on function private.document_data_references_product(jsonb, bigint, text[])
is 'Safely checks productId/pid in selected JSONB item arrays without unsafe casts.';
