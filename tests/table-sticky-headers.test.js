const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(
  html,
  /\.main table thead th\{[^}]*position:sticky;[^}]*top:0;[^}]*z-index:4;/,
  'หัวตารางทุกหน้าในพื้นที่หลักต้องยึดด้านบนขณะเลื่อน'
);
assert.match(
  html,
  /table\{[^}]*overflow:clip;/,
  'ตัวตารางต้องไม่สร้างพื้นที่เลื่อนซ้อนที่ขวาง sticky header'
);

for (const selector of [
  '\\.doc-list-wrap',
  '\\.seamless-table-wrap',
  '\\.goods-receipt-items',
  '\\.warehouse-name-table',
  '\\.transfer-items-wrap\\.seamless-table-wrap',
]) {
  assert.match(
    html,
    new RegExp(`${selector}\\{[^}]*overflow:clip;`),
    `${selector} ต้องตัดมุมโดยไม่ขวาง sticky header`
  );
}

assert.match(
  html,
  /\.document-centered-items,\.shortage-document-items\{[^}]*overflow:clip;/,
  'ตารางรายการในฟอร์มเอกสารต้องไม่ขวาง sticky header'
);

console.log('table sticky header tests passed');
