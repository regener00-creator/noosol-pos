const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const helperStart = html.indexOf('const PRODUCT_EXCEL_MIN_REPEAT_COLUMNS=');
const helperEnd = html.indexOf('function downloadProductImportTemplate(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'product Excel helpers must exist');

const sandbox = {
  warehouses: [{id: 1, name: 'คลังหลัก'}],
  extraBarcodeEntries: product => (product.extraBarcodes || []).map((code, index) => ({code, unit:(product.extraBarcodeUnits || [])[index] || product.unit})),
  fmtDateShort: value => value === '2027-12-31' ? '31/12/2027' : value,
  productVatModeLabel: value => value === 'excl' ? 'ราคายังไม่รวม VAT' : value === 'none' ? 'ไม่มี VAT' : 'ราคารวม VAT แล้ว',
};
vm.createContext(sandbox);
vm.runInContext(`${html.slice(helperStart, helperEnd)}; this.productExcelColumnCounts=productExcelColumnCounts; this.productExcelHeaders=productExcelHeaders; this.productToExcelRow=productToExcelRow;`, sandbox);

const products = [{
  id: 44,
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
}];

const counts = sandbox.productExcelColumnCounts(products);
assert.deepEqual(JSON.parse(JSON.stringify(counts)), {extraBarcodes: 2, vendors: 2, units: 2});
const headers = Array.from(sandbox.productExcelHeaders(counts));
const row = sandbox.productToExcelRow(products[0], counts, sandbox.warehouses);
assert.deepEqual(Object.keys(row), headers, 'export row must use the exact shared template column order');
assert.equal(row['บาร์โค้ด'], '0000123400012');
assert.equal(row['บาร์โค้ดเพิ่มเติม 1'], 'EXTRA-1');
assert.equal(row['หน่วยบาร์โค้ดเพิ่มเติม 1'], 'กล่อง');
assert.equal(row['บาร์โค้ด Vendor 1'], 'VENDOR-1');
assert.equal(row['บาร์โค้ดหน่วย 1'], 'UNIT-1');
assert.equal(row['บาร์โค้ดเพิ่มเติม 2'], '');
assert.equal(row['ชื่อผู้จำหน่าย 2'], '');
assert.equal(row['หน่วยเพิ่มเติม 2'], '');
assert.equal(row['คลังสินค้า'], 'คลังหลัก');
assert.equal(row['ภาษีมูลค่าเพิ่ม'], 'ราคายังไม่รวม VAT');
assert.ok(headers.includes('ภาษีมูลค่าเพิ่ม'));

const templateStart = html.indexOf('function downloadProductImportTemplate(');
const importStart = html.indexOf('async function importProductsFromExcel(', templateStart);
const exportStart = html.indexOf('function exportProductsToExcel(', importStart);
const exportEnd = html.indexOf('function saveProduct(', exportStart);
assert.match(html.slice(templateStart, importStart), /productToExcelRow\(/, 'template must use the shared row schema');
assert.match(html.slice(exportStart, exportEnd), /productToExcelRow\(/, 'export must use the shared row schema');
assert.match(html.slice(importStart, exportStart), /parseProductVatMode\(/, 'import must preserve the product VAT mode');

console.log('product Excel tests passed');
