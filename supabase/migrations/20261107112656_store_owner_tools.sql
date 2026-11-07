set local lock_timeout='5s';
create policy owner_tool_settings_scope on public.settings as restrictive for select to authenticated
using ((key not in ('document_prefixes','knowledge_articles') and key not like 'document_prefixes:%' and key not like 'knowledge_articles:%' and key not like 'shop_maintenance:%')
  or exists(select 1 from public.warehouses w where key in (
    case when w.id=1 then 'document_prefixes' else 'document_prefixes:'||w.id end,
    case when w.id=1 then 'knowledge_articles' else 'knowledge_articles:'||w.id end,'shop_maintenance:'||w.id)));

create function public.owner_save_knowledge_articles(p_warehouse_id bigint,p_expected jsonb,p_value jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare k text:=case when p_warehouse_id=1 then 'knowledge_articles' else 'knowledge_articles:'||p_warehouse_id end; stored jsonb;
begin
  if auth.uid() is null or not private.is_current_owner() or not exists(select 1 from public.warehouses where id=p_warehouse_id) then raise exception 'owner and warehouse required';end if;
  perform private.acquire_store_mutation_gate();
  perform pg_advisory_xact_lock(hashtextextended('sapuri.'||k,0));
  select value into stored from public.settings where key=k for update;
  if stored is distinct from p_expected then raise exception 'ข้อมูลถูกแก้ไขจากเครื่องอื่นแล้ว กรุณาโหลดข้อมูลล่าสุด'; end if;
  perform public.owner_set_setting(k,p_value);
end $$;
create or replace function public.owner_save_knowledge_articles(p_expected jsonb,p_value jsonb)
returns void language sql security invoker set search_path='' as $$ select public.owner_save_knowledge_articles(1,p_expected,p_value) $$;
revoke all on function public.owner_save_knowledge_articles(bigint,jsonb,jsonb) from public,anon;
grant execute on function public.owner_save_knowledge_articles(bigint,jsonb,jsonb) to authenticated;

-- Use the actual document warehouse even when a stock RPC is called by another RPC.
do $$
declare f text;
begin
 f:=pg_get_functiondef('private.configured_document_prefix(text,text)'::regprocedure);
 execute replace(replace(f,'configured_document_prefix(','configured_document_prefix(p_warehouse_id bigint, '),
   'setting.key=''document_prefixes''','setting.key=case when p_warehouse_id=1 then ''document_prefixes'' else ''document_prefixes:''||p_warehouse_id end');
 f:=pg_get_functiondef('private.next_cash_shift_number(date)'::regprocedure);
 execute replace(replace(f,'next_cash_shift_number(','next_cash_shift_number(p_warehouse_id bigint, '),'private.configured_document_prefix(','private.configured_document_prefix(p_warehouse_id,');
 f:=pg_get_functiondef('public.open_cash_shift_core_20260831(bigint,numeric)'::regprocedure);
 if strpos(f,'private.next_cash_shift_number(v_date)')=0 then raise exception 'Unknown shift numbering';end if;
 execute replace(f,'private.next_cash_shift_number(v_date)','private.next_cash_shift_number(p_warehouse_id,v_date)');
 f:=pg_get_functiondef('public.post_inventory_count_adjustment(bigint,text,text,text,jsonb)'::regprocedure);
 if strpos(f,'private.configured_document_prefix(')=0 then raise exception 'Unknown count numbering';end if;
 execute replace(f,'private.configured_document_prefix(','private.configured_document_prefix(p_warehouse_id,');
 f:=pg_get_functiondef('public.owner_upsert_warehouse(bigint,text,jsonb)'::regprocedure);
 execute replace(f,'private.configured_document_prefix(','private.configured_document_prefix(v_row.id,');
 f:=pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure);
 if strpos(f,'private.next_sale_reference(v_sale_date, p_ref_prefix)')=0 then raise exception 'Unknown sale numbering';end if;
 execute replace(f,'private.next_sale_reference(v_sale_date, p_ref_prefix)','private.next_sale_reference(v_sale_date, private.configured_document_prefix(p_warehouse_id,''sale'',''RE''))');
