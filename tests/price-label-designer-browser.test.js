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
    barcodePrintLabelSize='50x30';
    businessSettings={...businessSettings,priceLabelTemplates:{},priceLabelTemplateLibraries:{}};
    main.innerHTML=renderBarcodePrint();
    attachEvents();
  });

  assert.equal(await page.locator('#barcodePrintLabelType').count(),0);
  assert.equal(await page.locator('#barcodePrintLabelSize').inputValue(),'50x30');
  assert.match(await page.locator('.page-title-meta').textContent(),/50 × 30 มม\./);
  assert.equal(await page.locator('#openPriceLabelDesignerBtn').isVisible(), true);
  await page.locator('#openPriceLabelDesignerBtn').click();
  assert.equal(await page.locator('.price-label-designer-modal').isVisible(), true);
  assert.equal(await page.locator('[data-price-label-tab]').count(), 5);
  assert.equal(await page.locator('.price-label-design-element').count(), 5);
  assert.match(await page.locator('.price-label-safety-note').textContent(), /24 × 6 มม\./);
  assert.match(await page.locator('.price-label-safety-note').textContent(), /32 × 8 มม\./);
  const ratio = await page.locator('#priceLabelDesignerCanvas').evaluate(element => {
    const rect=element.getBoundingClientRect();
    return rect.width/rect.height;
  });
  assert.ok(Math.abs(ratio-(5/3))<0.02, 'พื้นที่ออกแบบต้องเป็นสัดส่วน 50 × 30 มม.');

  await page.locator('#priceLabelPresetSelect').selectOption('center');
  await page.locator('[data-price-label-tab="price"]').click();
  const priceX = page.locator('[data-price-label-field="x"]');
  await priceX.fill('7');
  await priceX.press('Tab');
  const fontSize = page.locator('[data-price-label-field="fontSize"]');
  await fontSize.fill('96');
  await fontSize.press('Tab');
  assert.equal(await fontSize.inputValue(),'96');
  const previewTypography = await page.locator('[data-price-label-element="price"]').evaluate((element) => {
    const canvas=element.closest('#priceLabelDesignerCanvas');
    return {fontSize:parseFloat(getComputedStyle(element).fontSize),canvasWidth:canvas.getBoundingClientRect().width};
  });
  const expectedPreviewFontSize=96*previewTypography.canvasWidth*25.4/(72*50);
  assert.ok(Math.abs(previewTypography.fontSize-expectedPreviewFontSize)<1, 'ขนาดตัวอักษรในตัวออกแบบต้องตรงตามสเกลกระดาษจริง');
  assert.deepEqual(await page.locator('[data-price-label-color]').evaluateAll(elements => elements.map(element => element.value)), ['#000000','#e60012']);
  await page.locator('[data-price-label-color][value="#000000"]').evaluate(element => { element.checked=true; element.dispatchEvent(new Event('change',{bubbles:true})); });
  assert.equal((await page.locator('.price-label-reverse-toggle').textContent()).trim(),'REVERSE TYPE');
  await page.locator('[data-price-label-reverse]').evaluate(element => { element.checked=true; element.dispatchEvent(new Event('change',{bubbles:true})); });
  await page.locator('#addPriceLabelCustomTextBtn').click();
  assert.equal(await page.locator('[data-price-label-tab]').count(), 6);
  await page.locator('[data-price-label-custom-value]').fill('SALE -15%');
  await page.locator('[data-price-label-custom-value]').press('Tab');
  await page.locator('[data-price-label-color][value="#e60012"]').evaluate(element => { element.checked=true; element.dispatchEvent(new Event('change',{bubbles:true})); });
  await page.locator('[data-price-label-reverse]').evaluate(element => { element.checked=true; element.dispatchEvent(new Event('change',{bubbles:true})); });
  await page.locator('[data-price-label-tab="barcode"]').click();
  const barcodeWidth = page.locator('[data-price-label-field="width"]');
  await barcodeWidth.fill('10');
  await barcodeWidth.press('Tab');
  assert.ok(Number(await barcodeWidth.inputValue())>=48, 'ป้าย 50 มม. ต้องบังคับบาร์โค้ดกว้างอย่างน้อย 24 มม.');
  assert.ok((await page.locator('.price-label-barcode-limit').getAttribute('class')).includes('warning'));
  await page.locator('[data-price-label-tab="unit"]').click();
  await page.locator('[data-price-label-visible]').uncheck();
  assert.ok((await page.locator('[data-price-label-tab="unit"]').getAttribute('class')).includes('off'));
  await page.locator('#priceLabelTemplateNameInput').fill('แม่แบบแดง');
  await page.locator('#saveAsNewPriceLabelTemplateBtn').click();
  await page.locator('#priceLabelTemplateNameInput').fill('แม่แบบสำเนา');
  await page.locator('#saveAsNewPriceLabelTemplateBtn').click();
  assert.equal(await page.locator('#savedPriceLabelTemplateSelect option').count(),2);
  const libraryBeforeUse = await page.evaluate(() => businessSettings.priceLabelTemplateLibraries['50x30']);
  assert.equal(libraryBeforeUse.templates.length,2);
  assert.equal(libraryBeforeUse.activeId,libraryBeforeUse.templates[0].id);
  await page.locator('#savedPriceLabelTemplateSelect').selectOption(libraryBeforeUse.templates[0].id);
  await page.locator('#savePriceLabelDesignerBtn').click();
  await page.waitForSelector('.price-label-designer-modal',{state:'detached'});

  const saved = await page.evaluate(() => businessSettings.priceLabelTemplates['50x30']);
  assert.equal(saved.preset,'custom');
  assert.equal(saved.elements.price.x,7);
  assert.equal(saved.elements.price.fontSize,96);
  assert.equal(saved.elements.price.color,'#000000');
  assert.equal(saved.elements.price.reverse,true);
  assert.equal(saved.elements.unit.visible,false);
  assert.ok(saved.elements.barcode.width>=48);
  assert.equal(saved.customTexts.length,1);
  assert.equal(saved.customTexts[0].text,'SALE -15%');
  assert.equal(saved.customTexts[0].color,'#e60012');
  assert.equal(saved.customTexts[0].reverse,true);
  const savedLibrary = await page.evaluate(() => businessSettings.priceLabelTemplateLibraries['50x30']);
  assert.equal(savedLibrary.templates.length,2);
  assert.equal(savedLibrary.activeId,savedLibrary.templates[0].id);

  await page.locator('#openPriceLabelDesignerBtn').click();
  assert.equal(await page.locator('#savedPriceLabelTemplateSelect option').count(),2);
  await page.locator('[data-price-label-tab="price"]').click();
  assert.equal(await page.locator('[data-price-label-field="x"]').inputValue(),'7');
  assert.equal(await page.locator('[data-price-label-color][value="#000000"]').isChecked(),true);
  assert.equal(await page.locator('[data-price-label-reverse]').isChecked(),true);
  await page.locator('[data-price-label-tab]').filter({hasText:'ข้อความ 1'}).click();
  assert.equal(await page.locator('[data-price-label-custom-value]').inputValue(),'SALE -15%');
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
