begin;
create sequence private.inventory_lot_code_number as bigint minvalue 1 maxvalue 16777215 start 1 no cycle;
revoke all on sequence private.inventory_lot_code_number from public,anon,authenticated;

create function private.next_inventory_lot_code() returns text
language plpgsql volatile set search_path='' as $$
declare candidate text;
begin
  loop
    candidate:=lpad(upper(to_hex(nextval('private.inventory_lot_code_number'))),6,'0');
    -- A restore can bring back short codes from another installation.
    if not exists(select 1 from public.inventory_lots where internal_code=candidate) then return candidate; end if;
  end loop;
end;
$$;
revoke all on function private.next_inventory_lot_code() from public,anon,authenticated;

create or replace function private.create_inventory_lot(
  p_product_id bigint,
  p_warehouse_id bigint,
  p_quantity numeric,
  p_manufacturer_lot text,
  p_expiry date,
  p_unit_cost numeric,
  p_source_type text,
  p_source_id text,
  p_source_line_key text,
  p_received_at timestamptz default now()
) returns bigint
language plpgsql security definer set search_path=''
as $$
declare v_id bigint; v_code text;
begin
  if coalesce(p_quantity,0)<=0 then raise exception 'lot quantity must be positive'; end if;
  if p_source_id is not null and p_source_line_key is not null then
    select id into v_id from public.inventory_lots
    where source_type=p_source_type and source_id=p_source_id and source_line_key=p_source_line_key;
    if v_id is not null then return v_id; end if;
  end if;
  v_code:=private.next_inventory_lot_code();
  insert into public.inventory_lots(product_id,warehouse_id,internal_code,manufacturer_lot,expiry_date,quantity_base,unit_cost_base,received_at,source_type,source_id,source_line_key,status)
  values(p_product_id,p_warehouse_id,v_code,nullif(btrim(p_manufacturer_lot),''),p_expiry,p_quantity,greatest(coalesce(p_unit_cost,0),0),coalesce(p_received_at,now()),coalesce(nullif(p_source_type,''),'manual'),p_source_id,p_source_line_key,'active')
  on conflict (source_type,source_id,source_line_key)
    where source_id is not null and source_line_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into strict v_id from public.inventory_lots
    where source_type=p_source_type and source_id=p_source_id and source_line_key=p_source_line_key;
  end if;
  return v_id;
end;
$$;

create or replace function private.ensure_inventory_shortage_lot(
  p_product_id bigint,
  p_warehouse_id bigint
) returns bigint
language plpgsql security definer set search_path=''
as $$
declare v_lot_id bigint;
begin
  select lot.id into v_lot_id
  from public.inventory_lots lot
  where lot.source_type='sale_shortage'
    and lot.source_id=p_warehouse_id::text
    and lot.source_line_key=p_product_id::text;
  if found then return v_lot_id; end if;

  insert into public.inventory_lots(
    product_id,warehouse_id,internal_code,manufacturer_lot,expiry_date,
    quantity_base,unit_cost_base,received_at,source_type,source_id,
    source_line_key,status
  ) values (
    p_product_id,p_warehouse_id,private.next_inventory_lot_code(),
    null,null,0,0,clock_timestamp(),'sale_shortage',p_warehouse_id::text,
    p_product_id::text,'exhausted'
  )
  on conflict (source_type,source_id,source_line_key)
    where source_id is not null and source_line_key is not null
  do nothing;

  select lot.id into v_lot_id
  from public.inventory_lots lot
  where lot.source_type='sale_shortage'
    and lot.source_id=p_warehouse_id::text
    and lot.source_line_key=p_product_id::text;
  if v_lot_id is null then raise exception 'unable to create sale shortage Lot'; end if;
  return v_lot_id;
end;
$$;

commit;