end $$;
revoke all on function private.configured_document_prefix(bigint,text,text),private.next_cash_shift_number(bigint,date) from public,anon,authenticated;
-- Counters are global and must not be rewound by a shop restore. A restored
-- receipt/shift can be ahead of the counter in this installation.
do $$
declare f text:=pg_get_functiondef('private.next_sale_reference(date,text)'::regprocedure);
begin
 if strpos(f,'set last_value=private.sale_document_sequences.last_value+1')=0 then raise exception 'Unknown receipt sequence';end if;
 execute replace(f,'set last_value=private.sale_document_sequences.last_value+1','set last_value=greatest(private.sale_document_sequences.last_value+1,excluded.last_value)');
end $$;
create or replace function private.next_cash_shift_number(p_warehouse_id bigint,p_date date)
returns text language plpgsql security definer set search_path='' as $$
declare prefix text:=private.configured_document_prefix(p_warehouse_id,'cashShift','CS')||to_char(p_date,'YYYYMMDD');
 num bigint; seed bigint;
begin
 select coalesce(max(substr(shift_no,length(prefix)+1)::bigint),0)+1 into seed
 from public.cash_shifts where shift_no ~ ('^'||prefix||'[0-9]+$');
 insert into private.cash_shift_sequences(shift_date,last_value) values(p_date,seed)
 on conflict(shift_date) do update set last_value=greatest(private.cash_shift_sequences.last_value+1,excluded.last_value) returning last_value into num;
 return prefix||lpad(num::text,greatest(4,length(num::text)), '0');
end $$;

