const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg'};
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
].find(file => file && fs.existsSync(file));

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบตัวออกแบบป้ายราคา');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const query=new Proxy({}, {get(_target,property){
        if(property==='then') return resolve=>resolve({data:null,error:null});
        return ()=>query;
      }});
      window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}}, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof openPriceLabelDesigner === 'function');
  await page.evaluate(() => {
    document.querySelectorAll('.login-screen').forEach(screen => { screen.style.display='none'; });
    currentProfile={id:'owner-test',owner:true,firstName:'เจ้าของ',lastName:'ร้าน'};
    products=[{id:9001,sku:'P-9001',name:'Decolgen prin (4 tablets)',unit:'กล่อง',barcode:'8851824336354',price:180,units:[],extraBarcodes:[],vendorBarcodes:[]}];
    barcodePrintItems=[{pid:9001,unit:'กล่อง',barcode:'8851824336354',qty:1}];
    barcodePrintLabelType='price';
    barcodePrintLabelSize='80x50';
    businessSettings={...businessSettings,priceLabelTemplates:{}};
    main.innerHTML=renderBarcodePrint();
    attachEvents();
  });

  assert.equal(await page.locator('#openPriceLabelDesignerBtn').isVisible(), true);
  await page.locator('#openPriceLabelDesignerBtn').click();
  assert.equal(await page.locator('.price-label-designer-modal').isVisible(), true);
  assert.equal(await page.locator('[data-price-label-tab]').count(), 5);
  assert.equal(await page.locator('.price-label-design-element').count(), 5);
  assert.match(await page.locator('.price-label-safety-note').textContent(), /32 × 8 มม\./);
  const ratio = await page.locator('#priceLabelDesignerCanvas').evaluate(element => {
    const rect=element.getBoundingClientRect();
    return rect.width/rect.height;
  });
  assert.ok(Math.abs(ratio-1.6)<0.02, 'พื้นที่ออกแบบต้องเป็นสัดส่วน 80 × 50 มม.');

  await page.locator('#priceLabelPresetSelect').selectOption('center');
  await page.locator('[data-price-label-tab="price"]').click();
  const priceX = page.locator('[data-price-label-field="x"]');
  await priceX.fill('7');
  await priceX.press('Tab');
  await page.locator('[data-price-label-field="color"]').evaluate(element => {
    element.value='#123456';
    element.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.locator('[data-price-label-tab="barcode"]').click();
  const barcodeWidth = page.locator('[data-price-label-field="width"]');
  await barcodeWidth.fill('10');
  await barcodeWidth.press('Tab');
  assert.ok(Number(await barcodeWidth.inputValue())>=40, 'ป้าย 80 มม. ต้องบังคับบาร์โค้ดกว้างอย่างน้อย 32 มม.');
  await page.locator('[data-price-label-tab="unit"]').click();
  await page.locator('[data-price-label-visible]').uncheck();
  assert.ok((await page.locator('[data-price-label-tab="unit"]').getAttribute('class')).includes('off'));
  await page.locator('#savePriceLabelDesignerBtn').click();
  await page.waitForSelector('.price-label-designer-modal',{state:'detached'});

  const saved = await page.evaluate(() => businessSettings.priceLabelTemplates['80x50']);
  assert.equal(saved.preset,'custom');
  assert.equal(saved.elements.price.x,7);
  assert.equal(saved.elements.price.color,'#123456');
  assert.equal(saved.elements.unit.visible,false);
  assert.ok(saved.elements.barcode.width>=40);

  await page.locator('#openPriceLabelDesignerBtn').click();
  await page.locator('[data-price-label-tab="price"]').click();
  assert.equal(await page.locator('[data-price-label-field="x"]').inputValue(),'7');
  assert.equal(await page.locator('[data-price-label-field="color"]').inputValue(),'#123456');
  assert.deepEqual(errors, []);
  console.log('price label designer browser tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
