import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function run({client}){
  const q=(sql,args)=>client.query(sql,args),owner=randomUUID(),request=randomUUID();
  await q('begin');
  try{
    await q('insert into auth.users(id) values($1)',[owner]);
    await q("insert into public.profiles(id,username,owner,level) values($1,'offline-owner',true,1)",[owner]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q(`insert into public.warehouses(id,name,data) values(8400,'Offline test','{"active":true}');
      insert into public.products(id,name,sku,unit,price,cost,warehouse_id,data)
      values(8400,'Offline medicine','OFF-8400','box',100,40,8400,'{"active":true}');
      insert into public.inventory_lots(product_id,warehouse_id,internal_code,quantity_base,unit_cost_base)
      values(8400,8400,'OFF-LOT',10,40);
      update public.inventory_balances set stock=10 where product_id=8400 and warehouse_id=8400;`);
    await q('set local role authenticated');
    await q('select public.open_cash_shift(8400,0)');
    const occurredAt=new Date(Date.now()-86400000).toISOString();
    const sale={offlineOccurredAt:occurredAt,total:100,discount:0,fee:0,vat:0,costTotal:40,cashReceived:100,cashChange:0,payMethod:'เงินสด'};
    const items=[{lineKey:'1',productId:8400,qty:1,unit:'box',factor:1,baseQty:1,price:100,regularPrice:100,priceSource:'standard',cost:40,costTotal:40,lineTotal:100,lineTotalGross:100,vatMode:'none'}];
    const post=async(id=request,payload=sale)=>(await q("select public.complete_sale($1,'RE',8400,$2,$3,null) result",[id,payload,JSON.stringify(items)])).rows[0].result;
    const first=await post();
    assert.equal(first.sale.offlineRef,`OFF-${request}`);
    assert.equal(new Date(first.sale.offlineOccurredAt).toISOString(),occurredAt);
    const row=(await q('select sale_time,sale_date::text from public.sales where checkout_request_id=$1',[request])).rows[0];
    assert.equal(row.sale_time.toISOString(),occurredAt);
    assert.equal(row.sale_date,new Date(occurredAt).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}));
    assert.equal((await post()).sale.id,first.sale.id);
    assert.equal(Number((await q('select stock from public.inventory_balances where warehouse_id=8400 and product_id=8400')).rows[0].stock),9);
    const reject=async(payload,pattern)=>{
      await q('savepoint invalid_sale');
      try{await assert.rejects(()=>post(randomUUID(),payload),pattern);}
      finally{await q('rollback to savepoint invalid_sale');}
    };
    await reject({...sale,offlineOccurredAt:new Date(Date.now()+86400000).toISOString()},/offline sale time/);
    await reject({...sale,offlineOccurredAt:'invalid'},/offline sale time/);
    await reject({...sale,offlineCashShiftId:randomUUID()},/offline cash shift was closed or changed/);
    await q('savepoint stale_price');
    try{
      await q('reset role');await q('update public.products set price=200 where id=8400');await q('set local role authenticated');
      await assert.rejects(()=>post(randomUUID()),/product price changed/);
    }finally{await q('rollback to savepoint stale_price');}
    console.log('Offline DB: original date/time, exact-once stock, stable offline reference, future-date rejection and price validation passed');
  }finally{await q('rollback');}
}
