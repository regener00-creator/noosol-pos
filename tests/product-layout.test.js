const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function renderProducts()');
const end = html.indexOf('function comboSelectorFor(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบฟังก์ชัน renderProducts');

const source = html.slice(start, end);
const groupIndex = source.indexOf('<div class="tree-pane">');
const searchIndex = source.indexOf('<div class="searchbar product-list-search"><input id="search"');
const tableIndex = source.indexOf('<div class="table-pane">');

assert.ok(groupIndex >= 0, 'ไม่พบกล่องกลุ่มสินค้า');
assert.ok(searchIndex > groupIndex, 'ช่องค้นหาต้องอยู่หลังกล่องกลุ่มสินค้า');
assert.ok(tableIndex > searchIndex, 'ช่องค้นหาต้องอยู่ก่อนตารางข้อมูลสินค้า');
assert.match(html, /\.product-list-search\{[^}]*max-width:none;[^}]*width:100%/);
assert.doesNotMatch(source, /product-head-search/);

console.log('product layout tests passed');
