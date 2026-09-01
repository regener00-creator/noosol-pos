-- PEPOS security and reliability hardening.
-- This file is moved into migrations/ with the exact Supabase timestamp after
-- the DDL is applied successfully through the Supabase migration service.

-- ---------------------------------------------------------------------------
-- Optimistic revisions for records edited from more than one device.
-- ---------------------------------------------------------------------------
do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'products','warehouses','contacts','sales_representatives','settings',
    'quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts',
    'product_exchanges','purchase_orders_full','product_returns','transfers',
    'standalone_tax_invoices','promotions','inspection_lists'
  ] loop
    execute format(
      'alter table public.%I add column if not exists revision bigint not null default 1 check (revision > 0)',
      v_table
    );
  end loop;
end;
$migration$;

create or replace function private.bump_record_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke all on function private.bump_record_revision() from public, anon, authenticated;

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'products','warehouses','contacts','sales_representatives','settings',
    'quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts',
    'product_exchanges','purchase_orders_full','product_returns','transfers',
    'standalone_tax_invoices','promotions','inspection_lists'
  ] loop
    execute format('drop trigger if exists bump_record_revision on public.%I', v_table);
    execute format(
      'create trigger bump_record_revision before update on public.%I for each row execute function private.bump_record_revision()',
      v_table
    );
  end loop;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- One private idempotency ledger for document saves and stock operations.
