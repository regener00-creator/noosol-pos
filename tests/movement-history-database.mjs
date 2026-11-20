import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function run({client}){
  const q=(sql,args)=>client.query(sql,args);
  const owner=randomUUID(),staff=randomUUID(),stores=[1,9821],ids=[randomUUID(),randomUUID()];
  await q('begin');
  try{
    await q('insert into auth.users(id) values($1),($2)',[owner,staff]);
    await q("insert into public.profiles(id,username,owner,level) values($1,'movement-owner',true,1),($2,'movement-staff',false,2)",[owner,staff]);
    await q("insert into public.warehouses(id,name) values(1,'Original'),(9821,'Second') on conflict(id) do nothing");
    await q("insert into public.profile_page_permissions(user_id,page_key,can_view) values($1,'inventorymovement',true)",[staff]);
    await q("insert into public.profile_warehouse_access(user_id,warehouse_id,can_sell,can_manage_stock) values($1,1,true,false)",[staff]);
    for(const [i,store] of stores.entries()){
      await q("insert into public.products(id,warehouse_id,name,unit,data) values($1,$2,'Product','box','{}')",[98100+i,store]);
      await q("insert into public.inventory_count_adjustments(id,document_no,warehouse_id,reason,created_by_name) values($1,$2,$3,'test adjustment','Owner')",[ids[i],'TEST-'+store,store]);
      await q("insert into public.inventory_count_adjustment_lines(adjustment_id,product_id,system_stock,counted_stock,difference,unit_name,allocations) values($1,$2,3,$3,$4,'box','[{},{}]')",[ids[i],98100+i,3+(i?2:-1),i?2:-1]);
      await q("insert into public.audit_logs(entity_id,entity_type,action,warehouse_id,actor_name) values('same-id','sales','update',$1,$2),('same-id-extra','sales','update',$1,'wrong'),('same-id','goods_receipts','update',$1,'wrong')",[store,'actor-'+store]);
    }
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q('set local role authenticated');
    const rows=async store=>(await q("select * from public.report_posted_adjustments($1,current_date-1,current_date+1)",[store])).rows;
    const history=async(store,entity,id)=>(await q("select * from public.movement_document_history($1,$2,$3)",[store,entity,id])).rows;
    for(const [i,store] of stores.entries()){
      const result=await rows(store);
      assert.equal(result.length,1);assert.equal(result[0].document_id,ids[i]);
      assert.equal(Number(result[0].difference),i?2:-1);
      assert.deepEqual(await rows(store),result);
      assert.equal((await history(store,'inventory_count',ids[i])).length,1);
      assert.equal((await history(store,'inventory_count',ids[1-i])).length,0);
      assert.deepEqual((await history(store,'sales','same-id')).map(e=>e.actor_name),['actor-'+store]);
    }
    await q("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
    assert.equal((await rows(1)).length,1);assert.equal((await rows(9821)).length,0);
    await assert.rejects(history(1,'sales','same-id'),/owner access required/);
  }finally{await q('rollback');}
  console.log('Two-store confirmed movements and owner-only history passed');
}
