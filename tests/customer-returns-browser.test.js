const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),assets=process.argv.includes('--built')?path.join(root,'public'):root;
const server=http.createServer((req,res)=>{
  const file=path.resolve(assets,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(assets+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  await page.route('https://*.supabase.co/**',r=>r.abort());
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',r=>r.fulfill({contentType:'text/javascript',body:
    "const query=new Proxy({}, {get(_t,p){if(p==='then')return resolve=>resolve({data:null,error:null});return ()=>query;}});window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get(t,p){return p in t?t[p]:()=>query;}})};"
  }));
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof render==='function');
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('history');await ensurePageCodeLoaded('rprofit');
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    currentProfile={id:'owner-test',owner:true,level:1};
    activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ',active:true}];
    currentCashShift={id:'shift-test',warehouseId:1,openingCash:1000,status:'open'};
    products=[{id:1,name:'สินค้าเดิม',sku:'P1',barcode:'111',unit:'กล่อง',price:100,cost:40,stock:10,active:true},
      {id:2,name:'สินค้าใหม่แพงกว่า',sku:'P2',barcode:'222',unit:'กล่อง',price:150,cost:50,stock:10,active:true},
      {id:3,name:'สินค้าใหม่ถูกกว่า',sku:'P3',barcode:'333',unit:'กล่อง',price:50,cost:20,stock:10,active:true}];
    businessSettings={...businessSettings,name:'ร้านทดสอบ',vat:'ยังไม่จดภาษีมูลค่าเพิ่ม'};
    const sale={id:'original',ref:'SALE-001',date:TODAY_STR,status:'done',warehouseId:1,cashShiftId:'shift-test',total:300,discount:0,fee:0,costTotal:120,payMethod:'เงินสด',
      items:[{productId:1,name:'สินค้าเดิม',qty:3,unit:'กล่อง',price:100,cost:40,costTotal:120,factor:1,lineTotal:300,lineTotalGross:300,lotAllocations:[{lotId:1,baseQty:3}]}]};
    salesHistory=[sale];
    sb.from=()=>({select(){return this;},eq(){return this;},single:async()=>({data:{id:sale.id,data:sale},error:null})});
    refreshDocumentInventory=async()=>{};
    window.capturedReturns=[];
    runStockOperation=async(operation,args)=>{
      window.capturedReturns.push({operation,args});
      const returned={id:'return-1',ref:'RT-001',status:'done',customerReturn:true,returnKind:args.kind,sourceSaleId:sale.id,sourceSaleRef:sale.ref,date:TODAY_STR,
        items:[{...sale.items[0],qty:-args.returns[0].qty,lineTotalGross:-args.expectedRefund,costTotal:-40,restock:args.returns[0].restock}],total:-args.expectedRefund,
        payMethod:args.payMethod,settlement:args.replacement.sale.total-args.expectedRefund,reason:args.reason,cashShiftId:'shift-test',vatRegistered:false,
        taxSummary:{subtotal:-args.expectedRefund,total:-args.expectedRefund,beforeVat:-args.expectedRefund,vat:0,discount:0}};
      return {sale:{...sale,customerReturnQuantities:{0:args.returns[0].qty}},returnSale:returned,replacementSale:args.kind==='exchange'?{...args.replacement.sale,items:args.replacement.items,id:'new-sale',ref:'SALE-002',date:TODAY_STR,status:'done',cashShiftId:'shift-test',warehouseId:1}:null};
    };
    currentTab='history';render();
  });
  assert.equal(await page.locator('[data-customer-return]').count(),2);
  await page.locator('[data-return-kind="return"]').click();
  assert.equal(await page.locator('#customerReturnTitle').innerText(),'คืนสินค้า');
  assert.equal(await page.locator('#customerExchangeSearch').count(),0);
  await page.locator('[data-customer-return-qty="0"]').fill('1');
  assert.equal(await page.locator('#customerReturnAmount').innerText(),'100.00');
  assert.equal(await page.locator('#customerSettlementLabel').innerText(),'คืนเงินให้ลูกค้า');
  await page.locator('#customerReturnReason').fill('คืนเฉพาะหนึ่งกล่อง');
  await page.locator('[data-customer-return-stock="0"]').selectOption('false');
  await page.locator('#submitCustomerReturn').click();
  assert.equal(await page.locator('#printReturnResult').count(),1);
  const first=await page.evaluate(()=>window.capturedReturns[0]);
  assert.equal(first.operation,'customer_return');assert.equal(first.args.kind,'return');assert.equal(first.args.expectedRefund,100);assert.equal(first.args.returns[0].restock,false);
  const popupPromise=page.waitForEvent('popup');await page.locator('#printReturnResult').click();const popup=await popupPromise;
  await popup.waitForLoadState('domcontentloaded');assert.match(await popup.locator('body').innerText(),/ใบรับคืนสินค้า[\s\S]*SALE-001[\s\S]*100.00/);await popup.close();
  await page.locator('#closeReturnResult').click();
  await page.evaluate(()=>openCustomerReturn('original','exchange'));
  await page.locator('[data-customer-return-qty="0"]').fill('1');
  const pick=async code=>{await page.locator('#customerExchangeSearch').fill(code);await page.locator('#customerExchangeSearch').press('Enter');};
  await pick('222');assert.equal(await page.locator('#customerSettlementLabel').innerText(),'รับเงินเพิ่ม');assert.equal(await page.locator('#customerSettlementAmount').innerText(),'50.00');
  await page.locator('[data-exchange-remove]').click();await pick('333');
  assert.equal(await page.locator('#customerSettlementLabel').innerText(),'คืนเงินให้ลูกค้า');assert.equal(await page.locator('#customerSettlementAmount').innerText(),'50.00');
  await page.locator('[data-exchange-remove]').click();await pick('111');
  assert.equal(await page.locator('#customerSettlementLabel').innerText(),'ไม่ต้องรับหรือคืนเงิน');assert.equal(await page.locator('#customerSettlementAmount').innerText(),'0.00');
  await page.locator('#customerReturnReason').fill('เปลี่ยนสินค้า');
  if(process.env.PEPOS_SCREENSHOT_DIR){fs.mkdirSync(process.env.PEPOS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PEPOS_SCREENSHOT_DIR,'customer-exchange-desktop.png')});}
  await page.setViewportSize({width:820,height:1100});
  assert.ok(await page.locator('#submitCustomerReturn').isVisible());
  await page.locator('#submitCustomerReturn').click();await page.locator('#closeReturnResult').click();
  const summary=await page.evaluate(()=>cashShiftSummary(currentCashShift));
  assert.equal(summary.expectedCash,1300,'equal exchange is net zero');
  const colors=await page.evaluate(()=>{rprofitFilter={applied:true,period:'today',wh:'all',pay:'all'};return rprofitCollect();});
  assert.ok(colors.byDate[colors.range.from].some(row=>row.revenue<0),'profit report includes negative return');
  await page.evaluate(()=>{currentProfile={...currentProfile,owner:false,level:2};render();});
  assert.equal(await page.locator('[data-customer-return]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Customer return browser: two actions, partial/damaged returns, all settlement cases, printing, tablet and permissions passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
