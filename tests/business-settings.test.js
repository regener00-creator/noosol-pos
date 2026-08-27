const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function businessPrimaryPhone(');
const end = html.indexOf('function normalizeProductVatMode(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบ logic ข้อมูลธุรกิจ');

const context = {
  businessSettings: {},
  isBusinessVatRegistered: settings => settings?.vat === 'registered',
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

assert.equal(context.businessPrimaryPhone({documentPhone:'mobile',mobile:'081',officePhone:'02'}), '081');
assert.equal(context.businessPrimaryPhone({documentPhone:'office',mobile:'081',officePhone:'02'}), '02');
assert.equal(context.businessPrimaryPhone({documentPhone:'office',mobile:'081',officePhone:''}), '081');

assert.equal(context.businessTaxBranchLabel({vat:'not-registered',branch:'head'}), '', 'ร้านที่ยังไม่จด VAT ต้องไม่แสดงสำนักงานใหญ่');
assert.equal(context.businessTaxBranchLabel({vat:'registered',branch:'none'}), '', 'ยังไม่ระบุสาขาต้องไม่สร้างวงเล็บว่าง');
assert.equal(context.businessTaxBranchLabel({vat:'registered',branch:'head'}), 'สำนักงานใหญ่');
assert.equal(context.businessTaxBranchLabel({vat:'registered',branch:'branch',branchCode:'00001',branchName:'พรชัย'}), 'สาขา 00001 พรชัย');
assert.equal(context.businessDocumentName({vat:'not-registered',branch:'head',name:'ร้านยา'}), 'ร้านยา');
assert.equal(context.businessDocumentName({vat:'registered',branch:'branch',branchCode:'00001',branchName:'พรชัย',name:'ร้านยา'}), 'ร้านยา (สาขา 00001 พรชัย)');

assert.match(html, /branch:'none'/, 'ค่าเริ่มต้นต้องไม่บังคับสำนักงานใหญ่');
assert.match(html, /name="set_branch" value="none"/, 'หน้าตั้งค่าต้องมีตัวเลือกยังไม่ระบุ');
assert.match(html, /class="form-final-actions"><button class="btn primary" id="saveBusinessSettingsBtn"/, 'ปุ่มบันทึกต้องย้ายขึ้น TOPBAR');
assert.match(html, /value="\$\{escapeHtml\(b\.name\)\}"/, 'ชื่อธุรกิจในฟอร์มต้อง escape');
assert.match(html, /branch=vat===VAT_REGISTERED_LABEL\?selectedBranch:'none'/, 'ร้านที่ไม่จด VAT ต้องบันทึกสาขาเป็นไม่ระบุ');
assert.match(html, /const synced=await syncBusinessSettingsToSupabase\(\)/, 'ต้องรอผลซิงก์ก่อนแจ้งผู้ใช้');
assert.doesNotMatch(html, /receiptBusiness\.branch==='branch'/, 'ใบเสร็จต้องใช้กติกาสาขากลาง');
assert.doesNotMatch(html, /business\.branch==='branch'\?'สาขา':'สำนักงานใหญ่'/, 'เอกสารต้องไม่บังคับสำนักงานใหญ่เอง');
assert.ok((html.match(/businessDocumentName\(/g)||[]).length >= 6, 'เอกสารหลักต้องใช้กติกาชื่อและสาขากลาง');

console.log('business settings tests passed');
