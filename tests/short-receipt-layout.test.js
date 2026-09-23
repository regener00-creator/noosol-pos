const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = require("./load-app-source")();
const start = html.indexOf('function printShortReceipt(');
const end = html.indexOf('\nasync function doCheckout', start);
const receiptCode = html.slice(start, end);
const modalStart = html.indexOf('function openPostPaymentModal(');
const modalCode = html.slice(modalStart, start);

assert.ok(start >= 0 && end > start, 'printShortReceipt must exist');
assert.match(receiptCode, /grid-template-columns:minmax\(0,1fr\) 19mm/, 'receipt item must reserve only name and amount columns');
assert.doesNotMatch(receiptCode, /<span>\$\{index\+1\}<\/span>/, 'receipt items must not display a leading sequence number');
assert.match(receiptCode, /receiptBusiness=\{\.\.\.\(sale\.businessSnapshot\|\|businessSettings\),line:sale\.businessSnapshot\?\.line\|\|businessSettings\.line\|\|''\}/, 'historical receipt without LINE must use current business LINE');
assert.match(receiptCode, /receiptFooter&&receiptBusiness\.line[\s\S]{0,180}win\.document\.createElement\('div'\)[\s\S]{0,100}line\.textContent=`LINE \$\{receiptBusiness\.line\}`[\s\S]{0,100}receiptFooter\.appendChild\(line\)/, 'receipt must show LINE below the phone');
assert.match(modalCode, /const documentLabel='ใบเสร็จอย่างย่อ'/, 'payment confirmation must offer the short receipt');
assert.doesNotMatch(modalCode, /receiptPrintStarted|กรุณาเปิด.*ก่อนเริ่มออเดอร์ใหม่/, 'closing payment confirmation must not require printing');
assert.match(modalCode, /finishAndPrintButton\.onclick=\(\)=>\{\s*if\(!printShortReceipt\(saleId\)\) return;/, 'print action must keep the modal open when the preview is blocked');
assert.doesNotMatch(modalCode, /preferredDocument|openA4CashReceiptModal\(saleId\)|startTaxInvoiceForm\(saleId\)/, 'payment completion must not use a hidden customer document preference');
assert.match(receiptCode, /setTimeout\(\(\)=>win\.print\(\),350\);\s*return true;/, 'receipt printer must report a successfully opened print preview');

console.log('short receipt layout tests passed');
