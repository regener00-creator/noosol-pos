-- Posting after insertion also covers already-open tills. PostgreSQL skips this
-- trigger on a conflicting insert, and rolls back the document if posting fails.
create function private.post_standalone_sales_stock() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  p_warehouse_id bigint;
  movement_ref text;
  line_no bigint;
  line jsonb;
  product public.products%rowtype;
  factor numeric;
  qty numeric;
  lines jsonb := '[]'::jsonb;
begin
  if current_setting('pepos.maintenance_reset',true)='on' then return new; end if;
  if tg_table_name='standalone_cash_bills' then
    p_warehouse_id:=new.warehouse_id;
    movement_ref:='cashBill:'||new.number;
  else
    p_warehouse_id:=coalesce(private.document_warehouse_id(new.data),1);
    movement_ref:='taxInvoice:'||new.id;
  end if;
  for line,line_no in select value,ordinality from jsonb_array_elements(new.data->'items') with ordinality order by nullif(coalesce(value->>'productId',value->>'pid'),'')::bigint,ordinality loop
    qty:=(line->>'qty')::numeric;
    if qty is null or qty<=0 or qty::text in ('NaN','Infinity') then raise exception 'จำนวนสินค้าไม่ถูกต้อง'; end if;
    if nullif(coalesce(line->>'productId',line->>'pid'),'') is null then continue; end if;
    select * into product from public.products where id=(coalesce(line->>'productId',line->>'pid'))::bigint and coalesce(warehouse_id,1)=p_warehouse_id for share;
    if not found then raise exception 'ไม่พบสินค้านี้ในร้านที่เลือก'; end if;
    if line->>'unit'=product.unit then factor:=1;
    else select (u->>'factor')::numeric into factor from jsonb_array_elements(product.data->'units') u where u->>'sub'=line->>'unit' limit 1;
    end if;
    if factor is null or factor<=0 or factor::text in ('NaN','Infinity') then raise exception 'หน่วยสินค้ามีการเปลี่ยนแปลง กรุณาเลือกสินค้าใหม่'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('lineKey',line_no::text,'productId',product.id,'qty',qty,'factor',factor));
  end loop;
  if jsonb_array_length(lines)>0 then perform public.post_sale_inventory_lots(movement_ref,p_warehouse_id,lines); end if;
  return new;
end $$;

-- Preserve the evidence for posted movements when an older till offers delete.
create function private.guard_standalone_sales_stock() returns trigger
language plpgsql set search_path='' security definer as $$
declare movement_ref text;
begin
  if current_setting('pepos.maintenance_reset',true) is distinct from 'on' then
    if tg_op='UPDATE' and new.data->'items' is not distinct from old.data->'items'
       and new.data->'warehouseId' is not distinct from old.data->'warehouseId' then return new; end if;
    if tg_table_name='standalone_cash_bills' then movement_ref:='cashBill:'||old.number;
    else movement_ref:='taxInvoice:'||old.id; end if;
    if exists(select 1 from public.inventory_lot_movements where reference_type='sale' and reference_id=movement_ref) then
      raise exception 'เอกสารนี้ตัดสต็อกแล้ว กรุณาเก็บไว้เป็นประวัติ';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.post_standalone_sales_stock(),private.guard_standalone_sales_stock() from public,anon,authenticated;
create trigger post_stock after insert on public.standalone_cash_bills for each row execute function private.post_standalone_sales_stock();
create trigger post_stock after insert on public.standalone_tax_invoices for each row execute function private.post_standalone_sales_stock();
create trigger guard_stock before update of data or delete on public.standalone_cash_bills for each row execute function private.guard_standalone_sales_stock();
create trigger guard_stock before update of data or delete on public.standalone_tax_invoices for each row execute function private.guard_standalone_sales_stock();

-- A standalone sale document owns its inventory movement. POS reprints and
-- historical documents only update the metadata of the original POS sale.
create function public.issue_stock_sales_document(
  p_kind text, p_warehouse_id bigint, p_request_id uuid, p_document jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  doc_number text;
  saved jsonb;
begin
  perform private.acquire_store_mutation_gate();
  if p_kind is null or p_kind not in ('cashBill','taxInvoice') or p_request_id is null then
    raise exception 'invalid document request';
  end if;
  if auth.uid() is null or not exists(select 1 from public.warehouses where id=p_warehouse_id)
     or not (private.is_current_owner() or (p_kind='cashBill' and exists(
       select 1 from public.profile_warehouse_access where user_id=auth.uid() and warehouse_id=p_warehouse_id and can_sell
     ))) then raise exception 'warehouse access denied' using errcode='42501'; end if;
  if (p_document->>'warehouseId')::bigint is distinct from p_warehouse_id or
     jsonb_typeof(p_document->'items') is distinct from 'array' or jsonb_array_length(p_document->'items')=0 then
    raise exception 'invalid document';
  end if;
  doc_number := private.next_shop_number(p_warehouse_id,p_kind,(now() at time zone 'Asia/Bangkok')::date,p_request_id);
  if p_kind='cashBill' then
    select to_jsonb(d) into saved from public.standalone_cash_bills d where d.id=p_request_id and d.warehouse_id=p_warehouse_id;
  else
    select to_jsonb(d) into saved from public.standalone_tax_invoices d where d.id=doc_number;
  end if;
  if saved is not null then return jsonb_build_object('number',doc_number,'row',saved); end if;
  if p_kind='cashBill' then
    insert into public.standalone_cash_bills as d(id,warehouse_id,data) values(p_request_id,p_warehouse_id,p_document) returning to_jsonb(d) into saved;
  else
    insert into public.standalone_tax_invoices as d(id,data) values(doc_number,p_document||jsonb_build_object('id',doc_number,'number',doc_number)) returning to_jsonb(d) into saved;
  end if;
  return jsonb_build_object('number',doc_number,'row',saved);
end $$;
revoke all on function public.issue_stock_sales_document(text,bigint,uuid,jsonb) from public,anon;
grant execute on function public.issue_stock_sales_document(text,bigint,uuid,jsonb) to authenticated;
create index standalone_cash_bills_document_date on public.standalone_cash_bills(warehouse_id,(data->>'date'),number);
