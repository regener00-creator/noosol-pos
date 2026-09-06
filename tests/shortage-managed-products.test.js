const assert = require('node:assert/strict');
const source = require('./load-app-source')();

assert.doesNotMatch(source, /ใช้ราคาพิเศษที่ตั้งไว้โดยอัตโนมัติ/);
const formStart = source.indexOf('function renderShortageOrderForm');
const formEnd = source.indexOf('function renderProductReturnForm', formStart);
const form = source.slice(formStart, formEnd);
assert.match(form, /shortage-form-grid[\s\S]*shortage-form-main[\s\S]*shortage-rep-summary/);
assert.match(source, /\.shortage-form-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'ข้อมูลผู้แทนต้องกว้างครึ่งหนึ่งของพื้นที่ส่วนบน');
assert.match(source, /\.shortage-form-controls\{[^}]*grid-template-columns:240px minmax\(0,1fr\) auto auto/, 'คอลัมน์วันที่ต้องพอดีกับช่องเพื่อให้ชื่อผู้แทนใช้พื้นที่ว่าง');
assert.match(form, /วันที่สั่ง[\s\S]*ชื่อผู้แทน[\s\S]*id="newPORepBtn"[\s\S]*id="shortageManagedProductsBtn"/);
assert.match(form, /shortage-note-field[\s\S]*หมายเหตุ/);
assert.doesNotMatch(form, /id="editPORepBtn"/, 'หน้าจดสั่งสินค้าต้องไม่มีปุ่มแก้ไขข้างชื่อผู้แทน');
assert.match(source, /from\('sales_representative_products'\)[\s\S]{0,220}\.eq\('representative_id',Number\(representative\.id\)\)/);
assert.match(source, /data-shortage-managed-product=/);
assert.match(source, /addDocumentScannedProduct\(product\.id,product\.unit\)/);

console.log('shortage managed products tests passed');
