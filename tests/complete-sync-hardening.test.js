const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function section(start,end){const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert.ok(from>=0&&to>from);return source.slice(from,to);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('unchanged conflicts stay paused after reload, per user, without losing drafts',async()=>{
  const disk=new Map();
  const storage={getItem:key=>disk.get(key),setItem:(key,value)=>disk.set(key,value)};
  const load=id=>{const ctx=vm.createContext({currentProfile:{id},localStorage:storage,Map,Promise});vm.runInContext(section('function persistentSyncPauseMap(','function productCreateTokenFromRow('),ctx);return ctx;};
  const first=load('owner');const paused=first.persistentSyncPauseMap({},'documents');
  paused.set('quotations:Q1','draft-fingerprint');await tick();
  const reload=load('owner'),after=reload.persistentSyncPauseMap({},'documents');
  assert.equal(after.get('quotations:Q1'),'draft-fingerprint');
  const other=load('staff');assert.equal(other.persistentSyncPauseMap({},'documents').size,0);
  after.clear();await tick();assert.equal(load('owner').persistentSyncPauseMap({},'documents').size,0);
});
test('a conflicting document never blocks unrelated documents or retries unchanged conflicts',async()=>{
  const attempts=[],rows=[{id:'bad',name:'draft',_revision:1},{id:'good',name:'new',_revision:1}];
  const toRow=doc=>({id:doc.id,data:{name:doc.name},revision:doc._revision});
  const ctx=vm.createContext({Map,Set,JSON,console,docToRow:toRow,cloneSyncRecords:structuredClone,
    syncedTableRows:{quotations:new Map()},workspaceRecoveryEntries:new Map(),ensureWorkspaceRecoveryDurable:async()=>{},
    tableSnapshot:(items,fn)=>new Map(items.map(doc=>[doc.id,JSON.stringify(fn(doc))])),
    syncAcknowledgement:()=>doc=>ctx.syncedTableRows.quotations.set(doc.id,JSON.stringify(toRow(doc))),
    saveRevisionedDocument:async(_table,doc)=>{attempts.push(doc.id);if(doc.id==='bad')throw Object.assign(new Error('conflict'),{code:'REVISION_CONFLICT'});doc._revision=2;}
  });
  vm.runInContext(section('async function syncRevisionedDocuments(','const MEDICINE_LABEL_DURATION_OPTIONS='),ctx);
  await assert.rejects(ctx.syncRevisionedDocuments('quotations',rows),e=>e.recordId==='bad');
  assert.deepEqual(attempts,['bad','good']);assert.ok(ctx.syncedTableRows.quotations.has('good'));
  rows[1]._revision=2;
  await assert.rejects(ctx.syncRevisionedDocuments('quotations',rows),e=>e.syncPaused===true);
  assert.deepEqual(attempts,['bad','good'],'do not flood unchanged conflicts on retry');
  rows[0].name='corrected';await assert.rejects(ctx.syncRevisionedDocuments('quotations',rows));
  assert.deepEqual(attempts,['bad','good','bad'],'changed draft may retry');
});
function refreshContext(){
  const ctx=vm.createContext({Map,Set,Number,String,Date,Boolean,Math,console,Promise,
    currentProfile:{id:'owner'},currentTab:'products',editingProductId:null,coreSyncInFlight:false,
    document:{visibilityState:'visible',activeElement:null,querySelector:()=>null},navigator:{onLine:true},
    productDirtyOperations:new Map(),products:[{id:1,name:'old',_revision:1,stock:5,expiry:''}],syncedTableRows:{products:new Map([['1','old']])},
    fetchProductRevisionManifest:async()=>({data:[{id:2,revision:1}],error:null}),
    fetchProductRowsByIds:async()=>({data:[{id:2,name:'new',revision:1}],error:null}),
    rowToProduct:row=>({...row,_revision:row.revision}),productMetadataToRow:row=>row,warehouseStock:()=>3,warehouseExpiry:()=>'',
    rebuildProductLookupMaps:()=>{},render:()=>{},persistProductChangesToIndexedDB:async changes=>{ctx.persisted=changes;},
    restoreSearchInputFocus:()=>{},clearTimeout:()=>{},setTimeout:()=>1
  });
  vm.runInContext(section('let productReviewRefreshInFlight=','// จำหน่วยที่เลือกไว้'),ctx);return ctx;
}
test('PRODUCT refresh adds and removes remote products and updates the local cache',async()=>{
  const ctx=refreshContext();assert.equal(await ctx.refreshProductReviewColors(),true);
  assert.deepEqual(Array.from(ctx.products,p=>p.id),[2]);assert.equal(ctx.products[0].stock,3);
  assert.equal(ctx.syncedTableRows.products.has('1'),false);
  assert.deepEqual(Array.from(ctx.persisted.deletedIds),[1]);
});
test('an edit begun during a refresh is never deleted or replaced',async()=>{
  const ctx=refreshContext();ctx.fetchProductRowsByIds=async()=>{ctx.productDirtyOperations.set('1','update');ctx.products[0].name='local draft';return {data:[{id:2,name:'new',revision:1}]};};
  await ctx.refreshProductReviewColors();assert.equal(ctx.products.find(p=>p.id===1).name,'local draft');
  assert.deepEqual(Array.from(ctx.persisted.deletedIds),[]);
});
test('unchanged PRODUCT refresh backs off to one minute and resumes after changes',async()=>{
  const ctx=refreshContext();ctx.fetchProductRevisionManifest=async()=>({data:[{id:1,revision:1}]});
  await ctx.refreshProductReviewColors();assert.equal(vm.runInContext('productReviewRefreshDelay',ctx),30000);
  vm.runInContext('productReviewRefreshAt=0',ctx);await ctx.refreshProductReviewColors();assert.equal(vm.runInContext('productReviewRefreshDelay',ctx),60000);
  ctx.fetchProductRevisionManifest=async()=>({data:[{id:2,revision:1}]});
  vm.runInContext('productReviewRefreshAt=0',ctx);await ctx.refreshProductReviewColors();assert.equal(vm.runInContext('productReviewRefreshDelay',ctx),15000);
});
test('unavailable SDK does not crash before login fallback and bootstrap is awaitable',()=>{
  assert.match(source,/sb\?\.auth\.onAuthStateChange/);
  assert.match(source,/window\.peposBootstrapReady=\(async function bootstrapAuth/);
});
