const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = {};
vm.createContext(context);

const helpersStart = html.indexOf("const GOODS_RECEIPT_STATUSES=");
const helpersEnd = html.indexOf('function currentDocKind(', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'ไม่พบ logic สถานะใบรับสินค้า');
vm.runInContext(html.slice(helpersStart, helpersEnd), context);

const legacyPending = context.normalizeGoodsReceiptDocument({id:'RI-OLD',status:'รอรับสินค้า',date:'2026-08-01'});
assert.equal(legacyPending.status, 'รับสินค้าแล้ว');
assert.equal(legacyPending.stockApplied, true);
assert.equal(legacyPending.stockAppliedAt, '2026-08-01');

const newPending = context.normalizeGoodsReceiptDocument({id:'RI-NEW',status:'รอรับสินค้า',stockApplied:false});
assert.equal(newPending.status, 'รอรับสินค้า');
assert.equal(newPending.stockApplied, false);

const legacyPaid = context.normalizeGoodsReceiptDocument({id:'RI-PAID',status:'ชำระเรียบร้อย'});
assert.equal(legacyPaid.status, 'ชำระเรียบร้อย');
assert.equal(legacyPaid.stockApplied, true);

const warehouseRows=[{id:1,name:'สำนักงานใหญ่'},{id:2,name:'สาขา 2'}];
const productRows=[{id:10,name:'ยา A',wh:1},{id:20,name:'ยา B',wh:2}];
assert.equal(context.goodsReceiptWarehouseId({warehouseId:2},warehouseRows,productRows),2);
assert.equal(context.goodsReceiptWarehouseId({items:[{productId:10}]},warehouseRows,productRows),1);
assert.equal(context.goodsReceiptWarehouseId({items:[{warehouseId:2}]},warehouseRows,productRows),2);
assert.equal(context.goodsReceiptItemsMatchWarehouse({warehouseId:2,items:[{productId:20}]},warehouseRows,productRows),true);
assert.equal(context.goodsReceiptItemsMatchWarehouse({warehouseId:2,items:[{productId:10}]},warehouseRows,productRows),true, 'คลังต่างกันต้องยังค้นและรับสินค้าในแค็ตตาล็อกกลางได้');

const normalizeItemsStart = html.indexOf('function poPurchaseUnitOptions(');
const normalizeItemsEnd = html.indexOf('function adjustGoodsReceiptStock(', normalizeItemsStart);
assert.ok(normalizeItemsStart >= 0 && normalizeItemsEnd > normalizeItemsStart, 'ไม่พบ logic ผูกสาขากับรายการรับสินค้า');
Object.assign(context, {products:[{id:10,name:'ยา A',wh:1,unit:'กล่อง',cost:10,units:[]}]});
vm.runInContext(html.slice(normalizeItemsStart, normalizeItemsEnd), context);
const normalizedForBranch = context.normalizeGoodsReceiptItems([{productId:10,name:'ยา A',qty:1,unit:'กล่อง'}], 2)[0];
assert.equal(normalizedForBranch.productId, 10);
assert.equal(normalizedForBranch.warehouseId, 2, 'รายการรับสินค้าต้องผูกกับสาขาที่เลือก ไม่ใช่สาขาเดิมของสินค้า');

assert.deepEqual(
  JSON.parse(JSON.stringify(context.goodsReceiptStatusChangePlan(newPending, 'รับสินค้าแล้ว'))),
  {allowed:true,status:'รับสินค้าแล้ว',stockDirection:1,stockApplied:true}
);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'รับสินค้าแล้ว').stockDirection, 0);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'รอรับสินค้า').stockDirection, -1);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'ชำระเรียบร้อย').stockDirection, 0);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:false}, 'ชำระเรียบร้อย').allowed, false);
let stockDirection = 0;
let renderCount = 0;
let toast = '';
Object.assign(context, {
  warehouses: warehouseRows,
  products: productRows,
  goodsReceipts: [{id:'RI-TEST',warehouseId:1,status:'รอรับสินค้า',stockApplied:false,items:[{productId:10,qty:5}]}],
  adjustGoodsReceiptStock: (_items, direction) => { stockDirection += direction; },
  persistWorkspaceData: () => {},
  render: () => { renderCount++; },
  showToast: message => { toast = message; },
});
const changeStart = html.indexOf('function changeGoodsReceiptStatus(');
const changeEnd = html.indexOf('function changeProductReturnStatus(', changeStart);
assert.ok(changeStart >= 0 && changeEnd > changeStart, 'ไม่พบฟังก์ชันเปลี่ยนสถานะใบรับสินค้า');
vm.runInContext(html.slice(changeStart, changeEnd), context);

