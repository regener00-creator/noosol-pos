const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
function fixture(){
  let now=100000,reads=0,checks=0,signature='a'.repeat(32),rows=[];
  const query=new Proxy({},{get:()=>()=>query});
  const c=vm.createContext({console,Date:class extends Date{static now(){return now;}},currentProfile:{id:'owner'},
    salesHistory:[],cart:[],TODAY_STR:'2026-10-31',onDemandTabErrors:new Map(),onDemandTabJobs:new Map(),
    syncedTableRows:{},workspaceRecoveryEntries:new Map(),refreshDataCounters:()=>{},maxArrayValue:()=>1,
    quotations:[],invoicesAR:[],creditNotes:[],purchaseOrders:[],goodsReceipts:[],productExchanges:[],productReturns:[],transfers:[],standaloneTaxInvoices:[],
    sb:{from:()=>query,rpc:async()=>{checks++;return {data:signature};}},currentWorkspacePendingChanges:()=>[]});
  vm.runInContext(read('data/pagination.js')+read('sync/read-signatures.js')+read('sync/sales-history.js')+read('sync/documents.js'),c);
  const outbox=read('sync/workspace-outbox.js');vm.runInContext(outbox.slice(outbox.indexOf('function mergeWorkspaceRemoteRows('),outbox.indexOf('async function reconcileLegacyWorkspaceRows(')),c);
  c.fetchBoundedRows=async()=>{reads++;return {data:structuredClone(rows)};};c.fetchAllRows=c.fetchBoundedRows;
  return {c,rows:value=>rows=value,signature:value=>signature=value.repeat(32),advance:()=>now+=60001,reads:()=>reads,checks:()=>checks};
}
const options={from:'2026-10-01',to:'2026-10-31',includeHolds:false,includeRecent:false};
for(const table of ['sales','quotations']) test(`${table}: unchanged expiry reuses body; changes, deletes and forced reads refresh`,async()=>{
  const f=fixture(),load=force=>table==='sales'?f.c.loadSalesHistoryFromSupabase({...options,force}):f.c.loadDocumentTableFromSupabase(table,{recent:true,force});
  f.rows([{id:'A',sale_date:'2026-10-31',revision:1,total:10,data:{total:10}}]);await load();
  const original=table==='sales'?f.c.salesHistory[0]:f.c.quotations[0];
  f.advance();await load();assert.equal(f.reads(),1);assert.equal(f.checks(),2);
  assert.equal(table==='sales'?f.c.salesHistory[0]:f.c.quotations[0],original);
  f.signature('b');f.rows([{id:'A',sale_date:'2026-10-31',revision:2,total:20,data:{total:20}}]);f.advance();await load();assert.equal(f.reads(),2);
  f.signature('c');f.rows([]);f.advance();await load();assert.equal(table==='sales'?f.c.salesHistory.length:f.c.quotations.length,0);
  await load(true);assert.equal(f.reads(),4,'manual force never trusts the unchanged signature');
});
test('same table signature cannot certify another range, evicted coverage or another account',async()=>{
  const f=fixture();await f.c.loadSalesHistoryFromSupabase(options);
  f.advance();await f.c.loadSalesHistoryFromSupabase({...options,from:'2026-09-01',to:'2026-09-30'});assert.equal(f.reads(),2);
  vm.runInContext('salesFreshRequests.length=0',f.c);await f.c.loadSalesHistoryFromSupabase(options);assert.equal(f.reads(),3);
  f.c.clearLoadedHistoryMemory();f.c.currentProfile={id:'staff'};await f.c.loadSalesHistoryFromSupabase(options);assert.equal(f.reads(),4);
});
test('commit during full read is detected on the next refresh, not incorrectly acknowledged',async()=>{
  const f=fixture();let bodies=0;
  f.c.fetchBoundedRows=async()=>{bodies++;f.signature('b');return {data:[{id:'A',sale_date:'2026-10-31',total:bodies}]};};
  await f.c.loadSalesHistoryFromSupabase(options);f.advance();await f.c.loadSalesHistoryFromSupabase(options);
  assert.equal(bodies,2);f.advance();await f.c.loadSalesHistoryFromSupabase(options);assert.equal(bodies,2);
});
test('missing signature RPC and connection errors fall back; errors never extend freshness',async()=>{
  const f=fixture();f.c.sb.rpc=async()=>({error:{code:'PGRST202'}});
  await f.c.loadSalesHistoryFromSupabase(options);f.advance();await f.c.loadSalesHistoryFromSupabase(options);assert.equal(f.reads(),2);
  f.c.fetchBoundedRows=async()=>({error:new Error('read failed')});f.advance();await assert.rejects(f.c.loadSalesHistoryFromSupabase(options),/read failed/);
  assert.equal(f.c.salesRequestLoaded({range:{from:options.from,to:options.to}}),false);
});
test('concurrent expired requests share the same signature and body request',async()=>{
  const f=fixture();await Promise.all([f.c.loadSalesHistoryFromSupabase(options),f.c.loadSalesHistoryFromSupabase(options)]);
  assert.equal(f.checks(),1);assert.equal(f.reads(),1);
});
