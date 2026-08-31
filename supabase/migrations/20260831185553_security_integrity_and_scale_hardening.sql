-- Security, integrity and scale hardening.
-- Supabase migration history version: 20260831185553.
--
-- This migration deliberately separates readable POS data from writable data:
--   * authenticated staff can read only the warehouses assigned to them;
--   * Level 2 stock managers can create and post goods receipts only in an
--     assigned warehouse;
--   * sales, settings and warehouses are written through checked RPCs;
--   * completed sales and stock-posted documents are immutable, including
--     their state flags, so a state rewrite cannot make history deletable;
--   * checkout request ids are bound to their original request payload; and
--   * the two audit-log foreign keys have supporting indexes.
--
-- Existing data is not rewritten. Legacy completed rows remain readable and
-- nullable checkout context columns are populated only for new checkouts.

alter table public.sales
  add column if not exists checkout_payload_hash text,
  add column if not exists checkout_request_context jsonb,
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();

alter table public.goods_receipts
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();

-- Removing a staff login must never erase document or audit history. These
-- three older foreign keys either cascaded whole records or blocked account
-- removal; retain the rows and clear only the departed actor reference.
alter table public.product_unit_changes
  alter column changed_by drop not null,
  drop constraint if exists product_unit_changes_changed_by_fkey,
  add constraint product_unit_changes_changed_by_fkey
    foreign key (changed_by) references auth.users(id) on delete set null;

alter table public.product_exchanges
  alter column created_by drop not null,
  drop constraint if exists product_exchanges_created_by_fkey,
  add constraint product_exchanges_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.inspection_lists
  alter column created_by drop not null,
  drop constraint if exists inspection_lists_created_by_fkey,
  add constraint inspection_lists_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- Cash-shift rows are immutable accounting history. Removing a staff login
-- keeps the saved operator names while clearing only the profile references.
-- An open shift is handled separately by the fail-closed trigger below.
alter table public.cash_shifts
  alter column opened_by drop not null,
  drop constraint if exists cash_shifts_opened_by_fkey,
  add constraint cash_shifts_opened_by_fkey
    foreign key (opened_by) references public.profiles(id) on delete set null,
  drop constraint if exists cash_shifts_closed_by_fkey,
  add constraint cash_shifts_closed_by_fkey
    foreign key (closed_by) references public.profiles(id) on delete set null;

create index if not exists idx_cash_shifts_closed_by_fk
  on public.cash_shifts(closed_by)
  where closed_by is not null;

create or replace function private.prevent_profile_delete_with_open_shift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.cash_shifts shift
    where shift.opened_by = old.id
      and shift.status = 'open'
  ) then
    raise exception 'cannot delete a profile with an open cash shift';
  end if;
  -- The FK updates happen later in this same transaction. This local flag lets
  -- the history trigger accept only UUID-to-NULL actor cleanup for this delete.
  perform set_config('pepos.staff_identity_delete', 'on', true);
  return old;
end;
$$;

revoke all on function private.prevent_profile_delete_with_open_shift()
  from public, anon, authenticated, service_role;

drop trigger if exists prevent_profile_delete_with_open_shift
  on public.profiles;
create trigger prevent_profile_delete_with_open_shift
before delete on public.profiles
for each row execute function private.prevent_profile_delete_with_open_shift();

create or replace function private.protect_cash_shift_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('pepos.maintenance_reset', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'cash shift history cannot be deleted';
  end if;
  if current_setting('pepos.staff_identity_delete', true) = 'on'
     and (
       new.opened_by is distinct from old.opened_by
       or new.closed_by is distinct from old.closed_by
     ) then
    if old.status = 'closed'
       and (to_jsonb(new) - 'opened_by' - 'closed_by')
           = (to_jsonb(old) - 'opened_by' - 'closed_by')
       and (
         new.opened_by is not distinct from old.opened_by
         or (old.opened_by is not null and new.opened_by is null)
       )
       and (
         new.closed_by is not distinct from old.closed_by
         or (old.closed_by is not null and new.closed_by is null)
       ) then
      return new;
    end if;
    raise exception 'invalid cash shift actor cleanup';
  end if;
  if old.status = 'closed' then
    raise exception 'closed cash shift is immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_cash_shift_history()
  from public, anon, authenticated, service_role;

-- Receiving stock is a narrower capability than arbitrary stock management.
-- Backfill only assignments that could already manage stock plus the existing
-- Level 2 warehouse assignments requested for the receiving workflow. Future
-- assignments are explicit and therefore default to no receiving access.
alter table public.profile_warehouse_access
  add column if not exists can_receive_goods boolean not null default false;

update public.profile_warehouse_access access
set can_receive_goods = true
from public.profiles profile
where profile.id = access.user_id
  and (
    access.can_manage_stock
    or (profile.level = 2 and access.can_sell)
  );

create index if not exists idx_sales_created_by_fk
  on public.sales(created_by)
  where created_by is not null;

create index if not exists idx_goods_receipts_created_by_fk
  on public.goods_receipts(created_by)
  where created_by is not null;

create index if not exists idx_audit_logs_actor_id_fk
  on public.audit_logs(actor_id)
  where actor_id is not null;

create index if not exists idx_audit_logs_warehouse_id_fk
  on public.audit_logs(warehouse_id)
  where warehouse_id is not null;

-- Small policy/trigger helpers. They do not expose table data and are kept out
-- of the API schema. Explicit qualification makes search_path poisoning
-- impossible even when they execute with their owner's privileges.
create or replace function private.document_warehouse_id(p_data jsonb)
returns bigint
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_data ->> 'warehouseId', '') ~ '^[0-9]+$'
      then (p_data ->> 'warehouseId')::bigint
    when coalesce(p_data ->> 'fromId', '') ~ '^[0-9]+$'
      then (p_data ->> 'fromId')::bigint
    when coalesce(p_data #>> '{items,0,warehouseId}', '') ~ '^[0-9]+$'
      then (p_data #>> '{items,0,warehouseId}')::bigint
    else null
  end
$$;

create or replace function private.jsonb_flag_is_true(p_data jsonb, p_key text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select lower(coalesce(p_data ->> p_key, '')) in ('true', 't', '1', 'yes', 'on')
$$;

create or replace function private.is_safe_nonnegative_decimal(p_value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value numeric;
begin
  if p_value is null
     or p_value !~ '^[0-9]{1,12}([.][0-9]{1,18})?$' then
    return false;
  end if;
  v_value := p_value::numeric;
  return v_value >= 0 and v_value <= 1000000000000;
exception when others then
  return false;
end;
$$;

-- Every multi-table store mutation takes this shared transaction lock before
-- consulting mutable rows. Full-store restore takes the matching exclusive
-- lock, so it can never interleave with checkout, cash-shift or stock posting.
create or replace function private.acquire_store_mutation_gate()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('pepos-atomic-store-restore', 0)
  )
$$;

revoke all on function private.acquire_store_mutation_gate()
from public, anon, authenticated;

-- A single product namespace coordinates every multi-product inventory path.
-- Single-product operations cannot form a cross-product cycle, while checkout,
-- receiving, transfers, returns, exchanges, counts and voids all acquire these
-- transaction locks in ascending order before touching a Lot or balance row.
create or replace function private.acquire_inventory_product_locks(
  p_product_ids bigint[]
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_product_id bigint;
begin
  for v_product_id in
    select distinct requested.product_id
    from unnest(coalesce(p_product_ids, '{}'::bigint[])) requested(product_id)
    where requested.product_id is not null and requested.product_id > 0
    order by requested.product_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'inventory-product:' || v_product_id::text,
        0
      )
    );
  end loop;
end;
$$;

revoke all on function private.acquire_inventory_product_locks(bigint[])
from public, anon, authenticated, service_role;

create or replace function private.inventory_document_is_posted(
  p_table_name text,
  p_data jsonb
) returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_table_name
    when 'goods_receipts' then
      private.jsonb_flag_is_true(p_data, 'stockApplied')
      or nullif(btrim(coalesce(p_data ->> 'lotAppliedAt', '')), '') is not null
      or coalesce(p_data ->> 'status', '') in ('รับสินค้าแล้ว', 'ชำระเรียบร้อย')
    when 'product_returns' then
      private.jsonb_flag_is_true(p_data, 'stockApplied')
      or nullif(btrim(coalesce(p_data ->> 'lotAppliedAt', '')), '') is not null
      or coalesce(p_data ->> 'status', '') in ('คืนเรียบร้อย', 'ชำระเรียบร้อย')
    when 'product_exchanges' then
      private.jsonb_flag_is_true(p_data, 'outgoingApplied')
      or private.jsonb_flag_is_true(p_data, 'incomingApplied')
      or coalesce(p_data ->> 'status', '') in ('ส่งไปเปลี่ยนแล้ว', 'รับสินค้ากลับแล้ว')
    when 'transfers' then
      private.jsonb_flag_is_true(p_data, 'stockApplied')
      or nullif(btrim(coalesce(p_data ->> 'stockAppliedAt', '')), '') is not null
      or coalesce(p_data ->> 'status', '') in ('โอนแล้ว', 'โอนสินค้าแล้ว', 'สำเร็จ')
    else false
  end
$$;

create or replace function private.can_current_user_receive_goods(
  p_warehouse_id bigint
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_current_owner())
    or exists (
      select 1
      from public.profile_warehouse_access access
      where access.user_id = (select auth.uid())
        and access.warehouse_id = p_warehouse_id
        and access.can_receive_goods
    )
$$;

revoke all on function private.document_warehouse_id(jsonb)
  from public, anon, authenticated;
revoke all on function private.jsonb_flag_is_true(jsonb, text)
  from public, anon, authenticated;
revoke all on function private.is_safe_nonnegative_decimal(text)
  from public, anon, authenticated;
revoke all on function private.inventory_document_is_posted(text, jsonb)
  from public, anon, authenticated;
revoke all on function private.can_current_user_receive_goods(bigint)
  from public, anon, authenticated;
grant execute on function private.document_warehouse_id(jsonb) to authenticated;
grant execute on function private.jsonb_flag_is_true(jsonb, text) to authenticated;
grant execute on function private.inventory_document_is_posted(text, jsonb) to authenticated;
grant execute on function private.can_current_user_receive_goods(bigint) to authenticated;

-- Remove every legacy policy on the tables whose authorization model changes.
-- Limiting the list avoids disturbing the already-specialized policies for
-- profiles, products, favorites, promotions and inventory ledgers.
do $policies$
declare
  v_policy record;
  v_table text;
begin
  foreach v_table in array array[
    'settings', 'warehouses', 'categories', 'units', 'brands', 'contacts',
    'sales_representatives', 'sales', 'sale_items', 'quotations',
    'invoices_ar', 'credit_notes', 'purchase_orders', 'goods_receipts',
    'purchase_orders_full', 'product_returns', 'product_exchanges',
    'transfers', 'standalone_tax_invoices'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    for v_policy in
      select policyname
      from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end;
$policies$;

revoke all on table
  public.settings,
  public.warehouses,
  public.categories,
  public.units,
  public.brands,
  public.contacts,
  public.sales_representatives,
  public.sales,
  public.sale_items,
  public.quotations,
  public.invoices_ar,
  public.credit_notes,
  public.purchase_orders,
  public.goods_receipts,
  public.purchase_orders_full,
  public.product_returns,
  public.product_exchanges,
  public.transfers,
  public.standalone_tax_invoices
from anon, authenticated;

grant select on table
  public.settings,
  public.warehouses,
  public.categories,
  public.units,
  public.brands,
  public.contacts,
  public.sales_representatives,
  public.sales,
  public.sale_items,
  public.quotations,
  public.invoices_ar,
  public.credit_notes,
  public.purchase_orders,
  public.goods_receipts,
  public.purchase_orders_full,
  public.product_returns,
  public.product_exchanges,
  public.transfers,
  public.standalone_tax_invoices
to authenticated;

-- Direct writes remain available only for owner-maintained master data and
-- document drafts. Sales/settings/warehouses have no direct write grant.
grant insert, update, delete on table
  public.categories,
  public.units,
  public.brands,
  public.contacts,
  public.sales_representatives,
  public.quotations,
  public.invoices_ar,
  public.credit_notes,
  public.purchase_orders,
  public.goods_receipts,
  public.purchase_orders_full,
  public.product_returns,
  public.product_exchanges,
  public.transfers,
  public.standalone_tax_invoices
to authenticated;

grant all on table
  public.settings,
  public.warehouses,
  public.categories,
  public.units,
  public.brands,
  public.contacts,
  public.sales_representatives,
  public.sales,
  public.sale_items,
  public.quotations,
  public.invoices_ar,
  public.credit_notes,
  public.purchase_orders,
  public.goods_receipts,
  public.purchase_orders_full,
  public.product_returns,
  public.product_exchanges,
  public.transfers,
  public.standalone_tax_invoices
to service_role;

create policy settings_read_authenticated
on public.settings for select to authenticated
using (true);

create policy warehouses_read_assigned
on public.warehouses for select to authenticated
using (
  (select private.is_current_owner())
  or exists (
    select 1
    from public.profile_warehouse_access access
    where access.user_id = (select auth.uid())
      and access.warehouse_id = warehouses.id
  )
);

-- Owner-only master-data writes; all authenticated POS users need the reads.
do $master_policies$
declare
  v_table text;
begin
  foreach v_table in array array[
    'categories', 'units', 'brands', 'contacts', 'sales_representatives'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      v_table || '_read_authenticated', v_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_current_owner()))',
      v_table || '_insert_owner', v_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_current_owner())) with check ((select private.is_current_owner()))',
      v_table || '_update_owner', v_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_current_owner()))',
      v_table || '_delete_owner', v_table
    );
  end loop;
end;
$master_policies$;

create policy sales_read_assigned_warehouse
on public.sales for select to authenticated
using (
  (select private.is_current_owner())
  or exists (
    select 1
    from public.profile_warehouse_access access
    where access.user_id = (select auth.uid())
      and access.warehouse_id = private.document_warehouse_id(sales.data)
      and access.can_sell
  )
);

create policy sale_items_read_via_sale
on public.sale_items for select to authenticated
using (
  exists (
    select 1 from public.sales sale where sale.id = sale_items.sale_id
  )
);

-- Non-stock documents are owner records. Their drafts can still use the
-- incremental browser sync, while authorization no longer relies on a blanket
-- authenticated policy.
do $owner_document_policies$
declare
  v_table text;
begin
  foreach v_table in array array[
    'quotations', 'invoices_ar', 'credit_notes', 'purchase_orders',
    'purchase_orders_full', 'standalone_tax_invoices'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_current_owner()))',
      v_table || '_read_owner', v_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_current_owner()))',
      v_table || '_insert_owner', v_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_current_owner())) with check ((select private.is_current_owner()))',
      v_table || '_update_owner', v_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_current_owner()))',
      v_table || '_delete_owner', v_table
    );
  end loop;
end;
$owner_document_policies$;

-- LEVEL 2 may receive goods only in a warehouse for which can_receive_goods
-- was explicitly granted. Direct writes can create/update/delete drafts only;
-- posting is performed by apply_goods_receipt_lots().
create policy goods_receipts_read_assigned
on public.goods_receipts for select to authenticated
using (
  private.can_current_user_receive_goods(
    private.document_warehouse_id(goods_receipts.data)
  )
);

create policy goods_receipts_insert_draft
on public.goods_receipts for insert to authenticated
with check (
  not private.inventory_document_is_posted('goods_receipts', data)
  and (
    (select private.is_current_owner())
    or (
      created_by = (select auth.uid())
      and private.can_current_user_receive_goods(
        private.document_warehouse_id(goods_receipts.data)
      )
    )
  )
);

create policy goods_receipts_update_draft
on public.goods_receipts for update to authenticated
using (
  not private.inventory_document_is_posted('goods_receipts', data)
  and (
    (select private.is_current_owner())
    or (
      created_by = (select auth.uid())
      and private.can_current_user_receive_goods(
        private.document_warehouse_id(goods_receipts.data)
      )
    )
  )
)
with check (
  not private.inventory_document_is_posted('goods_receipts', data)
  and (
    (select private.is_current_owner())
    or (
      created_by = (select auth.uid())
      and private.can_current_user_receive_goods(
        private.document_warehouse_id(goods_receipts.data)
      )
    )
  )
);

create policy goods_receipts_delete_draft
on public.goods_receipts for delete to authenticated
using (
  not private.inventory_document_is_posted('goods_receipts', data)
  and (
    (select private.is_current_owner())
    or (
      created_by = (select auth.uid())
      and private.can_current_user_receive_goods(
        private.document_warehouse_id(goods_receipts.data)
      )
    )
  )
);

