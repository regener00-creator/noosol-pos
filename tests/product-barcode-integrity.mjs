import assert from 'node:assert/strict';
export async function run({client,connect}){
  const owner='11111111-1111-4111-8111-111111111111';
  const q=(sql,args)=>client.query(sql,args);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const insert=(id,data,peer=client)=>peer.query('insert into public.products(id,name,sku,unit,data) values($1,$2,$3,$4,$5)',[id,'Barcode test '+id,'BC-'+id,'box',data]);
  const duplicate=error=>error.code==='23505'&&error.hint==='DUPLICATE_PRODUCT_BARCODE';
  await insert(80001,{barcode:'  000123  ',units:[{sub:'case',barcode:'CASE-BC'}],extraBarcodes:['EXTRA-BC',{code:'OBJECT-BC',unit:'box'}],vendorBarcodes:[{code:'VENDOR-BC'}],active:false});
  const claims=await q('select barcode from private.product_barcode_claims where product_id=80001 order by barcode');
  assert.deepEqual(claims.rows.map(r=>r.barcode),['000123','case-bc','extra-bc','object-bc','vendor-bc']);
  for(const barcode of ['000123',' case-bc ','EXTRA-BC','OBJECT-BC','VENDOR-BC','\u2003CaSe-Bc\u2003']){
    await assert.rejects(insert(80002,{barcode}),duplicate,'main barcodes conflict with every barcode source, even inactive products');
  }
  for(const data of [{units:[{barcode:'000123'}]},{extraBarcodes:['000123']},{extraBarcodes:[{code:'000123'}]},{vendorBarcodes:[{code:'000123'}]}]){
    await assert.rejects(insert(80002,data),duplicate);
  }
  await insert(80002,{barcode:'123'}); // leading zero is significant
  await insert(80003,{barcode:'   '});await insert(80004,{});
  await q("update public.products set price=150,data=data||'{\"desc\":\"same barcode owner\"}' where id=80001");
  await assert.rejects(q("update public.products set data='{\"barcode\":\"000123\"}' where id=80002"),duplicate);
  assert.equal((await q("select data->>'barcode' barcode from public.products where id=80002")).rows[0].barcode,'123');
  await q("update public.products set data=jsonb_set(data,'{barcode}','\"NEW-BC\"') where id=80001");
  await insert(80005,{barcode:'000123'});
  await q('delete from public.products where id=80005');
  await insert(80006,{barcode:'000123'});
  const reader=await connect();
  try{
    await reader.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await reader.query('set role authenticated');
    const found=await reader.query("select * from public.find_product_barcode_owners(array['vendor-bc','new-bc'])");
    assert.equal(found.rowCount,2);
    await assert.rejects(reader.query("delete from private.product_barcode_claims where barcode='new-bc'"),/permission denied/);
    await reader.query('set role anon');
    await assert.rejects(reader.query("select * from public.find_product_barcode_owners(array['new-bc'])"),/permission denied/);
  }finally{await reader.end();}
  const peers=await Promise.all(Array.from({length:10},()=>connect()));
  try{
    await Promise.all(peers.map(async peer=>{await peer.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await peer.query('set role authenticated');}));
    const results=await Promise.allSettled(peers.map((peer,i)=>insert(81000+i,i%2?{units:[{barcode:'RACE-BC'}]}:{barcode:'race-bc'},peer)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'only one of ten simultaneous inserts succeeds');
    assert.ok(results.filter(r=>r.status==='rejected').every(r=>duplicate(r.reason)));
    assert.equal((await q("select count(*)::int n from private.product_barcode_claims where barcode='race-bc'")).rows[0].n,1);
  }finally{await Promise.all(peers.map(peer=>peer.end()));}
  // Claims are derived, not a new backup table. Restore must rebuild them and
  // preserve rollback semantics when an old/edited backup contains duplicates.
  const backup=JSON.parse(JSON.stringify((await q('select public.export_store_backup() b')).rows[0].b));
  const before=(await q('select * from private.product_barcode_claims order by barcode')).rows;
  await q("update public.products set data='{\"barcode\":\"CHANGED\"}' where id=80001");
  await q('select public.restore_store_backup_atomic($1)',[backup]);
  assert.deepEqual((await q('select * from private.product_barcode_claims order by barcode')).rows,before);
  const bad=structuredClone(backup);bad.data.tables['public.products'].find(p=>p.id===80002).data.barcode='NEW-BC';
  bad.manifest['public.products'].md5=(await q('select md5($1::jsonb::text) hash',[JSON.stringify(bad.data.tables['public.products'])])).rows[0].hash;
  await assert.rejects(q('select public.restore_store_backup_atomic($1)',[bad]),duplicate);
  assert.deepEqual((await q('select * from private.product_barcode_claims order by barcode')).rows,before,'failed restore cannot corrupt barcode ownership');
  console.log('DB: all barcode sources unique, inactive/blank/leading-zero cases, edits/deletes, ten concurrent inserts, access control and restore passed');
}
