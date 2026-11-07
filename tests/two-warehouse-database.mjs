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
      await q("insert into public.contacts(id,warehouse_id,type,name,phone,data) values($1,$1,'both','Same member','0807777777',$2)",[s.id,{code:'SHOP-01'}]);
      await q("select public.owner_set_setting($1,$2)",['business-warehouse:'+s.id,{name:s.name,vat:s.name==='B'?'จดภาษีมูลค่าเพิ่มแล้ว':'ยังไม่จดภาษีมูลค่าเพิ่ม'}]);
      await q("insert into public.products(id,warehouse_id,name,unit,price,cost,data) values($1,$1,'Decolgen','box',$2,$3,$4)",[s.id,s.price,s.cost,{barcode:'001234',extraBarcodes:['P00000123456'],vat:'incl',active:true}]);
      await q("insert into public.inventory_lots(product_id,warehouse_id,internal_code,quantity_base,unit_cost_base) values($1,$1,$2,10,$3)",[s.id,s.name,s.cost]);
      await q("insert into public.sales_representatives(id,warehouse_id,name) values($1,$1,'Same representative')",[s.id]);
      await q("select public.save_representative_products($1,$2)",[s.id,JSON.stringify([s.id])]);
      await q("select public.save_representative_note(null,null,'Store note','', $1,current_date,'[]')",[s.id]);
      const reps=await q('select representative_id from public.get_representative_page(p_warehouse_id=>$1)',[s.id]);
      assert.deepEqual(reps.rows.map(r=>Number(r.representative_id)),[s.id]);
      await q('update public.inventory_balances set stock=10 where warehouse_id=$1',[s.id]);
      await q('select public.open_cash_shift($1,500)',[s.id]);
      assert.equal(Number((await q('select product_id from public.find_product_barcode_owners($1,$2)',[['001234'],s.id])).rows[0].product_id),s.id);
    }
    async function sell(s,pid,memberId=s.id){
      const sale={customerId:String(memberId),total:s.price,discount:0,fee:0,vat:s.name==='B'?7.85:0,costTotal:s.cost,cashReceived:s.price,cashChange:0,payMethod:'เงินสด',businessSnapshot:{name:'wrong'}};
      const lines=[{productId:pid,lineKey:'1',qty:1,unit:'box',price:s.price,lineTotal:s.price,lineTotalGross:s.price}];
      return (await q("select public.complete_sale($1,'STORE',$2,$3,$4,null) result",[randomUUID(),s.id,sale,JSON.stringify(lines)])).rows[0].result.sale;
    }
    const first=await sell(shops[0],8510);
    assert.equal(first.businessSnapshot.name,'A');assert.equal(Number(first.total),100);
    assert.equal(Number((await q('select stock from public.inventory_balances where product_id=8520')).rows[0].stock),10);
    const balances=async(store)=>(await q("select public.get_customer_loyalty(array['8510','8520'],$1) as members",[store])).rows[0].members.map(r=>[r.customerId,r.balance]);
    assert.deepEqual(await balances(8510),[['8510',1]]);
    assert.deepEqual(await balances(8520),[['8520',0]]);
    await q('savepoint wrong_member');await assert.rejects(sell(shops[1],8520,8510),/LOYALTY_CUSTOMER_NOT_FOUND/);await q('rollback to wrong_member');
    const second=await sell(shops[1],8520);
    assert.deepEqual(await balances(8520),[['8520',1]]);
    assert.deepEqual(await balances(8510),[['8510',1]]);
    await q('savepoint duplicate_member');await assert.rejects(q("insert into public.contacts(id,warehouse_id,type,name,phone,data) values(8599,8510,'customer','Duplicate','080-777-7777','{}')"),/contacts_customer_phone_unique/);await q('rollback to duplicate_member');
    await q("select public.void_sale($1,'Store-only refund')",[first.id]);
    assert.deepEqual(await balances(8510),[['8510',0]]);
    assert.deepEqual(await balances(8520),[['8520',1]]);
    const cycle=first.loyalty.periodStart;
    const redemption={customerId:'8510',total:999,costTotal:1000,discount:1,fee:0,vat:0,cashReceived:999,cashChange:0,payMethod:'เงินสด',loyaltyRedeemed:1,loyaltyPeriodStart:cycle};
    const custom=[{lineKey:'1',custom:true,name:'Test',qty:1,unit:'item',price:1000,lineTotal:1000,lineTotalGross:1000}];
    await q('savepoint cross_shop_points');
    await assert.rejects(q("select public.complete_sale($1,'STORE',8510,$2,$3,null)",[randomUUID(),redemption,JSON.stringify(custom)]),/LOYALTY_INSUFFICIENT_POINTS/);
    await q('rollback to cross_shop_points');
    assert.equal(second.businessSnapshot.name,'B');assert.equal(Number(second.vat),7.85);assert.equal(Number(first.vat),0);
    await q('savepoint wrong_store');await assert.rejects(sell(shops[0],8520),/unavailable/);await q('rollback to wrong_store');
    await q("select public.owner_set_setting('business-warehouse:8510',$1)",[{name:'Changed'}]);
    assert.equal((await q("select data->'businessSnapshot'->>'name' name from public.sales where id=$1",[first.id])).rows[0].name,'A');
    await q('insert into public.profile_warehouse_access(user_id,warehouse_id) values($1,8510)',[staff]);
    await q('savepoint wrong_assignment');
    await assert.rejects(q("select public.save_representative_products(8510,'[8520]')"),/สินค้าและผู้แทน/);
    await q('rollback to wrong_assignment');
    await q('set local role authenticated');
    await q("insert into public.combined_catalog_unit_preferences values($1,8510,'Box')",[owner]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[staff]);await q('set local role authenticated');
    assert.equal((await q('select * from public.combined_catalog_unit_preferences')).rowCount,0);
    await q('savepoint foreign_preference');
    await assert.rejects(q("insert into public.combined_catalog_unit_preferences values($1,8520,'Box')",[owner]),/row-level security/);
    await q('rollback to foreign_preference');
    assert.deepEqual((await q('select id from public.sales_representatives where id in (8510,8520)')).rows.map(r=>Number(r.id)),[8510]);
    assert.equal((await q('select * from public.notes where representative_id=8520')).rowCount,0);
    assert.equal((await q('select * from public.sales_representative_products where representative_id=8520')).rowCount,0);
    await q('savepoint unauthorized_note');
    await assert.rejects(q("select public.save_representative_note(null,null,'Blocked','',8520,current_date,'[]')"),/store access denied/);
    await q('rollback to unauthorized_note');
    assert.deepEqual((await q('select id from public.products where id in (8510,8520)')).rows.map(r=>Number(r.id)),[8510]);
    assert.deepEqual((await q('select id from public.contacts where id in (8510,8520)')).rows.map(r=>Number(r.id)),[8510]);
    assert.equal((await q("select key from public.settings where key='business-warehouse:8520' ")).rowCount,0);
    console.log('Two stores: independent barcodes, prices, costs, stock, receipt snapshots and staff visibility verified');
  }finally{await q('rollback');}
}
