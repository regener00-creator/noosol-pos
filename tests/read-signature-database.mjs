import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function run({client}){
  const q=(sql,args)=>client.query(sql,args);
  await q('begin');
  try{
    const owner=randomUUID(),staff=randomUUID();
    await q('insert into auth.users(id) values($1),($2)',[owner,staff]);
    await q("insert into public.profiles(id,username,owner,level) values($1,'signature-owner',true,1),($2,'signature-staff',false,2)",[owner,staff]);
    const signature=async(table,actor=owner)=>{
      await q("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
      await q('set local role authenticated');
      try{return (await q('select public.get_visible_data_signature($1) value',[table])).rows[0].value;}
      finally{await q('reset role');}
    };
    const empty=await signature('quotations');
    await q("insert into public.quotations(id,data) values('SIGNATURE-Q','{\"date\":\"2026-10-31\",\"total\":100}')");
    const inserted=await signature('quotations');assert.notEqual(inserted,empty);assert.equal(await signature('quotations'),inserted);
    await q("update public.quotations set data=jsonb_set(data,'{total}','200') where id='SIGNATURE-Q'");
    assert.notEqual(await signature('quotations'),inserted,'same-transaction updates must change the token too');
    await q("delete from public.quotations where id='SIGNATURE-Q'");assert.equal(await signature('quotations'),empty);
    const invisibleBefore=await signature('sales',staff);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q("insert into public.sales(id,status,sale_date,data) values('SIGNATURE-HOLD','hold','2026-10-31','{\"status\":\"hold\",\"items\":[]}')");
    const hold=await signature('sales');assert.equal(await signature('sales',staff),invisibleBefore,'RLS must exclude inaccessible sales');
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q("update public.sales set data=jsonb_set(data,'{items}','[{\"name\":\"changed\"}]') where id='SIGNATURE-HOLD'");
    assert.notEqual(await signature('sales'),hold,'sale item changes without total/status changes are detected');
    const permission=(await q("select has_function_privilege('anon','public.get_visible_data_signature(text)','EXECUTE') allowed")).rows[0];
    assert.equal(permission.allowed,false);
    await q('savepoint invalid_table');
    await assert.rejects(q("select public.get_visible_data_signature('profiles')"),/unsupported data table/);
    await q('rollback to savepoint invalid_table');
    console.log('Visible data signature: inserts, updates, deletes, unchanged reads, sales JSON changes, RLS and allowlist passed');
  }finally{await q('rollback');}
}
