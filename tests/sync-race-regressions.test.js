const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function section(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,`${start} is present`);
  return source.slice(from,to);
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const toRow=item=>({id:item.id,name:item.name,data:item.data,revision:item._revision});
function context(extra={}){
  return vm.createContext({console,Map,Set,JSON,Date,Math,Promise,
    syncedTableRows:{},tableSnapshot:(rows,fn)=>new Map(rows.map(item=>[String(item.id),JSON.stringify(fn(item))])),
    generateProductCreateToken:()=> 'test-token',noteCoreSyncFailure:()=>false,SYNC_TABLE_LABELS:{},...extra});
}
function loadSync(ctx){
  vm.runInContext(section('function cloneSyncRecords(','async function upsertRowsInChunks(')+
    section('async function upsertAndPrune(','async function syncWarehousesIncrementally('),ctx);
}
test('master edits made during a delayed acknowledgement are sent on the next sync',async()=>{
  let release;const sent=[];
  const ctx=context({updateRevisionedRows:async(_table,items,fn,ack)=>{
    sent.push(items.map(fn));if(sent.length===1) await new Promise(resolve=>release=resolve);
    items.forEach(item=>{item._revision++;ack(item);});return null;
  }});
  ctx.items=[{id:1,name:'first',data:{phone:'111'},_revision:1}];ctx.toRow=toRow;
  ctx.syncedTableRows.contacts=new Map([['1',JSON.stringify({...toRow(ctx.items[0]),name:'old'})]]);
  loadSync(ctx);
  const first=vm.runInContext("upsertAndPrune('contacts',items,toRow)",ctx);
  ctx.items[0].name='second';ctx.items[0].data.phone='222';release();await first;
  await vm.runInContext("upsertAndPrune('contacts',items,toRow)",ctx);
  assert.deepEqual(sent.map(rows=>rows[0].name),['first','second']);
  assert.equal(sent[0][0].data.phone,'111','nested payload must be detached');
  assert.equal(sent[1][0].revision,2,'retry uses acknowledged revision');
});
test('document sync also preserves edits made during the request',async()=>{
  let release;const sent=[];
  const ctx=context({docToRow:toRow,saveRevisionedDocument:async(_table,item)=>{
    sent.push(toRow(item));if(sent.length===1) await new Promise(resolve=>release=resolve);
    item._revision++;
  }});
  ctx.items=[{id:'Q1',name:'first',_revision:1}];
  ctx.syncedTableRows.quotations=new Map([['Q1',JSON.stringify({...toRow(ctx.items[0]),name:'old'})]]);
  vm.runInContext(section('function cloneSyncRecords(','async function upsertRowsInChunks(')+section('async function syncRevisionedDocuments(','const MEDICINE_LABEL_DURATION_OPTIONS='),ctx);
  const first=vm.runInContext("syncRevisionedDocuments('quotations',items)",ctx);
  ctx.items[0].name='second';release();await first;
  await vm.runInContext("syncRevisionedDocuments('quotations',items)",ctx);
  assert.deepEqual(sent.map(row=>row.name),['first','second']);
});
test('product sync keeps pending edits and sends the new revision instead of losing them',async()=>{
  let release;const sent=[];
  const ctx=context({productMetadataToRow:toRow,productToRow:toRow,
    prepareProductInsertCandidatesForSync:async()=>true,
    persistProductChangesToIndexedDB:async()=>true,
    clearAcknowledgedProductDirtyOperations:async ids=>{ids.forEach(id=>ctx.productDirtyOperations.delete(id));return true;},
    updateProductMetadataInChunks:async(items,ack)=>{
      sent.push(items.map(toRow));if(sent.length===1) await new Promise(resolve=>release=resolve);
      items.forEach(item=>{item._revision++;ack(item);});return null;
    }});
  ctx.products=[{id:1,name:'first',_revision:1}];ctx.productDirtyOperations=new Map([['1','update']]);
  ctx.syncedTableRows.products=new Map([['1',JSON.stringify({...toRow(ctx.products[0]),name:'old'})]]);
  vm.runInContext(section('function cloneSyncRecords(','async function upsertRowsInChunks(')+section('async function syncProductsIncrementally(','let coreSyncInFlight='),ctx);
  const first=vm.runInContext('syncProductsIncrementally()',ctx);
  await tick();ctx.products[0].name='second';release();await first;
  assert.equal(ctx.productDirtyOperations.get('1'),'update');
  await vm.runInContext('syncProductsIncrementally()',ctx);
  assert.deepEqual(sent.map(rows=>rows[0].name),['first','second']);
  assert.equal(ctx.productDirtyOperations.size,0);
});
test('remote deletion never converts a pending edit into an insert',()=>{
  const ctx=context({productDirtyOperations:new Map([['1','update'],['2','delete'],['3','insert']])});
  vm.runInContext(section('function reconcileProductDirtyOperationsWithRemoteIds(','async function loadProductRowsFromSupabase('),ctx);
  vm.runInContext('reconcileProductDirtyOperationsWithRemoteIds([])',ctx);
  assert.equal(ctx.productDirtyOperations.get('1'),'update');
  assert.equal(ctx.productDirtyOperations.has('2'),false);
  assert.equal(ctx.productDirtyOperations.get('3'),'insert');
  vm.runInContext("reconcileProductDirtyOperationsWithChanges([{product_id:1,operation:'delete'}])",ctx);
  assert.equal(ctx.productDirtyOperations.get('1'),'update');
});
function productLoaderContext(){
  let remote=[{id:1,name:'old',revision:1},{id:2,name:'old',revision:1}];
  const fetched=[];
  const ctx=context({products:remote.map(row=>({...row,_revision:row.revision})),productDirtyOperations:new Map(),indexedProductCacheReady:true,
    readProductManifestCache:()=>({version:6}),fetchProductRevisionManifest:async()=>({data:remote.map(({id,revision})=>({id,revision})),error:null}),
    fetchProductRowsByIds:async ids=>{fetched.push([...ids]);return {data:remote.filter(row=>ids.includes(row.id)),error:null};},
    rowToProduct:row=>({...row,_revision:row.revision}),persistProductChangesToIndexedDB:async()=>true,saveProductManifestCache:async()=>true,
    normalizeProductDirtyOperations:value=>new Map(value)});
  vm.runInContext(section('function mergeRemoteProductsWithDirtyLocal(','// Content-hash guard:'),ctx);
  return {ctx,fetched,setRemote:rows=>{remote=rows;}};
}
test('refresh catches a late commit even after observing a newer transaction',async()=>{
  const {ctx,fetched,setRemote}=productLoaderContext();
  setRemote([{id:1,name:'old',revision:1},{id:2,name:'newer-committed-first',revision:2}]);
  await vm.runInContext('loadProductRowsFromSupabase()',ctx);
  setRemote([{id:1,name:'older-committed-later',revision:2},{id:2,name:'newer-committed-first',revision:2}]);
  await vm.runInContext('loadProductRowsFromSupabase()',ctx);
  assert.deepEqual(fetched,[[2],[1]]);
  assert.equal(ctx.products.find(row=>row.id===1).name,'older-committed-later');
});
test('empty manifest removes old clean cache but preserves pending edits',async()=>{
  const {ctx,setRemote}=productLoaderContext();
  ctx.productDirtyOperations.set('1','update');setRemote([]);
  await vm.runInContext('loadProductRowsFromSupabase()',ctx);
  assert.deepEqual(Array.from(ctx.products,row=>row.id),[1]);
  assert.equal(ctx.productDirtyOperations.get('1'),'update');
});
function storage(){const values=new Map();return {get length(){return values.size;},key:i=>[...values.keys()][i]||null,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};}
function eventContext(localStorage,rpc){
  const ctx=context({localStorage,PENDING_CLIENT_EVENTS_KEY:'events',MAX_PENDING_CLIENT_EVENTS:100,currentProfile:{id:'test'},navigator:{onLine:true},sb:{rpc},cloudClean:value=>value,currentDeviceId:()=> 'test'});
  vm.runInContext(section('function readPendingClientEvents(','async function resolveOwnSyncEventsThrough('),ctx);return ctx;
}
test('an event appended during a network request survives acknowledgement and is sent',async()=>{
  let release;const sent=[];const local=storage();
  const ctx=eventContext(local,async(_name,args)=>{sent.push(args.p_operation);if(sent.length===1) await new Promise(resolve=>release=resolve);return {error:null};});
  const a=vm.runInContext("reportClientEvent({operation:'A',message:'first'})",ctx);
  const b=vm.runInContext("reportClientEvent({operation:'B',message:'second'})",ctx);
  release();await Promise.all([a,b]);
  assert.deepEqual(sent,['A','B']);assert.equal(vm.runInContext('readPendingClientEvents().length',ctx),0);
});
test('a second tab can append without the first tab overwriting its event',async()=>{
  let release;const sent=[];const local=storage();
  const first=eventContext(local,async(_name,args)=>{sent.push(args.p_operation);if(sent.length===1) await new Promise(resolve=>release=resolve);return {error:null};});
  const second=eventContext(local,async()=>({error:null}));second.navigator.onLine=false;
  const a=vm.runInContext("reportClientEvent({operation:'A',message:'first'})",first);
  await vm.runInContext("reportClientEvent({operation:'B',message:'second'})",second);
  release();await a;assert.deepEqual(sent,['A','B']);
});
test('a rejected event remains queued without blocking the next event',async()=>{
  const local=storage();const sent=[];
  const ctx=eventContext(local,async(_name,args)=>{sent.push(args.p_operation);return {error:args.p_operation==='bad'?new Error('invalid'):null};});
  ctx.navigator.onLine=false;
  vm.runInContext("enqueuePendingClientEvent({id:'a',createdAt:'2026-09-01',operation:'bad',message:'one'}); enqueuePendingClientEvent({id:'b',createdAt:'2026-09-02',operation:'good',message:'two'})",ctx);
  ctx.navigator.onLine=true;await vm.runInContext('flushPendingClientEvents()',ctx);
  assert.deepEqual(sent,['bad','good']);assert.equal(vm.runInContext('readPendingClientEvents()[0].operation',ctx),'bad');
});
test('legacy event queue is migrated before its shared key is removed',()=>{
  const local=storage();local.setItem('events',JSON.stringify([{id:'old',operation:'old',createdAt:'2026-09-01'}]));
  const ctx=eventContext(local,async()=>({error:null}));
  assert.equal(vm.runInContext('readPendingClientEvents()[0].id',ctx),'old');
  assert.equal(local.getItem('events'),null);assert.ok(local.getItem('events:old'));
});
test('blocked IndexedDB open times out and closes a late connection',async()=>{
  let timeout,request={};let closed=0;const notices=[];
  const ctx=context({productCacheDbPromise:null,window:{indexedDB:true},indexedDB:{open:()=>request},PRODUCT_CACHE_DB_NAME:'test',PRODUCT_CACHE_DB_VERSION:2,
    setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{},showToast:message=>notices.push(message)});
  vm.runInContext(section('function openProductCacheDb(','async function loadProductCacheFromIndexedDB('),ctx);
  const pending=vm.runInContext('openProductCacheDb()',ctx);request.onblocked();
  timeout();await assert.rejects(pending,error=>error.code==='PRODUCT_CACHE_BLOCKED');
  request.result={close:()=>closed++};request.onsuccess();
  assert.equal(closed,1);assert.equal(notices.length,1);
});
test('an open cache connection closes on versionchange',async()=>{
  let request={},closed=0;
  const ctx=context({productCacheDbPromise:null,window:{indexedDB:true},indexedDB:{open:()=>request},PRODUCT_CACHE_DB_NAME:'test',PRODUCT_CACHE_DB_VERSION:2,setTimeout:()=>1,clearTimeout:()=>{}});
  vm.runInContext(section('function openProductCacheDb(','async function loadProductCacheFromIndexedDB('),ctx);
  const pending=vm.runInContext('openProductCacheDb()',ctx);request.result={close:()=>closed++};request.onsuccess();await pending;
  request.result.onversionchange();assert.equal(closed,1);assert.equal(ctx.productCacheDbPromise,null);
});
test('required recovery setup agrees with the server four-character minimum',()=>{
  const admin=fs.readFileSync(path.join(__dirname,'..','supabase/functions/admin-users/index.ts'),'utf8');
  assert.match(admin,/RECOVERY_ANSWER_MIN_LENGTH = 4/);
  assert.match(section('function openOwnerRecoverySetupModal(','function recoverOwnerPassword('),/answer.length<4/);
  assert.doesNotMatch(section('function openOwnerRecoverySetupModal(','function recoverOwnerPassword('),/อย่างน้อย 3 ตัว/);
});
