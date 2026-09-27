import assert from 'node:assert/strict';
export async function run({client,connect}){
  const owner='11111111-1111-4111-8111-111111111111';
  const staff='22222222-2222-4222-8222-222222222222';
  const q=(sql,args)=>client.query(sql,args);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const create=async id=>{
    await q('insert into public.products(id,name,sku,unit,price,cost,warehouse_id,data) values($1,$2,$3,$4,100,50,1,$5)',[id,'Unused '+id,'UNUSED-'+id,'box',{barcode:'UNUSED-BC-'+id,units:[],extraBarcodes:['UNUSED-EXTRA-'+id],extraBarcodeUnits:['box']}]);
    return (await q('select * from public.products where id=$1',[id])).rows[0];
  };
  const status=async id=>(await q('select public.get_product_unit_edit_status($1) s',[id])).rows[0].s;
  const save=(p,record={unit:'Pcs'},peer=client)=>peer.query('select public.save_unused_product_unit($1,$2,$3) s',[p.id,p.revision,record]);
  const blocked=e=>e.hint==='PRODUCT_ALREADY_USED';
  const p=await create(92001);
  assert.equal((await status(p.id)).canEdit,true);
  await q('set role authenticated');
  const result=(await save(p,{unit:'Pcs',id:123,stock:999,revision:999,data:{...p.data,extraBarcodeUnits:['Pcs']}})).rows[0].s.product;
  await q('reset role');
  assert.equal(result.unit,'Pcs'); assert.equal(result.id,Number(p.id));
  assert.equal(Number(result.stock),0); assert.equal(Number(result.revision),Number(p.revision)+1);
  assert.deepEqual(result.data.units,[]); assert.equal(result.data.barcode,p.data.barcode);
  assert.deepEqual(result.data.extraBarcodes,p.data.extraBarcodes);
  assert.equal((await q('select count(*)::int n from public.product_unit_changes where product_id=$1',[p.id])).rows[0].n,0);
  assert.equal((await q('select count(*)::int n from public.inventory_lots where product_id=$1',[p.id])).rows[0].n,0);
  await assert.rejects(save(p),e=>e.hint==='REVISION_CONFLICT');
  const stock=await create(92002);
  await q('insert into public.warehouses(id,name) values(92002,$1)',['Other warehouse']);
  await q('insert into public.inventory_balances(warehouse_id,product_id,stock) values(92002,92002,-0.000001)');
  assert.equal((await status(stock.id)).canEdit,false); await assert.rejects(save(stock),blocked);
  const lot=await create(92003);
  await q("insert into public.inventory_lots(product_id,warehouse_id,internal_code,quantity_base,status) values(92003,1,'UNUSED-EMPTY-LOT',0,'exhausted')");
  assert.equal((await status(lot.id)).canEdit,false); await assert.rejects(save(lot),blocked);
  const history=await create(92004);
  await q("insert into public.sales(id,status,data) values('UNUSED-SALE','cancelled','{\"warehouseId\":1}')");
  await q("insert into public.sale_items(sale_id,product_id,qty,unit) values('UNUSED-SALE',92004,1,'box')");
  assert.equal((await status(history.id)).canEdit,false); await assert.rejects(save(history),blocked);
  let id=92100;
  for(const table of ['quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts','purchase_orders_full','product_returns','product_exchanges','transfers','standalone_tax_invoices','inspection_lists']){
    const docProduct=await create(id++);
    await q(`insert into public.${table}(id,data) values($1,$2)`,['UNUSED-DOC',{status:'draft',warehouseId:1,items:[{pid:Number(docProduct.id),unit:'box',qty:1}]}]);
    assert.equal((await status(docProduct.id)).canEdit,false,table); await assert.rejects(save(docProduct),blocked);
  }
  const converted=await create(92005);
  await q("insert into public.product_unit_changes(product_id,changed_by,old_unit,new_unit,conversion_factor) values(92005,auth.uid(),'tablet','box',10)");
  await assert.rejects(save(converted),blocked);
  const valid=await create(92006);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[staff]);
  await q('set role authenticated');
  await assert.rejects(save(valid),/owner access required/);
  await assert.rejects(status(valid.id),/owner access required/);
  await q('set role anon'); await assert.rejects(status(valid.id),/permission denied/);
  await q('reset role'); await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await assert.rejects(save(valid,{unit:'Pcs',data:{units:[{sub:'Pcs'}]}}),/หน่วยหลักใหม่ซ้ำ/);
  assert.equal((await q('select unit from public.products where id=$1',[valid.id])).rows[0].unit,'box');
  // A document committed during the eligibility preview must be seen after
  // waiting for the shared store gate, rather than racing the unit correction.
  const race=await create(92007), writer=await connect(), editor=await connect();
  try{
    await writer.query('begin');
    await writer.query('select private.acquire_store_mutation_gate()');
    await writer.query("insert into public.quotations(id,data) values('UNUSED-RACE','{\"items\":[{\"pid\":92007,\"unit\":\"box\"}]}')");
    await editor.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    await editor.query('set role authenticated'); await editor.query("set statement_timeout='5s'");
    const pending=save(race,{unit:'Pcs'},editor).then(()=>({saved:true}),error=>({error}));
    await writer.query('commit');
    const outcome=await pending; assert.equal(outcome.error?.hint,'PRODUCT_ALREADY_USED');
    assert.equal((await q('select unit from public.products where id=92007')).rows[0].unit,'box');
  }finally{await writer.end();await editor.end();}
  console.log('DB: unused unit save, revision, stock/LOT/history/drafts, staff/anon permissions and concurrent document protection passed');
}
