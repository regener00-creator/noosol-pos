const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { businessSettings:{vat:'ยังไม่จดภาษีมูลค่าเพิ่ม'} };
vm.createContext(context);

const helpersStart = html.indexOf('const VAT_RATE = 0.07;');
const helpersEnd = html.indexOf('let favorites =', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'ไม่พบ logic คำนวณ VAT');
vm.runInContext(html.slice(helpersStart, helpersEnd), context);

let result = context.calculateSaleTaxSummary([{amount:107,vatMode:'incl'}],0,false);
assert.deepEqual(JSON.parse(JSON.stringify(result)), {
  registered:false, subtotal:107, discount:0, beforeVat:107, vat:0, total:107,
});

result = context.calculateSaleTaxSummary([{amount:107,vatMode:'incl'}],0,true);
assert.equal(result.beforeVat,100);
assert.equal(result.vat,7);
assert.equal(result.total,107);

result = context.calculateSaleTaxSummary([{amount:100,vatMode:'excl'}],0,true);
assert.equal(result.subtotal,107);
assert.equal(result.beforeVat,100);
assert.equal(result.vat,7);
assert.equal(result.total,107);

result = context.calculateSaleTaxSummary([{amount:100,vatMode:'none'}],0,true);
assert.equal(result.beforeVat,100);
assert.equal(result.vat,0);
assert.equal(result.total,100);

result = context.calculateSaleTaxSummary([
  {amount:107,vatMode:'incl'},
  {amount:100,vatMode:'none'},
],20.7,true);
assert.equal(result.subtotal,207);
assert.equal(result.discount,20.7);
assert.equal(result.beforeVat,180);
assert.equal(result.vat,6.3);
assert.equal(result.total,186.3);

assert.equal(context.effectiveProductVatMode({vat:'incl'}),'none');
context.businessSettings.vat='จดภาษีมูลค่าเพิ่มแล้ว';
assert.equal(context.effectiveProductVatMode({vat:'excl'}),'excl');

assert.match(html, /ไม่คิด VAT — กิจการยังไม่จด VAT/);
assert.match(html, /vatRegistered,taxSummary,businessSnapshot/);
assert.match(html, /registered\?'ใบกำกับภาษีอย่างย่อ\/ใบเสร็จรับเงิน':'ใบเสร็จรับเงิน'/);
assert.match(html, /กิจการยังไม่จด VAT จึงสร้างใบกำกับภาษีไม่ได้/);
assert.match(html, /รายการขายนี้เกิดขึ้นขณะที่กิจการยังไม่จด VAT/);

console.log('VAT registration tests passed');
