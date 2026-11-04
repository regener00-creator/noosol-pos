create table private.note_positions (
  note_id uuid primary key references public.notes(id) on delete cascade,
  position bigint not null check (position > 0)
);

-- Updating an article and reordering it from another computer must not overwrite each other.
create function public.owner_save_knowledge_articles(p_expected jsonb,p_value jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare stored jsonb;
begin
  if auth.uid() is null or not coalesce(private.is_current_owner(),false) then
    raise exception 'owner access required' using errcode='42501';
  end if;
  perform private.acquire_store_mutation_gate();
  perform pg_advisory_xact_lock(hashtextextended('sapuri.knowledge_articles',0));
  select value into stored from public.settings where key='knowledge_articles' for update;
  if stored is distinct from p_expected then
    raise exception 'ข้อมูลถูกแก้ไขจากเครื่องอื่นแล้ว กรุณาโหลดข้อมูลล่าสุด';
  end if;
  perform public.owner_set_setting('knowledge_articles',p_value);
end $$;
revoke all on function public.owner_save_knowledge_articles(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.owner_save_knowledge_articles(jsonb,jsonb) to authenticated;
alter table private.note_positions enable row level security;
grant select on private.note_positions to authenticated;
create policy read_visible_note_positions on private.note_positions for select to authenticated
  using (exists (select 1 from public.notes n where n.id = note_id));

create function public.owner_move_note(p_source uuid, p_target uuid, p_after boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
  insertion integer;
begin
  if auth.uid() is null or not coalesce(private.is_current_owner(),false) then
    raise exception 'owner access required' using errcode='42501';
  end if;
  perform private.acquire_store_mutation_gate();
  perform pg_advisory_xact_lock(hashtextextended('sapuri.note_positions',0));
  select array_agg(n.id order by coalesce(r.position,0), n.updated_at desc, n.id desc)
    into ids from public.notes n left join private.note_positions r on r.note_id=n.id
    where n.activity_type is null and n.representative_id is null;
  if p_source=p_target or array_position(ids,p_source) is null or array_position(ids,p_target) is null then
    raise exception 'Invalid note selection';
  end if;
  ids := array_remove(ids,p_source);
  insertion := array_position(ids,p_target) - case when p_after then 0 else 1 end;
  ids := ids[1:insertion] || array[p_source] || ids[insertion+1:cardinality(ids)];
  insert into private.note_positions as r(note_id,position)
    select id, ord from unnest(ids) with ordinality as items(id,ord)
    on conflict (note_id) do update set position=excluded.position
    where r.position<>excluded.position;
end $$;
revoke all on function public.owner_move_note(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.owner_move_note(uuid,uuid,boolean) to authenticated;

create or replace function public.get_notes_page(
  p_search text default null, p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null, p_limit integer default 100
) returns setof public.notes language plpgsql stable security invoker set search_path = '' as $$
declare
  query_text text := lower(nullif(btrim(p_search),''));
  cursor_position bigint := coalesce((select position from private.note_positions where note_id=p_cursor_id),0);
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  return query
    select n.* from public.notes n left join private.note_positions r on r.note_id=n.id
    where n.activity_type is null and n.representative_id is null
      and (query_text is null or lower(coalesce(n.title,'') || ' ' || coalesce(n.content_html,'')) like '%' || query_text || '%')
      and (p_cursor_updated_at is null or coalesce(r.position,0)>cursor_position
        or (coalesce(r.position,0)=cursor_position and (n.updated_at,n.id)<(p_cursor_updated_at,p_cursor_id)))
    order by coalesce(r.position,0),n.updated_at desc,n.id desc
    limit least(greatest(coalesce(p_limit,100),1),100)+1;
end $$;
