const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=require('./load-app-source')();
function section(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,start);return source.slice(a,b);
}
const copy=value=>JSON.parse(JSON.stringify(value));
function setup(){
  const sent={id:'EX1',date:'2026-10-20',supplier:'Supplier',warehouseId:1,note:'',
    status:'ส่งไปเปลี่ยนแล้ว',outgoingApplied:true,incomingApplied:false,outgoingAppliedAt:'2026-10-20 06:36:24.594092+00',
    outgoingItems:[{pid:1,lineId:1,qty:2,factor:1,unit:'box'}],incomingItems:[]};
  let remote={id:'EX1',revision:4,created_by:'owner',data:copy(sent)};
  const calls=[],errors=[],messages=[];
  let readFails=false,inventoryFails=false,releaseStock=null;
  const ctx=vm.createContext({console:{warn(){},error(...args){errors.push(args);}},structuredClone,
    Map,Set,JSON,Date,Promise,Number,String,Math,Object,Array,Error,
    productExchanges:[copy(sent)],productExchangeDraft:{...copy(sent),incomingItems:[{pid:1,lineId:2,qty:2,factor:1,unit:'box',expiry:'2027-10-20'}]},
    syncedTableRows:{product_exchanges:new Map([['EX1',JSON.stringify({id:'EX1',data:sent,revision:0})]])},
    workspaceRecoveryEntries:new Map(),products:[{id:1,stock:10}],
    workspaceRecoveryTables:()=>[['product_exchanges',()=>ctx.productExchanges]],
    ensureWorkspaceRecoveryDurable:async()=>{},sha256Hex:async()=> 'hash',
    beginDurableOperation:async()=>({requestId:'request'}),finishDurableOperation:async()=>{},
    reportClientEvent:()=>{},persistWorkspaceData:()=>{},refreshDataCounters:()=>{},
    syncProductExchangeFromDOM:()=>{},activeProductExchangeDraft:()=>ctx.productExchangeDraft,
    validateProductExchangeDraft:()=>true,normalizeProductExchangeItem:copy,
    warehouseStock:()=>10,document:{getElementById:()=>null},confirm:()=>true,
    showToast:(...args)=>messages.push(args),render:()=>{},
    tableSnapshot:(rows,toRow)=>new Map(rows.map(row=>[String(row.id),JSON.stringify(toRow(row))])),
    sb:{
      from(table){
        assert.equal(table,'product_exchanges');
        const read=async()=>readFails?{error:new Error('read offline')}:{data:copy(remote),error:null};
        const q={select:()=>q,eq:()=>q,maybeSingle:read,single:read};return q;
      },
      async rpc(name,args){
        calls.push({name,args:copy(args)});
        assert.equal(name,'save_revisioned_document');
        if(args.p_expected_revision!==remote.revision)return {error:{code:'PT409',message:'REVISION_CONFLICT'}};
        remote={...remote,data:copy(args.p_data),revision:remote.revision+1};
        return {data:{revision:remote.revision},error:null};
      }
    },
    runStockOperation:async(_operation,args)=>{
      calls.push({name:'stock',args:copy(args)});
      if(releaseStock)await releaseStock;
      remote={...remote,revision:remote.revision+1,data:{...remote.data,status:args.nextStatus,outgoingApplied:true,
        incomingApplied:args.nextStatus==='รับสินค้ากลับแล้ว'}};
      return {exchange:copy(remote.data)};
    }
  });
  vm.runInContext(section('function cloudClean(','async function sha256Hex(')+
    section('function docToRow(','const DOC_TABLES =')+
    section('function cloneSyncRecords(','async function upsertRowsInChunks(')+
    section('async function saveRevisionedDocument(','const MEDICINE_LABEL_DURATION_OPTIONS=')+
    section('const PRODUCT_EXCHANGE_STATUSES=','function currentDocKind('),ctx);
  // Keep the real normalization out of these sync fixtures.
  ctx.normalizeProductExchangeItem=copy;
  const actions=fs.readFileSync(path.join(__dirname,'../src/documents/exchange-actions.js'),'utf8');
  vm.runInContext(actions.slice(actions.indexOf('function saveProductExchange(')),ctx);
  ctx.refreshProductExchangeProducts=async()=>{if(inventoryFails)throw new Error('inventory offline');};
  return {ctx,calls,errors,messages,get remote(){return remote;},set remote(v){remote=v;},
    failRead(){readFails=true;},failInventory(){inventoryFails=true;},
    holdStock(){let resolve;releaseStock=new Promise(r=>resolve=r);return resolve;}};
}
test('old sent document recovers missing revision and receives on the same document',async()=>{
  const s=setup();await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.errors.length,0);
  assert.equal(s.calls[0].args.p_expected_revision,4);
  assert.equal(s.remote.revision,6);
  assert.equal(s.ctx.productExchanges[0]._revision,6);
  assert.equal(s.ctx.productExchangeDraft._revision,6);
  assert.equal(s.ctx.productExchangeDraft.incomingApplied,true);
  assert.equal(s.remote.data.incomingItems.length,1);
});
test('legacy outbox without a baseline recovers the same sent transaction and keeps receipt edits',async()=>{
  const s=setup();
  s.ctx.syncedTableRows.product_exchanges.delete('EX1');
  s.ctx.workspaceRecoveryEntries.set('product_exchanges:EX1',{table:'product_exchanges',id:'EX1',baseline:null,record:copy(s.ctx.productExchangeDraft),legacy:true});
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.errors.length,0);
  assert.equal(s.calls[0].args.p_expected_revision,4);
  assert.equal(s.remote.data.incomingItems[0].expiry,'2027-10-20');
  assert.equal(s.remote.data.incomingApplied,true);
  assert.equal(s.calls.filter(c=>c.name==='stock').length,1);
});
test('missing revision with an existing positive baseline recovers before receipt',async()=>{
  const s=setup();
  s.ctx.syncedTableRows.product_exchanges.set('EX1',JSON.stringify({...s.remote}));
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.errors.length,0);
  assert.equal(s.calls[0].args.p_expected_revision,4);
});
for(const mutation of ['note','incomingItems','outgoingAppliedAt','incomingApplied']){
  test(`baseline-free recovery does not overwrite remote ${mutation} changes`,async()=>{
    const s=setup();s.ctx.syncedTableRows.product_exchanges.delete('EX1');
    const values={note:'remote edit',incomingItems:[{pid:2,qty:3}],outgoingAppliedAt:'2026-10-20 07:00:00+00',incomingApplied:true};
    s.remote={...s.remote,data:{...s.remote.data,[mutation]:values[mutation]}};
    await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
    assert.equal(s.errors.length,1);
    assert.equal(s.calls.length,0);
    assert.deepEqual(s.remote.data[mutation],values[mutation]);
    assert.equal(s.ctx.productExchangeDraft.incomingItems.length,1);
  });
}
test('baseline-free recovery requires a matching server-issued outgoing timestamp',async()=>{
  const s=setup();s.ctx.syncedTableRows.product_exchanges.delete('EX1');
  delete s.ctx.productExchangeDraft.outgoingAppliedAt;
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.errors.length,1);
  assert.equal(s.calls.filter(c=>c.name==='stock').length,0);
});
test('background sync repairs old cache without discarding incoming edits',async()=>{
  const s=setup();
  s.ctx.saveProductExchange(false);
  await s.ctx.syncRevisionedDocuments('product_exchanges',s.ctx.productExchanges);
  assert.equal(s.calls[0].args.p_expected_revision,4);
  assert.equal(s.remote.data.incomingItems[0].expiry,'2027-10-20');
  assert.equal(s.ctx.productExchangeDraft._revision,5);
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.errors.length,0);
  assert.equal(s.ctx.productExchangeDraft._revision,7);
});
test('recovering an unchanged sent document also repairs its open draft',async()=>{
  const s=setup();
  await s.ctx.syncRevisionedDocuments('product_exchanges',s.ctx.productExchanges);
  assert.equal(s.ctx.productExchangeDraft._revision,4);
  assert.equal(s.calls.length,0);
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.errors.length,0);
});
test('changed server document is not overwritten while recovering missing revision',async()=>{
  const s=setup();s.remote={...s.remote,data:{...s.remote.data,note:'edited elsewhere'}};
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.calls.length,0);
  assert.equal(s.errors.length,1);
  assert.equal(s.remote.data.note,'edited elsewhere');
  assert.equal(s.ctx.productExchangeDraft.incomingItems.length,1);
});
test('new document with a colliding id is not silently rebased',async()=>{
  const s=setup();s.ctx.productExchangeDraft.outgoingApplied=false;s.ctx.productExchangeDraft.status='ร่าง';
  await s.ctx.changeProductExchangeStatus('ส่งไปเปลี่ยนแล้ว');
  assert.equal(s.calls[0].args.p_expected_revision,0);
  assert.equal(s.calls.filter(c=>c.name==='stock').length,0);
  assert.equal(s.errors.length,1);
});
test('successful stock response is retained when inventory refresh fails',async()=>{
  const s=setup();s.failInventory();
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.errors.length,0);
  assert.equal(s.ctx.productExchangeDraft.incomingApplied,true);
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.calls.filter(c=>c.name==='stock').length,1);
  assert.ok(s.messages.some(([text])=>text.includes('โหลดสต๊อกล่าสุดไม่สำเร็จ')));
});
test('missing row read after committed stock keeps posted state recoverable',async()=>{
  const s=setup();s.ctx.productExchanges[0]._revision=4;s.ctx.productExchangeDraft._revision=4;s.failRead();
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  assert.equal(s.errors.length,0);
  assert.equal(s.ctx.productExchangeDraft.incomingApplied,true);
  assert.equal(s.ctx.productExchangeDraft._revision,undefined);
  assert.equal(JSON.parse(s.ctx.syncedTableRows.product_exchanges.get('EX1')).data.incomingApplied,true);
});
test('confirm and background sync serialize and do not acknowledge unrelated edits',async()=>{
  const s=setup(),release=s.holdStock();
  const other={id:'EX2',_revision:1,note:'unsaved'};
  s.ctx.productExchanges.push(other);
  const baseline=JSON.stringify({id:'EX2',data:{id:'EX2',note:'old'},revision:1});
  s.ctx.syncedTableRows.product_exchanges.set('EX2',baseline);
  const first=s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  await new Promise(resolve=>setImmediate(resolve));
  await s.ctx.changeProductExchangeStatus('รับสินค้ากลับแล้ว');
  // Verify queued sync observes the fresh revision after the stock transaction.
  const queued=s.ctx.withRevisionedTableLock('product_exchanges',()=>s.ctx.productExchanges[0]._revision);
  release();await first;
  assert.equal(await queued,6);
  assert.equal(s.calls.filter(c=>c.name==='stock').length,1);
  assert.equal(s.ctx.syncedTableRows.product_exchanges.get('EX2'),baseline);
});
