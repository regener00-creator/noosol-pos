const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationName = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .find((name) => name.endsWith('_bounded_retention_and_event_dedupe.sql'));

assert.ok(migrationName, 'migration containing the database blocker must exist');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', migrationName),
  'utf8',
);

assert.match(migration, /create or replace function private\.document_data_references_product/i);
assert.match(migration, /jsonb_typeof\(coalesce\(p_data, '\{\}'::jsonb\) -> v_key\) <> 'array'/i);
assert.match(migration, /jsonb_array_elements\(coalesce\(p_data, '\{\}'::jsonb\) -> v_key\)/i);
assert.match(migration, /v_item ->> 'productId'/i);
assert.match(migration, /v_item ->> 'pid'/i);
assert.match(migration, /'\^\[1-9\]\[0-9\]\{0,17\}\$'/i);
assert.match(migration, /revoke all on function private\.document_data_references_product[\s\S]*service_role/i);

const wrapperStart = migration.lastIndexOf('create or replace function public.change_product_base_unit(');
assert.ok(wrapperStart >= 0, 'latest change_product_base_unit wrapper must exist');
const wrapper = migration.slice(wrapperStart);

assert.match(wrapper, /security definer\s+set search_path = ''/i);
assert.match(wrapper, /perform private\.acquire_store_mutation_gate\(\)/i);
assert.match(wrapper, /if auth\.uid\(\) is null[\s\S]*authentication required/i);
assert.match(wrapper, /if not private\.is_current_owner\(\)[\s\S]*owner access required/i);
assert.match(wrapper, /from public\.sales sale[\s\S]*sale\.status[\s\S]*'hold'/i);
assert.match(wrapper, /from public\.goods_receipts document[\s\S]*inventory_document_is_posted[\s\S]*array\['items'\]/i);
assert.match(wrapper, /from public\.product_returns document[\s\S]*inventory_document_is_posted[\s\S]*array\['items'\]/i);
assert.match(wrapper, /from public\.transfers document[\s\S]*stockApplied[\s\S]*in \('false', 'f', '0', 'no', 'off'\)/i);
assert.match(wrapper, /from public\.product_exchanges document[\s\S]*incomingApplied[\s\S]*รับสินค้ากลับแล้ว[\s\S]*array\['outgoingItems', 'incomingItems'\]/i);
assert.match(wrapper, /return public\.change_product_base_unit_core_20260831\(/i);
assert.match(wrapper, /revoke all on function public\.change_product_base_unit[\s\S]*from public, anon, authenticated/i);
assert.match(wrapper, /grant execute on function public\.change_product_base_unit[\s\S]*to authenticated/i);

const coreCall = wrapper.indexOf('return public.change_product_base_unit_core_20260831(');
for (const blocker of [
  'from public.sales sale',
  'from public.goods_receipts document',
  'from public.product_returns document',
  'from public.transfers document',
  'from public.product_exchanges document',
]) {
  assert.ok(wrapper.indexOf(blocker) >= 0 && wrapper.indexOf(blocker) < coreCall,
    `${blocker} guard must run before the core conversion`);
}

console.log('base unit database guard tests passed');
