const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const normalizeStart = html.indexOf('function normalizeInspectionLists(');
const normalizeEnd = html.indexOf('function workspaceSnapshot(', normalizeStart);
const featureStart = html.indexOf('function inspectionListUnitOptions(');
const featureEnd = html.indexOf('const CODE128_PATTERNS=', featureStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart, 'ไม่พบฟังก์ชันจัดรูปข้อมูลรายการตรวจสินค้า');
assert.ok(featureStart >= 0 && featureEnd > featureStart, 'ไม่พบชุดฟังก์ชันรายการตรวจสินค้า');

const products = [
  {id:1,sku:'P-001',name:'สินค้าทดสอบ',unit:'กล่อง',barcode:'MAIN-001',price:120,cost:70,stock:25,wh:1,units:[{sub:'ลัง',barcode:'CASE-001',price:1100,cost:650,factor:10}]},
  {id:2,sku:'P-002',name:'สินค้าอีกตัว',unit:'ขวด',barcode:'MAIN-002',price:80,cost:45,stock:6,wh:1,units:[]},
];
let persistCount = 0;
let syncCount = 0;
let renderCount = 0;
const context = {
  products,
  inspectionLists: [],
  editingInspectionListId: 'new',
  inspectionListDraft: null,
  inspectionListCatFilter: {category:'',brand:''},
  inspectionListSearchQuery: '',
  inspectionListPage: 1,
  inspectionListCounter: 1,
  INSPECTION_LIST_PAGE_SIZE: 7,
  categories: [],
  brands: [],
  currentProfile: {firstName:'เจ้าของร้าน',username:'owner'},
  productUnitOptions: product => [
    {name:product.unit,label:product.unit,price:product.price,cost:product.cost,factor:1},
    ...(product.units || []).map(unit => ({name:unit.sub,label:unit.sub,price:unit.price,cost:unit.cost,factor:unit.factor})),
  ],
  stockUnitAmountFromBase: (stock, factor) => Math.round((Number(stock) / Number(factor || 1)) * 100) / 100,
  stockInLargestUnit: product => `${product.stock} ${product.unit}`,
  whName: () => 'คลังหลัก',
  loggedInUser: () => ({owner:true}),
  escapeHtml: value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  fmtMoney: value => Number(value).toFixed(2),
  pagerHtml: () => '',
  showToast: () => {},
  persistWorkspaceData: () => { persistCount++; },
  syncInspectionListsToSupabase: () => { syncCount++; },
  render: () => { renderCount++; },
  document: {getElementById: id => id === 'inspectionListName' ? {value:'รายการตรวจหน้าร้าน'} : null},
};
vm.createContext(context);
vm.runInContext(html.slice(normalizeStart, normalizeEnd), context);
vm.runInContext(html.slice(featureStart, featureEnd), context);

const normalized = context.normalizeInspectionLists([
  {id:'CHECK-0002',name:' ชุดทดสอบ ',items:[{pid:1,unit:'กล่อง'},{pid:1,unit:'ลัง'},{pid:'bad'}]},
]);
assert.equal(normalized.length, 1);
assert.equal(normalized[0].name, 'ชุดทดสอบ');
assert.deepEqual(Array.from(normalized[0].items, item => ({pid:item.pid,unit:item.unit})), [{pid:1,unit:'กล่อง'}]);

const options = context.inspectionListUnitOptions(products[0]);
assert.equal(options.length, 2);
assert.deepEqual(
  Array.from(options, option => ({name:option.name,barcode:option.barcode,price:option.price,cost:option.cost,factor:option.factor})),
  [
    {name:'กล่อง',barcode:'MAIN-001',price:120,cost:70,factor:1},
    {name:'ลัง',barcode:'CASE-001',price:1100,cost:650,factor:10},
  ],
);

context.inspectionListDraft = {name:'รายการใหม่',items:[]};
assert.equal(context.inspectionListAddProduct(products[0], 'กล่อง'), true);
assert.equal(context.inspectionListDraft.items[0].unit, 'กล่อง');
assert.equal(context.inspectionListAddProduct(products[0], 'ลัง'), false);
assert.equal(context.inspectionListDraft.items.length, 1);
assert.equal(context.inspectionListDraft.items[0].unit, 'ลัง');

context.inspectionListDraft.items = Array.from({length:15}, (_, index) => ({pid:index + 1,unit:'กล่อง'}));
const page = context.inspectionListPagination(context.inspectionListDraft.items, 2, 7);
assert.equal(page.currentPage, 2);
assert.equal(page.totalPages, 3);
assert.deepEqual(Array.from(page.rows, entry => entry.index), [7,8,9,10,11,12,13]);

context.inspectionListDraft = {id:null,name:'',items:[{pid:1,unit:'ลัง'}],createdAt:'2026-08-20T00:00:00.000Z',createdBy:'เจ้าของร้าน'};
context.editingInspectionListId = 'new';
assert.equal(context.saveInspectionListDraft(), true);
assert.equal(context.inspectionLists.length, 1);
assert.equal(context.inspectionLists[0].id, 'CHECK-0001');
assert.equal(context.inspectionLists[0].name, 'รายการตรวจหน้าร้าน');
assert.deepEqual(Array.from(context.inspectionLists[0].items, item => ({pid:item.pid,unit:item.unit})), [{pid:1,unit:'ลัง'}]);
assert.equal(persistCount, 1);
assert.equal(syncCount, 1);
assert.equal(renderCount, 1);

const overviewHtml = context.renderInspectionListOverview();
assert.match(overviewHtml, /รายการตรวจหน้าร้าน/);
assert.match(overviewHtml, /data-open-inspection-list="CHECK-0001"/);
context.editingInspectionListId = 'CHECK-0001';
context.inspectionListDraft = JSON.parse(JSON.stringify(context.inspectionLists[0]));
const ownerEditorHtml = context.renderInspectionListEditor();
assert.match(ownerEditorHtml, /<th>ทุน<\/th>/);
assert.match(ownerEditorHtml, /1100\.00/);
assert.match(ownerEditorHtml, /2\.5 ลัง/);
context.loggedInUser = () => ({owner:false});
const staffEditorHtml = context.renderInspectionListEditor();
assert.doesNotMatch(staffEditorHtml, /<th>ทุน<\/th>/);

assert.match(html, /\['inspectionlists','รายการตรวจสินค้า'/);
assert.match(html, /inspectionlists:\s*renderInspectionLists/);
assert.match(html, /key:'inspection_lists',value:inspectionLists/);
assert.match(html, /await loadInspectionListsFromSupabase\(\)/);
assert.match(html, /data-inspection-list-page/);
assert.match(html, /INSPECTION_LIST_PAGE_SIZE = 7/);

console.log('inspection list tests passed');
