begin;
-- Allocate only when the print transaction assigns a code. The per-store counter is
-- already included in shop backups; the permanent history protects restored numbers.
create function private.next_shop_label_barcode(w bigint) returns text
language plpgsql security definer set search_path='' as $$
declare n bigint; code text;
begin
  loop
    insert into private.shop_number_counters(warehouse_id,series,period,last_value)
    values(w,'internal-label-barcode','',1)
    on conflict(warehouse_id,series,period) do update set last_value=private.shop_number_counters.last_value+1
    returning last_value into n;
    if n>99999999999 then raise exception 'barcode counter reached its maximum value'; end if;
    code:=private.shop_letter(w)||'P'||lpad(n::text,11,'0');
    if not exists(select 1 from private.internal_barcode_history h where h.warehouse_id=w and h.barcode=lower(code))
       and not exists(select 1 from private.product_barcode_claims c where c.warehouse_id=w and c.barcode=lower(code)) then
      return code;
    end if;
  end loop;
end $$;
revoke all on function private.next_shop_label_barcode(bigint) from public,anon,authenticated;

lock table public.products in share row exclusive mode;
alter table private.internal_barcode_history drop constraint internal_barcode_history_barcode_check;
alter table private.internal_barcode_history add constraint internal_barcode_history_barcode_check
 check(barcode ~ '^([ab]|w[0-9]+-)?p[0-9]{11}$');
-- Preserve any pre-existing manually entered codes as claims without making them system-issued labels.
insert into private.internal_barcode_history(warehouse_id,barcode,product_id)
 select warehouse_id,barcode,product_id from private.product_barcode_claims
 where barcode ~ '^([ab]|w[0-9]+-)p[0-9]{11}$' on conflict do nothing;

do $migration$
declare f text; block text;
begin
 f:=pg_get_functiondef('private.keep_internal_barcode_history()'::regprocedure);
 if strpos(f,'^p[0-9]{11}$')=0 then raise exception 'unknown history trigger';end if;
 execute replace(f,'^p[0-9]{11}$','^([ab]|w[0-9]+-)?p[0-9]{11}$');
 f:=replace(pg_get_functiondef('private.assign_price_label_barcodes(uuid,jsonb)'::regprocedure),chr(13),'');
 block:=$old$loop
          v_code:='P'||lpad(nextval('private.internal_barcode_number')::text,11,'0');
          exit when not exists(select 1 from private.internal_barcode_history where barcode=lower(v_code))
            and not exists(select 1 from private.product_barcode_claims where barcode=lower(v_code));
        end loop;$old$;
 block:=replace(block,chr(13),'');
 if strpos(f,block)=0 then raise exception 'unknown automatic label allocator';end if;
 f:=replace(f,block,'v_code:=private.next_shop_label_barcode(coalesce(v_product.warehouse_id,1));');
 block:='if private.normalize_product_barcode(v_existing) is distinct from private.normalize_product_barcode(v_item->>''barcode'') then';
 if strpos(f,block)=0 then raise exception 'unknown label replay validation';end if;
 execute replace(f,block,$retry$if private.normalize_product_barcode(v_existing) is distinct from private.normalize_product_barcode(v_item->>'barcode')
       and not (v_item->>'barcode' ~ '^P[0-9]{11}$' and exists(
         select 1 from jsonb_array_elements(coalesce(v_product.data->'extraBarcodes','[]')) with ordinality x(val,pos)
         where private.normalize_product_barcode(coalesce(val->>'code',val#>>'{}'))=private.normalize_product_barcode(v_item->>'barcode')
           and coalesce(nullif(val->>'unit',''),nullif(v_product.data->'extraBarcodeUnits'->>(pos-1)::int,''),v_product.unit)=v_item->>'unit'
       )) then$retry$);
end $migration$;

create function public.assign_price_label_barcodes(p_warehouse_id bigint,p_request_id uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_warehouse_id is null or not exists(select 1 from public.warehouses where id=p_warehouse_id) then
   raise exception 'กรุณาเลือกร้านก่อนพิมพ์ป้าย';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 2000 then raise exception 'invalid label request';end if;
 if exists(select 1 from jsonb_array_elements(p_items) item where not exists(
   select 1 from public.products p where p.id=(item->>'pid')::bigint and p.warehouse_id=p_warehouse_id)) then
   raise exception 'สินค้าไม่อยู่ในร้านที่เลือก กรุณาโหลดรายการใหม่';end if;
 return private.assign_price_label_barcodes(p_request_id,p_items);
end $$;

create function public.system_issued_label_codes(p_warehouse_id bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'barcode',code)),'[]') from (
   select distinct p.id pid,l->>'barcode' code from private.price_label_requests r
   cross join lateral jsonb_array_elements(r.labels) l
   join public.products p on p.id=(l->>'pid')::bigint and p.warehouse_id=p_warehouse_id
   where exists(select 1 from jsonb_array_elements(r.payload) req where req->>'pid'=l->>'pid'
     and req->>'unit'=l->>'unit' and btrim(coalesce(req->>'barcode',''))='')
 ) issued);
