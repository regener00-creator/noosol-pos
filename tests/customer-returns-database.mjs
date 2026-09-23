import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function run({client}){
  const q=(sql,args)=>client.query(sql,args);
  await q('begin');
  const owner=randomUUID(),staff=randomUUID();
  try{
    await q(`insert into auth.users(id) values($1),($2);`,[owner,staff]);
    await q(`insert into public.profiles(id,username,owner,level) values($1,'return-owner',true,1),($2,'return-staff',false,2)`,[owner,staff]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q(`insert into public.warehouses(id,name,data) values(8100,'Returns test','{"active":true}');
      insert into public.products(id,name,sku,unit,price,cost,warehouse_id,data) values
      (8100,'Original','RET-A','box',100,40,8100,'{"active":true}'),
      (8101,'Replacement','RET-B','box',150,50,8100,'{"active":true}');
      insert into public.inventory_lots(product_id,warehouse_id,internal_code,quantity_base,unit_cost_base) values
      (8100,8100,'RETURN-A',100,40),(8101,8100,'RETURN-B',100,50);
      update public.inventory_balances set stock=100 where warehouse_id=8100;
      select public.open_cash_shift(8100,1000);`);
    const makeSale=async(qty=3,discount=0)=>{
      const item={productId:8100,lineKey:'1',qty,unit:'box',price:100,lineTotal:100*qty,lineTotalGross:100*qty};
      const total=100*qty-discount;
      return (await q('select public.complete_sale($1,\'TEST\',8100,$2,$3,null) result',[randomUUID(),{total,discount,fee:0,vat:0,costTotal:40*qty,cashReceived:total,cashChange:0,payMethod:'เงินสด'},JSON.stringify([item])])).rows[0].result.sale;
    };
    const args=(sale,qty,refund,extra={})=>({saleId:sale.id,warehouseId:8100,kind:'return',reason:'Customer request',payMethod:'เงินสด',returns:[{itemIndex:0,qty,restock:true}],expectedRefund:refund,...extra});
    const call=async(a,id=randomUUID())=>(await q('select public.run_stock_operation($1,\'customer_return\',$2) result',[id,a])).rows[0].result;
    const rejected=async(a,pattern)=>{
      await q('savepoint rejected_return');
      await assert.rejects(call(a),pattern);
      await q('rollback to savepoint rejected_return');
    };
    const stock=async(id=8100)=>Number((await q('select stock from public.inventory_balances where product_id=$1 and warehouse_id=8100',[id])).rows[0].stock);
    const sale=await makeSale(3,30);assert.equal(await stock(),97);
    const id=randomUUID();const first=await call(args(sale,1,90),id);
    assert.equal(first.returnSale.total,-90);assert.equal(first.returnSale.costTotal,-40);assert.equal(await stock(),98);
    assert.deepEqual(await call(args(sale,1,90),id),first,'retry returns same document');assert.equal(await stock(),98);
    await rejected(args(sale,3,270),/จำนวนคืนเกิน/);
    const replacement={items:[{productId:8101,lineKey:'1',qty:1,unit:'box',price:150,lineTotal:150,lineTotalGross:150}],sale:{total:150,discount:0,fee:0,vat:0,costTotal:50,cashReceived:0,cashChange:0}};
    const exchange=await call(args(sale,1,90,{kind:'exchange',replacement}));
    assert.equal(exchange.returnSale.settlement,60);assert.equal(exchange.replacementSale.total,150);
    assert.equal(await stock(),99);assert.equal(await stock(8101),99);
    const damaged=await call(args(sale,1,90,{returns:[{itemIndex:0,qty:1,restock:false}]}));
    assert.equal(damaged.returnSale.costTotal,0);assert.equal(await stock(),99);
    await rejected(args(sale,1,90),/จำนวนคืนเกิน/);
    await rejected(args(exchange.returnSale,1,90),/ไม่พบบิล/);
    const before=await stock();
    const badSale=await makeSale(1);const afterSale=await stock();
    await rejected(args(badSale,1,100,{kind:'exchange',replacement:{...replacement,sale:{...replacement.sale,total:1}}}),/totals changed/);
    assert.equal(await stock(),afterSale,'failed replacement rolls back return');assert.equal(afterSale,before-1);
    await q('savepoint void_guard');
    await assert.rejects(q('select public.void_sale($1,\'test\')',[sale.id]),/คืนหรือเปลี่ยน/);
    await q('rollback to savepoint void_guard');
    await q("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
    await rejected(args(badSale,1,100),/เฉพาะเจ้าของ/);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    const equalSale=await makeSale(1);
    const equal=await call(args(equalSale,1,100,{kind:'exchange',replacement:{items:[{productId:8100,lineKey:'1',qty:1,unit:'box',price:100,lineTotal:100,lineTotalGross:100}],sale:{total:100,discount:0,fee:0,vat:0,costTotal:40}}}));
    assert.equal(equal.returnSale.settlement,0);
    const cheaper=await call(args(exchange.replacementSale,1,150,{kind:'exchange',replacement:{items:[{productId:8100,lineKey:'1',qty:1,unit:'box',price:100,lineTotal:100,lineTotalGross:100}],sale:{total:100,discount:0,fee:0,vat:0,costTotal:40}}}));
    assert.equal(cheaper.returnSale.settlement,-50);
    // A bill-wide discount of two cents on three one-cent lines must refund
    // exactly one cent overall, regardless of which line is returned first.
    const pennyItems=[1,2,3].map(n=>({lineKey:String(n),custom:true,name:'Penny '+n,unit:'item',qty:1,price:.01,lineTotal:.01,lineTotalGross:.01}));
    const penny=(await q('select public.complete_sale($1,\'TEST\',8100,$2,$3,null) result',[randomUUID(),{total:.01,discount:.02,fee:0,vat:0,costTotal:.03,cashReceived:.01,cashChange:0,payMethod:'เงินสด'},JSON.stringify(pennyItems)])).rows[0].result.sale;
    const pennyReturn=await call(args(penny,1,.01,{returns:[0,1,2].map(itemIndex=>({itemIndex,qty:1,restock:false}))}));
    assert.equal(pennyReturn.returnSale.total,-.01);
    await q(`insert into public.settings(key,value) values('business','{"vat":"จดภาษีมูลค่าเพิ่มแล้ว"}') on conflict(key) do update set value=excluded.value`);
    const vat=(await q('select public.complete_sale($1,\'TEST\',8100,$2,$3,null) result',[randomUUID(),{total:107,discount:0,fee:0,vat:7,costTotal:107,cashReceived:107,cashChange:0,payMethod:'เงินสด'},JSON.stringify([{lineKey:'1',custom:true,name:'VAT',unit:'item',qty:1,price:107,lineTotal:107,lineTotalGross:107}])])).rows[0].result.sale;
    const vatReturn=await call(args(vat,1,107,{returns:[{itemIndex:0,qty:1,restock:false}]}));
    assert.equal(vatReturn.returnSale.vat,-7);assert.equal(vatReturn.returnSale.taxSummary.beforeVat,-100);
    await q(`delete from public.settings where key='business'`);
    assert.equal((await q("select has_function_privilege('authenticated','private.process_customer_return(uuid,jsonb)','execute') allowed")).rows[0].allowed,false);
    const shift=(await q('select id from public.cash_shifts where warehouse_id=8100 and status=\'open\'')).rows[0].id;
    const totals=(await q(`select sum(case when data->>'customerReturn'='true' then -total else 0 end)::float refunds,
      sum(case when coalesce(data->>'customerReturn','false')<>'true' then total else 0 end)::float gross,
      1000+sum(total)::float expected from public.sales where cash_shift_id=$1`,[shift])).rows[0];
    const closed=(await q('select public.close_cash_shift($1,$2,null) result',[shift,totals.expected])).rows[0].result;
    assert.equal(closed.refunds,totals.refunds);assert.equal(closed.gross_sales,totals.gross);assert.equal(closed.expected_cash,totals.expected);
    assert.equal(closed.payment_summary['เงินสด'].refunds,totals.refunds);
    console.log('DB: customer partial return, damaged goods, equal/higher/lower exchanges, retries, over-return, permissions, atomic rollback and shift settlement passed');
  }finally{await q('rollback');}
}
