import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// Run last on the disposable test cluster. Both checkout connections need committed fixtures.
export async function runConcurrentSales({client,connect}){
  const {id:owner}=(await client.query('select id from public.profiles where owner order by id limit 1')).rows[0];
  const stores=[{id:92301,price:70,cost:30,qty:1},{id:92302,price:100,cost:40,qty:2}];
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  for(const s of stores){
    await client.query('insert into public.warehouses(id,name) values($1,$2)',[s.id,'Store '+s.id]);
    await client.query("insert into public.products(id,warehouse_id,name,unit,price,cost,data) values($1,$1,'Decolgen','box',$2,$3,$4)",[s.id,s.price,s.cost,{barcode:'CONCURRENT-001',active:true,vat:'none'}]);
    await client.query("insert into public.inventory_lots(product_id,warehouse_id,internal_code,manufacturer_lot,quantity_base,unit_cost_base) values($1,$1,$3,'LOT-SAME',10,$2)",[s.id,s.cost,'PARALLEL-'+s.id]);
    await client.query('update public.inventory_balances set stock=10 where product_id=$1',[s.id]);
  }
  const registers=await Promise.all(stores.map(()=>connect()));
  try{
    await Promise.all(registers.map(async(c,i)=>{
      await c.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
      await c.query("set role authenticated");
      await c.query('select public.open_cash_shift($1,500)',[stores[i].id]);
    }));
    const requests=stores.map(()=>randomUUID());
    const checkout=async(c,i)=>{
      const {id,qty,price,cost}=stores[i],total=qty*price;
      const sale={total,costTotal:qty*cost,discount:0,fee:0,vat:0,cashReceived:total,cashChange:0,payMethod:'เงินสด'};
      const lines=[{productId:id,lineKey:'1',qty,unit:'box',price,lineTotal:total,lineTotalGross:total}];
      return (await c.query("select public.complete_sale($1,'POS',$2,$3,$4,null) result",[requests[i],id,sale,JSON.stringify(lines)])).rows[0].result.sale;
    };
    const receipts=await Promise.all(registers.map(checkout));
    const repeats=await Promise.all(registers.map(checkout));
    for(const [i,s] of stores.entries()){
      assert.equal(receipts[i].id,repeats[i].id);
      assert.equal(Number(receipts[i].total),s.price*s.qty);
      const balance=await client.query('select stock from public.inventory_balances where warehouse_id=$1 and product_id=$1',[s.id]);
      assert.equal(Number(balance.rows[0].stock),10-s.qty);
    }
    assert.notEqual(receipts[0].id,receipts[1].id);
    console.log('Two simultaneous store checkouts: different prices and quantities, separate balances, retry without duplicate bills passed');
  }finally{await Promise.all(registers.map(c=>c.end()));}
}
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
      await q("insert into public.favorites(user_id,product_id,position) values($1,$2,0)",[owner,s.id]);
      await q("insert into public.promotions(id,data) values($1,$2)",[s.id,{warehouseId:s.id}]);
      await q("select public.save_representative_products($1,$2)",[s.id,JSON.stringify([s.id])]);
      await q("select public.save_representative_note(null,null,'Store note','', $1,current_date,'[]')",[s.id]);
      const reps=await q('select representative_id from public.get_representative_page(p_warehouse_id=>$1)',[s.id]);
      assert.deepEqual(reps.rows.map(r=>Number(r.representative_id)),[s.id]);
      await q('update public.inventory_balances set stock=10 where warehouse_id=$1',[s.id]);
      await q("select public.owner_set_setting($1,$2)",['document_prefixes:'+s.id,{sale:s.name+'RE',cashShift:s.name+'CS'}]);
      await q('select public.open_cash_shift($1,500)',[s.id]);
      assert.ok((await q('select shift_no from public.cash_shifts where warehouse_id=$1',[s.id])).rows[0].shift_no.startsWith('W'+s.id+'-'+s.name+'CS'));
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
    assert.ok(first.ref.startsWith('W8510-ARE'));assert.ok(second.ref.startsWith('W8520-BRE'));
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
    // The same operator can access both stores, but a receipt lookup must match the selected one.
    for(const [shop,own,foreign] of [[shops[0],first,second],[shops[1],second,first]]){
      assert.equal((await q('select id from public.find_store_sale($1,$2)',[shop.id,own.ref])).rows[0].id,own.id);
      assert.equal((await q('select id from public.find_store_sale($1,$2)',[shop.id,foreign.ref])).rowCount,0);
      await q('select public.update_store_label_settings($1,$2,null)',[shop.id,{medicineLabelDoseUnits:[shop.name]}]);
      await q('select public.update_store_label_settings($1,$2,$3)',[shop.id,{promotionLabelTemplates:{title:shop.name}},'a4-poster']);
      await q('select public.owner_set_setting($1,$2)',['business-warehouse:'+shop.id,{name:shop.name}]);
    }
    await q("insert into public.warehouses(id,name) values(1,'Primary') on conflict do nothing");
    await q("insert into public.settings(key,value) values('business',$1) on conflict(key) do update set value=excluded.value",[{name:'legacy-primary',medicineLabelDoseUnits:['primary']}]);
    await q('select public.update_store_label_settings(1,$1,null)',[{medicineLabelWarningPresets:['primary-warning']}]);
    assert.equal((await q("select value->>'name' as name from public.settings where key='business'")).rows[0].name,'legacy-primary');
    const event=async shop=>(await q("select public.report_client_event('store-device','error','sync','test',null,null,null,'same error',$1) id",[{warehouseId:shop}])).rows[0].id;
    const eventA=await event(8510),eventB=await event(8520);
    assert.notEqual(eventA,eventB);
    assert.equal(await event(8520),eventB);
    await q("select public.resolve_store_sync_events(8510,'store-device',clock_timestamp())");
    assert.equal((await q('select status from public.sync_events where id=$1',[eventB])).rows[0].status,'open');
    assert.equal((await q('select public.owner_resolve_store_sync_event(8510,$1) ok',[eventB])).rows[0].ok,false);
    await verifyOwnerTools(q,owner,shops);
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
    assert.equal((await q("select key from public.settings where key='business'")).rowCount,0);
    assert.equal((await q('select * from public.sync_events where id=$1',[eventB])).rowCount,0);
    assert.equal((await q('select * from public.product_change_log where product_id=8520')).rowCount,0);
    assert.ok((await q('select * from public.product_change_log where product_id=8510')).rowCount>0);
    assert.equal((await q('select id from public.find_store_sale(8520,$1)',[second.id])).rowCount,0);
    assert.deepEqual((await q('select id from public.sales_representatives where id in (8510,8520)')).rows.map(r=>Number(r.id)),[8510]);
    assert.equal((await q('select * from public.notes where representative_id=8520')).rowCount,0);
    assert.equal((await q('select * from public.sales_representative_products where representative_id=8520')).rowCount,0);
    await q('savepoint unauthorized_note');
    await assert.rejects(q("select public.save_representative_note(null,null,'Blocked','',8520,current_date,'[]')"),/store access denied/);
    await q('rollback to unauthorized_note');
    assert.deepEqual((await q('select id from public.products where id in (8510,8520)')).rows.map(r=>Number(r.id)),[8510]);
    assert.deepEqual((await q('select product_id from public.favorites where product_id in (8510,8520)')).rows.map(r=>Number(r.product_id)),[8510]);
    assert.equal((await q('delete from public.favorites where product_id=8520')).rowCount,0);
    assert.deepEqual((await q('select id from public.promotions where id in (8510,8520)')).rows.map(r=>Number(r.id)),[8510]);
    assert.deepEqual((await q('select id from public.contacts where id in (8510,8520)')).rows.map(r=>Number(r.id)),[8510]);
    assert.equal((await q("select key from public.settings where key='business-warehouse:8520' ")).rowCount,0);
    console.log('Two stores: independent barcodes, prices, costs, stock, receipt snapshots and staff visibility verified');
  }finally{await q('rollback');}
}
async function verifyOwnerTools(q,owner,[a,b]){
  const snapshot=async shop=>(await q('select public.export_store_backup($1) b',[shop.id])).rows[0].b;
  for(const shop of [a,b]){
    await q('select public.owner_save_knowledge_articles($1,null,$2)',[shop.id,{articles:[{title:shop.name}]}]);
    await q('select public.owner_set_setting($1,$2)',['document_prefixes:'+shop.id,{cashShift:shop.name+'CS'}]);
    assert.equal((await q("select private.configured_document_prefix($1,'cashShift','CS') p",[shop.id])).rows[0].p,shop.name+'CS');
    const log=(await q('select public.get_central_audit_log_page(p_warehouse_id=>$1,p_search=>$2,p_include_total=>true) p',[shop.id,'knowledge_articles'])).rows[0].p;
    assert.ok(log.totalCount>0);assert.ok(log.rows.every(row=>Number(row.warehouse_id)===shop.id));
  }
  const first=await snapshot(a),other=await snapshot(b);
  for(const [backup,shop] of [[first,a],[other,b]]){
    const labels=backup.data.tables['public.settings'].find(r=>r.key==='business-warehouse:'+shop.id).value;
    assert.deepEqual(labels.medicineLabelDoseUnits,[shop.name]);
    assert.equal(labels.promotionLabelTemplates['a4-poster'].title,shop.name);
    assert.ok(!backup.data.tables['public.settings'].some(r=>r.key==='business'));
  }
  assert.deepEqual(first.data.tables['public.products'].map(p=>Number(p.id)),[a.id]);
  assert.deepEqual(other.data.tables['public.contacts'].map(c=>Number(c.id)),[b.id]);
  await q('savepoint scope_mismatch');
  await assert.rejects(q('select public.restore_store_backup_atomic($1,$2)',[b.id,first]),/คนละคลัง/);
  await q('rollback to scope_mismatch');
  const mixed=structuredClone(first);
  mixed.data.tables['public.products'][0].warehouse_id=b.id;
  mixed.manifest['public.products'].md5=(await q('select md5($1::jsonb::text) hash',[JSON.stringify(mixed.data.tables['public.products'])])).rows[0].hash;
  await q('savepoint mixed_backup');
  await assert.rejects(q('select public.restore_store_backup_atomic($1,$2)',[a.id,mixed]),/ไม่ได้อยู่ในคลังนี้/);
  await q('rollback to mixed_backup');
  await q('savepoint warehouse_creation');
  const approval=(await q('select public.issue_warehouse_create_approval($1) token',[owner])).rows[0].token;
  assert.equal((await q("select has_function_privilege('authenticated','public.issue_warehouse_create_approval(uuid)','execute') allowed")).rows[0].allowed,false);
  assert.equal((await q("select has_function_privilege('authenticated','private.owner_upsert_warehouse(bigint,text,jsonb)','execute') allowed")).rows[0].allowed,false);
  assert.equal((await q("select has_table_privilege('authenticated','public.warehouses','INSERT') allowed")).rows[0].allowed,false);
  const create=(token,name)=>q('select public.create_approved_warehouse($1,$2,$3) saved',[token,name,{purpose:'ขายสินค้า'}]);
  await q('savepoint invalid_creation');
  for(const id of [null,65530]){
    await assert.rejects(q("select public.owner_upsert_warehouse($1,'Bypass','{}')",[id]),/ยืนยันรหัสผ่าน/);
    await q('rollback to invalid_creation');
  }
  await assert.rejects(create(randomUUID(),'No token'),/ยืนยันรหัสผ่าน/);await q('rollback to invalid_creation');
  await q("update private.warehouse_create_approvals set expires_at=now() where token=$1",[approval]);
  await assert.rejects(create(approval,'Expired'),/ยืนยันรหัสผ่าน/);await q('rollback to invalid_creation');
  await q("update private.warehouse_create_approvals set actor_id=(select id from public.profiles where not owner limit 1) where token=$1",[approval]);
  await assert.rejects(create(approval,'Wrong user'),/ยืนยันรหัสผ่าน/);await q('rollback to invalid_creation');
  const created=(await create(approval,'Approved')).rows[0].saved;
  assert.equal(created.id,(await create(approval,'Approved')).rows[0].saved.id);
  await q('savepoint spent');
  await assert.rejects(create(approval,'Second shop'),/ใช้การยืนยันนี้ไปแล้ว/);await q('rollback to spent');
  assert.equal((await q("select public.owner_upsert_warehouse($1,'Renamed','{}') w",[created.id])).rows[0].w.name,'Renamed');
  await q('rollback to warehouse_creation');
  await q('savepoint catalog_wipe');
  const clear=(id,shop,count=1)=>q('select public.admin_reset_shop_products($1,$2,$3,$4) result',[owner,id,'ล้างสินค้า '+shop,count]);
  assert.equal((await q("select has_function_privilege('authenticated','public.admin_reset_shop_products(uuid,bigint,text,integer)','execute') allowed")).rows[0].allowed,false);
  await q('savepoint used_catalog');
  await assert.rejects(clear(b.id,b.name),/LOT|สต็อก|ขาย/);
  await q('rollback to used_catalog');
  await q("insert into public.warehouses(id,name) values(8530,'New shop')");
  await q("insert into public.products(id,warehouse_id,sku,name,unit,price,cost,data) values(8530,8530,'S','Decolgen','หลอด',5,6,$1)",[{barcode:'001234'}]);
  await q("insert into public.product_unit_changes(product_id,changed_by,old_unit,new_unit,conversion_factor) values(8530,$1,'ซอง','หลอด',1)",[owner]);
  await q("insert into public.inspection_lists(id,data) values('DRAFT8530',$1)",[{warehouseId:8530,items:[{pid:8530,unit:'หลอด'}]}]);
  await q('savepoint wrong_scope');
  await assert.rejects(clear(8530,'B'),/ชื่อร้าน/);await q('rollback to wrong_scope');
  await assert.rejects(clear(8530,'New shop',2),/จำนวนสินค้า/);await q('rollback to wrong_scope');
  await q("insert into public.promotions(id,data) values(8530,$1)",[{warehouseId:8530,items:[{productId:8530}]}]);
  await q('savepoint active_promotion');
  await assert.rejects(clear(8530,'New shop'),/โปรโมชั่น/);await q('rollback to active_promotion');
  assert.equal((await q("select jsonb_array_length(data->'items') n from public.inspection_lists where id='DRAFT8530'")).rows[0].n,1);
  await q('delete from public.promotions where id=8530');
  assert.equal((await clear(8530,'New shop')).rows[0].result.deleted,1);
  assert.equal((await q('select id from public.products where warehouse_id=8530')).rowCount,0);
  assert.equal((await q('select id from public.product_unit_changes where product_id=8530')).rowCount,0);
  assert.equal((await q("select jsonb_array_length(data->'items') n from public.inspection_lists where id='DRAFT8530'")).rows[0].n,0);
  // Re-import under a fresh id, reusing the normal sale barcode and source catalog fields.
  await q('insert into public.products(id,warehouse_id,name,unit,price,cost,data) select 8531,8530,name,unit,price,cost,data from public.products where id=$1',[a.id]);
  assert.equal((await q('select unit from public.products where id=8531')).rows[0].unit,'box');
  assert.deepEqual((await snapshot(a)).data,first.data);
  assert.deepEqual((await snapshot(b)).data,other.data);
  await q('rollback to catalog_wipe');
  await q('savepoint document_wipe');
  await q("select public.admin_reset_shop_documents($1,$2,'CONFIRM_DOCUMENT_RESET')",[owner,a.id]);
  const cleared=await snapshot(a);
  assert.equal(cleared.data.tables['public.sales'].length,0);assert.equal(cleared.data.tables['public.inventory_lots'].length,0);
  assert.equal(cleared.data.tables['public.products'].length,1);
  assert.deepEqual((await snapshot(b)).data,other.data);
  await q('select public.restore_store_backup_atomic($1,$2)',[a.id,first]);
  const restored=await snapshot(a);
  for(const [t,rows] of Object.entries(first.data.tables)){
    if(t!=='public.audit_logs')assert.deepEqual(restored.data.tables[t],rows,t);
  }
  assert.deepEqual((await snapshot(b)).data,other.data);
  await q('rollback to document_wipe');
  await q('savepoint factory');
  await q("insert into public.notes(title,standalone_warehouse_id) values('Factory fixture',$1)",[a.id]);
  await q("select public.admin_reset_store_data('factory',$1,'CONFIRM_FACTORY_RESET_ALL')",[owner]);
  assert.equal((await q('select 1 from public.warehouses')).rowCount,0);
  assert.equal((await q('select 1 from public.notes')).rowCount,0);
  await q('rollback to factory');
  console.log('Store owner tools: independent knowledge, document numbers, audit counts, scoped backup/restore and document reset passed');
}
