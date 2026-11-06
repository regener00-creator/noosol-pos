const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),ExcelJS=require('exceljs');
const source=fs.readFileSync(path.join(__dirname,'../excel-tools.js'),'utf8');
const build=Function(source.slice(source.indexOf('function createTaxReportWorkbook('),source.indexOf('async function exportTaxReportToExcel('))+';return createTaxReportWorkbook;')();
test('tax Excel exports all monthly rows with numeric totals and claimable purchase formulas',async()=>{
  const sales=Array.from({length:23},(_,i)=>['06/11/2026',String(i).padStart(6,'0'),'คลัง',100,7,107]);
  const purchases=Array.from({length:12},(_,i)=>['06/11/2026',i===0?'=1+1':'0000'+i,'ผู้จำหน่าย','GR-'+i,i===0?'รอเลขที่/วันที่ใบกำกับ':'ข้อมูลครบ',100,i===0?0:7,107]);
  const workbook=build({month:'2026-11',business:'SAPURI',sales,purchases},ExcelJS);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(loaded.worksheets.map(s=>s.name),['ภาษีขาย','ภาษีซื้อ']);
  const sale=loaded.worksheets[0],purchase=loaded.worksheets[1];
  assert.equal(sale.rowCount,28);assert.equal(purchase.rowCount,17);
  assert.equal(sale.getCell('B5').value,'000000');assert.equal(sale.getCell('B27').value,'000022');
  assert.equal(purchase.getCell('B5').value,'=1+1');assert.equal(purchase.getCell('B5').type,ExcelJS.ValueType.String);
  assert.equal(sale.getCell('D5').type,ExcelJS.ValueType.Number);
  assert.deepEqual(sale.getCell('F28').value,{formula:'SUM(F5:F27)',result:2461});
  assert.deepEqual(purchase.getCell('H17').value,{formula:'SUMIF(E5:E16,"ข้อมูลครบ",H5:H16)',result:1177});
  assert.equal(purchase.getCell('G17').result,77);
  assert.equal(sale.getCell('F5').numFmt,'#,##0.00');assert.equal(sale.getCell('B5').alignment.horizontal,'center');
});
test('empty monthly tax workbook keeps headers and zero totals without invalid formula ranges',()=>{
  const book=build({month:'2026-12',business:'SAPURI',sales:[],purchases:[]},ExcelJS);
  for(const sheet of book.worksheets){assert.equal(sheet.rowCount,5);assert.equal(sheet.getRow(5).getCell(sheet.columnCount).value,0);}
});
