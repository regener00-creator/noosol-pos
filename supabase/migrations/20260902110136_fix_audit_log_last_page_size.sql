-- The last keyset page can contain fewer than p_limit rows. Use the exact
-- remainder so it never overlaps the preceding page.
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
