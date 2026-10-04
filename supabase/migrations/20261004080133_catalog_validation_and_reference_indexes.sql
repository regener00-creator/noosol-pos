-- Reject new invalid catalog writes without rewriting existing stock/history.
begin;
set local lock_timeout='5s';
create function private.validate_product_structure()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  u jsonb; current_unit text; next_row jsonb; names text[]; visited text[];
  units jsonb:=coalesce(new.data->'units','[]'::jsonb); expected numeric; stored numeric;
  raw_codes text[]; check_units boolean;
begin
  if auth.uid() is null and current_setting('role',true) in ('anon','authenticated') then raise exception 'not authenticated' using errcode='42501'; end if;
  if tg_op='INSERT' or new.price is distinct from old.price or new.cost is distinct from old.cost then
    if new.price<0 or new.cost<0 or new.price::text in ('NaN','Infinity','-Infinity') or new.cost::text in ('NaN','Infinity','-Infinity') then
      raise exception 'ราคาขายและราคาทุนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' using errcode='22023',hint='INVALID_PRODUCT_DATA';
    end if;
  end if;
  check_units:=tg_op='INSERT';
  if tg_op='UPDATE' then check_units:=new.unit is distinct from old.unit or units is distinct from coalesce(old.data->'units','[]'::jsonb); end if;
  if check_units then
    if jsonb_typeof(units)<>'array' then raise exception 'โครงสร้างหน่วยสินค้าไม่ถูกต้อง' using errcode='22023',hint='INVALID_PRODUCT_DATA'; end if;
    names:=array[btrim(coalesce(new.unit,''))];
    for u in select value from jsonb_array_elements(units) loop
      current_unit:=btrim(coalesce(u->>'sub',''));
      if current_unit='' or current_unit=any(names) then raise exception 'ชื่อหน่วยเพิ่มเติมว่างหรือซ้ำกัน' using errcode='22023',hint='INVALID_PRODUCT_DATA'; end if;
      names:=array_append(names,current_unit);
      if coalesce(u->>'per','') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' or coalesce(u->>'factor','') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then
        raise exception 'กรุณาระบุจำนวนต่อหน่วยและอัตราแปลงให้ถูกต้อง' using errcode='22023',hint='INVALID_PRODUCT_DATA';
      end if;
      if (u->>'per')::numeric<=0 or (u->>'factor')::numeric<=0 then raise exception 'จำนวนต่อหน่วยต้องมากกว่า 0' using errcode='22023',hint='INVALID_PRODUCT_DATA'; end if;
      if coalesce(u->>'price','0') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' or coalesce(u->>'cost','0') !~ '^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then
        raise exception 'ราคาหน่วยเพิ่มเติมต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' using errcode='22023',hint='INVALID_PRODUCT_DATA';
      end if;
    end loop;
    for u in select value from jsonb_array_elements(units) loop
      current_unit:=btrim(u->>'sub'); expected:=1; visited:=array[]::text[];
      while current_unit<>btrim(coalesce(new.unit,'')) loop
        if current_unit=any(visited) then raise exception 'หน่วยสินค้าอ้างอิงวนกลับกัน' using errcode='22023',hint='INVALID_PRODUCT_DATA'; end if;
        visited:=array_append(visited,current_unit);
        select value into next_row from jsonb_array_elements(units) where btrim(value->>'sub')=current_unit;
        if not found then raise exception 'ไม่พบหน่วยอ้างอิง' using errcode='22023',hint='INVALID_PRODUCT_DATA'; end if;
        expected:=expected*(next_row->>'per')::numeric;
        current_unit:=coalesce(nullif(btrim(next_row->>'base'),''),btrim(coalesce(new.unit,'')));
      end loop;
      stored:=(u->>'factor')::numeric;
      if abs(stored-expected)>greatest(1,abs(expected))*0.000001 then raise exception 'อัตราแปลงหน่วยไม่ตรงกับจำนวนต่อหน่วย' using errcode='22023',hint='INVALID_PRODUCT_DATA'; end if;
    end loop;
  end if;
  -- Run on changed barcode fields only, so unrelated edits to legacy rows remain possible.
  if tg_op='UPDATE' then
    if (new.data->'barcode',new.data->'units',new.data->'extraBarcodes',new.data->'vendorBarcodes') is not distinct from
       (old.data->'barcode',old.data->'units',old.data->'extraBarcodes',old.data->'vendorBarcodes') then return new; end if;
  end if;
  select array_agg(code) into raw_codes from (
    select private.normalize_product_barcode(raw) code from (
      select new.data->>'barcode' raw
      union all select value->>'barcode' from jsonb_array_elements(units)
      union all select case when jsonb_typeof(value)='object' then value->>'code' else value#>>'{}' end from jsonb_array_elements(coalesce(new.data->'extraBarcodes','[]'::jsonb))
      union all select value->>'code' from jsonb_array_elements(coalesce(new.data->'vendorBarcodes','[]'::jsonb))
    ) codes
  ) normalized where code<>'';
  if cardinality(raw_codes)<>(select count(distinct code) from unnest(raw_codes) code) then
    raise exception 'บาร์โค้ดซ้ำกันภายในสินค้าเดียวกัน' using errcode='23505',hint='DUPLICATE_PRODUCT_BARCODE';
  end if;
  return new;
