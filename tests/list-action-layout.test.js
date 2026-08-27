const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(
  html,
  /\.history-actions\.product-exchange-actions,\.history-actions\.contact-action-icons,\.history-actions\.sales-representative-actions,\.history-actions\.product-return-actions\{justify-content:center;\}/,
  'กลุ่มไอคอนของหน้าที่ระบุต้องอยู่กึ่งกลางช่องข้อมูล'
);
assert.match(html, /class="history-actions product-exchange-actions"/, 'หน้าเปลี่ยนสินค้าต้องใช้กลุ่มไอคอนเฉพาะหน้า');
assert.match(html, /class="history-actions contact-action-icons"/, 'หน้าสมุดรายชื่อต้องใช้กลุ่มไอคอนเฉพาะหน้า');
assert.match(html, /class="history-actions sales-representative-actions"/, 'หน้ารายชื่อผู้แทนต้องใช้กลุ่มไอคอนเฉพาะหน้า');
assert.match(html, /class="history-actions product-return-actions"/, 'หน้าใบคืนสินค้าต้องใช้กลุ่มไอคอนเฉพาะหน้า');
assert.match(html, /\.product-exchange-form-actions\{display:flex;align-items:center;gap:14px;\}/, 'ปุ่มยกเลิกและบันทึกหน้าเปลี่ยนสินค้าต้องมีระยะห่าง');

assert.match(html, /const CONTACTS_PER_PAGE = 20;/, 'สมุดรายชื่อต้องแสดงหน้าละ 20 รายการ');
assert.match(html, /const pageList=list\.slice\(pageStart,pageStart\+CONTACTS_PER_PAGE\);/, 'สมุดรายชื่อต้องตัดข้อมูลตามหน้าปัจจุบัน');
assert.match(html, /pagerHtml\(contactPage,totalPages,'contactpage'\)/, 'สมุดรายชื่อต้องมีแถบเปลี่ยนหน้า');
assert.match(html, /document\.querySelectorAll\('\[data-contactpage\]'\)/, 'ปุ่มเปลี่ยนหน้าสมุดรายชื่อต้องทำงาน');

assert.match(
  html,
  /\.icon-btn\[data-act="editproduct"\]\{color:var\(--primary\)!important;/,
  'ไอคอนปากกาแก้ไขต้องใช้สีฟ้าหลัก'
);
assert.doesNotMatch(html, /editproduct"\]\{color:#737D89/, 'ไอคอนปากกาแก้ไขต้องไม่กลับไปเป็นสีเทา');

console.log('list action layout tests passed');
