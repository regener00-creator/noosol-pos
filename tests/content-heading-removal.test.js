const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /\.topbar-action-source\{display:none;\}/, 'แหล่งปุ่ม TOPBAR ต้องไม่กินพื้นที่หน้า');

for (const heading of ['Audit Log', 'คลังสินค้า / สาขา', 'ผู้ใช้งานในระบบ', 'สินค้าใกล้หมดอายุ', 'สินค้าใกล้หมด']) {
  assert.doesNotMatch(html, new RegExp(`<h1>${heading.replace('/', '\\/')}<\\/h1>`), `ต้องลบหัวข้อ ${heading} ออกจากพื้นที่เนื้อหา`);
}

for (const description of [
  'ประวัติการสร้าง แก้ไข ลบเอกสาร และการเปลี่ยนแปลงสต๊อก รวมไว้ในหน้าเดียว',
  'รายชื่อคลังสินค้าทั้งหมด · ${warehouses.length} คลัง',
  'แสดงแยกตาม LOT และคลังสินค้า เพื่อวางแผนขาย คืนสินค้า หรือตัดจำหน่ายได้ถูกต้อง',
  'รายงานสำหรับดูจำนวนคงเหลือตามเกณฑ์ที่เลือกเท่านั้น หน้านี้ไม่เปลี่ยนจำนวนสต๊อก',
]) {
  assert.doesNotMatch(html, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'ต้องลบคำอธิบายที่ระบุออก');
}

for (const buttonId of ['auditLogRefresh', 'newWarehouseBtn', 'addSystemUserBtn', 'printExpiryBtn', 'printLowStockBtn']) {
  assert.match(html, new RegExp(`class="pagehead topbar-action-source"[^]*?id="${buttonId}"`), `ปุ่ม ${buttonId} ต้องยังส่งไป TOPBAR ได้`);
}

console.log('content heading removal tests passed');
