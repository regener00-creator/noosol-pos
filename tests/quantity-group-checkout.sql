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
  grp:=jsonb_build_object('id',gid,'name','LEVEL 1','customerPrices',jsonb_build_array(jsonb_build_object('productId',pid,'price',195,'unit','box')));
  perform public.save_store_price_group(1,null,grp);
  begin
    perform public.save_store_price_group(1,grp,jsonb_set(grp,'{customerPrices,0,tiers}','[{"minQty":12,"price":195}]'));
    raise exception 'quantity step equal to starting group price accepted';
  exception when others then
    if sqlerrm not like 'ราคาขั้นบันไดต้องต่ำกว่าราคาตั้งต้นของกลุ่ม%' then raise; end if;
  end;
  insert into public.contacts(id,name,type,phone,warehouse_id,data) values(cid,'Group buyer','customer','0887009901',1,jsonb_build_object('priceGroupId',gid));
  sale:=jsonb_build_object('total',195,'discount',0,'fee',0,'vat',0,'costTotal',10,'cashReceived',195,'cashChange',0,'payMethod','เงินสด','customerId',cid);
  item:=jsonb_build_object('lineKey','1','productId',pid,'name','Decolgen test','qty',1,'unit','box','price',195,'lineTotal',195,'lineTotalGross',195,'priceSource','group');
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
  update public.products set cost=211 where id=pid;
  begin
    perform public.complete_sale(gen_random_uuid(),'TEST',1,sale,jsonb_build_array(item,item||'{"lineKey":"2","qty":7,"lineTotal":1470,"lineTotalGross":1470}'),null);
    raise exception 'below-cost tier accepted';
  exception when others then if sqlerrm not like 'ราคาขั้นบันไดต่ำกว่าทุน%' then raise; end if; end;
  update public.products set cost=10 where id=pid;
  declare old_group jsonb:=grp; begin
  grp:=jsonb_set(grp,'{customerPrices,0,price}','215');
  grp:=jsonb_set(grp,'{customerPrices,0,tiers}','[{"minQty":12,"price":209},{"minQty":24,"price":195}]');
  perform public.save_store_price_group(1,old_group,grp);
  end;
  declare second_group jsonb:=grp||jsonb_build_object('id',gen_random_uuid()::text,'name','LEVEL 2'); begin
    perform public.save_store_price_group(1,null,second_group);
    perform public.save_store_price_group(1,second_group,
      jsonb_set(jsonb_set(second_group,'{customerPrices,0,price}','230'),'{customerPrices,0,tiers}','[{"minQty":12,"price":225}]'));
    update public.products set price=175 where id=pid;
    update public.products set price=220 where id=pid;
  end;
  update public.contacts set data=data||jsonb_build_object('customerPrices',jsonb_build_array(
    jsonb_build_object('id','step','productId',pid,'unit','box','price',null,'tiers','[{"minQty":24,"price":220}]'::jsonb))) where id=cid;
  begin
    update public.contacts set data=jsonb_set(data,'{customerPrices,0,tiers}',
      '[{"minQty":12,"price":205},{"minQty":24,"price":207}]') where id=cid;
    raise exception 'increasing steps within a personal price list accepted';
  exception when others then
    if sqlerrm not like 'จำนวนขั้นต่ำต้องไม่ซ้ำและราคาขั้นถัดไปต้องต่ำลง%' then raise; end if;
  end;
  update public.contacts set data=data||jsonb_build_object('customerPrices',jsonb_build_array(
    jsonb_build_object('id','step','productId',pid,'unit','box','price',null,'tiers','[{"minQty":12,"price":208}]'::jsonb))) where id=cid;
  sale:=sale||jsonb_build_object('customerId',cid,'total',2496,'cashReceived',2496,'costTotal',120);
  item:=item||'{"qty":12,"price":208,"lineTotal":2496,"lineTotalGross":2496,"tierScope":"customer","tierMinQty":12}';
  result:=public.complete_sale(gen_random_uuid(),'TEST',1,sale,jsonb_build_array(item),null);
  assert result#>>'{sale,items,0,tierScope}'='customer';
  begin
    perform public.complete_sale(gen_random_uuid(),'TEST',1,sale,jsonb_build_array(item||'{"tierScope":"group"}'),null);
    raise exception 'wrong scope accepted';
  exception when others then if sqlerrm not like 'ราคากลุ่มหรือราคาขั้นบันได%' then raise; end if; end;
  item:=item||'{"qty":24,"price":200,"lineTotal":4800,"lineTotalGross":4800,"tierScope":"general","tierMinQty":24}';
  sale:=sale||'{"total":4800,"cashReceived":4800,"costTotal":240}';
  result:=public.complete_sale(gen_random_uuid(),'TEST',1,sale-'customerId',jsonb_build_array(item),null);
  assert result#>>'{sale,items,0,tierScope}'='general';
  update public.products set data=data-'priceTiers' where id=pid;
  item:=item||'{"price":195,"lineTotal":4680,"lineTotalGross":4680,"tierScope":"group"}';
  sale:=sale||'{"total":4680,"cashReceived":4680}';
  result:=public.complete_sale(gen_random_uuid(),'TEST',1,sale,jsonb_build_array(item),null);
  assert result#>>'{sale,items,0,tierScope}'='group';
  begin
    update public.contacts set data=jsonb_set(data,'{customerPrices,0,tiers,0,price}','5') where id=cid;
    raise exception 'below cost personal step accepted';
  exception when others then if sqlerrm not like 'ตรวจจำนวนซื้อขั้นต่ำ%' then raise; end if; end;
  perform public.save_store_price_group(1,grp,grp #- '{customerPrices,0,price}');
  begin
    perform public.save_store_price_group(1,grp,jsonb_build_object('id',gid,'remove',true));
    raise exception 'stale delete accepted';
  exception when others then if sqlerrm not like 'กลุ่มราคานี้ถูกแก้ไขแล้ว%' then raise; end if; end;
  grp:=grp #- '{customerPrices,0,price}';
  begin
    perform public.save_store_price_group(1,grp,jsonb_build_object('id',gid,'remove',true));
    raise exception 'fixed level deleted';
  exception when others then if sqlerrm not like 'เลือกได้เฉพาะ%' then raise; end if; end;
  update public.contacts set data=data||jsonb_build_object('customerPrices',jsonb_build_array(
    jsonb_build_object('id','agreed','productId',pid,'unit','box','price',0))) where id=cid;
  item:=item||'{"qty":1,"price":0,"priceSource":"customer","customerPriceRuleId":"agreed","lineTotal":0,"lineTotalGross":0}';
  sale:=sale||jsonb_build_object('customerId',cid,'total',0,'cashReceived',0,'costTotal',10);
  result:=public.complete_sale(gen_random_uuid(),'TEST',1,sale,jsonb_build_array(item),null);
  assert (result#>>'{sale,items,0,price}')::numeric=0;
  result:=public.save_store_price_group(1,grp,jsonb_set(grp,'{customerPrices}','[]'));
  assert exists(select from jsonb_array_elements(result) g where g->>'id'=gid and g->'customerPrices'='[]'::jsonb);
  assert (select data->>'priceGroupId' from public.contacts where id=cid)=gid;
end $$;
rollback;
