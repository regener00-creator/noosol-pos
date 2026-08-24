const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const logicStart = html.indexOf('function filterSalesHistory(');
const logicEnd = html.indexOf('function renderHistory(', logicStart);
assert.ok(logicStart >= 0 && logicEnd > logicStart, 'ไม่พบ logic กรองประวัติการขาย');

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(logicStart, logicEnd), context);

const rows = [
  {id:'SALE-1',ref:'RE202608180002',date:'2026-08-18'},
  {id:'SALE-2',ref:'RE202608190001',date:'2026-08-19'},
  {id:'INV-20260820-01',date:'2026-08-20'},
];

assert.deepEqual(
  JSON.parse(JSON.stringify(context.filterSalesHistory(rows,{bill:'180002'},{from:'2026-08-18',to:'2026-08-20'}))),
  [rows[0]]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.filterSalesHistory(rows,{bill:'inv-2026'},{from:'2026-08-18',to:'2026-08-20'}))),
  [rows[2]]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.filterSalesHistory(rows,{bill:'sale-2'},{from:'2026-08-18',to:'2026-08-20'}))),
  [rows[1]]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.filterSalesHistory(rows,{bill:''},{from:'2026-08-19',to:'2026-08-19'}))),
  [rows[1]]
);

assert.match(html, /id="hf_bill"/);
assert.match(html, /placeholder="ค้นหาเลขบิล"/);
assert.match(html, /hfBill\.addEventListener\('keydown'/);

console.log('sales history filter tests passed');
