const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const mapperStart = html.indexOf('function rowToProduct(');
const mapperEnd = html.indexOf('function warehouseToRow(', mapperStart);
const moneyStart = html.indexOf('function fmtMoney(');
const moneyEnd = html.indexOf('function escapeHtml(', moneyStart);
assert.ok(mapperStart >= 0 && mapperEnd > mapperStart, 'rowToProduct must be extractable');
assert.ok(moneyStart >= 0 && moneyEnd > moneyStart, 'fmtMoney must be extractable');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${html.slice(mapperStart, mapperEnd)}\n${html.slice(moneyStart, moneyEnd)}\nthis.rowToProduct=rowToProduct; this.fmtMoney=fmtMoney;`, sandbox);

const legacyMapped = sandbox.rowToProduct({
  id: 10366,
  sku: null,
  name: '',
  category: null,
  brand: null,
  product_type: null,
  warehouse_id: 2,
  stock: 7,
  cost: 0,
  price: 0,
  unit: null,
  data: {
    sku: '10366',
    name: 'Favorite product',
    category: 'ยา',
    brand: 'TEST',
    type: 'stock',
    wh: 1,
    stock: 999,
    cost: 210,
    price: 320,
    unit: 'กล่อง',
    barcode: '8850000000000',
  },
});
assert.equal(legacyMapped.price, 320, 'legacy JSON price must not be replaced by a zero flat value');
assert.equal(legacyMapped.stock, 7, 'flat stock must override a stale JSON stock value');
assert.equal(legacyMapped.cost, 210);
assert.equal(legacyMapped.name, 'Favorite product');
assert.equal(legacyMapped.sku, '10366');
assert.equal(legacyMapped.unit, 'กล่อง');
assert.equal(legacyMapped.wh, 1);
assert.equal(legacyMapped.barcode, '8850000000000', 'JSON-only metadata must be preserved');

const incompleteMapped = sandbox.rowToProduct({
  id: 10367,
  name: 'Flat fallback product',
  price: 450,
  stock: 3,
  data: {price: undefined},
});
assert.equal(incompleteMapped.price, 450, 'flat price must fill an incomplete JSON value');
assert.equal(incompleteMapped.name, 'Flat fallback product');

assert.equal(sandbox.fmtMoney(undefined), '0.00');
assert.equal(sandbox.fmtMoney(Number.NaN), '0.00');
assert.equal(sandbox.fmtMoney('320'), '320.00');

console.log('runtime safety tests passed');
