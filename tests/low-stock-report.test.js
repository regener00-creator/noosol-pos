const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function lowStockReportWarehouseIds(');
const end = html.indexOf('function expiryReportWarehouseIds(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบ logic รายงานสินค้าใกล้หมด');

const products = [
  {id:1,sku:'P1',name:'ยาหลายหน่วย',unit:'เม็ด',stock:30,units:[{sub:'กล่อง',factor:10},{sub:'ลัง',factor:100}],type:'stock'},
  {id:2,sku:'P2',name:'ยาหมด',unit:'ขวด',stock:0,units:[],type:'stock'},
  {id:3,sku:'S1',name:'บริการ',unit:'ครั้ง',stock:0,units:[],type:'service'},
];
const inventoryBalanceMap = new Map([
  ['1:1',{stock:30}],['1:2',{stock:0}],
  ['2:1',{stock:120}],['2:2',{stock:4}],
]);
const context = {
  lowStockPageFilter:{stockWarehouse:'all',stockThreshold:50},
  lowStockUnitSelection:{},
  activeWarehouseId:1,
  products,
  warehouses:[{id:1,name:'สำนักงานใหญ่'},{id:2,name:'สาขา'}],
  inventoryBalanceMap,
  reportWarehouseIds:()=>[1,2],
  isAllWarehousesMode:()=>false,
  inventoryBalanceKey:(productId,warehouseId)=>`${warehouseId}:${productId}`,
  productUnitOptions:product=>[
    {name:product.unit,factor:1},
    ...(product.units||[]).map(unit=>({name:unit.sub,factor:unit.factor})),
  ],
  stockUnitAmountFromBase:(stock,factor)=>Math.round((Number(stock)/Number(factor))*100)/100,
};
vm.createContext(context);
vm.runInContext(html.slice(start,end), context);

let rows = context.lowStockReportRows();
assert.equal(rows.length,4,'ต้องสร้างแถวสินค้า 2 ตัวแยกตาม 2 คลัง และไม่รวมบริการ');
const mainRow=rows.find(row=>row.key==='1:1');
assert.equal(mainRow.displayUnit,'ลัง','หน่วยใหญ่ที่สุดต้องเป็นค่าเริ่มต้น');
assert.deepEqual(Array.from(mainRow.unitOptions,option=>option.factor),[100,10,1],'ตัวเลือกหน่วยต้องเรียงจากใหญ่ที่สุดไปเล็กที่สุด');
assert.equal(mainRow.displayStock,0.3,'ต้องแปลงจำนวนคงเหลือตามหน่วยที่เลือก');

context.lowStockUnitSelection[1]='กล่อง';
rows=context.lowStockReportRows();
assert.equal(rows.find(row=>row.key==='1:1').displayUnit,'กล่อง','ต้องจำหน่วยที่ผู้ใช้เลือกแยกตามสินค้า');
assert.equal(rows.find(row=>row.key==='1:1').displayStock,3,'ต้องคำนวณจำนวนใหม่ตามหน่วยที่เลือก');
assert.equal(context.lowStockReportConditionLabel(),'สินค้าที่คงเหลือต่ำกว่า 50 หน่วยหลัก');

assert.match(html,/id="lowStockWarehouseFilter"/,'หน้าสินค้าใกล้หมดต้องเลือกคลังได้');
assert.match(html,/data-lowstock-n="\$\{value\}"/,'ต้องเลือกเกณฑ์จำนวนที่ต้องการแสดงได้');
assert.match(html,/data-lowstock-unit="\$\{row\.productId\}"/,'ต้องเลือกหน่วยแสดงผลรายสินค้าได้');
assert.doesNotMatch(html,/data-lowstock-threshold=/,'หน้ารายงานต้องไม่มีช่องแก้จุดสั่งซื้อขั้นต่ำ');
assert.doesNotMatch(html,/id="createLowStockOrderBtn"/,'หน้ารายงานต้องไม่สร้างรายการสั่งของขาด');
assert.doesNotMatch(html,/id="f_threshold"/,'หน้าสินค้าต้องไม่มีช่องจุดสั่งซื้อขั้นต่ำ');
assert.match(html,/lowStockReportConditionLabel\(\)/,'รายงานพิมพ์ต้องใช้เงื่อนไขเดียวกับหน้าจอ');

console.log('low stock report tests passed');
