create or replace function public.get_representative_note_metadata(
  p_representative_ids bigint[],
  p_note_ids uuid[] default array[]::uuid[]
) returns table(
  representative_id bigint,
  note_id uuid,
  note_number bigint,
  note_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if coalesce(cardinality(p_representative_ids),0) > 50 then
    raise exception 'too many representatives requested';
  end if;
  if coalesce(cardinality(p_note_ids),0) > 500 then
    raise exception 'too many notes requested';
  end if;

  return query
  with requested as (
    select distinct requested_id as representative_id
    from unnest(coalesce(p_representative_ids,array[]::bigint[])) requested_id
    where requested_id is not null
  ), ranked as (
    select
      note.representative_id,
      note.id as note_id,
      row_number() over (
        partition by note.representative_id
        order by note.created_at asc nulls first,note.id asc
      ) as note_number,
      count(*) over (partition by note.representative_id) as note_count
    from public.notes note
    join requested on requested.representative_id=note.representative_id
    where note.activity_type is not null
  ), totals as (
    select ranked.representative_id,max(ranked.note_count)::bigint as note_count
    from ranked
    group by ranked.representative_id
  ), requested_notes as (
    select ranked.*
    from ranked
    where ranked.note_id=any(coalesce(p_note_ids,array[]::uuid[]))
  )
  select
    requested.representative_id,
    requested_notes.note_id,
    requested_notes.note_number,
    coalesce(totals.note_count,0)::bigint
  from requested
  left join totals on totals.representative_id=requested.representative_id
  left join requested_notes on requested_notes.representative_id=requested.representative_id
  order by requested.representative_id,requested_notes.note_number desc nulls last;
end;
$$;

revoke all on function public.get_representative_note_metadata(bigint[],uuid[]) from public,anon;
grant execute on function public.get_representative_note_metadata(bigint[],uuid[]) to authenticated,service_role;

comment on function public.get_representative_note_metadata(bigint[],uuid[])
is 'Returns stable chronological NOTE numbers and total NOTE counts for representative history cards and detail pages.';
