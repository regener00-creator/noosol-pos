import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function run({client}){
  const q=(sql,args)=>client.query(sql,args);
  await q('begin');
  try{
    const owner=randomUUID(),staff=randomUUID();
    await q('insert into auth.users(id) values($1),($2)',[owner,staff]);
    await q("insert into public.profiles(id,username,owner,level) values($1,'void-owner',true,1),($2,'void-staff',false,2)",[owner,staff]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q(`insert into public.warehouses(id,name,data) values(8200,'Void test','{"active":true}');
      insert into public.products(id,name,sku,unit,price,cost,warehouse_id,data) values(8200,'Void product','VOID-A','box',100,40,8200,'{"active":true}');
      insert into public.inventory_lots(product_id,warehouse_id,internal_code,quantity_base,unit_cost_base) values(8200,8200,'VOID-A',100,40);
      update public.inventory_balances set stock=100 where warehouse_id=8200;
      select public.open_cash_shift(8200,1000);`);
    const makeSale=async(method,qty=1)=>(await q("select public.complete_sale($1,'TEST',8200,$2,$3,null) result",[randomUUID(),{total:100*qty,discount:0,fee:0,vat:0,costTotal:40*qty,cashReceived:method==='เงินสด'?100*qty:0,cashChange:0,payMethod:method},JSON.stringify([{productId:8200,lineKey:'1',qty,unit:'box',price:100,lineTotal:100*qty,lineTotalGross:100*qty}])])).rows[0].result.sale;
    const call=async(sale,refundMethod,id=randomUUID())=>(await q("select public.run_stock_operation($1,'void_sale',$2) result",[id,{saleId:sale.id,reason:'Test refund',refundMethod}])).rows[0].result;
    const stock=async()=>Number((await q('select stock from public.inventory_balances where product_id=8200 and warehouse_id=8200')).rows[0].stock);
    const transfer=await makeSale('โอนธนาคาร',2),cash=await makeSale('เงินสด');
    const request=randomUUID(),first=await call(transfer,'เงินสด',request);
    assert.equal(first.sale.voidRefundMethod,'เงินสด');assert.equal(first.sale.payMethod,'โอนธนาคาร');
    assert.equal(await stock(),99);
    assert.deepEqual(await call(transfer,'เงินสด',request),first);
    assert.equal((await call(transfer,'บัตรเครดิต')).sale.voidRefundMethod,'เงินสด','another request cannot change an already recorded refund');
    assert.equal(await stock(),99,'retry must not restore twice');
    await q('savepoint invalid_method');
    await assert.rejects(call(cash,'invalid'),/invalid refund method/);
    await q('rollback to savepoint invalid_method');assert.equal(await stock(),99);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
    await q('savepoint staff_denied');await assert.rejects(call(cash,'เงินสด'),/owner/);
    await q('rollback to savepoint staff_denied');
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await call(cash,'โอนธนาคาร');assert.equal(await stock(),100);
    const legacy=await makeSale('เงินสด');
    const old=(await q("select public.void_sale($1,'Legacy') result",[legacy.id])).rows[0].result;
    assert.equal(old.sale.voidRefundMethod,'เงินสด');assert.equal(await stock(),100);
    const shift=(await q("select id from public.cash_shifts where warehouse_id=8200 and status='open'")).rows[0].id;
    const closed=(await q('select public.close_cash_shift($1,900,null) result',[shift])).rows[0].result;
    assert.equal(closed.cash_sales,200);assert.equal(closed.cash_refunds,300);assert.equal(closed.expected_cash,900);
    assert.equal(closed.payment_summary['โอนธนาคาร'].refunds,100);
    assert.equal(closed.payment_summary['เงินสด'].refunds,300);
    // Refund an earlier shift's sale in a new shift, with a different channel.
    await q('select public.open_cash_shift(8200,1000)');
    const previous=await makeSale('โอนธนาคาร');
    const priorShift=(await q("select id from public.cash_shifts where warehouse_id=8200 and status='open'")).rows[0].id;
    await q('select public.close_cash_shift($1,1000,null)',[priorShift]);
    await q('select public.open_cash_shift(8200,1000)');await call(previous,'เงินสด');
    const nextShift=(await q("select id from public.cash_shifts where warehouse_id=8200 and status='open'")).rows[0].id;
    const next=(await q('select public.close_cash_shift($1,900,null) result',[nextShift])).rows[0].result;
    assert.equal(next.gross_sales,0);assert.equal(next.refunds,100);assert.equal(next.expected_cash,900);
    assert.equal((await q("select has_function_privilege('authenticated','private.void_sale_with_refund(text,text,text)','execute') allowed")).rows[0].allowed,false);
    console.log('DB: void refund channels, same/cross-shift cash totals, legacy callers, retries, permissions and rollback passed');
  }finally{await q('rollback');}
}
