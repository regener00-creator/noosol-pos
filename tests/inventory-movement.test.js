const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = {};
vm.createContext(context);

const logicStart = html.indexOf('function inventoryMovementRound(');
const logicEnd = html.indexOf('function inventoryMovementDateRange(', logicStart);
assert.ok(logicStart >= 0 && logicEnd > logicStart, 'ไม่พบ logic รายการงานเคลื่อนไหว');
vm.runInContext(html.slice(logicStart, logicEnd), context);

const products = [
  {id:1,name:'Decolgen prin (4 tablets)',unit:'ซอง',wh:1},
  {id:2,name:'[BP] Lotemo Kids (60 ml)',unit:'กล่อง',wh:1},
  {id:3,name:'[BP] Ranidine 150 mg (10 tablets)',unit:'กล่อง',wh:1},
  {id:4,name:'[BP] Alben Anthelmintics (10 ml)',unit:'กล่อง',wh:1},
];
const warehouses = [{id:1,name:'พระยาสุเรนทร์ (สำนักงานใหญ่)'}];
const rows = context.collectInventoryMovements({
  products,
  warehouses,
  sales:[
    {id:'INV-1',ref:'RE202608180002',date:'2026-08-18',time:'2026-08-18 17:46',status:'done',items:[{productId:1,name:products[0].name,qty:2,unit:'กล่อง'}]},
    {id:'INV-2',ref:'RE202608180003',date:'2026-08-18',time:'2026-08-18 18:00',status:'hold',items:[{productId:1,name:products[0].name,qty:99,unit:'ซอง'}]},
  ],
  exchanges:[{
    id:'EX202608220001',date:'2026-08-22',warehouseId:1,status:'รับสินค้ากลับแล้ว',outgoingApplied:true,incomingApplied:true,
    outgoingItems:[{pid:2,name:products[1].name,qty:1,unit:'กล่อง',factor:1},{pid:3,name:products[2].name,qty:1,unit:'กล่อง',factor:1}],
    incomingItems:[{pid:2,name:products[1].name,qty:1,unit:'กล่อง',factor:1},{pid:1,name:products[0].name,qty:1,unit:'ซอง',factor:1}],
  }],
  receipts:[
    {id:'RI202608230001',date:'2026-08-23',stockApplied:true,items:[{productId:4,name:products[3].name,qty:1,unit:'กล่อง'}]},
    {id:'RI202608230002',date:'2026-08-23',stockApplied:false,items:[{productId:4,name:products[3].name,qty:50,unit:'กล่อง'}]},
  ],
  returns:[],
  transfers:[],
});

assert.equal(rows.length, 5);
assert.deepEqual(
  JSON.parse(JSON.stringify(rows.map(row=>[row.bill,row.productId,row.qty,row.unit,row.direction,row.warehouse]))),
  [
    ['RI202608230001',4,1,'กล่อง','เข้า','พระยาสุเรนทร์ (สำนักงานใหญ่)'],
    ['EX202608220001',2,1,'กล่อง','เปลี่ยน','พระยาสุเรนทร์ (สำนักงานใหญ่)'],
    ['EX202608220001',1,1,'ซอง','เข้า','พระยาสุเรนทร์ (สำนักงานใหญ่)'],
    ['EX202608220001',3,1,'กล่อง','ออก','พระยาสุเรนทร์ (สำนักงานใหญ่)'],
    ['RE202608180002',1,2,'กล่อง','ออก','พระยาสุเรนทร์ (สำนักงานใหญ่)'],
  ]
);
assert.equal(rows.at(-1).time, '17:46');

assert.deepEqual(
  JSON.parse(JSON.stringify(context.filterInventoryMovements(rows,{type:'เปลี่ยนสินค้า',bill:'ex20260822',direction:'เข้า',products:[]},{from:'2026-08-18',to:'2026-08-23'}).map(row=>[row.bill,row.productId,row.direction]))),
  [['EX202608220001',1,'เข้า']]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.filterInventoryMovements(rows,{type:'all',bill:'',direction:'ออก',products:[1]},{from:'2026-08-18',to:'2026-08-18'}).map(row=>[row.bill,row.productId,row.direction]))),
  [['RE202608180002',1,'ออก']]
);

assert.match(html, /\['inventorymovement','รายการงานเคลื่อนไหว'/);
assert.match(html, /id="movementPeriod"/);
assert.match(html, /id="movementType"/);
assert.match(html, /id="movementBill"/);
assert.match(html, /id="movementDirection"/);
assert.match(html, /id="movementCategory"/);
assert.match(html, /id="movementBrand"/);
assert.match(html, /id="movementSearch"/);
assert.match(html, /<th>วันที่<\/th><th>รายการ<\/th><th>บิล<\/th><th>เวลา<\/th><th>สินค้า<\/th><th>เข้า-ออก<\/th><th>คลังสินค้า<\/th>/);

console.log('inventory movement tests passed');
