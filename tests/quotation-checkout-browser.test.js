const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:950}});
  page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Block every external request: this test can NEVER create a real sale.
  await page.route('https://**',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.fulfill({contentType:'text/javascript',body:`
    (()=>{const query=new Proxy({},{get(_t,p){if(p==='then')return resolve=>resolve({data:null,error:null});return ()=>query;}});
      window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>{window.testAuthStarted=true;return {data:{session:null}};},onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get(t,p){return p in t?t[p]:()=>query;}})};})();
  `}));
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  // Let bootstrap finish its IndexedDB/auth work before injecting test state.
  await page.waitForFunction(()=>window.testAuthStarted===true);
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('quotation');await ensurePageCodeLoaded('checkout');
    renderLoginState=()=>true;renderSidebar=()=>{};ensureOnDemandDataForTab=()=>({status:'ready'});
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    currentProfile={id:'test-owner',owner:true,level:1,firstName:'Test'};
    warehouses=[{id:1,name:'Test warehouse'}];activeWarehouseId=1;
    products=[{id:7,name:'Quoted product',unit:'เม็ด',price:180,cost:10,stock:100,active:true,vat:'none',type:'stock',units:[]}];
    contacts=[{id:8,name:'Quote customer',types:['customer']}];promotions=[];
    quotations=[{id:'Q-BROWSER',date:'2026-09-12',customer:'Quote customer',customerInfo:{id:8,name:'Quote customer'},discount:0,
      items:[{productId:7,name:'Quoted product',unit:'เม็ด',qty:2,price:160},{productId:7,name:'Quoted product',unit:'เม็ด',qty:1,price:150}]}];
    currentCashShift={id:'shift-test',status:'open'};cart=[];
    isBusinessVatRegistered=()=>false;
    persistQuotations=()=>{};refreshDocumentInventory=()=>{};openPostPaymentModal=()=>{};
    window.testRequests=[];window.testToasts=[];
    showToast=message=>window.testToasts.push(message);
    window.testCheckoutError=true;
    sb.rpc=async(name,args)=>{
      if(name!=='complete_sale')return {data:null,error:null};
      window.testRequests.push(structuredClone(args));
      if(window.testCheckoutError)return {data:null,error:{code:'P0001',message:'quotation price changed; reopen quotation'}};
      return {data:{sale:{...args.p_sale,id:'SALE-BROWSER',items:args.p_items}},error:null};
    };
    currentTab='quotation';editingQuotationId=null;searchQuery='';
    document.getElementById('main').innerHTML=renderQuotation();attachEvents();
  });
  assert.equal(await page.locator('[data-sell-quotation="Q-BROWSER"]').count(),1,await page.locator('#main').innerText());
  await page.locator('[data-sell-quotation="Q-BROWSER"]').click();
  assert.equal(await page.locator('.pos-quotation-price-tag').count(),2);
  assert.ok((await page.locator('#main').innerText()).includes('ราคาจากใบเสนอราคา'));
  await page.evaluate(()=>doCheckout('เงินสด',{cashReceived:470}));
  let captured=await page.evaluate(()=>window.testRequests);
  assert.equal(captured.length,1);
  assert.equal(captured[0].p_sale.total,470);
  assert.equal(captured[0].p_sale.sourceQuotationId,'Q-BROWSER');
  assert.equal(captured[0].p_sale.customerId,8);
  assert.deepEqual(captured[0].p_items.map(l=>[l.price,l.sourceQuotationLineIndex,l.sourceQuotationId]),[[160,0,'Q-BROWSER'],[150,1,'Q-BROWSER']]);
  assert.equal(await page.evaluate(()=>cart.length),2,'Failed checkout keeps cart');
  assert.equal(await page.evaluate(()=>readPendingCheckoutRequest()),null,'Definite rejection clears request for correction');
  assert.ok((await page.evaluate(()=>window.testToasts)).some(s=>s.includes('ข้อมูลใบเสนอราคาไม่ตรง')));
  await page.evaluate(async()=>{window.testCheckoutError=false;await doCheckout('เงินสด',{cashReceived:470});});
  captured=await page.evaluate(()=>window.testRequests);
  assert.equal(captured.length,2);
  assert.notEqual(captured[0].p_request_id,captured[1].p_request_id,'Corrected request has new ID');
  assert.equal(await page.evaluate(()=>cart.length),0);
  assert.equal(await page.evaluate(()=>quotations[0].saleId),'SALE-BROWSER');
  assert.equal(await page.evaluate(()=>salesHistory[0].items[0].sourceQuotationLineIndex),0);
  assert.deepEqual(errors,[]);
  console.log('Quotation → POS → payment payload, stale-price feedback and completion browser checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
