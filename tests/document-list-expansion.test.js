const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function expandableDocumentItemRows(');
const end = html.indexOf('function documentItemsPreview(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบตัวช่วยแสดงสินค้าแบบกดขยาย');

const context = {
  expandedDocumentItemLists: new Set(),
  escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const items = [
  {name:'สินค้า 1',qty:1,unit:'กล่อง'},
  {name:'สินค้า 2',qty:2,unit:'ขวด'},
  {name:'สินค้า 3',qty:3,unit:'ชิ้น'},
  {name:'สินค้า 4',qty:4,unit:'แผง'},
];
const preview = context.expandableDocumentItemsPreview('receipt', 'RI-1', items);
assert.equal((preview.match(/doc-expandable-item-line/g) || []).length, 3, 'หน้ารายการต้องแสดงสินค้าไม่เกิน 3 รายการ');
assert.match(preview, /\+1 รายการ/);
assert.match(preview, /data-document-items-toggle=/);
assert.equal(context.expandableDocumentItemsDetailRow('receipt', 'RI-1', items, 10), '');

context.expandedDocumentItemLists.add('receipt:RI-1');
const detail = context.expandableDocumentItemsDetailRow('receipt', 'RI-1', items, 10);
assert.equal((detail.match(/class="doc-items-detail-item"/g) || []).length, 4, 'เมื่อขยายต้องเห็นสินค้าครบทุกรายการ');
assert.match(detail, /colspan="10"/);
assert.doesNotMatch(context.expandableDocumentItemsPreview('receipt', 'RI-2', items.slice(0, 3)), /data-document-items-toggle=/, 'สามรายการพอดีไม่ต้องมีปุ่มขยาย');

assert.match(html, /shortageAllItems\(po\.items,po\.id\)/);
assert.match(html, /expandableDocumentItemsPreview\('goods-receipt',g\.id,g\.items\)/);
assert.match(html, /expandableDocumentItemsPreview\('product-exchange',doc\.id,displayItems\)/);
assert.match(html, /expandableDocumentItemsPreview\('inspection',list\?\.id,inspectionListDisplayItems\(list\)\)/);
assert.match(html, /expandableDocumentItemsPreview\('transfer',t\.id,t\.items\)/);
assert.match(html, /data-document-items-toggle/);
assert.match(html, /expandedDocumentItemLists\.has\(key\)/);

console.log('document list expansion tests passed');
