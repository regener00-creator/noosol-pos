const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();
const helperStart = html.indexOf('const PRODUCT_EXCEL_MIN_REPEAT_COLUMNS=');
const helperEnd = html.indexOf('async function downloadProductImportTemplate(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'product Excel helpers must exist');

const sandbox = {
  warehouses: [{id: 1, name: 'คลังหลัก'}],
  extraBarcodeEntries: product => (product.extraBarcodes || []).map((code, index) => ({code, unit:(product.extraBarcodeUnits || [])[index] || product.unit})),
  fmtDateShort: value => value === '2027-12-31' ? '31/12/2027' : value,
  productVatModeLabel: value => value === 'excl' ? 'ราคายังไม่รวม VAT' : value === 'none' ? 'ไม่มี VAT' : 'ราคารวม VAT แล้ว',
};
vm.createContext(sandbox);
vm.runInContext(`${html.slice(helperStart, helperEnd)}; this.productExcelColumnCounts=productExcelColumnCounts; this.productExcelHeaders=productExcelHeaders; this.productExcelColumnWidth=productExcelColumnWidth; this.productToExcelRow=productToExcelRow;`, sandbox);

const products = [{
  id: 9007199254740001,
  sku: 'P0044',
  name: 'สินค้าทดสอบ',
  barcode: '0000123400012',
  extraBarcodes: ['EXTRA-1'],
  extraBarcodeUnits: ['กล่อง'],
  vendorBarcodes: [{vendor: 'ผู้จำหน่าย ก', code: 'VENDOR-1'}],
  category: 'ยา',
  brand: 'ทั่วไป',
  unit: 'แผง',
  price: 15,
  cost: 9,
  vat: 'excl',
  stock: 12,
  expiry: '2027-12-31',
  wh: 1,
  desc: 'รายละเอียด',
  units: [{sub: 'กล่อง', per: 10, base: 'แผง', price: 140, cost: 90, barcode: 'UNIT-1'}],
  _clientCreateToken: 'must-not-be-exported',
}];

const counts = sandbox.productExcelColumnCounts(products);
assert.deepEqual(JSON.parse(JSON.stringify(counts)), {extraBarcodes: 2, vendors: 2, units: 2});
const headers = Array.from(sandbox.productExcelHeaders(counts));
const row = sandbox.productToExcelRow(products[0], counts, sandbox.warehouses);
assert.deepEqual(Object.keys(row), headers, 'export row must use the exact shared template column order');
assert.deepEqual(headers.slice(0,13), ['รหัสสินค้า','ชื่อสินค้า','หมวดสินค้า','ยี่ห้อ / หมวดย่อย','หน่วยหลัก','ราคาขาย (หน่วยหลัก)','ราคาทุน (หน่วยหลัก)','บาร์โค้ดหลัก','ภาษีมูลค่าเพิ่ม','คลังสินค้า','จำนวนคงเหลือ (หน่วยหลัก)','วันหมดอายุ','รายละเอียด'], 'ข้อมูลพื้นฐานต้องเรียงอยู่ด้านหน้าก่อนข้อมูลเสริม');
assert.ok(headers.indexOf('หน่วยเพิ่มเติม 1') < headers.indexOf('บาร์โค้ดสำรอง 1'), 'หน่วยเพิ่มเติมต้องอยู่ก่อนกลุ่มบาร์โค้ดสำรอง');
assert.ok(headers.indexOf('บาร์โค้ดสำรอง 1') < headers.indexOf('ชื่อผู้จำหน่าย 1'), 'บาร์โค้ดสำรองต้องอยู่ก่อนกลุ่มผู้จำหน่าย');
assert.equal(headers.at(-1), 'รหัสอ้างอิงระบบ (ห้ามแก้)', 'รหัสภายในต้องย้ายไปท้ายสุดและระบุว่าไม่ควรแก้');
assert.equal(row['รหัสอ้างอิงระบบ (ห้ามแก้)'], '9007199254740001', 'Excel must receive large bigint ids as exact text');
assert.ok(!Object.values(row).includes('must-not-be-exported'), 'internal creation token must stay out of Excel');
assert.equal(row['บาร์โค้ดหลัก'], '0000123400012');
assert.equal(row['บาร์โค้ดสำรอง 1'], 'EXTRA-1');
assert.equal(row['หน่วยของบาร์โค้ดสำรอง 1'], 'กล่อง');
assert.equal(row['บาร์โค้ดผู้จำหน่าย 1'], 'VENDOR-1');
assert.equal(row['บาร์โค้ดหน่วยเพิ่มเติม 1'], 'UNIT-1');
assert.equal(row['บาร์โค้ดสำรอง 2'], '');
assert.equal(row['ชื่อผู้จำหน่าย 2'], '');
assert.equal(row['หน่วยเพิ่มเติม 2'], '');
assert.equal(row['คลังสินค้า'], 'คลังหลัก');
assert.equal(row['ภาษีมูลค่าเพิ่ม'], 'ราคายังไม่รวม VAT');
assert.ok(headers.includes('ภาษีมูลค่าเพิ่ม'));
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.productExcelColumnWidth('ชื่อสินค้า'))), {wch:34}, 'ชื่อสินค้าต้องมีพื้นที่อ่านง่าย');

const templateStart = html.indexOf('function downloadProductImportTemplate(');
const importStart = html.indexOf('async function importProductsFromExcel(', templateStart);
const exportStart = html.indexOf('function exportProductsToExcel(', importStart);
const exportEnd = html.indexOf('function saveProduct(', exportStart);
assert.match(html.slice(templateStart, importStart), /productToExcelRow\(/, 'template must use the shared row schema');
assert.match(html.slice(exportStart, exportEnd), /productToExcelRow\(/, 'export must use the shared row schema');
assert.match(html.slice(exportStart, exportEnd), /sheet\['!autofilter'\]=\{ref:sheet\['!ref'\]\}/, 'export must enable Excel header filters');
assert.match(html.slice(importStart, exportStart), /parseProductVatMode\(/, 'import must preserve the product VAT mode');
assert.match(html.slice(importStart, exportStart), /'ราคาขาย \(หน่วยหลัก\)'[^]*'ราคาขาย'/, 'import must accept both the clearer and legacy headers');

console.log('product Excel tests passed');
