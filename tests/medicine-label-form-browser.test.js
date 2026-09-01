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
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบฟอร์มฉลากยา');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1000,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
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
  await page.waitForFunction(() => typeof openMedicineLabelEditor === 'function');
  await page.evaluate(() => {
    document.querySelectorAll('.login-screen').forEach(screen => {
      screen.style.display = 'none';
    });
    currentProfile={id:'pharmacist-test',firstName:'เภสัชกร',lastName:'ทดสอบ'};
    cart=[{lineId:501,pid:1,name:'Paracetamol 500 mg',unit:'กล่อง',qty:1,price:100,cost:50,factor:1}];
    openMedicineLabelEditor(501);
  });

  const productLine = await page.locator('.medicine-label-product').evaluate(element => {
    const name = element.querySelector('b').getBoundingClientRect();
    const quantity = element.querySelector('span').getBoundingClientRect();
    return {nameTop:name.top,quantityTop:quantity.top,text:element.textContent};
  });
  assert.ok(Math.abs(productLine.nameTop - productLine.quantityTop) < 5, 'ชื่อสินค้าและจำนวนต้องอยู่แถวเดียวกัน');
  assert.match(productLine.text, /Paracetamol 500 mg.*จำนวน 1 กล่อง/s);
  assert.equal(await page.locator('label', {has:page.locator('#medicineLabelDrugName')}).locator('span').textContent(), 'ชื่อยา *');
  assert.equal(await page.locator('label', {has:page.locator('#medicineLabelPharmacist')}).locator('span').textContent(), 'เภสัชกร *');
  assert.equal(await page.locator('.medicine-label-option-group legend').first().textContent(), 'ก่อน / หลังอาหาร');
  assert.equal(await page.locator('.medicine-label-warning-group legend').textContent(), 'เพิ่มเติม / ข้อควรระวัง');
  assert.equal(await page.locator('.medicine-label-quick-title').count(), 0, 'ต้องไม่มีหัวข้อเพิ่มคำเตือน');
  assert.equal(await page.locator('#medicineLabelWarning').isVisible(), true, 'ช่องเพิ่มเติมและข้อควรระวังต้องพิมพ์ข้อความได้โดยตรง');
  assert.equal(await page.locator('#medicineLabelWarningPresetManager').isHidden(), true);
  assert.equal(await page.locator('#medicineLabelDirections').count(), 0, 'ต้องไม่มีช่องวิธีใช้ยาแบบข้อความ');
  assert.equal(await page.locator('#medicineLabelDoseAmount').count(), 1);
  assert.equal(await page.locator('#medicineLabelDoseUnit').count(), 1);
  assert.equal(await page.locator('#medicineLabelDoseUnitManager').isHidden(), true);
  const initialDoseUnits = await page.locator('#medicineLabelDoseUnit option').allTextContents();
  await page.locator('#medicineLabelDoseUnitManage').click();
  assert.equal(await page.locator('#medicineLabelDoseUnitManager').isVisible(), true);
  await page.locator('#medicineLabelDoseUnitNew').fill('หลอด');
  await page.locator('#medicineLabelDoseUnitAdd').click();
  assert.equal(await page.locator('#medicineLabelDoseUnit').inputValue(), 'หลอด', 'หน่วยที่เพิ่มใหม่ต้องถูกเลือกทันที');
  let managedDoseUnits = await page.locator('#medicineLabelDoseUnit option').allTextContents();
  assert.deepEqual(managedDoseUnits, [...initialDoseUnits, 'หลอด']);
  const addedUnitRow = page.locator('.medicine-label-unit-row').filter({has:page.locator('span', {hasText:'หลอด'})});
  await addedUnitRow.locator('[data-dose-unit-action="up"]').click();
  managedDoseUnits = await page.locator('#medicineLabelDoseUnit option').allTextContents();
  assert.equal(managedDoseUnits.at(-2), 'หลอด', 'การเลื่อนขึ้นต้องเปลี่ยนลำดับในรายการเลือกทันที');
  assert.deepEqual(await page.evaluate(() => businessSettings.medicineLabelDoseUnits), managedDoseUnits, 'ลำดับหน่วยต้องถูกเก็บในข้อมูลธุรกิจ');
  await page.locator('#medicineLabelDoseUnitManage').click();
  assert.equal(await page.locator('#medicineLabelDoseUnitManager').isHidden(), true);
  assert.equal(await page.locator('#medicineLabelDurationMode').count(), 1);
  assert.equal(await page.locator('#medicineLabelDurationDays').count(), 1);
  assert.equal(await page.locator('input[name="medicineLabelMealTiming"][value="none"]').count(), 0, 'ต้องไม่มีตัวเลือกไม่เกี่ยวกับอาหาร');
  assert.equal(await page.locator('#medicineLabelEveryIntervalEnabled').count(), 1);
  assert.equal(await page.locator('#medicineLabelIntervalValue').isDisabled(), true);
  assert.equal(await page.locator('#medicineLabelIntervalUnit').isDisabled(), true);
  assert.deepEqual(await page.locator('#medicineLabelIntervalUnit option').allTextContents(), ['ชั่วโมง','นาที']);
  assert.deepEqual(await page.locator('#medicineLabelDurationMode option').allTextContents(), ['กำหนดจำนวนวัน','ใช้เมื่อมีอาการ','จนกว่าอาการจะหาย']);
  assert.equal(await page.locator('#medicineLabelDurationMode').inputValue(), 'days');
  assert.equal(await page.locator('#medicineLabelDurationDaysField').isVisible(), true);
  await page.locator('#medicineLabelPatient').fill('สมชาย ใจดี');
  await page.locator('#medicineLabelIndication').fill('ลดไข้');
  await page.locator('#medicineLabelDoseAmount').fill('1');
  await page.locator('#medicineLabelDoseUnit').selectOption('เม็ด');
  await page.locator('#medicineLabelDurationDays').fill('7');
  const beforeMeal = page.locator('input[name="medicineLabelMealTiming"][value="before"]');
  const afterMeal = page.locator('input[name="medicineLabelMealTiming"][value="after"]');
  assert.equal(await beforeMeal.getAttribute('type'), 'checkbox');
  assert.equal(await afterMeal.getAttribute('type'), 'checkbox');
  await afterMeal.check();
  await afterMeal.uncheck();
  assert.equal(await afterMeal.isChecked(), false, 'ต้องกดเอาติ๊กหลังอาหารออกได้');
  await beforeMeal.check();
  assert.equal(await afterMeal.isChecked(), false, 'ก่อนอาหารและหลังอาหารต้องไม่ถูกเลือกพร้อมกัน');
  await afterMeal.check();
  assert.equal(await beforeMeal.isChecked(), false, 'เลือกหลังอาหารแล้วต้องเอาติ๊กก่อนอาหารออก');
  await page.locator('input[name="medicineLabelDoseTime"][value="morning"]').check();
  await page.locator('input[name="medicineLabelDoseTime"][value="noon"]').check();
  await page.locator('input[name="medicineLabelDoseTime"][value="evening"]').check();
  await page.locator('#medicineLabelWarningPresetNew').fill('เก็บให้พ้นมือเด็ก');
  await page.locator('#medicineLabelWarningPresetAdd').click();
  await page.locator('#medicineLabelWarningPresetNew').fill('ห้ามรับประทานพร้อมนม');
  await page.locator('#medicineLabelWarningPresetAdd').click();
  await page.locator('#medicineLabelWarningPresetManage').click();
  assert.equal(await page.locator('#medicineLabelWarningPresetManager').isVisible(), true);
  const customWarningRow = page.locator('.medicine-label-warning-preset-row').filter({hasText:'ห้ามรับประทานพร้อมนม'});
  await customWarningRow.locator('[data-medicine-warning-preset-action="up"]').click();
  const removedWarningRow = page.locator('.medicine-label-warning-preset-row').filter({hasText:'เก็บให้พ้นมือเด็ก'});
  await removedWarningRow.locator('[data-medicine-warning-preset-action="delete"]').click();
  const managedWarningPresets = await page.locator('[data-medicine-warning-preset]').allTextContents();
  assert.equal(managedWarningPresets.includes('เก็บให้พ้นมือเด็ก'), false, 'ต้องลบคำเตือน Quick Use ได้');
  assert.equal(managedWarningPresets.at(-1), 'ห้ามรับประทานพร้อมนม', 'ต้องเลื่อนลำดับคำเตือน Quick Use ได้');
  assert.deepEqual(await page.evaluate(() => businessSettings.medicineLabelWarningPresets), managedWarningPresets, 'รายการ Quick Use ต้องบันทึกในข้อมูลธุรกิจ');
  await page.locator('#medicineLabelWarning').fill('ข้อความที่พิมพ์เอง');
  await page.locator('[data-medicine-warning-preset]').last().click();
  await page.locator('[data-medicine-warning-preset]').first().click();
  await page.locator('#medicineLabelForm button[type="submit"]').click();
  await page.waitForSelector('#medicineLabelForm', {state:'detached'});

  const saved = await page.evaluate(() => cart[0].dispensingLabel);
  assert.equal(saved.doseAmount, '1');
  assert.equal(saved.doseUnit, 'เม็ด');
  assert.equal(saved.durationMode, 'days');
  assert.equal(saved.durationDays, '7');
  assert.equal(saved.mealTiming, 'after');
  assert.deepEqual(saved.doseTimes, ['morning','noon','evening']);
  assert.equal(saved.warning, 'ข้อความที่พิมพ์เอง\nห้ามรับประทานพร้อมนม\nอาจทำให้ง่วง ห้ามขับรถหรือใช้เครื่องจักร');
  assert.equal(saved.directions, 'รับประทานครั้งละ 1 เม็ด หลังอาหาร เช้า กลางวัน เย็น เป็นเวลา 7 วัน');

  await page.evaluate(() => openMedicineLabelEditor(501));
  assert.equal(await page.locator('#medicineLabelDoseAmount').inputValue(), '1');
  assert.equal(await page.locator('#medicineLabelDoseUnit').inputValue(), 'เม็ด');
  assert.deepEqual(await page.locator('#medicineLabelDoseUnit option').allTextContents(), managedDoseUnits, 'ลำดับหน่วยที่จัดไว้ต้องคงอยู่เมื่อเปิดฉลากครั้งถัดไป');
  assert.equal(await page.locator('#medicineLabelDurationMode').inputValue(), 'days');
  assert.equal(await page.locator('#medicineLabelDurationDays').inputValue(), '7');
  assert.equal(await page.locator('input[name="medicineLabelMealTiming"][value="after"]').isChecked(), true);
  assert.equal(await page.locator('input[name="medicineLabelDoseTime"][value="morning"]').isChecked(), true);
  assert.equal(await page.locator('#medicineLabelWarning').inputValue(), 'ข้อความที่พิมพ์เอง\nห้ามรับประทานพร้อมนม\nอาจทำให้ง่วง ห้ามขับรถหรือใช้เครื่องจักร', 'ข้อความเพิ่มเติมต้องคงอยู่เมื่อเปิดแก้ไขอีกครั้ง');
  assert.deepEqual(await page.locator('[data-medicine-warning-preset]').allTextContents(), managedWarningPresets, 'คำเตือน Quick Use ที่จัดไว้ต้องคงลำดับเมื่อเปิดฉลากครั้งถัดไป');
  await page.locator('#medicineLabelDurationMode').selectOption('as_needed');
  assert.equal(await page.locator('#medicineLabelDurationDaysField').isHidden(), true);
  assert.equal(await page.locator('#medicineLabelDurationDays').isDisabled(), true);
  assert.equal(await page.locator('#medicineLabelDurationDays').getAttribute('required'), null);
  await page.locator('.login-screen').evaluateAll(screens => screens.forEach(screen => { screen.style.display='none'; }));
  await page.locator('#medicineLabelForm button[type="submit"]').click();
  await page.waitForSelector('#medicineLabelForm', {state:'detached'});
  const savedAsNeeded = await page.evaluate(() => cart[0].dispensingLabel);
  assert.equal(savedAsNeeded.durationMode, 'as_needed');
  assert.equal(savedAsNeeded.durationDays, '');
  assert.equal(savedAsNeeded.directions, 'รับประทานครั้งละ 1 เม็ด หลังอาหาร เช้า กลางวัน เย็น ใช้เมื่อมีอาการ');
  await page.evaluate(() => openMedicineLabelEditor(501));
  assert.equal(await page.locator('#medicineLabelDurationMode').inputValue(), 'as_needed');
  assert.equal(await page.locator('#medicineLabelDurationDaysField').isHidden(), true);
  await page.locator('.login-screen').evaluateAll(screens => screens.forEach(screen => { screen.style.display='none'; }));
  for(const input of await page.locator('input[name="medicineLabelDoseTime"]').all()) await input.uncheck();
  await page.locator('#medicineLabelEveryIntervalEnabled').check();
  assert.equal(await page.locator('#medicineLabelIntervalValue').isEnabled(), true);
  assert.equal(await page.locator('#medicineLabelIntervalUnit').isEnabled(), true);
  assert.equal(await page.locator('#medicineLabelIntervalValue').getAttribute('required'), '');
  await page.locator('#medicineLabelIntervalValue').fill('30');
  await page.locator('#medicineLabelIntervalUnit').selectOption('minutes');
  await page.locator('.login-screen').evaluateAll(screens => screens.forEach(screen => { screen.style.display='none'; }));
  await page.locator('#medicineLabelForm button[type="submit"]').click();
  await page.waitForSelector('#medicineLabelForm', {state:'detached'});
  const savedEveryInterval = await page.evaluate(() => cart[0].dispensingLabel);
  assert.equal(savedEveryInterval.intervalValue, '30');
  assert.equal(savedEveryInterval.intervalUnit, 'minutes');
  assert.deepEqual(savedEveryInterval.doseTimes, []);
  assert.equal(savedEveryInterval.directions, 'รับประทานครั้งละ 1 เม็ด หลังอาหาร ทุก 30 นาที ใช้เมื่อมีอาการ');
  await page.evaluate(() => openMedicineLabelEditor(501));
  assert.equal(await page.locator('#medicineLabelEveryIntervalEnabled').isChecked(), true);
  assert.equal(await page.locator('#medicineLabelIntervalValue').inputValue(), '30');
  assert.equal(await page.locator('#medicineLabelIntervalUnit').inputValue(), 'minutes');
  assert.deepEqual(errors, []);
  console.log('medicine label form browser tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
