const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = require('./load-app-source')();
const migrationName=fs.readdirSync(path.join(root,'supabase','migrations')).find(name=>name.endsWith('_allow_customer_special_prices.sql'));
assert.ok(migrationName,'customer special price migration is required');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', migrationName),
  'utf8',
);

assert.match(app, /async function persistCustomerPricingImmediately\(contact\)/);
assert.match(app, /sb\.from\('contacts'\)\.upsert\(row,\{onConflict:'id'\}\)/);
assert.match(app, /await persistCustomerPricingImmediately\(customer\)/);
assert.match(app, /save_customer_pricing/);
assert.match(app, /ราคาพิเศษของลูกค้ายังไม่ตรงกับข้อมูลบนระบบ/);

assert.match(migration, /create or replace function private\.resolve_customer_special_price/);
assert.match(migration, /contact\.type in \('customer', 'both'\)/);
assert.match(migration, /rule\.value ->> 'id' = v_rule_id/);
assert.match(migration, /rule\.value ->> 'productId' = p_product_id::text/);
assert.match(migration, /rule\.value ->> 'unit'.*= p_unit_name/);
assert.match(migration, /private\.is_safe_nonnegative_decimal\(rule\.value ->> 'price'\)/);
assert.match(migration, /v_match_count <> 1/);
assert.match(migration, /customer special price cannot be combined with a promotion/);
assert.match(migration, /v_expected_price := private\.resolve_customer_special_price/);
assert.match(migration, /complete_sale price guard does not match the expected version/);
assert.match(migration, /revoke all on function private\.resolve_customer_special_price/);

console.log('customer special price checkout tests passed');
