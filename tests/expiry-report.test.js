const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function expiryReportRowMatches(');
const end = html.indexOf('function expiryReportConditionLabel(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบ logic กรองสถานะวันหมดอายุ');

const remainingDays = {expired:-5,today:0,soon:20,later:120,missing:Number.POSITIVE_INFINITY};
const context = {
  lowStockPageFilter:{expiryMode:'all',expiryDays:90},
  daysUntil:value=>remainingDays[value],
};
vm.createContext(context);
vm.runInContext(html.slice(start,end), context);

assert.equal(context.expiryReportRowMatches({expiry:'expired'},'expired',90),true);
assert.equal(context.expiryReportRowMatches({expiry:'today'},'expired',90),false);
assert.equal(context.expiryReportRowMatches({expiry:'soon'},'near',30),true);
assert.equal(context.expiryReportRowMatches({expiry:'expired'},'near',30),false);
assert.equal(context.expiryReportRowMatches({expiry:'later'},'near',90),false);
assert.equal(context.expiryReportRowMatches({expiry:'expired'},'all',90),true);
assert.equal(context.expiryReportRowMatches({expiry:'missing'},'all',90),false);

const reportStart = html.indexOf('function expiryReportWarehouseIds(');
const reportEnd = html.indexOf('function lowSortedList(', reportStart);
assert.ok(reportStart >= 0 && reportEnd > reportStart, 'ไม่พบ logic สร้างรายงานวันหมดอายุตาม LOT');
const reportContext = {
  lowStockPageFilter:{expiryWarehouse:'all',expiryMode:'all',expiryDays:90},
  activeWarehouseId:1,
  products:[{id:1,sku:'P1',name:'ยา A',unit:'กล่อง',units:[]},{id:2,sku:'P2',name:'ยา B',unit:'ขวด',units:[]}],
  warehouses:[{id:1,name:'สำนักงานใหญ่'},{id:2,name:'สาขา'}],
  inventoryLotRows:[
    {id:11,product_id:1,warehouse_id:1,manufacturer_lot:'LOT-A',expiry_date:'soon',quantity_base:4,status:'active'},
    {id:12,product_id:1,warehouse_id:1,manufacturer_lot:'LOT-A',expiry_date:'soon',quantity_base:6,status:'active'},
    {id:13,product_id:1,warehouse_id:2,manufacturer_lot:'LOT-B',expiry_date:'expired',quantity_base:3,status:'blocked'},
  ],
  inventoryBalanceRows:[{product_id:2,warehouse_id:1,stock:7,expiry:'soon'}],
  reportWarehouseIds:()=>[1,2],
  isAllWarehousesMode:()=>false,
  inventoryBalanceKey:(productId,warehouseId)=>`${warehouseId}:${productId}`,
  groupInventoryLotDetailRows:rows=>{
    const groups = new Map();
    rows.forEach(row=>{
      const key=`${row.manufacturer_lot}|${row.expiry_date}|${row.status}`;
      if(!groups.has(key)) groups.set(key,{rows:[],manufacturerLot:row.manufacturer_lot,expiryDate:row.expiry_date,quantityBase:0});
      const group=groups.get(key); group.rows.push(row); group.quantityBase+=row.quantity_base;
    });
    return [...groups.values()];
  },
  lotQuantityText:(product,lot)=>`${lot.quantity_base} ${product.unit}`,
  daysUntil:value=>remainingDays[value],
};
vm.createContext(reportContext);
vm.runInContext(html.slice(reportStart,reportEnd), reportContext);
const lotRows=reportContext.expiryReportLotRows();
assert.equal(lotRows.length,3, 'ต้องมี LOT ที่รวมแล้ว 2 รายการและข้อมูลเดิมอีก 1 รายการ');
assert.equal(lotRows.find(row=>row.lotNumber==='LOT-A').quantityBase,10, 'LOT ผู้ผลิตเดียวกันและวันหมดอายุเดียวกันต้องรวมจำนวน');
assert.equal(lotRows.find(row=>row.lotNumber==='LOT-B').warehouseName,'สาขา');
assert.equal(lotRows.find(row=>row.legacy).quantityText,'7 ขวด', 'สินค้าที่ไม่มี LOT ต้องยังแสดงจากยอดเดิม');

assert.match(html, /สินค้าใกล้หมดอายุ/);
assert.doesNotMatch(html, /สินค้าใกล้หมดอายุ \/ หมดอายุ/);
assert.match(html, /function expiryReportLotRows\(\)/);
assert.match(html, /groupInventoryLotDetailRows\(lotRows\)/, 'รายงานต้องรวมรายการรับเข้าที่เป็น LOT ผู้ผลิตเดียวกัน');
assert.match(html, /id="expiryWarehouseFilter"/, 'หน้ารายงานต้องเลือกคลังได้');
assert.match(html, /data-expiry-summary-mode="expired"/, 'ก้อนสรุปหมดอายุแล้วต้องกดกรองตารางได้');
assert.match(html, /data-expiry-summary-mode="near"/, 'ก้อนสรุปใกล้วันหมดอายุต้องกดกรองตารางได้');
assert.match(html, /id="expiryDaysInput"/, 'ต้องพิมพ์ระยะวันก่อนหมดอายุเองได้');
assert.match(html, /\.expiry-summary-card\{min-height:84px;/, 'ก้อนใกล้วันหมดอายุและหมดอายุแล้วต้องมีขนาดใหญ่เท่าหน้าสินค้าใกล้หมด');
assert.match(html, /\.expiry-summary-card span\{[^}]*font-size:14px;font-weight:700;/, 'ชื่อสถานะบนก้อนสรุปต้องแสดงตัวใหญ่และชัดเจน');
assert.match(html, /EXPIRY_DAYS_FILTER_STORAGE_KEY/, 'ต้องจำระยะวันก่อนหมดอายุไว้ในอุปกรณ์');
assert.doesNotMatch(html, /data-expiry-n=/, 'ต้องไม่มีปุ่มช่วงวันซ้ำด้านล่าง');
assert.doesNotMatch(html, /class="expiry-report-controls"/, 'ต้องไม่มีแถบตัวกรองซ้ำด้านล่าง');
assert.match(html, /querySelectorAll\('\[data-expiry-summary-mode\]'\)/, 'ต้องผูกการทำงานให้ก้อนสรุปวันหมดอายุ');
assert.match(html, /lowTh\('expiry','lot','เลข LOT'\)/);
assert.match(html, /lowTh\('expiry','quantity','คงเหลือ',true\)/);
assert.match(html, /data-product-lots="\$\{row\.productId\}"/, 'แต่ละแถวต้องเปิดดูรายละเอียด LOT ได้');
assert.match(html, /<th>เลข LOT<\/th><th class="c">คงเหลือ<\/th>/, 'รายงานพิมพ์ต้องแสดง LOT และจำนวนคงเหลือ');

console.log('expiry report tests passed');
