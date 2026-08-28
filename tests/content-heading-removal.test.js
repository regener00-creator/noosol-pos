const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /\.topbar-action-source\{display:none;\}/, 'แหล่งปุ่ม TOPBAR ต้องไม่กินพื้นที่หน้า');

for (const heading of ['Audit Log', 'คลังสินค้า / สาขา', 'ผู้ใช้งานในระบบ', 'สินค้าใกล้หมดอายุ', 'สินค้าใกล้หมด', 'ตั้งค่าระบบ', 'ข้อมูลธุรกิจ']) {
  assert.doesNotMatch(html, new RegExp(`<h1[^>]*>${heading.replace('/', '\\/')}<\\/h1>`), `ต้องลบหัวข้อ ${heading} ออกจากพื้นที่เนื้อหา`);
}

for (const description of [
  'ประวัติการสร้าง แก้ไข ลบเอกสาร และการเปลี่ยนแปลงสต๊อก รวมไว้ในหน้าเดียว',
  'รายชื่อคลังสินค้าทั้งหมด · ${warehouses.length} คลัง',
  'แสดงแยกตาม LOT และคลังสินค้า เพื่อวางแผนขาย คืนสินค้า หรือตัดจำหน่ายได้ถูกต้อง',
  'รายงานสำหรับดูจำนวนคงเหลือตามเกณฑ์ที่เลือกเท่านั้น หน้านี้ไม่เปลี่ยนจำนวนสต๊อก',
  'กำหนดข้อมูลร้านที่ใช้บนใบเสร็จ บิลเงินสด และเอกสารภาษี',
  'ประวัติการโอนย้ายสต็อกระหว่างสาขา',
  'เลือกสินค้า หน่วย และจำนวนป้าย แล้วพิมพ์ป้ายหน้าชั้นพร้อมราคาและบาร์โค้ด',
  'พิมพ์ชื่อ / รหัส / ยิงบาร์โค้ด หรือเลือกหมวดสินค้า เพื่อเพิ่มสินค้าลงรายงาน',
]) {
  assert.doesNotMatch(html, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'ต้องลบคำอธิบายที่ระบุออก');
}

for (const inlineTitle of [
  'สั่งของขาด <span class="page-title-meta">บันทึกรายการสินค้าที่ต้องแจ้งสั่งกับผู้แทน · ${allDocs.length} รายการ',
  'ใบรับสินค้า <span class="page-title-meta">บันทึกและตรวจสอบการรับสินค้าเข้าคลัง · ${allDocs.length} รายการ',
  'เปลี่ยนสินค้า <span class="page-title-meta">ติดตามสินค้าที่ส่งไปเปลี่ยนและสินค้าที่ได้รับกลับ · ${allDocs.length} รายการ',
  'สมุดรายชื่อ <span class="page-title-meta">· ${list.length} รายชื่อ',
  'รายชื่อผู้แทน <span class="page-title-meta">· ${list.length} รายชื่อ',
  'รายงานการเคลื่อนไหว <span class="page-title-meta">· ${groups.length} บิล · ${rows.length} รายการเคลื่อนไหว',
]) {
  assert.ok(html.includes(inlineTitle), `ต้องย้ายข้อความสรุปมาต่อท้ายชื่อหน้า: ${inlineTitle}`);
}

const inventoryReportStart = html.indexOf('function renderRInventory(');
const inventoryReportEnd = html.indexOf('function renderBusinessSettings(', inventoryReportStart);
const inventoryReportSource = html.slice(inventoryReportStart, inventoryReportEnd);
assert.ok(inventoryReportStart >= 0 && inventoryReportEnd > inventoryReportStart, 'ต้องพบตัวสร้างหน้ารายงานสินค้าคงเหลือ');
assert.doesNotMatch(inventoryReportSource, /<h1>รายงานสินค้าคงเหลือ<\/h1>/, 'ต้องลบชื่อรายงานสินค้าคงเหลือออกจากพื้นที่เนื้อหา');
assert.match(html, /class="pagehead topbar-action-source"[^]*?id="resetStockReportBtn"[^]*?id="printStockReportBtn"/, 'ปุ่มรายงานสินค้าคงเหลือต้องยังอยู่บน TOPBAR');
assert.match(html, /class="pagehead topbar-action-source"[^]*?id="saveBusinessSettingsBtn"/, 'ปุ่มบันทึกข้อมูลธุรกิจต้องยังอยู่บน TOPBAR');

for (const buttonId of ['auditLogRefresh', 'newWarehouseBtn', 'addSystemUserBtn', 'printExpiryBtn', 'printLowStockBtn']) {
  assert.match(html, new RegExp(`class="pagehead topbar-action-source"[^]*?id="${buttonId}"`), `ปุ่ม ${buttonId} ต้องยังส่งไป TOPBAR ได้`);
}

console.log('content heading removal tests passed');
