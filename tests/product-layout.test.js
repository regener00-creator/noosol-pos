const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function renderProducts()');
const end = html.indexOf('function comboSelectorFor(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบฟังก์ชัน renderProducts');

const source = html.slice(start, end);
const actionsIndex = source.indexOf('<div class="product-list-actions form-final-actions">');
const groupIndex = source.indexOf('<div class="tree-pane">');
const searchIndex = source.indexOf('<div class="searchbar product-list-search"><input id="search"');
const tableIndex = source.indexOf('<div class="table-pane">');

assert.ok(actionsIndex >= 0, 'ไม่พบกลุ่มปุ่มสำหรับย้ายขึ้น topbar');
assert.ok(groupIndex > actionsIndex, 'กลุ่มปุ่มต้องอยู่ก่อนเนื้อหาหน้าสินค้าเพื่อให้ระบบย้ายขึ้น topbar');
assert.ok(groupIndex >= 0, 'ไม่พบกล่องกลุ่มสินค้า');
assert.ok(searchIndex > groupIndex, 'ช่องค้นหาต้องอยู่หลังกล่องกลุ่มสินค้า');
assert.ok(tableIndex > searchIndex, 'ช่องค้นหาต้องอยู่ก่อนตารางข้อมูลสินค้า');
assert.match(html, /\.product-list-search\{[^}]*max-width:none;[^}]*width:100%/);
assert.match(html, /\.product-list-actions\{[^}]*display:flex/);
assert.doesNotMatch(source, /product-head-search/);
assert.doesNotMatch(source, /pagehead product-pagehead/);

const renderStart = html.indexOf('function render(){');
const renderEnd = html.indexOf('function syncTopbarFormActions()', renderStart);
const renderSource = html.slice(renderStart, renderEnd);
const clearTopbarIndex = renderSource.indexOf("topbarFormActionsSlot.innerHTML=''");
const renderMainIndex = renderSource.indexOf("document.getElementById('main').innerHTML");
const attachEventsIndex = renderSource.indexOf('attachEvents();');
const syncTopbarIndex = renderSource.indexOf('syncTopbarFormActions();');
assert.ok(clearTopbarIndex >= 0 && clearTopbarIndex < renderMainIndex, 'ต้องล้างปุ่มเก่าใน topbar ก่อนสร้าง DOM หน้าใหม่');
assert.ok(renderMainIndex < attachEventsIndex && attachEventsIndex < syncTopbarIndex, 'ต้องผูก event ก่อนย้ายปุ่มจริงขึ้น topbar');
assert.match(html, /main\?main\.querySelector\('\.form-final-actions'\):null/);

console.log('product layout tests passed');
