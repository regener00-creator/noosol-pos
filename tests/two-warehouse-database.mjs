import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function run({client}){
  const q=(sql,params)=>client.query(sql,params);
  await q('begin');
  try{
    const owner=randomUUID(), staff=randomUUID();
    await q('insert into auth.users(id) values($1),($2)',[owner,staff]);
    await q("insert into public.profiles(id,username,owner,level) values($1,'twoshop-owner',true,1),($2,'twoshop-staff',false,2)",[owner,staff]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q("insert into public.warehouses(id,name) values(8510,'A'),(8520,'B')");
    const shops=[{id:8510,price:100,cost:75,name:'A'},{id:8520,price:120,cost:81,name:'B'}];
    for(const s of shops){
      await q("select public.owner_set_setting($1,$2)",['business-warehouse:'+s.id,{name:s.name,vat:s.name==='B'?'จดภาษีมูลค่าเพิ่มแล้ว':'ยังไม่จดภาษีมูลค่าเพิ่ม'}]);
      await q("insert into public.products(id,warehouse_id,name,unit,price,cost,data) values($1,$1,'Decolgen','box',$2,$3,$4)",[s.id,s.price,s.cost,{barcode:'001234',extraBarcodes:['P00000123456'],vat:'incl',active:true}]);
      await q("insert into public.inventory_lots(product_id,warehouse_id,internal_code,quantity_base,unit_cost_base) values($1,$1,$2,10,$3)",[s.id,s.name,s.cost]);
      await q('update public.inventory_balances set stock=10 where warehouse_id=$1',[s.id]);
      await q('select public.open_cash_shift($1,500)',[s.id]);
      assert.equal(Number((await q('select product_id from public.find_product_barcode_owners($1,$2)',[['001234'],s.id])).rows[0].product_id),s.id);
    }
    async function sell(s,pid){
      const sale={total:s.price,discount:0,fee:0,vat:s.name==='B'?7.85:0,costTotal:s.cost,cashReceived:s.price,cashChange:0,payMethod:'เงินสด',businessSnapshot:{name:'wrong'}};
      const lines=[{productId:pid,lineKey:'1',qty:1,unit:'box',price:s.price,lineTotal:s.price,lineTotalGross:s.price}];
      return (await q("select public.complete_sale($1,'STORE',$2,$3,$4,null) result",[randomUUID(),s.id,sale,JSON.stringify(lines)])).rows[0].result.sale;
    }
    const first=await sell(shops[0],8510);
    assert.equal(first.businessSnapshot.name,'A');assert.equal(Number(first.total),100);
    assert.equal(Number((await q('select stock from public.inventory_balances where product_id=8520')).rows[0].stock),10);
    const second=await sell(shops[1],8520);
    assert.equal(second.businessSnapshot.name,'B');assert.equal(Number(second.vat),7.85);assert.equal(Number(first.vat),0);
    await q('savepoint wrong_store');await assert.rejects(sell(shops[0],8520),/unavailable/);await q('rollback to wrong_store');
    await q("select public.owner_set_setting('business-warehouse:8510',$1)",[{name:'Changed'}]);
    assert.equal((await q("select data->'businessSnapshot'->>'name' name from public.sales where id=$1",[first.id])).rows[0].name,'A');
    await q('insert into public.profile_warehouse_access(user_id,warehouse_id) values($1,8510)',[staff]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[staff]);await q('set local role authenticated');
    assert.deepEqual((await q('select id from public.products where id in (8510,8520)')).rows.map(r=>Number(r.id)),[8510]);
    assert.equal((await q("select key from public.settings where key='business-warehouse:8520' ")).rowCount,0);
    console.log('Two stores: independent barcodes, prices, costs, stock, receipt snapshots and staff visibility verified');
  }finally{await q('rollback');}
}
