const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function openPaymentModal()');
const end = html.indexOf('function openCustomItemModal()', start);
assert.ok(start >= 0 && end > start, 'ไม่พบหน้าต่างเลือกวิธีชำระเงิน');

const paymentModal = html.slice(start, end);
assert.match(paymentModal, /\[F2\] เงินสด/);
assert.match(paymentModal, /\[F4\] โอนธนาคาร/);
assert.match(paymentModal, /e\.key==='F2'\?'cash':e\.key==='F4'\?'bank'/);
assert.match(paymentModal, /if\(!e\.repeat\) content\.querySelector/);

console.log('payment shortcut tests passed');
