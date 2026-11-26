-- Groups share the warehouse profile's backup, read scope and offline cache.
create function public.save_store_price_group(p_warehouse_id bigint,p_expected jsonb,p_group jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  k text:='business-warehouse:'||p_warehouse_id;
  group_id text:=p_group->>'id';
  groups jsonb;
  previous jsonb;
  rule jsonb;
begin
  if auth.uid() is null or not private.is_current_owner()
    or not exists(select 1 from public.warehouses where id=p_warehouse_id)
    then raise exception 'owner and warehouse required' using errcode='42501'; end if;
  if group_id is null or group_id !~ '^[0-9a-f-]{36}$' or nullif(trim(p_group->>'name'),'') is null
    or jsonb_typeof(p_group->'customerPrices') is distinct from 'array'
    then raise exception 'invalid price group'; end if;
  perform private.acquire_store_mutation_gate();
  for rule in select value from jsonb_array_elements(p_group->'customerPrices') loop
    if not private.is_safe_nonnegative_decimal(rule->>'price') or nullif(rule->>'unit','') is null
      or not exists(select 1 from public.products p where p.id::text=rule->>'productId'
        and coalesce(p.warehouse_id,1)=p_warehouse_id
        and (p.unit=rule->>'unit' or exists(select 1 from jsonb_array_elements(p.data->'units') u where u->>'sub'=rule->>'unit')))
      then raise exception 'invalid product, unit or group price'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_group->'customerPrices') r group by r->>'productId',r->>'unit' having count(*)>1)
    then raise exception 'duplicate group price'; end if;
  insert into public.settings(key,value) values(k,coalesce((select value from public.settings where key='business' and p_warehouse_id=1),'{}')) on conflict(key) do nothing;
  select coalesce(value->'priceGroups','[]') into groups from public.settings where key=k for update;
  select g into previous from jsonb_array_elements(groups) g where g->>'id'=group_id;
  if previous is distinct from p_expected then raise exception 'กลุ่มราคานี้ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด'; end if;
  if exists(select 1 from jsonb_array_elements(groups) g where g->>'id'<>group_id and g->>'name'=p_group->>'name')
    then raise exception 'ชื่อกลุ่มราคาซ้ำ'; end if;
  select coalesce(jsonb_agg(g order by n),'[]')||jsonb_build_array(p_group) into groups
    from jsonb_array_elements(groups) with ordinality a(g,n) where g->>'id'<>group_id;
  update public.settings set value=jsonb_set(value,'{priceGroups}',groups),updated_at=clock_timestamp() where key=k;
  return groups;
end $$;
revoke all on function public.save_store_price_group(bigint,jsonb,jsonb) from public,anon;
grant execute on function public.save_store_price_group(bigint,jsonb,jsonb) to authenticated;

-- Reconstruct the eligible unit price from stored rules and the submitted sale quantities.
create function private.resolve_volume_or_group_price(p_store bigint,p_sale jsonb,p_items jsonb,p_item jsonb,p_product public.products,p_unit text,p_regular numeric)
returns numeric language plpgsql stable security invoker set search_path='' as $$
declare
  customer_data jsonb;
  base_price numeric;
  tier_price numeric;
  quantity numeric;
begin
  select data into customer_data from public.contacts where id::text=p_sale->>'customerId'
    and type in ('customer','both') and coalesce(warehouse_id,1)=p_store;
  select (r->>'price')::numeric into base_price from jsonb_array_elements(customer_data->'customerPrices') r
    where r->>'productId'=p_product.id::text and r->>'unit'=p_unit and private.is_safe_nonnegative_decimal(r->>'price') limit 1;
  if base_price is null then
    select (r->>'price')::numeric into base_price from public.settings s
      cross join lateral jsonb_array_elements(s.value->'priceGroups') g
      cross join lateral jsonb_array_elements(g->'customerPrices') r
      where s.key='business-warehouse:'||p_store and g->>'id'=customer_data->>'priceGroupId'
        and r->>'productId'=p_product.id::text and r->>'unit'=p_unit and private.is_safe_nonnegative_decimal(r->>'price') limit 1;
    if p_item->>'priceSource'='group' and base_price is not null then return base_price; end if;
  end if;
  if p_item->>'priceSource'='tier' then
    select sum((i->>'qty')::numeric) into quantity from jsonb_array_elements(p_items) i
      where i->>'productId'=p_product.id::text and i->>'unit'=p_unit and not coalesce((i->>'custom')::boolean,false)
      and coalesce(i->>'priceSource','')<>'quotation'
      and not (nullif(i->>'promoId','') is not null and (i->>'price')::numeric=0);
    select (r->>'price')::numeric into tier_price from jsonb_array_elements(p_product.data->'priceTiers') r
      where r->>'unit'=p_unit and private.is_safe_nonnegative_decimal(r->>'price')
        and (r->>'minQty')::numeric between 1 and quantity
      order by (r->>'minQty')::numeric desc limit 1;
    if tier_price is not null and tier_price<=coalesce(base_price,p_regular) then return tier_price; end if;
  end if;
  raise exception 'ราคากลุ่มหรือราคาขั้นบันไดเปลี่ยน กรุณาตรวจรายการขายอีกครั้ง';
end $$;
revoke all on function private.resolve_volume_or_group_price(bigint,jsonb,jsonb,jsonb,public.products,text,numeric) from public,anon,authenticated;

do $migration$
declare
  definition text:=pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure);
  anchor text:=$anchor$if coalesce(v_item ->> 'priceSource', 'standard') = 'quotation' then$anchor$;
begin
  if strpos(definition,anchor)=0 then raise exception 'unknown checkout pricing guard'; end if;
  execute replace(definition,anchor,$patch$if coalesce(v_item->>'priceSource','') in ('tier','group') then
        if v_promotion_id is not null then raise exception 'discount already applied'; end if;
        v_expected_price:=private.resolve_volume_or_group_price(p_warehouse_id,v_sale_data,p_items,v_item,v_product,v_unit_name,v_expected_price);
      elsif v_item->>'priceSource'='customer' and v_price=0 and v_promotion_id is null then
        -- A saved zero customer price must be checked before the giveaway branch.
        v_expected_price:=private.resolve_customer_special_price(v_sale_data,v_item,v_product_id,v_unit_name);
      end if;
      $patch$||anchor);
end $migration$;
