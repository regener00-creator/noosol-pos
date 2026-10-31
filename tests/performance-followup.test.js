const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
function section(s,start,end){const a=s.indexOf(start),b=end?s.indexOf(end,a+start.length):s.length;assert.ok(a>=0&&b>a);return s.slice(a,b);}
function productFixture(){
  let now=1000,manifestReads=0,signature='A',fail=false;
  const c=vm.createContext({Date:class extends Date{static now(){return now;}},products:[],productDirtyOperations:new Map(),indexedProductCacheReady:true,
    currentProfile:{id:'owner'},captureWorkspaceRead:()=>({actor:c.currentProfile.id}),isWorkspaceReadCurrent:x=>x.actor===c.currentProfile.id,
    readProductManifestCache:()=>true,sb:{rpc:async()=>fail?{error:{code:'PGRST202'}}:{data:signature}},
    fetchProductRevisionManifest:async()=>{manifestReads++;return {data:[{id:1,revision:1}]};},reconcileProductDirtyOperationsWithRemoteIds:()=>{},
    fetchProductRowsByIds:async ids=>({data:ids.map(id=>({id,_revision:1}))}),rowToProduct:x=>x,mergeRemoteProductsWithDirtyLocal:x=>x,
    persistProductChangesToIndexedDB:async()=>true,saveProductManifestCache:async()=>true});
  vm.runInContext(section(read('sync/product-cache.js'),'let productReadSignature=null;'),c);
  return {c,reads:()=>manifestReads,advance:()=>now+=300001,signature:v=>signature=v,fail:()=>fail=true};
}
test('mobile catalog skips unchanged manifests but rechecks force, dirty, expiry, actor and missing RPC',async()=>{
  const f=productFixture(),load=options=>f.c.loadProductRowsFromSupabase({checkSignature:true,...options});
  await load();assert.equal((await load()).unchanged,true);assert.equal(f.reads(),1);
  await load({force:true});assert.equal(f.reads(),2);
  f.signature('B');await load();assert.equal(f.reads(),3);
  f.c.productDirtyOperations.set('1','update');await load();assert.equal(f.reads(),4);f.c.productDirtyOperations.clear();
  f.advance();await load();assert.equal(f.reads(),5);
  f.c.currentProfile={id:'staff'};await load();assert.equal(f.reads(),6);
  f.fail();await load();await load();assert.equal(f.reads(),8);
});
test('catalog signatures never acknowledge a commit during manifest reads or failed persistence',async()=>{
  const f=productFixture(),original=f.c.fetchProductRevisionManifest;
  f.c.fetchProductRevisionManifest=async()=>{f.signature('B');return original();};
  await f.c.loadProductRowsFromSupabase({checkSignature:true});
  await f.c.loadProductRowsFromSupabase({checkSignature:true});assert.equal(f.reads(),2);
  f.c.persistProductChangesToIndexedDB=async()=>false;
  await f.c.loadProductRowsFromSupabase({checkSignature:true,force:true});
  await f.c.loadProductRowsFromSupabase({checkSignature:true});assert.equal(f.reads(),4);
});
function persistenceFixture(){
  let snapshots=0,fail=false;const writes=[];
  const c=vm.createContext({console:{warn(){}},Date,Promise,workspaceCachePendingSnapshot:null,workspaceSnapshotRequested:false,workspaceCacheWritePromise:Promise.resolve(true),workspacePersistTimer:null,
    value:0,currentActor:'owner',localWorkspaceSnapshot:()=>{snapshots++;return {value:c.value,_recoveryActorId:c.currentActor};},
    setTimeout:()=>1,clearTimeout:()=>{},scheduleSupabaseCoreSync:()=>{},localStorage:{removeItem:()=>{}},
    PRODUCT_CACHE_WORKSPACE_STORE:'workspace',WORKSPACE_STORAGE_KEY:'old',workspaceOutboxVersions:new Map(),
    idbTransactionDone:async()=>{if(fail)throw Error('quota');},writeWorkspaceOutbox:async()=>null,
    openProductCacheDb:async()=>({transaction:()=>({objectStore:()=>({put:row=>writes.push(structuredClone(row))})})}),
    rememberSyncUiError:()=>{},showToast:()=>{}});
  const source=read('sync/workspace-outbox.js');
  vm.runInContext(section(source,'function flushWorkspaceCacheToIndexedDB(){','// Supabase writes are debounced separately.')+
    section(source,'async function ensureWorkspaceRecoveryDurable(){','async function loadWorkspaceRecoveryForUser(){'),c);
  return {c,writes,snapshots:()=>snapshots,fail:value=>fail=value};
}
test('ten rapid saves prepare one latest snapshot; explicit durability flushes before a write',async()=>{
  const f=persistenceFixture();for(let i=1;i<=10;i++){f.c.value=i;await f.c.persistWorkspaceData();}
  assert.equal(f.snapshots(),0);await f.c.flushWorkspaceCacheToIndexedDB();assert.equal(f.snapshots(),1);
  assert.equal(f.writes.find(row=>row.key==='current').value.value,10);
  f.c.value=11;await f.c.persistWorkspaceData();await f.c.ensureWorkspaceRecoveryDurable();assert.equal(f.snapshots(),2);
  await f.c.flushWorkspaceCacheToIndexedDB();assert.equal(f.snapshots(),2);
});
test('failed cache writes retain recovery; later saves and retries preserve newest values',async()=>{
  const f=persistenceFixture();f.fail(true);f.c.value=1;await f.c.persistWorkspaceData();
  assert.equal(await f.c.flushWorkspaceCacheToIndexedDB(),false);assert.equal(f.c.workspaceCachePendingSnapshot.value,1);
  await assert.rejects(f.c.ensureWorkspaceRecoveryDurable(),{code:'LOCAL_STORAGE_UNAVAILABLE'});
  f.fail(false);f.c.value=2;await f.c.persistWorkspaceData();assert.equal(await f.c.flushWorkspaceCacheToIndexedDB(),true);
  assert.equal(f.writes.at(-1).value.value,2);assert.equal(f.c.workspaceCachePendingSnapshot,null);
});
test('a flushed snapshot keeps its original actor while an IndexedDB write is pending',async()=>{
  const f=persistenceFixture();let release;f.c.openProductCacheDb=()=>new Promise(resolve=>{release=()=>resolve({transaction:()=>({objectStore:()=>({put:row=>f.writes.push(structuredClone(row))})})});});
  f.c.value=42;await f.c.persistWorkspaceData();const pending=f.c.flushWorkspaceCacheToIndexedDB();await Promise.resolve();
  f.c.currentActor='staff';f.c.value=0;release();await pending;
  assert.equal(f.writes[1].key,'user:owner');assert.equal(f.writes[1].value.value,42);
});
