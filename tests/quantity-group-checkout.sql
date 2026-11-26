begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where owner limit 1),true);
do $$
declare
  pid bigint:=850000000000001;
  cid bigint:=850000000000002;
  gid text:=gen_random_uuid()::text;
  grp jsonb;
  sale jsonb;
  item jsonb;
  result jsonb;
begin
  if not exists(select 1 from public.cash_shifts where opened_by=auth.uid() and status='open' and warehouse_id=1) then
    perform public.open_cash_shift(1,0);
  end if;
  insert into public.products(id,name,unit,price,cost,warehouse_id,data) values(pid,'Decolgen test','box',220,10,1,
    '{"active":true,"vat":"none","priceTiers":[{"unit":"box","minQty":12,"price":210},{"unit":"box","minQty":24,"price":200}]}');
  perform public.set_inventory_stock(pid,1,100);
  grp:=jsonb_build_object('id',gid,'name','Test group','customerPrices',jsonb_build_array(jsonb_build_object('productId',pid,'price',215,'unit','box')));
  perform public.save_store_price_group(1,null,grp);
  insert into public.contacts(id,name,type,phone,warehouse_id,data) values(cid,'Group buyer','customer','0887009901',1,jsonb_build_object('priceGroupId',gid));
  sale:=jsonb_build_object('total',215,'discount',0,'fee',0,'vat',0,'costTotal',10,'cashReceived',215,'cashChange',0,'payMethod','เงินสด','customerId',cid);
  item:=jsonb_build_object('lineKey','1','productId',pid,'name','Decolgen test','qty',1,'unit','box','price',215,'lineTotal',215,'lineTotalGross',215,'priceSource','group');
  result:=public.complete_sale(gen_random_uuid(),'TEST',1,sale,jsonb_build_array(item),null);
  assert result#>>'{sale,items,0,priceSource}'='group';
  begin
    perform public.complete_sale(gen_random_uuid(),'TEST',1,sale,jsonb_build_array(item||'{"priceSource":"tier"}'),null);
    raise exception 'tier below threshold accepted';
  exception when others then if sqlerrm not like 'ราคากลุ่มหรือราคาขั้นบันได%' then raise; end if; end;
  item:=item||'{"qty":6,"priceSource":"tier","price":210,"lineTotal":1260,"lineTotalGross":1260}';
  sale:=(sale-'customerId')||'{"total":2730,"cashReceived":2730,"costTotal":130}';
  result:=public.complete_sale(gen_random_uuid(),'TEST',1,sale,jsonb_build_array(item,item||'{"lineKey":"2","qty":7,"lineTotal":1470,"lineTotalGross":1470}'),null);
  assert result#>>'{sale,items,1,priceSource}'='tier';
  assert (result#>>'{sale,total}')::numeric=2730;
  assert (result#>>'{sale,items,0,price}')::numeric=210;
  update public.contacts set data=data||jsonb_build_object('customerPrices',jsonb_build_array(
    jsonb_build_object('id','agreed','productId',pid,'unit','box','price',0))) where id=cid;
  item:=item||'{"qty":1,"price":0,"priceSource":"customer","customerPriceRuleId":"agreed","lineTotal":0,"lineTotalGross":0}';
  sale:=sale||jsonb_build_object('customerId',cid,'total',0,'cashReceived',0,'costTotal',10);
  result:=public.complete_sale(gen_random_uuid(),'TEST',1,sale,jsonb_build_array(item),null);
  assert (result#>>'{sale,items,0,price}')::numeric=0;
end $$;
rollback;
