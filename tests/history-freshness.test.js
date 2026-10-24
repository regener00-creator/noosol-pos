const assert=require('node:assert/strict');
const test=require('node:test');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const options={from:'2026-10-24',to:'2026-10-24',includeHolds:false,includeRecent:false};
function fixture(){
  let now=100000,calls=0,rows=[{id:'A',sale_date:'2026-10-24',total:100,data:{}}];
  const query=new Proxy({},{get:()=>()=>query});
  const c=vm.createContext({console,Date:class extends Date{static now(){return now;}},Map,Set,Number,String,JSON,Promise,
    TODAY_STR:'2026-10-24',salesHistory:[],cart:[],currentProfile:{id:'owner'},sb:{from:()=>query},
    maxArrayValue:()=>1000,DOC_TABLES:[],resetDocumentLoadStates:()=>{},onDemandTabErrors:new Map(),onDemandTabJobs:new Map()});
  vm.runInContext(read('src/data/pagination.js')+'\n'+read('src/sync/sales-history.js'),c);
  c.fetchBoundedRows=async()=>{calls++;return {data:structuredClone(rows),error:null};};
  return {c,setRows:value=>rows=value,advance:ms=>now+=ms,calls:()=>calls};
}
test('history reuses fresh requests, then refreshes another device bill after TTL',async()=>{
  const f=fixture();await f.c.loadSalesHistoryFromSupabase(options);
  f.setRows([{id:'A',sale_date:'2026-10-24',total:100},{id:'B',sale_date:'2026-10-24',total:200}]);
  await f.c.loadSalesHistoryFromSupabase(options);assert.equal(f.calls(),1);
  f.advance(60001);assert.equal(f.c.salesRequestLoaded({range:options}),false);
  await f.c.loadSalesHistoryFromSupabase(options);
  assert.equal(f.calls(),2);assert.equal(f.c.salesHistory.length,2);
});
test('an old response cannot repopulate history or remove the next user request',async()=>{
  const {c}=fixture();let oldResolve,newResolve;
  c.fetchBoundedRows=()=>new Promise(resolve=>oldResolve=resolve);
  const old=c.loadSalesHistoryFromSupabase(options);
  c.clearLoadedHistoryMemory();c.currentProfile={id:'cashier'};
  c.fetchBoundedRows=()=>new Promise(resolve=>newResolve=resolve);
  const next=c.loadSalesHistoryFromSupabase(options);
  oldResolve({data:[{id:'PRIVATE'}]});assert.equal(await old,false);
  assert.equal(c.salesHistory.length,0);
  assert.equal(vm.runInContext('salesLoadPromises.size',c),1);
  newResolve({data:[{id:'ALLOWED',sale_date:'2026-10-24'}]});await next;
  assert.equal(c.salesHistory[0].id,'ALLOWED');
});
test('logout and re-login to same account still invalidates in-flight responses',async()=>{
  const {c}=fixture();let finish;
  c.fetchBoundedRows=()=>new Promise(resolve=>finish=resolve);
  const job=c.loadSalesHistoryFromSupabase(options);c.clearLoadedHistoryMemory();
  finish({error:{message:'old request denied'}});
  assert.equal(await job,false);assert.equal(c.salesHistory.length,0);
});
test('forced refresh preserves newly posted and offline receipts during the read',async()=>{
  const {c}=fixture();await c.loadSalesHistoryFromSupabase(options);
  let finish;c.fetchBoundedRows=()=>new Promise(resolve=>finish=resolve);
  const job=c.loadSalesHistoryFromSupabase({...options,force:true});
  c.salesHistory.push({id:'NEW',date:'2026-10-24'},{id:'OFF',date:'2026-10-24',offlinePending:true});
  finish({data:[]});await job;
  assert.deepEqual(Array.from(c.salesHistory,s=>s.id).sort(),['NEW','OFF']);
});
test('refreshing another window cannot renew a stale window',async()=>{
  const f=fixture();await f.c.loadSalesHistoryFromSupabase(options);f.advance(60001);
  await f.c.loadSalesHistoryFromSupabase({...options,from:'2026-10-23',to:'2026-10-23'});
  assert.equal(f.c.salesRequestLoaded({range:options}),false);
});

test('a refresh started before cancellation cannot restore the cancelled bill',async()=>{
  const {c}=fixture();await c.loadSalesHistoryFromSupabase(options);
  let finish;c.fetchBoundedRows=()=>new Promise(resolve=>finish=resolve);
  const job=c.loadSalesHistoryFromSupabase({...options,force:true});
  c.salesHistory[0]={...c.salesHistory[0],status:'void'};
  finish({data:[{id:'A',sale_date:'2026-10-24',status:'done',total:100}]});await job;
  assert.equal(c.salesHistory[0].status,'void');
});

test('periodic history refresh defers while typing or a modal is open and never refreshes POS',()=>{
  const router=read('src/ui/router.js');let callback,renders=0,typing=false,modal=false,offline=false;
  const c=vm.createContext({currentProfile:{id:'owner'},currentTab:'history',SALES_CACHE_TTL_MS:60000,
    ON_DEMAND_AGGREGATE_TABS:new Set(['history']),clearTimeout:()=>{callback=null;},setTimeout:fn=>{callback=fn;return 1;},
    offlinePosMode:()=>offline,salesRequestLoaded:()=>false,dataRequestsForTab:()=>({sales:{range:options}}),render:()=>renders++,
    document:{visibilityState:'visible',activeElement:{matches:()=>typing},querySelector:()=>modal}});
  vm.runInContext(router.slice(router.indexOf('let salesViewRefreshTimer='),router.indexOf('\nfunction render(){')),c);
  c.scheduleSalesViewRefresh();typing=true;callback();assert.equal(renders,0);
  typing=false;modal=true;callback();assert.equal(renders,0);
  modal=false;callback();assert.equal(renders,1);
  c.currentTab='checkout';c.scheduleSalesViewRefresh();assert.equal(callback,null);
  c.currentTab='history';offline=true;c.scheduleSalesViewRefresh();assert.equal(callback,null);
  offline=false;c.document.visibilityState='hidden';c.scheduleSalesViewRefresh();assert.equal(callback,null);
});
