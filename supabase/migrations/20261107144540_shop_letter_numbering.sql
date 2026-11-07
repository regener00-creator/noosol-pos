begin;
-- The letter is part of the visible number, never a lookup key for store permissions.
create function private.shop_letter(w bigint) returns text language sql immutable strict set search_path='' as $$
  select case w when 1 then 'A' when 2 then 'B' else 'W'||w||'-' end
$$;
create table private.shop_number_counters(
 warehouse_id bigint not null, series text not null, period text not null, last_value bigint not null,
 primary key(warehouse_id,series,period)
);
create table private.shop_number_reservations(
 warehouse_id bigint not null, kind text not null, request_id uuid not null, number text not null unique,
 primary key(warehouse_id,kind,request_id)
);
revoke all on private.shop_number_counters,private.shop_number_reservations from public,anon,authenticated;
create index shop_number_cash_receipt_lookup on public.sales ((data#>>'{cashReceiptA4Meta,number}'))
 where data#>>'{cashReceiptA4Meta,number}' is not null;
create index shop_number_tax_invoice_lookup on public.sales ((data#>>'{fullTaxInvoice,number}'))
 where data#>>'{fullTaxInvoice,number}' is not null;
create function private.next_shop_number(w bigint,k text,d date,request uuid default null)
returns text language plpgsql security definer set search_path='' as $$
declare fallback text; prefix text; period_key text; num bigint; result text; used boolean;
begin
 fallback:=case k when 'sale' then 'RE' when 'hold' then 'HOLD' when 'cashBill' then 'CB' when 'taxInvoice' then 'INV'
 when 'quotation' then 'QT' when 'shortage' then 'SH' when 'goodsReceipt' then 'RI' when 'productReturn' then 'RT'
 when 'productExchange' then 'EX' when 'inspection' then 'CHECK' when 'stockAdjustment' then 'SC'
 when 'cashShift' then 'CS' when 'customerReturn' then 'RT' when 'transfer' then 'TF' end;
 if w is null or w<=0 or d is null or fallback is null then raise exception 'invalid document series';end if;
 if request is not null then
   perform pg_advisory_xact_lock(hashtextextended(w||':'||k||':'||request,0));
   select number into result from private.shop_number_reservations where warehouse_id=w and kind=k and request_id=request;
   if found then return result;end if;
 end if;
 prefix:=private.shop_letter(w)||private.configured_document_prefix(w,k,fallback);
 -- Two document types may be configured to use the same visible prefix while
 -- one resets annually and the other daily. Serialize only that shared namespace.
 perform pg_advisory_xact_lock(hashtextextended('number:'||prefix||':'||to_char(d,'YYYYMMDD'),0));
 period_key:=case when k='taxInvoice' then to_char(d,'YYYY') else to_char(d,'YYYYMMDD') end;
 loop
   insert into private.shop_number_counters values(w,prefix,period_key,1)
   on conflict(warehouse_id,series,period) do update set last_value=private.shop_number_counters.last_value+1
   returning last_value into num;
   result:=prefix||to_char(d,'YYYYMMDD')||lpad(num::text,greatest(4,length(num::text)),'0');
   -- Imported documents and restored backups can predate the counter on this server.
   select exists(select 1 from private.shop_number_reservations where number=result) or
     case k when 'sale' then exists(select 1 from public.sales where ref=result)
     when 'hold' then exists(select 1 from public.sales where ref=result)
     when 'customerReturn' then exists(select 1 from public.sales where ref=result)
     when 'cashShift' then exists(select 1 from public.cash_shifts where shift_no=result)
     when 'cashBill' then exists(select 1 from public.sales where data#>>'{cashReceiptA4Meta,number}'=result)
     when 'taxInvoice' then exists(select 1 from public.standalone_tax_invoices where id=result) or exists(select 1 from public.sales where data#>>'{fullTaxInvoice,number}'=result)
     when 'quotation' then exists(select 1 from public.quotations where id=result)
     when 'shortage' then exists(select 1 from public.purchase_orders where id=result)
     when 'goodsReceipt' then exists(select 1 from public.goods_receipts where id=result)
     when 'productReturn' then exists(select 1 from public.product_returns where id=result)
     when 'productExchange' then exists(select 1 from public.product_exchanges where id=result)
     when 'inspection' then exists(select 1 from public.inspection_lists where id=result)
     when 'transfer' then exists(select 1 from public.transfers where id=result)
     else exists(select 1 from public.inventory_count_adjustments where document_no=result) end into used;
   exit when not used;
 end loop;
 insert into private.shop_number_reservations values(w,k,coalesce(request,gen_random_uuid()),result);
 return result;
end $$;
revoke all on function private.next_shop_number(bigint,text,date,uuid),private.shop_letter(bigint) from public,anon,authenticated;

-- Client-created document types reserve at Save, not when the blank form opens.
create function public.reserve_shop_document_number(p_warehouse_id bigint,p_kind text,p_request_id uuid)
returns text language plpgsql security definer set search_path='' as $$
begin
 perform private.acquire_store_mutation_gate();
 if auth.uid() is null or p_request_id is null or not exists(select 1 from public.warehouses where id=p_warehouse_id)
 or not (private.is_current_owner() or (p_kind='goodsReceipt' and private.can_current_user_receive_goods(p_warehouse_id)) or (p_kind='inspection' and exists(select 1 from public.profile_warehouse_access
 where user_id=auth.uid() and warehouse_id=p_warehouse_id and can_sell))) then raise exception 'warehouse access denied' using errcode='42501';end if;
 if p_kind not in ('quotation','shortage','goodsReceipt','productReturn','productExchange','inspection','transfer','taxInvoice') then raise exception 'invalid document type';end if;
 return private.next_shop_number(p_warehouse_id,p_kind,(clock_timestamp() at time zone 'Asia/Bangkok')::date,p_request_id);
end $$;
revoke all on function public.reserve_shop_document_number(bigint,text,uuid) from public,anon;
grant execute on function public.reserve_shop_document_number(bigint,text,uuid) to authenticated;

create or replace function private.next_cash_shift_number(p_warehouse_id bigint,p_date date) returns text language sql security definer set search_path='' as $$
 select private.next_shop_number(p_warehouse_id,'cashShift',p_date)
$$;
do $$
declare f text; original text; replacement text;
begin
 f:=pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure);
 original:='private.next_sale_reference(v_sale_date, private.configured_document_prefix(p_warehouse_id,''sale'',''RE''))';
 if strpos(f,original)=0 then raise exception 'unknown POS numbering';end if;
 f:=replace(f,original,'private.next_shop_number(p_warehouse_id,''sale'',v_sale_date)');
 original:='v_sale_data := jsonb_set(v_sale_data, ''{ref}'',';
 if strpos(f,original)=0 then raise exception 'unknown receipt snapshot';end if;
 execute replace(f,original,'v_sale_data := jsonb_set(v_sale_data,''{shopNumbering}'',''true''::jsonb); '||original);
 f:=pg_get_functiondef('public.post_inventory_count_adjustment(bigint,text,text,text,jsonb)'::regprocedure);
 original:=substring(f from 'v_document_no := [^;]+;');
 if original is null or strpos(original,'stockAdjustment')=0 then raise exception 'unknown count numbering';end if;
 execute replace(f,original,'v_document_no := private.next_shop_number(p_warehouse_id,''stockAdjustment'',(v_now at time zone ''Asia/Bangkok'')::date);');
 f:=pg_get_functiondef('private.process_customer_return(uuid,jsonb)'::regprocedure);
 original:=substring(f from 'v_ref\s*:=\s*''RT''[^;]+;');
 if original is null then raise exception 'unknown return numbering';end if;
 execute replace(f,original,'v_ref:=private.next_shop_number(v_warehouse,''customerReturn'',(v_now at time zone ''Asia/Bangkok'')::date);');
 f:=pg_get_functiondef('public.update_sale_document_metadata(text,jsonb)'::regprocedure);
 original:='v_data := jsonb_set(v_data, array[v_key], p_metadata -> v_key, true);';
 replacement:=$body$
 if v_key in ('cashReceiptA4Meta','fullTaxInvoice','shortReceiptMeta') then
   if jsonb_typeof(p_metadata->v_key)<>'object' then raise exception 'invalid receipt metadata';end if;
   p_metadata:=jsonb_set(p_metadata,array[v_key,'number'],to_jsonb(coalesce(nullif(v_data#>>array[v_key,'number'],''),
     case when v_key='shortReceiptMeta' then case when v_data->>'shopNumbering'='true' then v_sale.ref else coalesce(nullif(v_data->>'offlineRef',''),v_sale.ref) end else private.next_shop_number(coalesce(v_warehouse_id,1),
       case when v_key='cashReceiptA4Meta' then 'cashBill' else 'taxInvoice' end,(clock_timestamp() at time zone 'Asia/Bangkok')::date) end)));
 end if;
 v_data := jsonb_set(v_data, array[v_key], p_metadata -> v_key, true);
 $body$;
 if strpos(f,original)=0 then raise exception 'unknown metadata writer';end if;
 execute replace(f,original,replacement);
 f:=replace(pg_get_functiondef('public.save_held_sale(jsonb)'::regprocedure),chr(13),'');
 original:='v_sale_data := jsonb_set(p_sale, ''{id}'', to_jsonb(v_id), true);';
 if strpos(f,original)=0 then raise exception 'unknown held order writer';end if;
 f:=replace(f,'v_id := ''HOLD-'' || replace(gen_random_uuid()::text, ''-'', '''');'||chr(10)||'  else',
 $request$if p_sale ? 'holdRequestId' then
   v_id:='HOLD-'||replace((p_sale->>'holdRequestId')::uuid::text,'-','');
   perform pg_advisory_xact_lock(hashtextextended('held-sale:'||v_id,0));
   select * into v_existing from public.sales where id=v_id for update;
   if found then
     if v_existing.status='hold' and v_existing.created_by=auth.uid() and private.document_warehouse_id(v_existing.data)=v_warehouse_id then return v_existing.data; end if;
     raise exception 'held order request already used';
   end if;
   if exists(select 1 from private.shop_number_reservations where warehouse_id=v_warehouse_id and kind='hold' and request_id=(p_sale->>'holdRequestId')::uuid) then raise exception 'held order already closed';end if;
 else v_id:='HOLD-'||replace(gen_random_uuid()::text,'-','');end if;
  else$request$);
 if strpos(f,'held order already closed')=0 then raise exception 'unknown held order identity';end if;
 execute replace(f,original,$body$
 if v_existing.id=v_id and private.document_warehouse_id(v_existing.data) is distinct from v_warehouse_id then raise exception 'held sale warehouse mismatch';end if;
 p_sale:=jsonb_set(p_sale,'{ref}',to_jsonb(coalesce(case when v_existing.id=v_id then nullif(v_existing.ref,'') end,
 private.next_shop_number(v_warehouse_id,'hold',(clock_timestamp() at time zone 'Asia/Bangkok')::date,(p_sale->>'holdRequestId')::uuid))));
 v_sale_data := jsonb_set(p_sale, '{id}', to_jsonb(v_id), true);
 $body$);
end $$;

lock table public.contacts in share row exclusive mode;
-- Longer originals are moved first, so C1 and AC1 can both be migrated without a transient collision.
create function private.prefix_original_contacts(w bigint) returns void language plpgsql set search_path='' as $$
declare r record;
begin
 for r in select id,btrim(data->>'code') code from public.contacts where warehouse_id=w and nullif(btrim(data->>'code'),'') is not null
 order by length(btrim(data->>'code')) desc,id loop
   update public.contacts set data=jsonb_set(data,'{code}',to_jsonb(private.shop_letter(w)||r.code)) where id=r.id;
 end loop;
end $$;
revoke all on function private.prefix_original_contacts(bigint) from public,anon,authenticated;
select private.prefix_original_contacts(1),private.prefix_original_contacts(2);
create function private.seed_shop_contact_counter(w bigint) returns void language sql set search_path='' as $$
 insert into private.shop_number_counters(warehouse_id,series,period,last_value)
 select w,'contact','',coalesce(max(substring(upper(data->>'code') from length(private.shop_letter(w))+2)::bigint),0)
 from public.contacts where warehouse_id=w and upper(data->>'code')~('^'||private.shop_letter(w)||'C[0-9]{1,15}$')
 on conflict(warehouse_id,series,period) do update set last_value=greatest(private.shop_number_counters.last_value,excluded.last_value)
$$;
revoke all on function private.seed_shop_contact_counter(bigint) from public,anon,authenticated;
select private.seed_shop_contact_counter(1),private.seed_shop_contact_counter(2);

create or replace function private.assign_contact_code() returns trigger language plpgsql security definer set search_path='' as $$
declare w bigint:=coalesce(new.warehouse_id,1); tag text:=private.shop_letter(w);
 code text:=btrim(coalesce(new.data->>'code','')); seq bigint; retained text;
begin
 if current_setting('pepos.maintenance_reset',true)='on' then return new;end if;
 if tg_op='UPDATE' and code=coalesce(old.data->>'code','') and new.warehouse_id is not distinct from old.warehouse_id and code<>'' then return new;end if;
 if code='' or (tg_op='INSERT' and new.data->>'_autoCode'='true') then
   select data->>'code' into retained from public.contacts where id=new.id and warehouse_id=w;
   if nullif(retained,'') is not null then code:=retained;
   else
     loop
       insert into private.shop_number_counters values(w,'contact','',1)
       on conflict(warehouse_id,series,period) do update set last_value=private.shop_number_counters.last_value+1
       returning last_value into seq;
       code:=tag||'C'||lpad(seq::text,greatest(4,length(seq::text)),'0');
       exit when not exists(select 1 from public.contacts c where c.warehouse_id=w and upper(btrim(c.data->>'code'))=code);
     end loop;
   end if;
 else
   if left(code,length(tag))<>tag then code:=tag||code;end if;
   if upper(code) ~ ('^'||tag||'C[0-9]{1,15}$') then
     insert into private.shop_number_counters values(w,'contact','',substring(upper(code) from length(tag)+2)::bigint)
     on conflict(warehouse_id,series,period) do update set last_value=greatest(private.shop_number_counters.last_value,excluded.last_value);
   end if;
 end if;
 new.data:=jsonb_set(coalesce(new.data,'{}')-'_autoCode','{code}',to_jsonb(code));
 return new;
end $$;
-- Existing IDs remain valid on upsert. A stale till cannot create another local
-- sequence or use a number issued to a different warehouse or document type.
create function private.verify_shop_document_number() returns trigger language plpgsql security definer set search_path='' as $$
declare w bigint:=coalesce(private.document_warehouse_id(new.data),1); existing boolean;
begin
 if current_setting('pepos.maintenance_reset',true)='on' or (current_setting('role',true) is distinct from 'authenticated' and session_user<>'authenticator') or w not in (1,2) then return new;end if;
 if exists(select 1 from private.shop_number_reservations where warehouse_id=w and kind=tg_argv[0] and number=new.id) then return new;end if;
 execute format('select exists(select 1 from public.%I where id=$1 and coalesce(private.document_warehouse_id(data),1)=$2)',tg_table_name)
 into existing using new.id,w;
 if not existing then raise exception 'กรุณาโหลดโปรแกรมใหม่และบันทึกโดยใช้เลขเอกสารที่เซิร์ฟเวอร์ออกให้';end if;
 return new;
end $$;
revoke all on function private.verify_shop_document_number() from public,anon,authenticated;
create trigger verify_number before insert on public.purchase_orders for each row execute function private.verify_shop_document_number('shortage');
create trigger verify_number before insert on public.goods_receipts for each row execute function private.verify_shop_document_number('goodsReceipt');
create trigger verify_number before insert on public.product_returns for each row execute function private.verify_shop_document_number('productReturn');
create trigger verify_number before insert on public.product_exchanges for each row execute function private.verify_shop_document_number('productExchange');
create trigger verify_number before insert on public.quotations for each row execute function private.verify_shop_document_number('quotation');
create trigger verify_number before insert on public.standalone_tax_invoices for each row execute function private.verify_shop_document_number('taxInvoice');
create trigger verify_number before insert on public.inspection_lists for each row execute function private.verify_shop_document_number('inspection');
create trigger verify_number before insert on public.transfers for each row execute function private.verify_shop_document_number('transfer');


-- A restored store must not reuse numbers from deleted documents, even on a new database.
create function private.shop_number_backup(w bigint) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('counters',coalesce((select jsonb_agg(to_jsonb(c)-'warehouse_id' order by series,period)
   from private.shop_number_counters c where warehouse_id=w),'[]'),
 'requests',coalesce((select jsonb_agg(to_jsonb(r)-'warehouse_id' order by kind,request_id)
   from private.shop_number_reservations r where warehouse_id=w),'[]'))
$$;
create function private.merge_shop_number_backup(w bigint,b jsonb) returns void language plpgsql set search_path='' as $$
declare payload jsonb:=b->'numberState';
begin
 if b->>'numberStateHash' is distinct from md5(payload::text) or jsonb_typeof(payload->'counters') is distinct from 'array'
 or jsonb_typeof(payload->'requests') is distinct from 'array' then raise exception 'invalid store number backup';end if;
 insert into private.shop_number_counters(warehouse_id,series,period,last_value)
 select w,series,period,last_value from jsonb_to_recordset(payload->'counters') as c(series text,period text,last_value bigint)
 on conflict(warehouse_id,series,period) do update set last_value=greatest(private.shop_number_counters.last_value,excluded.last_value);
 if exists(select 1 from jsonb_to_recordset(payload->'requests') as r(kind text,request_id uuid,number text)
   left join private.shop_number_reservations t on (t.warehouse_id,t.kind,t.request_id)=(w,r.kind,r.request_id)
   where left(r.number,length(private.shop_letter(w)))<>private.shop_letter(w) or (t.number is not null and t.number<>r.number)) then
    raise exception 'number reservation conflict';end if;
 insert into private.shop_number_reservations(warehouse_id,kind,request_id,number)
 select w,kind,request_id,number from jsonb_to_recordset(payload->'requests') as r(kind text,request_id uuid,number text)
 on conflict(warehouse_id,kind,request_id) do nothing;
end $$;
revoke all on function private.shop_number_backup(bigint),private.merge_shop_number_backup(bigint,jsonb) from public,anon,authenticated;

-- Restore pre-letter backups without renumbering any document. New backups are already prefixed.
do $$
declare f text; marker text;
begin
 f:=pg_get_functiondef('public.export_store_backup(bigint)'::regprocedure);
 marker:='''version'',4,''warehouseId''';
 if strpos(f,marker)=0 then raise exception 'unknown backup format';end if;
 execute replace(f,marker,'''version'',4,''shopLetterNumbering'',true,''numberState'',private.shop_number_backup(p_warehouse_id),''numberStateHash'',md5(private.shop_number_backup(p_warehouse_id)::text),''warehouseId''');
 f:=pg_get_functiondef('public.restore_store_backup_atomic(bigint,jsonb)'::regprocedure);
 marker:='if others<>private.shop_other_fingerprints';
 if strpos(f,marker)=0 then raise exception 'unknown restore verification';end if;
 execute replace(f,marker,'if p_warehouse_id in (1,2) and coalesce(p_backup->>''shopLetterNumbering'','''')<>''true'' then perform private.prefix_original_contacts(p_warehouse_id);end if;
 if p_backup->>''shopLetterNumbering''=''true'' then perform private.merge_shop_number_backup(p_warehouse_id,p_backup);end if;
 perform private.seed_shop_contact_counter(p_warehouse_id);
 '||marker);
end $$;
notify pgrst,'reload schema';

commit;
