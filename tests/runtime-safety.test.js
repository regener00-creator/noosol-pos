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

const mapped = sandbox.rowToProduct({
  id: 10366,
  sku: '10366',
  name: 'Favorite product',
  category: 'ยา',
  brand: 'TEST',
  product_type: 'stock',
  warehouse_id: 2,
  stock: 7,
  cost: 210,
  price: 320,
  unit: 'กล่อง',
  data: {price: undefined, stock: 999, barcode: '8850000000000'},
});
assert.equal(mapped.price, 320, 'flat price must restore an incomplete legacy data JSON');
assert.equal(mapped.stock, 7, 'flat stock must override a stale JSON stock value');
assert.equal(mapped.cost, 210);
assert.equal(mapped.name, 'Favorite product');
assert.equal(mapped.barcode, '8850000000000', 'JSON-only metadata must be preserved');

assert.equal(sandbox.fmtMoney(undefined), '0.00');
assert.equal(sandbox.fmtMoney(Number.NaN), '0.00');
assert.equal(sandbox.fmtMoney('320'), '320.00');

console.log('runtime safety tests passed');
