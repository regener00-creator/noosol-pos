const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(
  html,
  /\.app-table-scroll-region\{[^}]*max-height:var\(--app-table-scroll-height[^}]*overflow:auto!important;/,
  'กรอบตารางกลางต้องเป็นพื้นที่เลื่อนภายในและจำกัดความสูงตามพื้นที่หน้าจอ'
);
assert.match(
  html,
  /\.app-table-scroll-region table thead th\{[^}]*position:sticky;[^}]*top:0;/,
  'หัวตารางต้องค้างอยู่ด้านบนของกรอบเลื่อน'
);

const prepareStart = html.indexOf('function prepareScrollableTables(');
const renderersStart = html.indexOf('const RENDERERS = {', prepareStart);
assert.ok(prepareStart >= 0 && renderersStart > prepareStart, 'ต้องเตรียมกรอบเลื่อนส่วนกลางก่อนประกาศตัว render หน้า');

const prepareSource = html.slice(prepareStart, renderersStart);
assert.match(prepareSource, /mainElement\.querySelectorAll\('table'\)/, 'ต้องครอบคลุมตารางทุกตัวในพื้นที่หน้าหลัก');
assert.match(prepareSource, /document\.createElement\('div'\)/, 'ตารางที่ยังไม่มีกล่องครอบต้องสร้างพื้นที่เลื่อนให้อัตโนมัติ');
assert.match(prepareSource, /host\.classList\.add\('app-table-scroll-region'\)/, 'กล่องตารางเดิมต้องได้รับพฤติกรรมเลื่อนส่วนกลาง');

const renderStart = html.indexOf('function render(){');
const renderEnd = html.indexOf('function storeResetConfig(', renderStart);
const renderSource = html.slice(renderStart, renderEnd);
const htmlIndex = renderSource.indexOf('mainElement.innerHTML');
const prepareIndex = renderSource.indexOf('prepareScrollableTables(mainElement)');
const attachIndex = renderSource.indexOf('attachEvents();');
assert.ok(htmlIndex >= 0 && htmlIndex < prepareIndex && prepareIndex < attachIndex, 'ต้องสร้างกรอบตารางหลังเขียน HTML และก่อนผูก event');
assert.match(renderSource, /requestAnimationFrame\(\(\)=>refreshScrollableTableHeights\(mainElement\)\)/, 'ต้องคำนวณความสูงใหม่หลังย้ายปุ่มขึ้น topbar');

assert.match(html, /else refreshScrollableTableHeights\(\);/, 'ต้องปรับความสูงตารางเมื่อขนาดหน้าต่างเปลี่ยน');

console.log('table internal scroll tests passed');
