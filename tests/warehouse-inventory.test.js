const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf("const ACTIVE_WAREHOUSE_SESSION_KEY=");
const end = html.indexOf('function productToRow(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบ logic แยกสต๊อกตามคลัง');

const session = new Map();
const products = [{id:10,name:'ยา A',stock:99,expiry:'2028-01-01'}];
const sandbox = {
  currentProfile: {id:'owner-1',owner:true},
  warehouses: [{id:1,name:'สำนักงานใหญ่'},{id:2,name:'สาขา'}],
  products,
  cart:[{pid:10}], saleDiscount:4, saleMember:{id:1}, pendingQty:8,
  stockReportItems:[{pid:10}], stockEditItems:[10], stockEditRowUnitSel:{10:'กล่อง'}, stockEditDraftStocks:{10:5},
  stockEditSourceInspectionListId:'CHECK-1', stockEditSourcePending:true, stockEditPage:3,
  inspectionListDraft:{id:'CHECK-1'}, editingInspectionListId:'CHECK-1',
  sessionStorage:{
    getItem:key=>session.get(key) ?? null,
    setItem:(key,value)=>session.set(key,String(value)),
  },
};
vm.createContext(sandbox);
vm.runInContext(`${html.slice(start,end)}
this.setWarehouseAccess=value=>warehouseAccessRows=value;
this.getActiveWarehouseId=()=>activeWarehouseId;`, sandbox);

sandbox.updateInventoryBalanceLocal(10,1,12,'2027-01-01');
sandbox.updateInventoryBalanceLocal(10,2,4,'2029-02-03');
assert.equal(sandbox.warehouseStock(10,1),12);
assert.equal(sandbox.warehouseStock(10,2),4);
assert.equal(sandbox.warehouseExpiry(10,2),'2029-02-03');

assert.equal(sandbox.selectActiveWarehouse(2),true);
assert.equal(sandbox.getActiveWarehouseId(),2);
assert.equal(products[0].stock,4);
assert.equal(products[0].expiry,'2029-02-03');
assert.equal(sandbox.cart.length,0,'เปลี่ยนคลังต้องล้างบิลค้าง');
assert.equal(sandbox.stockEditItems.length,0,'เปลี่ยนคลังต้องล้างรายการแก้สต๊อกที่ค้าง');
assert.equal(sandbox.inspectionListDraft,null,'เปลี่ยนคลังต้องล้างร่างตรวจสินค้าที่ค้าง');

sandbox.updateInventoryBalanceLocal(10,1,20);
assert.equal(products[0].stock,4,'อัปเดตคลังอื่นต้องไม่เปลี่ยนยอดบนหน้าคลังปัจจุบัน');
sandbox.updateInventoryBalanceLocal(10,2,6);
assert.equal(products[0].stock,6,'อัปเดตคลังปัจจุบันต้องสะท้อนบนหน้าจอทันที');

sandbox.currentProfile={id:'staff-1',owner:false};
sandbox.setWarehouseAccess([{user_id:'staff-1',warehouse_id:1,can_sell:true},{user_id:'staff-1',warehouse_id:2,can_sell:false}]);
assert.deepEqual(Array.from(sandbox.accessibleWarehouses(),warehouse=>warehouse.id),[1]);
assert.equal(sandbox.selectActiveWarehouse(2),false,'ผู้ใช้ต้องเลือกคลังที่ไม่มีสิทธิ์ไม่ได้');

assert.match(html,/sb\.rpc\('adjust_inventory_stock'/);
assert.match(html,/sb\.rpc\('set_inventory_stock'/);
assert.match(html,/sb\.rpc\('set_inventory_expiry'/);
assert.match(html,/warehouseId:Number\(activeWarehouseId\)\|\|null/,'บิลขายต้องบันทึกคลังที่ใช้งาน');
assert.match(html,/คลัง: \$\{activeWarehouse\(\)\?\.name\|\|'-'\} \/ \$\{fmtTopbarDate\(TODAY_STR\)\}/);

console.log('warehouse inventory tests passed');
