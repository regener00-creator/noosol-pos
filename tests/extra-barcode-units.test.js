const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const helperStart = html.indexOf('function extraBarcodeEntries(');
const helperEnd = html.indexOf('function vendorBarcodeRowHtml(', helperStart);
const exactStart = html.indexOf('function findProductByExactCode(');
const exactEnd = html.indexOf('function renderCheckout(', exactStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'ไม่พบฟังก์ชันผูกบาร์โค้ดเพิ่มเติมกับหน่วย');
assert.ok(exactStart >= 0 && exactEnd > exactStart, 'ไม่พบฟังก์ชันค้นหาบาร์โค้ดแบบตรงตัว');

const products = [{
  id: 1,
  unit: 'เม็ด',
  barcode: 'MAIN',
  sku: 'P001',
  units: [{sub: 'ซอง', barcode: 'PACK'}, {sub: 'กล่อง', barcode: 'BOX'}],
  extraBarcodes: ['OLD-PACK', 'OLD-BOX'],
  extraBarcodeUnits: ['ซอง', 'กล่อง'],
  vendorBarcodes: [{code: 'VENDOR'}],
}];
const sandbox = {
  products,
  escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  document: {querySelectorAll: () => [], getElementById: () => null},
};
vm.createContext(sandbox);
vm.runInContext(`${html.slice(helperStart, helperEnd)}\n${html.slice(exactStart, exactEnd)}`, sandbox);

assert.equal(sandbox.extraBarcodeUnitForCode(products[0], 'OLD-PACK'), 'ซอง');
assert.equal(sandbox.extraBarcodeUnitForCode(products[0], 'OLD-BOX'), 'กล่อง');
assert.equal(sandbox.findProductByExactCode('OLD-BOX').unitName, 'กล่อง');
assert.equal(sandbox.findProductByExactCode('VENDOR').unitName, 'เม็ด');
assert.equal(sandbox.findProductByExactCode('PACK').unitName, 'ซอง');

const legacy = {unit: 'ขวด', units: [], extraBarcodes: ['LEGACY']};
assert.equal(sandbox.extraBarcodeUnitForCode(legacy, 'LEGACY'), 'ขวด', 'สินค้าเดิมต้องใช้หน่วยหลักโดยอัตโนมัติ');
const rowHtml = sandbox.extraBarcodeRowHtml({code: 'OLD-BOX', unit: 'กล่อง'}, ['เม็ด', 'กล่อง'], 'เม็ด');
assert.ok(rowHtml.indexOf('class="eb_unit"') < rowHtml.indexOf('class="eb_code"'), 'ช่องหน่วยต้องอยู่ก่อนช่องบาร์โค้ดเพิ่มเติม');

const formStart = html.indexOf('function renderProductForm()');
const formEnd = html.indexOf('function renderWarehouse()', formStart);
const formSource = html.slice(formStart, formEnd);
const productPricingPanelStart = formSource.indexOf('<div class="panel product-pricing-panel">');
const productDataPanel = formSource.slice(formSource.indexOf('ข้อมูลสินค้า'), productPricingPanelStart);
const unitPanel = formSource.slice(productPricingPanelStart, formSource.indexOf('บาร์โค้ดเพิ่มเติม'));
for (const id of ['f_price', 'f_cost', 'f_stock']) {
  assert.doesNotMatch(productDataPanel, new RegExp(`id=["']${id}["']`), `${id} ต้องย้ายออกจากข้อมูลสินค้า`);
  assert.match(unitPanel, new RegExp(`id=["']${id}["']`), `${id} ต้องอยู่ในก้อนข้อมูลหน่วยและราคา`);
}
assert.doesNotMatch(productDataPanel, /renderedMainUnitSelect/, 'หน่วยหลักต้องย้ายออกจากข้อมูลสินค้า');
assert.match(unitPanel, /renderedMainUnitSelect/, 'หน่วยหลักต้องอยู่ในก้อนข้อมูลหน่วยและราคา');
assert.match(formSource, /extraBarcodeRowHtml\(entry,extraBarcodeAvailableUnits\(p\),p\.unit\)/);
assert.doesNotMatch(formSource, /<h3>ประเภทสินค้า<\/h3>/, 'ต้องไม่แสดงก้อนประเภทสินค้า');
assert.doesNotMatch(formSource, /id=["']f_wh["']/, 'ต้องไม่แสดงคลังที่แก้ไขไม่ได้');
assert.doesNotMatch(formSource, /id=["']f_expiry["']/, 'วันหมดอายุต้องจัดการในแต่ละ LOT');
assert.match(formSource, /<label>ยี่ห้อ\/แบรนด์<\/label>/, 'ต้องใช้ชื่อยี่ห้อ/แบรนด์');
assert.doesNotMatch(formSource, /<h3>หน่วยและราคา<\/h3>/, 'ต้องไม่แสดงหัวข้อหน่วยและราคา');
assert.doesNotMatch(formSource, /กำหนดหน่วยหลัก ราคาขาย ทุน และจำนวนคงเหลือ รวมถึงหน่วยขายเพิ่มเติมของสินค้านี้/, 'ต้องไม่แสดงคำอธิบายก้อนหน่วยและราคา');
assert.ok(unitPanel.indexOf('id="changeBaseUnitBtn"') > unitPanel.indexOf('id="f_barcode"'), 'ปุ่มเปลี่ยนหน่วยหลักต้องอยู่ต่อจากเลขบาร์โค้ด');
assert.match(unitPanel, /class="btn primary small product-base-unit-action"[^>]*id="changeBaseUnitBtn"/, 'ปุ่มเปลี่ยนหน่วยหลักต้องเป็นปุ่มสีน้ำตาล');
assert.doesNotMatch(formSource, /<h1>เพิ่มบริการหรือสินค้า<\/h1>/, 'หน้าเพิ่มสินค้าต้องไม่แสดงหัวข้อใหญ่');
assert.doesNotMatch(formSource, /<h1>แก้ไขสินค้า<\/h1>/, 'หน้าแก้ไขต้องไม่แสดงหัวข้อใหญ่แก้ไขสินค้า');
assert.doesNotMatch(formSource, /แก้ไขบริการหรือสินค้า/, 'ต้องไม่ใช้ชื่อหน้าแก้ไขเดิม');

console.log('extra barcode unit tests passed');
