-- Change a product's smallest/base unit without corrupting warehouse balances.
-- Completed documents keep their saved unit snapshots; only current catalog
-- metadata and current inventory balances are converted.

create table if not exists public.product_unit_changes (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete restrict,
  changed_by uuid not null references auth.users(id) on delete restrict,
  old_unit text not null,
  new_unit text not null,
  conversion_factor numeric not null check (conversion_factor > 0),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  balance_changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_unit_changes_product_created
on public.product_unit_changes(product_id, created_at desc);

alter table public.product_unit_changes enable row level security;
revoke all on public.product_unit_changes from anon, authenticated;
grant select on public.product_unit_changes to authenticated;
grant all on public.product_unit_changes to service_role;

drop policy if exists product_unit_changes_owner_read on public.product_unit_changes;
create policy product_unit_changes_owner_read on public.product_unit_changes
for select to authenticated
using ((select private.is_current_owner()));

create or replace function public.change_product_base_unit(
  p_product_id bigint,
  p_expected_old_unit text,
  p_new_unit text,
  p_conversion_factor numeric,
  p_product_data jsonb,
  p_price numeric,
  p_cost numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_balance_changes jsonb := '[]'::jsonb;
  v_result_balances jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner access required';
  end if;
  if p_product_id is null then
    raise exception 'product is required';
  end if;
  if nullif(btrim(coalesce(p_expected_old_unit,'')),'') is null
     or nullif(btrim(coalesce(p_new_unit,'')),'') is null then
    raise exception 'old and new units are required';
  end if;
  if btrim(p_expected_old_unit)=btrim(p_new_unit) then
    raise exception 'new unit must be different';
  end if;
  if p_conversion_factor is null or p_conversion_factor<=0 or p_conversion_factor>1000000 then
    raise exception 'invalid conversion factor';
  end if;
  if coalesce(p_price,0)<0 or coalesce(p_cost,0)<0 then
    raise exception 'price and cost must not be negative';
  end if;

  select * into v_product
  from public.products
  where id=p_product_id
  for update;
  if not found then
    raise exception 'product not found';
  end if;
  if btrim(coalesce(v_product.unit,''))<>btrim(p_expected_old_unit) then
    raise exception 'product unit changed on another device; reload and try again';
  end if;

  perform 1
  from public.inventory_balances
  where product_id=p_product_id
  for update;

  select coalesce(jsonb_agg(jsonb_build_object(
    'warehouseId',balance.warehouse_id,
    'beforeStock',balance.stock,
    'afterStock',balance.stock*p_conversion_factor
  ) order by balance.warehouse_id),'[]'::jsonb)
  into v_balance_changes
  from public.inventory_balances balance
  where balance.product_id=p_product_id;

  update public.inventory_balances
  set stock=stock*p_conversion_factor,
      updated_at=now()
  where product_id=p_product_id;

  update public.products
  set unit=btrim(p_new_unit),
      price=coalesce(p_price,0),
      cost=coalesce(p_cost,0),
      stock=coalesce(stock,0)*p_conversion_factor,
      data=(coalesce(p_product_data,'{}'::jsonb)-'stock'-'_catalogExpiry'),
      updated_at=now()
  where id=p_product_id;

  insert into public.product_unit_changes(
    product_id,changed_by,old_unit,new_unit,conversion_factor,
    before_data,after_data,balance_changes
  ) values (
    p_product_id,(select auth.uid()),btrim(p_expected_old_unit),btrim(p_new_unit),p_conversion_factor,
    coalesce(v_product.data,'{}'::jsonb),
    coalesce(p_product_data,'{}'::jsonb)-'stock'-'_catalogExpiry',
    v_balance_changes
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'warehouseId',balance.warehouse_id,
    'stock',balance.stock,
    'expiry',case when balance.expiry is null then null else to_char(balance.expiry,'YYYY-MM-DD') end
  ) order by balance.warehouse_id),'[]'::jsonb)
  into v_result_balances
  from public.inventory_balances balance
  where balance.product_id=p_product_id;

  return jsonb_build_object(
    'productId',p_product_id,
    'oldUnit',btrim(p_expected_old_unit),
    'newUnit',btrim(p_new_unit),
    'conversionFactor',p_conversion_factor,
    'balances',v_result_balances
  );
end;
$$;

revoke execute on function public.change_product_base_unit(bigint,text,text,numeric,jsonb,numeric,numeric)
from public, anon;
grant execute on function public.change_product_base_unit(bigint,text,text,numeric,jsonb,numeric,numeric)
to authenticated;
