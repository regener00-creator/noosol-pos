const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();
const normalizeStart = html.indexOf('function normalizeInspectionLists(');
const normalizeEnd = html.indexOf('function workspaceSnapshot(', normalizeStart);
const expandableStart = html.indexOf('function expandableDocumentItemRows(');
const expandableEnd = html.indexOf('function documentItemsPreview(', expandableStart);
const featureStart = html.indexOf('function inspectionListUnitOptions(');
const featureEnd = html.indexOf('const CODE128_PATTERNS=', featureStart);
assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart, 'ไม่พบฟังก์ชันจัดรูปข้อมูลรายการตรวจสินค้า');
assert.ok(expandableStart >= 0 && expandableEnd > expandableStart, 'ไม่พบฟังก์ชันแสดงรายการสินค้าแบบขยาย');
assert.ok(featureStart >= 0 && featureEnd > featureStart, 'ไม่พบชุดฟังก์ชันรายการตรวจสินค้า');

const products = [
  {id:1,sku:'P-001',name:'สินค้าทดสอบ',unit:'กล่อง',barcode:'MAIN-001',price:120,cost:70,stock:25,wh:1,units:[{sub:'ลัง',barcode:'CASE-001',price:1100,cost:650,factor:10}]},
  {id:2,sku:'P-002',name:'สินค้าอีกตัว',unit:'ขวด',barcode:'MAIN-002',price:80,cost:45,stock:6,wh:2,units:[]},
];
let persistCount = 0;
let syncCount = 0;
let renderCount = 0;
const context = {
  products,
  inspectionLists: [],
  editingInspectionListId: 'new',
  inspectionListDraft: null,
  inspectionListCatFilter: {wh:'',category:'',brand:''},
  inspectionListSearchQuery: '',
  inspectionListPage: 1,
  inspectionListSort: {key:'sku',dir:1},
  inspectionListOverviewSort: {key:'updatedAt',dir:-1},
  inspectionListOverviewSelectedIds: new Set(),
  expandedDocumentItemLists: new Set(),
  inspectionListCounter: 1,
  documentPrefixes: {inspection:'CHECK'},
  mobileInspectionListId: '',
  mobileInspectionOpenedListId: '',
  mobileInspectionAddingToSaved: false,
  mobileInspectionSavedAddQuery: '',
  mobileInspectionSavedAddItems: [],
  mobileInspectionLastProductId: null,
  mobileStockSourceListId: '',
  mobileInspectionCheckedByList: {},
  stockEditSourceInspectionListId: null,
  stockEditSourcePending: false,
  INSPECTION_LIST_PAGE_SIZE: 10,
  categories: [],
  brands: [],
  warehouses: [{id:1,name:'คลังหนึ่ง'},{id:2,name:'คลังสอง'}],
  accessibleWarehouses: () => [{id:1,name:'คลังหนึ่ง'},{id:2,name:'คลังสอง'}],
  currentProfile: {firstName:'เจ้าของร้าน',username:'owner'},
  productUnitOptions: product => [
    {name:product.unit,label:product.unit,price:product.price,cost:product.cost,factor:1},
    ...(product.units || []).map(unit => ({name:unit.sub,label:unit.sub,price:unit.price,cost:unit.cost,factor:unit.factor})),
  ],
  stockUnitAmountFromBase: (stock, factor) => Math.round((Number(stock) / Number(factor || 1)) * 100) / 100,
  warehouseStock: productId => products.find(product => product.id === Number(productId))?.stock || 0,
  activeWarehouseId: 1,
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
vm.runInContext(html.slice(expandableStart, expandableEnd), context);
vm.runInContext(html.slice(featureStart, featureEnd), context);

const firstDay = new Date(2026,7,20,10,0,0);
const nextDay = new Date(2026,7,21,10,0,0);
context.inspectionLists = [
  {id:'CHECK-NAME-1',name:'ตรวจสินค้า: 1',items:[],createdAt:firstDay.toISOString()},
  {id:'CHECK-NAME-2',name:'ตรวจสินค้า: 2',items:[],createdAt:firstDay.toISOString()},
];
assert.equal(context.inspectionListDefaultName(firstDay), 'ตรวจสินค้า: 3');
assert.equal(context.inspectionListDefaultName(nextDay), 'ตรวจสินค้า: 1', 'วันใหม่ต้องเริ่มลำดับชื่อที่ 1');
assert.equal(context.inspectionListDateTime(new Date(2026,7,21,7,42,0).toISOString()), '21-08-2026 / 07:42');
context.inspectionLists = [];

const normalized = context.normalizeInspectionLists([
  {id:'CHECK-0002',name:' ชุดทดสอบ ',items:[{pid:1,unit:'กล่อง'},{pid:1,unit:'ลัง'},{pid:'bad'}],stockAdjustedAt:'2026-08-20T08:00:00.000Z',stockAdjustedBy:'เจ้าของร้าน'},
]);
assert.equal(normalized.length, 1);
assert.equal(normalized[0].name, 'ชุดทดสอบ');
assert.deepEqual(Array.from(normalized[0].items, item => ({pid:item.pid,unit:item.unit})), [{pid:1,unit:'กล่อง'}]);
assert.equal(normalized[0].stockAdjustedAt, '2026-08-20T08:00:00.000Z');
assert.equal(normalized[0].stockAdjustedBy, 'เจ้าของร้าน');

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

context.inspectionListDraft.items = [{pid:2,unit:'ขวด'},{pid:1,unit:'ลัง'}];
context.inspectionListSort = {key:'sku',dir:1};
assert.deepEqual(Array.from(context.inspectionListSortedEntries(), entry => entry.item.pid), [1,2]);
context.inspectionListSort = {key:'barcode',dir:-1};
assert.deepEqual(Array.from(context.inspectionListSortedEntries(), entry => entry.item.pid), [2,1]);
context.inspectionListSort = {key:'name',dir:1};
assert.deepEqual(Array.from(context.inspectionListSortedEntries(), entry => entry.item.pid), [1,2]);
context.inspectionListSort = {key:'stock',dir:-1};
assert.deepEqual(Array.from(context.inspectionListSortedEntries(), entry => entry.item.pid), [2,1]);
context.inspectionListCatFilter = {wh:'1',category:'',brand:''};
const warehousePage = context.inspectionListPagination(context.inspectionListDraft.items, 1, 7);
assert.deepEqual(Array.from(warehousePage.rows, entry => entry.item.pid), [2,1], 'เปลี่ยนคลังต้องยังเห็นสินค้าในแค็ตตาล็อกกลางครบและคงลำดับสต๊อกเดิม');
context.inspectionListCatFilter = {wh:'',category:'',brand:''};

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
assert.equal(context.inspectionLists[0].stockAdjustedAt, '');

context.inspectionLists[0].stockAdjustedAt = '2026-08-20T09:00:00.000Z';
const overviewHtml = context.renderInspectionListOverview();
assert.doesNotMatch(overviewHtml, /บันทึกชุดสินค้าไว้เปิดดูจำนวนคงเหลือล่าสุดได้ทุกครั้ง/);
assert.doesNotMatch(overviewHtml, /<h1>ตรวจสินค้า<\/h1>/);
assert.match(overviewHtml, /inspection-list-overview-head-actions form-final-actions/);
assert.match(html, /\.inspection-list-page\{min-width:0;\}/);
assert.doesNotMatch(html, /\.inspection-list-page\{width:100%;max-width:none;/);
assert.match(overviewHtml, /รายการตรวจหน้าร้าน/);
assert.match(overviewHtml, /data-open-inspection-list="CHECK-0001"/);
assert.match(overviewHtml, /บันทึกผลแล้ว/);
assert.match(overviewHtml, /inspection-list-overview-table/);
assert.match(overviewHtml, /id="inspectionListSelectAll"/);
assert.match(overviewHtml, /data-inspection-overview-sort="createdAt"/);
assert.match(overviewHtml, /data-inspection-overview-sort="updatedAt"/);
assert.match(overviewHtml, /data-inspection-overview-sort="status"/);
assert.match(overviewHtml, /class="inspection-list-overview-name"/);
assert.match(overviewHtml, /class="inspection-list-overview-actions"/);
assert.match(overviewHtml, /class="icon-btn"[^>]+data-open-inspection-list/);
assert.match(overviewHtml, /class="icon-btn danger"[^>]+data-delete-inspection-list/);
assert.ok(overviewHtml.indexOf('วันที่สร้าง') < overviewHtml.indexOf('แก้ไขล่าสุด'));
assert.ok(overviewHtml.indexOf('แก้ไขล่าสุด') < overviewHtml.indexOf('ชื่อรายการ'));
assert.ok(overviewHtml.indexOf('ชื่อรายการ') < overviewHtml.indexOf('>สินค้า<'));

products.push(
  {id:3,sku:'P-003',name:'สินค้าที่สาม',unit:'ชิ้น',stock:1,units:[]},
  {id:4,sku:'P-004',name:'สินค้าที่สี่',unit:'ชิ้น',stock:1,units:[]},
);
const productPreview = context.inspectionListPreviewHtml({items:[{pid:1},{pid:2},{pid:3},{pid:4}]});
assert.equal((productPreview.match(/doc-expandable-item-line/g)||[]).length, 3);
assert.match(productPreview, /\+1 รายการ/);
products.splice(-2);
context.editingInspectionListId = 'CHECK-0001';
context.inspectionListDraft = JSON.parse(JSON.stringify(context.inspectionLists[0]));
const ownerEditorHtml = context.renderInspectionListEditor();
assert.doesNotMatch(ownerEditorHtml, />ราคาขาย</);
assert.doesNotMatch(ownerEditorHtml, />ทุน</);
assert.doesNotMatch(ownerEditorHtml, />หน่วย</);
assert.match(ownerEditorHtml, /data-inspection-sort="sku"/);
assert.match(ownerEditorHtml, /data-inspection-sort="barcode"/);
assert.match(ownerEditorHtml, /data-inspection-sort="name"/);
assert.match(ownerEditorHtml, /data-inspection-sort="stock"/);
assert.match(ownerEditorHtml, /id="inspectionListWarehouse"/);
assert.ok(ownerEditorHtml.indexOf('id="inspectionListWarehouse"') < ownerEditorHtml.indexOf('id="inspectionListCategory"'));
assert.doesNotMatch(ownerEditorHtml, /inspection-list-stock-sub/);
assert.match(ownerEditorHtml, /2\.5 ลัง/);
context.loggedInUser = () => ({owner:false});
const staffEditorHtml = context.renderInspectionListEditor();
assert.doesNotMatch(staffEditorHtml, />ทุน</);

const completedList = context.inspectionLists[0];
const pendingList = {id:'CHECK-0002',name:'รายการที่ยังไม่แก้สต๊อก',items:[],createdAt:'2026-08-21T03:00:00.000Z',updatedAt:'2026-08-21T03:00:00.000Z',stockAdjustedAt:'',stockAdjustedBy:''};
context.inspectionLists = [completedList,pendingList];
context.mobileInspectionListId = completedList.id;
assert.deepEqual(Array.from(context.mobileInspectionVisibleLists(), list => list.id), ['CHECK-0002']);
assert.equal(context.mobileInspectionCurrentList().id, 'CHECK-0002', 'มือถือควรข้ามรายการที่แก้ไขจำนวนเรียบร้อยแล้ว');
context.inspectionListOverviewSort = {key:'createdAt',dir:-1};
assert.deepEqual(Array.from(context.inspectionListOverviewSortedLists(), list => list.id), ['CHECK-0002','CHECK-0001']);
context.inspectionListOverviewSort = {key:'status',dir:1};
assert.deepEqual(Array.from(context.inspectionListOverviewSortedLists(), list => list.id), ['CHECK-0002','CHECK-0001']);
context.inspectionListOverviewSelectedIds.add('CHECK-0001');
assert.match(context.renderInspectionListOverview(), /id="deleteSelectedInspectionListsBtn"/);
context.inspectionListOverviewSelectedIds.add('CHECK-0002');
context.confirm = () => true;
context.mobileInspectionListId = 'CHECK-0001';
context.mobileInspectionOpenedListId = 'CHECK-0001';
context.mobileStockSourceListId = 'CHECK-0002';
context.stockEditSourceInspectionListId = 'CHECK-0002';
context.stockEditSourcePending = true;
assert.equal(context.deleteSelectedInspectionLists(), true);
assert.equal(context.inspectionLists.length, 0);
assert.equal(context.inspectionListOverviewSelectedIds.size, 0);
assert.equal(context.mobileInspectionListId, '');
assert.equal(context.mobileInspectionOpenedListId, '');
assert.equal(context.mobileStockSourceListId, '');
assert.equal(context.stockEditSourceInspectionListId, null);
assert.equal(context.stockEditSourcePending, false);
context.inspectionLists = [completedList];

context.inspectionLists = [{...pendingList,items:[{pid:1,unit:'กล่อง'},{pid:2,unit:'ขวด'}]}];
context.mobileInspectionListId = pendingList.id;
context.mobileInspectionOpenedListId = pendingList.id;
context.mobileInspectionQuery = '';
context.mobileInspectionVisibleCount = 25;
context.mobileInspectionCheckedSet(pendingList.id).add(1);
context.mobileInspectionLastProductId = 1;
assert.match(context.mobileInspectionContentHtml(), /data-mobile-inspection-remove="1"/);
assert.equal(context.removeProductFromMobileInspection(pendingList.id,1), true);
assert.deepEqual(Array.from(context.inspectionLists[0].items,item=>item.pid),[2]);
assert.equal(context.mobileInspectionCheckedSet(pendingList.id).has(1),false);
assert.equal(context.mobileInspectionLastProductId,null);
assert.match(context.inspectionLists[0].updatedAt,/^\d{4}-\d{2}-\d{2}T/);

context.mobileInspectionAddingToSaved = true;
context.mobileInspectionSavedAddItems = [];
assert.equal(context.addProductToMobileInspectionSavedDraft(products[0],'ลัง'),true);
assert.deepEqual(Array.from(context.mobileInspectionSavedAddItems,item=>({pid:item.pid,unit:item.unit})),[{pid:1,unit:'ลัง'}]);
assert.equal(context.addProductToMobileInspectionSavedDraft(products[0],'กล่อง'),false,'สินค้าที่รอเพิ่มแล้วต้องไม่ซ้ำ');
assert.equal(context.addProductToMobileInspectionSavedDraft(products[1],'ขวด'),false,'สินค้าที่อยู่ในรายการเดิมต้องไม่ซ้ำ');

assert.match(html, /\['stockcontrol','ตรวจนับและปรับสต๊อก'/);
assert.match(html, /inspectionlists:\s*renderInspectionLists/);
assert.match(html, /from\('inspection_lists'\)\.select\('\*'\)/);
assert.match(html, /upsertAndPrune\('inspection_lists',inspectionLists,inspectionListToRow\)/);
assert.match(html, /await loadInspectionListsFromSupabase\(\)/);
assert.match(html, /data-inspection-list-page/);
assert.match(html, /INSPECTION_LIST_PAGE_SIZE = 10/);
assert.doesNotMatch(html, /!filter\.wh\|\|String\(product\.wh\)===String\(filter\.wh\)/);
assert.match(html, /warehouseStock\(product\.id,inspectionListDraft\?\.warehouseId/);
assert.match(html, /mobile-inspection-complete/);
assert.match(html, /แก้ไขจำนวนเรียบร้อย/);
assert.match(html, /data-inspection-list-select/);
assert.match(html, /inspectionListOverviewSelectedIds/);
assert.match(html, /function deleteSelectedInspectionLists\(/);
assert.match(html, /deleteSelectedInspectionListsBtn/);

context.inspectionLists = [completedList];
context.mobileInspectionListId = 'CHECK-0001';
context.mobileInspectionOpenedListId = 'CHECK-0001';
context.mobileStockSourceListId = 'CHECK-0001';
context.stockEditSourceInspectionListId = 'CHECK-0001';
context.stockEditSourcePending = true;
assert.equal(context.deleteInspectionListById('CHECK-0001'), true);
assert.equal(context.inspectionLists.length, 0);
assert.equal(context.mobileInspectionListId, '');
assert.equal(context.mobileInspectionOpenedListId, '');
assert.equal(context.mobileStockSourceListId, '');
assert.equal(context.stockEditSourceInspectionListId, null);
assert.equal(context.stockEditSourcePending, false);
assert.equal(persistCount, 4);
assert.equal(syncCount, 4);

console.log('inspection list tests passed');
