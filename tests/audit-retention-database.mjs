import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function run({client}){
  const q=(sql,args)=>client.query(sql,args);
  await q('begin');
  try{
    const owner=randomUUID(),staff=randomUUID();
    await q('insert into auth.users(id) values($1),($2)',[owner,staff]);
    await q("insert into public.profiles(id,username,owner,level) values($1,'audit-test-owner',true,1),($2,'audit-test-staff',false,2)",[owner,staff]);
    await q("insert into public.warehouses(id,name) values(1,'Audit test'),(9821,'Audit other') on conflict(id) do nothing");
    const {day,cutoff}= (await q("select ((now() at time zone 'Asia/Bangkok')::date-7)::text as day,private.audit_log_retention_cutoff() as cutoff")).rows[0];
    await q(`insert into public.audit_logs(occurred_at,entity_type,entity_id,action,warehouse_id)
      select ($1::date::timestamp at time zone 'Asia/Bangkok')+make_interval(mins=>n),'audit_test',n::text,'update',1 from generate_series(0,44) n`,[day]);
    await q(`insert into public.audit_logs(occurred_at,entity_type,entity_id,action,warehouse_id) values
      (($1::date::timestamp at time zone 'Asia/Bangkok')-interval '1 microsecond','audit_test','before','update',1),
      (($1::date+1)::timestamp at time zone 'Asia/Bangkok','audit_test','after','update',1),
      ($1::date::timestamp at time zone 'Asia/Bangkok','audit_test','other-shop','update',9821),
      ($2::timestamptz-interval '1 microsecond','audit_test','expired','update',1),
      ($2::timestamptz,'audit_test','boundary','update',1)`,[day,cutoff]);
    await q("insert into private.audit_logs_archive select a.*,now() from public.audit_logs a where entity_type='audit_test' and entity_id in ('expired','boundary')");
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q('set local role authenticated');
    const page=async(direction='first',cursor=null)=> (await q(`select public.get_central_audit_log_page(
      p_warehouse_id=>1,p_date_from=>$1::date,p_date_to=>$1::date,p_limit=>20,
      p_entity=>'audit_test',p_direction=>$2,p_cursor_time=>$3::timestamptz,p_cursor_key=>$4,p_include_total=>true) as data`,
      [day,direction,cursor?.occurred_at||null,cursor?.event_key||null])).rows[0].data;
    const first=await page();
    assert.equal(first.totalCount,45);assert.equal(first.rows.length,20);
    assert.equal(first.rows.at(-1).entity_id,'25');
    const second=await page('next',first.rows.at(-1));
    assert.equal(second.rows.length,20);assert.equal(second.rows.at(-1).entity_id,'5');
    const last=await page('last');
    assert.equal(last.rows.length,5);assert.equal(last.rows.at(-1).entity_id,'0');
    assert.equal(last.hasOlder,false);
    assert.deepEqual((await page('previous',last.rows[0])).rows,second.rows);
    assert.deepEqual((await page('next',second.rows.at(-1))).rows,last.rows);
    const legacy=(await q("select public.get_central_audit_log_page(p_warehouse_id=>1,p_entity=>'audit_test',p_include_total=>true) as data")).rows[0].data;
    assert.equal(legacy.totalCount,48,'legacy tabs also exclude expired events');
    await q('savepoint invalid_dates');
    await assert.rejects(q("select public.get_central_audit_log_page(1,$1::date+1,$1::date)",[day]),/วันเริ่มต้น/);
    await q('rollback to invalid_dates');
    await q("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
    await q('savepoint staff_denied');
    await assert.rejects(page(),/owner access required/);
    await q('rollback to staff_denied');
    await q('reset role');
    assert.equal((await q("select has_function_privilege('authenticated','private.prune_audit_log_history(integer)','execute') as allowed")).rows[0].allowed,false);
    const sourceCounts=async()=> (await q(`select
      (select count(*) from public.sales) as sales,
      (select count(*) from public.inventory_count_adjustments) as adjustments,
      (select count(*) from public.inventory_lot_movements) as movements`)).rows[0];
    const before=await sourceCounts();
    assert.equal(Number((await q('select private.prune_audit_log_history(1) as removed')).rows[0].removed),2);
    assert.equal((await q("select count(*)::int as count from public.audit_logs where entity_type='audit_test' and entity_id='boundary'")).rows[0].count,1);
    assert.equal((await q("select count(*)::int as count from private.audit_logs_archive where entity_type='audit_test' and entity_id='boundary'")).rows[0].count,1);
    assert.equal(Number((await q('select private.prune_audit_log_history(1) as removed')).rows[0].removed),0);
    assert.deepEqual(await sourceCounts(),before);
    const jobs=(await q("select schedule,command from cron.job where jobname='pepos-bounded-data-retention'")).rows;
    assert.deepEqual(jobs,[{schedule:'17 17 * * *',command:'select private.run_data_retention(5000);'}]);
    const definition=(await q("select pg_get_functiondef('private.run_data_retention(integer)'::regprocedure) as body")).rows[0].body;
    assert.match(definition,/private.prune_audit_log_history/);
    assert.doesNotMatch(definition,/insert into private.audit_logs_archive/);
    console.log('Audit: Bangkok boundaries, filtered pagination, legacy calls, permissions, exact retention cutoff and document preservation passed');
  }finally{await q('rollback');}
}
