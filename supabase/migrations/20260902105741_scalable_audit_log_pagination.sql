-- Keep the central Audit Log responsive as history grows. The private view
-- keeps the existing event sources in one place, while the public owner-only
-- RPC applies filters and keyset cursors before returning one small page.
create or replace view private.central_audit_events_live
with (security_invoker = true)
as
select
  'audit:' || audit.id::text as event_key,
  audit.occurred_at,
  audit.actor_id,
  audit.actor_name,
  audit.actor_level,
  audit.action,
  audit.entity_type,
  audit.entity_id,
  audit.warehouse_id,
  audit.changed_fields,
  audit.before_data,
  audit.after_data,
  audit.source,
  audit.summary
from public.audit_logs audit

union all

select
  'stock:' || adjustment.id::text,
  adjustment.created_at,
  adjustment.created_by,
  adjustment.created_by_name,
  profile.level,
  'stock_adjusted',
  'inventory_count',
  adjustment.document_no,
  adjustment.warehouse_id,
  array['stock']::text[],
  null::jsonb,
  jsonb_build_object(
    'reason', adjustment.reason,
    'note', adjustment.note,
    'lineCount', adjustment.line_count,
    'sourceInspectionId', adjustment.source_inspection_id
  ),
  'inventory_count_adjustments',
  'ยืนยันผลตรวจนับและปรับสต๊อก'
from public.inventory_count_adjustments adjustment
left join public.profiles profile on profile.id = adjustment.created_by

union all

select
  'unit:' || unit_change.id::text,
  unit_change.created_at,
  unit_change.changed_by,
  coalesce(
    nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
    profile.username
  ),
  profile.level,
  'unit_changed',
  'product',
  unit_change.product_id::text,
  null::bigint,
  array['unit']::text[],
  jsonb_build_object('unit', unit_change.old_unit),
  jsonb_build_object(
    'unit', unit_change.new_unit,
    'conversionFactor', unit_change.conversion_factor,
    'balanceChanges', unit_change.balance_changes
  ),
  'product_unit_changes',
  'เปลี่ยนหน่วยสินค้าหลัก'
from public.product_unit_changes unit_change
left join public.profiles profile on profile.id = unit_change.changed_by

union all

select
  'expiry:' || expiry_audit.id::text,
  expiry_audit.created_at,
  expiry_audit.actor_id,
  coalesce(
    nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
    profile.username
  ),
  profile.level,
  'lot_expiry_changed',
  'inventory_lot',
  expiry_audit.lot_id::text,
  expiry_audit.warehouse_id,
  array['expiry']::text[],
  jsonb_build_object(
    'expiry', expiry_audit.old_expiry,
    'productId', expiry_audit.product_id
  ),
  jsonb_build_object(
    'expiry', expiry_audit.new_expiry,
    'productId', expiry_audit.product_id
  ),
  expiry_audit.source,
  'แก้ไขวันหมดอายุ Lot'
from private.inventory_lot_detail_audit expiry_audit
left join public.profiles profile on profile.id = expiry_audit.actor_id

union all

select
  'reset:' || reset_audit.id::text,
  reset_audit.reset_at,
  reset_audit.actor_id,
  reset_audit.actor_username,
  profile.level,
  'store_reset',
  'store_reset',
  reset_audit.id::text,
  null::bigint,
  array['record']::text[],
  null::jsonb,
  jsonb_build_object(
    'mode', reset_audit.mode,
    'rowCounts', reset_audit.row_counts
  ),
  'store_reset_audit',
  'ล้างข้อมูลระบบแบบควบคุม'
from private.store_reset_audit reset_audit
left join public.profiles profile on profile.id = reset_audit.actor_id

union all

select
  'lot-reallocation:' || coalesce(movement.reference_id, min(movement.id)::text),
  max(movement.created_at),
  movement.created_by,
  coalesce(
    nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
    profile.username
  ),
  profile.level,
  'lot_reallocated',
  'inventory_lot',
  coalesce(movement.reference_id, min(movement.id)::text),
  movement.warehouse_id,
  array['lot_quantity']::text[],
  null::jsonb,
  jsonb_build_object(
    'productId', movement.product_id,
    'movements', jsonb_agg(
      jsonb_build_object(
        'lotId', movement.lot_id,
        'quantityDelta', movement.quantity_delta,
        'balanceAfter', movement.balance_after
      ) order by movement.id
    )
  ),
  'inventory_lot_movements',
  max(movement.note)
from public.inventory_lot_movements movement
left join public.profiles profile on profile.id = movement.created_by
where movement.reference_type = 'lot_reallocation'
group by
  movement.reference_id,
  movement.product_id,
  movement.warehouse_id,
  movement.created_by,
  profile.first_name,
  profile.last_name,
  profile.username,
  profile.level;

revoke all on table private.central_audit_events_live
from public, anon, authenticated, service_role;

create or replace function public.get_central_audit_log_page(
  p_limit integer default 20,
  p_cursor_time timestamptz default null,
  p_cursor_key text default null,
  p_direction text default 'first',
  p_search text default '',
  p_entity text default null,
  p_action text default null,
  p_include_total boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
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
  if v_direction not in ('first', 'previous', 'next', 'last') then
    raise exception 'invalid audit log page direction';
  end if;
  if v_direction in ('previous', 'next')
     and (p_cursor_time is null or nullif(p_cursor_key, '') is null) then
    raise exception 'audit log cursor is required';
  end if;

  if coalesce(p_include_total, false) then
    select count(*)
    into v_total_count
    from private.central_audit_events_live event
    where (v_entity is null or event.entity_type = v_entity)
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

  if v_direction in ('previous', 'last') then
    with candidates as materialized (
      select event.*
      from private.central_audit_events_live event
      where (v_entity is null or event.entity_type = v_entity)
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
      limit v_limit + 1
    ), page_rows as (
      select *
      from candidates
      order by occurred_at asc, event_key asc
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

    v_has_newer := v_candidate_count > v_limit;
    v_has_older := v_direction = 'previous' and jsonb_array_length(v_rows) > 0;
  else
    with candidates as materialized (
      select event.*
      from private.central_audit_events_live event
      where (v_entity is null or event.entity_type = v_entity)
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
$$;

revoke all on function public.get_central_audit_log_page(
  integer, timestamptz, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.get_central_audit_log_page(
  integer, timestamptz, text, text, text, text, text, boolean
) to authenticated;

-- These indexes match the date ordering used by the global Audit Log. They
-- avoid sorting entire source tables before applying the small page limit.
create index if not exists inventory_count_adjustments_audit_page_idx
  on public.inventory_count_adjustments(created_at desc, id desc);
create index if not exists product_unit_changes_audit_page_idx
  on public.product_unit_changes(created_at desc, id desc);
create index if not exists inventory_lot_detail_audit_page_idx
  on private.inventory_lot_detail_audit(created_at desc, id desc);
create index if not exists store_reset_audit_page_idx
  on private.store_reset_audit(reset_at desc, id desc);
create index if not exists inventory_lot_reallocation_audit_page_idx
  on public.inventory_lot_movements(created_at desc, reference_id, id)
  where reference_type = 'lot_reallocation';

-- The bounded cleanup function already caps one run at 5,000 rows. Use that
-- capacity so a busy shop cannot create expired rows faster than archiving.
select cron.schedule(
  'pepos-bounded-data-retention',
  '17 17 * * *',
  $cron$select private.run_data_retention(5000);$cron$
);

comment on function public.get_central_audit_log_page(
  integer, timestamptz, text, text, text, text, text, boolean
) is 'Owner-only filtered keyset pagination for the central Audit Log.';
