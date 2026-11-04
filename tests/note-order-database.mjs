import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function run({client}){
  const q=(sql,args)=>client.query(sql,args);
  const owner=randomUUID(),staff=randomUUID();
  await q('begin');
  try{
    await q('insert into auth.users(id) values($1),($2)',[owner,staff]);
    await q("insert into public.profiles(id,username,owner,level) values ($1,'ordering-owner',true,1),($2,'ordering-staff',false,2)",[owner,staff]);
    await q("insert into public.profile_page_permissions(user_id,page_key,can_view) values ($1,'notes',true)",[staff]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q('set local role authenticated');
    const {rows}=await q("insert into public.notes(title,hidden_from_level2) values ('order A',false),('order B',true),('order C',false) returning id");
    const [a,b,c]=rows.map(row=>row.id);
    await q('select public.owner_move_note($1,$2,false)',[a,c]);
    const read=()=>q("select id from public.get_notes_page('order',null,null,10)");
    assert.deepEqual((await read()).rows.map(row=>row.id),[a,c,b]);
    await q('select public.owner_move_note($1,$2,true)',[a,b]);
    assert.deepEqual((await read()).rows.map(row=>row.id),[c,b,a]);
    const page2=await q("select id from public.get_notes_page('order',(select updated_at from public.notes where id=$1),$1,1)",[b]);
    assert.deepEqual(page2.rows,[{id:a}]);
    await q(`select public.owner_save_knowledge_articles(null,'{"articles":[]}')`);
    await q('savepoint conflict');
    await assert.rejects(q(`select public.owner_save_knowledge_articles(null,'{"articles":[]}')`),/เครื่องอื่น/);
    await q('rollback to conflict');
    await q("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
    assert.deepEqual((await read()).rows.map(row=>row.id),[c,a]);
    assert.deepEqual((await q('select note_id from private.note_positions where note_id=$1',[b])).rows,[]);
    await assert.rejects(q('select public.owner_move_note($1,$2,true)',[c,a]),/owner access/);
    console.log('Topic order: persisted moves, pagination, hidden notes, staff permissions and concurrent article edits passed');
  }finally{await q('rollback');}
}
