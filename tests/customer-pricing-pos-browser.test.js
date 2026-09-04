const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
  if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});

let browser;
const browserExecutable = [
  process.env.PEPOS_BROWSER_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless:true, executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route=>route.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route=>route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route=>route.fulfill({contentType:'text/javascript',body:`
    (()=>{ const query=new Proxy({}, {get(_target,property){ if(property==='then') return resolve=>resolve({data:null,error:null}); return ()=>query; }}); window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}}, {get(target,property){return property in target?target[property]:(()=>query);}})}; })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof renderContactForm==='function'&&typeof renderCheckout==='function');
  await page.evaluate(() => {
    document.querySelectorAll('.login-screen').forEach(screen=>{screen.style.display='none';});
    renderLoginState=()=>true; renderSidebar=()=>{}; persistContacts=()=>{}; persistQuotations=()=>{};
    currentProfile={id:'owner-customer-price',owner:true,level:1,firstName:'เจ้าของ'};
    products=[{id:101,sku:'D-001',name:'Decolgen',category:'ยา',brand:'ทั่วไป',unit:'ซอง',barcode:'SACHET-101',price:8,cost:5,stock:100,units:[{sub:'กล่อง',factor:25,price:180,cost:110,barcode:'BOX-101'}],extraBarcodes:[],vendorBarcodes:[],active:true}];
    contacts=[{id:7,name:'ลูกค้า A',types:['customer'],entity:'individual',phone:'0812345678',defaultDocument:'cash_bill',customerPrices:[{id:'a-box',productId:101,unit:'กล่อง',price:160}]}];
    nextContactId=8; editingContactId=null; editingCustomerPriceContactId=null; currentTab='contacts'; searchQuery=''; contactFilter='all';
    document.getElementById('main').innerHTML=renderContacts(); attachEvents();
  });
  assert.equal(await page.locator('[data-act="customerprice"]').count(),1);
  assert.equal(await page.locator('[data-act="editcontact"] + [data-act="customerprice"]').count(),1);
  await page.locator('[data-act="customerprice"]').click();
  assert.equal(await page.locator('#saveCustomerPricingBtn').count(),1);
  assert.equal(await page.locator('#c_default_document').count(),0);
  assert.deepEqual(await page.locator('.customer-price-table thead th').allTextContents(),['บาร์โค้ดสินค้า','ชื่อ','หน่วย','ราคาพิเศษ','ทุน','']);
  assert.equal(await page.locator('.customer-price-product-name b').textContent(),'Decolgen');
  assert.equal(await page.locator('.customer-price-barcode').textContent(),'BOX-101');
  assert.equal(await page.locator('.customer-price-unit').inputValue(),'กล่อง');
  assert.equal(await page.locator('.customer-price-cost').inputValue(),'110.00');
  assert.equal(await page.locator('.customer-price-cost').getAttribute('readonly'),'');
  await page.locator('.customer-price-value').fill('155');
  await page.locator('#customerPriceSearch').fill('SACHET-101');
  await page.locator('#customerPriceSearch').press('Enter');
  assert.equal(await page.locator('[data-customer-price-row]').count(),2);
  assert.equal(await page.locator('[data-customer-price-row]').last().locator('.customer-price-unit').inputValue(),'ซอง');
  assert.equal(await page.locator('[data-customer-price-row]').last().locator('.customer-price-cost').inputValue(),'5.00');
  await page.locator('[data-customer-price-row]').last().locator('.customer-price-value').fill('7');
  await page.locator('#saveCustomerPricingBtn').click();
  assert.equal(await page.evaluate(()=>contacts[0].customerPrices[0].price),155);
  assert.equal(await page.evaluate(()=>contacts[0].customerPrices[1].price),7);
  assert.equal(await page.evaluate(()=>customerDefaultDocument(contacts[0])),'short_receipt');
  await page.locator('[data-act="editcontact"]').click();
  assert.equal(await page.locator('.customer-pricing-panel').count(),0);
  assert.equal(await page.locator('#customerPriceSearch').count(),0);
  await page.locator('#c_phone').fill('0899999999');
  await page.locator('#saveContactBtn').click();
  assert.equal(await page.evaluate(()=>contacts[0].customerPrices.length),2);
  assert.equal(await page.evaluate(()=>contacts[0].phone),'089-999-9999');

  await page.evaluate(() => {
    currentTab='checkout'; cart=[]; saleMember=customerSaleSnapshot(contacts[0]); currentCashShift={id:'shift-test',shiftNo:'CS-TEST',openingCash:0,openedByName:'เจ้าของ'};
    addToCart(101,'กล่อง',1); document.getElementById('main').innerHTML=renderCheckout(); attachEvents();
  });
  assert.equal(await page.evaluate(()=>cart[0].price),155);
  assert.equal(await page.evaluate(()=>cart[0].regularPrice),180);
  assert.equal(await page.locator('.pos-customer-price-tag').count(),1);
  assert.equal((await page.locator('.pos-table thead').textContent()).includes('ทุน'),false);
  assert.equal(await page.locator('.pos-table .customer-price-cost').count(),0);
  assert.equal(await page.locator('#memberSearch').count(),0);
  assert.equal(await page.locator('.pos-customer-card').count(),0);
  assert.equal(await page.locator('.pos-customer-slot>label').count(),0);
  assert.equal(await page.locator('#openCustomerPickerBtn strong').textContent(),'ลูกค้า A');
  await page.locator('#openCustomerPickerBtn').click();
  assert.equal(await page.locator('.pos-customer-picker-modal').count(),1);
  await page.locator('#posCustomerPickerSearch').fill('081234');
  assert.equal(await page.locator('[data-pos-customer-index]:visible').count(),1);
  await page.locator('[data-pos-customer-general]').click();
  assert.equal(await page.evaluate(()=>cart[0].price),180);
  assert.equal(await page.locator('.pos-customer-price-tag').count(),0);

  await page.evaluate(() => {
    quotations=[{id:'QT-TEST',date:'2026-09-04',customer:'ลูกค้า A',customerInfo:{id:7,name:'ลูกค้า A'},items:[{productId:101,name:'Decolgen',qty:2,unit:'กล่อง',price:150}],discount:0,total:300,status:'รอตอบรับ'}];
    cart=[]; currentTab='quotation'; editingQuotationId=null; document.getElementById('main').innerHTML=renderQuotation(); attachEvents();
  });
  await page.locator('[data-sell-quotation="QT-TEST"]').click();
  assert.equal(await page.evaluate(()=>cart[0].price),150);
  assert.equal(await page.evaluate(()=>cart[0].priceSource),'quotation');
  assert.equal(await page.evaluate(()=>saleSourceQuotationId),'QT-TEST');
  assert.equal(await page.locator('.pos-quotation-price-tag').count(),1);
  assert.deepEqual(errors,[],`พบ JavaScript error: ${errors.join(' | ')}`);
  console.log('customer pricing POS browser tests passed');
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(async()=>{
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
});
