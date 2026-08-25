const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/0028_controlled_store_reset.sql'), 'utf8');
const bootstrapMigration = fs.readFileSync(path.join(root, 'supabase/migrations/0029_secure_owner_bootstrap.sql'), 'utf8');
const adminUsers = fs.readFileSync(path.join(root, 'supabase/functions/admin-users/index.ts'), 'utf8');
const bootstrapOwner = fs.readFileSync(path.join(root, 'supabase/functions/bootstrap-owner/index.ts'), 'utf8');

assert.match(migration, /create table if not exists private\.store_reset_audit/i);
assert.match(migration, /create or replace function public\.admin_reset_store_data/i);
assert.match(migration, /pg_advisory_xact_lock\(hashtext\('pepos-controlled-store-reset'\)\)/i);
assert.match(migration, /current_setting\('pepos\.maintenance_reset',true\)='on'/i);
assert.match(migration, /delete from public\.inventory_lot_movements[\s\S]*delete from public\.inventory_lots[\s\S]*delete from public\.inventory_balances/i);
assert.match(migration, /update public\.products[\s\S]*set stock=0/i);
assert.match(migration, /delete from public\.profiles/i);
assert.match(migration, /values\('maintenance_epoch'/i);
assert.match(migration, /revoke execute on function public\.admin_reset_store_data\(text,uuid,text\) from public,anon,authenticated/i);
assert.match(migration, /grant execute on function public\.admin_reset_store_data\(text,uuid,text\) to service_role/i);
assert.match(bootstrapMigration, /private\.owner_bootstrap_tokens/i);
assert.match(bootstrapMigration, /extensions\.digest/i);
assert.match(bootstrapMigration, /admin_prepare_owner_bootstrap_token/i);
assert.match(bootstrapMigration, /admin_validate_owner_bootstrap_token/i);
assert.match(bootstrapMigration, /admin_consume_owner_bootstrap_token/i);
assert.match(bootstrapMigration, /grant execute on function public\.admin_validate_owner_bootstrap_token\(text\) to service_role/i);

assert.match(adminUsers, /action === 'reset-store'/);
assert.match(adminUsers, /verifyCurrentPassword\(url, caller\.email, password\)/);
assert.match(adminUsers, /admin\.rpc\('admin_reset_store_data'/);
assert.match(adminUsers, /admin\.auth\.admin\.deleteUser\(user\.id\)/);
assert.match(adminUsers, /admin_prepare_owner_bootstrap_token/);
assert.match(adminUsers, /crypto\.randomUUID/);

assert.match(bootstrapOwner, /name: 'สำนักงานใหญ่'/);
assert.match(bootstrapOwner, /from\('profile_warehouse_access'\)\.upsert/);
assert.match(bootstrapOwner, /admin_validate_owner_bootstrap_token/);
assert.match(bootstrapOwner, /admin_consume_owner_bootstrap_token/);

assert.match(html, /id="openDocumentResetBtn"/);
assert.match(html, /id="openFactoryResetBtn"/);
assert.match(html, /id="storeResetPassword"/);
assert.match(html, /id="storeResetPhrase"/);
assert.match(html, /action:'reset-store',mode,password,phrase/);
assert.match(html, /async function adoptRemoteMaintenanceEpoch\(\)/);
assert.match(html, /clearLocalStoreCachesForReset\(\)/);
assert.match(html, /window\.location\.reload\(\)/);
assert.match(html, /OWNER_BOOTSTRAP_TOKEN_STORAGE_KEY/);

console.log('controlled store reset tests passed');
