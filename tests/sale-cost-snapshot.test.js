const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function productUnitCost(');
const end = html.indexOf('function addToCart(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบฟังก์ชันคำนวณทุนตอนขาย');

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const product = {
  id: 101,
  unit: 'เม็ด',
  cost: 3,
  units: [
    {sub:'ซอง',factor:4,cost:12},
    {sub:'กล่อง',factor:40,cost:110},
  ],
};

const base = context.saleLineCostSnapshot({pid:101,unit:'เม็ด',factor:1,qty:4,cost:999}, product);
assert.deepEqual(JSON.parse(JSON.stringify(base)), {cost:3,costTotal:12,costSource:'product_manual'});

const box = context.saleLineCostSnapshot({pid:101,unit:'กล่อง',factor:40,qty:2,cost:999}, product);
assert.deepEqual(JSON.parse(JSON.stringify(box)), {cost:110,costTotal:220,costSource:'product_manual'});

product.units[1].cost = 125;
const nextBox = context.saleLineCostSnapshot({pid:101,unit:'กล่อง',factor:40,qty:2,cost:110}, product);
assert.equal(nextBox.cost, 125, 'บิลใหม่ต้องใช้ทุนล่าสุดจากข้อมูลสินค้า');
assert.equal(nextBox.costTotal, 250);
assert.equal(box.costTotal, 220, 'สำเนาทุนของบิลเดิมต้องไม่เปลี่ยนย้อนหลัง');

const derived = context.saleLineCostSnapshot({pid:101,unit:'ลัง',factor:400,qty:1}, product);
assert.equal(derived.cost, 1200, 'หน่วยที่ไม่มีทุนแยกต้องคำนวณจากทุนหน่วยหลักตามอัตราแปลง');

const custom = context.saleLineCostSnapshot({custom:true,price:45,qty:3}, null);
assert.deepEqual(JSON.parse(JSON.stringify(custom)), {cost:45,costTotal:135,costSource:'custom_price'});

assert.doesNotMatch(html, /item\.costTotal\s*=\s*item\.lotAllocations\.reduce/, 'ต้นทุน Lot ต้องไม่เขียนทับทุนที่บันทึกตอนขาย');
assert.match(html, /costSource:costSnapshot\.costSource/);

console.log('sale cost snapshot tests passed');