-- Classify new audit records at write time, including records whose parent may later be deleted.
do $$
declare f text:=pg_get_functiondef('private.capture_audit_log()'::regprocedure); anchor text:='insert into public.audit_logs(';
begin
 if strpos(f,anchor)=0 then raise exception 'Unknown audit writer';end if;
 execute replace(f,anchor,$body$
    if v_warehouse_id is null then
      if tg_table_name='settings' and v_entity_id ~ '^(business-warehouse|product-categories|knowledge_articles|document_prefixes):[0-9]+$' then
        v_warehouse_id:=split_part(v_entity_id,':',2)::bigint;
      elsif tg_table_name='warehouses' then v_warehouse_id:=nullif(v_record->>'id','')::bigint;
      elsif tg_table_name='notes' then v_warehouse_id:=coalesce((v_record->>'representative_warehouse_id')::bigint,(v_record->>'standalone_warehouse_id')::bigint);
      elsif (v_record->>'product_id') ~ '^[0-9]+$' then select warehouse_id into v_warehouse_id from public.products where id=(v_record->>'product_id')::bigint;
      end if;
    end if;
  insert into public.audit_logs($body$);
end $$;
do $$
declare f text:=pg_get_functiondef('public.get_central_audit_log_page(integer,timestamptz,text,text,text,text,text,boolean)'::regprocedure);
begin
 if strpos(f,'where (v_entity is null')=0 then raise exception 'Unknown audit paging';end if;
 execute replace(replace(f,'public.get_central_audit_log_page(','public.get_central_audit_log_page(p_warehouse_id bigint, '),
   'where (v_entity is null','where coalesce(event.warehouse_id,1)=p_warehouse_id and (v_entity is null');
end $$;
create or replace function public.get_central_audit_log_page(p_limit integer default 20,p_cursor_time timestamptz default null,p_cursor_key text default null,p_direction text default 'first',p_search text default '',p_entity text default null,p_action text default null,p_include_total boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
 select public.get_central_audit_log_page(1,p_limit,p_cursor_time,p_cursor_key,p_direction,p_search,p_entity,p_action,p_include_total)
$$;
revoke all on function public.get_central_audit_log_page(bigint,integer,timestamptz,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.get_central_audit_log_page(bigint,integer,timestamptz,text,text,text,text,text,boolean) to authenticated;
-- Warehouse definitions, login permissions and global numbering sequences stay in the central database.
create function private.shop_backup_tables() returns text[] language sql immutable set search_path='' as $$
  select array(select t from unnest(private.store_backup_tables()) with ordinality u(t,n)
    where t not in ('public.warehouses','public.categories','public.brands','public.units','private.cash_shift_sequences','private.sale_document_sequences') order by n)
    ||array['private.note_positions','public.combined_catalog_unit_preferences']
$$;
create function private.shop_backup_history() returns text[] language sql immutable set search_path='' as $$
 select array['private.internal_barcode_history','public.audit_logs','private.audit_logs_archive','public.print_events','private.price_label_requests','private.operation_ledger']
$$;
create function private.shop_backup_relation(t text,staged boolean) returns text language sql immutable set search_path='' as $$
 select case when staged then 'pg_temp.'||quote_ident('shop_backup_'||replace(t,'.','_')) else t end
$$;
create function private.shop_backup_where(t text,w bigint,staged boolean default false) returns text
language plpgsql immutable set search_path='' as $$
declare parent text; lhs text; rhs text:='id'; cond text; s text:=w::text;
begin
 if w is null or w<1 then raise exception 'กรุณาเลือกคลัง';end if;
 if t in ('public.products','public.contacts','public.sales_representatives','public.cash_shifts','public.inventory_lots','public.inventory_balances',
          'public.inventory_lot_movements','public.inventory_count_adjustments','private.inventory_lot_detail_audit','public.audit_logs',
          'private.audit_logs_archive','public.print_events','private.internal_barcode_history') then
   return 'coalesce(r.warehouse_id,1)='||s;
 elsif t in ('public.sales','public.quotations','public.invoices_ar','public.credit_notes','public.purchase_orders','public.goods_receipts','public.purchase_orders_full',
             'public.product_returns','public.product_exchanges','public.standalone_tax_invoices','public.inspection_lists','public.promotions','public.transfers') then
   if t='public.transfers' then return format('coalesce(r.data->>''fromId'',''1'')=%L and coalesce(r.data->>''toId'',''1'')=%L',s,s); end if;
   return format('coalesce(nullif(r.data->>''warehouseId'',''''),''1'')=%L',s);
 elsif t in ('public.profile_warehouse_access','public.profile_page_permissions') then return 'r.warehouse_id='||s;
 elsif t='public.settings' then
   return format('r.key=any(%L::text[])',array[case when w=1 then 'business' else 'business-warehouse:'||s end,'business-warehouse:'||s,
      case when w=1 then 'product_categories' else 'product-categories:'||s end,
      case when w=1 then 'knowledge_articles' else 'knowledge_articles:'||s end,case when w=1 then 'document_prefixes' else 'document_prefixes:'||s end]);
 elsif t='public.notes' then return 'coalesce(r.representative_warehouse_id,r.standalone_warehouse_id,1)='||s;
 elsif t='private.operation_ledger' then
   -- Ledger rows with no identifiable shop are server-wide replay protection and stay on the server.
   return format('(select array_agg(distinct v #>> ''{}'') from unnest(array[''$.**.warehouseId'',''$.**.warehouse_id'',''$.**.fromWarehouseId'',''$.**.toWarehouseId'']::jsonpath[]) path,
     lateral jsonb_path_query(r.result,path) v where jsonb_typeof(v) in (''number'',''string''))=array[%L]',s);
 elsif t='private.price_label_requests' then
   return format('jsonb_array_length(r.labels)>0 and not exists(select 1 from jsonb_array_elements(r.labels) l where not exists(select 1 from %s p where p.id=(l->>''pid'')::bigint and coalesce(p.warehouse_id,1)=%s))',private.shop_backup_relation('public.products',staged),s);
 elsif t='public.sale_items' then parent:='public.sales';lhs:='sale_id';cond:=format('coalesce(p.data->>''warehouseId'',''1'')=%L',s);
 elsif t='public.inventory_count_adjustment_lines' then parent:='public.inventory_count_adjustments';lhs:='adjustment_id';cond:='p.warehouse_id='||s;
 elsif t in ('public.representative_activity_items','private.note_positions') then parent:='public.notes';lhs:='note_id';cond:='coalesce(p.representative_warehouse_id,p.standalone_warehouse_id,1)='||s;
 elsif t='public.sales_representative_products' then parent:='public.sales_representatives';lhs:='representative_id';cond:='p.warehouse_id='||s;
 elsif t in ('public.product_unit_changes','public.favorites','public.combined_catalog_unit_preferences') then parent:='public.products';lhs:='product_id';cond:='coalesce(p.warehouse_id,1)='||s;
 else raise exception 'Unknown store scope for %',t;
 end if;
 return format('exists(select 1 from %s p where p.%I=r.%I and %s)',private.shop_backup_relation(parent,staged),rhs,lhs,cond);
end $$;
create function private.shop_backup_rows(t text,w bigint,staged boolean default false) returns jsonb
language plpgsql stable set search_path='' as $$
declare rows jsonb;
begin
 execute format('select coalesce(jsonb_agg(j order by j::text),''[]''::jsonb) from
  (select private.backup_canonical_json(to_jsonb(r)) j from %s r where %s) src',
  private.shop_backup_relation(t,staged),private.shop_backup_where(t,w,staged)) into rows;
 return rows;
end $$;
create function public.export_store_backup(p_warehouse_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t text; rows jsonb; tables jsonb:='{}'; manifest jsonb:='{}'; shop text;
begin
 if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required'; end if;
 select name into strict shop from public.warehouses where id=p_warehouse_id;
 foreach t in array private.shop_backup_tables()||private.shop_backup_history() loop
   rows:=private.shop_backup_rows(t,p_warehouse_id);
   tables:=tables||jsonb_build_object(t,rows);
   manifest:=manifest||jsonb_build_object(t,jsonb_build_object('rows',jsonb_array_length(rows),'md5',md5(rows::text)));
 end loop;
 return jsonb_build_object('format','pepos-pharmacy-store-backup','version',4,'warehouseId',p_warehouse_id,'warehouseName',shop,
  'createdAt',statement_timestamp(),'data',jsonb_build_object('tables',tables),'manifest',manifest);
end $$;
revoke all on function private.shop_backup_tables(),private.shop_backup_history(),private.shop_backup_relation(text,boolean),
  private.shop_backup_where(text,bigint,boolean),private.shop_backup_rows(text,bigint,boolean) from public,anon,authenticated;
revoke all on function public.export_store_backup(bigint) from public,anon;
grant execute on function public.export_store_backup(bigint) to authenticated;
create function private.shop_other_fingerprints(w bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare s bigint; t text; hashes jsonb:='{}';
begin
 for s in select id from public.warehouses where id<>w loop
  foreach t in array private.shop_backup_tables()||private.shop_backup_history() loop
   hashes:=hashes||jsonb_build_object(s||':'||t,md5(private.shop_backup_rows(t,s)::text));
  end loop;
 end loop;
 return hashes;
end $$;
create function private.lock_shop_backup_tables() returns void language plpgsql set search_path='' as $$
declare tables text;
begin
 perform pg_advisory_xact_lock(hashtextextended('pepos-atomic-store-restore',0));
 select string_agg(t,',' order by t) into tables from unnest(private.shop_backup_tables()||private.shop_backup_history()||array['public.warehouses']) t;
 execute 'lock table '||tables||' in share row exclusive mode';
end $$;
create function private.shop_insert_rows(t text,rows jsonb,merging boolean) returns void language plpgsql set search_path='' as $$
declare cols text; col text; seq text; highest bigint;
begin
 if rows='[]'::jsonb then return;end if;
 select string_agg(quote_ident(attname),',' order by attnum) into cols from pg_attribute
 where attrelid=t::regclass and attnum>0 and not attisdropped and attgenerated='';
 execute format('insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s,$1) %s',
  t::regclass,cols,cols,t::regclass,case when merging then 'on conflict do nothing' else '' end) using rows;
 for col in select attname from pg_attribute where attrelid=t::regclass and attnum>0 and not attisdropped and (attidentity<>'' or atthasdef) loop
  seq:=pg_get_serial_sequence(t,col);
  if seq is not null then
   execute format('select max(%I) from %s',col,t::regclass) into highest;
   if highest>coalesce(pg_sequence_last_value(seq::regclass),0) then perform setval(seq::regclass,highest,true);end if;
  end if;
 end loop;
end $$;
create function public."restore_store_backup_atomic"(p_warehouse_id bigint,p_backup jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='150s' as $$
declare t text; r jsonb; expected jsonb:='{}'; manifest jsonb; raw jsonb:=p_backup#>'{data,tables}';
 tabs text[]:=private.shop_backup_tables(); history text[]:=private.shop_backup_history(); n integer; v int;
 others jsonb; fk record; invalid boolean; actual jsonb; counts jsonb:='{}'; epoch text:=gen_random_uuid()::text;
begin
 if auth.uid() is null or not private.is_current_owner() then raise exception 'owner access required';end if;
 if p_warehouse_id is null or not exists(select 1 from public.warehouses where id=p_warehouse_id) then raise exception 'ไม่พบคลังปลายทาง';end if;
 v:=(p_backup->>'version')::int;
 if p_backup->>'format' is distinct from 'pepos-pharmacy-store-backup' or jsonb_typeof(raw) is distinct from 'object'
   or v is null or v not in (3,4) or pg_column_size(p_backup)>104857600 then raise exception 'ไฟล์สำรองไม่ถูกต้อง';end if;
 if (v=3 and p_warehouse_id<>1) or (v=4 and (p_backup->>'warehouseId')::bigint is distinct from p_warehouse_id) then raise exception 'ไฟล์สำรองเป็นของคนละคลัง';end if;
 if v=4 and exists(select 1 from jsonb_object_keys(raw) k where not k=any(tabs||history)) then raise exception 'ไฟล์มีตารางที่รุ่นนี้ไม่รองรับ';end if;
 if v=3 and not exists(select 1 from jsonb_array_elements(raw->'public.warehouses') w where w->>'id'='1') then raise exception 'ไม่พบคลังเดิมในไฟล์สำรอง';end if;
 -- Validate even the legacy file before projecting its shop-1 rows. Database-wide identities/access
 -- are never imported. Temporary tables resolve the shop of each child from its archived parent.
 foreach t in array tabs||history loop
   r:=raw->t;
   if v=3 and r is null and t in ('private.internal_barcode_history','private.note_positions','public.combined_catalog_unit_preferences','private.price_label_requests') then r:='[]';
   else
    manifest:=p_backup->'manifest'->t;
    if jsonb_typeof(r) is distinct from 'array' or manifest->>'md5' is distinct from md5(r::text)
      or (manifest->>'rows')::int is distinct from jsonb_array_length(r) then raise exception 'incomplete or changed backup table: %',t;end if;
   end if;
   if exists(select 1 from jsonb_array_elements(r) j, lateral jsonb_object_keys(j) k where not exists(select 1 from pg_attribute where attrelid=t::regclass and attnum>0 and not attisdropped and attname=k)) then raise exception 'backup schema differs: %',t;end if;
   execute format('create temporary table %I on commit drop as select * from jsonb_populate_recordset(null::%s,$1)',
    'shop_backup_'||replace(t,'.','_'),t::regclass) using r;
 end loop;
 if v=3 then
   -- Exports made before store isolation have no warehouse column on contacts or reps.
   update pg_temp.shop_backup_public_contacts set warehouse_id=1 where warehouse_id is null;
   update pg_temp.shop_backup_public_sales_representatives set warehouse_id=1 where warehouse_id is null;
   update pg_temp.shop_backup_public_notes n set representative_warehouse_id=coalesce(
     (select r.warehouse_id from pg_temp.shop_backup_public_sales_representatives r where r.id=n.representative_id),1)
   where representative_warehouse_id is null and (representative_id is not null or activity_type is not null);
 end if;
 foreach t in array tabs||history loop
   r:=private.shop_backup_rows(t,p_warehouse_id,true);
   if v=4 and jsonb_array_length(r)<>jsonb_array_length(raw->t) then raise exception 'ไฟล์มีข้อมูลที่ไม่ได้อยู่ในคลังนี้: %',t;end if;
   -- New standalone notes have explicit ownership. A v3 backup may predate this column.
   if t='public.notes' then
    select coalesce(jsonb_agg(case when j->>'representative_warehouse_id' is null and j->>'representative_id' is null and j->>'activity_type' is null and j->>'standalone_warehouse_id' is null
       then jsonb_set(j,'{standalone_warehouse_id}','1') else j end),'[]') into r from jsonb_array_elements(r) j;
    select coalesce(jsonb_agg(j order by j::text),'[]') into r from jsonb_array_elements(r) j;
   end if;
   expected:=expected||jsonb_build_object(t,r);
   counts:=counts||jsonb_build_object(t,jsonb_array_length(r));
   -- Every foreign key into a store-owned parent must refer to the same archived shop.
   for fk in select c.confrelid::regclass::oid rel, a.attname child,b.attname parent
     from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
     join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[1]
     where c.contype='f' and c.conrelid=t::regclass and cardinality(c.conkey)=1 loop
     declare parent_table text;begin
     select x into parent_table from unnest(tabs) x where x::regclass::oid=fk.rel;
     if parent_table is not null then
       execute format('select exists(select 1 from jsonb_array_elements($1) j where j->>%L is not null and not exists(select 1 from %s r where r.%I::text=j->>%L and (%s)))',
         fk.child,private.shop_backup_relation(parent_table,true),fk.parent,fk.child,private.shop_backup_where(parent_table,p_warehouse_id,true)) into invalid using r;
       if invalid then raise exception 'รายการอ้างอิงสินค้าหรือเอกสารข้ามร้าน: %',t;end if;
     end if;end;
   end loop;
 end loop;
 perform private.lock_shop_backup_tables();
 others:=private.shop_other_fingerprints(p_warehouse_id);
 perform set_config('pepos.maintenance_reset','on',true);
 for n in reverse cardinality(tabs)..1 loop
   t:=tabs[n];execute format('delete from %s r where %s',t::regclass,private.shop_backup_where(t,p_warehouse_id));
 end loop;
 update public.settings set value=(select coalesce(jsonb_agg(j order by pos),'[]') from jsonb_array_elements(value) with ordinality a(j,pos)
   where coalesce(j->>'warehouseId','1')<>p_warehouse_id::text)
 where key='inspection_lists' and jsonb_typeof(value)='array';
 perform private.shop_insert_rows('private.internal_barcode_history',expected->'private.internal_barcode_history',true);
 foreach t in array tabs||history loop
   if t='public.inventory_balances' then delete from public.inventory_balances where warehouse_id=p_warehouse_id;end if;
   if t<>'private.internal_barcode_history' then perform private.shop_insert_rows(t,expected->t,t=any(history));end if;
 end loop;
 foreach t in array tabs||history loop
   actual:=private.shop_backup_rows(t,p_warehouse_id);
   if (case when t=any(history) then not(actual @> (expected->t)) else actual is distinct from (expected->t) end) then
    raise exception 'restore verification mismatch: %',t;end if;
 end loop;
 if others<>private.shop_other_fingerprints(p_warehouse_id) then raise exception 'ข้อมูลร้านอื่นเปลี่ยน ยกเลิกการกู้คืนทั้งหมด';end if;
 foreach t in array tabs||history loop execute format('drop table %s',private.shop_backup_relation(t,true));end loop;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,warehouse_id,summary)
 values(auth.uid(),'store_reset','store_restore',p_warehouse_id::text,p_warehouse_id,'กู้คืนข้อมูลเฉพาะร้าน');
 insert into public.settings(key,value) values('shop_maintenance:'||p_warehouse_id,jsonb_build_object('epoch',epoch))
 on conflict(key) do update set value=excluded.value,updated_at=clock_timestamp();
 return jsonb_build_object('ok',true,'verified',true,'warehouseId',p_warehouse_id,'counts',counts,'epoch',epoch);
end $$;
revoke all on function private.shop_other_fingerprints(bigint),private.lock_shop_backup_tables(),private.shop_insert_rows(text,jsonb,boolean) from public,anon,authenticated;
revoke all on function public."restore_store_backup_atomic"(bigint,jsonb) from public,anon;
grant execute on function public."restore_store_backup_atomic"(bigint,jsonb) to authenticated;
-- Direct calls from a stale browser must never fall back to an all-store restore.
revoke execute on function public.export_store_backup(),public."restore_store_backup_atomic"(jsonb),public.export_store_inventory_backup(),public.restore_store_inventory_backup(jsonb,jsonb) from public,anon,authenticated;
create function public.admin_reset_shop_documents(p_actor_id uuid,p_warehouse_id bigint,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='120s' as $$
declare tabs text[]:=private.shop_backup_tables(); t text; n integer; others jsonb; counts jsonb:='{}'; affected bigint;
begin
 if p_confirmation is distinct from 'CONFIRM_DOCUMENT_RESET' or not exists(select 1 from public.profiles where id=p_actor_id and owner and level=1)
 or not exists(select 1 from public.warehouses where id=p_warehouse_id) then raise exception 'owner and warehouse confirmation required';end if;
 perform private.lock_shop_backup_tables();
 others:=private.shop_other_fingerprints(p_warehouse_id);
 perform set_config('pepos.maintenance_reset','on',true);
 for n in reverse cardinality(tabs)..1 loop
  t:=tabs[n];
  if t in ('public.products','public.contacts','public.sales_representatives','public.promotions','public.settings','public.notes',
   'public.representative_activity_items','public.sales_representative_products','public.favorites','private.note_positions','public.combined_catalog_unit_preferences',
   'public.profile_warehouse_access','public.profile_page_permissions') then continue;end if;
  execute format('delete from %s r where %s',t::regclass,private.shop_backup_where(t,p_warehouse_id));
  get diagnostics affected=row_count;counts:=counts||jsonb_build_object(t,affected);
 end loop;
 update public.products set stock=0,data=jsonb_set(coalesce(data,'{}'),'{expiry}','""') where coalesce(warehouse_id,1)=p_warehouse_id;
 update public.settings set value=(select coalesce(jsonb_agg(j order by pos),'[]') from jsonb_array_elements(value) with ordinality a(j,pos)
   where coalesce(j->>'warehouseId','1')<>p_warehouse_id::text)
 where key='inspection_lists' and jsonb_typeof(value)='array';
 if others<>private.shop_other_fingerprints(p_warehouse_id) then raise exception 'ข้อมูลร้านอื่นเปลี่ยน ยกเลิกการล้างทั้งหมด';end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,warehouse_id,summary)
 values(p_actor_id,'delete','store_reset',p_warehouse_id::text,p_warehouse_id,'ล้างเอกสารและสต๊อกเฉพาะร้าน');
 insert into public.settings(key,value) values('shop_maintenance:'||p_warehouse_id,jsonb_build_object('epoch',gen_random_uuid()))
 on conflict(key) do update set value=excluded.value,updated_at=clock_timestamp();
 return jsonb_build_object('ok',true,'warehouseId',p_warehouse_id,'counts',counts);
end $$;
revoke all on function public.admin_reset_shop_documents(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.admin_reset_shop_documents(uuid,bigint,text) to service_role;
create or replace function public.admin_reset_store_data(p_mode text,p_actor_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_mode is distinct from 'factory' or p_confirmation is distinct from 'CONFIRM_FACTORY_RESET_ALL' then
   raise exception 'กรุณาโหลดโปรแกรมใหม่ เลือกร้านเพื่อล้างเอกสาร หรือเลือกคลังรวมเพื่อคืนค่าโรงงาน';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('pepos-atomic-store-restore',0));
 if not exists(select 1 from public.profiles where id=p_actor_id and owner and level=1) then raise exception 'owner access required';end if;
 perform set_config('pepos.maintenance_reset','on',true);
 -- Store-owned notes now reference their warehouse directly. Remove the children
 -- before the existing factory procedure removes warehouses and accounts.
 delete from public.notes where true;
 return public.admin_reset_store_data_core_20260831(p_mode,p_actor_id,'CONFIRM_FACTORY_RESET');
end $$;
notify pgrst,'reload schema';
