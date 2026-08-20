-- Prevent stale whole-table sync conflicts, protect privileged profile fields,
-- and give shared store lists their own incrementally-synced rows.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_current_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and owner = true
      and level = 1
  );
$$;

revoke execute on function private.is_current_owner() from public, anon;
grant execute on function private.is_current_owner() to authenticated;

create table if not exists public.promotions (
  id bigint primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspection_lists (
  id text primary key,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.promotions enable row level security;
alter table public.inspection_lists enable row level security;

-- Explicit grants keep these tables available through the Data API after the
-- Supabase public-schema auto-exposure change.
revoke all on public.promotions, public.inspection_lists from anon;
grant select, insert, update, delete on public.promotions, public.inspection_lists to authenticated;
grant all on public.promotions, public.inspection_lists to service_role;

-- A signed-in user may only see and update their own profile. Column grants
-- below prevent changing owner, level, username, or id through the Data API.
drop policy if exists authenticated_full_access on public.profiles;
drop policy if exists profile_read_self on public.profiles;
create policy profile_read_self on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists profile_update_self on public.profiles;
create policy profile_update_self on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (first_name,last_name,phone,note,position,signature_name,updated_at)
on public.profiles to authenticated;

-- Promotions are readable by every cashier because they affect POS totals, but
-- only the owner may create, edit, or delete them.
create policy promotions_read on public.promotions
for select to authenticated using (true);
create policy promotions_insert_owner on public.promotions
for insert to authenticated with check ((select private.is_current_owner()));
create policy promotions_update_owner on public.promotions
for update to authenticated
using ((select private.is_current_owner()))
with check ((select private.is_current_owner()));
create policy promotions_delete_owner on public.promotions
for delete to authenticated using ((select private.is_current_owner()));

-- Staff manage only their own inspection lists; owners can see and manage all.
create policy inspection_lists_read on public.inspection_lists
for select to authenticated
using (created_by = (select auth.uid()) or (select private.is_current_owner()));
create policy inspection_lists_insert on public.inspection_lists
for insert to authenticated
with check (created_by = (select auth.uid()));
create policy inspection_lists_update on public.inspection_lists
for update to authenticated
using (created_by = (select auth.uid()) or (select private.is_current_owner()))
with check (created_by = (select auth.uid()) or (select private.is_current_owner()));
create policy inspection_lists_delete on public.inspection_lists
for delete to authenticated
using (created_by = (select auth.uid()) or (select private.is_current_owner()));

-- Stock writes remain security-invoker operations, so they never bypass RLS or
-- the permissions of the signed-in caller.
create or replace function public.adjust_product_stock(p_id bigint, p_delta numeric)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.products
  set stock = coalesce(stock,0) + coalesce(p_delta,0), updated_at = now()
  where id = p_id;
$$;

create or replace function public.set_product_stock(p_id bigint, p_stock numeric)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.products
  set stock = coalesce(p_stock,0), updated_at = now()
  where id = p_id;
$$;

revoke execute on function public.adjust_product_stock(bigint,numeric) from public, anon;
grant execute on function public.adjust_product_stock(bigint,numeric) to authenticated;
revoke execute on function public.set_product_stock(bigint,numeric) from public, anon;
grant execute on function public.set_product_stock(bigint,numeric) to authenticated;

create or replace function public.has_any_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.profiles where owner = true and level = 1);
$$;
revoke execute on function public.has_any_owner() from public;
grant execute on function public.has_any_owner() to anon, authenticated;

-- This event-trigger helper has no reason to be callable from the Data API.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

create index if not exists idx_products_warehouse_id on public.products(warehouse_id);
create index if not exists idx_favorites_product_id on public.favorites(product_id);
create index if not exists idx_sale_items_product_id on public.sale_items(product_id);
create index if not exists idx_sale_items_warehouse_id on public.sale_items(warehouse_id);
