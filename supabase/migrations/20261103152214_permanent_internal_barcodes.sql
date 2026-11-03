begin;
set local lock_timeout='5s';
lock table public.products in share row exclusive mode;

create sequence private.internal_barcode_number as bigint minvalue 0 maxvalue 99999999999 start 0 no cycle;
revoke all on sequence private.internal_barcode_number from public,anon,authenticated;

-- Deliberately no FK/cascade: deleting a product must never release its number.
create table private.internal_barcode_history (
  barcode text primary key check (barcode ~ '^p[0-9]{11}$'),
  product_id bigint not null,
  issued_at timestamptz not null default now()
);
alter table private.internal_barcode_history enable row level security;
revoke all on private.internal_barcode_history from public,anon,authenticated;
insert into private.internal_barcode_history(barcode,product_id)
  select barcode,product_id from private.product_barcode_claims where barcode ~ '^p[0-9]{11}$';

create table private.price_label_requests (
  request_id uuid primary key,
  actor_id uuid not null,
  payload jsonb not null,
  labels jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.price_label_requests enable row level security;
revoke all on private.price_label_requests from public,anon,authenticated;

create function private.keep_internal_barcode_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_code text; v_owner bigint; v_old text[]:=array[]::text[];
begin
  if tg_op='UPDATE' then v_old:=private.product_barcode_codes(old.data); end if;
  foreach v_code in array private.product_barcode_codes(new.data) loop
    if v_code !~ '^p[0-9]{11}$' then continue; end if;
    insert into private.internal_barcode_history(barcode,product_id) values(v_code,new.id) on conflict do nothing;
    if not found then
      select product_id into v_owner from private.internal_barcode_history where barcode=v_code;
      -- An unchanged original assignment is valid. A restore may reinsert the
      -- original product identity; a different product can never take the code.
      if v_owner<>new.id or (tg_op='UPDATE' and not (v_code=any(v_old))) then
        raise exception 'บาร์โค้ด % ถูกใช้แล้วและไม่สามารถนำกลับมาใช้ใหม่ได้',upper(v_code)
          using errcode='23505',hint='INTERNAL_BARCODE_ALREADY_USED';
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.keep_internal_barcode_history() from public,anon,authenticated;
create trigger products_keep_internal_barcode_history after insert or update of data on public.products
  for each row execute function private.keep_internal_barcode_history();

create function private.assign_price_label_barcodes(p_request_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_job private.price_label_requests%rowtype;
  v_product public.products%rowtype; v_item jsonb; v_unit text; v_code text;
  v_units jsonb; v_unit_index int; v_existing text; v_labels jsonb:='[]'; v_rows jsonb;
  v_pid bigint; v_qty int; v_seen text[]:=array[]::text[]; v_target text;
begin
  if v_actor is null or not private.is_current_owner() then raise exception 'owner access required' using errcode='42501'; end if;
  if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid label request'; end if;
  if jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>2000 then raise exception 'ต้องเลือกสินค้า 1–2000 รายการต่อครั้ง'; end if;
  perform pg_advisory_xact_lock(hashtextextended('price-label:'||p_request_id::text,0));
  select * into v_job from private.price_label_requests where request_id=p_request_id;
  if found then
    if v_job.actor_id<>v_actor or v_job.payload<>p_items then raise exception 'label request does not match its original payload' using errcode='22023'; end if;
    v_labels:=v_job.labels;
    perform p.id from public.products p where p.id in (select (value->>'pid')::bigint from jsonb_array_elements(v_labels)) order by p.id for update;
    for v_item in select value from jsonb_array_elements(v_labels) loop
      select * into v_product from public.products where id=(v_item->>'pid')::bigint;
      if not found or coalesce(v_product.data->>'active','true')='false' then raise exception 'สินค้าของคำขอเดิมถูกลบหรือเลิกใช้งานแล้ว'; end if;
      if v_item->>'unit'=coalesce(nullif(v_product.unit,''),'ชิ้น') then
        v_existing:=v_product.data->>'barcode';
      else
        select value->>'barcode' into v_existing from jsonb_array_elements(coalesce(v_product.data->'units','[]')) where value->>'sub'=v_item->>'unit';
      end if;
      if private.normalize_product_barcode(v_existing) is distinct from private.normalize_product_barcode(v_item->>'barcode') then
        raise exception 'บาร์โค้ดของคำขอเดิมถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด';
      end if;
    end loop;
  else
    -- Stable lock order also serializes simultaneous requests for the same unit.
    perform p.id from public.products p where p.id in (select (value->>'pid')::bigint from jsonb_array_elements(p_items)) order by p.id for update;
    for v_item in select value from jsonb_array_elements(p_items) loop
      v_pid:=(v_item->>'pid')::bigint; v_unit:=v_item->>'unit';
      if coalesce(v_item->>'qty','') !~ '^[0-9]+$' then raise exception 'จำนวนฉลากไม่ถูกต้อง'; end if;
      v_qty:=(v_item->>'qty')::int;
      if v_qty<1 or v_qty>500 then raise exception 'จำนวนฉลากต้องเป็น 1–500'; end if;
      select * into v_product from public.products where id=v_pid;
      if not found or coalesce(v_product.data->>'active','true')='false' then raise exception 'ไม่พบสินค้าหรือสินค้าเลิกใช้งานแล้ว'; end if;
      v_target:=v_pid::text||':'||coalesce(v_unit,'');
      if v_target=any(v_seen) then raise exception 'เลือกหน่วยสินค้าซ้ำในรายการ'; end if;
      v_seen:=array_append(v_seen,v_target);
      v_units:=coalesce(v_product.data->'units','[]'::jsonb);
      v_unit_index:=null;
      if v_unit=coalesce(nullif(v_product.unit,''),'ชิ้น') then
        v_existing:=v_product.data->>'barcode';
      else
        select (ordinality-1)::int,value->>'barcode' into v_unit_index,v_existing
          from jsonb_array_elements(v_units) with ordinality where value->>'sub'=v_unit;
        if not found then raise exception 'ไม่พบหน่วยสินค้าที่เลือก'; end if;
      end if;
      if private.normalize_product_barcode(v_existing)<>'' then raise exception 'หน่วย % มีบาร์โค้ดแล้ว กรุณาโหลดข้อมูลล่าสุด',v_unit using errcode='23505'; end if;
      v_code:=btrim(coalesce(v_item->>'barcode',''));
      if v_code='' then
        loop
          v_code:='P'||lpad(nextval('private.internal_barcode_number')::text,11,'0');
          exit when not exists(select 1 from private.internal_barcode_history where barcode=lower(v_code))
            and not exists(select 1 from private.product_barcode_claims where barcode=lower(v_code));
        end loop;
      elsif length(v_code)>48 or v_code !~ '^[ -~]+$' then raise exception 'บาร์โค้ดต้องเป็นตัวอักษรอังกฤษหรือตัวเลขไม่เกิน 48 ตัว';
      end if;
      if v_unit_index is null then
        update public.products set data=jsonb_set(coalesce(data,'{}'),'{barcode}',to_jsonb(v_code)) where id=v_pid;
      else
        update public.products set data=jsonb_set(data,array['units',v_unit_index::text,'barcode'],to_jsonb(v_code)) where id=v_pid;
      end if;
      v_labels:=v_labels||jsonb_build_array(jsonb_build_object('pid',v_pid,'unit',v_unit,'barcode',v_code,'qty',v_qty));
    end loop;
    insert into private.price_label_requests(request_id,actor_id,payload,labels) values(p_request_id,v_actor,p_items,v_labels);
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into v_rows
    from public.products p where p.id in(select (value->>'pid')::bigint from jsonb_array_elements(v_labels));
  return jsonb_build_object('items',v_labels,'products',v_rows);
end $$;
revoke all on function private.assign_price_label_barcodes(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.assign_price_label_barcodes(uuid,jsonb) to authenticated;

create function public.assign_price_label_barcodes(p_request_id uuid,p_items jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.assign_price_label_barcodes(p_request_id,p_items);
$$;
revoke all on function public.assign_price_label_barcodes(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.assign_price_label_barcodes(uuid,jsonb) to authenticated;
comment on table private.internal_barcode_history is 'Permanent internal barcode ownership. Never truncate, cascade-delete or recycle; preserve with full database backups.';
comment on sequence private.internal_barcode_number is 'P + 11 decimal digits, starting at zero. Never reset or cycle; skipped numbers are intentional.';
notify pgrst,'reload schema';
commit;