context.changeGoodsReceiptStatus('RI-TEST', 'รับสินค้าแล้ว');
assert.equal(stockDirection, 1);
assert.equal(context.goodsReceipts[0].status, 'รับสินค้าแล้ว');
assert.equal(context.goodsReceipts[0].stockApplied, true);
assert.match(context.goodsReceipts[0].stockAppliedAt, /^\d{4}-\d{2}-\d{2}T/);

context.changeGoodsReceiptStatus('RI-TEST', 'รับสินค้าแล้ว');
assert.equal(stockDirection, 1, 'เลือกสถานะรับสินค้าแล้วซ้ำต้องไม่บวกสต๊อกซ้ำ');

context.changeGoodsReceiptStatus('RI-TEST', 'รอรับสินค้า');
assert.equal(stockDirection, 0, 'ย้อนเป็นรอรับสินค้าต้องนำสต๊อกที่เคยรับออก');
assert.equal(context.goodsReceipts[0].stockApplied, false);

context.changeGoodsReceiptStatus('RI-TEST', 'ชำระเรียบร้อย');
assert.equal(stockDirection, 0);
assert.equal(context.goodsReceipts[0].status, 'รอรับสินค้า');
assert.match(toast, /รับสินค้าแล้ว/);
assert.equal(renderCount, 4);

assert.match(html, /<option value="รอรับสินค้า"/);
assert.match(html, /<option value="รับสินค้าแล้ว"/);
assert.match(html, /<option value="ชำระเรียบร้อย"/);
assert.match(html, /id="po_warehouse"/);
assert.match(html, /<th>รายการ<\/th><th>สาขา<\/th>/);
assert.match(html, /kind==='gr'\?\{warehouseId:Number\(draft\.warehouseId\),stockApplied:old\?\.stockApplied===true/);
assert.doesNotMatch(html, /currentTab==='goodsreceipt'[\s\S]{0,180}products\.filter\(product=>Number\(product\.wh\)===warehouseId\)/);
assert.match(html, /data-product-id="\$\{product\?\.id\|\|it\.productId\|\|''\}"/);
assert.doesNotMatch(html, /plan\.stockDirection>0&&!goodsReceiptItemsMatchWarehouse\(doc\)/);
assert.match(html, /normalizeGoodsReceiptItems\(items,kind==='gr'\?draft\.warehouseId:0\)/);
assert.doesNotMatch(html, /if\(kind==='gr'\)\{ grCounter\+\+; adjustGoodsReceiptStock\(savedItems,1\); \}/);
assert.match(html, /copy\.status='รอรับสินค้า';[\s\S]{0,100}copy\.stockApplied=false/);
const bulkDeleteStart = html.indexOf('function deleteSelectedDocuments(');
const bulkDeleteEnd = html.indexOf('function printSelectedDocuments(', bulkDeleteStart);
const singleDeleteStart = html.indexOf("if(action==='delete')", html.indexOf('function handleDocumentAction('));
const singleDeleteEnd = html.indexOf('function setupA4DocumentPreview(', singleDeleteStart);
assert.doesNotMatch(html.slice(bulkDeleteStart, bulkDeleteEnd), /adjustGoodsReceiptStock/);
assert.doesNotMatch(html.slice(singleDeleteStart, singleDeleteEnd), /adjustGoodsReceiptStock/);
assert.doesNotMatch(html.slice(bulkDeleteStart, bulkDeleteEnd), /สต๊อกที่รับเข้าจากรายการเหล่านี้จะถูกนำออกด้วย/);
assert.doesNotMatch(html.slice(singleDeleteStart, singleDeleteEnd), /สต๊อกที่รับเข้าจากเอกสารนี้จะถูกนำออกด้วย/);
assert.doesNotMatch(html.slice(bulkDeleteStart, bulkDeleteEnd), /สต๊อกที่เคยตัดจากรายการเหล่านี้จะถูกคืนกลับด้วย/);
assert.doesNotMatch(html.slice(singleDeleteStart, singleDeleteEnd), /สต๊อกที่เคยตัดจากใบคืนสินค้านี้จะถูกคืนกลับด้วย/);

console.log('goods receipt status tests passed');
