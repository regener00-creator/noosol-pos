const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '0034_mobile_lot_expiry_audit.sql'),
  'utf8',
);
const indexMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '0035_mobile_lot_expiry_audit_indexes.sql'),
  'utf8',
);
const detailsMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '0036_mobile_product_details_without_stock.sql'),
  'utf8',
);
const retireMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '0037_retire_mobile_stock_edit_rpcs.sql'),
  'utf8',
);

assert.match(migration, /create table if not exists private\.inventory_lot_detail_audit/);
assert.match(migration, /old_expiry date/);
assert.match(migration, /new_expiry date/);
assert.match(migration, /actor_id uuid references auth\.users/);
assert.match(migration, /create or replace function public\.owner_update_mobile_product_lot/);
assert.match(migration, /if not \(select private\.is_current_owner\(\)\)/);
assert.match(migration, /selected lot does not belong to this product and warehouse/);
assert.match(migration, /insert into private\.inventory_lot_detail_audit/);
assert.match(migration, /v_old_expiry is distinct from p_expiry/);
assert.match(migration, /multiple active lots; refresh PEPOS and select a lot before editing expiry/);
assert.match(migration, /revoke execute on function public\.owner_update_mobile_product_lot[\s\S]*from public,anon,authenticated/);
assert.match(migration, /grant execute on function public\.owner_update_mobile_product_lot[\s\S]*to authenticated/);
assert.match(indexMigration, /idx_inventory_lot_detail_audit_product_warehouse/);
assert.match(indexMigration, /idx_inventory_lot_detail_audit_warehouse/);
assert.match(indexMigration, /create policy inventory_lot_detail_audit_no_direct_access/);
assert.match(indexMigration, /using \(false\)[\s\S]*with check \(false\)/);
assert.match(detailsMigration, /create or replace function public\.owner_update_mobile_product_details/);
assert.match(detailsMigration, /if not \(select private\.is_current_owner\(\)\)/);
assert.match(detailsMigration, /selected lot does not belong to this product and warehouse/);
assert.match(detailsMigration, /insert into private\.inventory_lot_detail_audit/);
assert.match(detailsMigration, /revoke execute on function public\.owner_update_mobile_product_details[\s\S]*from public,anon,authenticated/);
assert.match(detailsMigration, /grant execute on function public\.owner_update_mobile_product_details[\s\S]*to authenticated/);
assert.doesNotMatch(detailsMigration, /set_inventory_stock|adjust_inventory_stock|quantity_base\s*=/);
assert.match(retireMigration, /revoke execute on function public\.owner_update_mobile_product\(bigint,bigint,jsonb,numeric,numeric,numeric,date\)[\s\S]*from public,anon,authenticated/);
assert.match(retireMigration, /revoke execute on function public\.owner_update_mobile_product_lot\(bigint,bigint,bigint,jsonb,numeric,numeric,numeric,date\)[\s\S]*from public,anon,authenticated/);

console.log('mobile lot safety tests passed');
