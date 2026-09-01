-- Keep queryable master-data fields in columns and reserve jsonb for extras.
-- inventory_balances/inventory_lots are the only stock source of truth. The
-- legacy products.stock column remains as a nullable compatibility shell until
-- every historical database routine can be removed in a future major upgrade.

create or replace function private.strip_product_duplicate_data(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_data, '{}'::jsonb) - array[
    'id','sku','name','category','brand','type','product_type','wh','warehouse_id',
    'stock','cost','price','unit','expiry','_catalogExpiry'
  ]::text[];
$$;

create or replace function private.strip_warehouse_duplicate_data(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$ select coalesce(p_data, '{}'::jsonb) - array['id','name']::text[]; $$;

create or replace function private.strip_contact_duplicate_data(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$ select coalesce(p_data, '{}'::jsonb) - array['id','type','types','name','phone']::text[]; $$;

create or replace function private.strip_sales_rep_duplicate_data(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$ select coalesce(p_data, '{}'::jsonb) - array['id','name']::text[]; $$;

create or replace function private.document_business_snapshot(p_business jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'type', p_business -> 'type',
    'vat', p_business -> 'vat',
    'vatRegistrationDate', p_business -> 'vatRegistrationDate',
    'name', p_business -> 'name',
    'address', p_business -> 'address',
    'taxId', p_business -> 'taxId',
    'branch', p_business -> 'branch',
    'branchCode', p_business -> 'branchCode',
    'branchName', p_business -> 'branchName',
    'officePhone', p_business -> 'officePhone',
    'mobile', p_business -> 'mobile',
    'phone', p_business -> 'phone',
    'fax', p_business -> 'fax',
    'line', p_business -> 'line',
    'website', p_business -> 'website',
    'documentPhone', p_business -> 'documentPhone',
    'english', p_business -> 'english'
  ));
$$;

revoke all on function private.strip_product_duplicate_data(jsonb) from public, anon, authenticated;
revoke all on function private.strip_warehouse_duplicate_data(jsonb) from public, anon, authenticated;
revoke all on function private.strip_contact_duplicate_data(jsonb) from public, anon, authenticated;
revoke all on function private.strip_sales_rep_duplicate_data(jsonb) from public, anon, authenticated;
revoke all on function private.document_business_snapshot(jsonb) from public, anon, authenticated;

alter table public.products alter column stock drop default;
alter table public.products alter column stock drop not null;

create or replace function private.refresh_inventory_balance_from_lots(
  p_product_id bigint,
  p_warehouse_id bigint
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot_stock numeric;
  v_shortage numeric;
  v_stock numeric;
  v_expiry date;
begin
  select coalesce(sum(lot.quantity_base), 0),
         min(lot.expiry_date) filter (where lot.quantity_base > 0)
  into v_lot_stock, v_expiry
  from public.inventory_lots lot
  where lot.product_id = p_product_id
    and lot.warehouse_id = p_warehouse_id
    and lot.status <> 'blocked'
    and lot.source_type <> 'sale_shortage';

  v_shortage := private.inventory_lot_shortage_delta(p_product_id, p_warehouse_id);
  v_stock := v_lot_stock + v_shortage;

  insert into public.inventory_balances(warehouse_id, product_id, stock, expiry, updated_at)
  values(p_warehouse_id, p_product_id, v_stock, v_expiry, now())
  on conflict (warehouse_id, product_id) do update
    set stock = excluded.stock,
        expiry = excluded.expiry,
        updated_at = now();

  return v_stock;
end;
$$;

-- Preserve values currently preferred by the application before removing the
-- duplicate jsonb keys. Triggers are disabled only inside this migration so the
-- maintenance rewrite does not create thousands of misleading user audit rows.
alter table public.products disable trigger user;
alter table public.warehouses disable trigger user;
alter table public.contacts disable trigger user;
alter table public.sales_representatives disable trigger user;
alter table public.sales disable trigger user;

update public.products
set sku = coalesce(nullif(btrim(data ->> 'sku'), ''), sku),
    name = coalesce(nullif(btrim(data ->> 'name'), ''), name),
    category = coalesce(nullif(btrim(data ->> 'category'), ''), category),
    brand = coalesce(nullif(btrim(data ->> 'brand'), ''), brand),
    product_type = coalesce(nullif(btrim(data ->> 'type'), ''), nullif(btrim(data ->> 'product_type'), ''), product_type),
    warehouse_id = case
      when coalesce(data ->> 'wh', data ->> 'warehouse_id', '') ~ '^[0-9]+$'
        then coalesce(data ->> 'wh', data ->> 'warehouse_id')::bigint
      else warehouse_id
    end,
    cost = case when coalesce(data ->> 'cost', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (data ->> 'cost')::numeric else cost end,
    price = case when coalesce(data ->> 'price', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (data ->> 'price')::numeric else price end,
    unit = coalesce(nullif(btrim(data ->> 'unit'), ''), unit),
    stock = null,
    data = private.strip_product_duplicate_data(data);

update public.warehouses set data = private.strip_warehouse_duplicate_data(data);
update public.contacts set data = private.strip_contact_duplicate_data(data);
update public.sales_representatives set data = private.strip_sales_rep_duplicate_data(data);
update public.sales
set data = jsonb_set(
  data,
  '{businessSnapshot}',
  private.document_business_snapshot(data -> 'businessSnapshot'),
  true
)
where jsonb_typeof(data -> 'businessSnapshot') = 'object';

alter table public.products enable trigger user;
alter table public.warehouses enable trigger user;
alter table public.contacts enable trigger user;
alter table public.sales_representatives enable trigger user;
alter table public.sales enable trigger user;

create or replace function private.normalize_product_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.stock := null;
  new.data := private.strip_product_duplicate_data(new.data);
  return new;
end;
$$;

create or replace function private.normalize_warehouse_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.data := private.strip_warehouse_duplicate_data(new.data);
  return new;
end;
$$;

create or replace function private.normalize_contact_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.data := private.strip_contact_duplicate_data(new.data);
  return new;
end;
$$;

create or replace function private.normalize_sales_rep_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.data := private.strip_sales_rep_duplicate_data(new.data);
  return new;
end;
$$;

create or replace function private.normalize_sale_business_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.data -> 'businessSnapshot') = 'object' then
    new.data := jsonb_set(
      new.data,
      '{businessSnapshot}',
      private.document_business_snapshot(new.data -> 'businessSnapshot'),
      true
    );
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_product_storage() from public, anon, authenticated;
revoke all on function private.normalize_warehouse_storage() from public, anon, authenticated;
revoke all on function private.normalize_contact_storage() from public, anon, authenticated;
revoke all on function private.normalize_sales_rep_storage() from public, anon, authenticated;
revoke all on function private.normalize_sale_business_snapshot() from public, anon, authenticated;

drop trigger if exists normalize_product_storage on public.products;
create trigger normalize_product_storage
before insert or update of stock, data on public.products
for each row execute function private.normalize_product_storage();

drop trigger if exists normalize_warehouse_storage on public.warehouses;
create trigger normalize_warehouse_storage
before insert or update of data on public.warehouses
for each row execute function private.normalize_warehouse_storage();

drop trigger if exists normalize_contact_storage on public.contacts;
create trigger normalize_contact_storage
before insert or update of data on public.contacts
for each row execute function private.normalize_contact_storage();

drop trigger if exists normalize_sales_rep_storage on public.sales_representatives;
create trigger normalize_sales_rep_storage
before insert or update of data on public.sales_representatives
for each row execute function private.normalize_sales_rep_storage();

drop trigger if exists normalize_sale_business_snapshot on public.sales;
create trigger normalize_sale_business_snapshot
before insert or update of data on public.sales
for each row execute function private.normalize_sale_business_snapshot();

alter table public.products drop constraint if exists products_catalog_stock_retired_check;
alter table public.products add constraint products_catalog_stock_retired_check check (stock is null);

alter table public.products drop constraint if exists products_data_no_flat_duplicates_check;
alter table public.products add constraint products_data_no_flat_duplicates_check check (
  not (coalesce(data, '{}'::jsonb) ?| array[
    'id','sku','name','category','brand','type','product_type','wh','warehouse_id',
    'stock','cost','price','unit','expiry','_catalogExpiry'
  ])
);

alter table public.warehouses drop constraint if exists warehouses_data_no_flat_duplicates_check;
alter table public.warehouses add constraint warehouses_data_no_flat_duplicates_check
check (not (coalesce(data, '{}'::jsonb) ?| array['id','name']));

alter table public.contacts drop constraint if exists contacts_data_no_flat_duplicates_check;
alter table public.contacts add constraint contacts_data_no_flat_duplicates_check
check (not (coalesce(data, '{}'::jsonb) ?| array['id','type','types','name','phone']));

alter table public.sales_representatives drop constraint if exists sales_representatives_data_no_flat_duplicates_check;
alter table public.sales_representatives add constraint sales_representatives_data_no_flat_duplicates_check
check (not (coalesce(data, '{}'::jsonb) ?| array['id','name']));

comment on column public.products.stock is
'Retired compatibility column. Inventory truth is inventory_balances/inventory_lots; enforced NULL by normalize_product_storage.';

revoke all on function public.adjust_product_stock(bigint,numeric) from public, anon, authenticated;
revoke all on function public.set_product_stock(bigint,numeric) from public, anon, authenticated;
