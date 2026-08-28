const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = {};
vm.createContext(context);

const helperStart = html.indexOf('function stockReportProductMatchesFilter(');
const helperEnd = html.indexOf('function renderRInventory(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'ไม่พบ logic กรองคลังในรายงานสินค้าคงเหลือ');
vm.runInContext(html.slice(helperStart, helperEnd), context);

const product = {id:1,wh:2,category:'ยา',brand:'BIOPHARM'};
assert.equal(context.stockReportProductMatchesFilter(product,{wh:'',category:'',brand:''}), true);
assert.equal(context.stockReportProductMatchesFilter(product,{wh:'2',category:'',brand:''}), true);
assert.equal(context.stockReportProductMatchesFilter(product,{wh:'1',category:'',brand:''}), true, 'ตัวกรองคลังต้องเลือกยอดคงเหลือ ไม่ใช่ตัดสินค้าออกจากแค็ตตาล็อก');
assert.equal(context.stockReportProductMatchesFilter(product,{wh:'2',category:'ยา',brand:'BIOPHARM'}), true);
assert.equal(context.stockReportProductMatchesFilter(product,{wh:'2',category:'อาหารเสริม',brand:''}), false);

assert.match(html, /id="srWarehouseSelect"/);
assert.match(html, />ทุกคลัง<\/option>/);
const renderStart = html.indexOf('function renderRInventory(');
const rowsStart = html.indexOf('function stockReportRowsHtml(', renderStart);
const rowsEnd = html.indexOf('function renderRReceivable(', rowsStart);
const printStart = html.indexOf('function printStockReport(');
const printEnd = html.indexOf('function openPostPaymentModal(', printStart);
assert.ok(renderStart >= 0 && rowsStart > renderStart && rowsEnd > rowsStart && printStart >= 0 && printEnd > printStart);
assert.doesNotMatch(html.slice(renderStart, rowsEnd), /<th>คลังสินค้า<\/th>/, 'ตารางหน้าจอต้องไม่มีคอลัมน์คลังสินค้า');
assert.doesNotMatch(html.slice(printStart, printEnd), /<th class="c">คลังสินค้า<\/th>/, 'ตารางฉบับพิมพ์ต้องไม่มีคอลัมน์คลังสินค้า');
assert.match(html.slice(printStart, printEnd), /<h1>รายงานสินค้าคงเหลือ<\/h1>\s*<div class="warehouse">คลัง : \$\{escapeHtml\(selectedWarehouseName\)\}<\/div>/, 'ฉบับพิมพ์ต้องแสดงคลังที่เลือกใต้ชื่อรายงาน');
assert.match(html, /stockReportItems\.unshift\(\{pid:p\.id, name:p\.name, stock:reportStock\(p\.id,warehouseValue\), unit:p\.unit, expiry:reportExpiry\(p\.id,warehouseValue\), wh:warehouseValue\}\)/);
assert.match(html, /stockReportWarehouseBreakdownHtml/);
assert.match(html, /stockReportExpiryBreakdownHtml/);

console.log('inventory report tests passed');
