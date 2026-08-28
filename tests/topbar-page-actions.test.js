const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function syncTopbarFormActions(');
const end = html.indexOf('function checkNegativeStockToast(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบระบบย้ายปุ่มขึ้น TOPBAR');
const source = html.slice(start, end);

assert.match(source,/\.form-final-actions/,'ปุ่มบันทึกและยกเลิกต้องย้ายขึ้น TOPBAR');
assert.match(source,/\.pagehead/,'กลุ่มปุ่มสร้างและเพิ่มในหัวหน้าต้องย้ายขึ้น TOPBAR');
assert.match(source,/\.rpt-head-actions/,'ปุ่มรายงานในหัวรายงานต้องย้ายขึ้น TOPBAR');
assert.match(source,/textContent\.trim\(\)===\'พิมพ์รายงาน\'/,'ปุ่มพิมพ์รายงานที่อยู่นอกหัวหน้าต้องย้ายขึ้น TOPBAR');
assert.match(source,/\.cash-shift-topbar-action/,'สถานะระบบชำระของหน้า POS ต้องย้ายขึ้น TOPBAR');
assert.match(html,/attachEvents\(\);\s*syncTopbarFormActions\(\);/,'ต้องผูก event ก่อนย้าย DOM เพื่อไม่ให้ปุ่มทำงานผิดตัว');

const transferStart=html.indexOf('function renderTransferForm()');
const transferEnd=html.indexOf('function effectiveThreshold(',transferStart);
assert.ok(transferStart>=0&&transferEnd>transferStart,'ไม่พบฟอร์มสร้างใบโอนสินค้า');
const transferSource=html.slice(transferStart,transferEnd);
assert.match(transferSource,/id="cancelTransferBottomBtn">ย้อนกลับ<\/button>/,'ปุ่มกลับจากฟอร์มใบโอนสินค้าที่ถูกย้ายขึ้น TOPBAR ต้องใช้คำว่า ย้อนกลับ');
assert.doesNotMatch(transferSource,/id="cancelTransferBottomBtn">ยกเลิก<\/button>/,'ปุ่ม TOPBAR ของฟอร์มใบโอนสินค้าต้องไม่ใช้คำว่า ยกเลิก');

console.log('topbar page actions tests passed');
