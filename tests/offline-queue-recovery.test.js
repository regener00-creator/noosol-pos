const assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
  let attempts=[],retryMs=0,reply=async id=>id==='bad'?{error:{code:'P0001',message:'product is inactive'}}:{data:{sale:{id:'SALE-'+id}}};
  const c=vm.createContext({console,Date,Map,Set,Number,String,JSON,Promise,structuredClone,
    navigator:{onLine:true},currentProfile:{id:'owner'},checkoutInFlight:false,
    clearTimeout:()=>{},setTimeout:(_f,ms)=>retryMs=ms,document:{getElementById:()=>null},
    mapProfileRow:p=>p,renderSyncStatusChip:()=>{},
    sb:{auth:{getUser:async()=>({data:{user:{id:'owner'}}})},
      from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'owner'}})})})}),
      rpc:async(_name,p)=>{attempts.push(p.p_request_id);return reply(p.p_request_id);}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/pos/offline.js'),'utf8'),c);
  c.captureWorkspaceRead=()=>({actor:c.currentProfile?.id});
  c.isWorkspaceReadCurrent=context=>context.actor===c.currentProfile?.id;
  vm.runInContext(`offlineSales=['bad','good'].map(id=>({id,localSale:{ref:id},payload:{warehouseId:1,sale:{},items:[]}}));
    loadOfflineSales=async()=>{};ensureOfflineShiftOnServer=async()=>{};
    editOfflineSales=async edit=>{offlineSales=edit(offlineSales);};`,c);
  return {c,attempts,retry:()=>retryMs,reply:fn=>reply=fn};
}
test('a definite rejected bill is durable, pauses and does not block the next bill',async()=>{
  const f=fixture();await f.c.syncOfflineSales();
  assert.deepEqual(f.attempts,['bad','good']);assert.equal(f.retry(),0);
  assert.equal(f.c.offlinePendingSales()[0].needsReview,true);
  await f.c.syncOfflineSales();assert.deepEqual(f.attempts,['bad','good']);
  await f.c.syncOfflineSales({retryBlockedId:'bad'});assert.deepEqual(f.attempts,['bad','good','bad']);
});
test('ambiguous network failure preserves UUID and remains retryable',async()=>{
  const f=fixture();f.reply(async()=>{throw new TypeError('Failed to fetch');});
  await f.c.syncOfflineSales();await f.c.syncOfflineSales();
  assert.deepEqual(f.attempts,['bad','bad']);assert.equal(f.retry(),30000);
  assert.equal(f.c.offlinePendingSales()[0].needsReview,false);
});
test('transaction retry errors are not incorrectly marked as business failures',()=>{
  const {c}=fixture();
  for(const code of ['40001','40P01','55P03','57014','PGRST301','']) assert.equal(c.offlineSaleNeedsReview({code}),false,code);
  for(const code of ['23505','22003','42501','P0001','REVISION_CONFLICT']) assert.equal(c.offlineSaleNeedsReview({code}),true,code);
});

test('a checkout response after changing accounts cannot alter the new account queue',async()=>{
  const f=fixture();let finish;
  f.reply(()=>new Promise(resolve=>finish=resolve));
  const job=f.c.syncOfflineSales();
  while(!finish) await Promise.resolve();
  f.c.currentProfile={id:'other'};
  vm.runInContext("offlineSales=[{id:'other-sale',payload:{warehouseId:1,items:[]}}]",f.c);
  finish({data:{sale:{id:'OLD-SALE'}}});await job;
  assert.equal(f.c.offlinePendingSales()[0].id,'other-sale');
  assert.deepEqual(f.attempts,['bad']);assert.equal(f.retry(),0);
});
