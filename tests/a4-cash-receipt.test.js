const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function printA4CashReceipt(');
const end = html.indexOf('function openFullTaxInvoiceModal(', start);

assert.ok(start >= 0 && end > start, 'ไม่พบฟังก์ชันพิมพ์ใบเสร็จรับเงิน A4');
const receiptLogic = html.slice(start, end);

assert.match(html, /id="wantA4ReceiptBtn"/, 'หลังชำระเงินต้องมีตัวเลือกใบเสร็จ A4');
assert.match(html, /id="historyA4ReceiptBtn"/, 'ประวัติการขายต้องมีตัวเลือกใบเสร็จ A4');
assert.match(receiptLogic, /ใบเสร็จรับเงิน \/ บิลเงินสด/, 'หัวเอกสาร A4 ไม่ถูกต้อง');
assert.match(receiptLogic, /เอกสารนี้ไม่ใช่ใบกำกับภาษี/, 'ต้องระบุว่าเอกสารไม่ใช่ใบกำกับภาษี');
assert.doesNotMatch(receiptLogic, /ภาษีมูลค่าเพิ่ม 7%|VAT INCLUDED/, 'บิลเงินสด A4 ต้องไม่แสดงยอด VAT');
assert.doesNotMatch(receiptLogic, /complete_sale|adjust_inventory|inventory_count/, 'การพิมพ์เอกสารต้องไม่สร้างยอดขายหรือตัดสต๊อก');
assert.match(receiptLogic, /old\.number\|\|shortReceiptNumber\(sale\)/, 'A4 ต้องใช้เลขใบเสร็จเดิมของบิลขาย');
assert.match(receiptLogic, /sale\.cashReceiptA4Meta=meta/, 'ต้องเก็บประวัติการพิมพ์ A4 ไว้กับบิลเดิม');

console.log('a4 cash receipt tests passed');
