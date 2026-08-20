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

assert.deepEqual(
  JSON.parse(JSON.stringify(context.goodsReceiptStatusChangePlan(newPending, 'รับสินค้าแล้ว'))),
  {allowed:true,status:'รับสินค้าแล้ว',stockDirection:1,stockApplied:true}
);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'รับสินค้าแล้ว').stockDirection, 0);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'รอรับสินค้า').stockDirection, -1);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:true}, 'ชำระเรียบร้อย').stockDirection, 0);
assert.equal(context.goodsReceiptStatusChangePlan({stockApplied:false}, 'ชำระเรียบร้อย').allowed, false);
assert.equal(context.documentDeletionStockDirection('gr', {stockApplied:false}), 0);
assert.equal(context.documentDeletionStockDirection('gr', {stockApplied:true,status:'รับสินค้าแล้ว'}), 0);
assert.equal(context.documentDeletionStockDirection('gr', {stockApplied:true,status:'ชำระเรียบร้อย'}), 0);
assert.equal(context.documentDeletionStockDirection('ret', {stockApplied:true}), 1);

let stockDirection = 0;
let renderCount = 0;
let toast = '';
Object.assign(context, {
  goodsReceipts: [{id:'RI-TEST',status:'รอรับสินค้า',stockApplied:false,items:[{productId:1,qty:5}]}],
  adjustGoodsReceiptStock: (_items, direction) => { stockDirection += direction; },
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
assert.match(html, /kind==='gr'\?\{stockApplied:old\?\.stockApplied===true/);
assert.doesNotMatch(html, /if\(kind==='gr'\)\{ grCounter\+\+; adjustGoodsReceiptStock\(savedItems,1\); \}/);
assert.match(html, /copy\.status='รอรับสินค้า';[\s\S]{0,100}copy\.stockApplied=false/);
const bulkDeleteStart = html.indexOf('function deleteSelectedDocuments(');
const bulkDeleteEnd = html.indexOf('function printSelectedDocuments(', bulkDeleteStart);
const singleDeleteStart = html.indexOf("if(action==='delete')", html.indexOf('function handleDocumentAction('));
const singleDeleteEnd = html.indexOf('function setupA4DocumentPreview(', singleDeleteStart);
assert.doesNotMatch(html.slice(bulkDeleteStart, bulkDeleteEnd), /kind==='gr'[\s\S]{0,100}adjustGoodsReceiptStock/);
assert.doesNotMatch(html.slice(singleDeleteStart, singleDeleteEnd), /kind==='gr'[\s\S]{0,100}adjustGoodsReceiptStock/);
assert.doesNotMatch(html.slice(bulkDeleteStart, bulkDeleteEnd), /สต๊อกที่รับเข้าจากรายการเหล่านี้จะถูกนำออกด้วย/);
assert.doesNotMatch(html.slice(singleDeleteStart, singleDeleteEnd), /สต๊อกที่รับเข้าจากเอกสารนี้จะถูกนำออกด้วย/);

console.log('goods receipt status tests passed');
