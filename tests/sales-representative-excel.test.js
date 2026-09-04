const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();

const helperStart = html.indexOf("const SALES_REP_EXCEL_HEADERS=");
const helperEnd = html.indexOf('async function downloadSalesRepresentativeImportTemplate(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'sales representative Excel helpers must exist');
const sandbox = {notePlainText:value=>String(value||'').replace(/<[^>]*>/g,'').trim()};
vm.createContext(sandbox);
vm.runInContext(`${html.slice(helperStart, helperEnd)}; this.headers=SALES_REP_EXCEL_HEADERS; this.exportHeaders=SALES_REP_EXPORT_HEADERS; this.noteHeaders=SALES_REP_NOTE_EXCEL_HEADERS; this.productHeaders=SALES_REP_PRODUCT_EXCEL_HEADERS; this.toRow=salesRepresentativeToExcelRow; this.exportRows=salesRepresentativeExportRows;`, sandbox);
const representative={id:7,code:'SR0007',name:'คุณทดสอบ',phone:'0812345678',line:'test.line',company:'บริษัท ทดสอบ',note:'กรุงเทพฯ'};
const row=sandbox.toRow(representative);
assert.deepEqual(Object.keys(row),Array.from(sandbox.headers));
assert.equal(row['รหัสอ้างอิงระบบ'],7);
assert.equal(row['รหัสผู้ติดต่อ'],'SR0007');
assert.equal(row['ชื่อผู้แทน'],'คุณทดสอบ');
assert.equal(row['ข้อมูลเพิ่มเติม'],'กรุงเทพฯ');

const exported=sandbox.exportRows(
  [representative],
  [{representativeId:7,productId:101}],
  [{id:'note-1',representativeId:7,eventDate:'2026-09-04',title:'แจ้งโปรโมชั่น',contentHtml:'<b>ซื้อครบ 10 กล่อง</b>',hiddenFromLevel2:true,createdAt:'2026-09-04T09:30:00+07:00',updatedAt:'2026-09-04T10:00:00+07:00'}],
  [{id:101,sku:'SKU101',barcode:'8850000000101',name:'สินค้าทดสอบ'}]
);
assert.deepEqual(Object.keys(exported.representativeRows[0]),Array.from(sandbox.exportHeaders));
assert.equal(exported.representativeRows[0]['จำนวนสินค้าที่ดูแล'],1);
assert.equal(exported.representativeRows[0]['จำนวน NOTE'],1);
assert.deepEqual(Object.keys(exported.noteRows[0]),Array.from(sandbox.noteHeaders));
assert.equal(exported.noteRows[0]['ลำดับ NOTE'],1);
assert.equal(exported.noteRows[0]['ชื่อ NOTE'],'แจ้งโปรโมชั่น');
assert.equal(exported.noteRows[0]['เนื้อหา NOTE'],'ซื้อครบ 10 กล่อง');
assert.equal(exported.noteRows[0]['ซ่อนจาก LEVEL 2'],'ใช่');
assert.equal(exported.noteRows[0]['วันที่ NOTE'].getFullYear(),2026);
assert.deepEqual(Object.keys(exported.productRows[0]),Array.from(sandbox.productHeaders));
assert.equal(exported.productRows[0]['รหัสสินค้า (SKU)'],'SKU101');
assert.equal(exported.productRows[0]['ชื่อสินค้า'],'สินค้าทดสอบ');

const historyStart=html.indexOf('function renderRepresentativeHistory()');
const historyEnd=html.indexOf('function syncRepresentativeActivityDraftFromForm()',historyStart);
const formStart=html.indexOf('function representativeEditorModalHtml()');
const formEnd=html.indexOf('function representativeActivityCardHtml(',formStart);
const historyCode=html.slice(historyStart,historyEnd);
const formCode=html.slice(formStart,formEnd);
assert.match(historyCode,/id="exportSalesRepsBtn"/);
assert.match(historyCode,/id="downloadSalesRepTemplateBtn"/);
assert.match(historyCode,/id="importSalesRepsBtn"/);
assert.match(historyCode,/id="salesRepImportFile"/);
assert.match(historyCode,/id="newSalesRepBtn"/);
assert.match(formCode,/id="saveSalesRepBtn"[^>]*>บันทึกข้อมูลผู้แทน<\/button>/);
assert.ok(formCode.indexOf('id="sr_code"') < formCode.indexOf('id="sr_name"'),'contact code field must be first in the representative form');
assert.doesNotMatch(formCode,/บันทึกแล้วปิด/);
assert.doesNotMatch(html, /<h1[^>]*>รายชื่อผู้แทน/);

assert.match(html,/const code=get\('sr_code'\);/);
assert.match(html,/String\(rep\.code\|\|'\'\)\.trim\(\)\.toLowerCase\(\)===code\.toLowerCase\(\)/);
assert.match(html,/productImportValue\(row,\['รหัสผู้ติดต่อ','รหัส','code'\]\)/);

const eventsStart=html.indexOf('const newSalesRepBtn =');
const eventsEnd=html.indexOf('// --- promotions ---',eventsStart);
const events=html.slice(eventsStart,eventsEnd);
assert.match(events,/importSalesRepresentativesFromExcel/);
assert.match(events,/downloadSalesRepresentativeImportTemplate/);
assert.match(events,/exportSalesRepresentativesToExcel/);

const exportStart=html.indexOf('async function exportSalesRepresentativesToExcel()');
const exportEnd=html.indexOf('function updateContactEntityLabels()',exportStart);
const exportCode=html.slice(exportStart,exportEnd);
assert.match(exportCode,/loadSalesRepresentativeExcelDetails\(\)/);
assert.match(exportCode,/book_append_sheet\(workbook,noteSheet,'NOTE ผู้แทน'\)/);
assert.match(exportCode,/book_append_sheet\(workbook,productSheet,'สินค้าที่ดูแล'\)/);
assert.match(exportCode,/NOTE \$\{noteRows\.length\} รายการ/);

assert.match(html,/id="downloadContactTemplateBtn">ดาวน์โหลดคู่มือนำเข้า<\/button>/);

console.log('sales representative Excel tests passed');
