const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0016_product_base_unit_changes.sql'), 'utf8');
const context = {
  extraBarcodeEntries: product => (product.extraBarcodes || []).map((code, index) => ({code, unit:(product.extraBarcodeUnits || [])[index] || product.unit})),
};
vm.createContext(context);

function loadFunctionBlock(name, nextName) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `ไม่พบช่วงฟังก์ชัน ${name}`);
  vm.runInContext(html.slice(start, end), context);
}

loadFunctionBlock('resolveNetFactor', 'stockForUnitRow');
loadFunctionBlock('baseUnitChangeRound', 'buildProductBaseUnitChange');
loadFunctionBlock('buildProductBaseUnitChange', 'baseUnitChangeStockPreview');
loadFunctionBlock('baseUnitChangeStockPreview', 'productBaseUnitChangeBlockers');
loadFunctionBlock('productBaseUnitChangeBlockers', 'openProductBaseUnitChangeModal');

const decolgen = {
  id: 101,
  name: 'Decolgen prin',
  unit: 'ซอง',
  barcode: '885-SACHET',
  price: 20,
  cost: 12,
  stock: 30,
  multiunit: true,
  extraBarcodes: ['OLD-SACHET'],
  extraBarcodeUnits: ['ซอง'],
  units: [
    { sub: 'กล่อง', per: 10, base: 'ซอง', factor: 10, price: 190, cost: 110, barcode: '885-BOX' },
    { sub: 'ลัง', per: 20, base: 'กล่อง', factor: 200, price: 3600, cost: 2100, barcode: '885-CASE' },
  ],
};

const result = context.buildProductBaseUnitChange(decolgen, {
  newUnit: 'เม็ด',
  conversion: 4,
  newPrice: 5,
  newCost: 3,
  newBarcode: '',
  changedAt: '2026-08-25T08:00:00.000Z',
  changedBy: 'เจ้าของร้าน',
});

assert.equal(result.error, undefined);
assert.equal(result.oldUnit, 'ซอง');
assert.equal(result.newUnit, 'เม็ด');
assert.equal(result.conversion, 4);
assert.equal(result.product.unit, 'เม็ด');
assert.equal(result.product.price, 5);
assert.equal(result.product.cost, 3);
assert.equal(result.product.barcode, '');
assert.deepEqual(Array.from(result.product.extraBarcodeUnits), ['ซอง']);
assert.deepEqual(
  Array.from(result.product.units, unit => [unit.sub, unit.per, unit.base, unit.factor, unit.barcode]),
  [
    ['ซอง', 4, 'เม็ด', 4, '885-SACHET'],
    ['กล่อง', 10, 'ซอง', 40, '885-BOX'],
    ['ลัง', 20, 'กล่อง', 800, '885-CASE'],
  ],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(result.product.unitChangeHistory[0])),
  { oldUnit: 'ซอง', newUnit: 'เม็ด', conversion: 4, changedAt: '2026-08-25T08:00:00.000Z', changedBy: 'เจ้าของร้าน' },
);

const preview = context.baseUnitChangeStockPreview(101, 4,
  [{ id: 1, name: 'พระยาสุเรนทร์' }, { id: 2, name: 'พรชัย' }],
  [{ warehouse_id: 1, product_id: 101, stock: 30 }, { warehouse_id: 2, product_id: 101, stock: 12 }],
);
assert.deepEqual(JSON.parse(JSON.stringify(preview)), [
  { warehouseId: 1, warehouseName: 'พระยาสุเรนทร์', before: 30, after: 120 },
  { warehouseId: 2, warehouseName: 'พรชัย', before: 12, after: 48 },
]);

assert.match(context.buildProductBaseUnitChange(decolgen, {newUnit:'กล่อง',conversion:4,newPrice:5,newCost:3}).error, /มีอยู่/);
assert.match(context.buildProductBaseUnitChange(decolgen, {newUnit:'เม็ด',conversion:0,newPrice:5,newCost:3}).error, /อัตราแปลง/);
assert.match(context.buildProductBaseUnitChange(decolgen, {newUnit:'เม็ด',conversion:4,newPrice:5,newCost:3,newBarcode:'885-SACHET'}).error, /บาร์โค้ดเดิม/);

Object.assign(context, {
  cart: [],
  salesHistory: [],
  goodsReceipts: [],
  productReturns: [{status:'คืนเรียบร้อย',items:[{productId:101}]}],
  transfers: [{status:'บันทึกแล้ว',items:[{productId:101}]}],
  productExchanges: [{status:'รับสินค้ากลับแล้ว',outgoingItems:[{pid:101}],incomingItems:[]}],
});
assert.deepEqual(Array.from(context.productBaseUnitChangeBlockers(101)), []);
context.productReturns=[{status:'รอรับคืน',stockApplied:false,items:[{productId:101}]}];
context.transfers=[{status:'บันทึกแล้ว',stockApplied:false,items:[{productId:101}]}];
context.productExchanges=[{status:'ส่งไปเปลี่ยนแล้ว',incomingApplied:false,outgoingItems:[{pid:101}],incomingItems:[]}];
assert.deepEqual(Array.from(context.productBaseUnitChangeBlockers(101)), [
  'ใบคืนสินค้าที่ยังไม่ลงสต๊อก 1 รายการ',
  'ใบโอนสินค้าที่ยังไม่ลงสต๊อก 1 รายการ',
  'ใบเปลี่ยนสินค้าที่ยังไม่เสร็จ 1 รายการ',
]);

assert.match(html, /id="changeBaseUnitBtn"/);
assert.match(html, /mainUnitSelect\.replace\('<select ','<select disabled '\)/);
assert.match(html, /sb\.rpc\('change_product_base_unit'/);
assert.match(html, /กรุณาใช้ปุ่ม “เปลี่ยนหน่วยหลัก”/);
assert.match(html, /barcodePrintBarcodeOwners\(\)\.find/);
assert.match(migration, /create table if not exists public\.product_unit_changes/);
assert.match(migration, /create or replace function public\.change_product_base_unit/);
assert.match(migration, /update public\.inventory_balances\s+set stock=stock\*p_conversion_factor/);
assert.match(migration, /security definer\s+set search_path = ''/);
assert.match(migration, /private\.is_current_owner\(\)/);
assert.match(migration, /revoke execute on function public\.change_product_base_unit[\s\S]+from public, anon/);

console.log('base unit change tests passed');
