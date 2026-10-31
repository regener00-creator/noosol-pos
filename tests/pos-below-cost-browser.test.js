const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,'../public');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.PEPOS_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  await installIsolatedBrowser(page);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    currentProfile={id:'below-cost-owner',owner:true,level:1,firstName:'ทดสอบ'};
    activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ',active:true}];
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});isMobileDeviceMode=()=>false;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    currentCashShift={id:'below-cost-shift',shiftNo:'CS-TEST'};
    products=[{id:1,name:'สินค้าทดสอบ',unit:'ซอง',price:8,cost:4,stock:200,active:true,units:[{sub:'กล่อง',factor:25,price:180,cost:100}]}];
    contacts=[];promotions=[];cart=[];saleMember=null;saleDiscount=0;saleLoyaltySelection=null;currentTab='checkout';
    addToCart(1,'กล่อง',2);cart[0].price=99;cart[0].cost=1;cart[0].priceSource='customer';render();
    window.checkoutCalls=[];doCheckout=async(method,options)=>window.checkoutCalls.push({method,options});
  });
  const modal=page.locator('.checkout-pay-modal');let warning='';
  const dismiss=()=>page.once('dialog',async dialog=>{warning=dialog.message();await dialog.dismiss();});
  dismiss();await page.locator('#checkoutBtn').click();
  assert.match(warning,/ต่ำกว่าทุน 1 รายการ/);
  assert.match(warning,/สินค้าทดสอบ \(กล่อง\).*99.00.*100.00/,'uses current cost for the selected unit, not stale cart cost');
  assert.equal(await modal.count(),0);assert.equal(await page.evaluate(()=>cart[0].qty),2);
  assert.equal(await page.evaluate(()=>window.checkoutCalls.length),0);
  dismiss();await page.locator('#search').focus();await page.keyboard.press('F2');
  assert.equal(await modal.count(),0,'F2 cannot bypass the warning');
  for(const [method,finish] of [['cash','cashFinishBtn'],['bank','bankFinishBtn'],['card','cardFinishBtn'],['online','onlineFinishBtn']]){
    page.once('dialog',dialog=>dialog.accept());await page.locator('#checkoutBtn').click();
    assert.equal(await modal.count(),1);
    await modal.locator(`[data-method="${method}"]`).click();
    if(method==='cash')await modal.locator('[data-cash-key="exact"]').click();
    await modal.locator('#'+finish).click();assert.equal(await modal.count(),0);
  }
  assert.deepEqual(await page.evaluate(()=>window.checkoutCalls.map(call=>call.method)),['เงินสด','โอนธนาคาร','บัตรเครดิต','ออนไลน์']);
  // Equal cost, above cost, and decimal equality do not prompt.
  for(const [price,cost,qty] of [[100,100,2],[101,100,2],[0.7,0.7,3]]){
    await page.evaluate(({price,cost,qty})=>{cart[0].price=price;cart[0].qty=qty;products[0].units[0].cost=cost;render();},{price,cost,qty});
    await page.locator('#checkoutBtn').click();assert.equal(await modal.count(),1);
    await modal.locator('.modal-close').click();
  }
  // A promotion that takes a standard price below cost is also checked.
  await page.evaluate(()=>{
    products[0].units[0].cost=100;cart[0].price=180;cart[0].priceSource='standard';cart[0].qty=1;
    promotions=[{id:1,name:'ลดราคา',active:true,type:'discount',scope:'product',productId:1,unit:'กล่อง',discountMode:'percent',discountValue:50}];render();
  });
  dismiss();await page.locator('#checkoutBtn').click();assert.match(warning,/90.00.*100.00/);assert.equal(await modal.count(),0);
  // Quote prices, base units and zero-price goods still warn; custom items have no product cost.
  await page.evaluate(()=>{promotions=[];cart=[];addToCart(1,'ซอง',1);cart[0].price=0;cart[0].priceSource='quotation';render();});
  dismiss();await page.locator('#checkoutBtn').click();assert.match(warning,/ซอง.*0.00.*4.00/);
  await page.evaluate(()=>{cart=[];addCustomCartLine('บริการ',1,'Pcs',1);render();});
  await page.locator('#checkoutBtn').click();assert.equal(await modal.count(),1);await modal.locator('.modal-close').click();
  assert.deepEqual(errors,[]);
  console.log('POS below-cost warning: button/F2, cancel, all payment methods, unit cost, promotions, quotation, equality and custom items passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
