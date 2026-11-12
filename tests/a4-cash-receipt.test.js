const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = require("./load-app-source")();
const start = html.indexOf('function printA4CashReceipt(');
const end = html.indexOf('function openFullTaxInvoiceModal(', start);

assert.ok(start >= 0 && end > start, 'ไม่พบฟังก์ชันพิมพ์ใบเสร็จรับเงิน A4');
const receiptLogic = html.slice(start, end);

assert.doesNotMatch(html, /id="wantA4ReceiptBtn"/, 'หน้าชำระเงินสำเร็จต้องไม่มีตัวเลือกบิลเงินสด A4');
assert.doesNotMatch(html, /id="historyA4ReceiptBtn"/, 'ประวัติการขายต้องไม่มีตัวเลือกบิลเงินสด A4');
assert.match(html, /\['cashbill','บิลเงินสด'/, 'หมวดใบรายการต้องมีเมนูบิลเงินสด');
assert.match(html, /cashbill: \(\)=>renderCashBills\(\)/, 'ต้องมีหน้ารายการบิลเงินสดที่โหลดโค้ดเมื่อเปิดหน้า');
assert.match(html, /<option value="none"[^>]*>ไม่ระบุ<\/option>/, 'สถานประกอบการต้องเลือกไม่ระบุได้');
assert.match(html, /branch:branchValue==='branch'\?'branch':branchValue==='head'\?'head':'none'/, 'ต้องบันทึกสถานประกอบการแบบไม่ระบุได้');
assert.match(receiptLogic, /<div class="title">บิลเงินสด<\/div>/, 'หัวเอกสาร A4 ต้องเป็นบิลเงินสด');
assert.match(receiptLogic, /customerBranch\?` \(\$\{customerBranch\}\)`:''/, 'เอกสารต้องไม่แสดงวงเล็บสถานประกอบการเมื่อไม่ระบุ');
assert.match(receiptLogic, /เอกสารนี้ไม่ใช่ใบกำกับภาษี/, 'ต้องระบุว่าเอกสารไม่ใช่ใบกำกับภาษี');
assert.match(receiptLogic, /business=documentBusinessSettings\(sale\)/);
assert.match(receiptLogic, /businessPrimaryPhone\(business\)[\s\S]{0,180}business\.line\?`<br>LINE \$\{escapeHtml\(business\.line\)\}`/, 'บิลเงินสดต้องแสดง LINE ใต้เบอร์โทรเมื่อมีข้อมูล');
assert.doesNotMatch(receiptLogic, /ภาษีมูลค่าเพิ่ม 7%|VAT INCLUDED/, 'บิลเงินสด A4 ต้องไม่แสดงยอด VAT');
assert.doesNotMatch(receiptLogic, /complete_sale|adjust_inventory|inventory_count/, 'การพิมพ์เอกสารต้องไม่สร้างยอดขายหรือตัดสต็อก');
assert.match(receiptLogic, /sale\.cashReceiptA4Meta=meta/, 'ต้องเก็บประวัติการพิมพ์ A4 ไว้กับบิลเดิม');

console.log('a4 cash receipt tests passed');

assert.match(receiptLogic,/number:old\.number,saleDate/);
