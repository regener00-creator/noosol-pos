const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const logoData = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, '..', 'sapuri-pharmacy-logo.png')).toString('base64')}`;
const helpersStart = html.indexOf("const MEDICINE_LABEL_SIZE_STORAGE_KEY=");
const helpersEnd = html.indexOf('function isProductActive(', helpersStart);
const printStart = html.indexOf('function medicineLabelContentLength(');
const printEnd = html.indexOf('function openPostPaymentModal(', printStart);

let printHtml = '';
const printWindow = {
  document: {write(value) { printHtml += value; }, close() {}, querySelector() { return null; }},
  print() {},
};
const context = {
  localStorage: {getItem: () => null, setItem: () => {}},
  currentProfile: {firstName:'เภสัชกร',lastName:'ทดสอบ'},
  currentUserProfile: {},
  salesHistory: [],
  businessSettings: {name:'JOAH',address:'',phone:'099-298-9693'},
  STORE_INFO: {name:'PEPOS',address:'',phone:''},
  businessDocumentName: business => business.name,
  businessPrimaryPhone: business => business.phone,
  escapeHtml: value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'),
  fmtDateShort: value => String(value).split('-').reverse().join('-'),
  showToast: () => {},
  standardizePrintPreview: () => {},
  setTimeout: callback => callback(),
  window: {open: () => printWindow},
};
vm.createContext(context);
vm.runInContext(`${html.slice(helpersStart, helpersEnd)}\n${html.slice(printStart, printEnd)}`, context);

function renderLabel(size) {
  printHtml = '';
  context.salesHistory = [{
    id:`SALE-${size}`, ref:'RE202608300006', date:'2026-08-03', medicineLabelSize:size,
    businessSnapshot:context.businessSettings,
    items:[{
      name:'[BP] Alben Anthelmintics 200 mg (2 tablets)', qty:1, unit:'กล่อง',
      lotAllocations:[],
      dispensingLabel:{
        enabled:true,
        drugName:'[BP] Alben Anthelmintics 200 mg (2 tablets)',
        patientName:'55555',
        pharmacistName:'เภสัชกร กรธวัช จันทรวารี',
        indication:'66666',
        doseAmount:'1',
        doseUnit:'เม็ด',
        durationMode:'until_recovered',
        durationDays:'',
        mealTiming:'before',
        intervalValue:'30',
        intervalUnit:'minutes',
        doseTimes:['morning','noon','evening'],
        warning:'อาจทำให้ง่วง ห้ามขับรถหรือใช้เครื่องจักร · รับประทานยานี้ติดต่อกันจนหมด',
      },
    }],
  }];
  assert.equal(context.printMedicineLabels(`SALE-${size}`), true);
  return printHtml;
}

let browser;
const browserExecutable = [
  process.env.PEPOS_BROWSER_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(file => file && fs.existsSync(file));

(async () => {
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบฉลากยา');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  for (const size of ['80x50','60x40']) {
    const page = await browser.newPage({viewport:{width:700,height:500},deviceScaleFactor:2});
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    const labelHtml=renderLabel(size).replace('sapuri-pharmacy-logo.png',logoData);
    assert.match(labelHtml, /medicine-label-duration-value">จนกว่าอาการจะหาย<\/b>/, `${size} ต้องแสดงระยะเวลาจนกว่าอาการจะหาย`);
    assert.match(labelHtml, /<i class="is-checked"><\/i>ทุก 30 นาที/, `${size} ต้องถมดำช่องทุก 30 นาทีบนกระดาษ`);
    await page.setContent(labelHtml, {waitUntil:'domcontentloaded'});
    await page.locator('.toolbar').evaluate(element => element.remove());
    const metrics = await page.locator('.medicine-label').evaluate(element => {
      const info = element.querySelector('.medicine-label-info');
      const doseLines = [...element.querySelectorAll('.medicine-label-dose-line')].map(line => line.getBoundingClientRect());
      const warningKey = element.querySelector('.medicine-label-warning .medicine-label-key')?.getBoundingClientRect();
      const warningValue = element.querySelector('.medicine-label-warning .medicine-label-value')?.getBoundingClientRect();
      const timeChoices = [...element.querySelectorAll('.medicine-label-schedule .medicine-label-cell:last-child .medicine-label-choice')].map(choice => choice.getBoundingClientRect());
      const rightCellWidths = ['meta','dose','schedule','footer'].map(section => element.querySelector(`.medicine-label-${section} .medicine-label-cell:last-child`)?.getBoundingClientRect().width);
      const checkedChoiceStyles = [...element.querySelectorAll('.medicine-label-choice i.is-checked')].map(choice => getComputedStyle(choice).backgroundColor);
      return {
        width:[element.clientWidth,element.scrollWidth],
        height:[element.clientHeight,element.scrollHeight],
        infoHeight:[info.clientHeight,info.scrollHeight],
        doseLineHeights:doseLines.map(rect => rect.height),
        warningCenters:[warningKey && warningKey.top + warningKey.height / 2,warningValue && warningValue.top + warningValue.height / 2],
        timeChoiceGaps:timeChoices.slice(1).map((rect,index) => rect.left - timeChoices[index].right),
        rightCellWidths,
        checkedChoiceStyles,
      };
    });
    assert.ok(metrics.width[1] <= metrics.width[0] + 1, `${size} ต้องไม่มีข้อมูลล้นด้านข้าง`);
    assert.ok(metrics.height[1] <= metrics.height[0] + 1, `${size} ต้องไม่มีข้อมูลล้นด้านล่าง`);
    assert.ok(metrics.infoHeight[1] <= metrics.infoHeight[0] + 1, `${size} ตารางข้อมูลต้องอยู่ภายในกรอบ`);
    assert.equal(metrics.doseLineHeights.length, 2, `${size} ต้องมีขนาดรับประทานและระยะเวลาสองแถว`);
    assert.ok(Math.abs(metrics.doseLineHeights[0] - metrics.doseLineHeights[1]) <= 1, `${size} สองแถวขนาดรับประทานต้องสูงเท่ากัน`);
    assert.ok(metrics.warningCenters.every(Number.isFinite), `${size} ต้องมีหัวข้อและข้อมูลคำเตือน`);
    assert.ok(Math.abs(metrics.warningCenters[0] - metrics.warningCenters[1]) <= 1, `${size} หัวข้อและข้อมูลคำเตือนต้องอยู่กึ่งกลางแนวเดียวกัน`);
    assert.equal(metrics.timeChoiceGaps.length, 3, `${size} ต้องมีช่องว่างระหว่างช่วงเวลาทั้งสี่`);
    assert.ok(Math.min(...metrics.timeChoiceGaps) >= 2, `${size} ช่วงเวลารับประทานต้องไม่ชิดกัน`);
    assert.ok(metrics.rightCellWidths.every(Number.isFinite), `${size} ต้องมีช่องด้านขวาครบทุกแถว`);
    assert.ok(Math.max(...metrics.rightCellWidths) - Math.min(...metrics.rightCellWidths) <= 1, `${size} ช่องขนาดรับประทาน ระยะเวลา ช่วงเวลา และเภสัชกรต้องกว้างเท่าช่องวันที่จ่ายยา`);
    assert.ok(metrics.checkedChoiceStyles.length >= 1, `${size} ต้องมีช่องตัวเลือกที่ถูกเลือก`);
    assert.ok(metrics.checkedChoiceStyles.every(color => color === 'rgb(17, 17, 17)'), `${size} ช่องที่เลือกต้องถมสีดำทุกช่อง`);
    await page.locator('.medicine-label').screenshot({path:path.join(os.tmpdir(),`pepos-medicine-label-${size}.png`)});
    await page.close();
  }
  console.log('medicine label browser layout tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
});