-- Re-authorize the existing posting primitive with the dedicated receiving
-- capability. Non-owners may post only receipts that they created themselves.
create or replace function public.apply_goods_receipt_lots(p_receipt_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.goods_receipts%rowtype;
  v_data jsonb;
  v_item jsonb;
  v_lots jsonb := '[]'::jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_normalized_entries jsonb := '[]'::jsonb;
  v_warehouse bigint;
  v_product bigint;
  v_product_row public.products%rowtype;
  v_qty numeric;
  v_factor numeric;
  v_cost numeric;
  v_unit_name text;
  v_main_unit text;
  v_unit_matches integer;
  v_expiry date;
  v_lot_number text;
  v_line_key text;
  v_lot_id bigint;
  v_ord bigint;
  v_stock numeric;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if nullif(btrim(coalesce(p_receipt_id, '')), '') is null then
    raise exception 'goods receipt is required';
  end if;

  select * into v_row
  from public.goods_receipts
  where id = p_receipt_id
  for update;
  if not found then
    raise exception 'goods receipt not found';
  end if;

  v_data := coalesce(v_row.data, '{}'::jsonb);
  v_warehouse := private.document_warehouse_id(v_data);
  if v_warehouse is null then
    raise exception 'warehouse is required';
  end if;
  if not (select private.is_current_owner()) and not (
    v_row.created_by = (select auth.uid())
    and private.can_current_user_receive_goods(v_warehouse)
  ) then
    raise exception 'goods receipt access denied';
  end if;
  if coalesce(v_data ->> 'lotAppliedAt', '') <> '' then
    return jsonb_build_object('receipt', v_data, 'lots', v_lots);
  end if;
  if private.jsonb_flag_is_true(v_data, 'stockApplied') then
    return jsonb_build_object(
      'receipt', v_data, 'lots', v_lots, 'legacy', true
    );
  end if;

  if jsonb_typeof(v_data -> 'items') is distinct from 'array'
     or jsonb_array_length(v_data -> 'items') = 0
     or jsonb_array_length(v_data -> 'items') > 500
     or exists(
       select 1
       from jsonb_array_elements(v_data -> 'items') with ordinality item(value, ordinality)
       where jsonb_typeof(item.value) <> 'object'
          or coalesce(item.value ->> 'productId', '') !~ '^[0-9]+$'
          or coalesce(item.value ->> 'qty', '') !~ '^[0-9]{1,12}([.][0-9]{1,18})?$'
          or coalesce(item.value ->> 'price', '') !~ '^[0-9]{1,12}([.][0-9]{1,18})?$'
          or nullif(btrim(coalesce(item.value ->> 'unit', '')), '') is null
          or char_length(btrim(item.value ->> 'unit')) > 100
          or char_length(coalesce(item.value ->> 'lotNumber', '')) > 200
          or char_length(
               coalesce(nullif(btrim(item.value ->> 'lineId'), ''), ordinality::text)
             ) > 128
          or (
            nullif(item.value ->> 'warehouseId', '') is not null
            and (
              coalesce(item.value ->> 'warehouseId', '') !~ '^[0-9]+$'
              or item.value ->> 'warehouseId' <> v_warehouse::text
            )
          )
          or (
            nullif(item.value ->> 'expiry', '') is not null
            and coalesce(item.value ->> 'expiry', '') !~ '^\d{4}-\d{2}-\d{2}$'
          )
     )
     or exists(
       select 1
       from (
         select
           coalesce(nullif(btrim(value ->> 'lineId'), ''), ordinality::text) as line_key,
           count(*) as line_count
         from jsonb_array_elements(v_data -> 'items') with ordinality
         group by 1
       ) duplicate_line
       where duplicate_line.line_count > 1
  ) then
    raise exception 'invalid goods receipt items';
  end if;

  perform private.acquire_inventory_product_locks(array(
    select distinct (item.value ->> 'productId')::bigint
    from jsonb_array_elements(v_data -> 'items') item(value)
    order by 1
  ));

  -- Resolve and lock every catalog row in a stable order before touching any
  -- Lot or balance row. This aligns concurrent receipts with checkout's
  -- product ordering while the original document order is retained below.
  for v_product_row in
    select product.*
    from public.products product
    join (
      select distinct (item.value ->> 'productId')::bigint as product_id
      from jsonb_array_elements(v_data -> 'items') item(value)
    ) requested on requested.product_id = product.id
    order by product.id
    for share of product
  loop
    null;
  end loop;

  for v_item, v_ord in
    select value, ordinality
    from jsonb_array_elements(coalesce(v_data -> 'items', '[]'::jsonb))
      with ordinality
    order by
      (value ->> 'productId')::bigint,
      coalesce(nullif(btrim(value ->> 'lineId'), ''), ordinality::text),
      ordinality
  loop
    v_product := (v_item ->> 'productId')::bigint;
    v_unit_name := btrim(v_item ->> 'unit');
    select * into v_product_row
    from public.products product
    where product.id = v_product;
    if not found then
      raise exception 'goods receipt product not found at item %', v_ord;
    end if;
    if lower(coalesce(
         nullif(v_product_row.data ->> 'type', ''),
         nullif(v_product_row.product_type, ''),
         'stock'
       )) in ('nostock', 'service') then
      raise exception
        'goods receipt product does not track stock at item %', v_ord;
    end if;
    v_main_unit := coalesce(
      nullif(btrim(v_product_row.data ->> 'unit'), ''),
      nullif(btrim(v_product_row.unit), '')
    );
    if v_unit_name = v_main_unit then
      v_factor := 1;
    else
      select
        count(*) filter (
          where private.is_safe_nonnegative_decimal(unit_value ->> 'factor')
        ),
        max(case
          when private.is_safe_nonnegative_decimal(unit_value ->> 'factor')
            then (unit_value ->> 'factor')::numeric
          else null
        end)
      into v_unit_matches, v_factor
      from jsonb_array_elements(
        case when jsonb_typeof(v_product_row.data -> 'units') = 'array'
          then v_product_row.data -> 'units' else '[]'::jsonb end
      ) unit_value
      where btrim(coalesce(unit_value ->> 'sub', '')) = v_unit_name
      ;
      if v_unit_matches <> 1 or v_factor <= 0 or v_factor > 1000000000000 then
        raise exception 'invalid goods receipt unit at item %', v_ord;
      end if;
    end if;
    v_qty := (v_item ->> 'qty')::numeric * v_factor;
    if v_qty <= 0 or v_qty > 1000000000000 then
      raise exception 'invalid goods receipt item %', v_ord;
    end if;
    v_line_key := coalesce(nullif(btrim(v_item ->> 'lineId'), ''), v_ord::text);
    v_lot_number := nullif(btrim(coalesce(v_item ->> 'lotNumber', '')), '');
    v_expiry := case
      when coalesce(v_item ->> 'expiry', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (v_item ->> 'expiry')::date
      else null
    end;
    v_cost := (v_item ->> 'price')::numeric / v_factor;
    if v_cost < 0 or v_cost > 1000000000000 then
      raise exception 'invalid goods receipt cost at item %', v_ord;
    end if;
    v_lot_id := private.create_inventory_lot(
      v_product, v_warehouse, v_qty, v_lot_number, v_expiry, v_cost,
      'goods_receipt', p_receipt_id, v_line_key,
      coalesce(v_row.created_at, clock_timestamp())
    );
    insert into public.inventory_lot_movements(
      lot_id, product_id, warehouse_id, movement_type, quantity_delta,
      balance_after, reference_type, reference_id, reference_line_key, note
    )
    select
      v_lot_id, v_product, v_warehouse, 'receive', v_qty,
      lot.quantity_base, 'goods_receipt', p_receipt_id, v_line_key,
      'รับเข้าสินค้า'
    from public.inventory_lots lot
    where lot.id = v_lot_id
    on conflict do nothing;
    v_stock := private.refresh_inventory_balance_from_lots(
      v_product, v_warehouse
    );
    v_lots := v_lots || jsonb_build_array(jsonb_build_object(
      'lineKey', v_line_key, 'lotId', v_lot_id, 'stock', v_stock
    ));
    v_item := jsonb_set(v_item, '{lineId}', to_jsonb(v_line_key), true);
    v_item := jsonb_set(v_item, '{warehouseId}', to_jsonb(v_warehouse), true);
    v_item := jsonb_set(v_item, '{stockFactor}', to_jsonb(v_factor), true);
    v_normalized_entries := v_normalized_entries || jsonb_build_array(
      jsonb_build_object('ordinality', v_ord, 'item', v_item)
    );
  end loop;

  select coalesce(
    jsonb_agg(entry.value -> 'item' order by (entry.value ->> 'ordinality')::bigint),
    '[]'::jsonb
  )
  into v_normalized_items
  from jsonb_array_elements(v_normalized_entries) entry(value);

  v_data := jsonb_set(v_data, '{items}', v_normalized_items, true);
  v_data := jsonb_set(
    v_data, '{status}', to_jsonb('รับสินค้าแล้ว'::text), true
  );
  v_data := jsonb_set(v_data, '{stockApplied}', 'true'::jsonb, true);
  v_data := jsonb_set(
    v_data, '{stockAppliedAt}', to_jsonb(clock_timestamp()::text), true
  );
  v_data := jsonb_set(
    v_data, '{lotAppliedAt}', to_jsonb(clock_timestamp()::text), true
  );
  perform set_config('pepos.inventory_state_write', 'on', true);
  update public.goods_receipts
  set data = v_data, updated_at = clock_timestamp()
  where id = p_receipt_id;
  return jsonb_build_object('receipt', v_data, 'lots', v_lots);
end;
$$;

-- Other stock documents remain owner workflows. Only an unposted draft may be
-- changed directly; existing posting RPCs perform the terminal transition.
do $stock_document_policies$
declare
  v_table text;
begin
  foreach v_table in array array[
    'product_returns', 'product_exchanges', 'transfers'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_current_owner()))',
      v_table || '_read_owner', v_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_current_owner()) and not private.inventory_document_is_posted(%L, data))',
      v_table || '_insert_owner_draft', v_table, v_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_current_owner()) and not private.inventory_document_is_posted(%L, data)) with check ((select private.is_current_owner()) and not private.inventory_document_is_posted(%L, data))',
      v_table || '_update_owner_draft', v_table, v_table, v_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_current_owner()) and not private.inventory_document_is_posted(%L, data))',
      v_table || '_delete_owner_draft', v_table, v_table
    );
  end loop;
end;
$stock_document_policies$;

