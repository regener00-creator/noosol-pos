const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{randomUUID}=require('node:crypto');
const source=fs.readFileSync(require.resolve('../src/state/sales-and-documents.js'),'utf8');
function fixture(rpc){
  const c=vm.createContext({crypto:{randomUUID},navigator:{onLine:true},store:1,showToast:()=>{},sb:{rpc}});
  c.captureStoreView=()=>({store:c.store,combined:false});
  c.isStoreViewCurrent=view=>view.store===c.store;
  vm.runInContext(source.slice(source.indexOf('const pendingNumberRequests='),source.indexOf('let saleRef =')),c);
  return c;
}
test('retry keeps the original reservation key and a new draft in the other store gets its own key',async()=>{
  const calls=[];const c=fixture(async(name,args)=>{
    assert.equal(name,'reserve_shop_document_number');calls.push(args);
    return calls.length===1?{error:new Error('lost response')}:{data:args.p_warehouse_id===1?'AQT0001':'BQT0001'};
  });
  const a={warehouseId:1},b={warehouseId:2};
  assert.equal(await c.reserveDraftNumber(a,'quotation'),null);
  assert.equal(await c.reserveDraftNumber(a,'quotation'),'AQT0001');
  c.store=2;
  assert.equal(await c.reserveDraftNumber(a,'quotation'),null);
  assert.equal(await c.reserveDraftNumber(b,'quotation'),'BQT0001');
  assert.equal(calls[0].p_request_id,calls[1].p_request_id);
  assert.notEqual(calls[0].p_request_id,calls[2].p_request_id);
});
test('double click and switching stores cannot attach a late number to the new form',async()=>{
  let resolve,calls=0;
  const c=fixture(()=>{calls++;return new Promise(done=>resolve=done);});
  const draft={warehouseId:1};
  const pending=c.reserveDraftNumber(draft,'inspection');
  assert.equal(await c.reserveDraftNumber(draft,'inspection'),null);
  c.store=2;resolve({data:'ACHECK0001'});
  assert.equal(await pending,null);assert.equal(calls,1);
});
