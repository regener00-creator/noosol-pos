const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function functionSource(name, nextName) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `ต้องพบฟังก์ชัน ${name}`);
  return html.slice(start, end);
}

const cashBills = functionSource('renderCashBills', 'searchCashBillOrder');
const taxInvoices = functionSource('renderTaxInvoices', 'deleteTaxInvoiceFromSale');
const quotations = functionSource('renderQuotation', 'openNewQuotationForm');

for (const [label, source] of [['บิลเงินสด', cashBills], ['ใบกำกับภาษีเต็มรูปแบบ', taxInvoices], ['ใบเสนอราคา', quotations]]) {
  assert.doesNotMatch(source, /return `<div class="rpt">/, `${label} ต้องไม่ถูกจำกัดความกว้างด้วย rpt`);
  assert.match(source, /return `<div class="pagehead">/, `${label} ต้องเริ่มด้วยหัวหน้าเอกสารแบบเต็มพื้นที่`);
  assert.match(source, /class="doc-list-wrap/, `${label} ต้องคงกรอบตารางรายการเอกสาร`);
}

console.log('document full-width layout tests passed');
