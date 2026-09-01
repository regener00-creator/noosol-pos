const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();
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
assert.match(html, /function stockReportSelectedItemsHtml\(\)/, 'ต้องมีตัวสร้างกล่องสินค้าที่เลือก');
assert.match(html, /สินค้าที่เลือก \$\{stockReportItems\.length\} รายการ/, 'กล่องต้องแสดงจำนวนสินค้าที่เลือก');
assert.match(html, /class="stock-report-selected-list"/, 'รายการสินค้าที่เลือกต้องอยู่ในพื้นที่เลื่อนภายใน');
assert.match(html, /data-sr-chip-remove="\$\{row\.pid\}"/, 'สินค้าแต่ละรายการต้องลบออกจากตัวกรองได้');
assert.match(html, /id="srClearSelected">ล้างทั้งหมด<\/button>/, 'ต้องมีปุ่มล้างสินค้าที่เลือกทั้งหมด');
assert.match(html, /id="stockReportSelectedWrap">\$\{stockReportSelectedItemsHtml\(\)\}/, 'กล่องสินค้าที่เลือกต้องแสดงในหน้ารายงานสินค้าคงเหลือ');
assert.match(html, /srSelectedWrap\.innerHTML=stockReportSelectedItemsHtml\(\)/, 'กล่องสินค้าที่เลือกต้องอัปเดตพร้อมตาราง');
const renderStart = html.indexOf('function renderRInventory(');
const rowsStart = html.indexOf('function stockReportRowsHtml(', renderStart);
const rowsEnd = html.indexOf('function renderRReceivable(', rowsStart);
const printStart = html.indexOf('function printStockReport(');
const printEnd = html.indexOf('function openPostPaymentModal(', printStart);
assert.ok(renderStart >= 0 && rowsStart > renderStart && rowsEnd > rowsStart && printStart >= 0 && printEnd > printStart);
assert.doesNotMatch(html.slice(renderStart, rowsEnd), /<th>คลังสินค้า<\/th>/, 'ตารางหน้าจอต้องไม่มีคอลัมน์คลังสินค้า');
assert.doesNotMatch(html.slice(printStart, printEnd), /<th class="c">คลังสินค้า<\/th>/, 'ตารางฉบับพิมพ์ต้องไม่มีคอลัมน์คลังสินค้า');
assert.doesNotMatch(html.slice(renderStart, rowsEnd), /stockReportTh\('expiry','วันหมดอายุ'/, 'ตารางหน้าจอต้องไม่มีคอลัมน์วันหมดอายุ');
assert.doesNotMatch(html.slice(printStart, printEnd), />วันหมดอายุ<\/th>/, 'ตารางฉบับพิมพ์ต้องไม่มีคอลัมน์วันหมดอายุ');
assert.match(html.slice(renderStart, rowsStart), /warehouseHeaders=selectedWarehouseValue==='all'/, 'หน้าจอโหมดทุกคลังต้องสร้างหัวคอลัมน์แยกตามคลัง');
assert.match(html.slice(renderStart, rowsStart), /คลังที่ \$\{index\+1\}/, 'หัวคอลัมน์ทุกคลังต้องเรียงเป็นคลังที่ 1, คลังที่ 2');
assert.match(html.slice(rowsStart, rowsEnd), /warehouseStock\(row\.pid,warehouse\.id\)/, 'แถวโหมดทุกคลังต้องแสดงยอดของแต่ละคลัง');
assert.match(html.slice(printStart, printEnd), /stockHeaders=selectedWarehouseValue==='all'/, 'ฉบับพิมพ์ต้องสร้างหัวคอลัมน์แยกตามคลัง');
assert.doesNotMatch(html.slice(printStart, printEnd), /<th[^>]*>#<\/th>/, 'ฉบับพิมพ์ต้องไม่มีคอลัมน์ลำดับ');
assert.match(html.slice(printStart, printEnd), /คลัง \$\{index\+1\} : \$\{escapeHtml\(warehouse\.name\)\}/, 'ฉบับพิมพ์ทุกคลังต้องแจกแจงชื่อคลังตามลำดับ');
assert.match(html.slice(printStart, printEnd), /<div class="warehouse">\$\{warehouseSummary\}<\/div>/, 'ฉบับพิมพ์ต้องแสดงสรุปคลังใต้ชื่อรายงาน');
assert.match(html, /stockReportItems\.unshift\(\{pid:p\.id, name:p\.name, stock:reportStock\(p\.id,warehouseValue\), unit:p\.unit, expiry:reportExpiry\(p\.id,warehouseValue\), wh:warehouseValue\}\)/);
assert.match(html, /stockReportWarehouseBreakdownHtml/);
assert.doesNotMatch(html.slice(rowsStart, rowsEnd), /stockReportExpiryBreakdownHtml/, 'แถวรายงานต้องไม่แสดงวันหมดอายุ');

const rowContext = {
  stockReportItems:[{pid:1,name:'สินค้าทดสอบ',unit:'กล่อง',wh:'all'}],
  stockReportCatFilter:{wh:'all'},
  activeWarehouseId:1,
  products:[{id:1,name:'สินค้าทดสอบ',unit:'กล่อง'}],
  isAllWarehousesMode:()=>true,
  accessibleWarehouses:()=>[{id:1,name:'พระยาสุเรนทร์'},{id:2,name:'พรชัย'}],
  stockReportSortedItems:()=>rowContext.stockReportItems,
  warehouseStock:(productId,warehouseId)=>warehouseId===1?12:34,
  stockInLargestUnit:product=>`${product.stock} ${product.unit}`,
  reportStock:()=>46,
  escapeHtml:value=>String(value)
};
vm.createContext(rowContext);
vm.runInContext(html.slice(rowsStart, rowsEnd), rowContext);
const allWarehouseRows = rowContext.stockReportRowsHtml();
assert.match(allWarehouseRows, />12 กล่อง<\/td>/, 'โหมดทุกคลังต้องแสดงยอดคลังที่ 1');
assert.match(allWarehouseRows, />34 กล่อง<\/td>/, 'โหมดทุกคลังต้องแสดงยอดคลังที่ 2');
assert.doesNotMatch(allWarehouseRows, />46 กล่อง<\/td>/, 'โหมดทุกคลังต้องไม่รวมยอดทุกคลังเป็นช่องเดียว');

console.log('inventory report tests passed');
