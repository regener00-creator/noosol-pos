const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = require('./load-app-source')();

assert.match(source, /const POS_SMALLEST_UNIT_COMMAND='PEPOS-CMD-SMALLEST'/);
assert.match(source, /id="posSmallestUnitBtn"/);
assert.match(source, /id="posSmallestUnitBtn"[^>]*><kbd>Home<\/kbd><span>หน่วยเล็กสุด<\/span>/);
assert.doesNotMatch(source, /id="posSmallestUnitBtn"[^>]*><span>หน่วยเล็กสุด 1 รายการ<\/span>/);
assert.match(source, /id="holdBtn"[^>]*>พักออเดอร์<\/button>\s*<button class="pos-fbtn danger" id="clearBillBtn"/);
assert.match(source, /พร้อมขายหน่วยเล็กสุด/);
assert.match(source, /e\.key==='Home'/);
assert.match(source, /e\.key==='Escape'&&posSmallestUnitOnce/);
assert.match(source, /if\(isPosSmallestUnitCommand\(q\)\)[\s\S]{0,260}posSmallestUnitOnce=true/);
assert.match(source, /consumePosSaleUnit\(exactHit\.product,exactHit\.unitName\)/);
assert.match(source, /consumePosSaleUnit\(p,null\)/);
assert.match(source, /id="printPosSmallestUnitCommandBtn"/);
assert.match(source, /printPosSmallestUnitCommandBarcode/);
assert.match(source, /ยิงใบนี้ก่อนสินค้า 1 ครั้ง/);

const start = source.indexOf('function productUnitOptions(');
const end = source.indexOf('function favoriteProductId(', start);
assert.ok(start >= 0 && end > start, 'ต้องพบฟังก์ชันเลือกหน่วยสินค้า');
const context = {
  productUnitCost: () => 0,
  posSmallestUnitOnce: false,
  POS_SMALLEST_UNIT_COMMAND: 'PEPOS-CMD-SMALLEST',
  searchQuery: '',
  render() {},
  setTimeout() {},
  document: {getElementById() { return null; }},
  showToast() {},
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const product = {
  unit: 'แผง', barcode: 'PANEL', price: 20,
  units: [
    {sub: 'กล่อง', factor: 10, barcode: 'BOX', price: 180},
    {sub: 'ลัง', factor: 100, barcode: 'CASE', price: 1700},
  ],
};
assert.equal(context.smallestProductUnitName(product), 'แผง');
assert.equal(context.productBarcodeForUnit(product, 'แผง'), 'PANEL');
assert.equal(context.productBarcodeForUnit(product, 'กล่อง'), 'BOX');
assert.equal(context.productBarcodeForUnit(product, 'ลัง'), 'CASE');
assert.equal(context.smallestProductUnitName({unit: 'ขวด', barcode: 'BOTTLE', price: 50, units: []}), 'ขวด');
assert.equal(context.isPosSmallestUnitCommand(' pepos-cmd-smallest '), true);
assert.equal(context.isPosSmallestUnitCommand('BOX'), false);
context.posSmallestUnitOnce = true;
assert.equal(context.consumePosSaleUnit(product, 'กล่อง'), 'แผง');
assert.equal(context.posSmallestUnitOnce, false, 'คำสั่งต้องถูกใช้เพียงสินค้ารายการเดียว');
assert.equal(context.consumePosSaleUnit(product, 'ลัง'), 'ลัง', 'เมื่อไม่เปิดคำสั่งต้องเคารพบาร์โค้ดของหน่วยที่ยิง');

console.log('POS smallest-unit command tests passed');
