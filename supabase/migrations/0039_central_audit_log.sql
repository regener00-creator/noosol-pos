-- Central owner-only audit history.
-- Stock/Lot ledgers remain the source of truth and are UNIONed by the read RPC,
-- so we do not duplicate high-volume inventory history into this table.

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_level integer,
  action text not null check (action in ('insert','update','delete','stock_adjusted','unit_changed','lot_expiry_changed','lot_reallocated','store_reset')),
  entity_type text not null,
  entity_id text not null,
  warehouse_id bigint references public.warehouses(id) on delete set null,
  changed_fields text[] not null default '{}'::text[],
  before_data jsonb,
  after_data jsonb,
  source text not null default 'database_trigger',
  summary text
);

create index if not exists idx_audit_logs_occurred_at on public.audit_logs(occurred_at desc);
create index if not exists idx_audit_logs_entity_occurred on public.audit_logs(entity_type,occurred_at desc);
create index if not exists idx_audit_logs_actor_occurred on public.audit_logs(actor_id,occurred_at desc) where actor_id is not null;
create index if not exists idx_audit_logs_warehouse_occurred on public.audit_logs(warehouse_id,occurred_at desc) where warehouse_id is not null;

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public,anon,authenticated;
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;

drop policy if exists audit_logs_owner_read on public.audit_logs;
create policy audit_logs_owner_read on public.audit_logs
for select to authenticated
using ((select private.is_current_owner()));

create or replace function private.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_name text;
  v_actor_level integer;
  v_before jsonb;
  v_after jsonb;
  v_record jsonb;
  v_changed text[] := '{}'::text[];
  v_entity_id text;
  v_warehouse_id bigint;
  v_action text := lower(tg_op);
