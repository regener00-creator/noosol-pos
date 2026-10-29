const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();
const context = { businessSettings:{vat:'ยังไม่จดภาษีมูลค่าเพิ่ม',vatRegistrationDate:''}, currentDateStr:()=> '2026-08-25', products:[] };
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
context.businessSettings.vatRegistrationDate='2026-09-01';
assert.equal(context.effectiveProductVatMode({vat:'incl'}),'none', 'future VAT date must not activate VAT early');
context.businessSettings.vatRegistrationDate='2026-08-01';
assert.equal(context.effectiveProductVatMode({vat:'incl'}),'incl');

result = context.calculatePurchaseTaxSummary([{qty:2,price:100}],0,'excl');
assert.equal(result.beforeVat,200);
assert.equal(result.vat,14);
assert.equal(result.total,214);

result = context.calculatePurchaseTaxSummary([{qty:1,price:107}],0,'incl');
assert.equal(result.beforeVat,100);
assert.equal(result.vat,7);
assert.equal(result.total,107);

result = context.calculatePurchaseTaxSummary([{qty:1,price:107}],0,'none');
assert.equal(result.beforeVat,107);
assert.equal(result.vat,0);
assert.equal(result.total,107);

for(const [taxMode,price] of [['excl',1000],['incl',1070]]){
  result=context.calculateGoodsReceiptTaxSummary([{qty:1,price}],100,taxMode);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{registered:true,subtotal:1000,discount:100,beforeVat:900,vat:63,total:963,discountBeforeVat:true});
}
result=context.calculateGoodsReceiptTaxSummary([{qty:1,price:1000}],100,'none');
assert.equal(result.total,900);assert.equal(result.vat,0);
result=context.calculateGoodsReceiptTaxSummary([{qty:1,price:208366.50}],2083.67,'excl');
assert.equal(result.beforeVat,206282.83);assert.equal(result.vat,14439.80);assert.equal(result.total,220722.63);
result=context.calculateGoodsReceiptTaxSummary([{qty:1,price:100}],200,'excl');
assert.equal(result.discount,100);assert.equal(result.total,0);
result=context.calculateGoodsReceiptTaxSummary([{qty:1,price:0.08}],0,'incl');
assert.equal(result.total,0.08);assert.equal(result.beforeVat+result.vat,0.08);

assert.equal(context.saleTaxSummary({total:107,vat:7}).registered,false, 'legacy sale without explicit flag must not be treated as VAT sale');
assert.equal(context.saleTaxSummary({total:107,vat:7}).vat,0);

assert.match(html, /ไม่คิด VAT \(กิจการยังไม่จด VAT\)/);
assert.match(html, /vatRegistered,taxSummary,businessSnapshot/);
assert.match(html, /supplierTaxInvoiceNo/);
assert.match(html, /รายงานภาษี/);
assert.match(html, /feeTaxSummary/);
assert.match(html, /registered\?'ใบกำกับภาษีอย่างย่อ\/ใบเสร็จรับเงิน':'ใบเสร็จรับเงิน'/);
assert.match(html, /กิจการยังไม่จด VAT จึงสร้างใบกำกับภาษีไม่ได้/);
assert.match(html, /รายการขายนี้เกิดขึ้นขณะที่กิจการยังไม่จด VAT/);

console.log('VAT registration tests passed');
