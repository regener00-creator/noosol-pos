const assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),ExcelJS=require('exceljs');
test('void XLSX preserves numeric totals, literal formula-like text, alignment and long reasons',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../excel-tools.js'),'utf8');
  const createWorkbook=Function('fmtDate','fmtMoney',source.slice(source.indexOf('function createVoidReportWorkbook('),source.indexOf('async function exportVoidReportToExcel('))+';return createVoidReportWorkbook;')(v=>v,v=>Number(v).toFixed(2));
  const report={title:'รายงานบิลยกเลิก',business:'SAPURI',range:{from:'2026-10-01',to:'2026-10-31'},filters:'ทุกคลัง',headers:['วัน','บิล','วันที่ขาย','คลัง','ผู้ยกเลิก','เหตุผล','ยอดคืน','ช่องทาง'],rows:[['31-10-2026','00123','01-10-2026','คลังหนึ่ง','=1+1','ข้อความ'.repeat(80),133.11,'เงินสด']]};
  const book=createWorkbook(report,ExcelJS),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
  const sheet=loaded.worksheets[0];assert.equal(sheet.getCell('B7').value,'00123');assert.equal(sheet.getCell('E7').value,'=1+1');assert.equal(sheet.getCell('E7').type,ExcelJS.ValueType.String);assert.equal(sheet.getCell('G7').value,133.11);assert.equal(sheet.getCell('G8').value,133.11);assert.ok(sheet.getRow(7).height>44);assert.equal(sheet.getCell('G7').alignment.horizontal,'center');assert.equal(sheet.pageSetup.orientation,'landscape');
});
