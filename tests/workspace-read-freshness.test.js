const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
function fixture(){
  let now=1000,calls=0,rows=[];
  const c=vm.createContext({console,Date:class extends Date{static now(){return now;}},currentProfile:{id:'owner'},
    salesHistory:[],cart:[],TODAY_STR:'2026-10-24',onDemandTabErrors:new Map(),onDemandTabJobs:new Map(),
    syncedTableRows:{},workspaceRecoveryEntries:new Map(),refreshDataCounters:()=>{},maxArrayValue:()=>1,
    quotations:[],invoicesAR:[],creditNotes:[],purchaseOrders:[],goodsReceipts:[],productExchanges:[],productReturns:[],transfers:[],standaloneTaxInvoices:[]});
  vm.runInContext(read('data/pagination.js')+read('sync/sales-history.js')+read('sync/documents.js'),c);
  const outbox=read('sync/workspace-outbox.js');
  vm.runInContext(outbox.slice(outbox.indexOf('function mergeWorkspaceRemoteRows('),outbox.indexOf('async function reconcileLegacyWorkspaceRows(')),c);
  c.currentWorkspacePendingChanges=()=>{
    const base=c.syncedTableRows.quotations||new Map(),pending=[];
    for(const row of c.quotations) if(base.get(String(row.id))!==JSON.stringify(c.docToRow(row))) pending.push({table:'quotations',id:String(row.id),record:row,baseline:base.get(String(row.id))});
    for(const [id,baseline] of base) if(!c.quotations.some(row=>String(row.id)===id)) pending.push({table:'quotations',id,record:null,baseline});
    return pending;
  };
  const query=new Proxy({},{get:()=>()=>query});c.sb={from:()=>query};
  c.fetchBoundedRows=async()=>{calls++;return {data:structuredClone(rows)};};c.fetchAllRows=c.fetchBoundedRows;
  return {c,rows:value=>rows=value,advance:()=>now+=60001,calls:()=>calls};
}
test('documents expire and refresh another-device inserts/updates/deletions while preserving unsent work',async()=>{
  const f=fixture();f.rows([{id:'Q1',revision:1,data:{date:'2026-10-24',total:10}},{id:'Q2',revision:1,data:{total:20}}]);
  await f.c.loadDocumentTableFromSupabase('quotations',{recent:true});
  f.c.quotations[1].total=25;
  f.rows([{id:'Q2',revision:2,data:{total:200}},{id:'Q3',revision:1,data:{total:30}}]);
  await f.c.loadDocumentTableFromSupabase('quotations',{recent:true});assert.equal(f.calls(),1);
  f.advance();await f.c.loadDocumentTableFromSupabase('quotations',{recent:true});
  assert.equal(f.calls(),2);assert.deepEqual(Array.from(f.c.quotations,row=>[row.id,row.total]),[['Q2',25],['Q3',30]]);
  assert.equal(f.c.syncedTableRows.quotations.has('Q1'),false,'remote delete cannot become a pending local delete');
  assert.equal(JSON.parse(f.c.syncedTableRows.quotations.get('Q2')).revision,1,'dirty baseline retained for revision checking');
});
test('document refresh preserves a pending deletion and rejects responses after logout',async()=>{
  const f=fixture();f.rows([{id:'Q1',data:{}}]);await f.c.loadDocumentTableFromSupabase('quotations',{recent:true});
  f.c.quotations=[];f.advance();await f.c.loadDocumentTableFromSupabase('quotations',{recent:true});assert.equal(f.c.quotations.length,0);
  let finish;f.c.fetchBoundedRows=()=>new Promise(resolve=>finish=resolve);
  const job=f.c.loadDocumentTableFromSupabase('quotations',{recent:true,force:true});
  f.c.clearLoadedHistoryMemory();f.c.currentProfile={id:'other'};
  finish({data:[{id:'OLD',data:{}}]});assert.equal(await job,false);assert.equal(f.c.quotations.length,0);
});
test('old product response cannot replace or persist the next account catalog',async()=>{
  const {c}=fixture();vm.runInContext(read('sync/product-cache.js'),c);
  let finish,writes=0;c.products=[{id:2,name:'new user'}];c.productDirtyOperations=new Map();
  c.fetchProductRevisionManifest=()=>new Promise(resolve=>finish=resolve);
  c.persistProductChangesToIndexedDB=async()=>{writes++;return true;};
  const job=c.loadProductRowsFromSupabase();c.clearLoadedHistoryMemory();c.currentProfile={id:'next'};
  finish({data:[{id:1,revision:2}]});assert.equal((await job).stale,true);
  assert.equal(c.products[0].id,2);assert.equal(writes,0);
});
test('core loader ignores old permissions, contacts and warehouse responses after switching users',async()=>{
  const {c}=fixture();vm.runInContext(read('sync/settings-and-favorites.js'),c);
  const releases=[];c.adoptRemoteMaintenanceEpoch=async()=>false;c.loadProductRowsFromSupabase=async()=>({data:[{id:1}]});
  c.fetchAllRows=()=>new Promise(resolve=>releases.push(resolve));c.warehouses=[{id:99}];c.contacts=[{id:99}];
  const job=c.loadCoreDataFromSupabase();while(!releases.length) await Promise.resolve();
  c.clearLoadedHistoryMemory();c.currentProfile={id:'next'};
  releases.forEach(resolve=>resolve({data:[{id:1}]}));assert.equal(await job,false);
  assert.equal(c.warehouses[0].id,99);assert.equal(c.contacts[0].id,99);
});
test('sales memory eviction keeps active report, held and offline rows and invalidates old coverage',async()=>{
  const f=fixture();f.c.salesHistory=Array.from({length:11000},(_,i)=>({id:'old'+i,date:'2026-09-01',status:'done'}));
  f.c.salesHistory.push({id:'pending',date:'2026-01-01',offlinePending:true},{id:'held',date:'2026-01-01',status:'hold'});
  f.rows([{id:'today',sale_date:'2026-10-24',status:'done'}]);
  await f.c.loadSalesHistoryFromSupabase({from:'2026-10-24',to:'2026-10-24',includeHolds:false,includeRecent:false});
  assert.equal(f.c.salesHistory.length,10000);
  for(const id of ['today','pending','held']) assert.ok(f.c.salesHistory.some(row=>row.id===id));
  assert.equal(f.c.salesRequestLoaded({range:{from:'2026-09-01',to:'2026-09-01'}}),false);
});

