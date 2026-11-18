-- One calendar year of audit history, with Bangkok date boundaries.
create or replace function private.audit_log_retention_cutoff()
returns timestamptz language sql stable set search_path = ''
as $$ select ((now() at time zone 'Asia/Bangkok')::date - interval '1 year') at time zone 'Asia/Bangkok' $$;
revoke all on function private.audit_log_retention_cutoff() from public, anon, authenticated, service_role;

create index if not exists audit_logs_archive_occurred_at_idx on private.audit_logs_archive(occurred_at);
create or replace function private.prune_audit_log_history(p_batch_size integer default 5000)
returns bigint language plpgsql security invoker
set search_path = '' set lock_timeout = '2s' set statement_timeout = '5min'
as $$
declare
  v_cutoff timestamptz := private.audit_log_retention_cutoff();
  v_batch integer := greatest(1,least(coalesce(p_batch_size,5000),5000));
  v_count integer;
  v_total bigint := 0;
begin
  -- Only audit storage is deleted; source documents and stock ledgers stay intact.
  loop
    with candidates as (
      select id from public.audit_logs where occurred_at < v_cutoff
      order by occurred_at,id limit v_batch for update skip locked
    )
    delete from public.audit_logs a using candidates c where a.id=c.id;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
    exit when v_count = 0;
  end loop;
  loop
    with candidates as (
      select id from private.audit_logs_archive where occurred_at < v_cutoff
      order by occurred_at,id limit v_batch for update skip locked
    )
    delete from private.audit_logs_archive a using candidates c where a.id=c.id;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
    exit when v_count = 0;
  end loop;
  return v_total;
end;
$$;
revoke all on function private.prune_audit_log_history(integer) from public, anon, authenticated, service_role;
update public.data_retention_policies
set retention_days=365, archive_before_delete=false,
    note='เก็บ AUDIT LOG ย้อนหลัง 1 ปีปฏิทิน ลบอัตโนมัติทุกวันตามเวลาไทย ไม่เก็บ archive',
    updated_at=clock_timestamp()
where data_type='audit_logs';

