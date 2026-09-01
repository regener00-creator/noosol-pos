const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = require("./load-app-source")();
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260828082142_configurable_document_prefixes.sql'), 'utf8');

for (const [key, value] of [
  ['cashBill','CB'],
  ['inspection','CHECK'],
  ['stockAdjustment','SC'],
  ['cashShift','CS'],
]) {
  assert.match(html, new RegExp(`${key}:'${value}'`), `ต้องมีค่าเริ่มต้น ${key}`);
  assert.match(html, new RegExp(`key:'${key}'`), `ต้องมีช่องตั้งค่า ${key}`);
}

assert.match(html, /saved\.id=`\$\{documentPrefixes\.inspection\}-\$\{String\(inspectionListCounter\+\+\)\.padStart\(4,'0'\)\}`/);
assert.match(html, /function nextA4CashReceiptNumber\(\)[\s\S]{0,260}documentPrefixes\.cashBill/);
assert.match(html, /number:old\.number\|\|nextA4CashReceiptNumber\(\)/);
assert.match(migration, /private\.configured_document_prefix\(''stockAdjustment'',''SC''\)/);
assert.match(migration, /private\.configured_document_prefix\('cashShift','CS'\)/);
assert.match(migration, /revoke execute on function private\.configured_document_prefix\(text,text\)[\s\S]*from public,anon,authenticated/);

const numberHelpersStart = html.indexOf('function docNumberParts(');
const numberHelpersEnd = html.indexOf('function docCounter(', numberHelpersStart);
const cashNumberStart = html.indexOf('function nextA4CashReceiptNumber(');
const cashNumberEnd = html.indexOf('function nextFullTaxInvoiceNumber(', cashNumberStart);
assert.ok(numberHelpersStart >= 0 && numberHelpersEnd > numberHelpersStart);
assert.ok(cashNumberStart >= 0 && cashNumberEnd > cashNumberStart);

const context = {
  TODAY_STR: '2026-08-28',
  documentPrefixes: {cashBill:'CB'},
  salesHistory: [
    {cashReceiptA4Meta:{number:'CB202608280001'}},
    {cashReceiptA4Meta:{number:'CB202608280003'}},
    {cashReceiptA4Meta:{number:'CB202608270009'}},
    {ref:'RE202608280099'},
  ],
};
vm.createContext(context);
vm.runInContext(html.slice(numberHelpersStart, numberHelpersEnd), context);
vm.runInContext(html.slice(cashNumberStart, cashNumberEnd), context);
assert.equal(context.nextA4CashReceiptNumber(), 'CB202608280004');
context.documentPrefixes.cashBill = 'CASH';
context.salesHistory.push({cashReceiptA4Meta:{number:'CASH202608280007'}});
assert.equal(context.nextA4CashReceiptNumber(), 'CASH202608280008');

console.log('document prefix tests passed');
