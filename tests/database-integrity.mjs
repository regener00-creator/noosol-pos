import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const owner='11111111-1111-4111-8111-111111111111';
const staff='22222222-2222-4222-8222-222222222222';
export async function run({client,connect}){
  const q=(sql,args)=>client.query(sql,args);
  const backup=async()=>JSON.parse(JSON.stringify((await q('select public.export_store_backup() as backup')).rows[0].backup));
  await q(`insert into auth.users(id,email) values($1,'owner@example.test'),($2,'staff@example.test');`,[owner,staff]);
  await q(`insert into public.profiles(id,username,owner,level) values($1,'owner-test',true,1),($2,'staff-test',false,2)`,[owner,staff]);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await q(`insert into public.warehouses(id,name,data) values(1,'Test warehouse','{"active":true}');
    insert into public.products(id,name,sku,unit,price,cost,warehouse_id,data) values
      (1,'A','A','box',100.00,40.00,1,'{"_clientCreateToken":"a","active":true}'),
      (2,'Negative stock','B','box',150.50,50.25,1,'{"_clientCreateToken":"b","active":true}');
    update public.inventory_balances set stock=-2 where product_id=2;
    insert into public.contacts(id,type,name,phone,data) values(1,'customer','Customer','0812345678','{"types":["customer"],"code":"C0001"}');
    insert into public.sales_representatives(id,name,data) values(1,'Representative','{}');
    insert into public.sales_representative_products(representative_id,product_id) values(1,1);
    insert into public.inventory_lots(product_id,warehouse_id,internal_code,quantity_base,unit_cost_base) values(1,1,'TEST-LOT',10,40.00);
    update public.inventory_balances set stock=10 where product_id=1;
    insert into public.notes(title,content_html,product_id,representative_id) values('History','<p>Test</p>',1,1);
    insert into public.representative_activity_items(note_id,product_id,product_name,quoted_price,minimum_quantity,unit,sort_order)
      select id,1,'A',95.00,10.00,'box',0 from public.notes;
    insert into public.representative_activity_items(note_id,product_id,product_name,quoted_price,minimum_quantity,unit,sort_order)
      select id,2,'B',125.50,5.00,'box',1 from public.notes;
    insert into private.inventory_lot_detail_audit(lot_id,product_id,warehouse_id,old_expiry,new_expiry)
      select id,1,1,null,'2030-01-01' from public.inventory_lots;
    insert into public.product_unit_changes(product_id,changed_by,old_unit,new_unit,conversion_factor)
      values(1,auth.uid(),'tablet','box',10);
    insert into public.categories(name) values('Medicine');
    insert into public.brands(name) values('Test brand');
    insert into public.units(name) values('box');
    insert into public.print_events(document_type,document_id,actor_id,warehouse_id) values('receipt','TEST',auth.uid(),1);
    select public.open_cash_shift(1,1000);
  `);
  await q(`select public.complete_sale(gen_random_uuid(),'TEST',1,
    '{"customerId":"1","total":100,"discount":0,"fee":0,"vat":0,"costTotal":100,"cashReceived":100,"cashChange":0,"payMethod":"เงินสด"}',
    '[{"lineKey":"1","custom":true,"name":"Snapshot test","qty":1,"unit":"รายการ","price":100,"lineTotal":100,"lineTotalGross":100}]',null)`);
  for(const table of ['quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts','purchase_orders_full','product_returns','product_exchanges','transfers','standalone_tax_invoices','inspection_lists']){
    await q(`insert into public.${table}(id,data) values('TEST-DOC','{"status":"draft","items":[],"warehouseId":1}')`);
  }
  await q(`insert into public.favorites(user_id,product_id) values(auth.uid(),1);
    insert into public.inventory_count_adjustments(document_no,warehouse_id,reason,created_by_name,line_count) values('COUNT-TEST',1,'Test count','Test owner',1);
    insert into public.inventory_count_adjustment_lines(adjustment_id,product_id,system_stock,counted_stock,difference,unit_name,selected_lot_id)
      select a.id,1,9,10,1,'box',l.id from public.inventory_count_adjustments a cross join public.inventory_lots l;`);
  const original=await backup();
  assert.equal(original.version,3);
  assert.equal(original.manifest['public.products'].scope,'replace');
  assert.equal(original.manifest['public.audit_logs'].scope,'merge');
  assert.equal(original.data.tables['public.inventory_balances'].find(r=>r.product_id===2).stock,-2);
  assert.equal(original.data.tables['public.cash_shifts'].length,1);
  assert.equal(original.data.tables['public.sales_representative_products'].length,1);
  assert.equal(original.data.tables['public.notes'].length,1);
  assert.ok(original.data.tables['public.sale_items'].length);
  const corrupted=structuredClone(original);corrupted.data.tables['public.products'][0].price=999;
  await assert.rejects(q('select public.restore_store_backup_atomic($1)',[corrupted]),/incomplete or changed backup/);
  assert.deepEqual((await backup()).data,original.data,'invalid backup changes nothing');
  const missing=structuredClone(original); delete missing.data.tables['public.notes'];
  await assert.rejects(q('select public.restore_store_backup_atomic($1)',[missing]),/incomplete/);
  await assert.rejects(q('select public.restore_store_backup_atomic($1)',[{format:original.format,version:2,data:{}}]),/เวอร์ชัน 3/);
  // A valid checksum is not proof of valid relations. Fail *after* deletes
  // have started and verify the entire transaction rolls back unchanged.
  const brokenLink=structuredClone(original);
  brokenLink.data.tables['public.sales_representative_products'][0].product_id=999999;
  const table='public.sales_representative_products';
  brokenLink.manifest[table].md5=(await q('select md5($1::jsonb::text) as hash',[JSON.stringify(brokenLink.data.tables[table])])).rows[0].hash;
  await assert.rejects(q('select public.restore_store_backup_atomic($1)',[brokenLink]),/foreign key constraint/);
  assert.deepEqual((await backup()).data,original.data,'late restore failure rolls back deletions and inserts, including audit');
  await q(`update public.products set price=222 where id=1; update public.inventory_balances set stock=-5 where product_id=2;
    delete from public.sales_representative_products where product_id=1; update public.notes set content_html='changed';`);
  const beforeAudit=Number((await q('select count(*) from public.audit_logs')).rows[0].count);
  const result=(await q('select public.restore_store_backup_atomic($1) as restored',[original])).rows[0].restored;
  assert.equal(result.verified,true);
  assert.equal(result.cashShiftHistoryRestored,true);
  const restored=await backup();
  const history=new Set(['public.audit_logs','private.audit_logs_archive','public.print_events','private.operation_ledger']);
  for(const [table,rows] of Object.entries(original.data.tables)){
    if(!history.has(table)) assert.deepEqual(restored.data.tables[table],rows,`full restore content: ${table}`);
  }
  assert.ok(Number((await q('select count(*) from public.audit_logs')).rows[0].count)>=beforeAudit,'restore never erases current audit history');
  console.log('DB: complete snapshot + restore verified including negative stock, shifts, sale links, notes and representatives');

  // Two devices: an uncommitted multi-table update cannot produce a mixed backup.
  const writer=await connect();
  try{
    await writer.query('begin');
    await writer.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await writer.query("update public.products set name='new A' where id=1; update public.contacts set name='new Customer' where id=1");
    const during=await backup();
    assert.equal(during.data.tables['public.products'].find(r=>r.id===1).name,'A');
    assert.equal(during.data.tables['public.contacts'][0].name,'Customer');
    await writer.query('commit');
    const after=await backup();
    assert.equal(after.data.tables['public.products'].find(r=>r.id===1).name,'new A');
    assert.equal(after.data.tables['public.contacts'][0].name,'new Customer');
  }finally{await writer.query('rollback');await writer.end();}

  const peers=await Promise.all(Array.from({length:10},()=>connect()));
  try{
    const revision=(await q('select revision from public.products where id=1')).rows[0].revision;
    await Promise.all(peers.map(async p=>{await p.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await p.query('set role authenticated');}));
    const writes=await Promise.all(peers.map((p,i)=>p.query('update public.products set price=$1 where id=1 and revision=$2 returning id,revision',[300+i,revision])));
    assert.equal(writes.filter(r=>r.rowCount===1).length,1,'exactly one of ten stale concurrent writers wins');
    await assert.rejects(peers[0].query("select public.owner_update_mobile_product_details(1,1,null,'{}',1,1,null)"),/permission denied/);
    await peers[1].query("select set_config('request.jwt.claim.sub',$1,false)",[staff]);
    await assert.rejects(peers[1].query('select public.export_store_backup()'),/owner access required/);
    await assert.rejects(peers[1].query('select public.restore_store_backup_atomic($1)',[original]),/owner access required/);
  }finally{await Promise.all(peers.map(p=>p.end()));}
  console.log('DB: ten concurrent writers, old RPC blocked, staff backup/restore access denied');
  // Existing transaction/idempotency coverage now runs reproducibly off Production.
  for(const name of ['customer-loyalty-checkout.sql','customer-purchase-history.sql','quotation-checkout.sql']){
    await q(await fs.readFile(new URL(name,import.meta.url),'utf8'));
    console.log(`DB: ${name} passed`);
  }
}