CREATE OR REPLACE FUNCTION private.run_data_retention(p_batch_size integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '2s'
 SET statement_timeout TO '5min'
AS $function$
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
  v_audit_deleted := private.prune_audit_log_history(v_batch);

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
    'audit_logs_deleted', v_audit_deleted,
    'print_events_deleted', v_print_deleted,
    'sync_events_deleted', v_sync_deleted,
    'operation_ledger_deleted', v_operation_deleted,
    'cron_job_runs_deleted', v_cron_deleted,
    'batch_size', v_batch,
    'finished_at', clock_timestamp()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_central_audit_log_page(p_warehouse_id bigint, p_date_from date, p_date_to date, p_limit integer DEFAULT 20, p_cursor_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_key text DEFAULT NULL::text, p_direction text DEFAULT 'first'::text, p_search text DEFAULT ''::text, p_entity text DEFAULT NULL::text, p_action text DEFAULT NULL::text, p_include_total boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '15s'
AS $function$
declare
  v_date_from timestamptz := greatest(private.audit_log_retention_cutoff(), p_date_from::timestamp at time zone 'Asia/Bangkok');
  v_date_until timestamptz := (p_date_to + 1)::timestamp at time zone 'Asia/Bangkok';
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_page_limit integer := v_limit;
  v_direction text := lower(btrim(coalesce(p_direction, 'first')));
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_entity text := nullif(nullif(lower(btrim(coalesce(p_entity, ''))), 'all'), '');
  v_action text := nullif(nullif(lower(btrim(coalesce(p_action, ''))), 'all'), '');
  v_rows jsonb := '[]'::jsonb;
  v_candidate_count integer := 0;
  v_total_count bigint := null;
  v_has_newer boolean := false;
  v_has_older boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner access required';
  end if;
  if p_date_from > p_date_to then
    raise exception 'วันเริ่มต้นต้องไม่เกินวันสิ้นสุด';
  end if;
  if v_direction not in ('first', 'previous', 'next', 'last') then
    raise exception 'invalid audit log page direction';
  end if;
  if v_direction in ('previous', 'next')
     and (p_cursor_time is null or nullif(p_cursor_key, '') is null) then
    raise exception 'audit log cursor is required';
  end if;

  if coalesce(p_include_total, false) or v_direction = 'last' then
    select count(*)
    into v_total_count
    from private.central_audit_events_live event
    where coalesce(event.warehouse_id,1)=p_warehouse_id
      and event.occurred_at >= v_date_from
      and (v_date_until is null or event.occurred_at < v_date_until)
      and (v_entity is null or event.entity_type = v_entity)
      and (v_action is null or event.action = v_action)
      and (
        v_search = ''
        or lower(concat_ws(
          ' ', event.actor_name, event.entity_id, event.summary,
          event.entity_type, event.action,
          coalesce(event.before_data::text, ''),
          coalesce(event.after_data::text, '')
        )) like '%' || v_search || '%'
      );
  end if;

  if v_direction = 'last' and v_total_count > 0 then
    v_page_limit := case
      when mod(v_total_count, v_limit) = 0 then v_limit
      else mod(v_total_count, v_limit)::integer
    end;
  end if;

  if v_direction in ('previous', 'last') then
    with candidates as materialized (
      select event.*
      from private.central_audit_events_live event
      where coalesce(event.warehouse_id,1)=p_warehouse_id
      and event.occurred_at >= v_date_from
      and (v_date_until is null or event.occurred_at < v_date_until)
      and (v_entity is null or event.entity_type = v_entity)
        and (v_action is null or event.action = v_action)
        and (
          v_search = ''
          or lower(concat_ws(
            ' ', event.actor_name, event.entity_id, event.summary,
            event.entity_type, event.action,
            coalesce(event.before_data::text, ''),
            coalesce(event.after_data::text, '')
          )) like '%' || v_search || '%'
        )
        and (
          v_direction = 'last'
          or (event.occurred_at, event.event_key) > (p_cursor_time, p_cursor_key)
        )
      order by event.occurred_at asc, event.event_key asc
      limit v_page_limit + 1
    ), page_rows as (
      select *
      from candidates
      order by occurred_at asc, event_key asc
      limit v_page_limit
    )
    select
      coalesce(
        jsonb_agg(to_jsonb(page_rows) order by occurred_at desc, event_key desc),
        '[]'::jsonb
      ),
      (select count(*) from candidates)
    into v_rows, v_candidate_count
    from page_rows;

    v_has_newer := v_candidate_count > v_page_limit;
    v_has_older := v_direction = 'previous' and jsonb_array_length(v_rows) > 0;
  else
    with candidates as materialized (
      select event.*
      from private.central_audit_events_live event
      where coalesce(event.warehouse_id,1)=p_warehouse_id
      and event.occurred_at >= v_date_from
      and (v_date_until is null or event.occurred_at < v_date_until)
      and (v_entity is null or event.entity_type = v_entity)
        and (v_action is null or event.action = v_action)
        and (
          v_search = ''
          or lower(concat_ws(
            ' ', event.actor_name, event.entity_id, event.summary,
            event.entity_type, event.action,
            coalesce(event.before_data::text, ''),
            coalesce(event.after_data::text, '')
          )) like '%' || v_search || '%'
        )
        and (
          v_direction = 'first'
          or (event.occurred_at, event.event_key) < (p_cursor_time, p_cursor_key)
        )
      order by event.occurred_at desc, event.event_key desc
      limit v_limit + 1
    ), page_rows as (
      select *
      from candidates
      order by occurred_at desc, event_key desc
      limit v_limit
    )
    select
      coalesce(
        jsonb_agg(to_jsonb(page_rows) order by occurred_at desc, event_key desc),
        '[]'::jsonb
      ),
      (select count(*) from candidates)
    into v_rows, v_candidate_count
    from page_rows;

    v_has_older := v_candidate_count > v_limit;
    v_has_newer := v_direction = 'next' and jsonb_array_length(v_rows) > 0;
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'totalCount', v_total_count,
    'hasNewer', v_has_newer,
    'hasOlder', v_has_older
  );
end;
$function$;


revoke all on function public.get_central_audit_log_page(bigint,date,date,integer,timestamptz,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.get_central_audit_log_page(bigint,date,date,integer,timestamptz,text,text,text,text,text,boolean) to authenticated;
-- Older app tabs retain their original RPC signature and the same retention limit.
create or replace function public.get_central_audit_log_page(
  p_warehouse_id bigint, p_limit integer default 20,
  p_cursor_time timestamptz default null, p_cursor_key text default null,
  p_direction text default 'first', p_search text default '',
  p_entity text default null, p_action text default null, p_include_total boolean default false
) returns jsonb language sql security invoker set search_path = '' as $$
  select public.get_central_audit_log_page(p_warehouse_id,null::date,null::date,p_limit,p_cursor_time,p_cursor_key,p_direction,p_search,p_entity,p_action,p_include_total)
$$;
revoke all on function public.get_central_audit_log_page(bigint,integer,timestamptz,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.get_central_audit_log_page(bigint,integer,timestamptz,text,text,text,text,text,boolean) to authenticated;
-- Reuse the existing daily job, 00:17 Bangkok (17:17 UTC), without a duplicate.
select cron.schedule('pepos-bounded-data-retention','17 17 * * *','select private.run_data_retention(5000);');
comment on function private.run_data_retention(integer)
is 'Deletes expired audit history and applies existing retention for other operational data; preserves business documents.';
notify pgrst, 'reload schema';
