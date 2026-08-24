-- One product catalog, with independent stock and expiry per warehouse.

create table if not exists public.inventory_balances (
  warehouse_id bigint not null references public.warehouses(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  stock numeric not null default 0,
  expiry date,
  updated_at timestamptz not null default now(),
  primary key (warehouse_id, product_id)
);

create index if not exists idx_inventory_balances_product
on public.inventory_balances(product_id, warehouse_id);

create table if not exists public.profile_warehouse_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  warehouse_id bigint not null references public.warehouses(id) on delete cascade,
  can_sell boolean not null default true,
  can_manage_stock boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, warehouse_id)
);

create index if not exists idx_profile_warehouse_access_warehouse
on public.profile_warehouse_access(warehouse_id, user_id);

insert into public.profile_warehouse_access(user_id,warehouse_id,can_sell,can_manage_stock)
select p.id,w.id,true,coalesce(p.owner,false)
from public.profiles p cross join public.warehouses w
on conflict (user_id,warehouse_id) do nothing;

alter table public.profile_warehouse_access enable row level security;
revoke all on public.profile_warehouse_access from anon,authenticated;
grant select on public.profile_warehouse_access to authenticated;
grant all on public.profile_warehouse_access to service_role;

drop policy if exists profile_warehouse_access_read on public.profile_warehouse_access;
create policy profile_warehouse_access_read on public.profile_warehouse_access
for select to authenticated
using (user_id=(select auth.uid()) or (select private.is_current_owner()));

alter table public.inventory_balances enable row level security;
revoke all on public.inventory_balances from anon;
revoke all on public.inventory_balances from authenticated;
grant select on public.inventory_balances to authenticated;
grant all on public.inventory_balances to service_role;

drop policy if exists inventory_balances_authenticated_access on public.inventory_balances;
create policy inventory_balances_authenticated_access on public.inventory_balances
for select to authenticated using (
  (select private.is_current_owner()) or exists (
    select 1 from public.profile_warehouse_access a
    where a.user_id=(select auth.uid()) and a.warehouse_id=inventory_balances.warehouse_id
  )
);

-- Preserve every current total as the opening balance of its legacy warehouse.
insert into public.inventory_balances(warehouse_id, product_id, stock, expiry)
select p.warehouse_id, p.id, coalesce(p.stock,0),
       case when coalesce(p.data->>'expiry','') ~ '^\d{4}-\d{2}-\d{2}$'
            then (p.data->>'expiry')::date else null end
from public.products p
where p.warehouse_id is not null
on conflict (warehouse_id, product_id) do nothing;

create or replace function public.adjust_inventory_stock(
  p_product_id bigint, p_warehouse_id bigint, p_delta numeric
) returns numeric
language plpgsql security definer set search_path=''
as $$
declare v_stock numeric;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access a
    where a.user_id=(select auth.uid()) and a.warehouse_id=p_warehouse_id and a.can_sell
  ) then raise exception 'warehouse access denied'; end if;
  insert into public.inventory_balances(warehouse_id,product_id,stock,updated_at)
  values(p_warehouse_id,p_product_id,coalesce(p_delta,0),now())
  on conflict (warehouse_id,product_id) do update
    set stock=public.inventory_balances.stock+excluded.stock,updated_at=now()
  returning stock into v_stock;
  update public.products set stock=v_stock,updated_at=now()
  where id=p_product_id and warehouse_id=p_warehouse_id;
  return v_stock;
end;
$$;

create or replace function public.set_inventory_stock(
  p_product_id bigint, p_warehouse_id bigint, p_stock numeric
) returns numeric
language plpgsql security definer set search_path=''
as $$
declare v_stock numeric := coalesce(p_stock,0);
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) and not exists (
    select 1 from public.profile_warehouse_access a
    where a.user_id=(select auth.uid()) and a.warehouse_id=p_warehouse_id and a.can_manage_stock
  ) then raise exception 'stock management access denied'; end if;
  insert into public.inventory_balances(warehouse_id,product_id,stock,updated_at)
  values(p_warehouse_id,p_product_id,v_stock,now())
  on conflict (warehouse_id,product_id) do update set stock=excluded.stock,updated_at=now();
  update public.products set stock=v_stock,updated_at=now()
  where id=p_product_id and warehouse_id=p_warehouse_id;
  return v_stock;
end;
$$;

create or replace function public.transfer_inventory_stock(
  p_product_id bigint, p_from_warehouse_id bigint, p_to_warehouse_id bigint, p_quantity numeric
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_from numeric; v_to numeric;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) and not (
    exists (select 1 from public.profile_warehouse_access a where a.user_id=(select auth.uid()) and a.warehouse_id=p_from_warehouse_id and a.can_manage_stock)
    and exists (select 1 from public.profile_warehouse_access a where a.user_id=(select auth.uid()) and a.warehouse_id=p_to_warehouse_id and a.can_manage_stock)
  ) then raise exception 'stock transfer access denied'; end if;
  if p_from_warehouse_id=p_to_warehouse_id or coalesce(p_quantity,0)<=0 then raise exception 'invalid transfer'; end if;
  v_from := public.adjust_inventory_stock(p_product_id,p_from_warehouse_id,-p_quantity);
  v_to := public.adjust_inventory_stock(p_product_id,p_to_warehouse_id,p_quantity);
  return jsonb_build_object('fromStock',v_from,'toStock',v_to);
end;
$$;

revoke execute on function public.adjust_inventory_stock(bigint,bigint,numeric) from public,anon;
revoke execute on function public.set_inventory_stock(bigint,bigint,numeric) from public,anon;
revoke execute on function public.transfer_inventory_stock(bigint,bigint,bigint,numeric) from public,anon;
grant execute on function public.adjust_inventory_stock(bigint,bigint,numeric) to authenticated;
grant execute on function public.set_inventory_stock(bigint,bigint,numeric) to authenticated;
grant execute on function public.transfer_inventory_stock(bigint,bigint,bigint,numeric) to authenticated;
