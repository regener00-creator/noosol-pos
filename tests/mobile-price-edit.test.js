const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /function canEditMobilePrice\(user=loggedInUser\(\)\)/);
assert.match(html, /user\?\.owner===true&&Number\(user\?\.level\)===1/);
assert.match(html, /id="mobilePriceEditStock"/);
assert.match(html, /id="mobilePriceEditSale"/);
assert.match(html, /id="mobilePriceEditCost"/);
assert.match(html, /id="mobilePriceEditExpiry"/);
assert.match(html, /id="mobilePriceSaveChanges"/);
assert.match(html, /sb\.rpc\('owner_update_mobile_product'/);
assert.match(html, /document\.getElementById\('mobilePriceSaveChanges'\)\?\.addEventListener\('click',saveMobilePriceChanges\)/);

const payloadStart = html.indexOf('function mobilePriceEditPayload(');
const payloadEnd = html.indexOf('function mobilePriceResultHtml(', payloadStart);
assert.ok(payloadStart >= 0 && payloadEnd > payloadStart, 'ไม่พบฟังก์ชันคำนวณข้อมูลแก้ไขราคาบนมือถือ');

const context = {
  inspectionListUnitOptions(product) {
    return [
      { name: product.unit, factor: 1, price: product.price, cost: product.cost },
      ...(product.units || []).map(unit => ({ name: unit.sub, factor: unit.factor, price: unit.price, cost: unit.cost })),
    ];
  },
  stockBaseFromUnitAmount(amount, factor) {
    return Math.round((Number(amount) || 0) * (Number(factor) || 1) * 100) / 100;
  },
};
vm.createContext(context);
vm.runInContext(html.slice(payloadStart, payloadEnd), context);

const product = {
  id: 10,
  name: 'สินค้าทดสอบ',
  unit: 'กล่อง',
  price: 100,
  cost: 60,
  units: [{ sub: 'ลัง', factor: 12, price: 1100, cost: 650, barcode: 'CASE-10' }],
};

const main = context.mobilePriceEditPayload(product, 'กล่อง', {
  stock: '5', price: '120', cost: '70', expiry: '2027-10-10',
}, 2);
assert.equal(main.error, undefined);
assert.equal(main.stock, 5);
assert.equal(main.product.price, 120);
assert.equal(main.product.cost, 70);
assert.equal(main.product.units[0].price, 1100);
assert.equal(main.warehouseId, 2);

const caseUnit = context.mobilePriceEditPayload(product, 'ลัง', {
  stock: '2.5', price: '1250', cost: '700', expiry: '',
}, 3);
assert.equal(caseUnit.error, undefined);
assert.equal(caseUnit.stock, 30);
assert.equal(caseUnit.product.price, 100);
assert.equal(caseUnit.product.cost, 60);
assert.equal(caseUnit.product.units[0].price, 1250);
assert.equal(caseUnit.product.units[0].cost, 700);
assert.equal(caseUnit.product.units[0].barcode, 'CASE-10');

assert.match(context.mobilePriceEditPayload(product, 'กล่อง', { stock: '', price: 1, cost: 1, expiry: '' }, 1).error, /คงเหลือ/);
assert.match(context.mobilePriceEditPayload(product, 'กล่อง', { stock: 1, price: -1, cost: 1, expiry: '' }, 1).error, /ราคาขาย/);
assert.match(context.mobilePriceEditPayload(product, 'กล่อง', { stock: 1, price: 1, cost: -1, expiry: '' }, 1).error, /ทุน/);
assert.match(context.mobilePriceEditPayload(product, 'กล่อง', { stock: 1, price: 1, cost: 1, expiry: '10-10-2027' }, 1).error, /วันหมดอายุ/);

console.log('mobile price edit tests passed');
