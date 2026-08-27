const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0044_allow_sale_lot_shortages.sql'), 'utf8');

assert.match(migration, /create or replace function private\.inventory_lot_shortage_delta/);
assert.match(migration, /movement_type in \(\s*'sale_shortage','sale_shortage_void','stock_count_shortage_reconcile'/);
assert.match(migration, /create or replace function private\.ensure_inventory_shortage_lot/);
assert.match(migration, /quantity_base,unit_cost_base[\s\S]*0,0,clock_timestamp\(\),'sale_shortage'/);
assert.match(migration, /create or replace function private\.refresh_inventory_balance_from_lots/);
assert.match(migration, /v_stock:=v_lot_stock\+v_shortage/);

const saleFunctionStart = migration.indexOf('create or replace function public.post_sale_inventory_lots(');
const countWrapperStart = migration.indexOf('create or replace function public.post_inventory_count_adjustment_with_shortages(', saleFunctionStart);
assert.ok(saleFunctionStart >= 0 && countWrapperStart > saleFunctionStart, 'missing sale shortage posting function');
const saleFunction = migration.slice(saleFunctionStart, countWrapperStart);
assert.match(saleFunction, /'sale_shortage',-v_need,0/);
assert.match(saleFunction, /'pendingLot',true/);
assert.match(saleFunction, /'shortageBaseQty',v_shortage_total/);
assert.doesNotMatch(saleFunction, /insufficient non-expired lot stock/);
assert.doesNotMatch(migration, /drop constraint.*quantity_base/is, 'physical Lot quantities must remain non-negative');

assert.match(migration, /create or replace function public\.post_inventory_count_adjustment_with_shortages/);
assert.match(migration, /'stock_count_shortage_reconcile',abs\(v_shortage\),0/);
assert.match(migration, /v_result:=public\.post_inventory_count_adjustment/);
assert.match(migration, /revoke execute on function public\.post_inventory_count_adjustment\(bigint,text,text,text,jsonb\) from authenticated/);
assert.match(migration, /grant execute on function public\.post_inventory_count_adjustment_with_shortages\(bigint,text,text,text,jsonb\) to authenticated/);

assert.match(migration, /create or replace function public\.void_sale/);
assert.match(migration, /if v_pending or v_lot\.source_type='sale_shortage' then/);
assert.match(migration, /'sale_shortage_void',v_quantity,0/);

assert.match(html, /sb\.rpc\('post_inventory_count_adjustment_with_shortages'/);
assert.match(html, /if\(allocation\?\.pendingLot\) return/);
assert.match(html, /รอจัด LOT · \$\{escapeHtml\(inventoryMovementRound\(allocation\.baseQty\)\)\}/);
assert.match(html, /สต๊อกอาจติดลบ/);
assert.doesNotMatch(html, /สต๊อก Lot ที่ยังไม่หมดอายุมีไม่เพียงพอ กรุณาตรวจ Lot สินค้า/);

console.log('sale Lot shortage tests passed');
