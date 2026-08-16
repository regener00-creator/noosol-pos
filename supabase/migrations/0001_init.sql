-- NOOSOL POS — Initial schema
-- Migrates the ~20 localStorage-backed modules from legacy/POS_original.html into Postgres.
-- Strategy: normalize the core scalar fields used for filtering/reporting/joins,
-- keep the rest of each record's rich/nested fields in a `data jsonb` column so no
-- information is lost during migration. Tighten further in later migrations as needed.

create extension if not exists pgcrypto;

-- =========================================================
-- 1. Auth / profiles (replaces plaintext systemUsers[].password)
-- =========================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  first_name text,
  last_name text,
  phone text,
  note text,
  position text,
  signature_name text,
  owner boolean not null default false,
  level int not null default 2, -- 1 = owner, 2 = staff
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 2. Settings (documentPrefixes, lowStockSettings, businessSettings, storeInfo)
-- =========================================================
create table if not exists settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 3. Master data
-- =========================================================
create table if not exists warehouses (
  id bigint generated always as identity primary key,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table if not exists units (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table if not exists brands (
  id bigint generated always as identity primary key,
  name text not null unique
);

-- =========================================================
-- 4. Products
-- =========================================================
create table if not exists products (
  id bigint generated always as identity primary key,
  sku text,
  name text not null,
  category text,
  brand text,
  product_type text,
  warehouse_id bigint references warehouses(id),
  stock numeric not null default 0,
  cost numeric not null default 0,
  price numeric not null default 0,
  unit text,
  data jsonb not null default '{}'::jsonb, -- unit conversions, factors, etc.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_name on products using gin (to_tsvector('simple', coalesce(name,'')));
create index if not exists idx_products_sku on products (sku);

-- =========================================================
-- 5. Contacts (customers / suppliers)
-- =========================================================
create table if not exists contacts (
  id bigint generated always as identity primary key,
  type text not null default 'customer', -- customer | supplier | both
  name text not null,
  phone text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sales_representatives (
  id bigint generated always as identity primary key,
  name text not null,
  data jsonb not null default '{}'::jsonb
);

-- =========================================================
-- 6. Sales (checkout) — header + line items
-- =========================================================
create table if not exists sales (
  id text primary key, -- e.g. 'INV-1043' (kept as original display id)
  ref text,
  sale_date date,
  sale_time timestamptz,
  cashier text,
  member text,
  status text default 'done',
  pay_method text,
  discount numeric default 0,
  vat numeric default 0,
  fee numeric default 0,
  cost_total numeric default 0,
  gross_profit numeric default 0,
  cash_received numeric default 0,
  cash_change numeric default 0,
  total numeric default 0,
  data jsonb not null default '{}'::jsonb, -- shortReceiptMeta, etc.
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_date on sales (sale_date);

create table if not exists sale_items (
  id bigint generated always as identity primary key,
  sale_id text not null references sales(id) on delete cascade,
  product_id bigint references products(id),
  warehouse_id bigint references warehouses(id),
  name text,
  qty numeric,
  price numeric,
  cost numeric,
  cost_total numeric,
  unit text,
  factor numeric,
  custom boolean default false
);
create index if not exists idx_sale_items_sale on sale_items (sale_id);

-- =========================================================
-- 7. Documents (quotations, AR invoices, credit notes, purchase orders,
--    goods receipts, product returns, transfers, standalone tax invoices)
--    Each kept as header row + jsonb payload (mirrors original nested shape);
--    normalize further only if reporting needs it.
-- =========================================================
create table if not exists quotations (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invoices_ar (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_notes (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_orders (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists goods_receipts (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_orders_full (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_returns (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transfers (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists standalone_tax_invoices (
  id text primary key,
  number text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 8. Favorites (per user)
-- =========================================================
create table if not exists favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- =========================================================
-- 9. Row Level Security
-- Any signed-in staff account (Supabase Auth) has full access — mirrors the
-- original app's behavior (any logged-in user had full access, no per-row
-- restriction existed before). Anonymous (not logged in) has zero access.
-- =========================================================
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'profiles','settings','warehouses','categories','units','brands',
      'products','contacts','sales_representatives','sales','sale_items',
      'quotations','invoices_ar','credit_notes','purchase_orders',
      'goods_receipts','purchase_orders_full','product_returns','transfers',
      'standalone_tax_invoices','favorites'
    ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists "authenticated_full_access" on %I;', t
    );
    execute format(
      'create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);', t
    );
  end loop;
end $$;

-- profiles: allow a user to also read/update their own row explicitly
-- (covered by the blanket policy above too, kept simple on purpose for now).
