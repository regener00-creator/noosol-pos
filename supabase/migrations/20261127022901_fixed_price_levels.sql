-- Groups retain their original IDs so existing customers and receipts keep their links.
create function private.check_price_level_order(p public.products, groups jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare
  conflict record;
begin
  with group_rules as (
    select right(g->>'name',1)::int lvl,r->>'unit' unit,r
    from jsonb_array_elements(groups) g cross join lateral jsonb_array_elements(g->'customerPrices') r
    where g->>'name' ~ '^LEVEL [1-4]$' and r->>'productId'=p.id::text
  ), units as (select distinct unit from group_rules), rates as (
    select 0 lvl,u.unit,1::numeric qty,
      case when u.unit=coalesce(p.data->>'unit',p.unit) then coalesce(nullif(p.data->>'price','')::numeric,p.price,0)
           else coalesce(nullif(sub->>'price','')::numeric,coalesce(nullif(p.data->>'price','')::numeric,p.price,0)*(sub->>'factor')::numeric) end price
    from units u left join lateral (select value sub from jsonb_array_elements(p.data->'units') where value->>'sub'=u.unit limit 1) s on true
    union all select 0,t->>'unit',(t->>'minQty')::numeric,(t->>'price')::numeric from jsonb_array_elements(p.data->'priceTiers') t join units u on u.unit=t->>'unit'
    union all select lvl,unit,1,(r->>'price')::numeric from group_rules where r->>'price' is not null
    union all select lvl,unit,(t->>'minQty')::numeric,(t->>'price')::numeric from group_rules cross join lateral jsonb_array_elements(r->'tiers') t
  ), breaks as (select distinct qty,unit from rates), effective as (
    select b.unit,b.qty,v.lvl,min(v.price) price from breaks b join rates v on v.unit=b.unit and v.qty<=b.qty
    where v.price is not null group by b.unit,b.qty,v.lvl
  ), compared as (
    select *,lag(price) over w previous,lag(lvl) over w prior_level from effective window w as (partition by unit,qty order by lvl)
  ) select * into conflict from compared where price>=previous order by unit,qty,lvl limit 1;
  if found then
    raise exception '% · % % ขึ้นไป LV% ต้องถูกกว่า % (%)',p.name,conflict.qty,conflict.unit,conflict.lvl,
      case when conflict.prior_level=0 then 'NORMAL' else 'LV'||conflict.prior_level end,conflict.previous;
  end if;
end $$;
revoke all on function private.check_price_level_order(public.products,jsonb) from public,anon,authenticated;

do $migration$
declare
  definition text:=pg_get_functiondef('public.save_store_price_group(bigint,jsonb,jsonb)'::regprocedure);
  anchor text:='  update public.settings set value=jsonb_set';
begin
  if strpos(definition,anchor)=0 or strpos(definition,'  previous jsonb;')=0 then raise exception 'unexpected group save definition'; end if;
  definition:=replace(definition,'  previous jsonb;','  checked_product public.products; previous jsonb;');
  execute replace(definition,anchor,$guard$  if removing or coalesce(p_group->>'name','') !~ '^LEVEL [1-4]$'
      or (previous is not null and previous->>'name' is distinct from p_group->>'name') then
    raise exception 'เลือกได้เฉพาะ LEVEL 1 ถึง LEVEL 4';
  end if;
  for checked_product in select p.* from public.products p where p.id in (
    select (r->>'productId')::bigint from jsonb_array_elements(p_group->'customerPrices') r
  ) order by p.id for share loop
    perform private.check_price_level_order(checked_product,groups);
  end loop;
$guard$||anchor);
end $migration$;

create function private.check_product_price_levels() returns trigger
language plpgsql security definer set search_path='' as $$
declare groups jsonb;
begin
  if (new.price,new.unit,new.data->'price',new.data->'unit',new.data->'units',new.data->'priceTiers') is not distinct from
     (old.price,old.unit,old.data->'price',old.data->'unit',old.data->'units',old.data->'priceTiers') then return new; end if;
  select value->'priceGroups' into groups from public.settings where key='business-warehouse:'||coalesce(new.warehouse_id,1);
  if groups is not null then perform private.check_price_level_order(new,groups); end if;
  return new;
end $$;
revoke all on function private.check_product_price_levels() from public,anon,authenticated;
create trigger check_product_price_levels before update of price,unit,data on public.products
for each row execute function private.check_product_price_levels();
