-- Quantity steps belong to the existing product/unit rule. A null flat price inherits its base.
create function private.check_contract_steps(p_rule jsonb,p_store bigint,p_inherited jsonb default null)
returns void language plpgsql stable set search_path='' as $$
declare
  product public.products;
  unit_data jsonb;
  regular numeric;
  cost numeric;
  ceiling numeric;
  step jsonb;
begin
  if not p_rule ? 'tiers' then return; end if;
  if jsonb_typeof(p_rule->'tiers') is distinct from 'array' then raise exception 'ขั้นราคาไม่ถูกต้อง'; end if;
  if jsonb_array_length(p_rule->'tiers')=0 then return; end if;
  select * into strict product from public.products where id=(p_rule->>'productId')::bigint and coalesce(warehouse_id,1)=p_store;
  regular:=coalesce(nullif(product.data->>'price','')::numeric,product.price,0);
  cost:=coalesce(nullif(product.data->>'cost','')::numeric,product.cost,0);
  if p_rule->>'unit' is distinct from coalesce(nullif(product.data->>'unit',''),product.unit) then
    select u into strict unit_data from jsonb_array_elements(product.data->'units') u where u->>'sub'=p_rule->>'unit';
    regular:=coalesce(nullif(nullif(unit_data->>'price','')::numeric,0),regular*(unit_data->>'factor')::numeric);
    cost:=coalesce(nullif(unit_data->>'cost','')::numeric,cost*(unit_data->>'factor')::numeric);
  end if;
  ceiling:=least(regular,coalesce((p_rule->>'price')::numeric,(p_inherited->>'price')::numeric,regular));
  for step in select value from jsonb_array_elements(p_rule->'tiers') loop
    if not private.is_safe_nonnegative_decimal(step->>'price') or coalesce(step->>'minQty','') !~ '^[1-9][0-9]{0,14}$'
      or (step->>'price')::numeric<>round((step->>'price')::numeric,2)
      or (step->>'price')::numeric not between cost and ceiling then raise exception 'ตรวจจำนวนซื้อขั้นต่ำ ราคาต่อหน่วย และทุนอีกครั้ง'; end if;
  end loop;
  if exists(select from jsonb_array_elements(p_rule->'tiers') t group by (t->>'minQty')::numeric having count(*)>1)
     or exists(with steps as (
       select t,0 as priority from jsonb_array_elements(p_rule->'tiers') t union all
       select t,1 from jsonb_array_elements(p_inherited->'tiers') t
     ), merged as (
       select distinct on (qty) (t->>'minQty')::numeric qty,(t->>'price')::numeric price from steps order by qty,priority
     ) select from (select price,lag(price) over(order by qty) previous from merged) ordered where price>=previous)
     then raise exception 'จำนวนขั้นต่ำต้องไม่ซ้ำและราคาขั้นถัดไปต้องต่ำลง'; end if;
end $$;
revoke all on function private.check_contract_steps(jsonb,bigint,jsonb) from public,anon,authenticated;

do $migration$
declare
  definition text:=pg_get_functiondef('public.save_store_price_group(bigint,jsonb,jsonb)'::regprocedure);
  anchor text:=$old$if not private.is_safe_nonnegative_decimal(rule->>'price') or nullif(rule->>'unit','') is null$old$;
begin
  if strpos(definition,anchor)=0 then raise exception 'unexpected group pricing definition'; end if;
  execute replace(definition,anchor,$new$perform private.check_contract_steps(rule,p_warehouse_id);
    if (not private.is_safe_nonnegative_decimal(rule->>'price') and
        (rule->>'price' is not null or coalesce(jsonb_array_length(rule->'tiers'),0)=0)) or nullif(rule->>'unit','') is null$new$);
end $migration$;

create function private.check_contact_price_steps() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  rule jsonb;
  group_rules jsonb;
  inherited jsonb;
  store_id bigint:=coalesce(new.warehouse_id,1);
begin
  if tg_op='UPDATE' and new.data->'customerPrices' is not distinct from old.data->'customerPrices' then return new; end if;
  if jsonb_typeof(new.data->'customerPrices') is distinct from 'array' then return new; end if;
  for rule in select r from jsonb_array_elements(new.data->'customerPrices') r where r ? 'tiers' loop
    if tg_op='UPDATE' and exists(select from jsonb_array_elements(old.data->'customerPrices') old_rule where old_rule=rule) then continue; end if;
    select g->'customerPrices' into group_rules from public.settings s cross join lateral jsonb_array_elements(s.value->'priceGroups') g
      where s.key='business-warehouse:'||store_id and g->>'id'=new.data->>'priceGroupId';
    select r into inherited from jsonb_array_elements(group_rules) r where r->>'productId'=rule->>'productId' and r->>'unit'=rule->>'unit';
    perform private.check_contract_steps(rule,store_id,inherited);
  end loop;
  return new;
