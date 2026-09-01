const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();

assert.match(html, /function canEditMobilePrice\(user=loggedInUser\(\)\)/);
assert.match(html, /user\?\.owner===true&&Number\(user\?\.level\)===1/);
assert.doesNotMatch(html, /id="mobilePriceEditStock"/);
assert.match(html, /mobile-price-stock-readonly mobile-metric primary/);
assert.match(html, /id="mobilePriceEditSale"/);
assert.match(html, /id="mobilePriceEditCost"/);
assert.match(html, /id="mobilePriceLot"/);
assert.match(html, /id="mobilePriceEditExpiry"/);
assert.match(html, /id="mobilePriceSaveChanges"/);
assert.doesNotMatch(html, /แก้ไขเฉพาะคลัง:/);
assert.doesNotMatch(html, /ยิงบาร์โค้ด พิมพ์รหัส หรือใช้กล้องมือถือ โดยไม่เพิ่มสินค้าเข้าบิล/);
assert.doesNotMatch(html, /เครื่องยิงบาร์โค้ดที่ส่ง Enter อัตโนมัติใช้งานได้ทันที/);
assert.doesNotMatch(html, /<h2 class="mobile-tool-title">เช็คราคาสินค้า<\/h2>/);
assert.doesNotMatch(html, /\.mobile-price-edit-field\.stock/);
assert.match(html, /\.mobile-price-stock-readonly\{margin-bottom:8px;\}/);
assert.match(html, /@media \(max-width:420px\)[\s\S]*\.mobile-price-edit-grid\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);\}/);
assert.match(html, /sb\.rpc\('owner_update_mobile_product_details'/);
const saveStart = html.indexOf('async function saveMobilePriceChanges(');
const saveEnd = html.indexOf('function mobileInspectionVisibleLists(', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'ไม่พบฟังก์ชันบันทึกข้อมูลเช็คราคาบนมือถือ');
assert.doesNotMatch(html.slice(saveStart, saveEnd), /p_stock:/);
assert.match(html, /p_lot_id:payload\.lotId/);
assert.match(html, /document\.getElementById\('mobilePriceSaveChanges'\)\?\.addEventListener\('click',saveMobilePriceChanges\)/);

const payloadStart = html.indexOf('function mobilePriceEditPayload(');
const payloadEnd = html.indexOf('function mobilePriceResultHtml(', payloadStart);
assert.ok(payloadStart >= 0 && payloadEnd > payloadStart, 'ไม่พบฟังก์ชันคำนวณข้อมูลแก้ไขราคาบนมือถือ');

const context = {
  inspectionListUnitOptions(product) {
    return [
      { name: product.unit, factor: 1, price: product.price, cost: product.cost },
      ...(product.units || []).map(unit => ({ name: unit.sub, factor: unit.factor, price: unit.price, cost: unit.cost })),
    ];
  },
};
vm.createContext(context);
const dateStart = html.indexOf('function dmyToISO(');
const dateEnd = html.indexOf('function dmyDateFieldHtml(', dateStart);
assert.ok(dateStart >= 0 && dateEnd > dateStart, 'ไม่พบฟังก์ชันแปลงวันที่ที่พิมพ์เอง');
vm.runInContext(html.slice(dateStart, dateEnd), context);
vm.runInContext(html.slice(payloadStart, payloadEnd), context);

const product = {
  id: 10,
  name: 'สินค้าทดสอบ',
  unit: 'กล่อง',
  price: 100,
  cost: 60,
  units: [{ sub: 'ลัง', factor: 12, price: 1100, cost: 650, barcode: 'CASE-10' }],
};

const main = context.mobilePriceEditPayload(product, 'กล่อง', {
  price: '120', cost: '70', expiry: '10-10-2027',
}, 2, 91);
assert.equal(main.error, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(main,'stock'), false);
assert.equal(main.product.price, 120);
assert.equal(main.product.cost, 70);
assert.equal(main.product.units[0].price, 1100);
assert.equal(main.warehouseId, 2);
assert.equal(main.lotId, 91);
assert.equal(main.expiry, '2027-10-10');

const caseUnit = context.mobilePriceEditPayload(product, 'ลัง', {
  price: '1250', cost: '700', expiry: '',
}, 3);
assert.equal(caseUnit.error, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(caseUnit,'stock'), false);
assert.equal(caseUnit.product.price, 100);
assert.equal(caseUnit.product.cost, 60);
assert.equal(caseUnit.product.units[0].price, 1250);
assert.equal(caseUnit.product.units[0].cost, 700);
assert.equal(caseUnit.product.units[0].barcode, 'CASE-10');

assert.match(context.mobilePriceEditPayload(product, 'กล่อง', { price: -1, cost: 1, expiry: '' }, 1).error, /ราคาขาย/);
assert.match(context.mobilePriceEditPayload(product, 'กล่อง', { price: 1, cost: -1, expiry: '' }, 1).error, /ทุน/);
assert.match(context.mobilePriceEditPayload(product, 'กล่อง', { price: 1, cost: 1, expiry: '05-07-2027' }, 1).error, /เลือก Lot/);
assert.match(context.mobilePriceEditPayload(product, 'กล่อง', { price: 1, cost: 1, expiry: '31-02-2027' }, 1, 91).error, /วันหมดอายุ/);
assert.equal(context.mobilePriceEditPayload(product, 'กล่อง', { price: 1, cost: 1, expiry: '5/7/2027' }, 1, 91).expiry, '2027-07-05');

console.log('mobile price edit tests passed');
