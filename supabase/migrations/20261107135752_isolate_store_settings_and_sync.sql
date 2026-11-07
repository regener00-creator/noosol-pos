create function public.sale_store_id(public.sales) returns bigint language sql immutable security invoker set search_path='' as $$
  select coalesce(private.document_warehouse_id($1.data),1)
$$;
revoke all on function public.sale_store_id(public.sales) from public,anon;
grant execute on function public.sale_store_id(public.sales) to authenticated;
create index sales_store_recent on public.sales((coalesce(private.document_warehouse_id(data),1)),sale_date desc,sale_time desc);

-- Lookup uses the store selected in the workspace as well as the caller's sales RLS.
create function public.find_store_sale(p_warehouse_id bigint,p_identifier text)
returns setof public.sales language sql stable security invoker set search_path='' as $$
  select s from public.sales s
  where p_warehouse_id=coalesce(private.document_warehouse_id(s.data),1)
    and (s.id in (trim(p_identifier),upper(trim(p_identifier))) or s.ref in (trim(p_identifier),upper(trim(p_identifier)))
      or s.data#>>'{shortReceiptMeta,number}'=trim(p_identifier) or s.data#>>'{cashReceiptA4Meta,number}'=trim(p_identifier))
  order by (s.id=trim(p_identifier)) desc,s.id limit 1
$$;
revoke all on function public.find_store_sale(bigint,text) from public,anon;
grant execute on function public.find_store_sale(bigint,text) to authenticated;

create policy primary_business_read on public.settings as restrictive for select to authenticated
using(key<>'business' or exists(select 1 from public.warehouses w where w.id=1));

-- Each store's existing backup already includes its profile. The original store
-- keeps its historic label keys in "business", including when restoring old backups.
create function public.update_store_label_settings(p_warehouse_id bigint,p_patch jsonb,p_size text default null)
returns void language plpgsql security definer set search_path='' as $$
declare
  k text; v jsonb; setting_key text; updated jsonb;
begin
  perform private.acquire_store_mutation_gate();
  if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required' using errcode='42501'; end if;
  if not exists(select 1 from public.warehouses where id=p_warehouse_id) then raise exception 'unknown warehouse'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or pg_column_size(p_patch)>1048576 then raise exception 'invalid label settings'; end if;
  setting_key:=case when p_warehouse_id=1 then 'business' else 'business-warehouse:'||p_warehouse_id end;
  insert into public.settings(key,value) values(setting_key,'{}') on conflict(key) do nothing;
  select value into updated from public.settings where key=setting_key for update;
  for k,v in select * from jsonb_each(p_patch) loop
    if p_size is null and k in ('medicineLabelDoseUnits','medicineLabelWarningPresets') and jsonb_typeof(v)='array' then
      updated:=jsonb_set(updated,array[k],v);
    elsif p_size in ('50x30','80x50','60x40','40x30','a4-poster') and k in ('priceLabelTemplates','priceLabelTemplateLibraries','promotionLabelTemplates','promotionLabelTemplateLibraries') and jsonb_typeof(v)='object' then
      updated:=jsonb_set(updated,array[k],coalesce(updated->k,'{}')||jsonb_build_object(p_size,v));
    else raise exception 'invalid label setting or label size'; end if;
  end loop;
  update public.settings set value=updated,updated_at=clock_timestamp() where key=setting_key;
end $$;
revoke all on function public.update_store_label_settings(bigint,jsonb,text) from public,anon;
grant execute on function public.update_store_label_settings(bigint,jsonb,text) to authenticated;

-- Profile edits must preserve label settings, including a simultaneous save at another terminal.
do $$
declare f text:=pg_get_functiondef('public.owner_set_setting(text,jsonb)'::regprocedure);
begin
 if strpos(f,'set value = excluded.value')=0 then raise exception 'unknown settings writer'; end if;
 if strpos(f,'if v_key = ''maintenance_epoch''')=0 then raise exception 'unknown settings guard'; end if;
 f:=replace(f,'if v_key = ''maintenance_epoch''','if v_key = ''business'' then raise exception ''กรุณาโหลดโปรแกรมใหม่ก่อนบันทึกการตั้งค่าร้าน''; end if;
  if v_key = ''maintenance_epoch''');
 execute replace(f,'set value = excluded.value','set value = case when v_key like ''business-warehouse:%'' then public.settings.value || excluded.value else excluded.value end');
 f:=pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure);
 if strpos(f,'setting.key in (''business'', ''business-warehouse:'' || p_warehouse_id::text)')=0 then raise exception 'unknown sale issuer lookup'; end if;
 execute replace(f,'setting.key in (''business'', ''business-warehouse:'' || p_warehouse_id::text)','(setting.key = ''business-warehouse:'' || p_warehouse_id::text or (p_warehouse_id=1 and setting.key=''business''))');
end $$;

alter table public.product_change_log add column warehouse_id bigint not null default 1;
update public.product_change_log l set warehouse_id=p.warehouse_id from public.products p
where p.id=l.product_id and p.warehouse_id<>1;
create index product_change_log_store_change on public.product_change_log(warehouse_id,change_id);
create policy product_changes_store_scope on public.product_change_log as restrictive for select to authenticated
using (warehouse_id in(select id from public.warehouses));
create or replace function private.capture_product_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    insert into public.product_change_log(product_id,operation,revision,warehouse_id) values(old.id,'delete',old.revision,coalesce(old.warehouse_id,1));
    return old;
  end if;
  insert into public.product_change_log(product_id,operation,revision,warehouse_id) values(new.id,lower(tg_op),new.revision,coalesce(new.warehouse_id,1));
  return new;
end $$;

alter table public.sync_events add column warehouse_id bigint not null default 1;
create index sync_events_store_recent on public.sync_events(warehouse_id,occurred_at desc);
create policy sync_events_store_scope on public.sync_events as restrictive for select to authenticated
using(warehouse_id in(select id from public.warehouses));

-- Keep the existing deduplication and retention rules; include the store in the identity.
do $$
declare f text:=pg_get_functiondef('public.report_client_event(text,text,text,text,text,text,text,text,jsonb)'::regprocedure);
begin
 if strpos(f,'v_dedupe_key := private.sync_event_dedupe_key')=0 or strpos(f,'actor_id, device_id, severity')=0 then raise exception 'unknown event writer'; end if;
 f:=replace(f,'v_dedupe_key text;', 'v_dedupe_key text; shop bigint:=coalesce((v_context->>''warehouseId'')::bigint,1);');
 f:=replace(f,'v_dedupe_key := private.sync_event_dedupe_key', 'if not exists(select 1 from public.warehouses w where w.id=shop and (private.is_current_owner() or exists(select 1 from public.profile_warehouse_access a where a.user_id=v_actor and a.warehouse_id=shop and a.can_sell))) then raise exception ''warehouse access required'' using errcode=''42501''; end if;
  v_dedupe_key := private.sync_event_dedupe_key');
 f:=replace(f,'insert into public.sync_events as existing','if shop<>1 then v_dedupe_key:=encode(sha256(convert_to(shop::text||'':''||v_dedupe_key,''UTF8'')),''hex''); end if;
  insert into public.sync_events as existing');
 f:=replace(f,'actor_id, device_id, severity','warehouse_id, actor_id, device_id, severity');
 execute replace(f,'v_actor, v_device_id, v_severity','shop, v_actor, v_device_id, v_severity');
end $$;

-- Old clients can resolve only original-store events. New clients specify the store.
do $$
declare f text;
begin
 f:=pg_get_functiondef('public.resolve_own_sync_events(text,timestamptz)'::regprocedure);
 if strpos(f,'where event.actor_id = v_actor')=0 then raise exception 'unknown event resolver'; end if;
 execute replace(f,'where event.actor_id = v_actor','where event.warehouse_id=1 and event.actor_id = v_actor');
 f:=replace(f,'p_device_id text,','p_warehouse_id bigint, p_device_id text,');
 f:=replace(f,'where event.actor_id = v_actor','where event.warehouse_id=p_warehouse_id and exists(select 1 from public.warehouses w where w.id=p_warehouse_id and (private.is_current_owner() or exists(select 1 from public.profile_warehouse_access a where a.user_id=v_actor and a.warehouse_id=w.id and a.can_sell))) and event.actor_id = v_actor');
 execute replace(f,'public.resolve_own_sync_events','public.resolve_store_sync_events');
 f:=pg_get_functiondef('public.owner_resolve_sync_event(uuid)'::regprocedure);
 execute replace(f,'where id = p_event_id','where warehouse_id=1 and id = p_event_id');
 f:=replace(f,'p_event_id uuid','p_warehouse_id bigint, p_event_id uuid');
 execute replace(replace(f,'public.owner_resolve_sync_event','public.owner_resolve_store_sync_event'),'where id = p_event_id','where warehouse_id=p_warehouse_id and id = p_event_id');
end $$;
revoke all on function public.resolve_store_sync_events(bigint,text,timestamptz),public.owner_resolve_store_sync_event(bigint,uuid) from public,anon;
grant execute on function public.resolve_store_sync_events(bigint,text,timestamptz),public.owner_resolve_store_sync_event(bigint,uuid) to authenticated;
notify pgrst,'reload schema';
