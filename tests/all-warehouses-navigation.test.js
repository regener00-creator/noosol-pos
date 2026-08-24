const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf("const LEVEL2_HIDDEN_TABS=");
const end = html.indexOf('function renderLoginState(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบ logic จำกัดเมนูโหมดทุกคลัง');

const context = {
  loggedInUser:()=>({owner:true,level:1}),
  isAllWarehousesMode:()=>true,
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

assert.equal(context.canAccessTab('dashboard'), true);
assert.equal(context.canAccessTab('inventorymovement'), true);
assert.equal(context.canAccessTab('rinventory'), true);
assert.equal(context.canAccessTab('rprofit'), true);
assert.equal(context.canAccessTab('checkout'), false, 'ทุกคลังต้องเข้า POS ไม่ได้');
assert.equal(context.canAccessTab('goodsreceipt'), false, 'ทุกคลังต้องรับสินค้าไม่ได้');
assert.equal(context.canAccessTab('stockedit'), false, 'ทุกคลังต้องแก้สต๊อกไม่ได้');
assert.equal(context.canAccessTab('transfer'), false, 'ทุกคลังต้องโอนสินค้าไม่ได้');

assert.match(html, /ทุกคลัง — ดูรายงานภาพรวม/);
assert.match(html, /คลัง: \$\{isAllWarehousesMode\(\)\?'ทุกคลัง'/);

console.log('all warehouses navigation tests passed');
