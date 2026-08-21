const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const helperStart = html.indexOf("const SALES_REP_EXCEL_HEADERS=");
const helperEnd = html.indexOf('function downloadSalesRepresentativeImportTemplate(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'sales representative Excel helpers must exist');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${html.slice(helperStart, helperEnd)}; this.headers=SALES_REP_EXCEL_HEADERS; this.toRow=salesRepresentativeToExcelRow;`, sandbox);
const representative={id:7,name:'คุณทดสอบ',phone:'0812345678',line:'test.line',company:'บริษัท ทดสอบ',note:'กรุงเทพฯ'};
const row=sandbox.toRow(representative);
assert.deepEqual(Object.keys(row),Array.from(sandbox.headers));
assert.equal(row['รหัสอ้างอิงระบบ'],7);
assert.equal(row['ชื่อผู้แทน'],'คุณทดสอบ');
assert.equal(row['ข้อมูลเพิ่มเติม'],'กรุงเทพฯ');

const listStart=html.indexOf('function renderSalesRepresentatives()');
const listEnd=html.indexOf('function renderSalesRepresentativeForm()',listStart);
const formEnd=html.indexOf('// ===== ระบบโปรโมชั่น',listEnd);
const listCode=html.slice(listStart,listEnd);
const formCode=html.slice(listEnd,formEnd);
assert.match(listCode,/id="exportSalesRepsBtn"/);
assert.match(listCode,/id="downloadSalesRepTemplateBtn"/);
assert.match(listCode,/id="importSalesRepsBtn"/);
assert.match(listCode,/id="salesRepImportFile"/);
assert.match(formCode,/id="saveSalesRepBtn">บันทึก<\/button>/);
assert.doesNotMatch(formCode,/บันทึกแล้วปิด/);

const eventsStart=html.indexOf('const newSalesRepBtn =');
const eventsEnd=html.indexOf('// --- promotions ---',eventsStart);
const events=html.slice(eventsStart,eventsEnd);
assert.match(events,/importSalesRepresentativesFromExcel/);
assert.match(events,/downloadSalesRepresentativeImportTemplate/);
assert.match(events,/exportSalesRepresentativesToExcel/);

assert.match(html,/id="downloadContactTemplateBtn">ดาวน์โหลดคู่มือนำเข้า<\/button>/);

console.log('sales representative Excel tests passed');
