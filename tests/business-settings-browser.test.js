const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

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
    businessSettings={...DEFAULT_BUSINESS_SETTINGS,name:'ร้าน <ทดสอบ>',line:'@NOOSOL',vat:'ยังไม่จดภาษีมูลค่าเพิ่ม',branch:'head'};
    currentTab='settingsbusiness';
    document.getElementById('main').innerHTML=renderBusinessSettings();
    attachEvents();
    syncTopbarFormActions();
    document.querySelectorAll('.login-screen').forEach(screen=>{screen.style.display='none';});
  });

  assert.equal(await page.locator('#set_business_name').inputValue(), 'ร้าน <ทดสอบ>');
  assert.equal(await page.locator('#set_business_line').inputValue(), '@NOOSOL');
  assert.equal(await page.locator('#set_business_line').getAttribute('placeholder'), 'เช่น @NOOSOL');
  assert.equal(await page.locator('#businessVatDateRow').isHidden(), true);
  assert.equal(await page.locator('#businessTaxBranchRow').isHidden(), true);
  assert.equal(await page.locator('#topbarFormActions #saveBusinessSettingsBtn').count(), 1);
  assert.equal(await page.locator('#main #saveBusinessSettingsBtn').count(), 0);

  await page.locator('#set_business_vat').selectOption('จดภาษีมูลค่าเพิ่มแล้ว');
  assert.equal(await page.locator('#businessVatDateRow').isVisible(), true);
  assert.equal(await page.locator('#businessTaxBranchRow').isVisible(), true);
  await page.locator('#set_business_vat_date').fill('06092026');
  assert.equal(await page.locator('#set_business_vat_date').inputValue(), '06/09/2026', 'ช่องวันที่ต้องเติมเครื่องหมาย / ระหว่างพิมพ์ตัวเลขให้อัตโนมัติ');
  await page.locator('input[name="set_branch"][value="branch"]').check({force:true});
  assert.equal(await page.locator('#businessBranchFields').isVisible(), true);

  await page.screenshot({path:path.join(os.tmpdir(),'pepos-business-settings-browser.png'),fullPage:true});

  await page.evaluate(() => {
    products=[{id:99001,sku:'TEST-1',name:'สินค้าทดสอบ',category:'ยา',brand:'ทั่วไป',unit:'กล่อง',barcode:'8850000000991',price:100,cost:70,stock:5,units:[],extraBarcodes:[],vendorBarcodes:[],active:true}];
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
  assert.equal(await page.locator('h3', {hasText:'หน่วยและราคา'}).count(),0);
  assert.equal(await page.getByText('กำหนดหน่วยหลัก ราคาขาย ทุน และจำนวนคงเหลือ รวมถึงหน่วยขายเพิ่มเติมของสินค้านี้', {exact:true}).count(),0);
  assert.equal(await page.locator('#f_stock').isVisible(),false);
  assert.equal(await page.locator('.u_stock').first().isVisible(),false);
  assert.equal(await page.locator('.product-pricing-panel').getByText('จำนวนคงเหลือ',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>Number(document.querySelector('#f_stock').value)===Number(products.find(p=>p.id===editingProductId).stock)),true,'hidden stock remains unchanged');
  const productFieldRows=await page.evaluate(() => {
    const top=id=>Math.round(document.querySelector(id).closest('.field').getBoundingClientRect().top);
    return {
      category:[top('#f_category'),top('#f_brand'),top('#f_vat')],
      identity:[top('#f_sku'),top('#f_name')],
      unit:[top('#f_unit'),top('#f_price'),top('#f_cost'),top('#f_barcode')],
    };
  });
  assert.equal(new Set(productFieldRows.category).size,1,'หมวดสินค้า แบรนด์ และ VAT ต้องอยู่บรรทัดเดียวกัน');
  assert.equal(new Set(productFieldRows.identity).size,1,'SKU และชื่อสินค้าต้องอยู่บรรทัดเดียวกัน');
  assert.equal(new Set(productFieldRows.unit).size,1,'หน่วย ราคา ทุน และบาร์โค้ดต้องอยู่บรรทัดเดียวกัน');
  const desktopBaseUnitAction=await page.evaluate(() => {
    const barcode=document.querySelector('#f_barcode').getBoundingClientRect();
    const element=document.querySelector('#changeBaseUnitBtn');
    const button=element.getBoundingClientRect();
    return {sameCenter:Math.abs(barcode.top+barcode.height/2-button.top-button.height/2)<3,afterBarcode:button.left>barcode.right,background:getComputedStyle(element).backgroundColor};
  });
  assert.deepEqual(desktopBaseUnitAction,{sameCenter:true,afterBarcode:true,background:'rgb(79, 64, 56)'},'ปุ่มเปลี่ยนหน่วยหลักต้องอยู่ต่อจากเลขบาร์โค้ดและเป็นสีน้ำตาล');
  await page.evaluate(()=>{document.querySelector('#multiunitBody').style.display='block';});
  const alignedUnitFields=await page.evaluate(()=>{
    const rect=selector=>document.querySelector(selector).getBoundingClientRect();
    const pairs=[['#f_unit','.unitrow-eq'],['#f_price','.u_price'],['#f_cost','.u_cost'],['#f_barcode','.u_barcode'],['#changeBaseUnitBtn','.u_del']];
    return pairs.map(([a,b])=>{const x=rect(a),y=rect(b);return {a,widthDiff:Math.abs(x.width-y.width),leftDiff:Math.abs(x.left-y.left),heightDiff:Math.abs(x.height-y.height)};});
  });
  for(const pair of alignedUnitFields){
    assert.ok(pair.widthDiff<1&&pair.leftDiff<1,`${pair.a} must align with corresponding extra-unit field: ${JSON.stringify(pair)}`);
    if(pair.a!=='#f_unit')assert.ok(pair.heightDiff<1,`${pair.a} must match height`);
  }
  await page.screenshot({path:path.join(os.tmpdir(),'pepos-product-form-browser.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  const mobileProductFieldRows=await page.evaluate(() => {
    const top=id=>Math.round(document.querySelector(id).closest('.field').getBoundingClientRect().top);
    return {
      category:[top('#f_category'),top('#f_brand'),top('#f_vat')],
      identity:[top('#f_sku'),top('#f_name')],
      unit:[top('#f_unit'),top('#f_price'),top('#f_cost'),top('#f_barcode')],
    };
  });
  assert.equal(new Set(mobileProductFieldRows.category).size,3,'ช่องหมวดสินค้าบนมือถือต้องเรียงลงคนละบรรทัด');
  assert.equal(new Set(mobileProductFieldRows.identity).size,2,'SKU และชื่อสินค้าบนมือถือต้องเรียงลงคนละบรรทัด');
  assert.equal(new Set(mobileProductFieldRows.unit).size,4,'ช่องหน่วยและราคาบนมือถือต้องเรียงลงคนละบรรทัด');
  const mobileBaseUnitAction=await page.evaluate(() => {
    const barcode=document.querySelector('#f_barcode').getBoundingClientRect();
    const button=document.querySelector('#changeBaseUnitBtn').getBoundingClientRect();
    return {belowBarcode:button.top>barcode.bottom,compact:button.width===26&&button.height===26};
  });
  assert.deepEqual(mobileBaseUnitAction,{belowBarcode:true,compact:true},'ปุ่มเปลี่ยนหน่วยหลักบนจอแคบต้องอยู่ใต้เลขบาร์โค้ดและมีขนาดเท่าปุ่มลบ');
  await page.screenshot({path:path.join(os.tmpdir(),'pepos-product-form-mobile-browser.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});

  await page.evaluate(() => {
    editingProductId='new';
    currentTab='products';
    document.getElementById('topbarFormActions').innerHTML='';
    document.getElementById('main').innerHTML=renderProductForm();
    attachEvents();
    syncTopbarFormActions();
  });
  assert.equal(await page.locator('.pagehead h1').count(),0);
  assert.equal(await page.getByText('เพิ่มบริการหรือสินค้า', {exact:true}).count(),0);

  await page.evaluate(() => {
    activeWarehouseId=warehouses[0]?.id||1;
    currentCashShift={id:'shift-browser-test',shiftNo:'CS202608270003',status:'open',openingCash:500,openedBy:'browser-test',openedByName:'กรธวัช จันทรวารี',openedAt:new Date().toISOString()};
    const product=products[0];
    cart=[{lineId:'promo-free-browser-test',pid:product.id,name:product.name,unit:product.unit,qty:2,price:0,factor:1,autoFreeFromPromo:true,autoFreePromoName:'โปรทดสอบ'}];
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
  const freeQuantity=page.locator('.pos-autofree-row .pos-qty');
  assert.equal(await freeQuantity.innerText(),'2');
  assert.deepEqual(await freeQuantity.evaluate(cell=>({display:getComputedStyle(cell).display,inputCount:cell.querySelectorAll('input').length})),{display:'table-cell',inputCount:0});
  const paymentStatusLayout=await paymentStatus.evaluate(element=>{
    const text=element.querySelector('span').getBoundingClientRect();
    const button=element.querySelector('button').getBoundingClientRect();
    return {whiteSpace:getComputedStyle(element).whiteSpace,textCenter:text.top+(text.height/2),buttonCenter:button.top+(button.height/2)};
  });
  assert.equal(paymentStatusLayout.whiteSpace,'nowrap');
  assert.ok(Math.abs(paymentStatusLayout.textCenter-paymentStatusLayout.buttonCenter)<2,'สถานะและปุ่มสรุปชำระต้องอยู่แถวเดียวกัน');
  await paymentStatus.evaluate(element=>element.parentElement.appendChild(element.cloneNode(true)));
  assert.equal(await page.locator('#topbarFormActions .cash-shift-topbar-action').count(),2,'ต้องจำลองสถานะ TOPBAR ซ้ำได้ก่อนทดสอบการล้าง');
  await page.evaluate(() => syncTopbarFormActions());
  assert.equal(await page.locator('#topbarFormActions .cash-shift-topbar-action').count(),1,'ระบบต้องลบสถานะระบบชำระที่ซ้ำใน TOPBAR');
  await page.screenshot({path:path.join(os.tmpdir(),'pepos-checkout-regressions-browser.png'),fullPage:true});

  await page.keyboard.press('F2');
  assert.equal(await page.locator('.checkout-pay-modal').count(),1,'F2 ต้องเปิดหน้าต่างเก็บเงิน');
  assert.match(await page.locator('[data-method="cash"]').innerText(),/\[F4\] เงินสด/);
  assert.match(await page.locator('[data-method="bank"]').innerText(),/\[F9\] โอนธนาคาร/);
  await page.keyboard.press('F4');
  assert.equal(await page.locator('#checkoutPayTitle').innerText(),'รับชำระเงินสด','F4 ต้องเลือกเงินสด');
  assert.equal(await page.locator('#cashDisplay').count(),1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('F9');
  assert.equal(await page.locator('#checkoutPayTitle').innerText(),'ชำระด้วยการโอนธนาคาร','F9 ต้องเลือกโอนธนาคาร');
  assert.equal(await page.locator('#bankFinishBtn').count(),1);
  await page.locator('.checkout-pay-modal .modal-close').click();
  assert.equal(await page.locator('.checkout-pay-modal').count(),0);

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

  await page.evaluate(() => {
    products=[{id:99001,sku:'HIDDEN-SKU',name:'สินค้าทดสอบ LOT ใหม่',unit:'กล่อง',barcode:'8850000000991',stock:5,units:[]}];
    inventoryLotRows=[];
    stockEditItems=[99001];
    stockEditDraftStocks={99001:8};
    stockEditLotSelections={99001:'new'};
    stockEditNewLotNumbers={};
    stockEditNewLotExpiries={};
    stockEditSourceInspectionListId=null;
    stockEditPage=1;
    currentTab='stockcontrol';
    stockControlMode='adjust';
    document.getElementById('topbarFormActions').innerHTML='';
    document.getElementById('main').innerHTML=renderStockEdit();
    attachEvents();
  });
  assert.equal(await page.locator('.stock-edit-table th').count(),8);
  assert.equal(await page.locator('.stock-edit-table').getByText('รหัสสินค้า',{exact:true}).count(),0);
  assert.equal(await page.locator('.stock-edit-table').getByText('HIDDEN-SKU',{exact:true}).count(),0);
  for(const width of [1100,1440,1920]){
    await page.setViewportSize({width,height:1000});
    const fields=await page.evaluate(()=>{
      const lot=document.querySelector('[data-stock-edit-new-lot]').getBoundingClientRect();
      const expiry=document.querySelector('[data-stock-edit-new-expiry]').getBoundingClientRect();
      return {width:lot.width,widthDifference:Math.abs(lot.width-expiry.width),gap:expiry.top-lot.bottom};
    });
    assert.ok(fields.width>=180,'เลข LOT ต้องไม่ถูกบีบจนอ่านไม่ได้');
    assert.ok(fields.widthDifference<1,'เลข LOT กับวันที่ต้องกว้างเท่ากัน');
    assert.ok(fields.gap>=4,'เลข LOT กับวันที่ต้องแยกคนละบรรทัด');
  }
  await page.locator('[data-stock-edit-new-lot]').fill('LOT-TEST-0909');
  await page.locator('[data-stock-edit-new-expiry]').fill('09092030');
  assert.equal(await page.locator('[data-stock-edit-new-expiry]').inputValue(),'09/09/2030');
  assert.equal(await page.evaluate(()=>stockEditNewLotNumbers[99001]),'LOT-TEST-0909');
  assert.equal(await page.evaluate(()=>products[0].stock),5,'กรอก LOT ต้องยังไม่เปลี่ยนสต๊อก');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.stock-edit-table-wrap').screenshot({path:path.join(os.tmpdir(),'pepos-stock-lot-fields-browser.png')});

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
