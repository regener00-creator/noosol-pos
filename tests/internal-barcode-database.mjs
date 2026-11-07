import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function run({client,connect}){
  const owner='11111111-1111-4111-8111-111111111111';
  const staff='22222222-2222-4222-8222-222222222222';
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const insert=async(id,data={})=>client.query("insert into public.products(id,name,sku,unit,data) values($1,'Internal label test',$2,'box',$3)",[id,'LABEL-'+id,data]);
  const issue=async(peer,items,id=randomUUID())=>(await peer.query('select public.assign_price_label_barcodes($1,$2) as result',[id,JSON.stringify(items)])).rows[0].result;
  const item=pid=>({pid,unit:'box',barcode:'',qty:1});
  await insert(88001);
  const request=randomUUID();
  const first=await issue(client,[item(88001)],request);
  assert.equal(first.items[0].barcode,'AP00000000001');
  assert.equal(first.products[0].data.barcode,'AP00000000001');
  assert.deepEqual((await issue(client,[item(88001)],request)).items,first.items,'retry returns original issued number');
  await assert.rejects(issue(client,[{...item(88001),qty:2}],request),/original payload/);
  await assert.rejects(issue(client,[item(88001)]),/มีบาร์โค้ดแล้ว/);
  await client.query("update public.products set data=data||'{\"note\":\"keep code\"}' where id=88001");
  await client.query('delete from public.products where id=88001');
  await assert.rejects(issue(client,[item(88001)],request),/ถูกลบหรือเลิกใช้งาน/,'a retired job cannot print a deleted product');
  assert.equal((await client.query("select count(*)::int n from private.internal_barcode_history where barcode='ap00000000001'")).rows[0].n,1);
  await assert.rejects(insert(88002,{barcode:'AP00000000001'}),/ถูกใช้แล้ว/);
  await insert(88002);
  assert.equal((await issue(client,[item(88002)])).items[0].barcode,'AP00000000002');
  await client.query("update public.products set data=data-'barcode' where id=88002");
  await client.query("update public.products set data=data||'{\"barcode\":\"AP00000000002\"}' where id=88002");
  assert.equal((await client.query('select data->>\'barcode\' code from public.products where id=88002')).rows[0].code,'AP00000000002','owner restores a proven system-issued code to its original product');
  await client.query("update public.products set data=data-'barcode' where id=88002");
  assert.equal((await issue(client,[item(88002)])).items[0].barcode,'AP00000000003');

  // Manually/imported internal-format codes are permanently reserved too.
  await insert(88003,{barcode:'ap00000000004'});
  await client.query("update public.products set data=data-'barcode' where id=88003");
  await assert.rejects(client.query("update public.products set data=data||'{\"barcode\":\"ap00000000004\"}' where id=88003"),/ถูกใช้แล้ว/,'manual codes do not become recoverable system history');
  await client.query('delete from public.products where id=88003');
  await insert(88004,{barcode:'BOX-EXISTING',units:[{sub:'pack',base:'box',per:2,factor:2,barcode:''}]});
  const sub=await issue(client,[{pid:88004,unit:'pack',barcode:'',qty:2}]);
  assert.equal(sub.items[0].barcode,'AP00000000005');
  assert.equal(sub.products[0].data.barcode,'BOX-EXISTING');
  assert.equal(sub.products[0].data.units[0].barcode,'AP00000000005');
  await client.query("update public.products set data=jsonb_set(data,'{units,0,barcode}','\"WRONG\"') where id=88004");
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[staff]);
  await assert.rejects(client.query("update public.products set data=jsonb_set(data,'{units,0,barcode}','\"AP00000000005\"') where id=88004"),/ถูกใช้แล้ว/,'staff cannot restore retired system codes');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await client.query("update public.products set data=jsonb_set(data,'{units,0,barcode}','\"AP00000000005\"') where id=88004");
  assert.equal((await client.query("select data#>>'{units,0,barcode}' code from public.products where id=88004")).rows[0].code,'AP00000000005');
  await assert.rejects(client.query("update public.products set data=jsonb_set(data,'{barcode}','\"AP00000000002\"') where id=88004"),/ถูกใช้แล้ว/,'restoration never transfers ownership between products');
  await insert(88005);
  await issue(client,[{...item(88005),barcode:'MANUAL-LABEL'}]);
  const issued=(await client.query('select public.system_issued_label_codes() codes')).rows[0].codes;
  assert.ok(issued.some(row=>row.pid===88004&&row.barcode==='AP00000000005'),'Includes automatically issued subunit code');
  assert.ok(!issued.some(row=>row.pid===88003),'Imported P-prefixed codes are excluded');
  assert.ok(!issued.some(row=>row.pid===88005),'Manually supplied codes in label requests are excluded');

  const peers=await Promise.all(Array.from({length:8},()=>connect()));
  try{
    for(let i=0;i<peers.length;i++){
      await insert(88100+i);
      await peers[i].query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
      await peers[i].query('set role authenticated');
    }
    const results=await Promise.all(peers.map((peer,i)=>issue(peer,[item(88100+i)])));
    const codes=results.map(result=>result.items[0].barcode);
    assert.equal(new Set(codes).size,peers.length);
    assert.ok(codes.every(code=>/^AP\d{11}$/.test(code)));
    await insert(88200);
    const sameUnit=await Promise.allSettled(peers.map(peer=>issue(peer,[item(88200)])));
    assert.equal(sameUnit.filter(result=>result.status==='fulfilled').length,1);
    await insert(88201);
    const sharedRequest=randomUUID();
    const sameRequest=await Promise.all(peers.map(peer=>issue(peer,[item(88201)],sharedRequest)));
    assert.equal(new Set(sameRequest.map(result=>result.items[0].barcode)).size,1);
    await peers[0].query("select set_config('request.jwt.claim.sub',$1,false)",[staff]);
    await assert.rejects(issue(peers[0],[item(88201)]),/owner access/);
    await assert.rejects(peers[0].query('select public.system_issued_label_codes()'),/owner access/);
    await assert.rejects(peers[0].query("select nextval('private.internal_barcode_number')"),/permission denied/);
    await assert.rejects(peers[0].query('delete from private.internal_barcode_history'),/permission denied/);
    await peers[0].query('set role anon');
    await assert.rejects(peers[0].query('select public.system_issued_label_codes()'),/permission denied/);
    await assert.rejects(issue(peers[0],[item(88201)]),/permission denied/);
  }finally{await Promise.all(peers.map(peer=>peer.end()));}

  await insert(88300);
  await assert.rejects(issue(client,[item(88300),item(999999999)]),/ไม่พบสินค้า/);
  assert.equal((await client.query('select data->>\'barcode\' code from public.products where id=88300')).rows[0].code,null,'failed batch does not partially write products');
  const backup=(await client.query('select public.export_store_backup() b')).rows[0].b;
  await client.query('select public.restore_store_backup_atomic($1)',[backup]);
  assert.equal((await client.query("select count(*)::int n from private.internal_barcode_history where barcode='ap00000000001'")).rows[0].n,1,'restore never loses retired numbers');
  // Mimic pre-upgrade main and secondary units and their completed print jobs.
  const scopedIssue=async(w,pid,unit='box',key=randomUUID())=>(await client.query(
    'select public.assign_price_label_barcodes($1,$2,$3) r',[w,key,JSON.stringify([{pid,unit,barcode:'',qty:1}])])).rows[0].r;
  await client.query("insert into public.warehouses(id,name) values(2,'Second shop') on conflict do nothing");
  const legacyCode='P00000000100';
  for(const [w,pid] of [[1,88911],[2,88912]]){
    const old={barcode:'SUP-'+pid,units:[{sub:'pack',base:'box',per:2,factor:2,barcode:legacyCode}],extraBarcodes:['M-'+pid],extraBarcodeUnits:['box']};
    await client.query("insert into public.products(id,warehouse_id,name,sku,unit,data) values($1,$2,'Legacy label',$3,'box',$4)",[pid,w,'LEGACY-'+pid,old]);
    const requested=[{pid,unit:'pack',barcode:'',qty:1}],legacyRequest=randomUUID();
    await client.query("insert into private.price_label_requests(request_id,actor_id,payload,labels) values($1,$2,$3,$4)",[legacyRequest,owner,JSON.stringify(requested),JSON.stringify([{...requested[0],barcode:legacyCode}])]);
    const oldBackup=w===2?(await client.query('select public.export_store_backup($1) b',[w])).rows[0].b:null;
    if(oldBackup) delete oldBackup.shopLabelBarcodes;
    await client.query('select private.move_legacy_label_barcodes($1)',[w]);
    const data=(await client.query('select data from public.products where id=$1',[pid])).rows[0].data;
    assert.equal(data.barcode,old.barcode);assert.equal(data.units[0].barcode,'');
    assert.deepEqual(data.extraBarcodes,[...old.extraBarcodes,legacyCode]);assert.deepEqual(data.extraBarcodeUnits,['box','pack']);
    const history=(await client.query('select public.system_issued_label_codes($1) codes',[w])).rows[0].codes;
    assert.ok(history.some(row=>row.pid===pid&&row.barcode===legacyCode));
    assert.ok(!history.some(row=>row.pid===(w===1?88912:88911)));
    assert.equal((await scopedIssue(w,pid,'pack',legacyRequest)).items[0].barcode,legacyCode,'Lost replies for old jobs still replay the original label');
    const request=randomUUID(),label=(await scopedIssue(w,pid,'pack',request)).items[0].barcode;
    assert.equal((await scopedIssue(w,pid,'pack',request)).items[0].barcode,label);
    if(w===2) assert.equal(label,'BP00000000001'); else assert.match(label,/^AP[0-9]{11}$/);
    const after=(await client.query('select data from public.products where id=$1',[pid])).rows[0].data;
    assert.deepEqual(after.extraBarcodes,data.extraBarcodes);assert.deepEqual(after.extraBarcodeUnits,data.extraBarcodeUnits);
    await assert.rejects(scopedIssue(w===1?2:1,pid,'pack'),/ร้านที่เลือก/);
    if(oldBackup){
      await client.query('select public.restore_store_backup_atomic($1,$2)',[w,oldBackup]);
      const restored=(await client.query('select data from public.products where id=$1',[pid])).rows[0].data;
      assert.equal(restored.units[0].barcode,'');assert.deepEqual(restored.extraBarcodes,data.extraBarcodes);
      assert.deepEqual(restored.extraBarcodeUnits,data.extraBarcodeUnits);
      assert.equal((await scopedIssue(w,pid,'pack')).items[0].barcode,'BP00000000002','Restore keeps the old label scannable and never reuses a BP number');
    }
  }
  await insert(88400);await insert(88401);
  await client.query("update private.shop_number_counters set last_value=99999999998 where warehouse_id=1 and series='internal-label-barcode'");
  assert.equal((await issue(client,[item(88400)])).items[0].barcode,'AP99999999999');
  await assert.rejects(issue(client,[item(88401)]),/maximum value/,'sequence must stop rather than wrap or exceed 12 characters');
  console.log('Permanent internal barcode database tests passed (AP/BP and legacy scan units, retry, concurrency, deletion, restore, permissions, exhaustion)');
}
