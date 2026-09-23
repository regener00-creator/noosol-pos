-- Customer returns are signed, immutable sales documents. Keeping them in the
-- existing sales ledger preserves warehouse RLS, backups, audit and reports.
-- The source bill is locked and carries only cumulative return metadata; its
-- original prices, items and payment remain unchanged.
create or replace function private.process_customer_return(p_request_id uuid,p_args jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_source public.sales%rowtype;
  v_source_data jsonb; v_quantities jsonb; v_log jsonb;
  v_request jsonb; v_item jsonb; v_allocation jsonb; v_items jsonb:='[]';
  v_allocations jsonb; v_return jsonb; v_replacement jsonb; v_result jsonb;
  v_lot public.inventory_lots%rowtype;
  v_index integer; v_qty numeric; v_sold numeric; v_old numeric; v_factor numeric;
  v_gross numeric; v_subtotal numeric; v_before numeric; v_net numeric; v_refund numeric:=0;
  v_cost numeric; v_cost_total numeric:=0; v_vat numeric:=0; v_line_vat numeric;
  v_take numeric; v_skip numeric; v_need numeric; v_base numeric; v_conversion numeric; v_change record;
  v_product bigint; v_warehouse bigint; v_shift uuid; v_stock boolean; v_restock boolean;
  v_kind text:=p_args->>'kind'; v_reason text:=btrim(coalesce(p_args->>'reason',''));
  v_method text:=p_args->>'payMethod'; v_now timestamptz:=clock_timestamp();
  v_id text:='RET-'||replace(p_request_id::text,'-',''); v_ref text;
  v_replacement_id uuid; v_replacement_sale jsonb; v_replacement_items jsonb;
  v_registered boolean; v_total_old_gross numeric:=0; v_total_new_gross numeric:=0;
  v_points jsonb; v_old_fraction numeric; v_new_fraction numeric;
  v_old_state text:=coalesce(current_setting('pepos.sale_state_write',true),'');
begin
  if auth.uid() is null or not private.is_current_owner() then raise exception 'เฉพาะเจ้าของร้านเท่านั้นที่คืนหรือเปลี่ยนสินค้าได้'; end if;
  perform private.acquire_store_mutation_gate();
  if v_kind is null or v_kind not in ('return','exchange') or length(v_reason) not between 1 and 500
     or v_method is null or v_method not in ('เงินสด','โอนธนาคาร','บัตรเครดิต','ออนไลน์') then raise exception 'กรุณาระบุประเภท เหตุผล และวิธีรับหรือคืนเงินให้ครบ'; end if;
  if jsonb_typeof(p_args->'returns') is distinct from 'array' or jsonb_array_length(p_args->'returns') not between 1 and 500 then raise exception 'กรุณาเลือกสินค้าที่รับคืน'; end if;
  if exists(select 1 from jsonb_array_elements(p_args->'returns') r where coalesce(r->>'itemIndex','') !~ '^[0-9]{1,6}$'
      or not private.is_safe_nonnegative_decimal(r->>'qty') or coalesce(r->>'restock','') not in ('true','false')) then raise exception 'ข้อมูลสินค้ารับคืนไม่ถูกต้อง'; end if;
  if exists(select 1 from jsonb_array_elements(p_args->'returns') r group by r->>'itemIndex' having count(*)>1) then raise exception 'มีรายการคืนซ้ำ'; end if;
  select * into v_source from public.sales where id=p_args->>'saleId' for update;
  if not found or v_source.status<>'done' or coalesce((v_source.data->>'customerReturn')::boolean,false) then raise exception 'ไม่พบบิลขายที่รับคืนได้'; end if;
  if nullif(v_source.data->>'fullTaxInvoice','') is not null then raise exception 'บิลนี้มีใบกำกับภาษีเต็มรูปแบบ ต้องจัดการเอกสารภาษีก่อนรับคืน'; end if;
  v_source_data:=v_source.data;
  v_warehouse:=(v_source_data->>'warehouseId')::bigint;
  if v_warehouse is distinct from (p_args->>'warehouseId')::bigint then raise exception 'กรุณาเลือกคลังเดียวกับบิลเดิม'; end if;
  select id into v_shift from public.cash_shifts where warehouse_id=v_warehouse and opened_by=auth.uid() and status='open';
  if v_shift is null then raise exception 'กรุณาเปิดระบบชำระก่อนคืนหรือเปลี่ยนสินค้า'; end if;
  v_quantities:=coalesce(v_source_data->'customerReturnQuantities','{}');
  v_log:=coalesce(v_source_data->'customerReturnLog','[]');
  v_registered:=coalesce((v_source_data->>'vatRegistered')::boolean,false);
  v_replacement_items:=coalesce(p_args#>'{replacement,items}','[]');
  if jsonb_typeof(v_replacement_items) is distinct from 'array' then raise exception 'ข้อมูลสินค้าใหม่ไม่ถูกต้อง'; end if;
  if (v_kind='return' and jsonb_array_length(v_replacement_items)>0) or (v_kind='exchange' and jsonb_array_length(v_replacement_items)=0) then raise exception 'กรุณาเลือกสินค้าใหม่สำหรับการเปลี่ยน'; end if;
  perform private.acquire_inventory_product_locks(array(
    select distinct (x->>'productId')::bigint from (
      select value x from jsonb_array_elements(v_source_data->'items')
      union all select value from jsonb_array_elements(v_replacement_items)
    ) a where coalesce(x->>'productId','') ~ '^[1-9][0-9]{0,17}$' order by 1));
  select coalesce(sum(coalesce((x->>'lineTotalGross')::numeric,(x->>'lineTotal')::numeric,(x->>'price')::numeric*(x->>'qty')::numeric)),0)
    into v_subtotal from jsonb_array_elements(v_source_data->'items') x;
  -- Aggregate prior returns before changing the quantity map (points ledger).
  for v_item,v_index in select value,ordinality::integer-1 from jsonb_array_elements(v_source_data->'items') with ordinality loop
    v_sold:=(v_item->>'qty')::numeric;
    v_gross:=coalesce((v_item->>'lineTotalGross')::numeric,(v_item->>'lineTotal')::numeric,(v_item->>'price')::numeric*v_sold);
    if v_sold>0 then v_total_old_gross:=v_total_old_gross+v_gross*coalesce((v_quantities->>v_index::text)::numeric,0)/v_sold; end if;
  end loop;
  v_total_new_gross:=v_total_old_gross;
  for v_request in select value from jsonb_array_elements(p_args->'returns') order by (value->>'itemIndex')::integer loop
    v_index:=(v_request->>'itemIndex')::integer;
    v_item:=v_source_data->'items'->v_index;
    v_qty:=(v_request->>'qty')::numeric; v_sold:=(v_item->>'qty')::numeric;
    v_old:=coalesce((v_quantities->>v_index::text)::numeric,0);
    if v_item is null or v_qty<=0 or v_qty<>round(v_qty,6) or v_sold<=0 or v_old+v_qty>v_sold then raise exception 'จำนวนคืนเกินจำนวนที่ซื้อหรือเคยคืนแล้ว กรุณาเปิดบิลใหม่'; end if;
    v_restock:=(v_request->>'restock')::boolean;
    v_factor:=coalesce((v_item->>'factor')::numeric,1);
    v_product:=nullif(v_item->>'productId','')::bigint;
    v_stock:=v_product is not null and not coalesce((v_item->>'custom')::boolean,false) and coalesce((v_item->>'tracksStock')::boolean,true);
    v_gross:=coalesce((v_item->>'lineTotalGross')::numeric,(v_item->>'lineTotal')::numeric,(v_item->>'price')::numeric*v_sold);
    select coalesce(sum(coalesce((x->>'lineTotalGross')::numeric,(x->>'lineTotal')::numeric,(x->>'price')::numeric*(x->>'qty')::numeric)),0)
      into v_before from jsonb_array_elements(v_source_data->'items') with ordinality a(x,n) where n<=v_index;
    v_net:=case when v_subtotal>0 then greatest(0,v_subtotal-coalesce((v_source_data->>'discount')::numeric,0))/v_subtotal else 0 end;
    v_net:=round((v_before+v_gross)*v_net,2)-round(v_before*v_net,2);
    -- Cumulative cent rounding prevents repeated partial refunds exceeding the
    -- actual line entitlement. Fees are not refunded as merchandise.
    v_net:=round(v_net*(v_old+v_qty)/v_sold,2)-round(v_net*v_old/v_sold,2);
    v_line_vat:=case when v_registered and coalesce(v_item->>'vatMode','incl')<>'none' then v_net-v_net/1.07 else 0 end;
    v_cost:=case when v_restock then coalesce((v_item->>'costTotal')::numeric,(v_item->>'cost')::numeric*v_sold,0)*v_qty/v_sold else 0 end;
    v_refund:=v_refund+v_net; v_vat:=v_vat+v_line_vat; v_cost_total:=v_cost_total+v_cost;
    v_total_new_gross:=v_total_new_gross+v_gross*v_qty/v_sold;
    v_allocations:='[]';
    if v_stock and v_restock then
      if v_factor<=0 or jsonb_array_length(coalesce(v_item->'lotAllocations','[]'))=0 then raise exception 'บิลเดิมไม่มีข้อมูล LOT เพียงพอสำหรับรับคืนเข้าสต๊อก'; end if;
      v_conversion:=1;
      for v_change in select conversion_factor from public.product_unit_changes where product_id=v_product and created_at>coalesce(v_source.sale_time,v_source.created_at) order by created_at,id loop
        v_conversion:=v_conversion*v_change.conversion_factor;
      end loop;
      v_skip:=v_old*v_factor*v_conversion; v_need:=v_qty*v_factor*v_conversion;
      for v_allocation in select value from jsonb_array_elements(v_item->'lotAllocations') loop
        v_base:=coalesce((v_allocation->>'baseQty')::numeric,0)*v_conversion;
        if v_base<=0 then raise exception 'ข้อมูล LOT ในบิลเดิมไม่ถูกต้อง'; end if;
        if v_skip>=v_base then v_skip:=v_skip-v_base; continue; end if;
        v_take:=least(v_need,v_base-v_skip); v_skip:=0;
        if v_take<=0 then exit; end if;
        select * into v_lot from public.inventory_lots where id=(v_allocation->>'lotId')::bigint for update;
        if not found or v_lot.product_id<>v_product or v_lot.warehouse_id<>v_warehouse then raise exception 'LOT เดิมไม่ตรงกับสินค้าและคลัง'; end if;
        if v_lot.source_type='sale_shortage' or coalesce((v_allocation->>'pendingLot')::boolean,false) then
          insert into public.inventory_lot_movements(lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,reference_type,reference_id,reference_line_key,note)
          values(v_lot.id,v_product,v_warehouse,'sale_shortage_void',v_take,0,'customer_return',v_id,v_index::text||':'||v_lot.id,v_reason);
        else
          if v_lot.status='blocked' then raise exception 'LOT เดิมถูกระงับ กรุณารับคืนแบบไม่นำกลับเข้าสต๊อกขาย'; end if;
          update public.inventory_lots set quantity_base=quantity_base+v_take,status='active',updated_at=now() where id=v_lot.id;
          insert into public.inventory_lot_movements(lot_id,product_id,warehouse_id,movement_type,quantity_delta,balance_after,reference_type,reference_id,reference_line_key,note)
          values(v_lot.id,v_product,v_warehouse,'customer_return',v_take,v_lot.quantity_base+v_take,'customer_return',v_id,v_index::text||':'||v_lot.id,v_reason);
        end if;
        v_allocations:=v_allocations||jsonb_build_array(v_allocation||jsonb_build_object('baseQty',v_take));
        v_need:=v_need-v_take;
      end loop;
      if abs(v_need)>0.000001 then raise exception 'จำนวน LOT ในบิลเดิมไม่เพียงพอสำหรับรับคืน'; end if;
      perform private.refresh_inventory_balance_from_lots(v_product,v_warehouse);
    end if;
    v_items:=v_items||jsonb_build_array(v_item||jsonb_build_object('qty',-v_qty,'costTotal',-v_cost,
      'lineTotal',-(v_net-v_line_vat*case when v_item->>'vatMode'='excl' then 1 else 0 end),'lineTotalGross',-v_net,
      'reportLineTotal',-coalesce((v_item->>'lineTotal')::numeric,(v_item->>'price')::numeric*v_sold)*v_qty/v_sold,
      'sourceItemIndex',v_index,'restock',v_restock,'lotAllocations',v_allocations));
    v_quantities:=jsonb_set(v_quantities,array[v_index::text],to_jsonb(v_old+v_qty),true);
  end loop;
  -- Validate the displayed quote so a price or concurrent-return change must
  -- be reviewed instead of silently collecting a different amount.
  if not private.is_safe_nonnegative_decimal(p_args->>'expectedRefund') or abs(v_refund-(p_args->>'expectedRefund')::numeric)>0.01 then raise exception 'ยอดคืนเปลี่ยน กรุณาเปิดรายการใหม่'; end if;
  v_ref:='RT'||to_char(v_now at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(substr(replace(p_request_id::text,'-',''),1,8));
  v_return:=jsonb_build_object('id',v_id,'ref',v_ref,'date',(v_now at time zone 'Asia/Bangkok')::date::text,
    'time',to_char(v_now at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI:SS'),'warehouseId',v_warehouse,
    'status','done','customerReturn',true,'returnKind',v_kind,'sourceSaleId',v_source.id,'sourceSaleRef',v_source.ref,
    'reason',v_reason,'payMethod',v_method,'items',v_items,'discount',0,'fee',0,'total',-v_refund,
    'vat',-round(v_vat,2),'vatRegistered',v_registered,'costTotal',-v_cost_total,'grossProfit',round(-v_refund+v_vat+v_cost_total,2),
    'cashReceived',0,'cashChange',0,'member',v_source_data->'member','customerId',v_source_data->'customerId',
    'customerName',v_source_data->'customerName','businessSnapshot',v_source_data->'businessSnapshot',
    'taxSummary',jsonb_build_object('registered',v_registered,'subtotal',-v_refund,'discount',0,'total',-v_refund,'beforeVat',-round(v_refund-v_vat,2),'vat',-round(v_vat,2)));
  select v_return||jsonb_build_object('cashier',coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),username)) into v_return from public.profiles where id=auth.uid();
  if v_source_data ? 'loyalty' and v_subtotal>0 then
    v_points:=v_source_data->'loyalty';
    perform 1 from public.contacts where id=(v_points->>'customerId')::bigint for update;
    v_old_fraction:=least(1,v_total_old_gross/v_subtotal); v_new_fraction:=least(1,v_total_new_gross/v_subtotal);
    v_return:=v_return||jsonb_build_object('loyalty',v_points||jsonb_build_object(
      'earned',-(floor((v_points->>'earned')::numeric*v_new_fraction)-floor((v_points->>'earned')::numeric*v_old_fraction)),
      'redeemed',-(floor((v_points->>'redeemed')::numeric*v_new_fraction)-floor((v_points->>'redeemed')::numeric*v_old_fraction)),
      'recordedAt',v_now));
  end if;
  insert into public.sales(id,ref,sale_date,sale_time,cashier,member,status,pay_method,discount,vat,fee,cost_total,gross_profit,cash_received,cash_change,total,data,created_by)
    values(v_id,v_ref,(v_now at time zone 'Asia/Bangkok')::date,v_now,v_return->>'cashier',v_source.member,'done',v_method,0,-round(v_vat,2),0,-v_cost_total,
      round(-v_refund+v_vat+v_cost_total,2),0,0,-v_refund,v_return,auth.uid());
  insert into public.sale_items(sale_id,product_id,warehouse_id,name,qty,price,cost,cost_total,unit,factor,custom)
    select v_id,nullif(x->>'productId','')::bigint,v_warehouse,x->>'name',(x->>'qty')::numeric,(x->>'price')::numeric,
      coalesce((x->>'cost')::numeric,0),(x->>'costTotal')::numeric,x->>'unit',coalesce((x->>'factor')::numeric,1),coalesce((x->>'custom')::boolean,false) from jsonb_array_elements(v_items) x;
  if v_kind='exchange' then
    v_replacement_id:=gen_random_uuid();
    v_replacement_sale:=coalesce(p_args#>'{replacement,sale}','{}')||jsonb_build_object('payMethod',v_method,'member',v_source_data->'member',
      'customerId',v_source_data->'customerId','customerName',v_source_data->'customerName','loyaltyRedeemed',0);
    -- Settlement uses the return as credit. Checkout records both legs in the
    -- same shift/method, making the net receipt/refund exactly the difference.
    v_replacement_sale:=v_replacement_sale||jsonb_build_object('cashReceived',case when v_method='เงินสด' then (v_replacement_sale->>'total')::numeric else 0 end,'cashChange',0);
    v_result:=public.complete_sale(v_replacement_id,'RE',v_warehouse,v_replacement_sale,v_replacement_items,null);
    v_replacement:=v_result->'sale';
    perform set_config('pepos.sale_state_write','on',true);
    update public.sales set data=data||jsonb_build_object('customerExchange',v_id,'sourceSaleId',v_source.id,'sourceSaleRef',v_source.ref)
      where id=v_replacement->>'id' returning data into v_replacement;
  end if;
  perform set_config('pepos.sale_state_write','on',true);
  update public.sales set data=data||jsonb_build_object('replacementSaleId',v_replacement->>'id',
    'replacementSaleRef',v_replacement->>'ref','settlement',round(coalesce((v_replacement->>'total')::numeric,0)-v_refund,2)) where id=v_id returning data into v_return;
  v_log:=v_log||jsonb_build_array(jsonb_build_object('id',v_id,'ref',v_ref,'kind',v_kind,'at',v_now,'reason',v_reason,'actor',v_return->>'cashier',
    'refund',v_refund,'replacementSaleId',v_replacement->>'id','replacementSaleRef',v_replacement->>'ref','settlement',v_return->'settlement','items',p_args->'returns'));
  update public.sales set data=data||jsonb_build_object('customerReturnQuantities',v_quantities,'customerReturnLog',v_log) where id=v_source.id returning data into v_source_data;
  perform set_config('pepos.sale_state_write',v_old_state,true);
  return jsonb_build_object('sale',v_source_data,'returnSale',v_return,'replacementSale',v_replacement);
end $$;
revoke all on function private.process_customer_return(uuid,jsonb) from public,anon,authenticated,service_role;

-- Extend the existing durable operation ledger; do not expose an alternate
-- non-idempotent write endpoint.
do $patch$
declare d text;
begin
  select pg_get_functiondef('public.run_stock_operation(uuid,text,jsonb)'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  if position('when ''void_sale'' then' in d)=0 then raise exception 'stock operation anchor missing'; end if;
  d:=replace(d,'''correct_sale_lot_allocation'',''void_sale'',''change_product_base_unit''','''correct_sale_lot_allocation'',''void_sale'',''customer_return'',''change_product_base_unit''');
  d:=replace(d,'when ''void_sale'' then',E'when ''customer_return'' then\n      v_result := private.process_customer_return(p_request_id,p_args);\n    when ''void_sale'' then');
  execute d;
end $patch$;

-- A completed return cannot be reversed by voiding its source or either leg
-- of an exchange. Further partial returns of the replacement remain allowed.
create or replace function private.guard_customer_return_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if current_setting('pepos.maintenance_reset',true)='on' then return new; end if;
  if jsonb_array_length(coalesce(old.data->'customerReturnLog','[]'))>0 and new.data->'items' is distinct from old.data->'items' then
    raise exception 'บิลนี้มีการคืนสินค้าแล้ว จึงไม่สามารถแก้ไขรายการหรือ LOT เดิมได้';
  end if;
  if (coalesce((old.data->>'customerReturn')::boolean,false) or jsonb_array_length(coalesce(old.data->'customerReturnLog','[]'))>0)
    and new.data->'fullTaxInvoice' is distinct from old.data->'fullTaxInvoice' then
    raise exception 'บิลรับคืนหรือบิลที่คืนสินค้าแล้วไม่สามารถออกใบกำกับภาษีจากขั้นตอนขายปกติได้';
  end if;
  if new.status='void' and old.status='done' and (coalesce((old.data->>'customerReturn')::boolean,false)
    or old.data ? 'customerExchange' or jsonb_array_length(coalesce(old.data->'customerReturnLog','[]'))>0) then
    raise exception 'บิลนี้เชื่อมกับการคืนหรือเปลี่ยนสินค้าแล้ว ไม่สามารถยกเลิกทั้งบิลได้';
  end if;
  return new;
end $$;
revoke all on function private.guard_customer_return_history() from public,anon,authenticated;
create trigger guard_customer_return_history before update on public.sales for each row execute function private.guard_customer_return_history();

-- Customer-only metadata cannot be injected through ordinary checkout.
do $patch$
declare d text; a text:='v_sale_data jsonb := coalesce(p_sale, ''{}''::jsonb);';
begin
  select pg_get_functiondef('public.complete_sale(uuid,text,bigint,jsonb,jsonb,text)'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  if position(a in d)=0 then raise exception 'checkout metadata anchor missing'; end if;
  execute replace(d,a,'v_sale_data jsonb := coalesce(p_sale, ''{}''::jsonb) - array[''customerReturn'',''returnKind'',''customerExchange'',''customerReturnQuantities'',''customerReturnLog'',''sourceSaleId'',''sourceSaleRef'',''replacementSaleId'',''settlement''];');
end $patch$;

-- Allow a negative return line for a product which was retired after sale.
do $patch$
declare d text;
begin
  select pg_get_functiondef('private.prevent_inactive_product_sale_item()'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  execute replace(d,E'begin\n',E'begin\n  if new.qty<0 and exists(select 1 from public.sales s where s.id=new.sale_id and s.data->>''customerReturn''=''true'') then return new; end if;\n');
end $patch$;

-- Existing closed shifts remain immutable. New closes classify negative sales
-- documents as refunds (including zero-price returns, for document counts).
do $patch$
declare d text; a text; b text;
begin
  select pg_get_functiondef('public.close_cash_shift_core_20260831(uuid,numeric,text)'::regprocedure) into d;
  d:=replace(d,E'\r\n',E'\n');
  a:='from public.sales s where s.cash_shift_id=p_shift_id;';
  b:='from public.sales s where s.cash_shift_id=p_shift_id and coalesce(s.data->>''customerReturn'',''false'')<>''true'';';
  if position(a in d)=0 then raise exception 'cash shift anchor missing'; end if;
  d:=replace(d,a,b);
  d:=replace(d,'from public.sales s where s.void_shift_id=p_shift_id;',
    'from (select total,pay_method from public.sales where void_shift_id=p_shift_id union all select -total,pay_method from public.sales where cash_shift_id=p_shift_id and data->>''customerReturn''=''true'') s;');
  d:=replace(d,'from public.sales s where s.cash_shift_id=p_shift_id' || E'\n',
    'from public.sales s where s.cash_shift_id=p_shift_id and coalesce(s.data->>''customerReturn'',''false'')<>''true''' || E'\n');
  d:=replace(d,'from public.sales s where s.void_shift_id=p_shift_id' || E'\n',
    'from public.sales s where s.void_shift_id=p_shift_id' || E'\n      union all\n      select coalesce(nullif(s.pay_method,'''') ,''ไม่ระบุ''),0::numeric,-s.total,0,1 from public.sales s where s.cash_shift_id=p_shift_id and s.data->>''customerReturn''=''true''\n');
  execute d;
end $patch$;