test('product response after same-account relogin is ignored even after manifest completed',async()=>{
  const {c}=fixture();vm.runInContext(read('sync/product-cache.js'),c);
  c.products=[{id:1,_revision:1}];c.productDirtyOperations=new Map();c.reconcileProductDirtyOperationsWithRemoteIds=()=>{};
  c.fetchProductRevisionManifest=async()=>({data:[{id:1,revision:2}]});
  let finish;c.fetchProductRowsByIds=()=>new Promise(resolve=>finish=resolve);
  const job=c.loadProductRowsFromSupabase();while(!finish) await Promise.resolve();
  c.clearLoadedHistoryMemory();c.products=[{id:99}];finish({data:[{id:1,revision:2}]});
  assert.equal((await job).stale,true);assert.equal(c.products[0].id,99);
});

test('queued product and manifest cache writes stop before writing after account changes',async()=>{
  const {c}=fixture();vm.runInContext(read('sync/product-cache.js'),c);
  c.products=[{id:1}];c.productDirtyOperationsValue=()=>[];
  for(const write of [()=>c.persistProductsToIndexedDB(c.products),()=>c.saveProductManifestCache()]){
    let finish,writes=0;c.openProductCacheDb=()=>new Promise(resolve=>finish=resolve);
    const job=write();while(!finish) await Promise.resolve();c.clearLoadedHistoryMemory();
    finish({transaction(){writes++;throw new Error('stale write');}});
    assert.equal(await job,false);assert.equal(writes,0);
  }
});

test('full sales report is not truncated by the memory budget',async()=>{
  const f=fixture();f.rows(Array.from({length:10003},(_,i)=>({id:'sale'+i,sale_date:'2026-10-24'})));
  await f.c.loadSalesHistoryFromSupabase({full:true,includeHolds:false,includeRecent:false});
  assert.equal(f.c.salesHistory.length,10003);
});

