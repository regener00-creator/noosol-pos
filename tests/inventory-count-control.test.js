const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = require("./load-app-source")();
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260826025528_inventory_count_adjustments.sql'), 'utf8');
const indexMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260826025624_inventory_count_adjustment_indexes.sql'), 'utf8');
const sequenceMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260826025849_reseed_inventory_sequences.sql'), 'utf8');
const negativeStockMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260826030155_allow_negative_recorded_count_stock.sql'), 'utf8');

assert.match(html, /\['stockcontrol','ตรวจนับ \/ ปรับสต๊อก'/);
assert.doesNotMatch(html, /\['inspectionlists','ตรวจสินค้า'/);
assert.doesNotMatch(html, /\['stockedit','แก้ไขสต๊อก'/);
assert.doesNotMatch(html, /\['stockadjust','สินค้าติดลบ'/);
assert.doesNotMatch(html, /<h1>ตรวจนับและปรับสต๊อก<\/h1>/);
assert.doesNotMatch(html, /ตรวจสอบก่อนบันทึก ทุกการปรับจะมีเหตุผล ผู้ดำเนินการ และประวัติ LOT/);
assert.match(html, /data-stock-control-mode="count"/);
assert.match(html, /data-stock-control-mode="adjust"/);
assert.match(html, /data-stock-control-mode="anomalies"/);
assert.match(html, /รอยืนยันปรับสต๊อก/);
assert.match(html, /รายการผิดปกติ/);
assert.doesNotMatch(html, /<h1>รายการผิดปกติ<\/h1>/);
assert.doesNotMatch(html, /แจ้งเตือนเพื่อให้ตรวจนับก่อนปรับ ไม่แก้ยอดเป็นศูนย์ให้อัตโนมัติ/);
assert.doesNotMatch(html, /<h1>ปรับจำนวนแยกตาม LOT<\/h1>/);
assert.doesNotMatch(html, /ย้ายจำนวนระหว่าง LOT ของสินค้าเดียวกัน โดยยอดคงเหลือรวมจะไม่เปลี่ยน/);
assert.match(html, /\.stock-control-content>\.rpt\{padding:0;\}/);
assert.match(html, /\.stock-control-tabs\{display:flex;justify-content:center;gap:6px;width:100%;max-width:1400px;margin:0 auto 18px;/);
assert.doesNotMatch(html, /id="stockEditReason"/);
assert.doesNotMatch(html, /id="stockEditNote"/);
assert.doesNotMatch(html, /mobile-stock-reason|stock-control-meta/);
assert.match(html, /reason:AUTOMATIC_STOCK_ADJUSTMENT_REASON/);
assert.match(html, /LOT ที่ปรับ/);
assert.match(html, /post_inventory_count_adjustment/);

assert.match(migration, /create table if not exists public\.inventory_count_adjustments/);
assert.match(migration, /create table if not exists public\.inventory_count_adjustment_lines/);
assert.match(migration, /alter table public\.inventory_count_adjustments enable row level security/);
assert.match(migration, /revoke all on public\.inventory_count_adjustments from anon, authenticated/);
assert.match(migration, /grant select on public\.inventory_count_adjustments to authenticated/);
assert.match(migration, /create or replace function public\.post_inventory_count_adjustment/);
assert.match(migration, /if \(select auth\.uid\(\)\) is null then raise exception 'authentication required'/);
assert.match(migration, /access\.can_manage_stock/);
assert.match(migration, /for update;/);
assert.match(migration, /stock changed before confirmation/);
assert.match(migration, /v_delta := v_target-v_current/);
assert.match(migration, /v_allocation_delta := v_target-v_lot_stock/);
assert.match(migration, /abs\(v_delta\) <= 0\.000001 and abs\(v_allocation_delta\) <= 0\.000001/);
assert.match(migration, /'stock_count_in'/);
assert.match(migration, /'stock_count_out'/);
assert.match(migration, /order by lot\.expiry_date asc nulls last,lot\.received_at,lot\.id/);
assert.match(migration, /delete from public\.inventory_count_adjustment_lines;/);
assert.match(migration, /delete from public\.inventory_count_adjustments;/);
assert.match(migration, /revoke execute on function public\.post_inventory_count_adjustment\(bigint,text,text,text,jsonb\) from public,anon/);
assert.match(migration, /grant execute on function public\.post_inventory_count_adjustment\(bigint,text,text,text,jsonb\) to authenticated/);
assert.match(indexMigration, /inventory_count_adjustment_lines\(selected_lot_id\)/);
assert.match(sequenceMigration, /pg_get_serial_sequence\('public\.inventory_lots','id'\)/);
assert.match(sequenceMigration, /pg_get_serial_sequence\('public\.inventory_lot_movements','id'\)/);
assert.doesNotMatch(migration, /system_stock numeric not null check \(system_stock >= 0\)/);
assert.match(negativeStockMigration, /drop constraint if exists inventory_count_adjustment_lines_system_stock_check/);

const anomalyStart = html.indexOf('function stockControlAnomalyRows(');
const anomalyEnd = html.indexOf('function stockControlOpenAdjustmentForProduct(', anomalyStart);
assert.ok(anomalyStart >= 0 && anomalyEnd > anomalyStart);
const anomalyContext = {
  products: [],
  inventoryLotRows: [],
  activeWarehouseId: 1,
  currentDateStr: () => '2026-08-26',
  warehouseStock: productId => ({1:-2,2:5,3:4}[productId] || 0),
  inspectionListAmount: value => String(value),
};
vm.createContext(anomalyContext);
vm.runInContext(html.slice(anomalyStart, anomalyEnd), anomalyContext);
const anomalyProducts = [
  {id:1,name:'ติดลบ',unit:'กล่อง'},
  {id:2,name:'ยอดไม่ตรง',unit:'กล่อง'},
  {id:3,name:'หมดอายุ',unit:'กล่อง'},
];
const anomalyLots = [
  {id:20,product_id:2,warehouse_id:1,quantity_base:3,status:'active',expiry_date:'2030-01-01'},
  {id:30,product_id:3,warehouse_id:1,quantity_base:4,status:'active',expiry_date:'2026-08-01'},
];
const anomalyRows = anomalyContext.stockControlAnomalyRows(anomalyProducts, anomalyLots, 1);
assert.equal(anomalyRows.filter(row => row.type === 'ยอดติดลบ').length, 1);
assert.equal(anomalyRows.filter(row => row.type === 'ยอดไม่ตรงกับ LOT').length, 1);
assert.equal(anomalyRows.filter(row => row.type === 'LOT หมดอายุยังมีสินค้า').length, 1);

const payloadStart = html.indexOf('function stockEditAdjustmentLines(');
const payloadEnd = html.indexOf('async function confirmStockEditChanges(', payloadStart);
assert.ok(payloadStart >= 0 && payloadEnd > payloadStart);
const payloadContext = {
  activeWarehouseId: 1,
  inventoryLotRows: [{id:88,product_id:10,warehouse_id:1,quantity_base:12,status:'active'}],
  stockEditLotSelections: {10:'lot:88'},
  stockEditNewLotNumbers: {},
  stockEditNewLotExpiries: {},
  stockEditRowUnitSel: {10:'กล่อง'},
  stockEditPendingChanges: () => [],
};
vm.createContext(payloadContext);
const helperStart = html.indexOf('function stockEditAvailableLots(');
assert.ok(helperStart >= 0 && helperStart < payloadStart);
vm.runInContext(html.slice(helperStart, payloadEnd), payloadContext);
const product = {id:10,stock:12,unit:'กล่อง',expiry:'2030-01-01'};
const lines = payloadContext.stockEditAdjustmentLines([{product,newStock:10}]);
assert.equal(lines.length, 1);
assert.equal(lines[0].expectedStock, 12);
assert.equal(lines[0].targetStock, 10);
assert.equal(lines[0].selectedLotId, 88);
assert.equal(lines[0].unitName, 'กล่อง');

payloadContext.inventoryLotRows[0].quantity_base = 10;
payloadContext.stockEditLotSelections = {10:'lot:88'};
const reconciliationLines = payloadContext.stockEditAdjustmentLines([{product,newStock:12}]);
assert.equal(reconciliationLines[0].expectedStock, 12);
assert.equal(reconciliationLines[0].targetStock, 12);
assert.equal(reconciliationLines[0].selectedLotId, 88);

const balanceOnlyCorrection = payloadContext.stockEditAdjustmentLines([{product:{...product,stock:10},newStock:10}]);
assert.equal(balanceOnlyCorrection[0].expectedStock, 10);
assert.equal(balanceOnlyCorrection[0].targetStock, 10);
assert.equal(balanceOnlyCorrection[0].selectedLotId, null);

const pendingStart = html.indexOf('function stockEditPendingChanges(');
const pendingEnd = html.indexOf('function stockEditPagination(', pendingStart);
assert.ok(pendingStart >= 0 && pendingEnd > pendingStart);
vm.runInContext(html.slice(pendingStart, pendingEnd), payloadContext);
const reconciliationPending = payloadContext.stockEditPendingChanges([product], {10:12});
assert.equal(reconciliationPending.length, 1);
assert.equal(reconciliationPending[0].newStock, 12);

console.log('inventory count control tests passed');
