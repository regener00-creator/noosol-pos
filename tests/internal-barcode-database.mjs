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
  assert.equal(first.items[0].barcode,'P00000000000');
  assert.equal(first.products[0].data.barcode,'P00000000000');
  assert.deepEqual((await issue(client,[item(88001)],request)).items,first.items,'retry returns original issued number');
  await assert.rejects(issue(client,[{...item(88001),qty:2}],request),/original payload/);
  await assert.rejects(issue(client,[item(88001)]),/มีบาร์โค้ดแล้ว/);
  await client.query("update public.products set data=data||'{\"note\":\"keep code\"}' where id=88001");
  await client.query('delete from public.products where id=88001');
  await assert.rejects(issue(client,[item(88001)],request),/ถูกลบหรือเลิกใช้งาน/,'a retired job cannot print a deleted product');
  assert.equal((await client.query("select count(*)::int n from private.internal_barcode_history where barcode='p00000000000'")).rows[0].n,1);
  await assert.rejects(insert(88002,{barcode:'P00000000000'}),/ถูกใช้แล้ว/);
  await insert(88002);
  assert.equal((await issue(client,[item(88002)])).items[0].barcode,'P00000000001');
  await client.query("update public.products set data=data-'barcode' where id=88002");
  await assert.rejects(client.query("update public.products set data=data||'{\"barcode\":\"P00000000001\"}' where id=88002"),/ถูกใช้แล้ว/);
  assert.equal((await issue(client,[item(88002)])).items[0].barcode,'P00000000002');

  // Manually/imported internal-format codes are permanently reserved too.
  await insert(88003,{barcode:'p00000000003'});
  await client.query('delete from public.products where id=88003');
  await insert(88004,{barcode:'BOX-EXISTING',units:[{sub:'pack',base:'box',per:2,factor:2,barcode:''}]});
  const sub=await issue(client,[{pid:88004,unit:'pack',barcode:'',qty:2}]);
  assert.equal(sub.items[0].barcode,'P00000000004');
  assert.equal(sub.products[0].data.barcode,'BOX-EXISTING');
  assert.equal(sub.products[0].data.units[0].barcode,'P00000000004');

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
    assert.ok(codes.every(code=>/^P\d{11}$/.test(code)));
    await insert(88200);
    const sameUnit=await Promise.allSettled(peers.map(peer=>issue(peer,[item(88200)])));
    assert.equal(sameUnit.filter(result=>result.status==='fulfilled').length,1);
    await insert(88201);
    const sharedRequest=randomUUID();
    const sameRequest=await Promise.all(peers.map(peer=>issue(peer,[item(88201)],sharedRequest)));
    assert.equal(new Set(sameRequest.map(result=>result.items[0].barcode)).size,1);
    await peers[0].query("select set_config('request.jwt.claim.sub',$1,false)",[staff]);
    await assert.rejects(issue(peers[0],[item(88201)]),/owner access/);
    await assert.rejects(peers[0].query("select nextval('private.internal_barcode_number')"),/permission denied/);
    await assert.rejects(peers[0].query('delete from private.internal_barcode_history'),/permission denied/);
    await peers[0].query('set role anon');
    await assert.rejects(issue(peers[0],[item(88201)]),/permission denied/);
  }finally{await Promise.all(peers.map(peer=>peer.end()));}

  await insert(88300);
  await assert.rejects(issue(client,[item(88300),item(999999999)]),/ไม่พบสินค้า/);
  assert.equal((await client.query('select data->>\'barcode\' code from public.products where id=88300')).rows[0].code,null,'failed batch does not partially write products');
  const backup=(await client.query('select public.export_store_backup() b')).rows[0].b;
  await client.query('select public.restore_store_backup_atomic($1)',[backup]);
  assert.equal((await client.query("select count(*)::int n from private.internal_barcode_history where barcode='p00000000000'")).rows[0].n,1,'restore never loses retired numbers');
  await insert(88400);await insert(88401);
  await client.query("select setval('private.internal_barcode_number',99999999999,false)");
  assert.equal((await issue(client,[item(88400)])).items[0].barcode,'P99999999999');
  await assert.rejects(issue(client,[item(88401)]),/maximum value/,'sequence must stop rather than wrap or exceed 12 characters');
  console.log('Permanent internal barcode database tests passed (zero, retry, concurrency, deletion, restore, permissions, exhaustion)');
}
