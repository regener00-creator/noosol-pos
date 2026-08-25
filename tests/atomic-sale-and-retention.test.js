const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0025_atomic_sales_void_and_inventory_backup.sql'), 'utf8');
const protectionMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0026_protect_completed_sales_and_posted_documents.sql'), 'utf8');
const sequenceMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0027_seed_sale_sequence_from_existing_refs.sql'), 'utf8');

const checkoutStart = html.indexOf('async function doCheckout(');
const checkoutEnd = html.indexOf('// คลิกช่องตัวเลข', checkoutStart);
assert.ok(checkoutStart >= 0 && checkoutEnd > checkoutStart, 'ไม่พบขั้นตอนชำระเงิน');
const checkout = html.slice(checkoutStart, checkoutEnd);
assert.match(checkout, /sb\.rpc\('complete_sale'/, 'การขายต้องเรียก RPC เดียว');
assert.doesNotMatch(checkout, /post_sale_inventory_lots/, 'หน้าเว็บต้องไม่ตัด Lot แยกจากการสร้างบิล');
assert.doesNotMatch(checkout, /\.from\('sales'\)\.upsert/, 'หน้าเว็บต้องไม่บันทึกบิลแยกจากการตัด Lot');
assert.match(checkout, /checkoutRequestId\(\)/, 'การกดซ้ำต้องใช้ request id เดิม');
assert.match(checkout, /clearCheckoutRequestId\(\)/, 'ล้าง request id ได้เฉพาะหลังสำเร็จ');

assert.match(migration, /create unique index if not exists idx_sales_checkout_request/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /create or replace function public\.complete_sale/);
assert.match(migration, /v_posting:=public\.post_sale_inventory_lots/);
assert.match(migration, /insert into public\.sales/);
assert.match(migration, /private\.next_sale_reference/);
assert.match(sequenceMigration, /from public\.sales sale/);
assert.match(sequenceMigration, /max\(substring\(sale\.ref/);
assert.match(sequenceMigration, /on conflict \(sale_date,prefix\) do update/);
assert.match(migration, /create or replace function public\.void_sale/);
assert.match(migration, /set quantity_base=quantity_base\+v_quantity/);
assert.match(migration, /'sale_void'/);
assert.match(migration, /update public\.sales set status='void'/);

const deleteStart = html.indexOf('function deleteSaleHistory(');
const deleteEnd = html.indexOf('async function voidSaleHistory(', deleteStart);
const deleteSale = html.slice(deleteStart, deleteEnd);
assert.match(deleteSale, /sale\.status!=='hold'/, 'ลบได้เฉพาะบิลพัก');
assert.match(deleteSale, /บิลที่ชำระแล้วห้ามลบ/);
assert.match(html, /data-void-sale=/, 'บิลสำเร็จต้องใช้ปุ่มยกเลิกบิล');
assert.match(html, /sb\.rpc\('void_sale'/);

const helperStart = html.indexOf('function documentHasPostedStock(');
const helperEnd = html.indexOf('function deleteSelectedDocuments(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'ไม่พบตัวป้องกันการลบเอกสารสต๊อก');
const context = { showToast(){} };
vm.createContext(context);
vm.runInContext(html.slice(helperStart, helperEnd), context);
assert.equal(context.documentHasPostedStock('gr', {stockApplied:true}), true);
assert.equal(context.documentHasPostedStock('ret', {stockApplied:false}), false);
assert.equal(context.documentHasPostedStock('exchange', {status:'ส่งไปเปลี่ยนแล้ว'}), true);
assert.equal(context.documentHasPostedStock('transfer', {stockApplied:true}), true);
assert.equal(context.documentHasPostedStock('transfer', {stockApplied:false}), false);
assert.match(html, /refusePostedDocumentDeletion\('exchange'/);
assert.match(html, /refusePostedDocumentDeletion\('transfer'/);
assert.match(protectionMigration, /create trigger protect_completed_sale_delete/);
assert.match(protectionMigration, /completed sales cannot be deleted/);
assert.match(protectionMigration, /create trigger protect_posted_document_delete before delete on public\.goods_receipts/);
assert.match(protectionMigration, /create trigger protect_posted_document_delete before delete on public\.product_returns/);
assert.match(protectionMigration, /create trigger protect_posted_document_delete before delete on public\.product_exchanges/);
assert.match(protectionMigration, /create trigger protect_posted_document_delete before delete on public\.transfers/);

assert.match(html, /const STORE_BACKUP_VERSION=2/);
assert.match(html, /sb\.rpc\('export_store_inventory_backup'/);
assert.match(html, /sb\.rpc\('restore_store_inventory_backup'/);
assert.match(html, /inventoryBackup\.lots/);
assert.match(html, /inventoryBackup\.movements/);
assert.doesNotMatch(html, /id="resetAllDataBtn"/);
assert.doesNotMatch(html, /function resetAllSystemData\(/);
assert.doesNotMatch(html, /function resetDocumentsOnly\(/);
assert.match(migration, /create or replace function public\.export_store_inventory_backup/);
assert.match(migration, /create or replace function public\.restore_store_inventory_backup/);
assert.match(migration, /delete from public\.inventory_lot_movements/);
assert.match(migration, /delete from public\.inventory_lots/);

assert.match(html, /INVENTORY_LOT_HISTORY_PAGE_SIZE=50/);
assert.match(html, /\.range\(historyLoaded,historyLoaded\+INVENTORY_LOT_HISTORY_PAGE_SIZE-1\)/);
assert.equal(fs.existsSync(path.join(root, 'legacy', 'POS_original.html')), false, 'ไฟล์โปรแกรมเก่าต้องไม่อยู่ในพื้นที่ deploy');

console.log('atomic sale and retention tests passed');
