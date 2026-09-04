const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = require('./load-app-source')();
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260904073106_allow_void_sales_with_short_receipts.sql'),
  'utf8',
);

const voidStart = source.indexOf('async function voidSaleHistory(');
const voidEnd = source.indexOf('function saleLotCorrectionAllocations(', voidStart);
assert.ok(voidStart >= 0 && voidEnd > voidStart, 'ไม่พบขั้นตอนยกเลิกบิล');
const voidSource = source.slice(voidStart, voidEnd);

assert.match(source, /function openVoidSaleReasonModal\(/, 'ต้องมีหน้าต่างกรอกเหตุผลยกเลิกบิล');
assert.match(source, /id="voidSaleReason"[\s\S]*required/, 'เหตุผลยกเลิกบิลต้องเป็นข้อมูลบังคับ');
assert.match(source, /ระบบจะเก็บใบเสร็จเดิมไว้เป็นประวัติ/, 'ต้องแจ้งว่าเก็บใบเสร็จเดิมไว้');
assert.doesNotMatch(voidSource, /sale\.shortReceiptMeta\s*\|\|\s*sale\.fullTaxInvoice/, 'ใบเสร็จอย่างย่อต้องไม่ขวางการยกเลิกบิล');
assert.match(voidSource, /if\(sale\.fullTaxInvoice\)/, 'ใบกำกับภาษีเต็มรูปแบบต้องยังถูกป้องกัน');

assert.match(migration, /void_sale_core_20260831\(text,text\)/);
assert.match(migration, /nullif\(v_sale\.data ->> ''fullTaxInvoice''/);
assert.doesNotMatch(
  migration.match(/'if nullif[\s\S]*?end if;'/)?.[0] || '',
  /shortReceiptMeta/,
  'เงื่อนไขใหม่ต้องไม่ห้ามใบเสร็จอย่างย่อ',
);
assert.match(migration, /revoke all on function public\.void_sale_core_20260831/);

console.log('sale void after short receipt tests passed');
