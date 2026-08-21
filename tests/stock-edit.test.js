const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = {};
vm.createContext(context);

const historyNavIndex = html.indexOf("['history','ประวัติการขาย / ใบเสร็จ'");
const promotionsNavIndex = html.indexOf("['promotions','โปรโมชั่น'");
const purchaseSectionIndex = html.indexOf("{section:'ซื้อ'");
const productsNavIndex = html.indexOf("['products','รายการสินค้า'");
const inspectionListsNavIndex = html.indexOf("['inspectionlists','รายการตรวจสินค้า'");
const barcodePrintNavIndex = html.indexOf("['barcodeprint','พิมพ์บาร์โค้ดเอง'");
const stockEditNavIndex = html.indexOf("['stockedit','แก้ไขสต๊อก'");
const stockAdjustNavIndex = html.indexOf("['stockadjust','สินค้าติดลบ'");
const warehouseNavIndex = html.indexOf("['warehouse','คลังสินค้า / สาขา'");
const transferNavIndex = html.indexOf("['transfer','โอนสินค้าระหว่างคลัง'");
const settingsBusinessNavIndex = html.indexOf("['settingsbusiness','ตั้งค่าธุรกิจ'");
const settingsUsersNavIndex = html.indexOf("['settingsusers','เพิ่มผู้ใช้งาน'");
assert.ok(historyNavIndex >= 0 && promotionsNavIndex > historyNavIndex && purchaseSectionIndex > promotionsNavIndex, 'เมนูโปรโมชั่นต้องอยู่ใต้ประวัติการขายในหมวดขาย');
assert.ok(productsNavIndex >= 0 && inspectionListsNavIndex > productsNavIndex && stockEditNavIndex > inspectionListsNavIndex && stockAdjustNavIndex > stockEditNavIndex && transferNavIndex > stockAdjustNavIndex && barcodePrintNavIndex > transferNavIndex, 'เมนูพิมพ์บาร์โค้ดเองต้องอยู่ใต้โอนสินค้าระหว่างคลัง');
assert.ok(settingsBusinessNavIndex >= 0 && warehouseNavIndex > settingsBusinessNavIndex && settingsUsersNavIndex > warehouseNavIndex, 'เมนูคลังสินค้า / สาขาต้องอยู่ใต้ตั้งค่าธุรกิจ');
assert.doesNotMatch(html, /\['stockadjust','ปรับเป็นศูนย์'/);
assert.match(html, /LEVEL2_HIDDEN_TABS[^\n]+stockedit/);
assert.match(html, /stockedit:\s*renderStockEdit/);
assert.match(html, /data-stock-edit-amount="\$\{p\.id\}"/);
assert.match(html, /data-stock-edit-remove="\$\{p\.id\}"/);
assert.match(html, /setProductStockOnSupabase\(product\.id,newStock\)/);
assert.match(html, /persistWorkspaceData\(\)/);
assert.match(html, /\.stock-edit-stock-input\{[^}]*text-align:center/);

const stockEditAmountHandlerStart = html.indexOf("document.querySelectorAll('[data-stock-edit-amount]')");
const stockEditConfirmHandlerStart = html.indexOf('if(confirmStockEditBtn)', stockEditAmountHandlerStart);
const stockEditRemoveHandlerStart = html.indexOf("document.querySelectorAll('[data-stock-edit-remove]')", stockEditConfirmHandlerStart);
assert.ok(stockEditAmountHandlerStart >= 0 && stockEditConfirmHandlerStart > stockEditAmountHandlerStart && stockEditRemoveHandlerStart > stockEditConfirmHandlerStart);
assert.doesNotMatch(html.slice(stockEditAmountHandlerStart, stockEditConfirmHandlerStart), /setProductStockOnSupabase/);
assert.match(html.slice(stockEditConfirmHandlerStart, stockEditRemoveHandlerStart), /addEventListener\('click',confirmStockEditChanges\)/);
const confirmFunctionStart = html.indexOf('function confirmStockEditChanges(');
const confirmFunctionEnd = html.indexOf('function inspectionListUnitOptions(', confirmFunctionStart);
assert.ok(confirmFunctionStart >= 0 && confirmFunctionEnd > confirmFunctionStart);
assert.match(html.slice(confirmFunctionStart, confirmFunctionEnd), /setProductStockOnSupabase\(product\.id,newStock\)/);
assert.match(html.slice(confirmFunctionStart, confirmFunctionEnd), /persistWorkspaceData\(\)/);
assert.match(html.slice(confirmFunctionStart, confirmFunctionEnd), /syncInspectionListsToSupabase\(\)/);
assert.match(html, /function openStockEditInspectionListPicker\(/);
assert.match(html, /data-import-inspection-list/);
assert.match(html, /<button class="btn primary" id="importInspectionListBtn">ดึงข้อมูลจากรายการตรวจสินค้า<\/button>/);

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

const testProducts = [
    { id: 1, sku: 'P-001', barcode: '8850001', name: 'ยาทดสอบ', category: 'ยา', brand: 'ทั่วไป', unit: 'แผง', stock: 120, units: [{ sub: 'กล่อง', barcode: 'BOX-001', factor: 10 }] },
    { id: 2, sku: 'V-002', barcode: '8850002', name: 'วิตามินซี', category: 'วิตามิน', brand: 'แบรนด์เอ', unit: 'ขวด', stock: 5, units: [] },
];
for (let id = 3; id <= 8; id++) testProducts.push({ id, sku: `P-00${id}`, barcode: `885000${id}`, name: `สินค้าทดสอบ ${id}`, category: 'ยา', brand: 'ทั่วไป', unit: 'กล่อง', stock: id, units: [] });

Object.assign(context, {
  products: testProducts,
  categories: ['ยา', 'วิตามิน'],
  brands: ['ทั่วไป', 'แบรนด์เอ'],
  stockEditItems: testProducts.map(product => product.id),
  stockEditCatFilter: { category: 'ยา', brand: '' },
  stockEditSearchQuery: '',
  stockEditRowUnitSel: { 1: 'กล่อง' },
  stockEditDraftStocks: { 1: 60 },
  stockEditPage: 1,
  stockEditSourceInspectionListId: null,
  stockEditSourcePending: false,
  inspectionLists: [{id:'CHECK-0001',name:'ตรวจหน้าร้าน',items:[{pid:1,unit:'กล่อง'},{pid:2,unit:'ขวด'}],updatedAt:'2026-08-20T08:00:00.000Z',stockAdjustedAt:'',stockAdjustedBy:''}],
  currentProfile: {firstName:'เจ้าของร้าน',username:'owner'},
  STOCK_EDIT_PAGE_SIZE: 7,
  escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  matchesBarcode: (product, query) => product.barcode === query || (product.units || []).some(unit => unit.barcode === query),
  stockInLargestUnit: product => `${product.stock} ${product.unit}`,
  showToast: () => {},
  render: () => {},
  confirm: () => true,
});

loadFunctionBlock('stockEditCurrentProducts', 'stockEditMatchesQuery');
loadFunctionBlock('stockEditMatchesQuery', 'stockEditPendingChanges');
loadFunctionBlock('pagerHtml', 'isSupplierStyleDoc');
loadFunctionBlock('stockEditPendingChanges', 'stockEditPagination');
loadFunctionBlock('confirmStockEditChanges', 'inspectionListUnitOptions');
loadFunctionBlock('stockEditPagination', 'stockEditRowsHtml');
loadFunctionBlock('stockEditRowsHtml', 'renderStockEdit');
loadFunctionBlock('renderStockEdit', 'renderTransferForm');

assert.equal(context.stockEditMatchesQuery(context.products[0], 'P-001'), true);
assert.equal(context.stockEditMatchesQuery(context.products[0], '8850001'), true);
assert.equal(context.stockEditMatchesQuery(context.products[0], 'BOX-001'), true);
assert.equal(context.stockEditMatchesQuery(context.products[0], 'ไม่พบ'), false);
assert.equal(context.stockEditPendingChanges(context.products, { 1: 60 }).length, 1);
assert.equal(context.stockEditPendingChanges(context.products, { 1: 120 }).length, 0);
assert.equal(context.stockEditPendingChanges(context.products, { 999: 10 }).length, 0);
const secondPage = context.stockEditPagination(context.products, 2, 7);
assert.equal(secondPage.currentPage, 2);
assert.equal(secondPage.totalPages, 2);
assert.deepEqual(Array.from(secondPage.rows, product => product.id), [8]);
assert.equal(context.stockEditPagination(context.products, 99, 7).currentPage, 2);

const rendered = context.renderStockEdit();
assert.match(rendered, /<h1>แก้ไขสต๊อก<\/h1>/);
assert.match(rendered, /id="stockEditCategorySelect"/);
assert.match(rendered, /id="stockEditBrandSelect"/);
assert.match(rendered, /id="stockEditAddByCategoryBtn"/);
assert.match(rendered, /id="stockEditInput"/);
assert.match(rendered, /id="importInspectionListBtn"/);
assert.match(rendered, /<th>รหัสสินค้า<\/th><th>บาร์โค้ด<\/th><th>สินค้า<\/th><th>หน่วย<\/th><th>คงเหลือ<\/th><th aria-label="จัดการ"><\/th>/);
assert.match(rendered, /id="confirmStockEditBtn"/);
assert.ok(rendered.indexOf('id="clearStockEditBtn"') < rendered.indexOf('id="confirmStockEditBtn"'), 'ปุ่มยืนยันต้องอยู่หลังปุ่มล้างรายการ');
assert.match(rendered, /data-stock-edit-page="2"/);
assert.doesNotMatch(rendered, /สินค้าทดสอบ 8/);
assert.doesNotMatch(rendered, /id="stockEditSelectAll"/);
assert.doesNotMatch(rendered, /data-stock-edit-check=/);
assert.match(rendered, /P-001/);
assert.match(rendered, /BOX-001/);
assert.match(rendered, /ยาทดสอบ/);
assert.match(rendered, /data-stock-edit-amount="1"/);
assert.match(rendered, /data-factor="10"/);
assert.match(rendered, /data-unit="กล่อง"/);
assert.match(rendered, /value="6"/);
assert.match(rendered, /stock-edit-pending/);
assert.match(rendered, /data-stock-edit-remove="1"/);
assert.doesNotMatch(rendered, /data-stock-edit-open=/);

context.stockEditPage = 2;
const secondPageRendered = context.renderStockEdit();
assert.match(secondPageRendered, /สินค้าทดสอบ 8/);
assert.match(secondPageRendered, /class="pagebtn active" data-stock-edit-page="2"/);

assert.equal(context.stockEditImportInspectionList('CHECK-0001', false), true);
assert.equal(context.inspectionListAvailableForStockEdit(context.inspectionLists[0]), true);
assert.deepEqual(Array.from(context.stockEditItems), [1,2]);
assert.equal(context.stockEditRowUnitSel[1], 'กล่อง');
assert.equal(context.stockEditSourceInspectionListId, 'CHECK-0001');
assert.equal(context.stockEditSourcePending, true);
assert.equal(context.stockEditMarkInspectionComplete(), true);
assert.equal(context.stockEditSourcePending, false);
assert.equal(context.inspectionListAvailableForStockEdit(context.inspectionLists[0]), false);
assert.equal(context.stockEditImportInspectionList('CHECK-0001', false), false);
assert.match(context.inspectionLists[0].stockAdjustedAt, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(context.inspectionLists[0].stockAdjustedBy, 'เจ้าของร้าน');
const completedRendered = context.renderStockEdit();
assert.match(completedRendered, /ตรวจหน้าร้าน/);
assert.match(completedRendered, /แก้จำนวนเรียบร้อย/);
assert.match(html, /inspectionLists\.filter\(inspectionListAvailableForStockEdit\)/);

let stockSync = null;
let persisted = 0;
let inspectionSync = 0;
Object.assign(context, {
  stockEditDraftStocks: {1: 250},
  stockEditSourceInspectionListId: null,
  stockEditSourcePending: false,
  setProductStockOnSupabase: (id, stock) => { stockSync = {id, stock}; },
  persistWorkspaceData: () => { persisted++; },
  syncInspectionListsToSupabase: () => { inspectionSync++; },
  showToast: () => {},
  render: () => {},
});
assert.equal(context.confirmStockEditChanges(), true);
assert.deepEqual(stockSync, {id:1, stock:250});
assert.equal(context.products[0].stock, 250);
assert.equal(persisted, 1);
assert.equal(inspectionSync, 0);
assert.deepEqual(Object.keys(context.stockEditDraftStocks), []);

console.log('stock-edit tests passed');
