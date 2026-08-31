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
const normalizedLot = context.normalizeGoodsReceiptItems([{productId:10,name:'ยา A',qty:1,unit:'กล่อง',lotNumber:'A001',expiry:'2027-07-05'}], 2)[0];
assert.equal(normalizedLot.lotNumber, 'A001');
assert.equal(normalizedLot.expiry, '2027-07-05');
assert.ok(normalizedLot.lineId, 'รายการรับสินค้าต้องมี lineId เพื่อป้องกันการสร้าง Lot ซ้ำ');

assert.deepEqual(
  JSON.parse(JSON.stringify(context.goodsReceiptStatusChangePlan(newPending, 'รับสินค้าแล้ว'))),
  {allowed:true,status:'รับสินค้าแล้ว',stockDirection:1,stockApplied:true}
);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'รับสินค้าแล้ว').stockDirection, 0);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'รอรับสินค้า').stockDirection, 0);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'รอรับสินค้า').allowed, false, 'รับเข้าสต๊อกแล้วต้องห้ามย้อนสถานะเพื่อไม่ให้ Lot เพี้ยน');
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'ชำระเรียบร้อย').stockDirection, 0);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:false}, 'ชำระเรียบร้อย').allowed, false);
assert.match(html, /sb\.rpc\('apply_goods_receipt_lots'/);
assert.match(html, /loadInventoryLotsFromSupabase\(\)/);

assert.match(html, /<option value="รอรับสินค้า"/);
assert.match(html, /<option value="รับสินค้าแล้ว"/);
assert.match(html, /<option value="ชำระเรียบร้อย"/);
assert.match(html, /id="po_warehouse"/);
assert.match(html, /<th>รายการ<\/th><th>สาขา<\/th>/);
assert.match(html, /kind==='gr'\?\{warehouseId:Number\(draft\.warehouseId\),stockApplied:old\?\.stockApplied===true/);
assert.doesNotMatch(html, /currentTab==='goodsreceipt'[\s\S]{0,180}products\.filter\(product=>Number\(product\.wh\)===warehouseId\)/);
assert.match(html, /data-product-id="\$\{escapeHtml\(product\?\.id\|\|it\.productId\|\|''\)\}"/);
assert.doesNotMatch(html, /plan\.stockDirection>0&&!goodsReceiptItemsMatchWarehouse\(doc\)/);
assert.match(html, /normalizeGoodsReceiptItems\(items,draft\.warehouseId\)/);
assert.doesNotMatch(html, /if\(kind==='gr'\)\{ grCounter\+\+; adjustGoodsReceiptStock\(savedItems,1\); \}/);
assert.match(html, /if\(action==='duplicate'&&kind!=='gr'\)/, 'ใบรับสินค้าไม่ควรเข้าทางสร้างซ้ำที่ไม่มี UI');
assert.match(html, /editingId==='new'[\s\S]{0,120}from\('goods_receipts'\)\.insert\(row\)/, 'ใบใหม่ต้อง insert เพื่อไม่ทับเลขที่ชนกันจากหลายเครื่อง');
assert.match(html, /from\('goods_receipts'\)\.update\(\{data:row\.data\}\)\.eq\('id',row\.id\)/, 'เอกสารเก่าต้อง update เฉพาะ id เดิม');
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
