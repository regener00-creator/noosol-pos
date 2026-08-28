const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function renderProducts()');
const end = html.indexOf('function comboSelectorFor(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบฟังก์ชัน renderProducts');

const source = html.slice(start, end);
const pageIndex = source.indexOf('<div class="product-list-page">');
const actionsIndex = source.indexOf('<div class="product-list-actions form-final-actions">');
const groupIndex = source.indexOf('<div class="tree-pane">');
const searchIndex = source.indexOf('<div class="searchbar product-list-search"><input id="search"');
const tableIndex = source.indexOf('<div class="table-pane">');

assert.ok(actionsIndex >= 0, 'ไม่พบกลุ่มปุ่มสำหรับย้ายขึ้น topbar');
assert.ok(groupIndex > actionsIndex, 'กลุ่มปุ่มต้องอยู่ก่อนเนื้อหาหน้าสินค้าเพื่อให้ระบบย้ายขึ้น topbar');
assert.ok(groupIndex >= 0, 'ไม่พบกล่องกลุ่มสินค้า');
assert.ok(searchIndex > groupIndex, 'ช่องค้นหาต้องอยู่หลังกล่องกลุ่มสินค้า');
assert.ok(tableIndex > searchIndex, 'ช่องค้นหาต้องอยู่ก่อนตารางข้อมูลสินค้า');
assert.match(source, /product-group-header[^>]*><span class="product-group-title">กลุ่มสินค้า<\/span><span class="product-group-separator">:<\/span><div class="product-group-categories">/, 'ชื่อและหมวดหลักต้องอยู่แถวเดียวกันในแถบสีฟ้า');
assert.match(source, /<div class="product-group-brands">\$\{brandHtml\}<\/div>/, 'หมวดย่อยต้องแสดงในพื้นที่สีขาวใต้แถบหมวดหลัก');
assert.match(source, /requestedCategoryOrder=\['ยา','อาหารเสริม','อื่นๆ','ไม่ทราบหมวดหมู่'\]/, 'หมวดหลักต้องเรียงตามลำดับที่กำหนด');
assert.match(source, /class="product-group-category \$\{active\?'active':''\}" data-product-category=/, 'หมวดหลักต้องกดเลือกได้');
assert.match(source, /class="product-group-brand \$\{active\?'active':''\}" data-product-category=.*data-product-brand=/, 'หมวดย่อยต้องกดเลือกได้');
assert.doesNotMatch(source, /tree-cat-row|tree-brand-flyout/, 'หน้ารายการสินค้าต้องไม่ใช้โครงสร้างหมวดหลักแนวตั้งเดิม');
assert.match(html, /\.product-list-search\{[^}]*max-width:none;[^}]*width:100%/);
assert.match(html, /\.product-list-actions\{[^}]*display:flex/);
assert.doesNotMatch(source, /product-head-search/);
assert.doesNotMatch(source, /pagehead product-pagehead/);
assert.doesNotMatch(source, /<th>บาร์โค้ด<\/th>/, 'หน้ารายการสินค้าต้องไม่แสดงคอลัมน์บาร์โค้ด');
assert.doesNotMatch(source, /col-barcode/, 'หน้ารายการสินค้าต้องไม่สร้างคอลัมน์บาร์โค้ด');
assert.match(source, /placeholder="ค้นหาจาก ชื่อ \/ รหัส \/ บาร์โค้ด"/, 'ยังต้องค้นหาด้วยบาร์โค้ดได้');

const renderStart = html.indexOf('function render(){');
const renderEnd = html.indexOf('function syncTopbarFormActions()', renderStart);
const renderSource = html.slice(renderStart, renderEnd);
const clearTopbarIndex = renderSource.indexOf("topbarFormActionsSlot.innerHTML=''");
const mainClassIndex = renderSource.indexOf("mainElement.classList.toggle('product-list-main'");
const renderMainIndex = renderSource.indexOf('mainElement.innerHTML');
const attachEventsIndex = renderSource.indexOf('attachEvents();');
const syncTopbarIndex = renderSource.indexOf('syncTopbarFormActions();');
assert.ok(clearTopbarIndex >= 0 && clearTopbarIndex < renderMainIndex, 'ต้องล้างปุ่มเก่าใน topbar ก่อนสร้าง DOM หน้าใหม่');
assert.ok(mainClassIndex >= 0 && mainClassIndex < renderMainIndex, 'ต้องล็อกแถบเลื่อนด้านนอกเฉพาะหน้ารายการสินค้าก่อน render');
assert.ok(renderMainIndex < attachEventsIndex && attachEventsIndex < syncTopbarIndex, 'ต้องผูก event ก่อนย้ายปุ่มจริงขึ้น topbar');
assert.match(html, /main\.querySelectorAll\('\.form-final-actions'\)/);
assert.match(html, /\.main\.product-list-main\{overflow-y:hidden;\}/);
assert.match(html, /\.product-list-page\{height:100%;min-height:0;\}/);
assert.match(html, /\.product-list-page \.table-pane\{[^}]*flex:1;[^}]*min-height:0;[^}]*display:flex/);
assert.match(html, /\.product-list-page \.product-table-scroll\{[^}]*height:auto;[^}]*min-height:0;[^}]*flex:1/);
assert.match(html, /\.product-list-page \.pager\{[^}]*flex:0 0 auto/);

console.log('product layout tests passed');
assert.ok(pageIndex >= 0 && pageIndex < actionsIndex, 'หน้ารายการสินค้าต้องมีกรอบควบคุมความสูงเฉพาะหน้า');
