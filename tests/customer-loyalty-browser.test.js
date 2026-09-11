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
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',r=>r.fulfill({contentType:'text/javascript',body:`
    const query=new Proxy({}, {get(_t,p){if(p==='then')return resolve=>resolve({data:null,error:null});return ()=>query;}});
    window.loyaltyRpc=async()=>({data:null,error:null});
    window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:(name,args)=>({abortSignal:()=>window.loyaltyRpc(name,args),then:resolve=>window.loyaltyRpc(name,args).then(resolve)})},{get(t,p){return p in t?t[p]:()=>query;}})};
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof render==='function');
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('checkout');
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    renderLoginState=()=>true;persistContacts=()=>{};refreshDocumentInventory=()=>{};openPostPaymentModal=()=>{};
    currentProfile={id:'test-owner',owner:true,level:1,firstName:'ทดสอบ'};
    activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ'}];
    currentDateStr=()=> '2026-09-11';
    currentCashShift={id:'shift-test',shiftNo:'CS-TEST',openingCash:0,openedByName:'ทดสอบ'};
    businessSettings={...DEFAULT_BUSINESS_SETTINGS,vatRegistered:false};
    contacts=[{id:1,name:'ลูกค้า A',types:['customer']},{id:2,name:'ลูกค้า B',types:['customer']}];
    products=[{id:101,sku:'D-001',name:'Decolgen',unit:'กล่อง',price:1000,cost:500,stock:10,active:true,units:[],vatMode:'none'}];
    currentTab='checkout';saleMember=customerSaleSnapshot(contacts[0]);cart=[];saleDiscount=0;addToCart(101,'กล่อง',1);
    window.failRead=false;window.failCheckout=false;window.ambiguous=false;window.requests=[];
    window.loyaltyRpc=async(name,p)=>{
      if(name==='get_customer_loyalty')return window.failRead?{error:{message:'offline'}}:{data:[{customerId:'1',balance:200,joinedOn:'2025-12-03',periodStart:'2025-12-03',expiresOn:'2026-12-03',expiresAt:'2026-12-02T17:00:00Z'}]};
      if(name==='complete_sale'){
        window.requests.push(p);
        if(window.ambiguous)return {error:{message:'Failed to fetch'}};
        if(window.failCheckout)return {error:{code:'P0001',message:'LOYALTY_INSUFFICIENT_POINTS'}};
        return {data:{sale:{...p.p_sale,id:'TEST-LOYALTY',loyalty:{earned:Math.floor(p.p_sale.total/50),redeemed:p.p_sale.loyaltyRedeemed,periodStart:'2026-09-03',expiresOn:'2027-09-03',balanceAfter:118}}}};
      }
      return {data:null,error:null};
    };
    render();
  });
  await page.getByText('200 แต้ม',{exact:true}).waitFor();
  assert.match(await page.locator('#customerLoyaltyPanel').innerText(),/หมดอายุ 03-12-2026[\s\S]*แต้มจะหมดอายุภายใน 3 เดือน/);
  assert.equal(await page.getByText(/สมัคร 03-12-2025/).count(),0,'POS must show expiry without joined date');
  await page.locator('[data-redeem-loyalty]').click();
  await page.locator('#loyaltyPointsInput').fill('100');await page.locator('#loyaltyApply').click();
  assert.equal(await page.locator('#posGrandValue').textContent(),'900.00');
  assert.equal(await page.locator('#posDiscountValue').textContent(),'100.00');
  await page.evaluate(()=>{cart[0].price=999;recalcPOSCartDOM();});
  assert.equal(await page.locator('#posGrandValue').textContent(),'999.00');
  assert.equal(await page.locator('[data-redeem-loyalty]').isDisabled(),true);
  await page.evaluate(()=>{cart[0].price=1000;recalcPOSCartDOM();});
  await page.locator('[data-clear-loyalty]').click();
  assert.equal(await page.locator('#posGrandValue').textContent(),'1,000.00');
  await page.evaluate(()=>window.failRead=true);await page.locator('[data-refresh-loyalty]').click();
  await page.getByText('อ่านแต้มไม่สำเร็จ กรุณากดรีเฟรชแต้ม',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-redeem-loyalty]').isDisabled(),true);
  await page.evaluate(()=>window.failRead=false);await page.locator('[data-refresh-loyalty]').click();
  await page.getByText('200 แต้ม',{exact:true}).waitFor();
  await page.locator('[data-redeem-loyalty]').click();await page.locator('#loyaltyPointsInput').fill('100');await page.locator('#loyaltyApply').click();
  fs.mkdirSync(path.join(root,'outputs'),{recursive:true});await page.screenshot({path:path.join(root,'outputs/customer-loyalty-pos.png'),fullPage:true});
  await page.evaluate(async()=>{window.failCheckout=true;await doCheckout('เงินสด',{cashReceived:900});});
  assert.equal(await page.evaluate(()=>saleLoyaltySelection),null,'stale points cleared on definite rejection');
  assert.equal(await page.evaluate(()=>cart.length),1,'rejected checkout preserves cart');
  await page.getByText('200 แต้ม',{exact:true}).waitFor();
  await page.locator('[data-redeem-loyalty]').click();await page.locator('#loyaltyPointsInput').fill('100');await page.locator('#loyaltyApply').click();
  await page.evaluate(async()=>{window.failCheckout=false;window.ambiguous=true;await doCheckout('เงินสด',{cashReceived:900});});
  assert.equal(await page.evaluate(()=>readPendingCheckoutRequest().payload.sale.loyaltyRedeemed),100);
  await page.evaluate(async()=>{window.ambiguous=false;await doCheckout('เงินสด',{cashReceived:900});});
  const result=await page.evaluate(()=>({requests:window.requests,sale:salesHistory.find(s=>s.id==='TEST-LOYALTY'),cart:cart.length,pending:readPendingCheckoutRequest()}));
  assert.equal(result.requests[1].p_request_id,result.requests[2].p_request_id,'ambiguous retry keeps request id');
  assert.deepEqual(result.requests[1].p_sale,result.requests[2].p_sale,'retry keeps exact sale including points');
  assert.equal(result.sale.total,900);assert.equal(result.sale.loyalty.earned,18);assert.equal(result.cart,0);assert.equal(result.pending,null);
  assert.deepEqual(errors,[]);
  console.log('Loyalty browser checks passed: rendering, eligibility, redeem, read errors, stale balance, ambiguous retry, checkout totals');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
