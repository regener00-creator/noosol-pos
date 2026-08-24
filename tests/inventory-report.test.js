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
assert.match(html, /stockReportTh\('expiry','วันหมดอายุ',true\)}<th>คลังสินค้า<\/th>/);
assert.match(html, /<th class="r">วันหมดอายุ<\/th><th class="c">คลังสินค้า<\/th>/);
assert.match(html, /stockReportItems\.unshift\(\{pid:p\.id, name:p\.name, stock:warehouseStock\(p\.id,warehouseId\), unit:p\.unit, expiry:warehouseExpiry\(p\.id,warehouseId\), wh:warehouseId\}\)/);

console.log('inventory report tests passed');
