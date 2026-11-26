-- Reuse the owner check, store lock and expected-version check for group removal.
do $migration$
declare
  definition text:=pg_get_functiondef('public.save_store_price_group(bigint,jsonb,jsonb)'::regprocedure);
  declaration_anchor text:=$old$  previous jsonb;
  rule jsonb;$old$;
  validation_anchor text:=$old$  if group_id is null or group_id !~ '^[0-9a-f-]{36}$' or nullif(trim(p_group->>'name'),'') is null
    or jsonb_typeof(p_group->'customerPrices') is distinct from 'array'
    then raise exception 'invalid price group'; end if;$old$;
  cas_anchor text:=$old$  if previous is distinct from p_expected then raise exception 'กลุ่มราคานี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด'; end if;$old$;
  append_anchor text:=$old$select coalesce(jsonb_agg(g order by n),'[]')||jsonb_build_array(p_group) into groups$old$;
begin
  if strpos(definition,declaration_anchor)=0 or strpos(definition,validation_anchor)=0
    or strpos(definition,cas_anchor)=0 or strpos(definition,append_anchor)=0 then
    raise exception 'unexpected group pricing definition';
  end if;
  definition:=replace(definition,declaration_anchor,declaration_anchor||$new$
  removing boolean:=coalesce(p_group->'remove'='true'::jsonb,false);$new$);
  definition:=replace(definition,validation_anchor,$new$  if group_id is null or group_id !~ '^[0-9a-f-]{36}$'
    or (not removing and (nullif(trim(p_group->>'name'),'') is null
      or jsonb_typeof(p_group->'customerPrices') is distinct from 'array'))
    then raise exception 'invalid price group'; end if;
  if removing then
    if p_expected is null or p_expected->>'id' is distinct from group_id then
      raise exception 'expected price group required';
    end if;
    p_group:=jsonb_build_object('id',group_id,'customerPrices','[]'::jsonb);
  end if;$new$);
  definition:=replace(definition,cas_anchor,$new$  if removing and previous is null then return groups; end if;
$new$||cas_anchor);
  definition:=replace(definition,append_anchor,$new$select coalesce(jsonb_agg(g order by n),'[]')
    || case when removing then '[]'::jsonb else jsonb_build_array(p_group) end into groups$new$);
  execute definition;
end $migration$;

notify pgrst,'reload schema';
