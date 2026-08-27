const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function lowStockReportWarehouseIds(');
const end = html.indexOf('function expiryReportWarehouseIds(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบ logic รายงานสินค้าใกล้หมด');

const products = [
  {id:1,sku:'P1',name:'ยาใกล้หมด',unit:'กล่อง',stock:3,threshold:5,type:'stock'},
  {id:2,sku:'P2',name:'ยาหมด',unit:'ขวด',stock:0,threshold:2,type:'stock'},
  {id:3,sku:'P3',name:'ยาติดลบ',unit:'แผง',stock:-1,threshold:4,type:'stock'},
  {id:4,sku:'S1',name:'บริการ',unit:'ครั้ง',stock:0,threshold:5,type:'service'},
];
const inventoryBalanceMap = new Map([
  ['1:1',{stock:3}],['1:2',{stock:0}],['1:3',{stock:-1}],
  ['2:1',{stock:10}],['2:2',{stock:1}],['2:3',{stock:0}],
]);
const context = {
  lowStockPageFilter:{stockWarehouse:'all',stockMode:'low'},
  activeWarehouseId:1,
  products,
  warehouses:[{id:1,name:'สำนักงานใหญ่'},{id:2,name:'สาขา'}],
  inventoryBalanceMap,
  reportWarehouseIds:()=>[1,2],
  isAllWarehousesMode:()=>false,
  inventoryBalanceKey:(productId,warehouseId)=>`${warehouseId}:${productId}`,
  effectiveThreshold:product=>product.threshold ?? 5,
};
vm.createContext(context);
vm.runInContext(html.slice(start,end), context);

const rows = context.lowStockReportRows();
assert.equal(rows.length,6,'ต้องสร้างแถวสินค้า 3 ตัวแยกตาม 2 คลัง และไม่รวมบริการ');
assert.equal(rows.find(row=>row.key==='1:1').shortage,2,'ต้องคำนวณจำนวนที่ขาดจากจุดสั่งซื้อขั้นต่ำ');
assert.equal(rows.find(row=>row.key==='2:1').shortage,0,'สินค้าที่เกินขั้นต่ำต้องไม่ติดจำนวนขาด');
assert.equal(rows.filter(row=>context.lowStockRowMatches(row,'low')).length,2,'ใกล้หมดต้องนับเฉพาะสต๊อกบวกที่ไม่เกินขั้นต่ำ');
assert.equal(rows.filter(row=>context.lowStockRowMatches(row,'out')).length,2,'สินค้าหมดต้องแยกจากสินค้าใกล้หมด');
assert.equal(rows.filter(row=>context.lowStockRowMatches(row,'negative')).length,1,'สต๊อกติดลบต้องแยกจากสินค้าหมด');
assert.equal(context.lowStockReportConditionLabel(),'สินค้าที่คงเหลือไม่เกินจุดสั่งซื้อขั้นต่ำของสินค้าแต่ละตัว');

assert.match(html,/id="lowStockWarehouseFilter"/,'หน้าสินค้าใกล้หมดต้องเลือกคลังได้');
assert.match(html,/data-lowstock-mode="low"/);
assert.match(html,/data-lowstock-mode="out"/);
assert.match(html,/data-lowstock-mode="negative"/);
assert.match(html,/data-lowstock-threshold="\$\{row\.productId\}"/,'ต้องแก้จุดสั่งซื้อขั้นต่ำรายสินค้าได้');
assert.match(html,/id="createLowStockOrderBtn"/,'ต้องสร้างรายการสั่งของขาดจากสินค้าที่เลือกได้');
assert.match(html,/function openLowStockShortageDraft\(\)/);
assert.match(html,/lowStockReportConditionLabel\(\)/,'รายงานพิมพ์ต้องใช้สถานะเดียวกับหน้าจอ');

console.log('low stock report tests passed');