end $$;
revoke all on function private.validate_product_structure() from public,anon,authenticated;
create trigger zz_validate_product_structure before insert or update on public.products
for each row execute function private.validate_product_structure();

-- Materialize only the search keys in indexes, not another source of document truth.
-- Same four nested keys as jsonb_references_product; normalize leading zeros.
create function private.document_product_ids(p_data jsonb)
returns text[] language sql immutable parallel safe set search_path='' as $$
  with recursive nodes(value) as (
    select coalesce(p_data,'null'::jsonb)
    union all
    select child.value from nodes parent cross join lateral (
      select value from jsonb_array_elements(case when jsonb_typeof(parent.value)='array' then parent.value else '[]'::jsonb end)
      union all
      select value from jsonb_each(case when jsonb_typeof(parent.value)='object' then parent.value else '{}'::jsonb end)
    ) child
  )
  select coalesce(array_agg(distinct code),array[]::text[]) from (
    select coalesce(nullif(ltrim(value->>key,'0'),''),'0') code
    from nodes cross join unnest(array['productId','pid','bgdBuyProductId','bgdGetProductId']) key
    where jsonb_typeof(value)='object' and value->>key ~ '^[0-9]+$'
  ) ids;
$$;
revoke all on function private.document_product_ids(jsonb) from public,anon;
grant execute on function private.document_product_ids(jsonb) to authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['sales','quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts','product_exchanges','purchase_orders_full','product_returns','transfers','standalone_tax_invoices','inspection_lists','promotions'] loop
    execute format('create index %I on public.%I using gin (private.document_product_ids(data))',t||'_product_refs_idx',t);
  end loop;
end $$;
-- Retain every existing concurrency gate and permission check; only replace searches.
do $$ declare definition text; begin
  select pg_get_functiondef('private.unused_product_unit_blockers(bigint)'::regprocedure) into definition;
  definition:=replace(definition,'private.jsonb_references_product(data,p_product_id)','private.document_product_ids(data) @> array[p_product_id::text]');
  definition:=replace(definition,'private.jsonb_references_product(d.data,p_product_id)','private.document_product_ids(d.data) @> array[p_product_id::text]');
  execute definition;
end $$;

-- One small response replaces multi-page manifests when nothing changed.
-- Invoker security preserves exactly the caller's product visibility.
create function public.get_product_catalog_signature()
returns text language sql stable security invoker set search_path='' as $$
  select md5(coalesce(string_agg(id::text||':'||revision::text,',' order by id),'')) from public.products;
$$;
revoke all on function public.get_product_catalog_signature() from public,anon;
grant execute on function public.get_product_catalog_signature() to authenticated;
notify pgrst,'reload schema';
commit;
