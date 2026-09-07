const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8') + fs.readFileSync(path.join(root, 'excel-tools.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260906080709_unify_stock_and_staff_permissions.sql'),
  'utf8',
);
const allowlist = JSON.parse(fs.readFileSync(path.join(root, 'supabase', 'rpc-allowlist.json'), 'utf8'));

// Stock must be changed through posted, audited stock operations only.
assert.match(app, /id="f_stock"[^>]*readonly/);
assert.match(app, /class="u_stock"[^>]*readonly/);
assert.doesNotMatch(app, /function (adjustProductStockOnSupabase|setProductStockOnSupabase|setProductExpiryOnSupabase)\(/);
assert.doesNotMatch(app, /sb\.rpc\('(adjust_inventory_stock|set_inventory_stock|set_inventory_expiry)'/);
assert.match(app, /applyImportedInventoryTargets/);
assert.match(app, /runStockOperation\('post_inventory_count_adjustment_with_shortages'/);
for (const signature of [
  'adjust_inventory_stock(bigint,bigint,numeric)',
  'set_inventory_stock(bigint,bigint,numeric)',
  'set_inventory_expiry(bigint,bigint,date)',
]) {
  assert.equal(allowlist.authenticated.includes(signature), false, `${signature} must not be a browser RPC`);
}
assert.match(migration, /revoke all on function public\.adjust_inventory_stock[\s\S]*from public,anon,authenticated/i);
assert.match(migration, /revoke all on function public\.set_inventory_stock[\s\S]*from public,anon,authenticated/i);
assert.match(migration, /revoke all on function public\.set_inventory_expiry[\s\S]*from public,anon,authenticated/i);

// Shared mutable master data uses random identifiers and optimistic revisions.
assert.match(app, /function generateClientRecordId\(/);
assert.match(app, /function generateInspectionListId\(/);
assert.doesNotMatch(app, /nextContactId|nextSalesRepresentativeId|nextPromotionId|inspectionListCounter/);
assert.match(app, /insertRevisionedRows\(table,inserts,toRow,acknowledge\)/);
assert.match(app, /updateRevisionedRows\(table,updates,toRow,acknowledge\)/);
assert.match(app, /deleteRevisionedRows\(table,deleted,previous,/);
assert.match(app, /function contactToRow[\s\S]{0,420}revision:Number\(c\._revision\)\|\|0/);
assert.match(app, /function salesRepToRow[\s\S]{0,260}revision:Number\(r\._revision\)\|\|0/);
assert.match(app, /function promotionToRow[\s\S]{0,260}revision:Number\(promotion\._revision\)\|\|0/);
assert.match(app, /function inspectionListToRow[\s\S]{0,260}revision:Number\(list\._revision\)\|\|0/);

// Unsupported legacy staff levels and duplicate routes stay removed.
assert.match(app, /if\(Number\(user\?\.level\)!==2\) return false/);
assert.doesNotMatch(app, /stockadjust:\s*render|stockedit:\s*render|rsales:\s*render|remployee:\s*render|rreceivable:\s*render/);
assert.doesNotMatch(app, /inspectionlists:\s*renderInspectionLists/);
assert.match(app, /if\(tab==='stockcontrol'\) return canPerformPageAction\('view','inspectionlists',user\)/);
assert.doesNotMatch(app, /function renderRSales\(|function renderREmployee\(|function renderRReceivable\(/);
assert.match(migration, /profiles_supported_level_check/);
assert.match(migration, /'_revision'/);

console.log('stock and shared-master hardening tests passed');
