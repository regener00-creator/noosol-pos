const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const {chromium}=require('playwright');
const source=require('./load-app-source')();
function section(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert.ok(start>=0&&end>start);return source.slice(start,end);}
const server=http.createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><html><body></body></html>'));
let browser;
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});const context=await browser.newContext(),page=await context.newPage();
  const bootstrap=`
    let productCacheDbPromise=null,currentProfile={id:'owner'},saleMember=null,saleLoyaltySelection=null,customerLoyaltyState=null;
    let pendingCheckoutContextMemory=null,cart=[],saleDiscount=0,saleSourceQuotationId=null,pendingQty=1,activeWarehouseId=1;
    const PENDING_CHECKOUT_REQUEST_KEY='pending-checkout';
    const PRODUCT_CACHE_DB_NAME='durable-operation-test',PRODUCT_CACHE_DB_VERSION=2,PRODUCT_CACHE_META_STORE='meta',PRODUCT_CACHE_PRODUCTS_STORE='products',PRODUCT_CACHE_WORKSPACE_STORE='workspace',PENDING_STOCK_OPERATIONS_KEY='legacy';
    const cloudClean=x=>x,sha256Hex=async x=>JSON.stringify(x),rememberSyncUiError=()=>{},reportClientEvent=()=>{},setSyncUiState=()=>{},showToast=()=>{};
    const sb={rpc:async()=>({data:{ok:true},error:null})};
    let workspaceOutboxVersions=new Map(),workspaceCachePendingSnapshot=null,workspaceCacheWritePromise=Promise.resolve(true),workspaceCacheSaveFailed=false,workspaceRecoveryLoadedActor='',workspaceRecoveryActorId='',workspaceRecoveryEntries=new Map();
    const WORKSPACE_STORAGE_KEY='workspace';
    const applyWorkspaceData=value=>window.recovered=value,workspaceRecoveryTables=()=>[];
    const customersList=()=>window.testCustomers,activeSaleCustomer=()=>null,normalizedCustomerPriceRules=()=>[],escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    const customerSaleSnapshot=x=>x,refreshCartCustomerPrices=()=>{},render=()=>{},openPOSCustomerCreateModal=()=>{};
    ${section('function idbRequest(','async function loadProductCacheFromIndexedDB(')}
    ${section('function readPendingStockOperations(','async function recordPrintEvent(')}
    ${section('function readPendingCheckoutRequest(','async function clearLocalStoreCachesForReset(')}
    ${section('function openPOSCustomerPicker(','function generateClientRecordId(')}
    ${section('async function loadWorkspaceRecoveryForUser(','function refreshDataCounters(')}
    ${section('function flushWorkspaceCacheToIndexedDB(','function scheduleWorkspaceCacheWrite(')}
    window.testSetRpc=fn=>sb.rpc=fn;
  `;
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);await page.addScriptTag({content:bootstrap});
  // Response is lost after the server commits. The retry must reuse its key.
  const first=await page.evaluate(async()=>{
    localStorage.setItem('legacy',JSON.stringify({[JSON.stringify({operation:'apply_goods_receipt_lots',payload:{receiptId:'R1'}})]:{requestId:'12345678-1234-4234-8234-123456789abc'}}));
    Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};
    let sent;testSetRpc(async(_name,args)=>{sent=args.p_request_id;return {error:{code:'FETCH_ERROR',message:'response lost'}};});
    try{await runStockOperation('apply_goods_receipt_lots',{receiptId:'R1'});}catch(_){}
    return sent;
  });assert.equal(first,'12345678-1234-4234-8234-123456789abc','legacy ambiguous operation keeps its original ID');
  await page.reload();await page.addScriptTag({content:bootstrap});
  const retry=await page.evaluate(async()=>{
    Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};
    let sent;testSetRpc(async(_name,args)=>{sent=args.p_request_id;return {data:{replayed:true},error:null};});
    await runStockOperation('apply_goods_receipt_lots',{receiptId:'R1'});return sent;
  });assert.equal(retry,first,'reload retains the original request ID');
  const next=await page.evaluate(async()=>{
    let sent;testSetRpc(async(_name,args)=>{sent=args.p_request_id;return {data:{ok:true},error:null};});
    await runStockOperation('apply_goods_receipt_lots',{receiptId:'R1'});return sent;
  });assert.notEqual(next,first,'acknowledged request releases the token for a new intentional operation');
  const simultaneous=await page.evaluate(()=>Promise.all([beginDurableOperation('test','same'),beginDurableOperation('test','same')]).then(rows=>rows.map(r=>r.requestId)));
  assert.equal(simultaneous[0],simultaneous[1],'atomic IndexedDB read/write prevents competing keys');
  const full=await page.evaluate(async()=>{
    const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){this.transaction.abort();throw new DOMException('full','QuotaExceededError');};
    let calls=0;testSetRpc(async()=>{calls++;return {data:{}};});let code;
    try{await runStockOperation('test',{newPayload:true});}catch(e){code=e.code;}finally{IDBObjectStore.prototype.put=original;}
    return {calls,code};
  });assert.deepEqual(full,{calls:0,code:'LOCAL_STORAGE_UNAVAILABLE'});
  await page.evaluate(()=>{window.testCustomers=Array.from({length:5000},(_,i)=>({id:i,name:`Customer ${i}`,phone:i===4999?'089-999-9999':'',code:`C${i}`}));openPOSCustomerPicker();});
  assert.equal(await page.locator('[data-pos-customer-index]').count(),60);
  await page.locator('[data-customer-page="1"]').click();
  assert.equal(await page.locator('[data-pos-customer-index]').first().getAttribute('data-pos-customer-index'),'60');
  await page.locator('#posCustomerPickerSearch').fill('0899999999');
  assert.equal(await page.locator('[data-pos-customer-index]').count(),1);
  await page.locator('[data-pos-customer-index]').click();
  assert.equal(await page.evaluate(()=>saleMember.id),4999);
  const second=await page.context().newPage();await second.goto(url);await second.addScriptTag({content:bootstrap});
  const write=async(target,id,name)=>target.evaluate(async({id,name})=>{
    workspaceCachePendingSnapshot={_recoveryActorId:'owner',_pendingWorkspaceChanges:id?[{table:'contacts',id,baseline:null,record:{id,name}}]:[]};
    return flushWorkspaceCacheToIndexedDB();
  },{id,name});
  assert.equal(await write(page,'A','first tab'),true);
  assert.equal(await write(second,'B','second tab'),true,'distinct pending rows from two tabs both persist');
  const keys=()=>page.evaluate(async()=>{const db=await openProductCacheDb();return idbRequest(db.transaction('workspace').objectStore('workspace').getAll()).then(rows=>rows.filter(r=>r.key.startsWith('pending:')).map(r=>r.key).sort());});
  assert.deepEqual(await keys(),['pending:owner:contacts:A','pending:owner:contacts:B']);
  assert.equal(await write(second,'A','conflicting edit'),false,'unobserved work cannot be overwritten');
  assert.deepEqual(await keys(),['pending:owner:contacts:A','pending:owner:contacts:B']);
  assert.equal(await write(page,null),true,'acknowledgement only removes its own entry');
  assert.deepEqual(await keys(),['pending:owner:contacts:B']);
  await page.reload();await page.addScriptTag({content:bootstrap});
  await page.evaluate(()=>loadWorkspaceRecoveryForUser());
  assert.equal(await page.evaluate(()=>window.recovered._pendingWorkspaceChanges[0].record.name),'second tab','reload restores other tabs pending entry even if latest snapshot omits it');
  await second.close();
  const checkout=await page.evaluate(()=>checkoutRequestContext({warehouseId:1,sale:{total:10},items:[{id:1}]},{cart:[{id:1}]}));
  await page.reload();await page.addScriptTag({content:bootstrap});
  const checkoutRetry=await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};return checkoutRequestContext({warehouseId:1,sale:{total:99},items:[{id:2}]});});
  assert.equal(checkoutRetry.id,checkout.id);assert.equal(checkoutRetry.payload.sale.total,10);assert.equal(checkoutRetry.payloadMismatch,true);
  await page.evaluate(id=>clearCheckoutRequestId(id),checkout.id);
  const freshCheckout=await page.evaluate(()=>checkoutRequestContext({warehouseId:1,sale:{total:99},items:[{id:2}]}));
  assert.notEqual(freshCheckout.id,checkout.id,'completed checkout does not reuse a stale localStorage token');
  console.log('durable operations: localStorage full, reload/retry, atomic key, IndexedDB full, 5000-customer paging and phone search passed');
  console.log('workspace outbox: two tabs, conflicting edit protection, conditional acknowledgement and reload recovery passed');
  console.log('checkout: durable original payload after reload/storage full and new key after acknowledgement passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
