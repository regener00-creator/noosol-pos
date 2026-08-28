const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.doesNotMatch(html, /<h1>โปรโมชั่น<\/h1>/, 'หน้าโปรโมชั่นต้องไม่แสดงหัวข้อซ้ำในพื้นที่เนื้อหา');
assert.doesNotMatch(html, /จัดการส่วนลด แถม และราคาพิเศษ · \$\{list\.length\} รายการ/, 'หน้าโปรโมชั่นต้องไม่แสดงคำอธิบายเดิม');
assert.match(html, /class="rpt promotion-list-page"/, 'หน้ารายการโปรโมชั่นต้องมีคลาสเฉพาะสำหรับขยายพื้นที่');
assert.match(html, /\.rpt\.promotion-list-page\{width:100%;max-width:none;\}/, 'พื้นที่ตารางโปรโมชั่นต้องใช้ selector เฉพาะที่ไม่ถูกค่า max-width ของ rpt ทับ');
assert.match(html, /\.promotion-list-topbar-source\{display:none;\}/, 'แหล่งปุ่มสร้างโปรโมชั่นต้องไม่กินพื้นที่ในเนื้อหา');
assert.match(html, /class="pagehead promotion-list-topbar-source"[^>]*><div><\/div><button class="btn primary" id="newPromotionBtn"/, 'ปุ่มสร้างโปรโมชั่นต้องยังถูกส่งไป TOPBAR ได้');

console.log('promotions layout tests passed');
