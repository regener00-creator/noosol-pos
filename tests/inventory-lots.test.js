const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const lotMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0019_inventory_lots.sql'), 'utf8');
const exchangeMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0020_inventory_lot_product_exchange.sql'), 'utf8');
const returnMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0022_inventory_lot_product_returns.sql'), 'utf8');
const historyMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0023_inventory_lot_history_pagination.sql'), 'utf8');

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

const groupHelperStart = html.indexOf('function inventoryLotDisplayGroupKey(');
const groupHelperEnd = html.indexOf('function inventoryLotDetailRowHtml(', groupHelperStart);
assert.ok(groupHelperStart >= 0 && groupHelperEnd > groupHelperStart, 'ไม่พบ helper สำหรับยุบรวม Lot');
const groupContext = {};
vm.createContext(groupContext);
vm.runInContext(html.slice(groupHelperStart, groupHelperEnd), groupContext);
const groupedLots = groupContext.groupInventoryLotDetailRows([
  {id:1,manufacturer_lot:' DEF ',expiry_date:'2031-08-09',quantity_base:20,status:'active'},
  {id:2,manufacturer_lot:'def',expiry_date:'2031-08-09',quantity_base:80,status:'active'},
  {id:3,manufacturer_lot:'DEF',expiry_date:'2030-09-09',quantity_base:5,status:'active'},
  {id:4,manufacturer_lot:'',expiry_date:'2031-08-09',quantity_base:3,status:'active'},
  {id:5,manufacturer_lot:'',expiry_date:'2031-08-09',quantity_base:7,status:'active'},
  {id:6,manufacturer_lot:'DEF',expiry_date:'2031-08-09',quantity_base:0,status:'exhausted'},
]);
assert.equal(groupedLots.length, 5, 'รวมเฉพาะเลข Lot ผู้ผลิต วันหมดอายุ และสถานะเดียวกัน');
assert.equal(groupedLots[0].rows.length, 2, 'เลข Lot ผู้ผลิตที่ต่างเฉพาะตัวพิมพ์/ช่องว่างต้องรวมกัน');
assert.equal(groupedLots[0].quantityBase, 100, 'ยอดคงเหลือของ Lot ที่รวมต้องถูกต้อง');
assert.equal(groupedLots[1].rows.length, 1, 'วันหมดอายุต่างกันต้องไม่รวม');
assert.equal(groupedLots[2].rows.length, 1, 'รายการที่ไม่ระบุเลข Lot ต้องคงแยกกัน');
assert.equal(groupedLots[3].rows.length, 1, 'รายการที่ไม่ระบุเลข Lot ต้องไม่ถูกยุบรวม');
assert.equal(groupedLots[4].rows.length, 1, 'Lot ที่หมดแล้วต้องไม่รวมกับ Lot ที่ยังมีสินค้า');

const rowSets = groupContext.inventoryLotDetailRowSets([
  {id:1,quantity_base:5,status:'active'},
  {id:2,quantity_base:0,status:'exhausted'},
  {id:3,quantity_base:0,status:'active'},
  {id:4,quantity_base:2,status:'exhausted'},
]);
assert.deepEqual(Array.from(rowSets.stocked,row=>row.id),[1], 'ค่าเริ่มต้นต้องแสดงเฉพาะ Lot ที่ยังมีสินค้า');
assert.deepEqual(Array.from(rowSets.exhausted,row=>row.id),[2,3,4], 'Lot หมดแล้วต้องอยู่ในส่วนประวัติ');

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
assert.match(historyMigration, /create index if not exists idx_inventory_lots_history/);
assert.match(historyMigration, /where quantity_base<=0 or status='exhausted'/);

assert.match(html, /<th>เลข Lot<\/th><th>วันหมดอายุ<\/th>/);
assert.match(html, /sb\.rpc\('post_sale_inventory_lots'/);
assert.match(html, /item\.lotAllocations=/);
assert.match(html, /sb\.from\('sales'\)\.upsert\(saleToRow\(completedSale\)\)/);
assert.match(html, /กรุณากดชำระซ้ำเพื่อบันทึกบิลเดิมโดยไม่ตัดสต๊อกเพิ่ม/);
assert.match(html, /สินค้า \/ Lot/);
assert.match(html, /data-product-lots/);
assert.match(html, /update_inventory_lot_details/);
assert.match(html, /data-lot-group-toggle/);
assert.match(html, /data-lot-group-child/);
assert.match(html, /id="lotHistoryToggle"/);
assert.match(html, /id="lotHistoryBody" hidden/);
assert.match(html, /data-lot-history-row/);
assert.match(html, /แสดง LOT ที่หมดแล้ว/);
assert.match(html, /readOnly:true/);
assert.match(html, /id="lotSystemDetailsToggle"/);
assert.match(html, /lot-detail-modal:not\(\.show-internal-lots\) \.lot-internal-column\{display:none;\}/);
assert.match(html, /class="lot-internal-column">รหัส LOT ภายใน/);
assert.match(html, /ดูรายละเอียดทางระบบ/);
assert.match(html, /ซ่อนรายละเอียดทางระบบ/);
assert.match(html, /currentProfile\?\.owner&&\(stockedRows\.length\|\|historyCount\)/);
assert.match(html, /INVENTORY_LOT_HISTORY_PAGE_SIZE=50/);
assert.match(html, /select\('id',\{count:'exact',head:true\}\)/);
assert.match(html, /id="lotHistoryBody" hidden><\/tbody>/);
assert.match(html, /id="lotHistoryLoadMoreBtn"/);
assert.match(html, /\.range\(historyLoaded,historyLoaded\+INVENTORY_LOT_HISTORY_PAGE_SIZE-1\)/);
assert.match(html, /loadHistoryPage=async/);
assert.doesNotMatch(html, /exhaustedRowsHtml=inventoryLotDetailGroupsHtml/);
assert.match(html, /class="product-exchange-lot"/);
assert.match(html, /class="poi_return_lot"/);
assert.match(html, /sb\.rpc\('apply_product_return_lots'/);
assert.match(html, /ใบคืนสินค้านี้ตัดสต๊อกแล้ว จึงแก้สินค้า จำนวน หน่วย หรือ Lot ไม่ได้/);
assert.doesNotMatch(html, /<th>ทุน\/หน่วยหลัก<\/th>/, 'หน้ารายละเอียด Lot ต้องไม่แสดงต้นทุน');

console.log('inventory lot tests passed');