end $$;
revoke all on function private.check_contact_price_steps() from public,anon,authenticated;
create trigger contacts_check_price_steps before insert or update of data on public.contacts
for each row execute function private.check_contact_price_steps();

create function private.resolve_contract_checkout_price(p_store bigint,p_sale jsonb,p_items jsonb,p_item jsonb,p_product public.products,p_unit text,p_regular numeric,p_cost numeric)
returns numeric language plpgsql stable set search_path='' as $$
declare
  customer_data jsonb;
  personal jsonb;
  group_rule jsonb;
  base numeric;
  quantity numeric;
  winner record;
begin
  select data into customer_data from public.contacts where id::text=p_sale->>'customerId'
    and type in ('customer','both') and coalesce(warehouse_id,1)=p_store;
  select r into personal from jsonb_array_elements(customer_data->'customerPrices') r
    where r->>'productId'=p_product.id::text and r->>'unit'=p_unit limit 1;
  select r into group_rule from public.settings s cross join lateral jsonb_array_elements(s.value->'priceGroups') g
    cross join lateral jsonb_array_elements(g->'customerPrices') r
    where s.key='business-warehouse:'||p_store and g->>'id'=customer_data->>'priceGroupId'
      and r->>'productId'=p_product.id::text and r->>'unit'=p_unit limit 1;
  base:=coalesce((personal->>'price')::numeric,(group_rule->>'price')::numeric,p_regular);
  if p_item->>'priceSource'='group' then
    if personal->>'price' is null and group_rule->>'price' is not null then return base; end if;
  else
    select sum((i->>'qty')::numeric) into quantity from jsonb_array_elements(p_items) i
      where i->>'productId'=p_product.id::text and i->>'unit'=p_unit and not coalesce((i->>'custom')::boolean,false)
        and coalesce(i->>'priceSource','')<>'quotation' and not (nullif(i->>'promoId','') is not null and (i->>'price')::numeric=0);
    with input_steps as (
      select t,'customer' as scope,0 as priority from jsonb_array_elements(personal->'tiers') t union all
      select t,'group',1 from jsonb_array_elements(group_rule->'tiers') t union all
      select t,'general',2 from jsonb_array_elements(p_product.data->'priceTiers') t where t->>'unit'=p_unit
    ), eligible as (
      select (t->>'minQty')::numeric qty,(t->>'price')::numeric price,scope,priority from input_steps
      where private.is_safe_nonnegative_decimal(t->>'price') and (t->>'minQty')::numeric between 1 and quantity
    ), contracted as (
      select distinct on (qty) * from eligible where priority<2 order by qty,priority
    ), candidates as (
      select * from contracted union all (select * from eligible where priority=2 order by qty desc limit 1)
    ) select * into winner from candidates where price<=base order by (price>=p_cost) desc,price,qty desc,priority limit 1;
    if found then
      if winner.price<p_cost then raise exception 'ราคาขั้นบันไดต่ำกว่าทุน กรุณาตรวจรายการขายอีกครั้ง'; end if;
      if (winner.scope='general' and not (p_item ? 'tierScope') and not (p_item ? 'tierMinQty'))
        or (winner.scope=p_item->>'tierScope' and winner.qty=(p_item->>'tierMinQty')::numeric) then return winner.price; end if;
    end if;
  end if;
  raise exception 'ราคากลุ่มหรือราคาขั้นบันไดเปลี่ยน กรุณาตรวจรายการขายอีกครั้ง';
end $$;
revoke all on function private.resolve_contract_checkout_price(bigint,jsonb,jsonb,jsonb,public.products,text,numeric,numeric) from public,anon,authenticated;
do $migration$
declare
  definition text:=pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure);
  anchor text:='private.resolve_volume_or_group_price(p_warehouse_id,v_sale_data,p_items,v_item,v_product,v_unit_name,v_expected_price)';
begin
  if strpos(definition,anchor)=0 then raise exception 'unexpected checkout definition'; end if;
  execute replace(definition,anchor,'private.resolve_contract_checkout_price(p_warehouse_id,v_sale_data,p_items,v_item,v_product,v_unit_name,v_expected_price,v_expected_cost)');
end $migration$;
drop function private.resolve_volume_or_group_price(bigint,jsonb,jsonb,jsonb,public.products,text,numeric);
notify pgrst,'reload schema';
