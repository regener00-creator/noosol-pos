-- Validate only the prices belonging to the edited product, unit, and price list.
create function private.check_independent_price_steps(p_rule jsonb,p_store bigint)
returns void language plpgsql stable set search_path='' as $$
declare
  product public.products;
  unit_data jsonb;
  cost numeric;
  starting_price numeric;
  step jsonb;
begin
  if not p_rule ? 'tiers' then return; end if;
  if jsonb_typeof(p_rule->'tiers') is distinct from 'array' then raise exception 'ขั้นราคาไม่ถูกต้อง'; end if;
  if jsonb_array_length(p_rule->'tiers')=0 then return; end if;

  select * into strict product from public.products where id=(p_rule->>'productId')::bigint and coalesce(warehouse_id,1)=p_store;
  cost:=coalesce(nullif(product.data->>'cost','')::numeric,product.cost,0);
  if p_rule->>'unit' is distinct from coalesce(nullif(product.data->>'unit',''),product.unit) then
    select u into strict unit_data from jsonb_array_elements(product.data->'units') u where u->>'sub'=p_rule->>'unit';
    cost:=coalesce(nullif(unit_data->>'cost','')::numeric,cost*(unit_data->>'factor')::numeric);
  end if;

  for step in select value from jsonb_array_elements(p_rule->'tiers') loop
    if not private.is_safe_nonnegative_decimal(step->>'price') or coalesce(step->>'minQty','') !~ '^[1-9][0-9]{0,14}$'
      or (step->>'price')::numeric<>round((step->>'price')::numeric,2)
      or (step->>'price')::numeric<cost then raise exception 'ตรวจจำนวนซื้อขั้นต่ำ ราคาต่อหน่วย และทุนอีกครั้ง'; end if;
  end loop;

  starting_price:=(p_rule->>'price')::numeric;
  if exists(select from jsonb_array_elements(p_rule->'tiers') t where (t->>'price')::numeric>=starting_price) then
    raise exception 'ราคาขั้นบันไดต้องต่ำกว่าราคาตั้งต้นของกลุ่ม % บาท',starting_price;
  end if;
  if exists(select from jsonb_array_elements(p_rule->'tiers') t group by (t->>'minQty')::numeric having count(*)>1)
    or exists(
      select from (
        select (t->>'price')::numeric price,
          lag((t->>'price')::numeric) over(order by (t->>'minQty')::numeric) previous
        from jsonb_array_elements(p_rule->'tiers') t
      ) ordered where price>=previous
    ) then raise exception 'จำนวนขั้นต่ำต้องไม่ซ้ำและราคาขั้นถัดไปต้องต่ำลง'; end if;
end $$;
revoke all on function private.check_independent_price_steps(jsonb,bigint) from public,anon,authenticated;

do $migration$
declare
  definition text:=pg_get_functiondef('public.save_store_price_group(bigint,jsonb,jsonb)'::regprocedure);
  cross_level_check text:=$old$  for checked_product in select p.* from public.products p where p.id in (
    select (r->>'productId')::bigint from jsonb_array_elements(p_group->'customerPrices') r
  ) order by p.id for share loop
    perform private.check_price_level_order(checked_product,groups);
  end loop;
$old$;
  starting_price_check text:=$old$perform private.check_contract_steps(rule,p_warehouse_id);
    if rule->>'price' is not null and exists (
      select from jsonb_array_elements(rule->'tiers') step
      where (step->>'price')::numeric >= (rule->>'price')::numeric
    ) then
      raise exception 'ราคาขั้นบันไดต้องต่ำกว่าราคาตั้งต้นของกลุ่ม % บาท',rule->>'price';
    end if;$old$;
begin
  if strpos(definition,cross_level_check)=0 or strpos(definition,starting_price_check)=0 then
    raise exception 'unexpected group save definition';
  end if;
  definition:=replace(definition,'  checked_product public.products; previous jsonb;','  previous jsonb;');
  definition:=replace(definition,cross_level_check,'');
  execute replace(definition,starting_price_check,'perform private.check_independent_price_steps(rule,p_warehouse_id);');
end $migration$;

create or replace function private.check_contact_price_steps() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  rule jsonb;
  store_id bigint:=coalesce(new.warehouse_id,1);
begin
  if tg_op='UPDATE' and new.data->'customerPrices' is not distinct from old.data->'customerPrices' then return new; end if;
  if jsonb_typeof(new.data->'customerPrices') is distinct from 'array' then return new; end if;
  for rule in select r from jsonb_array_elements(new.data->'customerPrices') r where r ? 'tiers' loop
    if tg_op='UPDATE' and exists(select from jsonb_array_elements(old.data->'customerPrices') old_rule where old_rule=rule) then continue; end if;
    perform private.check_independent_price_steps(rule,store_id);
  end loop;
  return new;
end $$;

drop trigger check_product_price_levels on public.products;
drop function private.check_product_price_levels();
drop function private.check_price_level_order(public.products,jsonb);
drop function private.check_contract_steps(jsonb,bigint,jsonb);
