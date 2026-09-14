const assert=require('node:assert/strict');
const {test}=require('node:test');
const vm=require('node:vm');
const source=require('./load-app-source')();
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function setup(){
  const ctx=vm.createContext({console,Map,Set,JSON,Date,Number,String,Array,Promise,Object,
    currentProfile:{id:'test'},inspectionLists:[],syncedTableRows:{inspection_lists:new Map()},
    documentPrefixes:{inspection:'CHECK'},additionalData:(value,omit)=>Object.fromEntries(Object.entries(value).filter(([key])=>!omit.includes(key))),
    noteCoreSyncFailure:()=>false});
  vm.runInContext(section('function canonicalProductInsertValue(','function productInsertMetadataRow(')+
    section('function normalizeInspectionLists(','function workspaceSnapshot(')+
    section('function inspectionListToRow(','async function loadInspectionListsFromSupabase('),ctx);
  ctx.syncAcknowledgement=(_table,rows,toRow)=>row=>ctx.syncedTableRows.inspection_lists.set(String(row.id),JSON.stringify(toRow(row)));
  return ctx;
}
function record(){return {id:'CHECK-1',name:'ตรวจสินค้า',warehouseId:1,items:[{pid:10,unit:'กล่อง'}],createdAt:'2026-09-14T01:29:50.054Z',createdBy:'test',updatedAt:'2026-09-14T01:30:55.834Z',stockAdjustedAt:'2026-09-14T01:30:55.834Z',stockAdjustedBy:'test',stockAdjustmentDocumentNo:'SC1',_clientCreateToken:'token',_revision:1};}
test('normalizing inspection cache retains warehouse, completion document and revision',()=>{
  const c=setup(),row=c.normalizeInspectionLists([record()])[0];
  assert.equal(row.warehouseId,1);assert.equal(row.stockAdjustmentDocumentNo,'SC1');assert.equal(row._revision,1);
});
test('count RPC completion is acknowledged by reading server revision, without a second write',async()=>{
  const c=setup(),local=record(),remote={...local,_revision:2,stockAdjustedAt:'2026-09-14 01:30:55.834+00'};
  c.inspectionLists=[local];let writes=0,reads=0;
  c.sb={from:table=>{assert.equal(table,'inspection_lists');return {select:()=>({in:async()=>{reads++;return {data:[c.inspectionListToRow(remote)],error:null};}})};}};
  c.upsertAndPrune=async(_table,rows,toRow)=>{for(const row of rows) if(c.syncedTableRows.inspection_lists.get(row.id)!==JSON.stringify(toRow(row))) writes++;return true;};
  assert.equal(await c.syncInspectionListsToSupabase(),true);
  assert.equal(reads,1);assert.equal(writes,0);assert.equal(c.inspectionLists[0]._revision,2);
  await c.syncInspectionListsToSupabase();assert.equal(reads,1,'clean completion does not poll again');
});
test('completion reconciliation does not swallow independent local edits or another count',()=>{
  const c=setup(),local=record(),remote={...local,_revision:2};
  assert.equal(c.inspectionCompletionMatches(local,remote),true);
  for(const changes of [{name:'edited'},{items:[{pid:11,unit:'เม็ด'}]},{warehouseId:2},{_clientCreateToken:'other'},{stockAdjustmentDocumentNo:'SC2'},{stockAdjustedAt:'2026-09-14T02:30:55Z'}]){
    assert.equal(c.inspectionCompletionMatches({...local,...changes},remote),false,JSON.stringify(changes));
  }
});
test('overlapping inspection saves are serialized and the later edit is sent',async()=>{
  const c=setup();let release,active=0,maxActive=0,calls=0;
  c.reconcileCompletedInspectionLists=async()=>{};
  c.upsertAndPrune=async()=>{calls++;active++;maxActive=Math.max(maxActive,active);if(calls===1) await new Promise(resolve=>release=resolve);active--;return true;};
  const first=c.syncInspectionListsToSupabase();
  await new Promise(resolve=>setImmediate(resolve));
  const second=c.syncInspectionListsToSupabase();release();
  assert.equal(await first,true);assert.equal(await second,true);assert.equal(maxActive,1);assert.equal(calls,2);
});
