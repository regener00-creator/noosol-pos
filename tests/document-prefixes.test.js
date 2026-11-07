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

assert.match(html,/reserveDraftNumber\(draft,'inspection'\)/);
assert.match(html,/reserve_shop_document_number/);
assert.doesNotMatch(html,/nextDailySeq\(/);
assert.match(html,/number:old\.number,saleDate/);
console.log('Document prefix and server assignment tests passed');
