-- Integration against the actual checkout routine. ALL fixtures, bills,
-- shifts, inventory and audit records are rolled back. Never remove ROLLBACK.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '25s';
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where owner=true limit 1),true);
do $$
declare
  v_warehouse bigint;
  v_product bigint := 8000000000000000 + floor(random()*100000000)::bigint;
  v_promotion bigint := 8000000000000000 + floor(random()*100000000)::bigint;
  v_quote_id text := 'TESTQUOTE-' || gen_random_uuid()::text;
  v_request uuid := gen_random_uuid();
  v_failed uuid;
  v_sale jsonb;
  v_item jsonb;
  v_quote jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_case jsonb;
  v_expected text;
begin
  select id into v_warehouse from public.warehouses order by id limit 1;
  if v_warehouse is null or auth.uid() is null then raise exception 'Need owner and warehouse for rollback test'; end if;
  if not exists(select 1 from public.cash_shifts where warehouse_id=v_warehouse and opened_by=auth.uid() and status='open') then
    perform public.open_cash_shift(v_warehouse,0);
  end if;
  insert into public.products(id,name,unit,price,cost,product_type,data)
    values(v_product,'Quotation rollback fixture','เม็ด',180,10,'stock',
      '{"active":true,"type":"stock","unit":"เม็ด","price":180,"cost":10,"vat":"none","units":[{"sub":"กล่อง","factor":10,"price":1800,"cost":100}]}');
  perform public.set_inventory_stock(v_product,v_warehouse,100);
  v_quote := jsonb_build_object('customer','Quotation test','customerInfo',jsonb_build_object('name','Quotation test'),
    'items',jsonb_build_array(jsonb_build_object('productId',v_product,'name','Quotation rollback fixture','unit','เม็ด','qty',2,'price',160)));
  insert into public.quotations(id,data) values(v_quote_id,v_quote);
  v_sale := jsonb_build_object('customerName','Quotation test','sourceQuotationId',v_quote_id,
    'total',320,'discount',0,'fee',0,'vat',0,'costTotal',20,'cashReceived',320,'cashChange',0,'payMethod','เงินสด');
  v_item := jsonb_build_object('lineKey','1','productId',v_product,'name','Quotation rollback fixture','qty',2,'unit','เม็ด',
    'price',160,'lineTotal',320,'lineTotalGross',320,'priceSource','quotation','sourceQuotationId',v_quote_id,'sourceQuotationLineIndex',0);

  -- Pure document creation and price verification must not reserve stock.
  assert private.resolve_quotation_price(v_sale,v_item,v_product,'เม็ด')=160,'Saved quote authorizes price';
  assert (select stock from public.inventory_balances where product_id=v_product and warehouse_id=v_warehouse)=100,'Quoting does not cut stock';
  v_result := public.complete_sale(v_request,'TESTQ',v_warehouse,v_sale,jsonb_build_array(v_item),null);
  assert (v_result->'sale'->>'total')::numeric=320,'Checkout uses quote price, not catalog price';
  assert (select stock from public.inventory_balances where product_id=v_product and warehouse_id=v_warehouse)=98,'Payment cuts stock once';
  assert v_result->'sale'->'items'->0->>'sourceQuotationLineIndex'='0','Stored sale keeps source line';

  -- Idempotency precedes current document validation: a retry returns the
  -- committed bill even if the quote changed after successful payment.
  update public.quotations set data=jsonb_set(data,'{items,0,price}','170') where id=v_quote_id;
  v_retry := public.complete_sale(v_request,'TESTQ',v_warehouse,v_sale,jsonb_build_array(v_item),null);
  assert (v_retry->>'alreadyCompleted')::boolean and v_retry->'sale'->>'id'=v_result->'sale'->>'id','Retry returns original bill';
  assert (select stock from public.inventory_balances where product_id=v_product and warehouse_id=v_warehouse)=98,'Retry does not cut stock twice';
  v_failed:=gen_random_uuid();
  begin
    perform public.complete_sale(v_failed,'TESTQ',v_warehouse,v_sale,jsonb_build_array(v_item),null);
    raise exception 'Changed quote unexpectedly accepted';
  exception when others then if sqlerrm not like 'quotation price changed%' then raise; end if; end;
  assert not exists(select 1 from public.sales where checkout_request_id=v_failed),'Rejected price leaves no bill';
  update public.quotations set data=v_quote where id=v_quote_id;

  begin
    perform private.resolve_quotation_price(v_sale,v_item,v_product+1,'เม็ด');
    raise exception 'Wrong product accepted';
  exception when others then if sqlerrm not like 'quotation product%' then raise; end if; end;
  begin
    perform private.resolve_quotation_price(v_sale,v_item,v_product,'กล่อง');
    raise exception 'Wrong unit accepted';
  exception when others then if sqlerrm not like 'quotation product%' then raise; end if; end;
  begin
    perform private.resolve_quotation_price(v_sale||'{"sourceQuotationId":"missing"}',v_item||'{"sourceQuotationId":"missing"}',v_product,'เม็ด');
    raise exception 'Missing document accepted';
  exception when others then if sqlerrm not like 'quotation is unavailable%' then raise; end if; end;

  for v_case in select value from jsonb_array_elements('[
    {"sale":{"sourceQuotationId":"missing"},"error":"quotation source"},
    {"sale":{"customerName":"wrong customer"},"error":"quotation customer"},
    {"item":{"price":1},"error":"quotation price changed"},
    {"item":{"sourceQuotationLineIndex":1},"error":"quotation product"},
    {"item":{"sourceQuotationLineIndex":-1},"error":"invalid quotation line"},
    {"item":{"custom":true,"productId":null},"error":"quotation requires"},
    {"item":{"priceSource":"standard"},"error":"product price changed"}
  ]') loop
    v_failed:=gen_random_uuid();v_expected:=v_case->>'error';
    begin
      perform public.complete_sale(v_failed,'TESTQ',v_warehouse,v_sale||coalesce(v_case->'sale','{}'),
        jsonb_build_array(v_item||coalesce(v_case->'item','{}')),null);
      raise exception 'Invalid case unexpectedly accepted: %',v_expected;
    exception when others then if sqlerrm not like v_expected||'%' then raise; end if; end;
    assert not exists(select 1 from public.sales where checkout_request_id=v_failed),'Rejected case leaves no bill';
  end loop;
  assert (select stock from public.inventory_balances where product_id=v_product and warehouse_id=v_warehouse)=98,'Rejected cases leave stock unchanged';
  insert into public.promotions(id,data) values(v_promotion,'{"active":true,"name":"Quotation rollback fixture"}');
  begin
    perform public.complete_sale(gen_random_uuid(),'TESTQ',v_warehouse,v_sale,
      jsonb_build_array(v_item||jsonb_build_object('promoId',v_promotion)),null);
    raise exception 'Quotation promotion stacking accepted';
  exception when others then if sqlerrm not like 'quotation price cannot be combined%' then raise; end if; end;

  -- Backwards compatibility and duplicate line disambiguation.
  assert private.resolve_quotation_price(v_sale,v_item-'sourceQuotationLineIndex',v_product,'เม็ด')=160,'Old held cart supported';
  update public.quotations set data=jsonb_set(data,'{items}',(data->'items')||jsonb_build_array((data->'items'->0)||'{"price":150}')) where id=v_quote_id;
  assert private.resolve_quotation_price(v_sale,v_item||'{"sourceQuotationLineIndex":1,"price":150}',v_product,'เม็ด')=150,'Duplicate product resolves its own line';
  begin
    perform private.resolve_quotation_price(v_sale,v_item-'sourceQuotationLineIndex',v_product,'เม็ด');
    raise exception 'Ambiguous legacy line accepted';
  exception when others then if sqlerrm not like 'quotation product%' then raise; end if; end;
  update public.quotations set data=jsonb_set(v_quote,'{items,0}',(v_quote->'items'->0)-'productId') where id=v_quote_id;
  assert private.resolve_quotation_price(v_sale,v_item,v_product,'เม็ด')=160,'Legacy name-only quote supported';

  -- Linked customer identity must match, not merely their display name.
  update public.quotations set data=jsonb_set(v_quote,'{customerInfo,id}','"123456"') where id=v_quote_id;
  assert private.resolve_quotation_price(v_sale||'{"customerId":"123456"}',v_item,v_product,'เม็ด')=160,'Matching customer ID';
  begin
    perform private.resolve_quotation_price(v_sale,v_item,v_product,'เม็ด');
    raise exception 'Missing customer ID accepted';
  exception when others then if sqlerrm not like 'quotation customer%' then raise; end if; end;

  -- Subunit quantities still use the catalog conversion factor.
  update public.quotations set data=jsonb_set(v_quote,'{items,0}',(v_quote->'items'->0)||'{"unit":"กล่อง","price":1500}') where id=v_quote_id;
  perform public.complete_sale(gen_random_uuid(),'TESTQ',v_warehouse,
    v_sale||'{"total":3000,"cashReceived":3000,"costTotal":200}',
    jsonb_build_array(v_item||'{"unit":"กล่อง","price":1500,"lineTotal":3000,"lineTotalGross":3000}'),null);
  assert (select stock from public.inventory_balances where product_id=v_product and warehouse_id=v_warehouse)=78,'Two boxes deduct twenty base units';

  -- Explicit zero quote is legitimate; standard zero-price bypass remains blocked.
  update public.quotations set data=jsonb_set(v_quote,'{items,0,price}','0') where id=v_quote_id;
  perform public.complete_sale(gen_random_uuid(),'TESTQ',v_warehouse,v_sale||'{"total":0,"cashReceived":0}',
    jsonb_build_array(v_item||'{"price":0,"lineTotal":0,"lineTotalGross":0}'),null);
  assert (select stock from public.inventory_balances where product_id=v_product and warehouse_id=v_warehouse)=76,'Zero quote still cuts stock';
  begin
    perform public.complete_sale(gen_random_uuid(),'TESTQ',v_warehouse,v_sale||'{"total":0,"cashReceived":0}',
      jsonb_build_array(v_item||'{"priceSource":"standard","price":0,"lineTotal":0,"lineTotalGross":0}'),null);
    raise exception 'Unapproved zero price accepted';
  exception when others then if sqlerrm not like 'invalid free promotion line%' then raise; end if; end;

  -- Ordinary catalog checkout is unchanged.
  perform public.complete_sale(gen_random_uuid(),'TESTQ',v_warehouse,v_sale||'{"total":360,"cashReceived":360}',
    jsonb_build_array(v_item||'{"priceSource":"standard","price":180,"lineTotal":360,"lineTotalGross":360}'),null);
  assert (select stock from public.inventory_balances where product_id=v_product and warehouse_id=v_warehouse)=74,'Catalog checkout unchanged';
  assert not has_function_privilege('anon','private.resolve_quotation_price(jsonb,jsonb,bigint,text)','EXECUTE'),'Anonymous cannot call helper';
  assert not has_function_privilege('authenticated','private.resolve_quotation_price(jsonb,jsonb,bigint,text)','EXECUTE'),'Authenticated cannot call helper directly';
end $$;
select 'Quotation pricing, validation, unit conversion, stock and idempotency passed; all fixtures rolled back' as result;
rollback;
