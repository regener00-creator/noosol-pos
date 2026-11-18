const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('./catalog-test-context.cjs');
const source=require('./load-app-source')();
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)+start.length));
const clone=value=>JSON.parse(JSON.stringify(value));
function setup(local,remoteRows,dirty,baseline=[]){
  const remote=new Map(remoteRows.map(row=>[String(row.id),clone(row)])),calls=[],saved=[];
  let beforeUpdate=()=>{},beforeSelect=()=>{},failPersistence=false,failDeletion=false;
  const ctx=vm.createContext({console:{warn(){}},Map,Set,JSON,Date,Number,String,Array,Promise,Object,Error,
    products:clone(local),currentProfile:{id:'owner',owner:true},productDirtyOperations:new Map(dirty),
    generateProductCreateToken:()=> 'test-token',coreSyncFailureDetail:null,
    normalizeProductDirtyOperations:entries=>new Map(entries),
    persistProductChangesToIndexedDB:async(changes,operations)=>{saved.push(operations?clone([...operations]):null);return !failPersistence;},
    noteCoreSyncFailure:(error,detail)=>{ctx.coreSyncFailureDetail={error,...detail};return false;},
    sb:{from(table){let ids=null,id,revision,changes,operation='select';const q={
      select:()=>q,in:(_key,value)=>{ids=value.map(String);return q;},eq:(key,value)=>{if(key==='id')id=String(value);else revision=value;return q;},
      update:value=>{changes=clone(value);operation='update';return q;},delete:()=>{operation='delete';return q;},
      insert:async rows=>{calls.push({operation:'insert',rows:clone(rows)});if(rows.some(row=>remote.has(String(row.id))))return {error:{code:'23505',message:'duplicate key'}};
        rows.forEach(row=>remote.set(String(row.id),{...clone(row),revision:1}));return {error:null};},
      maybeSingle:async()=>{const row=remote.get(id);if(operation==='select')return {data:clone(row||null)};
        calls.push({operation,id,changes});beforeUpdate(id);
        if(!row||row.revision!==revision)return {data:null};Object.assign(row,changes,{revision:revision+1});return {data:{id:row.id,revision:row.revision}};},
      then:resolve=>{beforeSelect(remote);const rows=[...remote.values()].filter(row=>!ids||ids.includes(String(row.id)));if(operation==='delete'){if(failDeletion)return Promise.resolve({error:{code:'NETWORK'}}).then(resolve);calls.push({operation,ids});rows.forEach(row=>remote.delete(String(row.id)));}return Promise.resolve({data:clone(rows),error:null}).then(resolve);}
    };return q;}}
  });
  vm.runInContext(section('const PRODUCT_DUPLICATE_DATA_KEYS=','function contactToRow(')+
    section('let lastSyncedSnapshot=','async function refreshDocumentInventory(')+
    section('function cloneSyncRecords(','function persistentSyncPauseMap(')+
    section('function productCreateTokenFromRow(','function revisionConflictError(')+
    section('async function prepareProductInsertCandidatesForSync(','let coreSyncInFlight='),ctx);
  ctx.seedTableSnapshot('products',baseline,ctx.productMetadataToRow);
  return {ctx,remote,calls,saved,run:()=>ctx.syncProductsIncrementally(),race:fn=>beforeUpdate=fn,readRace:fn=>beforeSelect=fn,failCache:()=>{failPersistence=true;},failDelete:()=>{failDeletion=true;}};
}
const product=(id,wh,price=100)=>({id,wh,sku:String(id),name:'Product '+id,type:'stock',unit:'ขวด',price,cost:80,_revision:1,_clientCreateToken:'token-'+id});
const row=p=>({id:p.id,warehouse_id:p.wh,sku:p.sku,name:p.name,product_type:p.type,unit:p.unit,price:p.price,cost:p.cost,category:null,brand:null,data:{_clientCreateToken:p._clientCreateToken},revision:p._revision});
for(const conflictStore of [1,2])test(`shop ${conflictStore} insert conflict cannot strand either shop's successful updates`,async()=>{
  const bad=product(10,conflictStore,250),good=product(20,3-conflictStore,120),sameShop=product(30,conflictStore,130);
  const baseline=[{...good,price:100},{...sameShop,price:100}];
  const s=setup([bad,good,sameShop],[row({...bad,price:0}),...baseline.map(row)],[['10','insert'],['20','update'],['30','update']],baseline);
  assert.equal(await s.run(),false);
  assert.equal(s.remote.get('10').price,0);assert.equal(s.ctx.products[0].price,250);
  assert.equal(s.remote.get('20').price,120);assert.equal(s.remote.get('30').price,130);
  assert.deepEqual([...s.ctx.productDirtyOperations.keys()],['10']);
  assert.equal(s.ctx.syncProductsIncrementally.failures[0].warehouseId,conflictStore);
  const count=s.calls.length;assert.equal(await s.run(),false);assert.equal(s.calls.length,count,'retry does not send acknowledged edits or paused conflict');
});
test('mixed insert batch acknowledges matches and new rows without overwriting a conflict',async()=>{
  const bad=product(10,1,250),already=product(20,1),fresh=product(30,1);
  const s=setup([bad,already,fresh],[row({...bad,price:0}),row(already)],[['10','insert'],['20','insert'],['30','insert']]);
  assert.equal(await s.run(),false);assert.deepEqual([...s.ctx.productDirtyOperations.keys()],['10']);
  assert.equal(s.remote.get('10').price,0);assert.equal(s.remote.get('30').price,100);
  assert.deepEqual(s.calls.filter(c=>c.operation==='insert').map(c=>c.rows.map(r=>r.id)),[[10,20,30],[30]]);
});
test('insert batches never mix warehouses and earlier successful chunks leave the queue',async()=>{
  const list=Array.from({length:202},(_,i)=>product(i+1,i===201?2:1));
  const s=setup(list,[row({...list[200],price:999})],list.map(p=>[String(p.id),'insert']));
  assert.equal(await s.run(),false);assert.deepEqual([...s.ctx.productDirtyOperations.keys()],['201']);
  assert.ok(s.calls.filter(c=>c.operation==='insert').every(c=>new Set(c.rows.map(r=>r.warehouse_id)).size===1));
  assert.equal(s.remote.get('201').price,999);assert.equal(s.remote.get('202').price,100);
});
test('edit made during server acknowledgement remains pending beside an insert conflict',async()=>{
  const good=product(20,1,120),bad=product(10,2,250),old={...good,price:100};
  const s=setup([good,bad],[row(old),row({...bad,price:0})],[['20','update'],['10','insert']],[old]);
  s.race(id=>{if(id==='20')s.ctx.products[0].price=150;});
  assert.equal(await s.run(),false);assert.equal(s.ctx.products[0].price,150);
  assert.ok(s.ctx.productDirtyOperations.has('20'));assert.equal(s.remote.get('20').price,120);
});
test('already acknowledged dirty rows clear without another write; failed cache retains them',async()=>{
  const p=product(1,1),s=setup([p],[row(p)],[['1','update']],[p]);
  s.failCache();assert.equal(await s.run(),false);assert.ok(s.ctx.productDirtyOperations.has('1'));
  const good=setup([p],[row(p)],[['1','update']],[p]);
  assert.equal(await good.run(),true);assert.equal(good.ctx.productDirtyOperations.size,0);assert.equal(good.calls.length,0);
});
test('one shop failure does not turn the other shop baseline into deletions',async()=>{
  const bad=product(10,2,250),keep=product(20,1),deleted=product(30,1);
  const s=setup([bad,keep],[row({...bad,price:0}),row(keep),row(deleted)],[['10','insert'],['30','delete']],[keep,deleted]);
  assert.equal(await s.run(),false);assert.ok(s.remote.has('20'));assert.ok(!s.remote.has('30'));
  assert.deepEqual([...s.ctx.productDirtyOperations.keys()],['10']);
});
test('failed deletion remains pending even when successful updates are acknowledged',async()=>{
  const p=product(1,1),deleted=product(2,1),s=setup([{...p,price:150}],[row(p),row(deleted)],[['1','update'],['2','delete']],[p,deleted]);
  s.failDelete();assert.equal(await s.run(),false);
  assert.deepEqual([...s.ctx.productDirtyOperations.keys()],['2']);assert.ok(s.remote.has('2'));
});
test('remote edit between insert and acknowledgement cannot become a trusted old payload with a new revision',async()=>{
  const p=product(1,1),s=setup([p],[],[['1','insert']]);
  s.readRace(rows=>{if(rows.has('1'))Object.assign(rows.get('1'),{price:999,revision:2});});
  assert.equal(await s.run(),false);assert.equal(s.remote.get('1').price,999);
  assert.equal(s.ctx.productDirtyOperations.get('1'),'insert');assert.equal(s.ctx.products[0].price,100);
});
