const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function openPriceCheckModal()');
const end = html.indexOf('function printStockAlertReport(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบหน้าต่างเช็คราคาบนคอม');

const priceCheck = html.slice(start, end);
const skuIndex = priceCheck.indexOf('<span>รหัส</span>');
const unitIndex = priceCheck.indexOf('<span>หน่วย</span>');
const saleIndex = priceCheck.indexOf('<span>ขาย</span>');
const costIndex = priceCheck.indexOf('<span>ทุน</span>');
const expiryIndex = priceCheck.indexOf('<span>วันหมดอายุ</span>');
const stockIndex = priceCheck.indexOf('<span>คงเหลือ</span>');

assert.ok(skuIndex >= 0 && unitIndex > skuIndex && saleIndex > unitIndex && costIndex > saleIndex && expiryIndex > costIndex && stockIndex > expiryIndex);
assert.doesNotMatch(priceCheck, /<span>บาร์โค้ด<\/span>/);
assert.match(priceCheck, /pc-grid-placeholder/);

console.log('price check layout tests passed');
