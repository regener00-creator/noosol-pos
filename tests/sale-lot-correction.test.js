const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = require("./load-app-source")();
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260825121426_correct_sale_lot_allocation.sql'), 'utf8');

const allocationStart = html.indexOf('function saleLotCorrectionAllocations(');
const labelStart = html.indexOf('function saleLotCorrectionLabel(', allocationStart);
assert.ok(allocationStart >= 0 && labelStart > allocationStart, 'sale Lot correction helpers must exist');
const helperSource = html.slice(allocationStart, labelStart);
const context = {};
vm.createContext(context);
vm.runInContext(`${helperSource}\nthis.saleLotCorrectionAllocations=saleLotCorrectionAllocations;this.saleLotCorrectionValidation=saleLotCorrectionValidation;`, context);

const item = {
  productId: 10,
  factor: 10,
  unit: 'กล่อง',
  lotAllocations: [
    { lotId: 1, lotNumber: 'OLD', baseQty: 10 },
    { lotId: 1, lotNumber: 'OLD', baseQty: 5 }
  ]
};
const lots = [
  { id: 1, product_id: 10, warehouse_id: 7, quantity_base: 20, status: 'active' },
  { id: 2, product_id: 10, warehouse_id: 7, quantity_base: 50, status: 'active' }
];

const grouped = context.saleLotCorrectionAllocations(item);
assert.strictEqual(grouped.length, 1);
assert.strictEqual(grouped[0].baseQty, 15, 'duplicate allocations for one Lot must be grouped');

const valid = context.saleLotCorrectionValidation(item, 7, 1, 2, 1.5, lots);
assert.strictEqual(valid.error, '');
assert.strictEqual(valid.quantityBase, 15);
assert.strictEqual(valid.maxQuantity, 1.5);

assert.match(context.saleLotCorrectionValidation(item, 7, 1, 2, 2, lots).error, /เกินกว่า/);
assert.match(context.saleLotCorrectionValidation(item, 7, 1, 1, 1, lots).error, /คนละรายการ/);
assert.match(context.saleLotCorrectionValidation(item, 8, 1, 2, 1, lots).error, /ไม่ตรงกับสินค้าและคลัง/);
assert.match(context.saleLotCorrectionValidation(item, 7, 1, 2, 0, lots).error, /ระบุจำนวน/);
assert.match(context.saleLotCorrectionValidation(item, 7, 1, 2, 1, [{ ...lots[1], status: 'blocked' }]).error, /ระงับ/);

assert.match(html, /id="correctSaleLotBtn">แก้ไข LOT ที่ขาย/);
assert.match(html, /currentProfile\?\.owner&&canIssue/);
assert.match(html, /runStockOperation\('correct_sale_lot_allocation'/);
assert.match(html, /ยอดสต๊อกรวมและยอดขายจะไม่เปลี่ยน/);
assert.match(html, /lotCorrectionLog/);

assert.match(migration, /create or replace function public\.correct_sale_lot_allocation/);
assert.match(migration, /if not \(select private\.is_current_owner\(\)\)/);
assert.match(migration, /from public\.sales where id=p_sale_id for update/);
assert.match(migration, /where lot\.id in \(p_from_lot_id,p_to_lot_id\)[\s\S]*for update/);
assert.match(migration, /set quantity_base=quantity_base\+p_quantity_base/);
assert.match(migration, /set quantity_base=quantity_base-p_quantity_base/);
assert.match(migration, /'sale_lot_correction_restore'/);
assert.match(migration, /'sale_lot_correction_out'/);
assert.match(migration, /update public\.sales set data=v_data/);
assert.match(migration, /private\.refresh_inventory_balance_from_lots/);
assert.match(migration, /revoke execute on function public\.correct_sale_lot_allocation[\s\S]*from public,anon/);
assert.match(migration, /grant execute on function public\.correct_sale_lot_allocation[\s\S]*to authenticated/);

console.log('sale lot correction tests passed');
