-- Individual rows keep a template save or another warehouse's profile save from replacing this profile.
create policy warehouse_business_settings_read on public.settings
as restrictive for select to authenticated using (
  key not like 'business-warehouse:%' or exists (
    select 1 from public.warehouses w where key = 'business-warehouse:' || w.id::text
  )
);

-- The original store continues using its existing details. Start the second store
-- with its own name and no inherited tax, contact or address information.
insert into public.settings(key,value)
select 'business-warehouse:'||w.id::text,
       jsonb_build_object('name',w.name,'vat','ยังไม่จดภาษีมูลค่าเพิ่ม','branch','none','documentPhone','mobile')
from public.warehouses w where w.id<>1
on conflict(key) do nothing;

-- Use the same server-authoritative profile for both VAT and the immutable sale snapshot.
do $migration$
declare
  target regprocedure := 'public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure;
  old_lookup text := 'where setting.key = ''business'';';
  new_lookup text := $lookup$where setting.key in ('business', 'business-warehouse:' || p_warehouse_id::text)
  order by (setting.key <> 'business') desc
  limit 1;$lookup$;
  definition text := pg_get_functiondef(target);
begin
  if strpos(definition, old_lookup) = 0 then
    raise exception 'Cannot locate the business settings lookup in complete_sale';
  end if;
  execute replace(definition, old_lookup, new_lookup);
end;
$migration$;
