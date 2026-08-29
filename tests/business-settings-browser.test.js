const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file));

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบหน้าเว็บ');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const query=new Proxy({}, {get(_target,property){
        if(property==='then') return resolve=>resolve({data:null,error:null});
        return ()=>query;
      }});
      window.supabase={createClient:()=>new Proxy({
        auth:{
          getSession:async()=>({data:{session:null}}),
          onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
          signOut:async()=>({error:null})
        }
      }, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof renderBusinessSettings === 'function');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    currentProfile={id:'browser-test',level:1,owner:true,firstName:'ทดสอบ'};
    businessSettings={...DEFAULT_BUSINESS_SETTINGS,name:'ร้าน <ทดสอบ>',vat:'ยังไม่จดภาษีมูลค่าเพิ่ม',branch:'head'};
    currentTab='settingsbusiness';
    document.getElementById('main').innerHTML=renderBusinessSettings();
    attachEvents();
    syncTopbarFormActions();
    document.querySelectorAll('.login-screen').forEach(screen=>{screen.style.display='none';});
  });

  assert.equal(await page.locator('#set_business_name').inputValue(), 'ร้าน <ทดสอบ>');
  assert.equal(await page.locator('#businessVatDateRow').isHidden(), true);
  assert.equal(await page.locator('#businessTaxBranchRow').isHidden(), true);
  assert.equal(await page.locator('#topbarFormActions #saveBusinessSettingsBtn').count(), 1);
  assert.equal(await page.locator('#main #saveBusinessSettingsBtn').count(), 0);

  await page.locator('#set_business_vat').selectOption('จดภาษีมูลค่าเพิ่มแล้ว');
  assert.equal(await page.locator('#businessVatDateRow').isVisible(), true);
  assert.equal(await page.locator('#businessTaxBranchRow').isVisible(), true);
  await page.locator('input[name="set_branch"][value="branch"]').check({force:true});
  assert.equal(await page.locator('#businessBranchFields').isVisible(), true);

  await page.screenshot({path:path.join(os.tmpdir(),'pepos-business-settings-browser.png'),fullPage:true});

  await page.evaluate(() => {
    editingProductId=products[0].id;
    currentTab='products';
    document.getElementById('topbarFormActions').innerHTML='';
    document.getElementById('main').innerHTML=renderProductForm();
    attachEvents();
    syncTopbarFormActions();
  });
  assert.equal(await page.locator('.pagehead h1').count(),0);
  assert.equal(await page.locator('text=ประเภทสินค้า').count(),0);
  assert.equal(await page.locator('#f_wh').count(),0);
  assert.equal(await page.locator('#f_expiry').count(),0);
  assert.equal(await page.locator('label', {hasText:'ยี่ห้อ/แบรนด์'}).count(),1);
  assert.equal(await page.locator('h3', {hasText:'หน่วยและราคา'}).count(),1);
  assert.equal(await page.locator('#f_stock').isEditable(),true);
  const productFieldRows=await page.evaluate(() => {
    const top=id=>Math.round(document.querySelector(id).closest('.field').getBoundingClientRect().top);
    return {
      category:[top('#f_category'),top('#f_brand'),top('#f_vat')],
      identity:[top('#f_sku'),top('#f_name')],
      unit:[top('#f_unit'),top('#f_price'),top('#f_cost'),top('#f_stock'),top('#f_barcode')],
    };
  });
  assert.equal(new Set(productFieldRows.category).size,1,'หมวดสินค้า แบรนด์ และ VAT ต้องอยู่บรรทัดเดียวกัน');
  assert.equal(new Set(productFieldRows.identity).size,1,'SKU และชื่อสินค้าต้องอยู่บรรทัดเดียวกัน');
  assert.equal(new Set(productFieldRows.unit).size,1,'หน่วย ราคา ทุน คงเหลือ และบาร์โค้ดต้องอยู่บรรทัดเดียวกัน');
  await page.screenshot({path:path.join(os.tmpdir(),'pepos-product-form-browser.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  const mobileProductFieldRows=await page.evaluate(() => {
    const top=id=>Math.round(document.querySelector(id).closest('.field').getBoundingClientRect().top);
    return {
      category:[top('#f_category'),top('#f_brand'),top('#f_vat')],
      identity:[top('#f_sku'),top('#f_name')],
      unit:[top('#f_unit'),top('#f_price'),top('#f_cost'),top('#f_stock'),top('#f_barcode')],
    };
  });
  assert.equal(new Set(mobileProductFieldRows.category).size,3,'ช่องหมวดสินค้าบนมือถือต้องเรียงลงคนละบรรทัด');
  assert.equal(new Set(mobileProductFieldRows.identity).size,2,'SKU และชื่อสินค้าบนมือถือต้องเรียงลงคนละบรรทัด');
  assert.equal(new Set(mobileProductFieldRows.unit).size,5,'ช่องหน่วยและราคาบนมือถือต้องเรียงลงคนละบรรทัด');
  await page.screenshot({path:path.join(os.tmpdir(),'pepos-product-form-mobile-browser.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});

  await page.evaluate(() => {
    activeWarehouseId=warehouses[0]?.id||1;
    currentCashShift={id:'shift-browser-test',shiftNo:'CS202608270003',status:'open',openingCash:500,openedBy:'browser-test',openedByName:'กรธวัช จันทรวารี',openedAt:new Date().toISOString()};
    currentTab='checkout';
    document.getElementById('topbarFormActions').innerHTML='';
    document.getElementById('main').innerHTML=renderCheckout();
    attachEvents();
    syncTopbarFormActions();
  });
  const paymentStatus=page.locator('#topbarFormActions .cash-shift-topbar-action');
  assert.equal(await paymentStatus.count(), 1);
  assert.equal(await page.locator('#main .cash-shift-topbar-action').count(), 0);
  assert.match(await paymentStatus.innerText(), /^CS202608270003 เปิดอยู่ : เงินตั้งต้น 500\.00 บาท · กรธวัช จันทรวารี\s*สรุปชำระ$/);
  const paymentStatusLayout=await paymentStatus.evaluate(element=>{
    const text=element.querySelector('span').getBoundingClientRect();
    const button=element.querySelector('button').getBoundingClientRect();
    return {whiteSpace:getComputedStyle(element).whiteSpace,textCenter:text.top+(text.height/2),buttonCenter:button.top+(button.height/2)};
  });
  assert.equal(paymentStatusLayout.whiteSpace,'nowrap');
  assert.ok(Math.abs(paymentStatusLayout.textCenter-paymentStatusLayout.buttonCenter)<2,'สถานะและปุ่มสรุปชำระต้องอยู่แถวเดียวกัน');

  await page.evaluate(() => {
    currentTab='cashshift';
    document.getElementById('topbarFormActions').innerHTML='';
    document.getElementById('main').innerHTML=renderCashShift();
    attachEvents();
    syncTopbarFormActions();
  });
  assert.equal(await page.locator('.cash-shift-heading').count(),0);
  assert.equal(await page.locator('#cashShiftCloseForm h3').innerText(),'ปิดระบบ');
  assert.equal(await page.locator('#cashShiftCloseForm button[type="submit"]').innerText(),'ยืนยันการปิดระบบ');

  await page.evaluate(() => {
    currentCashShift=null;
    document.getElementById('topbarFormActions').innerHTML='';
    document.getElementById('main').innerHTML=renderCashShift();
    attachEvents();
    syncTopbarFormActions();
  });
  const openShiftButton=page.locator('#topbarFormActions button[form="cashShiftOpenForm"]');
  assert.equal(await openShiftButton.innerText(),'เปิดระบบชำระ');
  assert.equal(await page.locator('#main .cash-shift-topbar-action').count(),0);
  assert.equal(await page.locator('#cashShiftOpenForm').count(),1);
  assert.equal(await openShiftButton.evaluate(button=>button.form?.id),'cashShiftOpenForm');

  assert.deepEqual(errors, []);
  console.log('business settings browser tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
