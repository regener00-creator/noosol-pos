set local lock_timeout='5s';
alter table public.sales_representatives add column warehouse_id bigint not null default 1 references public.warehouses(id);
create index representatives_store_idx on public.sales_representatives(warehouse_id);
create trigger representatives_keep_store before insert or update of warehouse_id on public.sales_representatives
for each row execute function private.keep_contact_store();
create policy representatives_store_access on public.sales_representatives as restrictive for all to authenticated
using (exists(select 1 from public.warehouses w where w.id=warehouse_id))
with check (exists(select 1 from public.warehouses w where w.id=warehouse_id));
-- A removed representative leaves its historical notes in its own shop.
alter table public.notes add column representative_warehouse_id bigint;
update public.notes n set representative_warehouse_id=coalesce((select r.warehouse_id from public.sales_representatives r where r.id=n.representative_id),1)
where n.representative_id is not null or n.activity_type is not null;
create function private.keep_representative_note_store() returns trigger language plpgsql set search_path='' as $$
begin
 if new.representative_id is not null then
   select r.warehouse_id into strict new.representative_warehouse_id from public.sales_representatives r where r.id=new.representative_id;
 elsif tg_op='UPDATE' then
   new.representative_warehouse_id:=old.representative_warehouse_id;
 elsif new.activity_type is null then
   new.representative_warehouse_id:=null;
 else
   new.representative_warehouse_id:=coalesce(new.representative_warehouse_id,1);
 end if;
 if tg_op='UPDATE' and old.representative_warehouse_id is not null and new.representative_warehouse_id is distinct from old.representative_warehouse_id then
   raise exception 'ไม่สามารถย้ายโน้ตผู้แทนไปอีกร้าน';
 end if;
 return new;
end $$;
revoke all on function private.keep_representative_note_store() from public,anon,authenticated;
create trigger notes_keep_representative_store before insert or update of representative_id,representative_warehouse_id,activity_type on public.notes
for each row execute function private.keep_representative_note_store();
create policy notes_representative_store on public.notes as restrictive for all to authenticated
using (representative_warehouse_id is null or exists(select 1 from public.warehouses w where w.id=representative_warehouse_id))
with check (representative_warehouse_id is null or exists(select 1 from public.warehouses w where w.id=representative_warehouse_id));
create policy assignments_representative_store on public.sales_representative_products as restrictive for all to authenticated
using (exists(select 1 from public.sales_representatives r where r.id=representative_id))
with check (exists(select 1 from public.sales_representatives r where r.id=representative_id));

create function private.check_representative_product_store() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.sales_representatives r join public.products p
   on r.warehouse_id<>coalesce(p.warehouse_id,1) where r.id=new.representative_id and p.id=new.product_id) then
   raise exception 'สินค้าและผู้แทนต้องอยู่ร้านเดียวกัน';
 end if;
 return new;
end $$;
revoke all on function private.check_representative_product_store() from public,anon,authenticated;
create trigger representative_product_store before insert or update on public.sales_representative_products
for each row execute function private.check_representative_product_store();

-- Apply the selected shop before ordering, cursor and LIMIT. Legacy callers use the original shop.
do $$
declare olddef text:=pg_get_functiondef('public.get_representative_page(bigint,bigint,text,text,text,text,bigint,integer)'::regprocedure);
 anchor text:='where (p_representative_id is null'; scoped text;
begin
 if strpos(olddef,anchor)=0 then raise exception 'Unknown representative paging query'; end if;
 scoped:=replace(olddef,'public.get_representative_page(','public.get_representative_page(p_warehouse_id bigint, ');
 execute replace(scoped,anchor,'where representative.warehouse_id=p_warehouse_id and (p_representative_id is null');
 execute replace(olddef,anchor,'where representative.warehouse_id=1 and (p_representative_id is null');
end $$;
revoke all on function public.get_representative_page(bigint,bigint,bigint,text,text,text,text,bigint,integer) from public,anon;
grant execute on function public.get_representative_page(bigint,bigint,bigint,text,text,text,text,bigint,integer) to authenticated,service_role;

-- These two writers are security definers. Check the representative's actual
-- warehouse and its permissions before any edits (including clearing all products).
do $$
declare target regprocedure; definition text; guard text:=$guard$
  select r.warehouse_id into v_store from public.sales_representatives r where r.id=p_representative_id for update;
  if v_store is null or not(private.is_current_owner() or exists(select 1 from public.profile_warehouse_access a
      where a.user_id=v_actor and a.warehouse_id=v_store)) then raise exception 'representative store access denied' using errcode='42501'; end if;
$guard$;
begin
 foreach target in array array['public.save_representative_products(bigint,jsonb)'::regprocedure,
     'public.save_representative_note(uuid,timestamptz,text,text,bigint,date,jsonb)'::regprocedure] loop
   definition:=pg_get_functiondef(target);
   if strpos(definition,'v_actor uuid')=0 or strpos(definition,'if v_actor is null')=0 then raise exception 'Unknown representative writer'; end if;
   definition:=replace(definition,'v_actor uuid','v_store bigint; v_actor uuid');
   definition:=replace(definition,'if v_actor is null',guard||'if v_actor is null');
   definition:=replace(definition,'''salesreps'',null','''salesreps'',v_store');
   definition:=replace(definition,'''notes'',null','''notes'',v_store');
   definition:=replace(definition,'where note.id = p_note_id','where note.id = p_note_id and note.representative_id=p_representative_id');
   execute definition;
 end loop;
end $$;
notify pgrst,'reload schema';
