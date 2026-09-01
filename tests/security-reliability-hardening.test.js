const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pending = path.join(root, 'supabase', 'pending', 'security_reliability_hardening.sql');
const applied = fs.readdirSync(path.join(root, 'supabase', 'migrations')).find((name) => name.endsWith('_security_reliability_hardening.sql'));
const migration = fs.readFileSync(fs.existsSync(pending) ? pending : path.join(root, 'supabase', 'migrations', applied), 'utf8');
const source = require('./load-app-source')();
const admin = fs.readFileSync(path.join(root, 'supabase', 'functions', 'admin-users', 'index.ts'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'supabase', 'functions', 'owner-recovery', 'index.ts'), 'utf8');

assert.match(migration, /create table if not exists private\.operation_ledger/i);
assert.match(migration, /create or replace function public\.run_stock_operation/i);
assert.match(migration, /create or replace function public\.save_revisioned_document/i);
assert.match(migration, /REVISION_CONFLICT/);
assert.match(migration, /create table if not exists public\.profile_page_permissions/i);
assert.match(migration, /create table if not exists public\.print_events/i);
assert.match(migration, /create table if not exists public\.sync_events/i);
assert.match(migration, /create table if not exists public\.data_retention_policies/i);
assert.match(migration, /create table if not exists public\.owner_recovery_codes/i);
assert.match(migration, /create table if not exists private\.audit_logs_archive/i);
assert.doesNotMatch(migration, /cron\.schedule/i);
assert.doesNotMatch(migration, /delete from public\.audit_logs/i);

for (const operation of ['apply_goods_receipt_lots','apply_product_return_lots','apply_product_exchange_status','post_inventory_count_adjustment_with_shortages','reallocate_inventory_lots','transfer_inventory_stock','correct_sale_lot_allocation','void_sale','change_product_base_unit','update_inventory_lot_details']) {
  assert.match(source, new RegExp(`runStockOperation\\('${operation}'`));
}
assert.match(source, /saveRevisionedDocument\(/);
assert.match(source, /recordPrintEvent\(/);
assert.match(source, /reportClientEvent\(/);
assert.match(source, /systemUserPermissionMatrixHtml/);
assert.match(admin, /PASSWORD_MIN_LENGTH = 10/);
assert.match(admin, /api\.pwnedpasswords\.com/);
assert.match(recovery, /owner_recovery_codes/);
assert.match(recovery, /\.eq\('code_hash', suppliedHash\)/);
assert.doesNotMatch(recovery, /attempts\s*:\s*Number\(recovery\.attempts\)\s*\+\s*1/);
assert.match(recovery, /updateUserById/);

console.log('security and reliability hardening tests passed');