end $$;
revoke all on function public.assign_price_label_barcodes(bigint,uuid,jsonb),public.system_issued_label_codes(bigint) from public,anon;
grant execute on function public.assign_price_label_barcodes(bigint,uuid,jsonb),public.system_issued_label_codes(bigint) to authenticated;
-- Keep the former unit's exact scan target as a normal additional barcode.
-- The main/unit barcode itself becomes empty, ready for a new label only on demand.
create function private.move_legacy_label_barcodes(w bigint) returns void
language plpgsql security definer set search_path='' as $$
declare p record; d jsonb; extras jsonb; links jsonb; units jsonb; c text; u record;
begin
 for p in select id,unit,data from public.products where warehouse_id=w and
   (data->>'barcode' ~* '^p[0-9]{11}$' or exists(select 1 from jsonb_array_elements(coalesce(data->'units','[]')) x where x->>'barcode' ~* '^p[0-9]{11}$'))
   order by id for update loop
   d:=p.data;extras:=coalesce(d->'extraBarcodes','[]');units:=coalesce(d->'units','[]');
   select coalesce(jsonb_agg(coalesce(d->'extraBarcodeUnits'->((ord-1)::int),to_jsonb(p.unit)) order by ord),'[]') into links
   from jsonb_array_elements(extras) with ordinality as a(val,ord);
   c:=d->>'barcode';
   if c ~* '^p[0-9]{11}$' then
     extras:=extras||jsonb_build_array(c); links:=links||jsonb_build_array(p.unit);
     d:=jsonb_set(d,'{barcode}','""');
   end if;
   for u in select val,ord from jsonb_array_elements(units) with ordinality a(val,ord)
     where val->>'barcode' ~* '^p[0-9]{11}$' loop
     extras:=extras||jsonb_build_array(u.val->>'barcode');links:=links||jsonb_build_array(u.val->>'sub');
     units:=jsonb_set(units,array[(u.ord-1)::text,'barcode'],'""');
     d:=jsonb_set(d,'{units}',units);
   end loop;
   update public.products set data=d||jsonb_build_object('extraBarcodes',extras,'extraBarcodeUnits',links) where id=p.id;
 end loop;
end $$;
revoke all on function private.move_legacy_label_barcodes(bigint) from public,anon,authenticated;
select private.move_legacy_label_barcodes(1),private.move_legacy_label_barcodes(2);

-- A backup from before this rollout needs the same conversion after its original
-- contents pass restore verification. New backups preserve deliberate later edits.
do $$
declare f text; marker text;
begin
 f:=pg_get_functiondef('public.export_store_backup(bigint)'::regprocedure);
 marker:='''version'',4,''shopLetterNumbering'',true';
 if strpos(f,marker)=0 then raise exception 'unknown backup format';end if;
 execute replace(f,marker,marker||',''shopLabelBarcodes'',true');
 f:=pg_get_functiondef('public.restore_store_backup_atomic(bigint,jsonb)'::regprocedure);
 marker:='if others<>private.shop_other_fingerprints';
 if strpos(f,marker)=0 then raise exception 'unknown restore verification';end if;
 execute replace(f,marker,'if p_warehouse_id in (1,2) and coalesce(p_backup->>''shopLabelBarcodes'','''')<>''true'' then perform private.move_legacy_label_barcodes(p_warehouse_id);end if;
 '||marker);
end $$;
notify pgrst,'reload schema';
commit;
