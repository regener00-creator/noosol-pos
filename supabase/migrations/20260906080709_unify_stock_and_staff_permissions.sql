-- Keep stock changes on the audited document/stock-operation path only.
-- These low-level compatibility functions are still callable by SECURITY
-- DEFINER routines owned by postgres, but are no longer browser APIs.
revoke all on function public.adjust_inventory_stock(bigint,bigint,numeric)
  from public,anon,authenticated;
revoke all on function public.set_inventory_stock(bigint,bigint,numeric)
  from public,anon,authenticated;
revoke all on function public.set_inventory_expiry(bigint,bigint,date)
  from public,anon,authenticated;

-- Only the owner role and the permission-matrix staff role are supported.
-- This prevents an unknown future level from becoming an accidental bypass.
alter table public.profiles
  drop constraint if exists profiles_supported_level_check;
alter table public.profiles
  add constraint profiles_supported_level_check check (
    (coalesce(owner,false) and level=1)
    or (not coalesce(owner,false) and level=2)
  );

-- _revision is a client concurrency marker backed by the real revision
-- column. Keeping another copy inside data creates drift and extra bytes.
create or replace function private.strip_product_duplicate_data(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_data, '{}'::jsonb) - array[
    'id','sku','name','category','brand','type','product_type','wh','warehouse_id',
    'stock','cost','price','unit','expiry','_catalogExpiry','_revision'
  ]::text[];
$$;

revoke all on function private.strip_product_duplicate_data(jsonb)
  from public,anon,authenticated;

update public.products
set data=private.strip_product_duplicate_data(data)
where coalesce(data,'{}'::jsonb) ? '_revision';

alter table public.products
  drop constraint if exists products_data_no_flat_duplicates_check;
alter table public.products
  add constraint products_data_no_flat_duplicates_check check (
    not (coalesce(data,'{}'::jsonb) ?| array[
      'id','sku','name','category','brand','type','product_type','wh','warehouse_id',
      'stock','cost','price','unit','expiry','_catalogExpiry','_revision'
    ])
  );

comment on constraint profiles_supported_level_check on public.profiles is
  'Supported roles: owner Level 1; staff Level 2 with explicit page permissions.';
