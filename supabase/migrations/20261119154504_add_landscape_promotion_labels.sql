-- Allow landscape promotion templates to be saved within the selected store.
create or replace function public.update_store_label_settings(p_warehouse_id bigint,p_patch jsonb,p_size text default null)
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
    elsif p_size in ('50x30','80x50','60x40','40x30','a4-poster','a4-poster-landscape') and k in ('priceLabelTemplates','priceLabelTemplateLibraries','promotionLabelTemplates','promotionLabelTemplateLibraries') and jsonb_typeof(v)='object' then
      updated:=jsonb_set(updated,array[k],coalesce(updated->k,'{}')||jsonb_build_object(p_size,v));
    else raise exception 'invalid label setting or label size'; end if;
  end loop;
  update public.settings set value=updated,updated_at=clock_timestamp() where key=setting_key;
end $$;
revoke all on function public.update_store_label_settings(bigint,jsonb,text) from public,anon;
grant execute on function public.update_store_label_settings(bigint,jsonb,text) to authenticated;

