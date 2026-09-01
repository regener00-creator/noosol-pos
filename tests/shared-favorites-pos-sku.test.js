const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = require("./load-app-source")();
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260827034723_shared_favorites.sql'), 'utf8');

assert.match(html, /upsert\(rows,\{onConflict:'product_id'\}\)/);
assert.match(html, /from\('favorites'\)\.select\('product_id'\)\)/);
assert.doesNotMatch(html, /from\('favorites'\)\.select\('product_id'\)\.eq\('user_id'/);
assert.match(html, /from\('favorites'\)\.delete\(\)\.in\('product_id',del\)/);
assert.match(html, /select\('product_id,unit,position,created_at'\)\.order\('position'\)/);

assert.match(migration, /primary key \(product_id\)/i);
assert.match(migration, /create policy favorites_shared_rows[\s\S]*for all to authenticated[\s\S]*using \(true\)/i);
assert.match(migration, /with check \(\(select auth\.uid\(\)\)=user_id\)/i);
assert.match(migration, /duplicate_rank>1/);

assert.match(html, /<th>รายการที่<\/th><th>บาร์โค้ดสินค้า<\/th><th>ชื่อ<\/th>/);
assert.match(html, /<col class="pt-idx"><col class="pt-barcode"><col class="pt-name">/);
assert.match(html, /<td class="mono">\$\{escapeHtml\(productBarcodeForUnit\(p,line\.unit\)\|\|'-'\)\}<\/td>/);
assert.match(html, /colspan="8" class="pos-empty"/);

console.log('shared favorites and POS SKU tests passed');