-- Checked write paths for the two shared configuration tables. Keeping their
-- direct table grants read-only prevents a stale Level 2 browser from
-- overwriting store-wide settings or warehouse definitions.
create or replace function public.owner_set_setting(
  p_key text,
  p_value jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(coalesce(p_key, '')), '');
  v_row public.settings%rowtype;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner access required';
  end if;
  if v_key is null or char_length(v_key) > 100 then
    raise exception 'invalid setting key';
  end if;
  if v_key = 'maintenance_epoch' then
    raise exception 'maintenance epoch is managed by the reset service';
  end if;
  if p_value is null or pg_column_size(p_value) > 1048576 then
    raise exception 'invalid setting value';
  end if;

  insert into public.settings(key, value, updated_at)
  values(v_key, p_value, clock_timestamp())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.owner_upsert_warehouse(
  p_id bigint,
  p_name text,
  p_data jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_row public.warehouses%rowtype;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner access required';
  end if;
  if v_name is null or char_length(v_name) > 200 then
    raise exception 'invalid warehouse name';
  end if;
  if jsonb_typeof(v_data) <> 'object' or pg_column_size(v_data) > 1048576 then
    raise exception 'invalid warehouse data';
  end if;

  if p_id is null then
    insert into public.warehouses(name, data, created_at, updated_at)
    values(v_name, v_data, clock_timestamp(), clock_timestamp())
    returning * into v_row;
  elsif exists(select 1 from public.warehouses warehouse where warehouse.id = p_id) then
    update public.warehouses
    set name = v_name,
        data = v_data,
        updated_at = clock_timestamp()
    where id = p_id
    returning * into v_row;
  else
    insert into public.warehouses(id, name, data, created_at, updated_at)
    overriding system value
    values(p_id, v_name, v_data, clock_timestamp(), clock_timestamp())
    returning * into v_row;
    perform setval(
      pg_get_serial_sequence('public.warehouses', 'id')::regclass,
      greatest((select max(warehouse.id) from public.warehouses warehouse), 1),
      true
    );
  end if;

  -- Keep the JSON representation self-contained for clients that hydrate from
  -- `data`, including a deterministic code when a newly allocated id was not
  -- known to the browser yet.
  v_data := jsonb_set(v_data, '{id}', to_jsonb(v_row.id), true);
  v_data := jsonb_set(v_data, '{name}', to_jsonb(v_name), true);
  if nullif(btrim(coalesce(v_data ->> 'code', '')), '') is null then
    v_data := jsonb_set(
      v_data,
      '{code}',
      to_jsonb(
        private.configured_document_prefix('warehouse', 'WH')
        || '-' || lpad(v_row.id::text, 3, '0')
      ),
      true
    );
  end if;
  update public.warehouses
  set data = v_data,
      updated_at = clock_timestamp()
  where id = v_row.id
  returning * into v_row;

  insert into public.profile_warehouse_access(
    user_id, warehouse_id, can_sell, can_manage_stock, can_receive_goods
  )
  values((select auth.uid()), v_row.id, true, true, true)
  on conflict (user_id, warehouse_id) do update
    set can_sell = true,
        can_manage_stock = true,
        can_receive_goods = true;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.owner_delete_warehouse(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner access required';
  end if;
  if p_id is null then
    raise exception 'warehouse is required';
  end if;
  if exists(select 1 from public.products product where product.warehouse_id = p_id)
     or exists(select 1 from public.inventory_balances balance where balance.warehouse_id = p_id)
     or exists(select 1 from public.inventory_lots lot where lot.warehouse_id = p_id)
     or exists(select 1 from public.cash_shifts shift where shift.warehouse_id = p_id)
     or exists(
       select 1 from public.sales sale
       where private.document_warehouse_id(sale.data) = p_id
     )
     or exists(
       select 1 from public.goods_receipts document
       where private.document_warehouse_id(document.data) = p_id
     )
     or exists(
       select 1 from public.product_returns document
       where private.document_warehouse_id(document.data) = p_id
     )
     or exists(
       select 1 from public.product_exchanges document
       where private.document_warehouse_id(document.data) = p_id
     )
     or exists(
       select 1 from public.transfers document
       where private.document_warehouse_id(document.data) = p_id
          or case when coalesce(document.data ->> 'toId', '') ~ '^[0-9]+$'
            then (document.data ->> 'toId')::bigint else null end = p_id
     )
     or exists(
       select 1 from public.quotations document
       where private.document_warehouse_id(document.data) = p_id
     )
     or exists(
       select 1 from public.invoices_ar document
       where private.document_warehouse_id(document.data) = p_id
     )
     or exists(
       select 1 from public.credit_notes document
       where private.document_warehouse_id(document.data) = p_id
     )
     or exists(
       select 1 from public.purchase_orders document
       where private.document_warehouse_id(document.data) = p_id
     )
     or exists(
       select 1 from public.purchase_orders_full document
       where private.document_warehouse_id(document.data) = p_id
     )
     or exists(
       select 1 from public.standalone_tax_invoices document
       where private.document_warehouse_id(document.data) = p_id
     ) then
    raise exception 'warehouse has product, inventory, shift, sale or document history and cannot be deleted';
  end if;

  delete from public.warehouses
  where id = p_id
  returning name into v_name;
  if not found then
    return jsonb_build_object('deleted', false, 'warehouseId', p_id);
  end if;
  return jsonb_build_object(
    'deleted', true,
    'warehouseId', p_id,
    'name', v_name
  );
end;
$$;

-- Completed sale rows are immutable. Only the narrow metadata RPC below and
-- trusted state-transition RPCs may update them. The maintenance reset flag is
-- intentionally service-only and remains the sole history deletion bypass.
create or replace function private.protect_sale_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata_write boolean :=
    current_setting('pepos.sale_metadata_write', true) = 'on';
  v_state_write boolean :=
    current_setting('pepos.sale_state_write', true) = 'on';
begin
  if current_setting('pepos.maintenance_reset', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if coalesce(old.status, 'done') <> 'hold'
       or old.checkout_request_id is not null
       or old.cash_shift_id is not null
       or old.void_shift_id is not null
       or exists(
         select 1
         from public.inventory_lot_movements movement
         where movement.reference_id = old.id
           and movement.reference_type in ('sale', 'sale_void', 'sale_lot_correction')
       )
       or exists(select 1 from public.sale_items item where item.sale_id = old.id) then
      raise exception 'sale history cannot be deleted; void a completed sale instead';
    end if;
    return old;
  end if;

  if v_state_write then
    return new;
  end if;

  if v_metadata_write then
    if (to_jsonb(new) - 'data') is distinct from (to_jsonb(old) - 'data')
       or (coalesce(new.data, '{}'::jsonb)
             - 'shortReceiptMeta' - 'cashReceiptA4Meta' - 'fullTaxInvoice')
          is distinct from
          (coalesce(old.data, '{}'::jsonb)
             - 'shortReceiptMeta' - 'cashReceiptA4Meta' - 'fullTaxInvoice') then
      raise exception 'only sale document metadata may be changed';
    end if;
    return new;
  end if;

  -- Existing trusted RPCs predate the transaction-local flags above. Preserve
  -- their compatibility while requiring the evidence each one writes in the
  -- same transaction. Browser roles have no direct UPDATE grant on sales.
  if old.status = 'done'
     and new.status = 'void'
     and (select private.is_current_owner())
     and new.void_shift_id is not null
     and coalesce(new.data ->> 'status', '') = 'void'
     and nullif(btrim(coalesce(new.data ->> 'voidReason', '')), '') is not null
     and (
       not exists(
         select 1
         from jsonb_array_elements(
           coalesce(old.data -> 'items', '[]'::jsonb)
         ) item
         where lower(coalesce(item ->> 'custom', 'false'))
                 not in ('true', 't', '1', 'yes', 'on')
           and nullif(item ->> 'productId', '') is not null
           -- Missing is treated as stock-tracked for legacy sales. Only the
           -- authoritative checkout snapshot may opt a line out of Lot work.
           and lower(coalesce(item ->> 'tracksStock', 'true'))
                 not in ('false', 'f', '0', 'no', 'off')
       )
       or exists(
         select 1
         from public.inventory_lot_movements movement
         where movement.reference_type = 'sale_void'
           and movement.reference_id = old.id
       )
     ) then
    return new;
  end if;

  if old.status = 'done'
     and new.status = 'done'
     and (select private.is_current_owner())
     and (to_jsonb(new) - 'data') is not distinct from (to_jsonb(old) - 'data')
     and exists(
       select 1
       from public.inventory_lot_movements movement
       where movement.reference_type = 'sale_lot_correction'
         and movement.reference_id = old.id
         and movement.created_by = (select auth.uid())
     )
     and jsonb_array_length(
       coalesce(new.data -> 'lotCorrectionLog', '[]'::jsonb)
     ) = jsonb_array_length(
       coalesce(old.data -> 'lotCorrectionLog', '[]'::jsonb)
     ) + 1 then
    return new;
  end if;

  if coalesce(old.status, 'done') in ('done', 'void')
     or old.checkout_request_id is not null
     or old.cash_shift_id is not null
     or old.void_shift_id is not null then
    raise exception 'completed sale is immutable; use an approved sale RPC';
  end if;

  -- Legacy hold rows are allowed only for an internal hold RPC. No browser role
  -- has UPDATE on sales, so reaching this branch directly still cannot write.
  return new;
end;
$$;

revoke all on function private.protect_sale_history()
from public, anon, authenticated;

drop trigger if exists protect_completed_sale_delete on public.sales;
drop trigger if exists protect_sale_history on public.sales;
create trigger protect_sale_history
before update or delete on public.sales
for each row execute function private.protect_sale_history();

create or replace function public.update_sale_document_metadata(
  p_sale_id text,
  p_metadata jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_data jsonb;
  v_key text;
  v_warehouse_id bigint;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if nullif(btrim(coalesce(p_sale_id, '')), '') is null then
    raise exception 'sale is required';
  end if;
  if jsonb_typeof(coalesce(p_metadata, 'null'::jsonb)) <> 'object'
     or pg_column_size(p_metadata) > 1048576 then
    raise exception 'invalid sale document metadata';
  end if;
  if exists(
    select 1
    from jsonb_object_keys(p_metadata) as metadata_keys(key_name)
    where key_name not in ('shortReceiptMeta', 'cashReceiptA4Meta', 'fullTaxInvoice')
  ) then
    raise exception 'unsupported sale document metadata key';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
  for update;
  if not found then
    raise exception 'sale not found';
  end if;
  if v_sale.status <> 'done' then
    raise exception 'only completed non-void sales can issue documents';
  end if;

  v_warehouse_id := private.document_warehouse_id(v_sale.data);
  if not (select private.is_current_owner()) and not exists(
    select 1
    from public.profile_warehouse_access access
    where access.user_id = (select auth.uid())
      and access.warehouse_id = v_warehouse_id
      and access.can_sell
  ) then
    raise exception 'sale warehouse access denied';
  end if;

  v_data := coalesce(v_sale.data, '{}'::jsonb);
  for v_key in
    select key_name
    from jsonb_object_keys(p_metadata) as metadata_keys(key_name)
  loop
    if p_metadata -> v_key = 'null'::jsonb then
      v_data := v_data - v_key;
    else
      v_data := jsonb_set(v_data, array[v_key], p_metadata -> v_key, true);
    end if;
  end loop;

  perform set_config('pepos.sale_metadata_write', 'on', true);
  update public.sales set data = v_data where id = p_sale_id;
  return v_data;
end;
$$;

create or replace function public.save_held_sale(p_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := nullif(btrim(coalesce(p_sale ->> 'id', '')), '');
  v_warehouse_id bigint := private.document_warehouse_id(p_sale);
  v_existing public.sales%rowtype;
  v_row public.sales%rowtype;
  v_sale_time timestamptz;
  v_sale_data jsonb;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if jsonb_typeof(coalesce(p_sale, 'null'::jsonb)) <> 'object'
     or char_length(coalesce(v_id, '')) > 100
     or v_warehouse_id is null
     or coalesce(p_sale ->> 'status', 'hold') <> 'hold'
     or jsonb_typeof(coalesce(p_sale -> 'items', 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_sale -> 'items') = 0
     or jsonb_array_length(p_sale -> 'items') > 500
     or pg_column_size(p_sale) > 2097152 then
    raise exception 'invalid held sale';
  end if;
  if not (select private.is_current_owner()) and not exists(
    select 1
    from public.profile_warehouse_access access
    where access.user_id = (select auth.uid())
      and access.warehouse_id = v_warehouse_id
      and access.can_sell
  ) then
    raise exception 'warehouse sale access denied';
  end if;

  if v_id is null then
    v_id := 'HOLD-' || replace(gen_random_uuid()::text, '-', '');
  else
    perform pg_advisory_xact_lock(hashtextextended('held-sale:' || v_id, 0));
    select * into v_existing from public.sales where id = v_id for update;
    if not found or (
        coalesce(v_existing.status, 'done') <> 'hold'
        or v_existing.checkout_request_id is not null
        or v_existing.cash_shift_id is not null
        or v_existing.void_shift_id is not null
        or (
          not (select private.is_current_owner())
          and v_existing.created_by is distinct from (select auth.uid())
        )
      ) then
      -- A client-generated display id may collide across tills. Never overwrite
      -- that row (and never trust a new client id); allocate a UUID-backed hold
      -- id and return it to the caller.
      v_id := 'HOLD-' || replace(gen_random_uuid()::text, '-', '');
    end if;
  end if;

  v_sale_data := jsonb_set(p_sale, '{id}', to_jsonb(v_id), true);
  v_sale_data := jsonb_set(v_sale_data, '{status}', to_jsonb('hold'::text), true);

  begin
    v_sale_time := nullif(p_sale ->> 'time', '')::timestamptz;
  exception when others then
    v_sale_time := clock_timestamp();
  end;

  perform set_config('pepos.sale_state_write', 'on', true);
  insert into public.sales(
    id, ref, sale_date, sale_time, cashier, member, status, pay_method,
    discount, vat, fee, cost_total, gross_profit, cash_received, cash_change,
    total, data, checkout_request_id, checkout_payload_hash,
    checkout_request_context, cash_shift_id, void_shift_id, created_by
  ) values (
    v_id,
    nullif(p_sale ->> 'ref', ''),
    case when coalesce(p_sale ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (p_sale ->> 'date')::date else current_date end,
    v_sale_time,
    nullif(p_sale ->> 'cashier', ''),
    case when jsonb_typeof(p_sale -> 'member') = 'object'
      then nullif(p_sale #>> '{member,name}', '') else nullif(p_sale ->> 'member', '') end,
    'hold',
    nullif(p_sale ->> 'payMethod', ''),
    coalesce(nullif(p_sale ->> 'discount', '')::numeric, 0),
    coalesce(nullif(p_sale ->> 'vat', '')::numeric, 0),
    coalesce(nullif(p_sale ->> 'fee', '')::numeric, 0),
    coalesce(nullif(p_sale ->> 'costTotal', '')::numeric, 0),
    coalesce(nullif(p_sale ->> 'grossProfit', '')::numeric, 0),
    coalesce(nullif(p_sale ->> 'cashReceived', '')::numeric, 0),
    coalesce(nullif(p_sale ->> 'cashChange', '')::numeric, 0),
    coalesce(nullif(p_sale ->> 'total', '')::numeric, 0),
    v_sale_data,
    null, null, null, null, null, (select auth.uid())
  )
  on conflict (id) do update set
    ref = excluded.ref,
    sale_date = excluded.sale_date,
    sale_time = excluded.sale_time,
    cashier = excluded.cashier,
    member = excluded.member,
    status = 'hold',
    pay_method = excluded.pay_method,
    discount = excluded.discount,
    vat = excluded.vat,
    fee = excluded.fee,
    cost_total = excluded.cost_total,
    gross_profit = excluded.gross_profit,
    cash_received = excluded.cash_received,
    cash_change = excluded.cash_change,
    total = excluded.total,
    data = excluded.data
  returning * into v_row;

  return coalesce(v_row.data, '{}'::jsonb);
end;
$$;

create or replace function public.delete_held_sale(p_sale_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_warehouse_id bigint;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  select * into v_sale
  from public.sales
  where id = p_sale_id
  for update;
  if not found then
    return jsonb_build_object('deleted', false, 'saleId', p_sale_id);
  end if;
  if coalesce(v_sale.status, 'done') <> 'hold'
     or v_sale.checkout_request_id is not null
     or v_sale.cash_shift_id is not null
     or v_sale.void_shift_id is not null
     or (
       not (select private.is_current_owner())
       and v_sale.created_by is distinct from (select auth.uid())
     ) then
    raise exception 'only a held sale can be deleted';
  end if;
  v_warehouse_id := private.document_warehouse_id(v_sale.data);
  if not (select private.is_current_owner()) and not exists(
    select 1
    from public.profile_warehouse_access access
    where access.user_id = (select auth.uid())
      and access.warehouse_id = v_warehouse_id
      and access.can_sell
  ) then
    raise exception 'warehouse sale access denied';
  end if;

  delete from public.sales where id = p_sale_id;
  return jsonb_build_object('deleted', true, 'saleId', p_sale_id);
end;
$$;

-- Stock evidence stays immutable after posting, but settlement is a distinct
-- forward-only business event. Keep that small metadata update behind a
-- checked RPC instead of reopening direct UPDATE on the posted document.
create or replace function public.record_goods_receipt_payment(
  p_receipt_id text,
  p_payment jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.goods_receipts%rowtype;
  v_data jsonb;
  v_warehouse_id bigint;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if nullif(btrim(coalesce(p_receipt_id, '')), '') is null
     or jsonb_typeof(coalesce(p_payment, 'null'::jsonb)) <> 'object'
     or pg_column_size(p_payment) > 65536
     or exists(
       select 1
       from jsonb_object_keys(p_payment) as payment_keys(key_name)
       where key_name not in (
         'date', 'amount', 'withholding', 'reasonType', 'reason', 'method', 'note'
       )
     )
     or not private.is_safe_nonnegative_decimal(p_payment ->> 'amount') then
    raise exception 'invalid goods receipt payment';
  end if;

  select * into v_row
  from public.goods_receipts
  where id = p_receipt_id
  for update;
  if not found then
    raise exception 'goods receipt not found';
  end if;
  v_data := coalesce(v_row.data, '{}'::jsonb);
  v_warehouse_id := private.document_warehouse_id(v_data);
  if not private.inventory_document_is_posted('goods_receipts', v_data) then
    raise exception 'goods receipt must be posted before payment';
  end if;
  if jsonb_typeof(v_data -> 'payment') = 'object'
     or coalesce(v_data ->> 'status', '') = 'ชำระเรียบร้อย' then
    raise exception 'goods receipt payment is already recorded';
  end if;
  if not (select private.is_current_owner()) and not (
    v_row.created_by = (select auth.uid())
    and private.can_current_user_receive_goods(v_warehouse_id)
  ) then
    raise exception 'goods receipt payment access denied';
  end if;

  v_data := jsonb_set(v_data, '{payment}', p_payment, true);
  v_data := jsonb_set(
    v_data, '{status}', to_jsonb('ชำระเรียบร้อย'::text), true
  );
  perform set_config('pepos.inventory_metadata_write', 'on', true);
  update public.goods_receipts
  set data = v_data,
      updated_at = clock_timestamp()
  where id = p_receipt_id;

  return jsonb_build_object('receipt', v_data);
end;
$$;

-- A posted inventory document is evidence, not an editable draft. This guard
-- also checks its ledger rows, so changing stockApplied/status first can never
-- make a posted document deletable.
create or replace function private.protect_inventory_document_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_data jsonb := coalesce(old.data, '{}'::jsonb);
  v_new_data jsonb := case when tg_op = 'UPDATE'
    then coalesce(new.data, '{}'::jsonb) else '{}'::jsonb end;
  v_reference_type text := case tg_table_name
    when 'goods_receipts' then 'goods_receipt'
    when 'product_returns' then 'product_return'
    when 'product_exchanges' then 'product_exchange'
    else null
  end;
  v_has_ledger boolean := false;
  v_old_posted boolean := private.inventory_document_is_posted(
    tg_table_name, v_old_data
  );
  v_new_posted boolean := case when tg_op = 'UPDATE' then
    private.inventory_document_is_posted(tg_table_name, v_new_data)
    else false end;
  v_metadata_write boolean :=
    current_setting('pepos.inventory_metadata_write', true) = 'on';
begin
  if current_setting('pepos.maintenance_reset', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_reference_type is not null then
    select exists(
      select 1
      from public.inventory_lot_movements movement
      where movement.reference_type = v_reference_type
        and movement.reference_id = old.id
    ) into v_has_ledger;
  end if;

  if tg_op = 'DELETE' then
    if v_old_posted or v_has_ledger then
      raise exception 'inventory-posted document history cannot be deleted';
    end if;
    return old;
  end if;

  if tg_table_name = 'goods_receipts'
     and (to_jsonb(new) -> 'created_by') is distinct from
         (to_jsonb(old) -> 'created_by') then
    raise exception 'goods receipt creator is immutable';
  end if;

  if v_metadata_write and tg_table_name = 'goods_receipts' then
    if not v_old_posted
       or not v_new_posted
       or coalesce(v_new_data ->> 'status', '') <> 'ชำระเรียบร้อย'
       or jsonb_typeof(v_new_data -> 'payment') <> 'object'
       or (v_new_data - 'payment' - 'status') is distinct from
          (v_old_data - 'payment' - 'status')
       or (to_jsonb(new) - 'data' - 'updated_at') is distinct from
          (to_jsonb(old) - 'data' - 'updated_at') then
      raise exception 'only posted goods receipt payment metadata may be changed';
    end if;
    return new;
  end if;

  -- Product exchange has two valid forward-only posting stages. The second
  -- stage may extend the already-posted row only after exchange_in movements
  -- exist; it can never clear the outgoing stage.
  if tg_table_name = 'product_exchanges'
     and private.jsonb_flag_is_true(v_old_data, 'outgoingApplied')
     and not private.jsonb_flag_is_true(v_old_data, 'incomingApplied')
     and private.jsonb_flag_is_true(v_new_data, 'outgoingApplied')
     and private.jsonb_flag_is_true(v_new_data, 'incomingApplied')
     and exists(
       select 1
       from public.inventory_lot_movements movement
       where movement.reference_type = 'product_exchange'
         and movement.reference_id = old.id
         and movement.movement_type = 'exchange_in'
     ) then
    return new;
  end if;

  if v_old_posted then
    if new.data is distinct from old.data then
      raise exception 'inventory-posted document is immutable';
    end if;
    return new;
  end if;

  -- Applied flags are monotonic. The first transition is accepted only after
  -- the posting RPC has already written the authoritative movement rows. The
  -- transfer RPC is owner-only and marks a transaction-local trusted flag.
  if private.jsonb_flag_is_true(v_old_data, 'stockApplied')
     and not private.jsonb_flag_is_true(v_new_data, 'stockApplied') then
    raise exception 'stockApplied cannot be reverted';
  end if;
  if private.jsonb_flag_is_true(v_old_data, 'outgoingApplied')
     and not private.jsonb_flag_is_true(v_new_data, 'outgoingApplied') then
    raise exception 'outgoingApplied cannot be reverted';
  end if;
  if private.jsonb_flag_is_true(v_old_data, 'incomingApplied')
     and not private.jsonb_flag_is_true(v_new_data, 'incomingApplied') then
    raise exception 'incomingApplied cannot be reverted';
  end if;

  if v_new_posted and not v_old_posted then
    if tg_table_name = 'transfers' then
      if current_setting('pepos.inventory_posting', true) <> 'on' then
        raise exception 'transfer must be posted through apply_inventory_transfer';
      end if;
    elsif not v_has_ledger then
      raise exception 'document cannot be marked posted without inventory movements';
    end if;
    return new;
  end if;

  if v_has_ledger then
    raise exception 'document has inventory movements and must remain posted';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_inventory_document_history()
from public, anon, authenticated;

do $document_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'goods_receipts', 'product_returns', 'product_exchanges', 'transfers'
  ] loop
    execute format(
      'drop trigger if exists protect_posted_inventory_document_delete on public.%I',
      v_table
    );
    execute format(
      'drop trigger if exists protect_inventory_document_history on public.%I',
      v_table
    );
    execute format(
      'create trigger protect_inventory_document_history before update or delete on public.%I for each row execute function private.protect_inventory_document_history()',
      v_table
    );
  end loop;
end;
$document_triggers$;

-- Re-declare the owner-only transfer poster solely to mark its terminal update
-- as trusted. All stock work remains delegated to the existing Lot-aware RPC.
create or replace function public.apply_inventory_transfer(p_transfer_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.transfers%rowtype;
  v_data jsonb;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id bigint;
  v_qty numeric;
  v_factor numeric;
  v_unit jsonb;
  v_unit_name text;
  v_main_unit text;
  v_unit_matches integer;
  v_from bigint;
  v_to bigint;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner permission required';
  end if;

  select * into v_row
  from public.transfers
  where id = p_transfer_id
  for update;
  if not found then
    raise exception 'transfer not found';
  end if;
  v_data := coalesce(v_row.data, '{}'::jsonb);
  if private.jsonb_flag_is_true(v_data, 'stockApplied') then
    return v_data;
  end if;
  if coalesce(v_data ->> 'fromId', '') !~ '^[0-9]{1,18}$'
     or coalesce(v_data ->> 'toId', '') !~ '^[0-9]{1,18}$' then
    raise exception 'invalid transfer warehouse';
  end if;
  v_from := (v_data ->> 'fromId')::bigint;
  v_to := (v_data ->> 'toId')::bigint;
  if v_from <= 0 or v_to <= 0 or v_from = v_to then
    raise exception 'invalid transfer warehouse';
  end if;

  if jsonb_typeof(v_data -> 'items') is distinct from 'array' then
    raise exception 'invalid transfer items';
  end if;
  if jsonb_array_length(v_data -> 'items') = 0
     or jsonb_array_length(v_data -> 'items') > 500 then
    raise exception 'invalid transfer items';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_data -> 'items') item(value)
    where jsonb_typeof(item.value) <> 'object'
       or coalesce(item.value ->> 'productId', '') !~ '^[0-9]{1,18}$'
       or not private.is_safe_nonnegative_decimal(item.value ->> 'qty')
       or nullif(btrim(coalesce(item.value ->> 'unit', '')), '') is null
       or char_length(btrim(item.value ->> 'unit')) > 100
       or char_length(coalesce(nullif(btrim(item.value ->> 'lineId'), ''), '')) > 128
  ) then
    raise exception 'invalid transfer item';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_data -> 'items') item(value)
    where (item.value ->> 'qty')::numeric <= 0
  ) then
    raise exception 'invalid transfer item';
  end if;

  perform private.acquire_inventory_product_locks(array(
    select distinct (item.value ->> 'productId')::bigint
    from jsonb_array_elements(v_data -> 'items') item(value)
    order by 1
  ));

  -- Serialize every transfer which touches the same product, regardless of
  -- warehouse direction, and acquire multi-product locks in one global order.
  -- This prevents opposite transfers and differently ordered documents from
  -- forming cycles across source/destination Lot and balance rows.
  for v_product_id in
    select distinct (item.value ->> 'productId')::bigint
    from jsonb_array_elements(v_data -> 'items') item(value)
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('transfer-product:' || v_product_id::text, 0)
    );
  end loop;

  for v_item in
    select value
    from jsonb_array_elements(v_data -> 'items') with ordinality item(value, ordinality)
    order by
      (value ->> 'productId')::bigint,
      coalesce(nullif(btrim(value ->> 'lineId'), ''), ordinality::text),
      ordinality
  loop
    v_product_id := (v_item ->> 'productId')::bigint;
    v_unit_name := btrim(v_item ->> 'unit');
    select * into v_product
    from public.products product
    where product.id = v_product_id
    for share;
    if not found
       or lower(coalesce(
            nullif(v_product.data ->> 'type', ''),
            nullif(v_product.product_type, ''),
            'stock'
          )) in ('nostock', 'service') then
      raise exception 'transfer product does not track stock';
    end if;

    v_main_unit := coalesce(
      nullif(btrim(v_product.data ->> 'unit'), ''),
      nullif(btrim(v_product.unit), '')
    );
    if v_unit_name = v_main_unit then
      v_factor := 1;
    else
      select count(*), (jsonb_agg(unit_row.value) -> 0)
      into v_unit_matches, v_unit
      from jsonb_array_elements(
        case when jsonb_typeof(v_product.data -> 'units') = 'array'
          then v_product.data -> 'units' else '[]'::jsonb end
      ) unit_row(value)
      where btrim(coalesce(unit_row.value ->> 'sub', '')) = v_unit_name;
      if v_unit_matches <> 1
         or not private.is_safe_nonnegative_decimal(v_unit ->> 'factor') then
        raise exception 'invalid transfer product unit';
      end if;
      v_factor := (v_unit ->> 'factor')::numeric;
    end if;

    v_qty := (v_item ->> 'qty')::numeric * v_factor;
    if v_factor <= 0 or v_qty <= 0 or v_qty > 1000000000000 then
      raise exception 'invalid transfer item';
    end if;
    perform public.transfer_inventory_stock(v_product_id, v_from, v_to, v_qty);
  end loop;

  v_data := jsonb_set(v_data, '{stockApplied}', 'true'::jsonb, true);
  v_data := jsonb_set(
    v_data, '{stockAppliedAt}', to_jsonb(clock_timestamp()::text), true
  );
  perform set_config('pepos.inventory_posting', 'on', true);
  update public.transfers
  set data = v_data,
      updated_at = clock_timestamp()
  where id = p_transfer_id;
  return v_data;
end;
$$;

-- Six-argument checkout binds an idempotency key to both an optional client
-- SHA-256 and the canonical request JSON. Comparing the JSON as well means a
-- caller cannot reuse a request id with changed amounts while merely repeating
-- or forging the client hash.
create or replace function public.complete_sale(
  p_request_id uuid,
  p_ref_prefix text,
  p_warehouse_id bigint,
  p_sale jsonb,
  p_items jsonb,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.sales%rowtype;
  v_request_context jsonb;
  v_payload_hash text;
  v_request_id uuid := p_request_id;
  v_now timestamptz;
  v_sale_date date;
  v_sale_id text;
  v_sale_ref text;
  v_posting jsonb;
  v_post_items jsonb;
  v_sale_data jsonb := coalesce(p_sale, '{}'::jsonb);
  v_item jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_line_allocations jsonb;
  v_line_key text;
  v_ord bigint;
  v_member text;
  v_product public.products%rowtype;
  v_promotion public.promotions%rowtype;
  v_is_custom boolean;
  v_tracks_stock boolean;
  v_product_id bigint;
  v_promotion_id bigint;
  v_unit_name text;
  v_main_unit text;
  v_unit_matches integer;
  v_unit_data jsonb;
  v_qty numeric;
  v_factor numeric;
  v_base_qty numeric;
  v_price numeric;
  v_cost numeric;
  v_cost_total numeric;
  v_line_total numeric;
  v_line_gross numeric;
  v_expected_price numeric;
  v_expected_cost numeric;
  v_expected_line numeric;
  v_item_gross_total numeric := 0;
  v_item_before_vat numeric := 0;
  v_item_vat numeric := 0;
  v_cost_total_sum numeric := 0;
  v_line_before_vat numeric;
  v_line_vat numeric;
  v_discount numeric;
  v_fee numeric;
  v_total numeric;
  v_cash_received numeric;
  v_cash_change numeric;
  v_ratio numeric;
  v_before_vat numeric;
  v_vat numeric;
  v_business jsonb := '{}'::jsonb;
  v_vat_registered boolean := false;
  v_vat_mode text;
  v_promo_valid boolean;
  v_promo_value numeric;
  v_bundle_qty numeric;
  v_bundle_price numeric;
  v_buy_qty numeric;
  v_get_qty numeric;
  v_source_qty numeric;
  v_free_line_count integer;
  v_cashier text;
begin
  perform private.acquire_store_mutation_gate();
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if v_request_id is null or p_warehouse_id is null then
    raise exception 'checkout request and warehouse are required';
  end if;
  if jsonb_typeof(coalesce(p_sale, 'null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 500
     or pg_column_size(v_sale_data) > 2097152
     or pg_column_size(p_items) > 4194304 then
    raise exception 'invalid or oversized sale payload';
  end if;
  if p_payload_hash is not null
     and lower(btrim(p_payload_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'payload hash must be a SHA-256 hex string';
  end if;

  if not (select private.is_current_owner()) and not exists(
    select 1
    from public.profile_warehouse_access access
    where access.user_id = (select auth.uid())
      and access.warehouse_id = p_warehouse_id
      and access.can_sell
  ) then
    raise exception 'warehouse sale access denied';
  end if;

  -- Bind and check idempotency before consulting mutable catalog data. A retry
  -- of an already-completed request must still return the original sale even
  -- if a price, promotion or product status changed after the first commit.
  v_request_context := jsonb_build_object(
    'warehouseId', p_warehouse_id,
    'refPrefix', coalesce(p_ref_prefix, ''),
    'sale', v_sale_data,
    'items', p_items
  );
  v_payload_hash := coalesce(
    lower(nullif(btrim(coalesce(p_payload_hash, '')), '')),
    'server-md5:' || md5(v_request_context::text)
  );

  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text, 0));
  select * into v_existing
  from public.sales
  where checkout_request_id = v_request_id;
  if found then
    if private.document_warehouse_id(v_existing.data) is distinct from p_warehouse_id
       or (
         v_existing.checkout_request_context is not null
         and v_existing.checkout_request_context is distinct from v_request_context
       )
       or (
         v_existing.checkout_payload_hash is not null
         and v_existing.checkout_payload_hash not like 'server-md5:%'
         and v_existing.checkout_payload_hash <> v_payload_hash
       ) then
      raise exception 'checkout payload mismatch for request id';
    end if;
    return jsonb_build_object(
      'sale', coalesce(v_existing.data, '{}'::jsonb),
      'alreadyCompleted', true,
      'payloadHash', coalesce(v_existing.checkout_payload_hash, v_payload_hash)
    );
  end if;

  -- Reject every unsafe numeric representation before any cast. PostgreSQL
  -- numeric accepts NaN/Infinity, which are never valid quantities or money.
  if exists(
    select 1
    from jsonb_array_elements(p_items) with ordinality item(value, ordinality)
    where jsonb_typeof(item.value) <> 'object'
       or (
         lower(coalesce(item.value ->> 'custom', 'false')) not in
           ('true', 'false', 't', 'f', '1', '0', 'yes', 'no', 'on', 'off')
       )
       or (
         lower(coalesce(item.value ->> 'custom', 'false'))
           not in ('true', 't', '1', 'yes', 'on')
         and coalesce(item.value ->> 'productId', '') !~ '^[0-9]{1,18}$'
       )
       or (
         lower(coalesce(item.value ->> 'custom', 'false'))
           in ('true', 't', '1', 'yes', 'on')
         and nullif(item.value ->> 'productId', '') is not null
       )
       or not private.is_safe_nonnegative_decimal(item.value ->> 'qty')
       or not private.is_safe_nonnegative_decimal(item.value ->> 'price')
       or not private.is_safe_nonnegative_decimal(item.value ->> 'lineTotal')
       or not private.is_safe_nonnegative_decimal(item.value ->> 'lineTotalGross')
       or nullif(btrim(coalesce(item.value ->> 'unit', '')), '') is null
       or char_length(btrim(item.value ->> 'unit')) > 100
       or char_length(
            coalesce(nullif(btrim(item.value ->> 'lineKey'), ''), ordinality::text)
          ) > 128
       or (
         nullif(item.value ->> 'warehouseId', '') is not null
         and item.value ->> 'warehouseId' <> p_warehouse_id::text
       )
  ) then
    raise exception 'invalid sale item';
  end if;

  if exists(
    select 1
    from (
      select
        coalesce(nullif(btrim(value ->> 'lineKey'), ''), ordinality::text) as line_key,
        count(*) as line_count
      from jsonb_array_elements(p_items) with ordinality
      group by 1
    ) duplicate_line
    where duplicate_line.line_count > 1
  ) then
    raise exception 'sale line keys must be unique';
  end if;

  perform private.acquire_inventory_product_locks(array(
    select distinct (item.value ->> 'productId')::bigint
    from jsonb_array_elements(p_items) item(value)
    where lower(coalesce(item.value ->> 'custom', 'false'))
      not in ('true', 't', '1', 'yes', 'on')
    order by 1
  ));

  if not private.is_safe_nonnegative_decimal(v_sale_data ->> 'total')
     or not private.is_safe_nonnegative_decimal(v_sale_data ->> 'discount')
     or not private.is_safe_nonnegative_decimal(v_sale_data ->> 'vat')
     or not private.is_safe_nonnegative_decimal(v_sale_data ->> 'fee')
     or not private.is_safe_nonnegative_decimal(v_sale_data ->> 'costTotal')
     or not private.is_safe_nonnegative_decimal(v_sale_data ->> 'cashReceived')
     or not private.is_safe_nonnegative_decimal(v_sale_data ->> 'cashChange') then
    raise exception 'invalid sale amounts';
  end if;

  v_discount := (v_sale_data ->> 'discount')::numeric;
  v_fee := (v_sale_data ->> 'fee')::numeric;
  v_cash_received := (v_sale_data ->> 'cashReceived')::numeric;
  v_cash_change := (v_sale_data ->> 'cashChange')::numeric;

  select coalesce(setting.value, '{}'::jsonb)
  into v_business
  from public.settings setting
  where setting.key = 'business';
  v_business := coalesce(v_business, '{}'::jsonb);
  v_vat_registered :=
    coalesce(v_business ->> 'vat', '') = 'จดภาษีมูลค่าเพิ่มแล้ว'
    and (
      nullif(v_business ->> 'vatRegistrationDate', '') is null
      or (
        v_business ->> 'vatRegistrationDate' ~ '^\d{4}-\d{2}-\d{2}$'
        and v_business ->> 'vatRegistrationDate'
          <= (clock_timestamp() at time zone 'Asia/Bangkok')::date::text
      )
    );
  select nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), '')
  into v_cashier
  from public.profiles profile
  where profile.id = (select auth.uid());

  for v_item, v_ord in
    select value, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_line_key := coalesce(
      nullif(btrim(v_item ->> 'lineKey'), ''), v_ord::text
    );
    v_is_custom := lower(coalesce(v_item ->> 'custom', 'false'))
      in ('true', 't', '1', 'yes', 'on');
    v_qty := (v_item ->> 'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'sale quantity must be greater than zero';
    end if;
    v_unit_name := btrim(v_item ->> 'unit');
    v_promotion_id := null;
    v_promotion := null;
    v_promo_valid := false;
    v_tracks_stock := false;

    if v_is_custom then
      if nullif(btrim(coalesce(v_item ->> 'name', '')), '') is null
         or char_length(btrim(v_item ->> 'name')) > 500
         or nullif(v_item ->> 'promoId', '') is not null then
        raise exception 'invalid custom sale item %', v_ord;
      end if;
      v_product_id := null;
      v_factor := 1;
      v_base_qty := v_qty;
      v_price := (v_item ->> 'price')::numeric;
      v_cost := v_price;
      v_expected_line := v_price * v_qty;
      v_vat_mode := case when v_vat_registered then 'incl' else 'none' end;
      v_item := jsonb_set(
        v_item, '{name}', to_jsonb(btrim(v_item ->> 'name')), true
      );
      v_item := v_item - 'productId' - 'promoId' - 'promoName';
    else
      v_product_id := (v_item ->> 'productId')::bigint;
      select * into v_product
      from public.products product
      where product.id = v_product_id
      for share;
      if not found
         or lower(coalesce(v_product.data ->> 'active', 'true'))
              in ('false', '0', 'no', 'off') then
        raise exception 'sale contains an unavailable product';
      end if;
      v_tracks_stock := lower(coalesce(
        nullif(v_product.data ->> 'type', ''),
        nullif(v_product.product_type, ''),
        'stock'
      )) not in ('nostock', 'service');

      v_main_unit := coalesce(
        nullif(btrim(v_product.data ->> 'unit'), ''),
        nullif(btrim(v_product.unit), '')
      );
      v_expected_price := case
        when private.is_safe_nonnegative_decimal(v_product.data ->> 'price')
          then (v_product.data ->> 'price')::numeric
        when private.is_safe_nonnegative_decimal(v_product.price::text)
          then v_product.price
        else 0 end;
      v_expected_cost := case
        when private.is_safe_nonnegative_decimal(v_product.data ->> 'cost')
          then (v_product.data ->> 'cost')::numeric
        when private.is_safe_nonnegative_decimal(v_product.cost::text)
          then v_product.cost
        else 0 end;

      if v_unit_name = v_main_unit then
        v_factor := 1;
      else
        select
          count(*),
          (jsonb_agg(unit_value) -> 0)
        into v_unit_matches, v_unit_data
        from jsonb_array_elements(
          case when jsonb_typeof(v_product.data -> 'units') = 'array'
            then v_product.data -> 'units' else '[]'::jsonb end
        ) unit_value
        where btrim(coalesce(unit_value ->> 'sub', '')) = v_unit_name;
        if v_unit_matches <> 1
           or not private.is_safe_nonnegative_decimal(v_unit_data ->> 'factor') then
          raise exception 'invalid product unit at sale item %', v_ord;
        end if;
        v_factor := (v_unit_data ->> 'factor')::numeric;
        if v_factor <= 0 then
          raise exception 'invalid product unit factor at sale item %', v_ord;
        end if;
        v_expected_price := case
          when private.is_safe_nonnegative_decimal(v_unit_data ->> 'price')
            then case when (v_unit_data ->> 'price')::numeric > 0
              then (v_unit_data ->> 'price')::numeric
              else v_expected_price * v_factor end
          else v_expected_price * v_factor end;
        v_expected_cost := case
          when nullif(v_unit_data ->> 'cost', '') is not null
               and private.is_safe_nonnegative_decimal(v_unit_data ->> 'cost')
            then (v_unit_data ->> 'cost')::numeric
          else v_expected_cost * v_factor end;
      end if;

      v_base_qty := v_qty * v_factor;
      v_price := (v_item ->> 'price')::numeric;
      v_cost := v_expected_cost;
      if v_base_qty <= 0 or v_base_qty > 1000000000000
         or v_expected_price > 1000000000000
         or v_expected_cost > 1000000000000 then
        raise exception 'sale item exceeds safe limits';
      end if;

      if nullif(v_item ->> 'promoId', '') is not null then
        if coalesce(v_item ->> 'promoId', '') !~ '^[0-9]{1,18}$' then
          raise exception 'invalid sale promotion';
        end if;
        v_promotion_id := (v_item ->> 'promoId')::bigint;
        select * into v_promotion
        from public.promotions promotion
        where promotion.id = v_promotion_id
        for share;
        if not found
           or lower(coalesce(v_promotion.data ->> 'active', 'false'))
                not in ('true', 't', '1', 'yes', 'on')
           or (
             nullif(v_promotion.data ->> 'startDate', '') is not null
             and (
               v_promotion.data ->> 'startDate' !~ '^\d{4}-\d{2}-\d{2}$'
               or v_promotion.data ->> 'startDate'
                 > (clock_timestamp() at time zone 'Asia/Bangkok')::date::text
             )
           )
           or (
             nullif(v_promotion.data ->> 'endDate', '') is not null
             and (
               v_promotion.data ->> 'endDate' !~ '^\d{4}-\d{2}-\d{2}$'
               or v_promotion.data ->> 'endDate'
                 < (clock_timestamp() at time zone 'Asia/Bangkok')::date::text
             )
           ) then
          raise exception 'sale promotion is unavailable';
        end if;
      end if;

      if v_price = 0 and v_expected_price > 0 then
        if v_promotion_id is null
           or coalesce(v_promotion.data ->> 'scope', '') <> 'buygetdiff'
           or coalesce(v_promotion.data ->> 'bgdGetProductId', '')
                <> v_product_id::text
           or coalesce(v_promotion.data ->> 'bgdGetUnit', '') <> v_unit_name
           or coalesce(v_promotion.data ->> 'bgdBuyProductId', '')
                !~ '^[0-9]{1,18}$'
           or not private.is_safe_nonnegative_decimal(
                v_promotion.data ->> 'bgdBuyQty'
              )
           or not private.is_safe_nonnegative_decimal(
                v_promotion.data ->> 'bgdGetQty'
              ) then
          raise exception 'invalid free promotion line';
        end if;
        v_buy_qty := (v_promotion.data ->> 'bgdBuyQty')::numeric;
        v_get_qty := (v_promotion.data ->> 'bgdGetQty')::numeric;
        if v_buy_qty <= 0 or v_get_qty <= 0 then
          raise exception 'invalid free promotion quantities';
        end if;
        select coalesce(sum((source_item ->> 'qty')::numeric), 0)
        into v_source_qty
        from jsonb_array_elements(p_items) source_item
        where lower(coalesce(source_item ->> 'custom', 'false'))
                not in ('true', 't', '1', 'yes', 'on')
          and source_item ->> 'productId'
                = v_promotion.data ->> 'bgdBuyProductId'
          and source_item ->> 'unit' = v_promotion.data ->> 'bgdBuyUnit'
          and not (
            nullif(source_item ->> 'promoId', '') is not null
            and private.is_safe_nonnegative_decimal(source_item ->> 'price')
            and (source_item ->> 'price')::numeric = 0
          );
        select count(*) into v_free_line_count
        from jsonb_array_elements(p_items) free_item
        where free_item ->> 'promoId' = v_promotion_id::text
          and free_item ->> 'productId' = v_product_id::text
          and free_item ->> 'unit' = v_unit_name
          and case
            when private.is_safe_nonnegative_decimal(free_item ->> 'price')
              then (free_item ->> 'price')::numeric
            else null
          end = 0;
        if v_free_line_count <> 1
           or v_qty <> floor(v_source_qty / v_buy_qty) * v_get_qty
           or v_qty <= 0 then
          raise exception 'free promotion quantity does not match purchase';
        end if;
        v_expected_line := 0;
        v_promo_valid := true;
      else
        if abs(v_price - v_expected_price) > 0.005 then
          raise exception 'product price changed; refresh the cart';
        end if;
        v_price := v_expected_price;
        v_expected_line := v_expected_price * v_qty;
        if v_promotion_id is not null then
          v_promo_valid :=
            (
              coalesce(v_promotion.data ->> 'scope', '') = 'product'
              and v_promotion.data ->> 'productId' = v_product_id::text
              and v_promotion.data ->> 'unit' = v_unit_name
            )
            or (
              coalesce(v_promotion.data ->> 'scope', '') = 'category'
              and (
                nullif(v_promotion.data ->> 'category', '') is null
                or v_promotion.data ->> 'category'
                  = coalesce(v_product.data ->> 'category', v_product.category, '')
              )
              and (
                nullif(v_promotion.data ->> 'brand', '') is null
                or v_promotion.data ->> 'brand'
                  = coalesce(v_product.data ->> 'brand', v_product.brand, '')
              )
              and (
                (
                  coalesce(v_promotion.data ->> 'categoryMode', 'all') = 'select'
                  and exists(
                    select 1
                    from jsonb_array_elements(
                      case when jsonb_typeof(v_promotion.data -> 'items') = 'array'
                        then v_promotion.data -> 'items' else '[]'::jsonb end
                    ) promo_item
                    where promo_item ->> 'productId' = v_product_id::text
                      and promo_item ->> 'unit' = v_unit_name
                  )
                )
                or (
                  coalesce(v_promotion.data ->> 'categoryMode', 'all') <> 'select'
                  and v_promotion.data ->> 'unit' = v_unit_name
                )
              )
            );
          if not v_promo_valid then
            raise exception 'promotion does not match sale item';
          end if;
          if coalesce(v_promotion.data ->> 'type', '') = 'discount'
             and private.is_safe_nonnegative_decimal(
               v_promotion.data ->> 'discountValue'
             ) then
            v_promo_value := (v_promotion.data ->> 'discountValue')::numeric;
            if coalesce(v_promotion.data ->> 'discountMode', 'percent') = 'percent' then
              if v_promo_value > 100 then
                raise exception 'invalid promotion percent';
              end if;
              v_expected_line := greatest(
                0, v_expected_price * (1 - v_promo_value / 100)
              ) * v_qty;
            else
              v_expected_line := greatest(0, v_expected_price - v_promo_value)
                * v_qty;
            end if;
          elsif coalesce(v_promotion.data ->> 'type', '') = 'bundle'
             and private.is_safe_nonnegative_decimal(
               v_promotion.data ->> 'bundleQty'
             )
             and private.is_safe_nonnegative_decimal(
               v_promotion.data ->> 'bundlePrice'
             ) then
            v_bundle_qty := (v_promotion.data ->> 'bundleQty')::numeric;
            v_bundle_price := (v_promotion.data ->> 'bundlePrice')::numeric;
            if v_bundle_qty <= 0 then
              raise exception 'invalid bundle promotion';
            end if;
            if floor(v_qty / v_bundle_qty) > 0 then
              v_expected_line := floor(v_qty / v_bundle_qty) * v_bundle_price
                + (v_qty - floor(v_qty / v_bundle_qty) * v_bundle_qty)
                  * v_expected_price;
            else
              v_promotion_id := null;
              v_promotion := null;
              v_promo_valid := false;
            end if;
          else
            raise exception 'unsupported promotion for sale item';
          end if;
        end if;
      end if;

      v_vat_mode := case
        when not v_vat_registered then 'none'
        when lower(coalesce(v_product.data ->> 'vat', 'incl'))
          in ('incl', 'excl', 'none')
          then lower(v_product.data ->> 'vat')
        else 'incl' end;
      v_item := jsonb_set(v_item, '{name}', to_jsonb(v_product.name), true);
      if v_promotion_id is null then
        v_item := v_item - 'promoId' - 'promoName';
      else
        v_item := jsonb_set(
          v_item, '{promoId}', to_jsonb(v_promotion_id), true
        );
        v_item := jsonb_set(
          v_item,
          '{promoName}',
          to_jsonb(coalesce(v_promotion.data ->> 'name', '')),
          true
        );
      end if;
    end if;

    v_cost_total := v_cost * v_qty;
    if v_expected_line < 0 or v_expected_line > 1000000000000
       or v_cost_total < 0 or v_cost_total > 1000000000000 then
      raise exception 'sale line exceeds safe money limits';
    end if;
    if abs((v_item ->> 'lineTotal')::numeric - v_expected_line) > 0.01 then
      raise exception 'sale line total mismatch';
    end if;
    v_line_total := round(v_expected_line, 6);
    v_line_gross := case
      when v_vat_registered and v_vat_mode = 'excl'
        then v_line_total * 1.07
      else v_line_total end;
    if abs((v_item ->> 'lineTotalGross')::numeric - v_line_gross) > 0.01 then
      raise exception 'sale line tax total mismatch';
    end if;
    v_line_before_vat := case
      when v_vat_registered and v_vat_mode = 'incl'
        then v_line_gross / 1.07
      else v_line_total end;
    v_line_vat := case
      when v_vat_registered and v_vat_mode <> 'none'
        then v_line_gross - v_line_before_vat
      else 0 end;

    v_item_gross_total := v_item_gross_total + v_line_gross;
    v_item_before_vat := v_item_before_vat + v_line_before_vat;
    v_item_vat := v_item_vat + v_line_vat;
    v_cost_total_sum := v_cost_total_sum + v_cost_total;
    if v_item_gross_total > 1000000000000
       or v_cost_total_sum > 1000000000000 then
      raise exception 'sale totals exceed safe limits';
    end if;

    v_item := jsonb_set(v_item, '{lineKey}', to_jsonb(v_line_key), true);
    v_item := jsonb_set(v_item, '{warehouseId}', to_jsonb(p_warehouse_id), true);
    v_item := jsonb_set(
      v_item,
      '{productId}',
      coalesce(to_jsonb(v_product_id), 'null'::jsonb),
      true
    );
    v_item := jsonb_set(v_item, '{factor}', to_jsonb(v_factor), true);
    v_item := jsonb_set(v_item, '{baseQty}', to_jsonb(v_base_qty), true);
    v_item := jsonb_set(v_item, '{price}', to_jsonb(v_price), true);
    v_item := jsonb_set(v_item, '{cost}', to_jsonb(v_cost), true);
    v_item := jsonb_set(v_item, '{costTotal}', to_jsonb(v_cost_total), true);
    v_item := jsonb_set(v_item, '{lineTotal}', to_jsonb(v_line_total), true);
    v_item := jsonb_set(v_item, '{lineTotalGross}', to_jsonb(v_line_gross), true);
    v_item := jsonb_set(v_item, '{vatMode}', to_jsonb(v_vat_mode), true);
    v_item := jsonb_set(v_item, '{custom}', to_jsonb(v_is_custom), true);
    v_item := jsonb_set(
      v_item, '{_tracksStock}', to_jsonb(v_tracks_stock), true
    );
    v_normalized_items := v_normalized_items || jsonb_build_array(v_item);
  end loop;

  if v_discount > v_item_gross_total then
    raise exception 'sale discount exceeds item total';
  end if;
  v_ratio := case when v_item_gross_total > 0
    then (v_item_gross_total - v_discount) / v_item_gross_total else 0 end;
  v_before_vat := v_item_before_vat * v_ratio
    + case when v_vat_registered then v_fee / 1.07 else v_fee end;
  v_vat := v_item_vat * v_ratio
    + case when v_vat_registered then v_fee - (v_fee / 1.07) else 0 end;
  v_total := round(v_item_gross_total - v_discount + v_fee, 2);
  v_before_vat := round(v_before_vat, 2);
  v_vat := round(v_vat, 2);
  v_cost_total_sum := round(v_cost_total_sum, 6);

  if abs((v_sale_data ->> 'total')::numeric - v_total) > 0.01
     or abs((v_sale_data ->> 'vat')::numeric - v_vat) > 0.02
     or abs((v_sale_data ->> 'costTotal')::numeric - v_cost_total_sum) > 0.02 then
    raise exception 'sale header totals changed; refresh the cart';
  end if;
  if coalesce(v_sale_data ->> 'payMethod', '') not in (
    'เงินสด', 'โอนธนาคาร', 'บัตรเครดิต', 'ออนไลน์'
  ) then
    raise exception 'invalid payment method';
  end if;
  if v_sale_data ->> 'payMethod' = 'เงินสด' then
    if v_cash_received < v_total
       or abs(v_cash_change - (v_cash_received - v_total)) > 0.01 then
      raise exception 'cash received or change is invalid';
    end if;
  elsif v_cash_received <> 0 or v_cash_change <> 0 then
    raise exception 'non-cash sale cannot contain cash received or change';
  end if;

  v_sale_data := jsonb_set(v_sale_data, '{items}', v_normalized_items, true);
  v_sale_data := jsonb_set(v_sale_data, '{discount}', to_jsonb(round(v_discount, 2)), true);
  v_sale_data := jsonb_set(v_sale_data, '{fee}', to_jsonb(round(v_fee, 2)), true);
  v_sale_data := jsonb_set(v_sale_data, '{costTotal}', to_jsonb(v_cost_total_sum), true);
  v_sale_data := jsonb_set(v_sale_data, '{total}', to_jsonb(v_total), true);
  v_sale_data := jsonb_set(v_sale_data, '{vat}', to_jsonb(v_vat), true);
  v_sale_data := jsonb_set(v_sale_data, '{vatRegistered}', to_jsonb(v_vat_registered), true);
  v_sale_data := jsonb_set(
    v_sale_data, '{grossProfit}', to_jsonb(round(v_before_vat - v_cost_total_sum, 2)), true
  );
  v_sale_data := jsonb_set(
    v_sale_data,
    '{taxSummary}',
    jsonb_build_object(
      'registered', v_vat_registered,
      'subtotal', round(v_item_gross_total + v_fee, 2),
      'discount', round(v_discount, 2),
      'beforeVat', v_before_vat,
      'vat', v_vat,
      'total', v_total
    ),
    true
  );
  if v_business <> '{}'::jsonb then
    v_sale_data := jsonb_set(v_sale_data, '{businessSnapshot}', v_business, true);
  end if;
  if v_cashier is not null then
    v_sale_data := jsonb_set(v_sale_data, '{cashier}', to_jsonb(v_cashier), true);
  end if;

  v_sale_id := 'INV-' || replace(v_request_id::text, '-', '');
  select jsonb_agg(value order by
    case when coalesce(value ->> 'productId', '') ~ '^[0-9]+$'
      then (value ->> 'productId')::bigint else 9223372036854775807 end,
    coalesce(nullif(value ->> 'lineKey', ''), ordinality::text),
    ordinality)
  into v_post_items
  from jsonb_array_elements(v_normalized_items) with ordinality
  where lower(coalesce(value ->> '_tracksStock', 'false'))
    in ('true', 't', '1', 'yes', 'on');

  v_posting := public.post_sale_inventory_lots(
    v_sale_id, p_warehouse_id, v_post_items
  );

  for v_item, v_ord in
    select value, ordinality
    from jsonb_array_elements(v_normalized_items) with ordinality
  loop
    v_line_key := coalesce(nullif(v_item ->> 'lineKey', ''), v_ord::text);
    select coalesce(jsonb_agg(allocation order by allocation_order), '[]'::jsonb)
    into v_line_allocations
    from (
      select value as allocation, ordinality as allocation_order
      from jsonb_array_elements(
        coalesce(v_posting -> 'allocations', '[]'::jsonb)
      ) with ordinality
      where value ->> 'lineKey' = v_line_key
    ) matched;
    if lower(coalesce(v_item ->> 'custom', 'false'))
         not in ('true', 't', '1', 'yes', 'on') then
      v_item := jsonb_set(
        v_item, '{lotAllocations}', v_line_allocations, true
      );
    end if;
    v_item := jsonb_set(
      v_item - '_tracksStock',
      '{tracksStock}',
      coalesce(v_item -> '_tracksStock', 'false'::jsonb),
      true
    );
    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  v_now := clock_timestamp();
  v_sale_date := (v_now at time zone 'Asia/Bangkok')::date;
  v_sale_ref := private.next_sale_reference(v_sale_date, p_ref_prefix);

  v_sale_data := jsonb_set(v_sale_data, '{id}', to_jsonb(v_sale_id), true);
  v_sale_data := jsonb_set(v_sale_data, '{ref}', to_jsonb(v_sale_ref), true);
  v_sale_data := jsonb_set(
    v_sale_data, '{date}', to_jsonb(v_sale_date::text), true
  );
  v_sale_data := jsonb_set(
    v_sale_data,
    '{time}',
    to_jsonb(to_char(v_now at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS')),
    true
  );
  v_sale_data := jsonb_set(
    v_sale_data, '{warehouseId}', to_jsonb(p_warehouse_id), true
  );
  v_sale_data := jsonb_set(
    v_sale_data, '{status}', to_jsonb('done'::text), true
  );
  v_sale_data := jsonb_set(v_sale_data, '{items}', v_items, true);
  v_sale_data := jsonb_set(
    v_sale_data,
    '{checkoutRequestId}',
    to_jsonb(v_request_id::text),
    true
  );

  v_member := case
    when jsonb_typeof(v_sale_data -> 'member') = 'object'
      then nullif(v_sale_data -> 'member' ->> 'name', '')
    else nullif(v_sale_data ->> 'member', '')
  end;

  insert into public.sales(
    id, ref, sale_date, sale_time, cashier, member, status, pay_method,
    discount, vat, fee, cost_total, gross_profit, cash_received, cash_change,
    total, data, checkout_request_id, checkout_payload_hash,
    checkout_request_context, created_by
  ) values (
    v_sale_id,
    v_sale_ref,
    v_sale_date,
    v_now,
    nullif(v_sale_data ->> 'cashier', ''),
    v_member,
    'done',
    nullif(v_sale_data ->> 'payMethod', ''),
    coalesce(nullif(v_sale_data ->> 'discount', '')::numeric, 0),
    coalesce(nullif(v_sale_data ->> 'vat', '')::numeric, 0),
    coalesce(nullif(v_sale_data ->> 'fee', '')::numeric, 0),
    coalesce(nullif(v_sale_data ->> 'costTotal', '')::numeric, 0),
    coalesce(nullif(v_sale_data ->> 'grossProfit', '')::numeric, 0),
    coalesce(nullif(v_sale_data ->> 'cashReceived', '')::numeric, 0),
    coalesce(nullif(v_sale_data ->> 'cashChange', '')::numeric, 0),
    coalesce(nullif(v_sale_data ->> 'total', '')::numeric, 0),
    v_sale_data,
    v_request_id,
    v_payload_hash,
    v_request_context,
    (select auth.uid())
  );

  insert into public.sale_items(
    sale_id, product_id, warehouse_id, name, qty, price, cost, cost_total,
    unit, factor, custom
  )
  select
    v_sale_id,
    case when lower(coalesce(item.value ->> 'custom', 'false'))
                    in ('true', 't', '1', 'yes', 'on')
      then null else nullif(item.value ->> 'productId', '')::bigint end,
    p_warehouse_id,
    nullif(item.value ->> 'name', ''),
    coalesce(nullif(item.value ->> 'qty', '')::numeric, 0),
    coalesce(nullif(item.value ->> 'price', '')::numeric, 0),
    coalesce(nullif(item.value ->> 'cost', '')::numeric, 0),
    coalesce(
      nullif(item.value ->> 'costTotal', '')::numeric,
      coalesce(nullif(item.value ->> 'qty', '')::numeric, 0)
        * coalesce(nullif(item.value ->> 'cost', '')::numeric, 0)
    ),
    nullif(item.value ->> 'unit', ''),
    coalesce(nullif(item.value ->> 'factor', '')::numeric, 1),
    lower(coalesce(item.value ->> 'custom', 'false'))
      in ('true', 't', '1', 'yes', 'on')
  from jsonb_array_elements(v_items) with ordinality item(value, ordinality);

  return jsonb_build_object(
    'sale', v_sale_data,
    'allocations', coalesce(v_posting -> 'allocations', '[]'::jsonb),
    'alreadyCompleted', false,
    'payloadHash', v_payload_hash
  );
end;
$$;

-- Replace a complete browser backup in one database transaction. The function
-- accepts either the outer backup envelope or its `data` object. Any cast,
-- uniqueness or foreign-key failure aborts the function and PostgreSQL restores
-- every pre-existing row; partial restore is therefore impossible.
create or replace function public.restore_store_backup_atomic(p_backup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb;
  v_inventory jsonb;
  v_access jsonb;
  v_pair record;
  v_epoch text := gen_random_uuid()::text;
  v_now timestamptz := clock_timestamp();
  v_sequence text;
  v_table text;
  v_counts jsonb;
  v_inventory_references_invalid boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner access required';
  end if;
  if jsonb_typeof(coalesce(p_backup, 'null'::jsonb)) <> 'object'
     or pg_column_size(p_backup) > 104857600 then
    raise exception 'invalid or oversized store backup';
  end if;

  v_data := case
    when jsonb_typeof(p_backup -> 'data') = 'object' then p_backup -> 'data'
    else p_backup
  end;
  v_inventory := v_data -> 'inventoryBackup';

  if exists(
    select 1
    from unnest(array[
      'warehouses', 'products', 'contacts', 'salesRepresentatives',
      'salesHistory', 'quotations', 'invoicesAR', 'creditNotes',
      'purchaseOrders', 'goodsReceipts', 'purchaseOrdersFull',
      'productReturns', 'transfers', 'standaloneTaxInvoices', 'favorites'
    ]) required_key
    where jsonb_typeof(v_data -> required_key) is distinct from 'array'
  )
  or jsonb_typeof(v_inventory) is distinct from 'object'
  or jsonb_typeof(v_inventory -> 'lots') is distinct from 'array'
  or jsonb_typeof(v_inventory -> 'movements') is distinct from 'array'
  or (
    v_data ? 'promotions'
    and jsonb_typeof(v_data -> 'promotions') is distinct from 'array'
  ) then
    raise exception 'store backup is incomplete';
  end if;

  if jsonb_array_length(v_data -> 'warehouses') > 1000
     or jsonb_array_length(v_data -> 'products') > 100000
     or jsonb_array_length(v_data -> 'contacts') > 100000
     or jsonb_array_length(coalesce(v_data -> 'promotions', '[]'::jsonb)) > 100000
     or jsonb_array_length(v_data -> 'salesHistory') > 1000000
     or jsonb_array_length(v_inventory -> 'lots') > 2000000
     or jsonb_array_length(v_inventory -> 'movements') > 5000000 then
    raise exception 'store backup exceeds safe row limits';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(v_data -> 'warehouses') item
    where coalesce(item ->> 'id', '') !~ '^[0-9]+$'
      or nullif(btrim(coalesce(item ->> 'name', '')), '') is null
  )
  or exists(
    select 1
    from jsonb_array_elements(v_data -> 'products') item
    where coalesce(item ->> 'id', '') !~ '^[0-9]+$'
      or nullif(btrim(coalesce(item ->> 'name', '')), '') is null
  )
  or exists(
    select 1
    from jsonb_array_elements(v_data -> 'salesHistory') item
    where nullif(btrim(coalesce(item ->> 'id', '')), '') is null
  )
  or exists(
    select 1
    from jsonb_array_elements(
      coalesce(v_data -> 'promotions', '[]'::jsonb)
    ) item
    where coalesce(item ->> 'id', '') !~ '^[0-9]+$'
  ) then
    raise exception 'backup contains an invalid required id or name';
  end if;

  if exists(
    select item ->> 'id'
    from jsonb_array_elements(v_data -> 'warehouses') item
    group by item ->> 'id' having count(*) > 1
  )
  or exists(
    select item ->> 'id'
    from jsonb_array_elements(v_data -> 'products') item
    group by item ->> 'id' having count(*) > 1
  )
  or exists(
    select item ->> 'id'
    from jsonb_array_elements(v_data -> 'salesHistory') item
    group by item ->> 'id' having count(*) > 1
  )
  or exists(
    select item ->> 'id'
    from jsonb_array_elements(
      coalesce(v_data -> 'promotions', '[]'::jsonb)
    ) item
    group by item ->> 'id' having count(*) > 1
  )
  or exists(
    select item ->> 'id'
    from jsonb_array_elements(v_inventory -> 'lots') item
    group by item ->> 'id' having count(*) > 1
  )
  or exists(
    select item ->> 'id'
    from jsonb_array_elements(v_inventory -> 'movements') item
    group by item ->> 'id' having count(*) > 1
  ) then
    raise exception 'backup contains duplicate ids';
  end if;

  -- Materialize each JSON array once and validate with equality joins. The
  -- previous correlated scans became quadratic as Lot/movement history grew.
  with
  backup_products as materialized (
    select item ->> 'id' as id
    from jsonb_array_elements(v_data -> 'products') item
  ),
  backup_warehouses as materialized (
    select item ->> 'id' as id
    from jsonb_array_elements(v_data -> 'warehouses') item
  ),
  backup_lots as materialized (
    select
      item ->> 'id' as id,
      item ->> 'product_id' as product_id,
      item ->> 'warehouse_id' as warehouse_id
    from jsonb_array_elements(v_inventory -> 'lots') item
  ),
  backup_movements as materialized (
    select
      item ->> 'id' as id,
      item ->> 'lot_id' as lot_id,
      item ->> 'product_id' as product_id,
      item ->> 'warehouse_id' as warehouse_id
    from jsonb_array_elements(v_inventory -> 'movements') item
  )
  select
    exists(
      select 1
      from backup_lots lot
      left join backup_products product on product.id = lot.product_id
      left join backup_warehouses warehouse on warehouse.id = lot.warehouse_id
      where coalesce(lot.id, '') !~ '^[0-9]+$'
         or coalesce(lot.product_id, '') !~ '^[0-9]+$'
         or coalesce(lot.warehouse_id, '') !~ '^[0-9]+$'
         or product.id is null
         or warehouse.id is null
    )
    or exists(
      select 1
      from backup_movements movement
      left join backup_lots lot
        on lot.id = movement.lot_id
       and lot.product_id = movement.product_id
       and lot.warehouse_id = movement.warehouse_id
      where coalesce(movement.id, '') !~ '^[0-9]+$'
         or coalesce(movement.lot_id, '') !~ '^[0-9]+$'
         or coalesce(movement.product_id, '') !~ '^[0-9]+$'
         or coalesce(movement.warehouse_id, '') !~ '^[0-9]+$'
         or lot.id is null
    )
  into v_inventory_references_invalid;

  if v_inventory_references_invalid then
    raise exception 'backup inventory references are invalid';
  end if;

  -- Pure JSON validation happens before the exclusive gate so a large or
  -- malformed backup cannot unnecessarily pause checkout and stock posting.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pepos-atomic-store-restore', 0)
  );
  -- A factory reset may have removed the owner profile while validation or the
  -- gate wait was in progress. Re-authorize immediately before replacement.
  if not (select private.is_current_owner()) then
    raise exception 'owner access required';
  end if;

  -- Atomicity also has to cover concurrent POS sessions. Take one deterministic
  -- table lock set so a checkout or stock post cannot commit halfway through
  -- the replacement and leave rows outside the backup snapshot.
  lock table
    public.goods_receipts,
    public.product_returns,
    public.product_exchanges,
    public.transfers,
    public.quotations,
    public.invoices_ar,
    public.credit_notes,
    public.purchase_orders,
    public.purchase_orders_full,
    public.standalone_tax_invoices,
    public.profile_warehouse_access,
    public.sales,
    public.settings,
    public.warehouses,
    public.products,
    public.promotions,
    public.inventory_lot_movements,
    public.inventory_lots,
    public.inventory_balances,
    public.inventory_count_adjustment_lines,
    public.inventory_count_adjustments,
    public.product_unit_changes,
    public.inspection_lists,
    public.sale_items,
    public.cash_shifts,
    public.favorites,
    public.contacts,
    public.sales_representatives,
    private.sale_document_sequences,
    private.cash_shift_sequences
  in access exclusive mode;
  select coalesce(jsonb_agg(to_jsonb(access)), '[]'::jsonb)
  into v_access
  from public.profile_warehouse_access access;
  perform set_config('pepos.maintenance_reset', 'on', true);

  -- Children and immutable history first. No commit occurs until this function
  -- returns successfully.
  delete from public.sale_items;
  delete from public.inventory_count_adjustment_lines;
  delete from public.inventory_count_adjustments;
  delete from public.inventory_lot_movements;
  delete from public.inventory_lots;
  delete from public.inventory_balances;
  delete from public.product_unit_changes;
  delete from public.inspection_lists;
  delete from public.sales;
  delete from public.cash_shifts;
  delete from private.sale_document_sequences;
  delete from private.cash_shift_sequences;
  delete from public.quotations;
  delete from public.invoices_ar;
  delete from public.credit_notes;
  delete from public.purchase_orders;
  delete from public.goods_receipts;
  delete from public.purchase_orders_full;
  delete from public.product_returns;
  delete from public.product_exchanges;
  delete from public.transfers;
  delete from public.standalone_tax_invoices;
  delete from public.favorites;
  -- Backups created before promotions were included have no `promotions` key.
  -- Missing means "not captured", not "replace with an empty catalog".
  if v_data ? 'promotions' then
    delete from public.promotions;
  end if;
  delete from public.products;
  delete from public.contacts;
  delete from public.sales_representatives;
  delete from public.profile_warehouse_access;
  delete from public.warehouses;

  insert into public.warehouses(id, name, data, created_at, updated_at)
  overriding system value
  select
    (item ->> 'id')::bigint,
    btrim(item ->> 'name'),
    item,
    v_now,
    v_now
  from jsonb_array_elements(v_data -> 'warehouses') item;

  insert into public.profile_warehouse_access(
    user_id, warehouse_id, can_sell, can_manage_stock,
    can_receive_goods, created_at
  )
  select
    (item ->> 'user_id')::uuid,
    (item ->> 'warehouse_id')::bigint,
    coalesce((item ->> 'can_sell')::boolean, true),
    coalesce((item ->> 'can_manage_stock')::boolean, false),
    coalesce((item ->> 'can_receive_goods')::boolean, false),
    coalesce((item ->> 'created_at')::timestamptz, v_now)
  from jsonb_array_elements(v_access) item
  where exists(
    select 1 from auth.users auth_user
    where auth_user.id = (item ->> 'user_id')::uuid
  )
    and exists(
      select 1 from public.warehouses warehouse
      where warehouse.id = (item ->> 'warehouse_id')::bigint
    );

  insert into public.profile_warehouse_access(
    user_id, warehouse_id, can_sell, can_manage_stock,
    can_receive_goods, created_at
  )
  select (select auth.uid()), warehouse.id, true, true, true, v_now
  from public.warehouses warehouse
  on conflict (user_id, warehouse_id) do update
    set can_sell = true,
        can_manage_stock = true,
        can_receive_goods = true;

  insert into public.products(
    id, sku, name, category, brand, product_type, warehouse_id, stock,
    cost, price, unit, data, created_at, updated_at
  ) overriding system value
  select
    (item ->> 'id')::bigint,
    nullif(item ->> 'sku', ''),
    btrim(item ->> 'name'),
    nullif(item ->> 'category', ''),
    nullif(item ->> 'brand', ''),
    nullif(item ->> 'type', ''),
    case when coalesce(item ->> 'wh', '') ~ '^[0-9]+$'
      then (item ->> 'wh')::bigint else null end,
    0,
    greatest(coalesce(nullif(item ->> 'cost', '')::numeric, 0), 0),
    greatest(coalesce(nullif(item ->> 'price', '')::numeric, 0), 0),
    nullif(item ->> 'unit', ''),
    item - 'stock' - '_catalogExpiry',
    v_now,
    v_now
  from jsonb_array_elements(v_data -> 'products') item;

  insert into public.contacts(
    id, type, name, phone, data, created_at, updated_at
  ) overriding system value
  select
    (item ->> 'id')::bigint,
    case
      when coalesce(item -> 'types', '[]'::jsonb) ?& array['customer', 'supplier'] then 'both'
      when coalesce(item -> 'types', '[]'::jsonb) ? 'supplier' then 'supplier'
      else 'customer'
    end,
    btrim(item ->> 'name'),
    nullif(item ->> 'phone', ''),
    item,
    v_now,
    v_now
  from jsonb_array_elements(v_data -> 'contacts') item;

  insert into public.sales_representatives(id, name, data)
  overriding system value
  select (item ->> 'id')::bigint, btrim(item ->> 'name'), item
  from jsonb_array_elements(v_data -> 'salesRepresentatives') item;

  insert into public.quotations(id, data, created_at, updated_at)
  select item ->> 'id', item, v_now, v_now
  from jsonb_array_elements(v_data -> 'quotations') item;
  insert into public.invoices_ar(id, data, created_at, updated_at)
  select item ->> 'id', item, v_now, v_now
  from jsonb_array_elements(v_data -> 'invoicesAR') item;
  insert into public.credit_notes(id, data, created_at, updated_at)
  select item ->> 'id', item, v_now, v_now
  from jsonb_array_elements(v_data -> 'creditNotes') item;
  insert into public.purchase_orders(id, data, created_at, updated_at)
  select item ->> 'id', item, v_now, v_now
  from jsonb_array_elements(v_data -> 'purchaseOrders') item;
  insert into public.goods_receipts(id, data, created_at, updated_at)
  select item ->> 'id', item, v_now, v_now
  from jsonb_array_elements(v_data -> 'goodsReceipts') item;
  insert into public.purchase_orders_full(id, data, created_at, updated_at)
  select item ->> 'id', item, v_now, v_now
  from jsonb_array_elements(v_data -> 'purchaseOrdersFull') item;
  insert into public.product_returns(id, data, created_at, updated_at)
  select item ->> 'id', item, v_now, v_now
  from jsonb_array_elements(v_data -> 'productReturns') item;
  insert into public.product_exchanges(id, created_by, data, created_at, updated_at)
  select item ->> 'id', (select auth.uid()), item, v_now, v_now
  from jsonb_array_elements(coalesce(v_data -> 'productExchanges', '[]'::jsonb)) item;
  insert into public.transfers(id, data, created_at, updated_at)
  select item ->> 'id', item, v_now, v_now
  from jsonb_array_elements(v_data -> 'transfers') item;
  insert into public.standalone_tax_invoices(
    id, number, data, created_at, updated_at
  )
  select
    coalesce(
      nullif(item ->> 'id', ''),
      nullif(item ->> 'number', ''),
      'STI-' || replace(gen_random_uuid()::text, '-', '')
    ),
    nullif(item ->> 'number', ''),
    item,
    v_now,
    v_now
  from jsonb_array_elements(v_data -> 'standaloneTaxInvoices') item;

  if v_data ? 'promotions' then
    insert into public.promotions(id, data, created_at, updated_at)
    select
      (item ->> 'id')::bigint,
      item,
      v_now,
      v_now
    from jsonb_array_elements(v_data -> 'promotions') item
    where coalesce(item ->> 'id', '') ~ '^[0-9]+$';
  end if;

  insert into public.sales(
    id, ref, sale_date, sale_time, cashier, member, status, pay_method,
    discount, vat, fee, cost_total, gross_profit, cash_received, cash_change,
    total, data, checkout_request_id, checkout_payload_hash,
    checkout_request_context, cash_shift_id, void_shift_id, created_by, created_at
  )
  select
    item ->> 'id',
    nullif(item ->> 'ref', ''),
    case when coalesce(item ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (item ->> 'date')::date else null end,
    case
      when nullif(item ->> 'time', '') is null then null
      when item ->> 'time' ~* '(z|[+-][0-9]{2}:?[0-9]{2})$'
        then (item ->> 'time')::timestamptz
      else (item ->> 'time')::timestamp at time zone 'Asia/Bangkok'
    end,
    nullif(item ->> 'cashier', ''),
    case when jsonb_typeof(item -> 'member') = 'object'
      then nullif(item #>> '{member,name}', '') else nullif(item ->> 'member', '') end,
    coalesce(nullif(item ->> 'status', ''), 'done'),
    nullif(item ->> 'payMethod', ''),
    coalesce(nullif(item ->> 'discount', '')::numeric, 0),
    coalesce(nullif(item ->> 'vat', '')::numeric, 0),
    coalesce(nullif(item ->> 'fee', '')::numeric, 0),
    coalesce(nullif(item ->> 'costTotal', '')::numeric, 0),
    coalesce(nullif(item ->> 'grossProfit', '')::numeric, 0),
    coalesce(nullif(item ->> 'cashReceived', '')::numeric, 0),
    coalesce(nullif(item ->> 'cashChange', '')::numeric, 0),
    coalesce(nullif(item ->> 'total', '')::numeric, 0),
    item,
    case when coalesce(item ->> 'checkoutRequestId', '') ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (item ->> 'checkoutRequestId')::uuid else null end,
    null,
    null,
    null,
    null,
    (select auth.uid()),
    v_now
  from jsonb_array_elements(v_data -> 'salesHistory') item;

  insert into public.sale_items(
    sale_id, product_id, warehouse_id, name, qty, price, cost, cost_total,
    unit, factor, custom
  )
  select
    sale ->> 'id',
    case when coalesce(line ->> 'productId', '') ~ '^[0-9]+$'
      and exists(
        select 1 from public.products product
        where product.id = (line ->> 'productId')::bigint
      ) then (line ->> 'productId')::bigint else null end,
    case when coalesce(line ->> 'warehouseId', sale ->> 'warehouseId', '') ~ '^[0-9]+$'
      then coalesce(line ->> 'warehouseId', sale ->> 'warehouseId')::bigint
      else null end,
    nullif(line ->> 'name', ''),
    coalesce(nullif(line ->> 'qty', '')::numeric, 0),
    coalesce(nullif(line ->> 'price', '')::numeric, 0),
    coalesce(nullif(line ->> 'cost', '')::numeric, 0),
    coalesce(
      nullif(line ->> 'costTotal', '')::numeric,
      coalesce(nullif(line ->> 'qty', '')::numeric, 0)
        * coalesce(nullif(line ->> 'cost', '')::numeric, 0)
    ),
    nullif(line ->> 'unit', ''),
    coalesce(nullif(line ->> 'factor', '')::numeric, 1),
    lower(coalesce(line ->> 'custom', 'false')) in ('true', 't', '1', 'yes', 'on')
  from jsonb_array_elements(v_data -> 'salesHistory') sale
  cross join lateral jsonb_array_elements(coalesce(sale -> 'items', '[]'::jsonb)) line;

  insert into public.inventory_lots(
    id, product_id, warehouse_id, internal_code, manufacturer_lot,
    expiry_date, quantity_base, unit_cost_base, received_at, source_type,
    source_id, source_line_key, status, created_by, created_at, updated_at
  )
  select
    (item ->> 'id')::bigint,
    (item ->> 'product_id')::bigint,
    (item ->> 'warehouse_id')::bigint,
    item ->> 'internal_code',
    nullif(item ->> 'manufacturer_lot', ''),
    nullif(item ->> 'expiry_date', '')::date,
    (item ->> 'quantity_base')::numeric,
    (item ->> 'unit_cost_base')::numeric,
    (item ->> 'received_at')::timestamptz,
    item ->> 'source_type',
    nullif(item ->> 'source_id', ''),
    nullif(item ->> 'source_line_key', ''),
    item ->> 'status',
    case when exists(
      select 1 from auth.users auth_user
      where auth_user.id = nullif(item ->> 'created_by', '')::uuid
    ) then nullif(item ->> 'created_by', '')::uuid else null end,
    (item ->> 'created_at')::timestamptz,
    (item ->> 'updated_at')::timestamptz
  from jsonb_array_elements(v_inventory -> 'lots') item;

  insert into public.inventory_lot_movements(
    id, lot_id, product_id, warehouse_id, movement_type, quantity_delta,
    balance_after, reference_type, reference_id, reference_line_key, note,
    created_by, created_at
  ) overriding system value
  select
    (item ->> 'id')::bigint,
    (item ->> 'lot_id')::bigint,
    (item ->> 'product_id')::bigint,
    (item ->> 'warehouse_id')::bigint,
    item ->> 'movement_type',
    (item ->> 'quantity_delta')::numeric,
    (item ->> 'balance_after')::numeric,
    nullif(item ->> 'reference_type', ''),
    nullif(item ->> 'reference_id', ''),
    nullif(item ->> 'reference_line_key', ''),
    nullif(item ->> 'note', ''),
    case when exists(
      select 1 from auth.users auth_user
      where auth_user.id = nullif(item ->> 'created_by', '')::uuid
    ) then nullif(item ->> 'created_by', '')::uuid else null end,
    (item ->> 'created_at')::timestamptz
  from jsonb_array_elements(v_inventory -> 'movements') item;

  for v_pair in
    select distinct lot.product_id, lot.warehouse_id
    from public.inventory_lots lot
  loop
    perform private.refresh_inventory_balance_from_lots(
      v_pair.product_id, v_pair.warehouse_id
    );
  end loop;

  if jsonb_typeof(v_data -> 'inspectionLists') = 'array' then
    insert into public.inspection_lists(
      id, created_by, data, created_at, updated_at
    )
    select
      item ->> 'id',
      (select auth.uid()),
      item,
      v_now,
      v_now
    from jsonb_array_elements(v_data -> 'inspectionLists') item;
  end if;

  insert into public.favorites(user_id, product_id, unit, position, created_at)
  select
    (select auth.uid()),
    (item.value ->> 'pid')::bigint,
    coalesce(item.value ->> 'unit', ''),
    ordinality::integer - 1,
    v_now
  from jsonb_array_elements(v_data -> 'favorites') with ordinality item(value, ordinality)
  where coalesce(item.value ->> 'pid', '') ~ '^[0-9]+$'
    and exists(
      select 1 from public.products product
      where product.id = (item.value ->> 'pid')::bigint
    )
  on conflict (product_id) do update
    set user_id = excluded.user_id,
        unit = excluded.unit,
        position = excluded.position;

  if jsonb_typeof(v_data -> 'businessSettings') = 'object' then
    insert into public.settings(key, value, updated_at)
    values('business', v_data -> 'businessSettings', v_now)
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;
  end if;
  if jsonb_typeof(v_data -> 'documentPrefixes') = 'object' then
    insert into public.settings(key, value, updated_at)
    values('document_prefixes', v_data -> 'documentPrefixes', v_now)
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;
  end if;

  insert into public.settings(key, value, updated_at)
  values(
    'maintenance_epoch',
    jsonb_build_object('epoch', v_epoch, 'mode', 'restore', 'resetAt', v_now),
    v_now
  )
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at;

  foreach v_table in array array[
    'warehouses', 'products', 'contacts', 'sales_representatives', 'promotions',
    'sale_items', 'inventory_lots', 'inventory_lot_movements'
  ] loop
    v_sequence := pg_get_serial_sequence('public.' || v_table, 'id');
    if v_sequence is not null then
      execute format(
        'select setval(%L, coalesce((select max(id) from public.%I), 1), exists(select 1 from public.%I))',
        v_sequence, v_table, v_table
      );
    end if;
  end loop;

  select jsonb_build_object(
    'warehouses', (select count(*) from public.warehouses),
    'products', (select count(*) from public.products),
    'promotions', (select count(*) from public.promotions),
    'sales', (select count(*) from public.sales),
    'lots', (select count(*) from public.inventory_lots),
    'movements', (select count(*) from public.inventory_lot_movements)
  ) into v_counts;

  return jsonb_build_object(
    'ok', true,
    'epoch', v_epoch,
    'restoredAt', v_now,
    'counts', v_counts,
    'cashShiftHistoryRestored', false
  );
end;
$$;

-- Atomic restore may legitimately rebuild historical lines for a product that
-- is inactive today. Normal checkout inserts remain blocked.
create or replace function private.prevent_inactive_product_sale_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_active boolean;
begin
  if current_setting('pepos.maintenance_reset', true) = 'on'
     or new.product_id is null then
    return new;
  end if;

  select case
    when lower(coalesce(product.data ->> 'active', 'true'))
      in ('false', '0', 'no', 'off') then false
    else true
  end
  into v_is_active
  from public.products product
  where product.id = new.product_id;

  if v_is_active is false then
    raise exception 'product % is inactive', new.product_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_inactive_product_sale_item()
from public, anon, authenticated;

-- Backward-compatible overload for cached clients. It receives the same
-- canonical request binding; only the optional client SHA-256 is absent.
create or replace function public.complete_sale(
  p_request_id uuid,
  p_ref_prefix text,
  p_warehouse_id bigint,
  p_sale jsonb,
  p_items jsonb
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.complete_sale(
    p_request_id,
    p_ref_prefix,
    p_warehouse_id,
    p_sale,
    p_items,
    null::text
  )
$$;

-- Older inventory and cash RPCs remain the effective implementations from
-- earlier migrations. Rename each implementation to a private-by-privilege
-- core and expose a same-signature wrapper which acquires the restore gate
-- before the core can read or lock any store table.
alter function public.set_inventory_stock(bigint, bigint, numeric)
  rename to set_inventory_stock_core_20260831;
create function public.set_inventory_stock(
  p_product_id bigint, p_warehouse_id bigint, p_stock numeric
) returns numeric
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.set_inventory_stock_core_20260831(
    p_product_id, p_warehouse_id, p_stock
  );
end;
$$;
revoke all on function public.set_inventory_stock_core_20260831(
  bigint, bigint, numeric
) from public, anon, authenticated, service_role;
revoke all on function public.set_inventory_stock(bigint, bigint, numeric)
from public, anon, authenticated;
grant execute on function public.set_inventory_stock(bigint, bigint, numeric)
to authenticated;

alter function public.set_inventory_expiry(bigint, bigint, date)
  rename to set_inventory_expiry_core_20260831;
create function public.set_inventory_expiry(
  p_product_id bigint, p_warehouse_id bigint, p_expiry date
) returns date
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.set_inventory_expiry_core_20260831(
    p_product_id, p_warehouse_id, p_expiry
  );
end;
$$;
revoke all on function public.set_inventory_expiry_core_20260831(
  bigint, bigint, date
) from public, anon, authenticated, service_role;
revoke all on function public.set_inventory_expiry(bigint, bigint, date)
from public, anon, authenticated;
grant execute on function public.set_inventory_expiry(bigint, bigint, date)
to authenticated;

alter function public.update_inventory_lot_details(bigint, text, date)
  rename to update_inventory_lot_details_core_20260831;
create function public.update_inventory_lot_details(
  p_lot_id bigint, p_manufacturer_lot text, p_expiry date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.update_inventory_lot_details_core_20260831(
    p_lot_id, p_manufacturer_lot, p_expiry
  );
end;
$$;
revoke all on function public.update_inventory_lot_details_core_20260831(
  bigint, text, date
) from public, anon, authenticated, service_role;
revoke all on function public.update_inventory_lot_details(bigint, text, date)
from public, anon, authenticated;
grant execute on function public.update_inventory_lot_details(bigint, text, date)
to authenticated;

alter function public.change_product_base_unit(
  bigint, text, text, numeric, jsonb, numeric, numeric
) rename to change_product_base_unit_core_20260831;
create function public.change_product_base_unit(
  p_product_id bigint,
  p_expected_old_unit text,
  p_new_unit text,
  p_conversion_factor numeric,
  p_product_data jsonb,
  p_price numeric,
  p_cost numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.change_product_base_unit_core_20260831(
    p_product_id, p_expected_old_unit, p_new_unit, p_conversion_factor,
    p_product_data, p_price, p_cost
  );
end;
$$;
revoke all on function public.change_product_base_unit_core_20260831(
  bigint, text, text, numeric, jsonb, numeric, numeric
) from public, anon, authenticated, service_role;
revoke all on function public.change_product_base_unit(
  bigint, text, text, numeric, jsonb, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.change_product_base_unit(
  bigint, text, text, numeric, jsonb, numeric, numeric
) to authenticated;

alter function public.apply_product_exchange_status(text, text)
  rename to apply_product_exchange_status_core_20260831;
create function public.apply_product_exchange_status(
  p_exchange_id text, p_next_status text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_data jsonb;
begin
  perform private.acquire_store_mutation_gate();
  select coalesce(document.data, '{}'::jsonb)
  into v_data
  from public.product_exchanges document
  where document.id = p_exchange_id
  for update;
  if found and not private.jsonb_flag_is_true(v_data, 'incomingApplied') then
    if (v_data ? 'outgoingItems'
        and jsonb_typeof(v_data -> 'outgoingItems') is distinct from 'array')
       or (v_data ? 'incomingItems'
        and jsonb_typeof(v_data -> 'incomingItems') is distinct from 'array') then
      raise exception 'invalid product exchange items';
    end if;
    if not private.jsonb_flag_is_true(v_data, 'outgoingApplied')
       and jsonb_array_length(
         coalesce(v_data -> 'outgoingItems', '[]'::jsonb)
       ) = 0 then
      raise exception 'outgoing product exchange items are required';
    end if;
    if exists (
      select 1
      from (
        select value
        from jsonb_array_elements(
          case when jsonb_typeof(v_data -> 'outgoingItems') = 'array'
            then v_data -> 'outgoingItems' else '[]'::jsonb end
        )
        union all
        select value
        from jsonb_array_elements(
          case when jsonb_typeof(v_data -> 'incomingItems') = 'array'
            then v_data -> 'incomingItems' else '[]'::jsonb end
        )
      ) item
      where jsonb_typeof(item.value) <> 'object'
         or coalesce(item.value ->> 'pid', '') !~ '^[1-9][0-9]{0,17}$'
    ) then
      raise exception 'invalid product exchange item';
    end if;
    perform private.acquire_inventory_product_locks(array(
      select distinct requested.product_id
      from (
        select (value ->> 'pid')::bigint as product_id
        from jsonb_array_elements(
          case when jsonb_typeof(v_data -> 'outgoingItems') = 'array'
            then v_data -> 'outgoingItems' else '[]'::jsonb end
        )
        union all
        select (value ->> 'pid')::bigint as product_id
        from jsonb_array_elements(
          case when jsonb_typeof(v_data -> 'incomingItems') = 'array'
            then v_data -> 'incomingItems' else '[]'::jsonb end
        )
      ) requested
      order by requested.product_id
    ));
  end if;
  return public.apply_product_exchange_status_core_20260831(
    p_exchange_id, p_next_status
  );
end;
$$;
revoke all on function public.apply_product_exchange_status_core_20260831(
  text, text
) from public, anon, authenticated, service_role;
revoke all on function public.apply_product_exchange_status(text, text)
from public, anon, authenticated;
grant execute on function public.apply_product_exchange_status(text, text)
to authenticated;

alter function public.apply_product_return_lots(text)
  rename to apply_product_return_lots_core_20260831;
create function public.apply_product_return_lots(p_return_id text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_data jsonb;
begin
  perform private.acquire_store_mutation_gate();
  select coalesce(document.data, '{}'::jsonb)
  into v_data
  from public.product_returns document
  where document.id = p_return_id
  for update;
  if found
     and nullif(btrim(coalesce(v_data ->> 'lotAppliedAt', '')), '') is null
     and not private.jsonb_flag_is_true(v_data, 'stockApplied') then
    if jsonb_typeof(v_data -> 'items') is distinct from 'array' then
      raise exception 'invalid product return items';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_data -> 'items') item(value)
      where jsonb_typeof(item.value) <> 'object'
         or coalesce(item.value ->> 'productId', '') !~ '^[1-9][0-9]{0,17}$'
    ) then
      raise exception 'invalid product return item';
    end if;
    perform private.acquire_inventory_product_locks(array(
      select distinct (item.value ->> 'productId')::bigint
      from jsonb_array_elements(v_data -> 'items') item(value)
      order by 1
    ));
  end if;
  return public.apply_product_return_lots_core_20260831(p_return_id);
end;
$$;
revoke all on function public.apply_product_return_lots_core_20260831(text)
from public, anon, authenticated, service_role;
revoke all on function public.apply_product_return_lots(text)
from public, anon, authenticated;
grant execute on function public.apply_product_return_lots(text)
to authenticated;

alter function public.correct_sale_lot_allocation(
  text, integer, bigint, bigint, numeric, text
) rename to correct_sale_lot_allocation_core_20260831;
create function public.correct_sale_lot_allocation(
  p_sale_id text,
  p_item_index integer,
  p_from_lot_id bigint,
  p_to_lot_id bigint,
  p_quantity_base numeric,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.correct_sale_lot_allocation_core_20260831(
    p_sale_id, p_item_index, p_from_lot_id, p_to_lot_id,
    p_quantity_base, p_reason
  );
end;
$$;
revoke all on function public.correct_sale_lot_allocation_core_20260831(
  text, integer, bigint, bigint, numeric, text
) from public, anon, authenticated, service_role;
revoke all on function public.correct_sale_lot_allocation(
  text, integer, bigint, bigint, numeric, text
) from public, anon, authenticated;
grant execute on function public.correct_sale_lot_allocation(
  text, integer, bigint, bigint, numeric, text
) to authenticated;

alter function public.owner_update_mobile_product_details(
  bigint, bigint, bigint, jsonb, numeric, numeric, date
) rename to owner_update_mobile_product_details_core_20260831;
create function public.owner_update_mobile_product_details(
  p_product_id bigint,
  p_warehouse_id bigint,
  p_lot_id bigint,
  p_product_data jsonb,
  p_price numeric,
  p_cost numeric,
  p_expiry date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.owner_update_mobile_product_details_core_20260831(
    p_product_id, p_warehouse_id, p_lot_id, p_product_data,
    p_price, p_cost, p_expiry
  );
end;
$$;
revoke all on function public.owner_update_mobile_product_details_core_20260831(
  bigint, bigint, bigint, jsonb, numeric, numeric, date
) from public, anon, authenticated, service_role;
revoke all on function public.owner_update_mobile_product_details(
  bigint, bigint, bigint, jsonb, numeric, numeric, date
) from public, anon, authenticated;
grant execute on function public.owner_update_mobile_product_details(
  bigint, bigint, bigint, jsonb, numeric, numeric, date
) to authenticated;

alter function public.reallocate_inventory_lots(bigint, bigint, text, jsonb)
  rename to reallocate_inventory_lots_core_20260831;
create function public.reallocate_inventory_lots(
  p_product_id bigint,
  p_warehouse_id bigint,
  p_reason text,
  p_lots jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.reallocate_inventory_lots_core_20260831(
    p_product_id, p_warehouse_id, p_reason, p_lots
  );
end;
$$;
revoke all on function public.reallocate_inventory_lots_core_20260831(
  bigint, bigint, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.reallocate_inventory_lots(
  bigint, bigint, text, jsonb
) from public, anon, authenticated;
grant execute on function public.reallocate_inventory_lots(
  bigint, bigint, text, jsonb
) to authenticated;

alter function public.open_cash_shift(bigint, numeric)
  rename to open_cash_shift_core_20260831;
create function public.open_cash_shift(
  p_warehouse_id bigint, p_opening_cash numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.open_cash_shift_core_20260831(
    p_warehouse_id, p_opening_cash
  );
end;
$$;
revoke all on function public.open_cash_shift_core_20260831(bigint, numeric)
from public, anon, authenticated, service_role;
revoke all on function public.open_cash_shift(bigint, numeric)
from public, anon, authenticated;
grant execute on function public.open_cash_shift(bigint, numeric)
to authenticated;

alter function public.close_cash_shift(uuid, numeric, text)
  rename to close_cash_shift_core_20260831;
create function public.close_cash_shift(
  p_shift_id uuid,
  p_counted_cash numeric,
  p_close_reason text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.close_cash_shift_core_20260831(
    p_shift_id, p_counted_cash, p_close_reason
  );
end;
$$;
revoke all on function public.close_cash_shift_core_20260831(
  uuid, numeric, text
) from public, anon, authenticated, service_role;
revoke all on function public.close_cash_shift(uuid, numeric, text)
from public, anon, authenticated;
grant execute on function public.close_cash_shift(uuid, numeric, text)
to authenticated;

alter function public.post_inventory_count_adjustment_with_shortages(
  bigint, text, text, text, jsonb
) rename to post_inventory_count_adjustment_with_shortages_core_20260831;
create function public.post_inventory_count_adjustment_with_shortages(
  p_warehouse_id bigint,
  p_reason text,
  p_note text,
  p_source_inspection_id text,
  p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) = 'array' then
    if exists (
      select 1
      from jsonb_array_elements(p_lines) line(value)
      where jsonb_typeof(line.value) <> 'object'
         or coalesce(line.value ->> 'productId', '') !~ '^[1-9][0-9]{0,17}$'
    ) then
      raise exception 'invalid inventory count product';
    end if;
    perform private.acquire_inventory_product_locks(array(
      select distinct (line.value ->> 'productId')::bigint
      from jsonb_array_elements(p_lines) line(value)
      order by 1
    ));
  end if;
  return public.post_inventory_count_adjustment_with_shortages_core_20260831(
    p_warehouse_id, p_reason, p_note, p_source_inspection_id, p_lines
  );
end;
$$;
revoke all on function public.post_inventory_count_adjustment_with_shortages_core_20260831(
  bigint, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.post_inventory_count_adjustment_with_shortages(
  bigint, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.post_inventory_count_adjustment_with_shortages(
  bigint, text, text, text, jsonb
) to authenticated;

alter function public.void_sale(text, text)
  rename to void_sale_core_20260831;
-- The legacy voider correctly restores recorded Lot allocations, but it
-- predates non-stock/service checkout lines. Preserve that logic while using
-- the immutable checkout snapshot to skip lines which never touched stock.
create or replace function public.void_sale_core_20260831(
  p_sale_id text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_data jsonb;
  v_item jsonb;
  v_allocation jsonb;
  v_lot public.inventory_lots%rowtype;
  v_product bigint;
  v_warehouse bigint;
  v_lot_id bigint;
  v_quantity numeric;
  v_line_key text;
  v_ord bigint;
  v_reversible_items integer := 0;
  v_restored_allocations integer := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_pending boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  if not (select private.is_current_owner()) then
    raise exception 'owner access required';
  end if;
  if v_reason is null then
    raise exception 'void reason is required';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
  for update;
  if not found then
    raise exception 'sale not found';
  end if;
  if v_sale.status = 'void' then
    return jsonb_build_object(
      'sale', coalesce(v_sale.data, '{}'::jsonb),
      'alreadyVoided', true
    );
  end if;
  if v_sale.status <> 'done' then
    raise exception 'only completed sales can be voided';
  end if;
  if v_sale.data ? 'fullTaxInvoice' or v_sale.data ? 'shortReceiptMeta' then
    raise exception 'issued sales documents must be handled before voiding';
  end if;

  v_data := coalesce(v_sale.data, '{}'::jsonb);
  perform private.acquire_inventory_product_locks(array(
    select distinct (item.value ->> 'productId')::bigint
    from jsonb_array_elements(
      case when jsonb_typeof(v_data -> 'items') = 'array'
        then v_data -> 'items' else '[]'::jsonb end
    ) item(value)
    where coalesce(item.value ->> 'productId', '') ~ '^[1-9][0-9]{0,17}$'
      and lower(coalesce(item.value ->> 'custom', 'false'))
        not in ('true', 't', '1', 'yes', 'on')
      and lower(coalesce(item.value ->> 'tracksStock', 'true'))
        not in ('false', 'f', '0', 'no', 'off')
    order by 1
  ));
  perform 1
  from public.inventory_lots lot
  where lot.id in (
    select nullif(allocation ->> 'lotId', '')::bigint
    from jsonb_array_elements(
      coalesce(v_data -> 'items', '[]'::jsonb)
    ) item
    cross join lateral jsonb_array_elements(
      coalesce(item -> 'lotAllocations', '[]'::jsonb)
    ) allocation
    where nullif(allocation ->> 'lotId', '') is not null
  )
  order by lot.id
  for update;

  for v_item, v_ord in
    select value, ordinality
    from jsonb_array_elements(
      coalesce(v_data -> 'items', '[]'::jsonb)
    ) with ordinality
  loop
    if lower(coalesce(v_item ->> 'custom', 'false'))
         in ('true', 't', '1', 'yes', 'on')
       or nullif(v_item ->> 'productId', '') is null
       or lower(coalesce(v_item ->> 'tracksStock', 'true'))
         in ('false', 'f', '0', 'no', 'off') then
      continue;
    end if;
    v_reversible_items := v_reversible_items + 1;
    if jsonb_array_length(
         coalesce(v_item -> 'lotAllocations', '[]'::jsonb)
       ) = 0 then
      raise exception 'sale item % has no reversible Lot allocation', v_ord;
    end if;
    v_line_key := coalesce(
      nullif(v_item ->> 'lineKey', ''), v_ord::text
    );
    v_product := (v_item ->> 'productId')::bigint;
    v_warehouse := coalesce(
      nullif(v_data ->> 'warehouseId', '')::bigint,
      nullif(v_item ->> 'warehouseId', '')::bigint
    );
    for v_allocation in
      select value
      from jsonb_array_elements(v_item -> 'lotAllocations')
    loop
      v_lot_id := nullif(v_allocation ->> 'lotId', '')::bigint;
      v_quantity := coalesce(
        nullif(v_allocation ->> 'baseQty', '')::numeric, 0
      );
      v_pending := coalesce(
        (v_allocation ->> 'pendingLot')::boolean, false
      );
      if v_lot_id is null or v_quantity <= 0 then
        raise exception 'invalid sale Lot allocation';
      end if;
      select * into v_lot
      from public.inventory_lots
      where id = v_lot_id
      for update;
      if not found
         or v_lot.product_id <> v_product
         or v_lot.warehouse_id <> v_warehouse then
        raise exception 'sale Lot allocation no longer matches inventory';
      end if;
      if v_pending or v_lot.source_type = 'sale_shortage' then
        insert into public.inventory_lot_movements(
          lot_id, product_id, warehouse_id, movement_type, quantity_delta,
          balance_after, reference_type, reference_id, reference_line_key, note
        ) values (
          v_lot_id, v_product, v_warehouse, 'sale_shortage_void', v_quantity,
          0, 'sale_void', p_sale_id, v_line_key || ':' || v_lot_id::text,
          'ยกเลิกยอดขายที่รอจัด LOT: ' || v_reason
        );
      else
        update public.inventory_lots
        set quantity_base = quantity_base + v_quantity,
            status = case when status = 'blocked' then 'blocked' else 'active' end,
            updated_at = now()
        where id = v_lot_id;
        insert into public.inventory_lot_movements(
          lot_id, product_id, warehouse_id, movement_type, quantity_delta,
          balance_after, reference_type, reference_id, reference_line_key, note
        ) values (
          v_lot_id, v_product, v_warehouse, 'sale_void', v_quantity,
          v_lot.quantity_base + v_quantity, 'sale_void', p_sale_id,
          v_line_key || ':' || v_lot_id::text,
          'ยกเลิกบิล: ' || v_reason
        );
      end if;
      v_restored_allocations := v_restored_allocations + 1;
      perform private.refresh_inventory_balance_from_lots(
        v_product, v_warehouse
      );
    end loop;
  end loop;

  if v_reversible_items > 0 and v_restored_allocations = 0 then
    raise exception 'sale has no reversible Lot allocation';
  end if;
  v_data := jsonb_set(
    v_data, '{status}', to_jsonb('void'::text), true
  );
  v_data := jsonb_set(
    v_data, '{voidReason}', to_jsonb(v_reason), true
  );
  v_data := jsonb_set(
    v_data, '{voidedAt}', to_jsonb(clock_timestamp()::text), true
  );
  v_data := jsonb_set(
    v_data, '{voidedBy}', to_jsonb((select auth.uid())::text), true
  );
  update public.sales
  set status = 'void', data = v_data
  where id = p_sale_id;
  return jsonb_build_object(
    'sale', v_data,
    'alreadyVoided', false,
    'restoredAllocations', v_restored_allocations
  );
end;
$$;
create function public.void_sale(p_sale_id text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.void_sale_core_20260831(p_sale_id, p_reason);
end;
$$;
revoke all on function public.void_sale_core_20260831(text, text)
from public, anon, authenticated, service_role;
revoke all on function public.void_sale(text, text)
from public, anon, authenticated;
grant execute on function public.void_sale(text, text)
to authenticated;

alter function public.delete_unused_product(bigint)
  rename to delete_unused_product_core_20260831;
create function public.delete_unused_product(p_product_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.acquire_store_mutation_gate();
  return public.delete_unused_product_core_20260831(p_product_id);
end;
$$;
revoke all on function public.delete_unused_product_core_20260831(bigint)
from public, anon, authenticated, service_role;
revoke all on function public.delete_unused_product(bigint)
from public, anon, authenticated;
grant execute on function public.delete_unused_product(bigint)
to authenticated;

-- Controlled reset is itself a whole-store replacement. It therefore takes
-- the exclusive gate, just like restore, before validating the actor in store
-- tables. The service-role-only core keeps its existing reset semantics.
alter function public.admin_reset_store_data(text, uuid, text)
  rename to admin_reset_store_data_core_20260831;
create function public.admin_reset_store_data(
  p_mode text, p_actor_id uuid, p_confirmation text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pepos-atomic-store-restore', 0)
  );
  return public.admin_reset_store_data_core_20260831(
    p_mode, p_actor_id, p_confirmation
  );
end;
$$;
revoke all on function public.admin_reset_store_data_core_20260831(
  text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_reset_store_data(text, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.admin_reset_store_data(text, uuid, text)
to service_role;

-- A manual tax invoice created by an older cached client can omit `id` while
-- still supplying `number`. The default prevents a NULL-PK sync failure; new
-- clients should continue to use the document number as their stable id.
alter table public.standalone_tax_invoices
  alter column id set default (
    'STI-' || replace(gen_random_uuid()::text, '-', '')
  );

-- Retire mutation primitives that bypass the Lot/audit workflows. Security
-- definer posting RPCs continue to call these internally as their owner.
revoke execute on function public.adjust_product_stock(bigint, numeric)
  from public, anon, authenticated;
revoke execute on function public.set_product_stock(bigint, numeric)
  from public, anon, authenticated;
revoke execute on function public.adjust_inventory_stock(bigint, bigint, numeric)
  from public, anon, authenticated;
revoke execute on function public.set_inventory_stock(bigint, bigint, numeric)
  from public, anon, authenticated;
revoke execute on function public.set_inventory_expiry(bigint, bigint, date)
  from public, anon, authenticated;
revoke execute on function public.update_inventory_lot_details(bigint, text, date)
  from public, anon, authenticated;
revoke execute on function public.transfer_inventory_stock(bigint, bigint, bigint, numeric)
  from public, anon, authenticated;
-- This is an internal checkout primitive: exposing it would let a cashier
-- create sale movements without the matching immutable sales row. The
-- SECURITY DEFINER complete_sale() RPC can still invoke it as the owner.
revoke execute on function public.post_sale_inventory_lots(text, bigint, jsonb)
  from public, anon, authenticated;
revoke execute on function public.restore_store_inventory_backup(jsonb, jsonb)
  from public, anon, authenticated;

-- These checked Lot-aware endpoints are still used by stock-management and
-- per-Lot expiry screens. They enforce warehouse permissions internally and
-- retain immutable movement/audit evidence, unlike the raw product-stock RPCs.
revoke execute on function public.set_inventory_stock(bigint, bigint, numeric)
  from public, anon, authenticated;
revoke execute on function public.set_inventory_expiry(bigint, bigint, date)
  from public, anon, authenticated;
revoke execute on function public.update_inventory_lot_details(bigint, text, date)
  from public, anon, authenticated;

revoke execute on function public.owner_set_setting(text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.owner_upsert_warehouse(bigint, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.owner_delete_warehouse(bigint)
  from public, anon, authenticated;
revoke execute on function public.update_sale_document_metadata(text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.save_held_sale(jsonb)
  from public, anon, authenticated;
revoke execute on function public.delete_held_sale(text)
  from public, anon, authenticated;
revoke execute on function public.record_goods_receipt_payment(text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.complete_sale(uuid, text, bigint, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke execute on function public.complete_sale(uuid, text, bigint, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.restore_store_backup_atomic(jsonb)
  from public, anon, authenticated;
revoke execute on function public.apply_inventory_transfer(text)
  from public, anon, authenticated;

grant execute on function public.owner_set_setting(text, jsonb)
  to authenticated;
grant execute on function public.owner_upsert_warehouse(bigint, text, jsonb)
  to authenticated;
grant execute on function public.owner_delete_warehouse(bigint)
  to authenticated;
grant execute on function public.update_sale_document_metadata(text, jsonb)
  to authenticated;
grant execute on function public.save_held_sale(jsonb)
  to authenticated;
grant execute on function public.delete_held_sale(text)
  to authenticated;
grant execute on function public.record_goods_receipt_payment(text, jsonb)
  to authenticated;
grant execute on function public.complete_sale(uuid, text, bigint, jsonb, jsonb, text)
  to authenticated;
grant execute on function public.complete_sale(uuid, text, bigint, jsonb, jsonb)
  to authenticated;
grant execute on function public.restore_store_backup_atomic(jsonb)
  to authenticated;
grant execute on function public.apply_inventory_transfer(text)
  to authenticated;
grant execute on function public.set_inventory_stock(bigint, bigint, numeric)
  to authenticated;
grant execute on function public.set_inventory_expiry(bigint, bigint, date)
  to authenticated;
grant execute on function public.update_inventory_lot_details(bigint, text, date)
  to authenticated;

-- Explicitly retain only the approved staff workflows after revoking the raw
-- mutation primitives above.
grant execute on function public.apply_goods_receipt_lots(text)
  to authenticated;
grant execute on function public.post_inventory_count_adjustment_with_shortages(
  bigint, text, text, text, jsonb
) to authenticated;

-- Staff profile and warehouse permissions are one authorization unit. Keep
-- them in a single database transaction so an interrupted Edge invocation can
-- never leave a removed warehouse or receiving permission behind.
create or replace function private.validate_staff_warehouse_ids(
  p_warehouse_ids bigint[]
) returns bigint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
  v_warehouse_id bigint;
begin
  if p_warehouse_ids is null or cardinality(p_warehouse_ids) = 0 then
    raise exception 'staff must have at least one warehouse';
  end if;
  if exists (
    select 1
    from unnest(p_warehouse_ids) requested(id)
    where requested.id is null or requested.id <= 0
  ) then
    raise exception 'invalid warehouse id';
  end if;
  if cardinality(p_warehouse_ids) <> (
    select count(distinct requested.id)
    from unnest(p_warehouse_ids) requested(id)
  ) then
    raise exception 'warehouse ids must be distinct';
  end if;

  select array_agg(requested.id order by requested.id)
  into v_ids
  from unnest(p_warehouse_ids) requested(id);

  -- Lock in ascending order so concurrent warehouse maintenance cannot race
  -- the foreign keys or create a different lock order.
  foreach v_warehouse_id in array v_ids loop
    perform warehouse.id
    from public.warehouses warehouse
    where warehouse.id = v_warehouse_id
    for key share;
    if not found then
      raise exception 'warehouse % does not exist', v_warehouse_id;
    end if;
  end loop;
  return v_ids;
end;
$$;

revoke all on function private.validate_staff_warehouse_ids(bigint[])
  from public, anon, authenticated, service_role;

create or replace function public.admin_create_staff_profile_access(
  p_user_id uuid,
  p_username text,
  p_first_name text,
  p_phone text,
  p_note text,
  p_level integer,
  p_warehouse_ids bigint[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_first_name text := btrim(coalesce(p_first_name, ''));
begin
  perform private.acquire_store_mutation_gate();
  if p_user_id is null then
    raise exception 'user id is required';
  end if;
  if v_username = '' or v_username !~ '^[a-z0-9._-]+$' then
    raise exception 'invalid username';
  end if;
  if v_first_name = '' then
    raise exception 'first name is required';
  end if;
  if p_level is null or p_level not in (2, 3, 4) then
    raise exception 'invalid staff level';
  end if;

  -- Keep the Auth identity stable until the profile and access rows commit.
  perform auth_user.id
  from auth.users auth_user
  where auth_user.id = p_user_id
  for key share;
  if not found then
    raise exception 'auth user does not exist';
  end if;

  perform profile.id
  from public.profiles profile
  where profile.id = p_user_id
  for update;
  if found then
    raise exception 'profile already exists';
  end if;

  v_ids := private.validate_staff_warehouse_ids(p_warehouse_ids);

  insert into public.profiles(
    id, username, first_name, phone, note, owner, level, updated_at
  ) values (
    p_user_id, v_username, v_first_name,
    btrim(coalesce(p_phone, '')), btrim(coalesce(p_note, '')),
    false, p_level, clock_timestamp()
  );

  insert into public.profile_warehouse_access(
    user_id, warehouse_id, can_sell, can_manage_stock, can_receive_goods
  )
  select p_user_id, requested.id, true, false, p_level = 2
  from unnest(v_ids) requested(id)
  order by requested.id;

  return jsonb_build_object(
    'id', p_user_id,
    'level', p_level,
    'warehouseIds', to_jsonb(v_ids)
  );
end;
$$;

create or replace function public.admin_update_staff_profile_access(
  p_user_id uuid,
  p_first_name text,
  p_phone text,
  p_note text,
  p_level integer,
  p_warehouse_ids bigint[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_ids bigint[];
  v_level integer;
  v_first_name text;
begin
  perform private.acquire_store_mutation_gate();
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  select * into v_target
  from public.profiles profile
  where profile.id = p_user_id
  for update;
  if not found then
    raise exception 'staff profile does not exist';
  end if;
  if v_target.owner or v_target.level = 1 then
    raise exception 'primary owner cannot be changed by the staff RPC';
  end if;

  v_level := coalesce(p_level, v_target.level);
  if v_level not in (2, 3, 4) then
    raise exception 'invalid staff level';
  end if;
  if p_warehouse_ids is null then
    select array_agg(access.warehouse_id order by access.warehouse_id)
    into v_ids
    from public.profile_warehouse_access access
    where access.user_id = p_user_id;
  else
    v_ids := p_warehouse_ids;
  end if;
  v_ids := private.validate_staff_warehouse_ids(v_ids);

  -- Warehouse rows are locked first to match warehouse deletion/FK-cascade
  -- order. The profile lock above already serializes staff updates per user.
  perform access.warehouse_id
  from public.profile_warehouse_access access
  where access.user_id = p_user_id
  order by access.warehouse_id
  for update;

  v_first_name := case
    when p_first_name is null then v_target.first_name
    else btrim(p_first_name)
  end;
  if btrim(coalesce(v_first_name, '')) = '' then
    raise exception 'first name is required';
  end if;

  update public.profiles
  set first_name = v_first_name,
      phone = case when p_phone is null then v_target.phone else btrim(p_phone) end,
      note = case when p_note is null then v_target.note else btrim(p_note) end,
      level = v_level,
      updated_at = clock_timestamp()
  where id = p_user_id;

  insert into public.profile_warehouse_access(
    user_id, warehouse_id, can_sell, can_manage_stock, can_receive_goods
  )
  select p_user_id, requested.id, true, false, v_level = 2
  from unnest(v_ids) requested(id)
  order by requested.id
  on conflict (user_id, warehouse_id) do update
    set can_sell = true,
        can_receive_goods = excluded.can_receive_goods;

  delete from public.profile_warehouse_access access
  where access.user_id = p_user_id
    and not (access.warehouse_id = any(v_ids));

  return jsonb_build_object(
    'id', p_user_id,
    'level', v_level,
    'warehouseIds', to_jsonb(v_ids)
  );
end;
$$;

revoke all on function public.admin_create_staff_profile_access(
  uuid, text, text, text, text, integer, bigint[]
) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_staff_profile_access(
  uuid, text, text, text, text, integer, bigint[]
) to service_role;

revoke all on function public.admin_update_staff_profile_access(
  uuid, text, text, text, integer, bigint[]
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_staff_profile_access(
  uuid, text, text, text, integer, bigint[]
) to service_role;

comment on function public.complete_sale(uuid, text, bigint, jsonb, jsonb, text)
is 'Atomic checkout with warehouse authorization and request-payload-bound idempotency.';

comment on function public.restore_store_backup_atomic(jsonb)
is 'Owner-only all-or-nothing restore of core, document, sales and Lot data from a PEPOS backup envelope or data object.';

comment on function public.save_held_sale(jsonb)
is 'Creates or updates the caller own held sale and allocates a UUID-backed id when a client id collides.';
