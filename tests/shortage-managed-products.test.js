const assert = require('node:assert/strict');
const source = require('./load-app-source')();

assert.doesNotMatch(source, /ใช้ราคาพิเศษที่ตั้งไว้โดยอัตโนมัติ/);
assert.match(source, /id="shortageManagedProductsBtn"[^>]*>สินค้าที่ดูแล<\/button><div class="shortage-date-field"><label>วันที่สั่ง/);
assert.match(source, /from\('sales_representative_products'\)[\s\S]{0,220}\.eq\('representative_id',Number\(representative\.id\)\)/);
assert.match(source, /data-shortage-managed-product=/);
assert.match(source, /addDocumentScannedProduct\(product\.id,product\.unit\)/);

console.log('shortage managed products tests passed');
