set local lock_timeout='5s';

-- Keep the original key (including backups and older clients) in the original shop.
create policy store_category_settings_read on public.settings as restrictive for select to authenticated
using ((key <> 'product_categories' and key not like 'product-categories:%')
  or exists(select 1 from public.warehouses w where settings.key =
    case when w.id=1 then 'product_categories' else 'product-categories:'||w.id::text end));

-- A NULL scope on an existing standalone note denotes shop 1. No historical text,
-- author, timestamp or manually saved list position needs to be rewritten.
alter table public.notes add column standalone_warehouse_id bigint references public.warehouses(id);
grant insert(standalone_warehouse_id) on public.notes to authenticated;
create index notes_standalone_shop on public.notes(coalesce(standalone_warehouse_id,1),updated_at desc,id desc)
  where representative_warehouse_id is null;
create function private.guard_standalone_note_store() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and coalesce(old.standalone_warehouse_id,1)<>coalesce(new.standalone_warehouse_id,1) then
    raise exception 'ไม่สามารถย้ายโน้ตไปคลังอื่น';
  end if;
  if new.representative_warehouse_id is not null or new.representative_id is not null or new.activity_type is not null then
    if new.standalone_warehouse_id is not null or (tg_op='UPDATE' and old.representative_warehouse_id is null and old.activity_type is null and old.representative_id is null) then
      raise exception 'ไม่สามารถเปลี่ยนโน้ตของร้านเป็นโน้ตผู้แทน';
    end if;
  elsif tg_op='INSERT' and new.standalone_warehouse_id is null then
    if current_setting('pepos.maintenance_reset',true)='on' and private.is_current_owner() then
      new.standalone_warehouse_id:=1;
    else
      raise exception 'กรุณาโหลดโปรแกรมใหม่และเลือกคลังก่อนสร้างโน้ต';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_standalone_note_store() from public,anon,authenticated;
create trigger notes_store_scope before insert or update on public.notes for each row execute function private.guard_standalone_note_store();
create policy standalone_note_store on public.notes as restrictive for all to authenticated
using (representative_warehouse_id is not null or exists(select 1 from public.warehouses w where w.id=coalesce(notes.standalone_warehouse_id,1)))
with check (representative_warehouse_id is not null or exists(select 1 from public.warehouses w where w.id=coalesce(notes.standalone_warehouse_id,1)));

-- Preserve hidden-note, creator and per-page restrictions, using the shop for standalone notes.
alter policy notes_read on public.notes using ((select private.is_current_owner()) or
  (not hidden_from_level2 and public.can_current_user_page('notes',case when representative_warehouse_id is null then coalesce(standalone_warehouse_id,1) end,'view')));
alter policy notes_insert on public.notes with check (created_by=(select auth.uid()) and
  public.can_current_user_page('notes',case when representative_warehouse_id is null then coalesce(standalone_warehouse_id,1) end,'create')
  and (not hidden_from_level2 or (select private.is_current_owner())));
alter policy notes_update on public.notes using ((select private.is_current_owner()) or
  (created_by=(select auth.uid()) and not hidden_from_level2 and public.can_current_user_page('notes',case when representative_warehouse_id is null then coalesce(standalone_warehouse_id,1) end,'edit')));
alter policy notes_update on public.notes with check ((select private.is_current_owner()) or
  (created_by=(select auth.uid()) and not hidden_from_level2 and public.can_current_user_page('notes',case when representative_warehouse_id is null then coalesce(standalone_warehouse_id,1) end,'edit')));
alter policy notes_delete on public.notes using ((select private.is_current_owner()) or
  (created_by=(select auth.uid()) and not hidden_from_level2 and public.can_current_user_page('notes',case when representative_warehouse_id is null then coalesce(standalone_warehouse_id,1) end,'delete')));

-- Filter before sorting, paginating or writing positions. Old clients can see/reorder only shop 1.
do $$
declare fn text; name text; proc regprocedure; scoped text;
begin
 foreach proc in array array['public.get_notes_page(text,timestamptz,uuid,integer)'::regprocedure,'public.owner_move_note(uuid,uuid,boolean)'::regprocedure] loop
   select proname into name from pg_proc where oid=proc;
   fn:=pg_get_functiondef(proc);
   if position('where n.activity_type is null and n.representative_id is null' in fn)=0 then raise exception 'Unexpected note function %',name; end if;
   scoped:=replace(fn,'where n.activity_type is null and n.representative_id is null',
     'where n.activity_type is null and n.representative_id is null and n.representative_warehouse_id is null and coalesce(n.standalone_warehouse_id,1)=p_warehouse_id');
   execute replace(scoped,'public.'||name||'(','public.'||name||'(p_warehouse_id bigint, ');
   execute replace(scoped,'=p_warehouse_id','=1');
 end loop;
end $$;
create or replace function public.owner_move_note(p_source uuid,p_target uuid,p_after boolean)
returns void language sql security invoker set search_path='' as $$
  select public.owner_move_note(1,p_source,p_target,p_after)
$$;
revoke all on function public.get_notes_page(bigint,text,timestamptz,uuid,integer),public.owner_move_note(bigint,uuid,uuid,boolean) from public,anon;
grant execute on function public.get_notes_page(bigint,text,timestamptz,uuid,integer),public.owner_move_note(bigint,uuid,uuid,boolean) to authenticated,service_role;

create policy favorites_visible_product on public.favorites as restrictive for all to authenticated
using (exists(select 1 from public.products p where p.id=favorites.product_id))
with check (exists(select 1 from public.products p where p.id=favorites.product_id));
create policy promotions_visible_store on public.promotions as restrictive for all to authenticated
using (exists(select 1 from public.warehouses w where w.id::text=coalesce(nullif(promotions.data->>'warehouseId',''),'1')))
with check (exists(select 1 from public.warehouses w where w.id::text=coalesce(nullif(promotions.data->>'warehouseId',''),'1')));
create policy inspection_lists_visible_store on public.inspection_lists as restrictive for all to authenticated
using (exists(select 1 from public.warehouses w where w.id::text=coalesce(nullif(inspection_lists.data->>'warehouseId',''),'1')))
with check (exists(select 1 from public.warehouses w where w.id::text=coalesce(nullif(inspection_lists.data->>'warehouseId',''),'1')));
notify pgrst,'reload schema';
