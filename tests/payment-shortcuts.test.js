const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = require("./load-app-source")();
const start = html.indexOf('function openPaymentModal()');
const end = html.indexOf('function openCustomItemModal()', start);
assert.ok(start >= 0 && end > start, 'ไม่พบหน้าต่างเลือกวิธีชำระเงิน');

const paymentModal = html.slice(start, end);
assert.match(html, /id="checkoutBtn"[^>]*>\[F2\] เก็บเงิน<\/button>/);
assert.match(paymentModal, /\[F4\] เงินสด/);
assert.match(paymentModal, /\[F9\] โอนธนาคาร/);
assert.match(paymentModal, /\[F2\] รับเงินพอดี/);
assert.match(paymentModal, /e\.key==='F4'\?'cash':e\.key==='F9'\?'bank'/);
assert.match(paymentModal, /if\(e\.key==='F2'\)\{ e\.preventDefault\(\); if\(!e\.repeat\) applyCashKey\('exact'\); return; \}/);
assert.match(paymentModal, /if\(!e\.repeat\) content\.querySelector/);
assert.match(html, /if\(e\.key==='F2' && currentTab==='checkout'\)[\s\S]{0,140}e\.repeat\|\|document\.querySelector\('\.modal-overlay'\)/, 'F2 ต้องเปิดหน้าชำระจาก POS เพียงครั้งเดียว');
assert.doesNotMatch(html, /\[F9\] เก็บเงิน|\[F2\] เงินสด|\[F4\] โอนธนาคาร/, 'ต้องไม่เหลือข้อความคีย์ลัดชุดเดิม');

console.log('payment shortcut tests passed');
