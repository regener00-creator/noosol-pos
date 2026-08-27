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
assert.match(html,/attachEvents\(\);\s*syncTopbarFormActions\(\);/,'ต้องผูก event ก่อนย้าย DOM เพื่อไม่ให้ปุ่มทำงานผิดตัว');

console.log('topbar page actions tests passed');
