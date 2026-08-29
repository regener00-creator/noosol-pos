const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/0042_cash_shifts.sql'), 'utf8');

assert.match(html, /\['cashshift','เปิด-ปิดระบบชำระ'/);
assert.match(html, /cashshift:\s*renderCashShift/);
assert.match(html, /\.cash-shift-page\{max-width:1180px;margin:0 auto;\}/, 'ก้อนข้อมูลเปิด-ปิดระบบชำระต้องอยู่กึ่งกลางหน้า');
assert.match(html, /\.cash-shift-table \.num\{text-align:left;font-family:monospace;\}/, 'ข้อมูลตัวเลขในประวัติระบบชำระต้องชิดซ้าย');
assert.doesNotMatch(html, /<h2>เปิด-ปิดระบบชำระ<\/h2>/);
assert.match(html, /<h3>เริ่มต้นระบบชำระ<\/h3>/);
assert.match(html, /form="cashShiftOpenForm"[\s\S]{0,160}>\$\{cashShiftBusy\?'กำลังเปิดระบบ…':'เปิดระบบชำระ'\}<\/button>/);
assert.match(html, /cashShifts\.slice\(0,100\)\.map/);
const historyStart = html.indexOf('function renderCashShiftHistory(');
const historyEnd = html.indexOf('function renderCashShift(', historyStart);
const historySource = html.slice(historyStart, historyEnd);
assert.doesNotMatch(historySource, /cash-shift-history-head|แสดงล่าสุดไม่เกิน 100 กะ/, 'ต้องไม่แสดงหัวข้อและคำอธิบายเหนือประวัติกะ');
assert.match(html, /<h3>ปิดระบบ<\/h3>/);
assert.match(html, /'ยืนยันการปิดระบบ'/);
assert.match(html, /class="cash-shift-topbar-action open"/);
assert.match(html, /<strong>\$\{escapeHtml\(currentCashShift\.shiftNo\)\} เปิดอยู่<\/strong> : เงินตั้งต้น/);
assert.match(html, />สรุปชำระ<\/button>/);
assert.doesNotMatch(html, /class="cash-shift-banner/);
assert.match(html, /sb\.rpc\('open_cash_shift'/);
assert.match(html, /sb\.rpc\('close_cash_shift'/);
assert.match(html, /\.from\('cash_shifts'\)[\s\S]{0,250}\.limit\(100\)/);
assert.match(html, /function openPaymentModal\(\)[\s\S]{0,180}!currentCashShift/);
assert.match(html, /async function doCheckout\([^)]*\)[\s\S]{0,180}!currentCashShift/);
assert.match(html, /async function voidSaleHistory\([^)]*\)[\s\S]{0,320}!currentCashShift/);
assert.match(html, /cart\.length===0\|\|!currentCashShift/);

assert.match(migration, /create table if not exists public\.cash_shifts/i);
assert.match(migration, /idx_cash_shifts_one_open_per_cashier[\s\S]*where status='open'/i);
assert.match(migration, /alter table public\.sales add column if not exists cash_shift_id/i);
assert.match(migration, /alter table public\.sales add column if not exists void_shift_id/i);
assert.match(migration, /create trigger assign_cash_shift_to_sale before insert or update on public\.sales/i);
assert.match(migration, /raise exception 'cash shift required'/i);
assert.match(migration, /create trigger protect_cash_shift_history before update or delete/i);
assert.match(migration, /closed cash shift is immutable/i);
assert.match(migration, /variance reason required/i);
assert.match(migration, /opening_cash\+v_cash_sales-v_cash_refunds/i);
assert.match(migration, /revoke all on public\.cash_shifts from public,anon,authenticated/i);
assert.match(migration, /grant select on public\.cash_shifts to authenticated/i);
assert.match(migration, /grant execute on function public\.open_cash_shift\(bigint,numeric\) to authenticated/i);
assert.match(migration, /grant execute on function public\.close_cash_shift\(uuid,numeric,text\) to authenticated/i);
assert.match(migration, /delete from public\.sales; delete from public\.cash_shifts/i);
assert.match(migration, /audit_cash_shifts_changes/i);

const summaryStart = html.indexOf('function cashShiftSummary(');
const summaryEnd = html.indexOf('function cashShiftEffectiveSummary(', summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'ไม่พบฟังก์ชันสรุปกะ');
const context = {};
vm.createContext(context);
vm.runInContext(html.slice(summaryStart, summaryEnd), context);
const shift = {id:'shift-1',openingCash:1000};
const sales = [
  {cashShiftId:'shift-1',payMethod:'เงินสด',total:200},
  {cashShiftId:'shift-1',payMethod:'โอนธนาคาร',total:300},
  {cashShiftId:'another',voidShiftId:'shift-1',payMethod:'เงินสด',total:50,status:'void'},
  {cashShiftId:'another',payMethod:'เงินสด',total:999},
];
const summary = context.cashShiftSummary(shift, sales);
assert.equal(summary.grossSales, 500);
assert.equal(summary.refunds, 50);
assert.equal(summary.netSales, 450);
assert.equal(summary.cashSales, 200);
assert.equal(summary.cashRefunds, 50);
assert.equal(summary.expectedCash, 1150);
assert.equal(summary.saleCount, 2);
assert.equal(summary.refundCount, 1);
assert.equal(summary.payments['เงินสด'].net, 150);
assert.equal(summary.payments['โอนธนาคาร'].net, 300);

console.log('cash shift tests passed');
