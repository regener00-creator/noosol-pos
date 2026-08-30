const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const helpersStart = html.indexOf("const MEDICINE_LABEL_SIZE_STORAGE_KEY=");
const helpersEnd = html.indexOf('function isProductActive(', helpersStart);
const printStart = html.indexOf('function medicineLabelContentLength(');
const printEnd = html.indexOf('function openPostPaymentModal(', printStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'ไม่พบชุดข้อมูลและตัวช่วยฉลากยา');
assert.ok(printStart >= 0 && printEnd > printStart, 'ไม่พบชุดพิมพ์ฉลากยา');

let printHtml = '';
let printCount = 0;
const printWindow = {
  document: {
    write(value) { printHtml += value; },
    close() {},
  },
  print() { printCount += 1; },
};
const context = {
  localStorage: {getItem: () => null, setItem: () => {}},
  currentProfile: {firstName:'เภสัชกร',lastName:'ทดสอบ'},
  currentUserProfile: {},
  salesHistory: [],
  businessSettings: {name:'ร้านยาทดสอบ',address:'1 ถนนทดสอบ',phone:'02-000-0000'},
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

const structuredInput = {
  enabled:true,
  drugName:'Paracetamol 500 mg',
  patientName:'สมชาย ใจดี',
  pharmacistName:'ภก. ทดสอบ',
  indication:'แก้ปวด',
  doseAmount:'1',
  doseUnit:'เม็ด',
  durationDays:'7',
  mealTiming:'after',
  doseTimes:['morning','noon','evening'],
  warning:'อาจทำให้ง่วง',
};
const complete = context.normalizeDispensingLabel(structuredInput);
assert.equal(complete.patientName, 'สมชาย ใจดี');
assert.equal(complete.directions, 'รับประทานครั้งละ 1 เม็ด หลังอาหาร เช้า กลางวัน เย็น เป็นเวลา 7 วัน');
assert.deepEqual(Array.from(complete.doseTimes), ['morning','noon','evening']);
assert.equal(context.normalizeDispensingLabel({...complete, drugName:''}), null, 'ฉลากที่ไม่มีชื่อยาและความแรงต้องไม่ผ่าน');
assert.equal(context.normalizeDispensingLabel({...complete, indication:''}), null, 'ฉลากที่ไม่มีข้อบ่งใช้ต้องไม่ผ่าน');
assert.equal(context.normalizeDispensingLabel({...structuredInput, doseTimes:[]}), null, 'ฉลากใหม่ที่ไม่เลือกช่วงเวลาต้องไม่ผ่าน');
const legacy = context.normalizeDispensingLabel({...structuredInput,doseAmount:undefined,doseUnit:undefined,durationDays:undefined,doseTimes:undefined,mealTiming:undefined,directions:'รับประทานครั้งละ 1 เม็ด หลังอาหาร'});
assert.equal(legacy.directions, 'รับประทานครั้งละ 1 เม็ด หลังอาหาร', 'ฉลากเก่าต้องยังเปิดและพิมพ์ได้');
assert.equal(context.medicineLabelFitsSize(complete, '80x50'), true);
assert.equal(context.medicineLabelFitsSize({...complete, warning:'ย'.repeat(300)}, '60x40'), false);

context.salesHistory.push({
  id:'SALE-1', ref:'RE202608300001', date:'2026-08-30', medicineLabelSize:'80x50',
  businessSnapshot:context.businessSettings,
  items:[{name:'Paracetamol 500 mg',qty:10,unit:'เม็ด',lotAllocations:[{expiry:'2027-12-31'}],dispensingLabel:complete}],
});
assert.equal(context.printMedicineLabels('SALE-1'), true);
assert.match(printHtml, /@page\{size:80mm 50mm;margin:0\}/);
assert.match(printHtml, /ตัวอย่างฉลากยา 80 × 50 มม\. \(แนะนำ\) · 1 ใบ/);
assert.match(printHtml, /Paracetamol 500 mg/);
assert.match(printHtml, /sapuri-pharmacy-logo\.png/);
assert.match(printHtml, /class="medicine-label-brand-logo"/);
assert.match(printHtml, /\.medicine-label-brand\{display:contents\}/);
assert.match(printHtml, /grid-row:1\/3;align-self:center/);
assert.match(printHtml, /border:\.1mm solid #222;border-radius:/);
assert.match(printHtml, /filter:grayscale\(1\) contrast\(1\.15\)/);
assert.match(printHtml, /width:11\.6mm;height:11\.6mm/);
assert.match(printHtml, /left:-2\.25mm;top:-2\.15mm/);
assert.match(printHtml, /family=Noto\+Sans\+Thai/);
assert.match(printHtml, /font-family:'Noto Sans Thai'/);
assert.doesNotMatch(printHtml, /#4F4038|#A43A31|#F1ECE9|#2B2422/, 'หน้าพิมพ์ฉลากยาต้องใช้เฉพาะโทนขาวดำ');
assert.match(printHtml, /<small>โทร 02-000-0000<\/small>/);
assert.doesNotMatch(printHtml, /1 ถนนทดสอบ/, 'ฉลากยาไม่ควรแสดงที่อยู่ร้าน');
assert.match(printHtml, /class="medicine-label-info"/, 'ข้อมูลฉลากต้องอยู่ในกรอบตาราง');
assert.match(printHtml, /\.medicine-label-info\{[^}]*border:\.1mm solid #111/, 'กรอบข้อมูลต้องใช้เส้นบาง');
assert.match(printHtml, /\.medicine-label-row\{[^}]*border-bottom:\.1mm solid #111/, 'เส้นแบ่งแถวต้องบางลง');
assert.match(printHtml, /stroke-width="1\.4"/, 'เส้นไอคอนต้องบางลง');
assert.match(printHtml, /\.medicine-label-choice i\{[^}]*border:\.12mm solid #111/, 'กรอบช่องเลือกต้องบางลง');
assert.match(printHtml, /class="medicine-label-row medicine-label-meta"/, 'ต้องแบ่งผู้รับยาและวันที่เป็นแถว');
assert.match(printHtml, /class="medicine-label-key">วันที่จ่ายยา<\/span>/, 'ต้องใช้คำว่าวันที่จ่ายยา');
assert.match(printHtml, /class="medicine-label-bill">RE202608300001<\/span>/, 'เลขบิลต้องอยู่มุมขวาบน');
assert.match(printHtml, /class="medicine-label-icon"/, 'หน้าพิมพ์ต้องใช้ไอคอนเส้น SVG');
assert.match(printHtml, /class="medicine-label-badge">ขนาดรับประทาน<\/span>/, 'ต้องแสดงขนาดรับประทานเป็นป้ายสีดำ');
assert.match(printHtml, /ครั้งละ<\/span><b class="medicine-label-value">1<\/b><span>เม็ด<\/span>/);
assert.match(printHtml, /class="medicine-label-badge">ระยะเวลา<\/span><b class="medicine-label-value">7<\/b><span>วัน<\/span>/);
assert.match(printHtml, /medicine-label-indication[^>]*><div class="medicine-label-indication-head">.*class="medicine-label-badge">ข้อบ่งใช้<\/span><\/div><b class="medicine-label-value">แก้ปวด<\/b>/, 'ไอคอนและหัวข้อข้อบ่งใช้ต้องอยู่บรรทัดบน และข้อมูลอยู่บรรทัดถัดไป');
assert.match(printHtml, /\.medicine-label-indication\{[^}]*flex-direction:column;align-items:flex-start!important;justify-content:flex-start!important/, 'ข้อบ่งใช้ต้องเริ่มจากมุมซ้ายบนของกล่อง');
assert.match(printHtml, /medicine-label-dose-stack[^>]*>.*ขนาดรับประทาน.*medicine-label-dose-line.*ระยะเวลา/s, 'ขนาดรับประทานต้องอยู่เหนือระยะเวลาในช่องเดียวกัน');
assert.match(printHtml, /\.medicine-label-dose-stack\{[^}]*display:grid;grid-template-rows:1fr 1fr/, 'ช่องขนาดรับประทานและระยะเวลาต้องแบ่งความสูงเท่ากัน');
assert.match(printHtml, /\.medicine-label-dose-line\+\.medicine-label-dose-line\{[^}]*border-top:\.1mm solid #111\}/, 'แถวล่างต้องไม่มีระยะห่างส่วนเกิน');
assert.match(printHtml, /--medicine-label-text-nudge:\.22mm;--medicine-label-dose-nudge:\.28mm;--medicine-label-dose-value-nudge:\.34mm/, 'ฉลากปกติต้องชดเชยแนวตัวอักษรให้อยู่กึ่งกลางทางสายตา');
assert.match(printHtml, /\.medicine-label-dose-line>\*\{position:relative;top:var\(--medicine-label-dose-nudge\)\}/, 'ข้อมูลขนาดรับประทานต้องขยับลงกึ่งกลางแถว');
assert.match(printHtml, /\.medicine-label-dose-line>\.medicine-label-value,\.medicine-label-dose-line>\.medicine-label-value\+span\{top:var\(--medicine-label-dose-value-nudge\)\}/, 'จำนวนและหน่วยต้องอยู่แนวเดียวกับป้ายหัวข้อ');
assert.doesNotMatch(printHtml, /ใช้สำหรับ แก้ปวด/, 'ต้องไม่แสดงข้อบ่งใช้ต่อท้ายชื่อยาอีก');
assert.match(printHtml, /class="medicine-label-row medicine-label-schedule"/, 'ต้องมีแถวช่วงเวลาการใช้ยา');
assert.match(printHtml, /\.medicine-label-schedule \.medicine-label-cell:first-child\{justify-content:flex-start\}/, 'ไอคอนนาฬิกาและตัวเลือกก่อนหรือหลังอาหารต้องชิดซ้าย');
assert.match(printHtml, /\.medicine-label-schedule \.medicine-label-cell:last-child\{justify-content:space-evenly;/, 'ช่วงเวลารับประทานต้องกระจายระยะห่างเต็มช่อง');
assert.match(printHtml, /<i>✓<\/i>หลังอาหาร/, 'ช่วงเวลาที่ระบุในวิธีใช้ต้องถูกทำเครื่องหมาย');
assert.match(printHtml, /<i>✓<\/i>เช้า/);
assert.match(printHtml, /<i>✓<\/i>กลางวัน/);
assert.match(printHtml, /<i>✓<\/i>เย็น/);
assert.match(printHtml, /class="medicine-label-row medicine-label-warning"/, 'คำเตือนต้องอยู่ในแถวของตาราง');
assert.match(printHtml, /class="medicine-label-key">ข้อควรระวัง :<\/span>/, 'หัวข้อคำเตือนต้องมีเครื่องหมายทวิภาคและเว้นระยะ');
assert.match(printHtml, /\.medicine-label-warning \.medicine-label-key,\.medicine-label-warning \.medicine-label-value\{[^}]*display:inline-flex;align-items:center;min-height:/, 'หัวข้อและข้อมูลคำเตือนต้องอยู่กึ่งกลางแนวเดียวกัน');
assert.match(printHtml, /วันหมดอายุ<\/span><b class="medicine-label-value">31-12-2027<\/b>/, 'ต้องแสดงวันหมดอายุจาก Lot ที่จ่าย');
assert.doesNotMatch(printHtml, /background:#f1f1f1/, 'ก้อนข้อมูลใหม่ต้องไม่ใช้กล่องพื้นเทาแบบเดิม');
assert.match(printHtml, /ชื่อผู้ป่วย/);
assert.match(printHtml, /สมชาย ใจดี/);
assert.match(printHtml, /เภสัชกร<\/span><b class="medicine-label-value">ทดสอบ<\/b>/, 'ต้องแสดงคำว่าเภสัชกรเพียงครั้งเดียว');
assert.doesNotMatch(printHtml, /ภก\. ทดสอบ/, 'ต้องไม่แสดงคำนำหน้าเภสัชกรซ้ำกับหัวข้อ');
assert.equal(printCount, 1);

assert.match(html, /id="medicineLabelDoseAmount"/, 'ฟอร์มต้องมีช่องขนาดรับประทานต่อครั้ง');
assert.match(html, /id="medicineLabelDoseUnit"/, 'ฟอร์มต้องมีตัวเลือกหน่วยรับประทาน');
assert.match(html, /id="medicineLabelDurationDays"/, 'ฟอร์มต้องมีช่องระยะเวลา');
assert.match(html, /name="medicineLabelMealTiming"/, 'ฟอร์มต้องมีตัวเลือกก่อนหรือหลังอาหาร');
assert.match(html, /name="medicineLabelDoseTime"/, 'ฟอร์มต้องมีตัวเลือกช่วงเวลารับประทาน');
assert.doesNotMatch(html, /id="medicineLabelDirections"/, 'ต้องนำช่องวิธีใช้ยาแบบข้อความออก');
assert.doesNotMatch(html, /data-medicine-direction=/, 'ต้องนำปุ่มวิธีใช้แบบข้อความออก');
assert.match(html, /data-medicine-label-line=/, 'หน้า POS ต้องมีปุ่มจัดทำฉลากยารายการต่อรายการ');
assert.match(html, /id="printMedicineLabelsBtn"/, 'หลังชำระต้องมีปุ่มพิมพ์ฉลากยา');
assert.match(html, /id="historyMedicineLabelsBtn"/, 'ประวัติการขายต้องพิมพ์ฉลากย้อนหลังได้');
assert.match(html, /dispensingLabel:normalizeDispensingLabel\(l\.dispensingLabel\)/, 'ข้อมูลฉลากต้องถูกบันทึกไปกับรายการขาย');
assert.match(html, /medicineLabelSize,discount/, 'ขนาดฉลากต้องถูกบันทึกไปกับบิล');
assert.match(html, /ข้อความยาวเกินขนาดฉลากที่เลือก/, 'ระบบต้องป้องกันข้อความล้นฉลาก');

console.log('medicine label tests passed');
