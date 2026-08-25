const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const lotMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0019_inventory_lots.sql'), 'utf8');
const exchangeMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0020_inventory_lot_product_exchange.sql'), 'utf8');
const returnMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0022_inventory_lot_product_returns.sql'), 'utf8');

const helperStart = html.indexOf('function normalizeInventoryLotRow(');
const helperEnd = html.indexOf('function inventoryLotStatus(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'ไม่พบ helper ของ Lot');
const context = {
  activeWarehouseId: 1,
  inventoryLotRows: [
    {id:'1',product_id:'10',warehouse_id:'1',quantity_base:'5',status:'active'},
    {id:'2',product_id:'10',warehouse_id:'1',quantity_base:'0',status:'exhausted'},
    {id:'3',product_id:'10',warehouse_id:'2',quantity_base:'8',status:'active'},
    {id:'4',product_id:'10',warehouse_id:'1',quantity_base:'2',status:'blocked'},
  ],
};
vm.createContext(context);
vm.runInContext(html.slice(helperStart, helperEnd), context);
assert.equal(context.normalizeInventoryLotRow(context.inventoryLotRows[0]).quantity_base, 5);
assert.equal(context.inventoryLotsForProduct(10, 1).length, 3);
assert.equal(context.inventoryLotsForProduct(10, 1, {includeEmpty:false}).length, 2);
assert.equal(context.activeInventoryLotsForProduct(10, 1).length, 1);
assert.equal(context.inventoryLotCount(10, 1), 1);

assert.match(lotMigration, /create table if not exists public\.inventory_lots/);
assert.match(lotMigration, /create table if not exists public\.inventory_lot_movements/);
assert.match(lotMigration, /alter table public\.inventory_lots enable row level security/);
assert.match(lotMigration, /order by\s+lot\.expiry_date asc nulls last,lot\.received_at,lot\.id/);
assert.match(lotMigration, /lot\.expiry_date>=current_date/);
assert.match(lotMigration, /create unique index if not exists idx_inventory_lots_source/);
assert.match(lotMigration, /create or replace function public\.apply_goods_receipt_lots/);
assert.match(lotMigration, /create or replace function public\.post_sale_inventory_lots/);
assert.match(lotMigration, /create or replace function public\.transfer_inventory_stock/);

assert.match(exchangeMigration, /movement_type,quantity_delta/);
assert.match(exchangeMigration, /'exchange_out'/);
assert.match(exchangeMigration, /'exchange_in'/);
assert.match(exchangeMigration, /private\.create_inventory_lot/);
assert.match(exchangeMigration, /v_lot_number:=nullif/);

assert.match(returnMigration, /create or replace function public\.apply_product_return_lots/);
assert.match(returnMigration, /lot\.id=v_lot_id/);
assert.match(returnMigration, /lot\.product_id=v_product/);
assert.match(returnMigration, /lot\.warehouse_id=v_warehouse/);
assert.match(returnMigration, /v_lot\.quantity_base<v_qty/);
assert.match(returnMigration, /'return_out'/);
assert.match(returnMigration, /grant execute on function public\.apply_product_return_lots\(text\) to authenticated/);

assert.match(html, /<th>เลข Lot<\/th><th>วันหมดอายุ<\/th>/);
assert.match(html, /sb\.rpc\('post_sale_inventory_lots'/);
assert.match(html, /item\.lotAllocations=/);
assert.match(html, /sb\.from\('sales'\)\.upsert\(saleToRow\(completedSale\)\)/);
assert.match(html, /กรุณากดชำระซ้ำเพื่อบันทึกบิลเดิมโดยไม่ตัดสต๊อกเพิ่ม/);
assert.match(html, /สินค้า \/ Lot/);
assert.match(html, /data-product-lots/);
assert.match(html, /update_inventory_lot_details/);
assert.match(html, /class="product-exchange-lot"/);
assert.match(html, /class="poi_return_lot"/);
assert.match(html, /sb\.rpc\('apply_product_return_lots'/);
assert.match(html, /ใบคืนสินค้านี้ตัดสต๊อกแล้ว จึงแก้สินค้า จำนวน หน่วย หรือ Lot ไม่ได้/);
assert.doesNotMatch(html, /<th>ทุน\/หน่วยหลัก<\/th>/, 'หน้ารายละเอียด Lot ต้องไม่แสดงต้นทุน');

console.log('inventory lot tests passed');
