const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dateStart = html.indexOf('function dmyToISO(');
const dateEnd = html.indexOf('function dmyDateFieldHtml(', dateStart);
assert.ok(dateStart >= 0 && dateEnd > dateStart, 'ไม่พบฟังก์ชันแปลงวันที่ที่พิมพ์เอง');

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(dateStart, dateEnd), context);

assert.equal(context.dmyToISO('05-07-2027'), '2027-07-05');
assert.equal(context.dmyToISO('5/7/2027'), '2027-07-05');
assert.equal(context.dmyToISO('29-02-2028'), '2028-02-29');
assert.equal(context.dmyToISO('29-02-2027'), null);
assert.equal(context.dmyToISO('31-04-2027'), null);
assert.equal(context.dmyToISO('2027-07-05'), null);
assert.equal(context.formatDMYInput('05072027'), '05-07-2027');

assert.match(html, /class="lot-edit-expiry"[^>]*inputmode="numeric"/);
assert.match(html, /update_inventory_lot_details/);
assert.match(html, /หมดอายุใกล้สุด/);
assert.match(html, /placeholder="วว-ดด-ปปปป"/);
assert.match(html, /id="mobilePriceEditExpiry"[^>]*type="text"[^>]*inputmode="numeric"/);
assert.doesNotMatch(html, /id="mobilePriceEditExpiry"[^>]*type="date"/);
assert.match(html, /await setProductExpiryOnSupabase\(pid,expiry,activeWarehouseId\)/);
assert.match(html, /กรุณากรอกวันหมดอายุเป็น วัน-เดือน-ปี เช่น 05-07-2027/);

console.log('manual expiry edit tests passed');