begin
  if current_setting('pepos.maintenance_reset',true)='on' then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if v_actor_id is not null then
    select coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.username),p.level
      into v_actor_name,v_actor_level
    from public.profiles p where p.id=v_actor_id;
  end if;

  if tg_op='INSERT' then
    v_after:=to_jsonb(new)-'created_at'-'updated_at';
    v_record:=v_after;
    v_changed:=array['record'];
  elsif tg_op='DELETE' then
    v_before:=to_jsonb(old)-'created_at'-'updated_at';
    v_record:=v_before;
    v_changed:=array['record'];
  else
    v_before:=to_jsonb(old)-'created_at'-'updated_at';
    v_after:=to_jsonb(new)-'created_at'-'updated_at';
    select coalesce(array_agg(key order by key),'{}'::text[])
      into v_changed
    from (
      select field_name as key
      from jsonb_object_keys(v_before||v_after) as changed_key(field_name)
      where v_before->field_name is distinct from v_after->field_name
    ) changed;
    if cardinality(v_changed)=0 then return new; end if;
    select coalesce(jsonb_object_agg(field_name,v_before->field_name),'{}'::jsonb),
           coalesce(jsonb_object_agg(field_name,v_after->field_name),'{}'::jsonb)
      into v_before,v_after
    from unnest(v_changed) as changed_key(field_name);
    v_record:=to_jsonb(new);
  end if;

  v_entity_id:=coalesce(v_record->>'id',v_record->>'key',v_record->>'user_id','-');
  if coalesce(v_record->>'warehouse_id','') ~ '^[0-9]+$' then
    v_warehouse_id:=(v_record->>'warehouse_id')::bigint;
  elsif coalesce(v_record#>>'{data,warehouseId}','') ~ '^[0-9]+$' then
    v_warehouse_id:=(v_record#>>'{data,warehouseId}')::bigint;
  end if;

  insert into public.audit_logs(
    actor_id,actor_name,actor_level,action,entity_type,entity_id,warehouse_id,
    changed_fields,before_data,after_data,summary
  ) values (
    v_actor_id,v_actor_name,v_actor_level,v_action,coalesce(nullif(tg_argv[0],''),tg_table_name),v_entity_id,v_warehouse_id,
    v_changed,v_before,v_after,format('%s %s',v_action,coalesce(nullif(tg_argv[0],''),tg_table_name))
  );
  return case when tg_op='DELETE' then old else new end;
end;
$$;

revoke execute on function private.capture_audit_log() from public,anon,authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'products','warehouses','settings','contacts','sales_representatives','promotions',
    'sales','quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts',
    'product_exchanges','purchase_orders_full','product_returns','transfers',
    'standalone_tax_invoices','inspection_lists','profiles','profile_warehouse_access'
  ] loop
    if to_regclass('public.'||v_table) is not null then
      execute format('drop trigger if exists audit_%I_changes on public.%I',v_table,v_table);
      execute format('create trigger audit_%I_changes after insert or update or delete on public.%I for each row execute function private.capture_audit_log(%L)',v_table,v_table,v_table);
    end if;
  end loop;
end;
$$;

create or replace function public.get_central_audit_logs(
  p_limit integer default 200,
  p_offset integer default 0
) returns table(
  event_key text,
  occurred_at timestamptz,
  actor_id uuid,
  actor_name text,
  actor_level integer,
  action text,
  entity_type text,
  entity_id text,
  warehouse_id bigint,
  changed_fields text[],
  before_data jsonb,
  after_data jsonb,
  source text,
  summary text
)
language plpgsql
security definer
set search_path=''
as $$
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if not (select private.is_current_owner()) then raise exception 'owner access required'; end if;

  return query
  with central_events as (
    select 'audit:'||a.id::text,a.occurred_at,a.actor_id,a.actor_name,a.actor_level,a.action,a.entity_type,a.entity_id,
           a.warehouse_id,a.changed_fields,a.before_data,a.after_data,a.source,a.summary
    from public.audit_logs a

    union all
    select 'stock:'||a.id::text,a.created_at,a.created_by,a.created_by_name,p.level,'stock_adjusted','inventory_count',a.document_no,
           a.warehouse_id,array['stock']::text[],null::jsonb,
           jsonb_build_object('reason',a.reason,'note',a.note,'lineCount',a.line_count,'sourceInspectionId',a.source_inspection_id),
           'inventory_count_adjustments','ยืนยันผลตรวจนับและปรับสต๊อก'
    from public.inventory_count_adjustments a
    left join public.profiles p on p.id=a.created_by

    union all
    select 'unit:'||u.id::text,u.created_at,u.changed_by,
           coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.username),p.level,
           'unit_changed','product',u.product_id::text,null::bigint,array['unit']::text[],
           jsonb_build_object('unit',u.old_unit),
           jsonb_build_object('unit',u.new_unit,'conversionFactor',u.conversion_factor,'balanceChanges',u.balance_changes),
           'product_unit_changes','เปลี่ยนหน่วยสินค้าหลัก'
    from public.product_unit_changes u left join public.profiles p on p.id=u.changed_by

    union all
    select 'expiry:'||e.id::text,e.created_at,e.actor_id,
           coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.username),p.level,
           'lot_expiry_changed','inventory_lot',e.lot_id::text,e.warehouse_id,array['expiry']::text[],
           jsonb_build_object('expiry',e.old_expiry,'productId',e.product_id),
           jsonb_build_object('expiry',e.new_expiry,'productId',e.product_id),
           e.source,'แก้ไขวันหมดอายุ Lot'
    from private.inventory_lot_detail_audit e left join public.profiles p on p.id=e.actor_id

    union all
    select 'reset:'||r.id::text,r.reset_at,r.actor_id,r.actor_username,p.level,
           'store_reset','store_reset',r.id::text,null::bigint,array['record']::text[],null::jsonb,
           jsonb_build_object('mode',r.mode,'rowCounts',r.row_counts),
           'store_reset_audit','ล้างข้อมูลระบบแบบควบคุม'
    from private.store_reset_audit r left join public.profiles p on p.id=r.actor_id

    union all
    select 'lot-reallocation:'||coalesce(m.reference_id,min(m.id)::text),max(m.created_at),m.created_by,
           coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.username),p.level,
           'lot_reallocated','inventory_lot',coalesce(m.reference_id,min(m.id)::text),m.warehouse_id,array['lot_quantity']::text[],null::jsonb,
           jsonb_build_object('productId',m.product_id,'movements',jsonb_agg(jsonb_build_object('lotId',m.lot_id,'quantityDelta',m.quantity_delta,'balanceAfter',m.balance_after) order by m.id)),
           'inventory_lot_movements',max(m.note)
    from public.inventory_lot_movements m
    left join public.profiles p on p.id=m.created_by
    where m.reference_type='lot_reallocation'
    group by m.reference_id,m.product_id,m.warehouse_id,m.created_by,p.first_name,p.last_name,p.username,p.level
  )
  select * from central_events
  order by central_events.occurred_at desc
  limit least(greatest(coalesce(p_limit,200),1),500)
  offset greatest(coalesce(p_offset,0),0);
end;
$$;

revoke execute on function public.get_central_audit_logs(integer,integer) from public,anon;
grant execute on function public.get_central_audit_logs(integer,integer) to authenticated;
