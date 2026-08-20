const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = {};
vm.createContext(context);

const stockAdjustNavIndex = html.indexOf("['stockadjust','ปรับเป็นศูนย์'");
const stockEditNavIndex = html.indexOf("['stockedit','แก้ไขสต๊อก'");
const promotionsNavIndex = html.indexOf("['promotions','โปรโมชั่น'");
assert.ok(stockAdjustNavIndex >= 0 && stockEditNavIndex > stockAdjustNavIndex && promotionsNavIndex > stockEditNavIndex, 'เมนูแก้ไขสต๊อกต้องอยู่ใต้ปรับเป็นศูนย์');
assert.match(html, /LEVEL2_HIDDEN_TABS[^\n]+stockedit/);
assert.match(html, /stockedit:\s*renderStockEdit/);
assert.match(html, /data-stock-edit-amount="\$\{p\.id\}"/);
assert.match(html, /setProductStockOnSupabase\(p\.id,newStock\)/);
assert.match(html, /persistWorkspaceData\(\)/);

function loadOneLineFunction(name) {
  const match = html.match(new RegExp(`function ${name}\\([^\\r\\n]+`));
  assert.ok(match, `ไม่พบฟังก์ชัน ${name} ใน index.html`);
  vm.runInContext(match[0], context);
}

function loadFunctionBlock(name, nextName) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `ไม่พบช่วงฟังก์ชัน ${name}`);
  vm.runInContext(html.slice(start, end), context);
}

loadOneLineFunction('stockBaseFromUnitAmount');
loadOneLineFunction('stockUnitAmountFromBase');

assert.equal(context.stockBaseFromUnitAmount(5, 12), 60);
assert.equal(context.stockBaseFromUnitAmount('2.5', 24), 60);
assert.equal(context.stockBaseFromUnitAmount(-3, 10), -30);
assert.equal(context.stockBaseFromUnitAmount('', 0), 0);
assert.equal(context.stockBaseFromUnitAmount(7, ''), 7);

assert.equal(context.stockUnitAmountFromBase(120, 12), 10);
assert.equal(context.stockUnitAmountFromBase(7, 3), 2.33);
assert.equal(context.stockUnitAmountFromBase(-30, 10), -3);
assert.equal(context.stockUnitAmountFromBase('', 0), 0);
assert.equal(context.stockUnitAmountFromBase(7, ''), 7);

const baseStock = context.stockBaseFromUnitAmount(1.25, 48);
assert.equal(baseStock, 60);
assert.equal(context.stockUnitAmountFromBase(baseStock, 48), 1.25);

Object.assign(context, {
  products: [
    { id: 1, sku: 'P-001', barcode: '8850001', name: 'ยาทดสอบ', category: 'ยา', brand: 'ทั่วไป', unit: 'แผง', stock: 120, units: [{ sub: 'กล่อง', barcode: 'BOX-001', factor: 10 }] },
    { id: 2, sku: 'V-002', barcode: '8850002', name: 'วิตามินซี', category: 'วิตามิน', brand: 'แบรนด์เอ', unit: 'ขวด', stock: 5, units: [] },
  ],
  categories: ['ยา', 'วิตามิน'],
  brands: ['ทั่วไป', 'แบรนด์เอ'],
  stockEditItems: [1],
  stockEditCatFilter: { category: 'ยา', brand: '' },
  stockEditSearchQuery: '',
  stockEditSelectedIds: new Set([1]),
  stockEditRowUnitSel: { 1: 'กล่อง' },
  escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  matchesBarcode: (product, query) => product.barcode === query || (product.units || []).some(unit => unit.barcode === query),
  stockInLargestUnit: product => `${product.stock} ${product.unit}`,
});

loadFunctionBlock('stockEditCurrentProducts', 'stockEditMatchesQuery');
loadFunctionBlock('stockEditMatchesQuery', 'stockEditRowsHtml');
loadFunctionBlock('stockEditRowsHtml', 'renderStockEdit');
loadFunctionBlock('renderStockEdit', 'renderTransferForm');

assert.equal(context.stockEditMatchesQuery(context.products[0], 'P-001'), true);
assert.equal(context.stockEditMatchesQuery(context.products[0], '8850001'), true);
assert.equal(context.stockEditMatchesQuery(context.products[0], 'BOX-001'), true);
assert.equal(context.stockEditMatchesQuery(context.products[0], 'ไม่พบ'), false);

const rendered = context.renderStockEdit();
assert.match(rendered, /<h1>แก้ไขสต๊อก<\/h1>/);
assert.match(rendered, /id="stockEditCategorySelect"/);
assert.match(rendered, /id="stockEditBrandSelect"/);
assert.match(rendered, /id="stockEditAddByCategoryBtn"/);
assert.match(rendered, /id="stockEditInput"/);
assert.match(rendered, /<th>รหัสสินค้า<\/th><th>บาร์โค้ด<\/th><th>สินค้า<\/th><th>หน่วย<\/th><th>คงเหลือ<\/th>/);
assert.match(rendered, /class="stock-edit-selected"/);
assert.match(rendered, /P-001/);
assert.match(rendered, /BOX-001/);
assert.match(rendered, /ยาทดสอบ/);
assert.match(rendered, /data-stock-edit-amount="1"/);
assert.match(rendered, /data-factor="10"/);
assert.match(rendered, /data-unit="กล่อง"/);
assert.match(rendered, /value="12"/);
assert.doesNotMatch(rendered, /data-stock-edit-open=/);

console.log('stock-edit tests passed');
