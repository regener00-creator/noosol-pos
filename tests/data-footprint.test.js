const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = require("./load-app-source")();
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260901021726_optimize_persisted_data_footprint.sql'),
  'utf8'
);

assert.match(html, /let warehouses=\[\];/);
assert.match(html, /let products=\[\];/);
assert.match(html, /let contacts=\[\];/);
assert.match(html, /let salesRepresentatives=\[\];/);
assert.match(html, /let salesHistory=\[\];/);
assert.doesNotMatch(html, /generateMockSalesHistory/);
assert.doesNotMatch(html, /syncSalesHistoryToSupabase/);
assert.doesNotMatch(html, /persistSalesHistory/);
assert.equal(fs.existsSync(path.join(root, 'supabase-config.js')), false, 'unused config module must stay removed');

const localSnapshotStart = html.indexOf('function localWorkspaceSnapshot(');
const localSnapshotEnd = html.indexOf('function refreshDataCounters(', localSnapshotStart);
const localSnapshot = html.slice(localSnapshotStart, localSnapshotEnd);
assert.match(localSnapshot, /delete snapshot\.products/);
assert.match(localSnapshot, /delete snapshot\.salesHistory/);

const mapperStart = html.indexOf('const PRODUCT_DUPLICATE_DATA_KEYS=');
const mapperEnd = html.indexOf('// Supabase\/PostgREST caps', mapperStart);
const mapperSandbox = {};
vm.createContext(mapperSandbox);
vm.runInContext(
  `${html.slice(mapperStart, mapperEnd)}; this.productToRow=productToRow; this.warehouseToRow=warehouseToRow; this.contactToRow=contactToRow;`,
  mapperSandbox
);
const productRow = mapperSandbox.productToRow({
  id: 1, sku: 'P0001', name: 'ยา', category: 'ยา', brand: 'A', type: 'stock',
  wh: 2, stock: 15, cost: 3, price: 5, unit: 'กล่อง', expiry: '2030-01-01', barcode: '885', threshold: 2,
});
assert.equal(Object.hasOwn(productRow, 'stock'), false, 'product catalog writes must not include products.stock');
for (const key of ['id','sku','name','category','brand','type','wh','stock','cost','price','unit','expiry']) {
  assert.equal(Object.hasOwn(productRow.data, key), false, `product data must not duplicate ${key}`);
}
assert.equal(productRow.data.barcode, '885');
assert.equal(productRow.data.threshold, 2);

const warehouseRow = mapperSandbox.warehouseToRow({id: 2, name: 'คลัง', code: 'WH-2'});
assert.deepEqual(JSON.parse(JSON.stringify(warehouseRow.data)), {code: 'WH-2'});
const contactRow = mapperSandbox.contactToRow({id: 3, name: 'ลูกค้า', phone: '081', types: ['customer'], note: 'x'});
assert.deepEqual(JSON.parse(JSON.stringify(contactRow.data)), {note: 'x'});

const businessStart = html.indexOf('const BUSINESS_DOCUMENT_SNAPSHOT_KEYS=');
const businessEnd = html.indexOf('function businessTypeTaxIdHint(', businessStart);
const businessSandbox = {};
vm.createContext(businessSandbox);
vm.runInContext(`${html.slice(businessStart, businessEnd)}; this.snapshot=businessDocumentSnapshot;`, businessSandbox);
const businessSnapshot = businessSandbox.snapshot({name: 'ร้าน', taxId: '123', priceLabelTemplates: {large: true}, medicineLabelDoseUnits: ['เม็ด']});
assert.equal(businessSnapshot.name, 'ร้าน');
assert.equal(businessSnapshot.taxId, '123');
assert.equal(Object.hasOwn(businessSnapshot, 'priceLabelTemplates'), false);
assert.equal(Object.hasOwn(businessSnapshot, 'medicineLabelDoseUnits'), false);

assert.match(migration, /products_catalog_stock_retired_check check \(stock is null\)/i);
assert.match(migration, /create trigger normalize_product_storage/i);
assert.match(migration, /create trigger normalize_sale_business_snapshot/i);
assert.match(migration, /private\.strip_product_duplicate_data\(data\)/i);
const refreshStart = migration.indexOf('create or replace function private.refresh_inventory_balance_from_lots');
const refreshEnd = migration.indexOf('-- Preserve values currently preferred', refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
assert.doesNotMatch(migration.slice(refreshStart, refreshEnd), /update public\.products/i, 'stock refresh must not touch product catalog rows');

console.log('data footprint tests passed');
