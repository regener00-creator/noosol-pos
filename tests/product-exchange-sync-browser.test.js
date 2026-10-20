const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.join(__dirname,'..');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await installIsolatedBrowser(page);
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await waitForIsolatedBootstrap(page);
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('productexchange');
    renderLoginState=()=>true;renderSidebar=()=>{};
    ensureOnDemandDataForTab=()=>({status:'ready'});
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    currentProfile={id:'test',owner:true,level:1};
    warehouses=[{id:1,name:'คลังทดสอบ'}];activeWarehouseId=1;
    products=[{id:1,sku:'P001',barcode:'111',name:'สินค้าทดสอบ',unit:'กล่อง',stock:10,price:100,cost:50,units:[],expiry:'2027-01-01'}];
    contacts=[{id:1,name:'บริษัททดสอบ',types:['supplier']}];
    persistWorkspaceData=()=>{};scheduleWorkspaceCacheWrite=()=>{};
    ensureWorkspaceRecoveryDurable=async()=>{};
    beginDurableOperation=async()=>({requestId:crypto.randomUUID()});
    finishDurableOperation=async()=>{};reportClientEvent=async()=>{};
    refreshProductExchangeProducts=async()=>{};
    warehouseStock=()=>10;
    window.exchangeCalls=[];
    window.configureExchangeTest=legacy=>{
      const doc={id:legacy?'EX-LEGACY':'EX-NEW',date:'2026-10-20',supplier:'บริษัททดสอบ',warehouseId:1,note:'',
        status:legacy?'ส่งไปเปลี่ยนแล้ว':'ร่าง',outgoingApplied:!!legacy,incomingApplied:false,
        ...(legacy?{outgoingAppliedAt:'2026-10-20 06:36:24.594092+00'}:{}),
        outgoingItems:[normalizeProductExchangeItem({pid:1,lineId:1,qty:2,unit:'กล่อง'})],incomingItems:[]};
      window.exchangeRemote={id:doc.id,revision:4,created_by:'test',data:structuredClone(doc)};
      productExchanges=[{...structuredClone(doc),...(legacy?{}:{_revision:4})}];
      productExchangeDraft=null;editingProductExchangeId=doc.id;currentTab='productexchange';
      syncedTableRows.product_exchanges=tableSnapshot(productExchanges,docToRow);
      workspaceRecoveryEntries.clear();exchangeCalls=[];
      if(legacy==='missing-baseline'){
        // Restore the pre-outbox cache and fetch the server row exactly as a
        // reload does. Incoming edits must survive without an old baseline.
        productExchanges[0].incomingItems=[normalizeProductExchangeItem({pid:1,lineId:2,qty:2,unit:'กล่อง',expiry:'2028-02-02'})];
        applyWorkspaceData({_recoveryActorId:'test',productExchanges:structuredClone(productExchanges)});
        productExchanges=mergeWorkspaceRemoteRows('product_exchanges',productExchanges,[rowToDoc(exchangeRemote)],docToRow);
        if(syncedTableRows.product_exchanges.has(doc.id))throw new Error('Expected a missing legacy baseline');
      }
      render();
    };
    sb.from=table=>{
      if(table!=='product_exchanges')throw new Error('Unexpected table '+table);
      const q={select:()=>q,eq:()=>q,
        single:async()=>({data:structuredClone(exchangeRemote),error:null}),
        maybeSingle:async()=>({data:structuredClone(exchangeRemote),error:null})};
      return q;
    };
    sb.rpc=async(name,args)=>{
      exchangeCalls.push({name,args:structuredClone(args)});
      if(name==='save_revisioned_document'){
        if(args.p_expected_revision!==exchangeRemote.revision)return {error:{code:'PT409',message:'REVISION_CONFLICT'}};
        exchangeRemote.data=structuredClone(args.p_data);exchangeRemote.revision++;
        return {data:{revision:exchangeRemote.revision}};
      }
      if(name==='run_stock_operation'){
        exchangeRemote.data.status=args.p_args.nextStatus;
        exchangeRemote.data.outgoingApplied=true;
        exchangeRemote.data.incomingApplied=args.p_args.nextStatus==='รับสินค้ากลับแล้ว';
        exchangeRemote.revision++;
        return {data:{exchange:structuredClone(exchangeRemote.data)}};
      }
      throw new Error('Unexpected RPC '+name);
    };
  });
  for(const legacy of [true,'missing-baseline',false]){
    await page.evaluate(legacy=>configureExchangeTest(legacy),legacy);
    if(!legacy){
      const colors=await page.evaluate(()=>({
        sent:getComputedStyle(document.getElementById('confirmExchangeSentBtn')).backgroundColor,
        received:getComputedStyle(document.getElementById('confirmExchangeReceivedBtn')).backgroundColor
      }));
      assert.notEqual(colors.sent,colors.received);
      await page.locator('#confirmExchangeSentBtn').click();
      await page.waitForFunction(()=>productExchangeDraft.outgoingApplied&&!productExchangeStatusInFlight);
      assert.equal(await page.evaluate(()=>productExchangeDraft._revision),6);
      const after=await page.evaluate(()=>({
        sent:getComputedStyle(document.getElementById('confirmExchangeSentBtn')).backgroundColor,
        received:getComputedStyle(document.getElementById('confirmExchangeReceivedBtn')).backgroundColor
      }));
      assert.equal(after.sent,colors.received);
      assert.equal(after.received,colors.sent);
    }
    assert.equal(await page.locator('#confirmExchangeSentBtn').isDisabled(),true);
    if(legacy==='missing-baseline'){
      assert.equal(await page.locator('[data-product-exchange-row="incoming"] .product-exchange-expiry').inputValue(),'02/02/2028');
    }else await page.locator('#copyExchangeOutgoingBtn').click();
    await page.locator('[data-product-exchange-row="incoming"] .product-exchange-lot').fill('LOT-RETURN');
    await page.locator('[data-product-exchange-row="incoming"] .product-exchange-expiry').fill('20/10/2027');
    if(!legacy){
      // A failed receipt must not re-enable the already completed send step.
      await page.evaluate(()=>{
        const original=sb.rpc;
        sb.rpc=async(...args)=>{sb.rpc=original;return {error:{message:'Test save failure',code:'TEST'}};};
      });
      await page.locator('#confirmExchangeReceivedBtn').click();
      await page.waitForFunction(()=>!productExchangeStatusInFlight);
      assert.equal(await page.locator('#confirmExchangeSentBtn').isDisabled(),true);
      assert.equal(await page.locator('#confirmExchangeReceivedBtn').isEnabled(),true);
    }
    await page.locator('#confirmExchangeReceivedBtn').click();
    await page.waitForFunction(()=>productExchangeDraft.incomingApplied&&!productExchangeStatusInFlight);
    const result=await page.evaluate(()=>({draft:productExchangeDraft,remote:exchangeRemote,calls:exchangeCalls}));
    assert.equal(result.draft._revision,result.remote.revision);
    assert.equal(result.draft.status,'รับสินค้ากลับแล้ว');
    assert.equal(result.remote.data.incomingItems[0].lotNumber,'LOT-RETURN');
    assert.equal(result.remote.data.incomingItems[0].expiry,'2027-10-20');
    assert.equal(result.calls.filter(c=>c.name==='run_stock_operation'&&c.args.p_args.nextStatus==='รับสินค้ากลับแล้ว').length,1);
    assert.equal(await page.locator('#confirmExchangeReceivedBtn').count(),0);
    assert.equal(await page.locator('#saveProductExchangeBtn').isDisabled(),true);
  }
  assert.deepEqual(errors,[]);
  console.log('Product exchange browser: baseline-free cache reload, legacy recovery and send → receive passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
});
