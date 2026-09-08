const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=source.indexOf('async function updateProductMetadataInChunks(');
const code=source.slice(start,source.indexOf('function revisionConflictError(',start));
const toRow=p=>({id:p.id,name:p.name,price:p.price,data:p.data||{},revision:p._revision});
function setup(remoteRows,baseline=[]){
  const remote=new Map(remoteRows.map(r=>[r.id,structuredClone(r)]));
  const writes=[],reads=[],acks=[];
  let beforeUpdate=()=>{};
  const ctx=vm.createContext({Map,JSON,Object,Number,Array,Error,Promise,
    productMetadataToRow:toRow,rowToProduct:r=>({...r,_revision:r.revision}),
    syncedTableRows:{products:new Map(baseline.map(r=>[String(r.id),JSON.stringify(r)]))},
    sb:{from(){
      let changes=null,id,revision;
      const q={update(v){changes=v;return q;},select(){return q;},eq(k,v){if(k==='id')id=v;else revision=v;return q;},async maybeSingle(){
        if(!changes){reads.push(id);return {data:structuredClone(remote.get(id)||null)};}
        writes.push({id,revision,changes});beforeUpdate(remote,writes.length);
        const row=remote.get(id);
        if(!row||row.revision!==revision)return {data:null};
        Object.assign(row,changes,{revision:revision+1});return {data:{id,revision:row.revision}};
      }};return q;
    }}});
  vm.runInContext(code,ctx);
  return {ctx,remote,writes,reads,acks,run:items=>ctx.updateProductMetadataInChunks(items,p=>acks.push(structuredClone(p))),race:fn=>beforeUpdate=fn};
}
test('lost response / stale revision with identical metadata is acknowledged without overwriting',async()=>{
  const s=setup([{id:1,name:'A',price:100,data:{b:2,a:1},revision:8}]);
  const error=await s.run([{id:1,name:'A',price:100,data:{a:1,b:2},_revision:7}]);
  assert.equal(error,null);assert.equal(s.acks[0]._revision,8);assert.equal(s.remote.get(1).revision,8);
  assert.equal(s.writes.length,1);
});
test('revision-only changes safely retry using fresh revision and known metadata baseline',async()=>{
  const old={id:1,name:'A',price:100,data:{},revision:1};
  const s=setup([{...old,revision:4}],[old]);
  assert.equal(await s.run([{...old,price:120,_revision:1}]),null);
  assert.deepEqual(s.writes.map(w=>w.revision),[1,4]);assert.equal(s.remote.get(1).price,120);
  assert.equal(s.acks[0]._revision,5);
});
test('genuine conflicts keep local draft, pause repeated requests and still send later batches',async()=>{
  const remote=Array.from({length:14},(_,i)=>({id:i+1,name:'A',price:100,data:{},revision:i===0?2:1}));
  remote[0].name='Changed elsewhere';
  const s=setup(remote);
  const local=remote.map(r=>({...r,name:'Local draft',_revision:1}));
  const error=await s.run(local);
  assert.equal(error.code,'REVISION_CONFLICT');assert.equal(error.productId,1);
  assert.equal(s.acks.length,13);assert.equal(s.remote.get(14).name,'Local draft');
  assert.equal(s.remote.get(1).name,'Changed elsewhere');assert.equal(local[0].name,'Local draft');
  const count=s.writes.length,reads=s.reads.length;
  assert.equal((await s.run([local[0]])).syncPaused,true);
  assert.equal(s.writes.length,count);assert.equal(s.reads.length,reads);
  local[0].price=150;await s.run([local[0]]);assert.equal(s.writes.length,count+1);
});
test('concurrent edit during safe rebase is not overwritten',async()=>{
  const old={id:1,name:'A',price:100,data:{},revision:1};
  const s=setup([{...old,revision:2}],[old]);
  s.race((rows,n)=>{if(n===2)Object.assign(rows.get(1),{price:999,revision:3});});
  assert.equal((await s.run([{...old,price:120,_revision:1}])).code,'REVISION_CONFLICT');
  assert.equal(s.remote.get(1).price,999);assert.equal(s.acks.length,0);
});
test('missing/deleted remote product is never re-created',async()=>{
  const s=setup([]);assert.equal((await s.run([{id:1,name:'A',price:1,_revision:2}])).code,'REVISION_CONFLICT');
  assert.equal(s.remote.size,0);assert.equal(s.acks.length,0);
});
test('successful rows leave dirty queue even while another product stays conflicted',async()=>{
  const old=[{id:1,name:'A',price:100,data:{},revision:1},{id:2,name:'B',price:100,data:{},revision:1}];
  const s=setup([{...old[0],price:200,revision:2},old[1]],old),ctx=s.ctx;
  Object.assign(ctx,{console:{warn(){}},products:old.map(r=>({...r,price:150,_revision:1})),productDirtyOperations:new Map([['1','update'],['2','update']]),
    prepareProductInsertCandidatesForSync:async()=>true,
    tableSnapshot:(rows,fn)=>new Map(rows.map(row=>[String(row.id),JSON.stringify(fn(row))])),
    noteCoreSyncFailure:()=>false,persistProductChangesToIndexedDB:async()=>true,
    clearAcknowledgedProductDirtyOperations:async ids=>{ids.forEach(id=>ctx.productDirtyOperations.delete(id));return true;}});
  const helpers=source.slice(source.indexOf('function cloneSyncRecords('),source.indexOf('async function upsertRowsInChunks('));
  const sync=source.slice(source.indexOf('async function syncProductsIncrementally('),source.indexOf('let coreSyncInFlight='));
  vm.runInContext(helpers+sync,ctx);
  assert.equal(await ctx.syncProductsIncrementally(),false);
  assert.deepEqual([...ctx.productDirtyOperations.keys()],['1']);
  assert.equal(ctx.products[0].price,150);assert.equal(ctx.products[1]._revision,2);
  const sent=s.writes.length;
  assert.equal(await ctx.syncProductsIncrementally(),false);assert.equal(s.writes.length,sent);
});
test('product conflict does not block other tables or emit duplicate events on paused retry',async()=>{
  const calls=[],reports=[];
  const ctx=vm.createContext({console:{warn(){}},Date,Error,
    currentProfile:{id:'owner'},currentTab:'products',coreSyncInFlight:false,coreSyncPending:false,coreSyncFailureDetail:null,
    adoptRemoteMaintenanceEpoch:async()=>false,setSyncUiState:()=>{},loggedInUser:()=>({owner:true}),syncWarehousesIncrementally:async()=>true,
    contacts:[],contactToRow:x=>x,salesRepresentatives:[],salesRepToRow:x=>x,DOC_TABLES:[['quotations',()=>[]]],documentLoadStates:{quotations:{loaded:true}},
    syncProductsIncrementally:async()=>{ctx.coreSyncFailureDetail={error:{code:'REVISION_CONFLICT',syncPaused:reports.length>0},operation:'update_products'};return false;},
    upsertAndPrune:async table=>{calls.push(table);return true;},syncRevisionedDocuments:async table=>{calls.push(table);},
    syncInspectionListsToSupabase:async()=>{calls.push('inspection_lists');return true;},
    resolveOwnSyncEventsThrough:async()=>{throw new Error('must not close unresolved conflict');},
    rememberSyncUiError:()=>({}),reportClientEvent:x=>reports.push(x),showToast:()=>{}});
  const start=source.indexOf('async function syncCoreDataToSupabase(');
  vm.runInContext(source.slice(start,source.indexOf('// Stock never travels',start)),ctx);
  await ctx.syncCoreDataToSupabase();await ctx.syncCoreDataToSupabase();
  assert.deepEqual(calls,['contacts','sales_representatives','quotations','inspection_lists','contacts','sales_representatives','quotations','inspection_lists']);
  assert.equal(reports.length,1);assert.equal(ctx.coreSyncInFlight,false);
});
