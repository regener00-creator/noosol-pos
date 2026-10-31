const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,'../public');
const server=http.createServer((req,res)=>{const file=path.resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.PEPOS_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  await installIsolatedBrowser(page);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    currentProfile={id:'popup-owner',owner:true,level:1,firstName:'เจ้าของ'};activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ'}];
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    products=[{id:1,sku:'001',barcode:'SACHET',name:'สินค้าทดสอบ',unit:'ซอง',price:8,cost:4,stock:200,active:true,units:[{sub:'กล่อง',factor:25,price:180,cost:100,barcode:'BOX'}]}];
    contacts=[{id:7,name:'ลูกค้า A',types:['customer'],customerPrices:[{id:'a',productId:1,unit:'กล่อง',price:160}]},{id:8,name:'ลูกค้า B',types:['customer'],customerPrices:[]}];
    window.contactSaves=[];window.failPriceSave=false;persistContacts=()=>{};persistContactImmediately=async customer=>{if(window.failPriceSave)throw new Error('test offline');window.contactSaves.push(JSON.parse(JSON.stringify(customer)));return true;};
    currentTab='checkout';saleMember=customerSaleSnapshot(contacts[0]);cart=[];addToCart(1,'กล่อง',1);window.originalCart=cart;
    cart.push({lineId:99,custom:true,name:'บริการ',unit:'Pcs',qty:1,price:20,factor:0});render();window.originalCart=cart;
  });
  const trigger=page.locator('[data-customer-special-prices]'),modal=page.locator('.pos-customer-pricing-modal');
  assert.equal(await page.locator('[data-customer-history] + [data-customer-special-prices]').count(),1);
  assert.equal(await page.evaluate(()=>pageCodeReady('catalog')),false,'first popup must load the catalog code');
  await trigger.click();await modal.locator('#customerPriceSearch').waitFor();
  assert.match(await modal.innerText(),/ราคาพิเศษสำหรับลูกค้ารายนี้ · ลูกค้า A/);
  assert.equal(await modal.locator('.customer-price-unit option:checked').textContent(),'กล่อง = 25 ซอง');
  assert.equal(await page.evaluate(()=>currentTab),'checkout');
  await modal.locator('.customer-price-value').fill('150');
  await modal.locator('#cancelCustomerPricingBtn').click();
  assert.equal(await modal.count(),0);assert.equal(await page.evaluate(()=>contacts[0].customerPrices[0].price),160);
  assert.equal(await page.evaluate(()=>cart===window.originalCart),true);
  await trigger.click();await modal.locator('#customerPriceSearch').waitFor();
  // Background POS rendering must not attach a second, unscoped pricing handler.
  await page.evaluate(()=>render());
  await modal.locator('#customerPriceSearch').fill('SACHET');await modal.locator('#customerPriceSearch').press('Enter');
  assert.equal(await modal.locator('[data-customer-price-row]').count(),2);
  await modal.locator('.customer-price-value').first().fill('150');await modal.locator('.customer-price-value').last().fill('7');
  if(process.env.PEPOS_CAPTURE_PRICING){fs.mkdirSync(path.resolve(__dirname,'../outputs'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../outputs/pos-customer-pricing.png')});}
  await modal.locator('#saveCustomerPricingBtn').click();await modal.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.contactSaves.length),1);
  assert.equal(await page.evaluate(()=>cart[0].price),150);assert.equal(await page.evaluate(()=>cart[1].price),20);
  assert.deepEqual(await page.evaluate(()=>cart.map(line=>({name:line.name,qty:line.qty}))),[{name:'สินค้าทดสอบ',qty:1},{name:'บริการ',qty:1}]);
  assert.equal(await page.evaluate(()=>contacts[1].customerPrices.length),0);
  await trigger.click();await modal.locator('#customerPriceSearch').waitFor();
  await page.evaluate(()=>window.failPriceSave=true);await modal.locator('#saveCustomerPricingBtn').click();
  await page.waitForFunction(()=>!document.querySelector('.pos-customer-pricing-modal #saveCustomerPricingBtn')?.disabled);
  assert.equal(await modal.count(),1);await modal.locator('.modal-close').click();
  // View-only access may inspect prices but cannot edit or save through the popup.
  await page.evaluate(()=>{window.failPriceSave=false;currentProfile={id:'viewer',level:2};pagePermissionRows=[{page_key:'contacts',warehouse_id:1,can_view:true,can_edit:false}];canAccessTab=()=>true;render();});
  await trigger.click();await modal.locator('.customer-price-unit').first().waitFor();
  assert.equal(await modal.locator('#saveCustomerPricingBtn').count(),0);assert.equal(await modal.locator('.customer-price-value').first().isDisabled(),true);
  await modal.locator('#cancelCustomerPricingBtn').click();
  assert.deepEqual(errors,[]);console.log('POS special prices popup: lazy load, selected customer, cancel, save, cart repricing, error and view-only access passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