-- Clients cannot write or pre-seed successful results themselves.
-- ---------------------------------------------------------------------------
create table if not exists private.operation_ledger (
  request_id uuid primary key,
  actor_id uuid references auth.users(id) on delete set null,
  operation_kind text not null,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create index if not exists operation_ledger_actor_created_idx
  on private.operation_ledger(actor_id, created_at desc)
  where actor_id is not null;

revoke all on table private.operation_ledger from public, anon, authenticated;

create or replace function private.operation_payload_hash(
  p_operation text,
  p_payload jsonb
) returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(coalesce(p_operation, '') || ':' || coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function private.operation_payload_hash(text, jsonb)
  from public, anon, authenticated;

create or replace function private.begin_operation_request(
  p_request_id uuid,
  p_operation text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text := private.operation_payload_hash(p_operation, p_payload);
  v_existing private.operation_ledger%rowtype;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_request_id is null then
    raise exception 'request id is required';
  end if;
  if btrim(coalesce(p_operation, '')) = '' then
    raise exception 'operation is required';
  end if;

  insert into private.operation_ledger(
    request_id, actor_id, operation_kind, payload_hash
  ) values (
    p_request_id, v_actor, p_operation, v_hash
  ) on conflict (request_id) do nothing;

  select * into v_existing
  from private.operation_ledger ledger
  where ledger.request_id = p_request_id
  for update;

  if v_existing.actor_id is distinct from v_actor
     or v_existing.operation_kind is distinct from p_operation
     or v_existing.payload_hash is distinct from v_hash then
    raise exception 'request id is already bound to a different operation';
  end if;

  return v_existing.result;
end;
$$;

create or replace function private.finish_operation_request(
  p_request_id uuid,
  p_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.operation_ledger
  set result = coalesce(p_result, '{}'::jsonb),
      completed_at = clock_timestamp()
  where request_id = p_request_id
    and actor_id = auth.uid();
  if not found then
    raise exception 'operation request was not started';
  end if;
  return coalesce(p_result, '{}'::jsonb);
end;
$$;

revoke all on function private.begin_operation_request(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function private.finish_operation_request(uuid, jsonb)
  from public, anon, authenticated;

-- Save/delete a mutable document only when the revision loaded by the client
-- still matches. Posted-document protection triggers remain authoritative.
create or replace function public.save_revisioned_document(
  p_request_id uuid,
  p_table text,
  p_id text,
  p_data jsonb,
  p_expected_revision bigint,
  p_delete boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_cached jsonb;
  v_result jsonb;
  v_revision bigint;
  v_actor uuid := auth.uid();
  v_created_by uuid;
  v_existing_data jsonb;
  v_warehouse_id bigint;
  v_owner boolean := private.is_current_owner();
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_table not in (
    'quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts',
    'product_exchanges','purchase_orders_full','product_returns','transfers',
    'standalone_tax_invoices'
  ) then
    raise exception 'unsupported document table';
  end if;
  if btrim(coalesce(p_id, '')) = '' then
    raise exception 'document id is required';
  end if;

  if not v_owner then
    if p_table <> 'goods_receipts' then
      raise exception 'owner access required';
    end if;
    v_warehouse_id := private.document_warehouse_id(coalesce(p_data, '{}'::jsonb));
    if not private.can_current_user_receive_goods(v_warehouse_id) then
      raise exception 'warehouse receiving access denied';
    end if;
    if coalesce(p_expected_revision, 0) > 0 then
      select created_by, data into v_created_by, v_existing_data
      from public.goods_receipts
      where id = p_id;
      if not found or v_created_by is distinct from v_actor then
        raise exception 'document access denied';
      end if;
    end if;
  end if;

  v_payload := jsonb_build_object(
    'table', p_table,
    'id', p_id,
    'data', coalesce(p_data, '{}'::jsonb),
    'expectedRevision', coalesce(p_expected_revision, 0),
    'delete', coalesce(p_delete, false)
  );
  v_cached := private.begin_operation_request(
    p_request_id,
    'save_revisioned_document',
    v_payload
  );
  if v_cached is not null then
    return v_cached;
  end if;

  if coalesce(p_delete, false) then
    if coalesce(p_expected_revision, 0) <= 0 then
      raise exception 'expected revision is required for delete';
    end if;
    execute format(
      'delete from public.%I where id = $1 and revision = $2 returning revision',
      p_table
    ) into v_revision using p_id, p_expected_revision;
    if v_revision is null then
      raise exception using
        errcode = '40001',
        message = 'REVISION_CONFLICT';
    end if;
    v_result := jsonb_build_object(
      'id', p_id,
      'deleted', true,
      'revision', v_revision
    );
  elsif coalesce(p_expected_revision, 0) = 0 then
    execute format(
      'insert into public.%I(id, data) values ($1, $2) on conflict (id) do nothing returning revision',
      p_table
    ) into v_revision using p_id, coalesce(p_data, '{}'::jsonb);
    if v_revision is null then
      raise exception using
        errcode = '40001',
        message = 'REVISION_CONFLICT';
    end if;
    v_result := jsonb_build_object(
      'id', p_id,
      'deleted', false,
      'revision', v_revision
    );
  else
    execute format(
      'update public.%I set data = $2 where id = $1 and revision = $3 returning revision',
      p_table
    ) into v_revision using p_id, coalesce(p_data, '{}'::jsonb), p_expected_revision;
    if v_revision is null then
      raise exception using
        errcode = '40001',
        message = 'REVISION_CONFLICT';
    end if;
    v_result := jsonb_build_object(
      'id', p_id,
      'deleted', false,
      'revision', v_revision
    );
  end if;

  return private.finish_operation_request(p_request_id, v_result);
end;
$$;

revoke all on function public.save_revisioned_document(
  uuid, text, text, jsonb, bigint, boolean
) from public, anon, authenticated;
grant execute on function public.save_revisioned_document(
  uuid, text, text, jsonb, bigint, boolean
) to authenticated;

-- One RPC entry point makes retry protection compulsory for every supported
-- stock-changing document operation.
create or replace function public.run_stock_operation(
  p_request_id uuid,
  p_operation text,
  p_args jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cached jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_operation not in (
    'apply_goods_receipt_lots','apply_product_return_lots',
    'apply_product_exchange_status','post_inventory_count_adjustment_with_shortages',
    'reallocate_inventory_lots','transfer_inventory_stock',
    'correct_sale_lot_allocation','void_sale','change_product_base_unit',
    'update_inventory_lot_details'
  ) then
    raise exception 'unsupported stock operation';
  end if;

  v_cached := private.begin_operation_request(
    p_request_id,
    p_operation,
    coalesce(p_args, '{}'::jsonb)
  );
  if v_cached is not null then
    return v_cached;
  end if;

  case p_operation
    when 'apply_goods_receipt_lots' then
      v_result := public.apply_goods_receipt_lots(p_args->>'receiptId');
    when 'apply_product_return_lots' then
      v_result := public.apply_product_return_lots(p_args->>'returnId');
    when 'apply_product_exchange_status' then
      v_result := public.apply_product_exchange_status(
        p_args->>'exchangeId', p_args->>'nextStatus'
      );
    when 'post_inventory_count_adjustment_with_shortages' then
      v_result := public.post_inventory_count_adjustment_with_shortages(
        (p_args->>'warehouseId')::bigint,
        p_args->>'reason',
        p_args->>'note',
        p_args->>'sourceInspectionId',
        coalesce(p_args->'lines', '[]'::jsonb)
      );
    when 'reallocate_inventory_lots' then
      v_result := public.reallocate_inventory_lots(
        (p_args->>'productId')::bigint,
        (p_args->>'warehouseId')::bigint,
        p_args->>'reason',
        coalesce(p_args->'lots', '[]'::jsonb)
      );
    when 'transfer_inventory_stock' then
      v_result := public.transfer_inventory_stock(
        (p_args->>'productId')::bigint,
        (p_args->>'fromWarehouseId')::bigint,
        (p_args->>'toWarehouseId')::bigint,
        (p_args->>'quantity')::numeric
      );
    when 'correct_sale_lot_allocation' then
      v_result := public.correct_sale_lot_allocation(
        p_args->>'saleId',
        (p_args->>'itemIndex')::integer,
        (p_args->>'fromLotId')::bigint,
        (p_args->>'toLotId')::bigint,
        (p_args->>'quantityBase')::numeric,
        p_args->>'reason'
      );
    when 'void_sale' then
      v_result := public.void_sale(p_args->>'saleId', p_args->>'reason');
    when 'change_product_base_unit' then
      v_result := public.change_product_base_unit(
        (p_args->>'productId')::bigint,
        p_args->>'expectedOldUnit',
        p_args->>'newUnit',
        (p_args->>'conversionFactor')::numeric,
        coalesce(p_args->'productData', '{}'::jsonb),
        (p_args->>'price')::numeric,
        (p_args->>'cost')::numeric
      );
    when 'update_inventory_lot_details' then
      v_result := public.update_inventory_lot_details(
        (p_args->>'lotId')::bigint,
        p_args->>'manufacturerLot',
        nullif(p_args->>'expiry', '')::date
      );
  end case;

  return private.finish_operation_request(p_request_id, v_result);
end;
$$;

revoke all on function public.run_stock_operation(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.run_stock_operation(uuid, text, jsonb)
  to authenticated;

-- Existing direct RPC grants remain available during this rolling release so
-- an already-open or service-worker-cached client is not interrupted. The new
-- application exclusively uses run_stock_operation and records request IDs.

-- ---------------------------------------------------------------------------
-- LEVEL 2 page/action permissions, optionally scoped per warehouse.
-- ---------------------------------------------------------------------------
create table if not exists public.profile_page_permissions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  page_key text not null check (page_key ~ '^[a-z0-9_]+$'),
  warehouse_id bigint references public.warehouses(id) on delete cascade,
  can_view boolean not null default true,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_print boolean not null default false,
  can_export boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique nulls not distinct (user_id, page_key, warehouse_id)
);

alter table public.profile_page_permissions enable row level security;

drop policy if exists profile_page_permissions_read on public.profile_page_permissions;
create policy profile_page_permissions_read
on public.profile_page_permissions for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_current_owner())
);

revoke all on table public.profile_page_permissions from anon;
revoke insert, update, delete on table public.profile_page_permissions from authenticated;
grant select on table public.profile_page_permissions to authenticated;

create index if not exists profile_page_permissions_user_page_idx
  on public.profile_page_permissions(user_id, page_key, warehouse_id);

create or replace function public.can_current_user_page(
  p_page_key text,
  p_warehouse_id bigint,
  p_action text default 'view'
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when private.is_current_owner() then true
    else exists (
      select 1
      from public.profile_page_permissions permission
      where permission.user_id = auth.uid()
        and permission.page_key = p_page_key
        and (permission.warehouse_id is null or permission.warehouse_id = p_warehouse_id)
        and case p_action
          when 'view' then permission.can_view
          when 'create' then permission.can_create
          when 'edit' then permission.can_edit
          when 'delete' then permission.can_delete
          when 'print' then permission.can_print
          when 'export' then permission.can_export
          else false
        end
    )
  end
$$;

revoke all on function public.can_current_user_page(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.can_current_user_page(text, bigint, text)
  to authenticated;

create or replace function private.replace_staff_page_permissions(
  p_user_id uuid,
  p_warehouse_ids bigint[],
  p_permissions jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_page text;
  v_warehouse_id bigint;
  v_allowed_pages constant text[] := array[
    'dashboard','checkout','cashshift','history','promotions','purchaseorder',
    'goodsreceipt','productexchange','products','stockcontrol','transfer',
    'barcodeprint','contacts','salesreps','cashbill','taxinvoice','quotation',
    'purchaseorder2','productreturn','inventorymovement','rinventory','lowstock',
    'expiry','rproduct','rbill','rprofit','rtax'
  ];
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'array' then
    raise exception 'permissions must be an array';
  end if;

  delete from public.profile_page_permissions where user_id = p_user_id;

  for v_item in select value from jsonb_array_elements(p_permissions)
  loop
    v_page := btrim(coalesce(v_item->>'pageKey', ''));
    v_warehouse_id := nullif(v_item->>'warehouseId', '')::bigint;
    if not (v_page = any(v_allowed_pages)) then
      raise exception 'unsupported page permission: %', v_page;
    end if;
    if v_warehouse_id is not null
       and not (v_warehouse_id = any(p_warehouse_ids)) then
      raise exception 'permission warehouse is not assigned to staff';
    end if;

    insert into public.profile_page_permissions(
      user_id, page_key, warehouse_id,
      can_view, can_create, can_edit, can_delete, can_print, can_export,
      updated_at
    ) values (
      p_user_id, v_page, v_warehouse_id,
      coalesce((v_item->>'canView')::boolean, true),
      coalesce((v_item->>'canCreate')::boolean, false),
      coalesce((v_item->>'canEdit')::boolean, false),
      coalesce((v_item->>'canDelete')::boolean, false),
      coalesce((v_item->>'canPrint')::boolean, false),
      coalesce((v_item->>'canExport')::boolean, false),
      clock_timestamp()
    )
    on conflict (user_id, page_key, warehouse_id) do update
    set can_view = excluded.can_view,
        can_create = excluded.can_create,
        can_edit = excluded.can_edit,
        can_delete = excluded.can_delete,
        can_print = excluded.can_print,
        can_export = excluded.can_export,
        updated_at = clock_timestamp();
  end loop;
end;
$$;

revoke all on function private.replace_staff_page_permissions(uuid, bigint[], jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.admin_create_staff_access_v2(
  p_user_id uuid,
  p_username text,
  p_first_name text,
  p_phone text,
  p_note text,
  p_level integer,
  p_warehouse_ids bigint[],
  p_permissions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.admin_create_staff_profile_access(
    p_user_id, p_username, p_first_name, p_phone, p_note, p_level, p_warehouse_ids
  );
  perform private.replace_staff_page_permissions(
    p_user_id, p_warehouse_ids, coalesce(p_permissions, '[]'::jsonb)
  );
  return v_result || jsonb_build_object('permissions', coalesce(p_permissions, '[]'::jsonb));
end;
$$;

create or replace function public.admin_update_staff_access_v2(
  p_user_id uuid,
  p_first_name text,
  p_phone text,
  p_note text,
  p_level integer,
  p_warehouse_ids bigint[],
  p_permissions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_ids bigint[];
begin
  v_result := public.admin_update_staff_profile_access(
    p_user_id, p_first_name, p_phone, p_note, p_level, p_warehouse_ids
  );
  select array_agg(access.warehouse_id order by access.warehouse_id)
  into v_ids
  from public.profile_warehouse_access access
  where access.user_id = p_user_id;
  perform private.replace_staff_page_permissions(
    p_user_id, v_ids, coalesce(p_permissions, '[]'::jsonb)
  );
  return v_result || jsonb_build_object('permissions', coalesce(p_permissions, '[]'::jsonb));
end;
$$;

revoke all on function public.admin_create_staff_access_v2(
  uuid, text, text, text, text, integer, bigint[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_staff_access_v2(
  uuid, text, text, text, text, integer, bigint[], jsonb
) to service_role;

revoke all on function public.admin_update_staff_access_v2(
  uuid, text, text, text, integer, bigint[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_staff_access_v2(
  uuid, text, text, text, integer, bigint[], jsonb
) to service_role;

-- Preserve the previous Level 2 behavior until the owner customizes it.
insert into public.profile_page_permissions(
  user_id, page_key, warehouse_id,
  can_view, can_create, can_edit, can_delete, can_print, can_export
)
select profile.id, page.page_key, null,
       true,
       page.page_key in ('checkout','cashshift','goodsreceipt'),
       page.page_key in ('checkout','cashshift','goodsreceipt'),
       false,
       page.page_key in ('history','goodsreceipt','rinventory','rproduct','rbill'),
       page.page_key in ('rinventory','rproduct','rbill')
from public.profiles profile
cross join unnest(array[
  'dashboard','checkout','cashshift','history','goodsreceipt','products',
  'inventorymovement','rinventory','lowstock','expiry','rproduct','rbill'
]) page(page_key)
where profile.owner is false
on conflict (user_id, page_key, warehouse_id) do nothing;

-- ---------------------------------------------------------------------------
-- Append-only print events and client sync/error monitoring.
-- ---------------------------------------------------------------------------
create table if not exists public.print_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  actor_name text,
  document_type text not null,
  document_id text,
  print_kind text not null default 'print',
  copies integer not null default 1 check (copies between 1 and 100),
  warehouse_id bigint references public.warehouses(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  printed_at timestamptz not null default clock_timestamp()
);

alter table public.print_events enable row level security;
drop policy if exists print_events_read on public.print_events;
create policy print_events_read
on public.print_events for select
to authenticated
using (
  actor_id = (select auth.uid())
  or (select private.is_current_owner())
);
revoke insert, update, delete on table public.print_events from authenticated;
revoke all on table public.print_events from anon;
grant select on table public.print_events to authenticated;

create index if not exists print_events_document_idx
  on public.print_events(document_type, document_id, printed_at desc);
create index if not exists print_events_actor_idx
  on public.print_events(actor_id, printed_at desc)
  where actor_id is not null;

create or replace function public.record_print_event(
  p_document_type text,
  p_document_id text,
  p_print_kind text,
  p_copies integer,
  p_warehouse_id bigint,
  p_metadata jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_name text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if btrim(coalesce(p_document_type, '')) = '' then
    raise exception 'document type is required';
  end if;
  if p_warehouse_id is not null
     and not private.is_current_owner()
     and not exists (
       select 1 from public.profile_warehouse_access access
       where access.user_id = v_actor
         and access.warehouse_id = p_warehouse_id
     ) then
    raise exception 'warehouse access denied';
  end if;
  select coalesce(nullif(btrim(profile.first_name), ''), profile.username, 'ผู้ใช้งาน')
  into v_name
  from public.profiles profile
  where profile.id = v_actor;

  insert into public.print_events(
    actor_id, actor_name, document_type, document_id, print_kind,
    copies, warehouse_id, metadata
  ) values (
    v_actor, v_name, left(btrim(p_document_type), 80),
    nullif(left(btrim(coalesce(p_document_id, '')), 160), ''),
    left(btrim(coalesce(p_print_kind, 'print')), 40),
    greatest(1, least(coalesce(p_copies, 1), 100)),
    p_warehouse_id,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_print_event(
  text, text, text, integer, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.record_print_event(
  text, text, text, integer, bigint, jsonb
) to authenticated;

create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  device_id text,
  severity text not null default 'error'
    check (severity in ('info','warning','error','fatal')),
  category text not null default 'sync',
  operation text not null,
  table_name text,
  record_id text,
  error_code text,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved')),
  occurred_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz
);

alter table public.sync_events enable row level security;
drop policy if exists sync_events_read on public.sync_events;
create policy sync_events_read
on public.sync_events for select
to authenticated
using (
  actor_id = (select auth.uid())
  or (select private.is_current_owner())
);
revoke insert, update, delete on table public.sync_events from authenticated;
revoke all on table public.sync_events from anon;
grant select on table public.sync_events to authenticated;

create index if not exists sync_events_open_idx
  on public.sync_events(status, occurred_at desc)
  where status = 'open';
create index if not exists sync_events_actor_idx
  on public.sync_events(actor_id, occurred_at desc)
  where actor_id is not null;

create or replace function public.report_client_event(
  p_device_id text,
  p_severity text,
  p_category text,
  p_operation text,
  p_table_name text,
  p_record_id text,
  p_error_code text,
  p_message text,
  p_context jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if btrim(coalesce(p_operation, '')) = ''
     or btrim(coalesce(p_message, '')) = '' then
    raise exception 'operation and message are required';
  end if;
  insert into public.sync_events(
    actor_id, device_id, severity, category, operation,
    table_name, record_id, error_code, message, context
  ) values (
    v_actor,
    nullif(left(btrim(coalesce(p_device_id, '')), 120), ''),
    case when p_severity in ('info','warning','error','fatal') then p_severity else 'error' end,
    left(btrim(coalesce(p_category, 'sync')), 60),
    left(btrim(p_operation), 120),
    nullif(left(btrim(coalesce(p_table_name, '')), 80), ''),
    nullif(left(btrim(coalesce(p_record_id, '')), 160), ''),
    nullif(left(btrim(coalesce(p_error_code, '')), 80), ''),
    left(btrim(p_message), 1000),
    coalesce(p_context, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.report_client_event(
  text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.report_client_event(
  text, text, text, text, text, text, text, text, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- Seven-year audit archive and short-lived operational diagnostics.
-- ---------------------------------------------------------------------------
create table if not exists public.owner_recovery_codes (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 10),
  used_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.owner_recovery_codes enable row level security;
revoke all on table public.owner_recovery_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.owner_recovery_codes to service_role;
create unique index if not exists owner_recovery_codes_hash_idx
  on public.owner_recovery_codes(code_hash);

create table if not exists public.data_retention_policies (
  data_type text primary key,
  retention_days integer not null check (retention_days >= 30),
  archive_before_delete boolean not null default false,
  note text,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.data_retention_policies enable row level security;
drop policy if exists data_retention_policies_owner_read on public.data_retention_policies;
create policy data_retention_policies_owner_read
on public.data_retention_policies for select
to authenticated
using ((select private.is_current_owner()));
revoke insert, update, delete on table public.data_retention_policies from authenticated;
revoke all on table public.data_retention_policies from anon;
grant select on table public.data_retention_policies to authenticated;

insert into public.data_retention_policies(
  data_type, retention_days, archive_before_delete, note
) values
  ('audit_logs', 2555, true, 'เก็บประวัติการทำงาน 7 ปีแล้วจึงย้ายเข้า archive'),
  ('print_events', 2555, false, 'เก็บประวัติการพิมพ์ 7 ปี'),
  ('sync_events', 180, false, 'เก็บข้อผิดพลาดการซิงก์ 180 วัน'),
  ('operation_ledger', 365, false, 'เก็บ request id สำหรับป้องกันการกดซ้ำ 1 ปี')
on conflict (data_type) do update
set retention_days = excluded.retention_days,
    archive_before_delete = excluded.archive_before_delete,
    note = excluded.note,
    updated_at = clock_timestamp();

create table if not exists private.audit_logs_archive (
  like public.audit_logs including defaults including constraints
);
alter table private.audit_logs_archive
  add column if not exists archived_at timestamptz not null default clock_timestamp();
create unique index if not exists audit_logs_archive_id_idx
  on private.audit_logs_archive(id);
revoke all on table private.audit_logs_archive from public, anon, authenticated;

-- The retention durations and private archive are created now, but no job in
-- this migration deletes or rewrites existing Production data. Scheduling a
-- purge/archive run is intentionally a separate, explicitly approved action.

comment on table public.profile_page_permissions
is 'Per-user page/action permissions; warehouse_id NULL means every assigned warehouse.';
comment on table public.print_events
is 'Append-only record of print actions, separate from immutable sales/documents.';
comment on table public.sync_events
is 'Client-side sync/runtime failures reported for owner monitoring and retry support.';
comment on function public.run_stock_operation(uuid, text, jsonb)
is 'Request-id-bound gateway for all browser stock mutations except atomic checkout, which has its own ledger.';
