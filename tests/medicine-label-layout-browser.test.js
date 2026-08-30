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
    id:`SALE-${size}`, ref:'RE202608300001', date:'2026-08-30', medicineLabelSize:size,
    businessSnapshot:context.businessSettings,
    items:[{
      name:'Decolgen prin (4 tablets)', qty:1, unit:'กล่อง',
      lotAllocations:[{expiry:'2031-08-09'}],
      dispensingLabel:{
        enabled:true,
        drugName:'Decolgen prin (4 tablets)',
        patientName:'ผู้รับยาทดสอบ',
        pharmacistName:'เภสัชกร กรธวัช จันทรวารี',
        indication:'ลดไข้ บรรเทาอาการคัดจมูก',
        directions:'รับประทานครั้งละ 1 เม็ด วันละ 3 ครั้ง หลังอาหาร เช้า กลางวัน เย็น',
        warning:'อาจทำให้ง่วง ห้ามขับรถหรือใช้เครื่องจักร',
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
    await page.setContent(renderLabel(size).replace('sapuri-pharmacy-logo.png',logoData), {waitUntil:'domcontentloaded'});
    await page.locator('.toolbar').evaluate(element => element.remove());
    const metrics = await page.locator('.medicine-label').evaluate(element => {
      const info = element.querySelector('.medicine-label-info');
      return {
        width:[element.clientWidth,element.scrollWidth],
        height:[element.clientHeight,element.scrollHeight],
        infoHeight:[info.clientHeight,info.scrollHeight],
      };
    });
    assert.ok(metrics.width[1] <= metrics.width[0] + 1, `${size} ต้องไม่มีข้อมูลล้นด้านข้าง`);
    assert.ok(metrics.height[1] <= metrics.height[0] + 1, `${size} ต้องไม่มีข้อมูลล้นด้านล่าง`);
    assert.ok(metrics.infoHeight[1] <= metrics.infoHeight[0] + 1, `${size} ตารางข้อมูลต้องอยู่ภายในกรอบ`);
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