test('document cache eviction retains unsent rows and removes only clean baselines',async()=>{
  const f=fixture();const old=Array.from({length:2500},(_,i)=>({id:'Q'+i,date:'2026-09-01',_revision:1}));
  f.c.quotations=old;f.c.syncedTableRows.quotations=new Map(old.map(row=>[row.id,JSON.stringify(f.c.docToRow(row))]));
  vm.runInContext('documentLoadStates.quotations.loaded=true',f.c);
  f.c.quotations[0].total=17;
  f.rows([{id:'NEW',data:{date:'2026-10-24'}}]);
  await f.c.loadDocumentTableFromSupabase('quotations',{range:{from:'2026-10-24',to:'2026-10-24'}});
  assert.equal(f.c.quotations.length,2500);assert.ok(f.c.quotations.some(row=>row.id==='Q0'&&row.total===17));
  assert.deepEqual(f.c.currentWorkspacePendingChanges().map(row=>row.id),['Q0']);
  assert.equal(f.c.documentRequestLoaded('quotations',{range:{from:'2026-09-01',to:'2026-09-01'}}),false);
});

test('successful complete refresh clears a former truncated warning',async()=>{
  const f=fixture();vm.runInContext('documentLoadStates.quotations.recentTruncated=true',f.c);
  await f.c.loadDocumentTableFromSupabase('quotations',{recent:true});
  assert.equal(f.c.documentRequestTruncated('quotations',{recent:true}),false);
});

test('maintenance response from a previous session cannot clear current data',async()=>{
  const {c}=fixture();const source=read('sync/workspace-outbox.js');
  vm.runInContext(source.slice(source.indexOf('async function adoptRemoteMaintenanceEpoch('),source.indexOf('function normalizeInspectionLists(')),c);
  let finish,clears=0;c.sb={from:()=>({select:()=>({eq:()=>({maybeSingle:()=>new Promise(resolve=>finish=resolve)})})})};
  c.clearLocalStoreCachesForReset=async()=>{clears++;};c.maintenanceEpoch='old';
  const job=c.adoptRemoteMaintenanceEpoch();c.clearLoadedHistoryMemory();finish({data:{value:{epoch:'new'}}});
  assert.equal(await job,false);assert.equal(clears,0);
});

test('POS search stops at eight active results and cached names follow edits',()=>{
  const c=vm.createContext({products:Array.from({length:3000},(_,id)=>({id,name:'Item '+id,sku:'SKU'+id,active:id!==0})),searchQuery:'item',escapeHtml:String,fmtMoney:String,matchesBarcode:(p,q)=>p.barcode===q});
  const pricing=read('pos/customer-pricing.js');vm.runInContext(pricing.slice(0,pricing.indexOf('function productUnitCost(')),c);
  const view=read('pos/checkout-view.js');vm.runInContext(view.slice(view.indexOf('function renderSearchResults('),view.indexOf('function salesHistoryItemsPreview(')),c);
  let visited=0;const original=c.isProductActive;c.isProductActive=p=>{visited++;return original(p);};
  assert.equal((c.renderSearchResults().match(/class="pos-result"/g)||[]).length,8);assert.equal(visited,9);
  c.products[1].name='New medicine';c.searchQuery='new medicine';assert.match(c.renderSearchResults(),/New medicine/);
  c.products[2].barcode='123456';c.searchQuery='123456';assert.match(c.renderSearchResults(),/Item 2/);
  c.searchQuery='does not exist';assert.match(c.renderSearchResults(),/pos-noresult/);
});

test('a real maintenance reset advances only its own read context',async()=>{
  const {c}=fixture();const source=read('sync/workspace-outbox.js');
  vm.runInContext(source.slice(source.indexOf('async function adoptRemoteMaintenanceEpoch('),source.indexOf('function normalizeInspectionLists(')),c);
  c.sb={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{value:{epoch:'new'}}})})})})};
  c.clearLocalStoreCachesForReset=async()=>{};c.clearRemoteResetSensitiveMemory=()=>c.clearLoadedHistoryMemory();
  c.maintenanceEpoch='old';c.MAINTENANCE_EPOCH_STORAGE_KEY='epoch';c.localStorage={setItem:()=>{}};
  const context=c.captureWorkspaceRead(),other=c.captureWorkspaceRead();
  assert.equal(await c.adoptRemoteMaintenanceEpoch(context),true);
  assert.equal(c.isWorkspaceReadCurrent(context),true);assert.equal(c.isWorkspaceReadCurrent(other),false);
  assert.equal(c.maintenanceEpoch,'new');
});
