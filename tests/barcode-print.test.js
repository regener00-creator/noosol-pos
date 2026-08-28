const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const CODE128_PATTERNS=');
const end = html.indexOf('function stockEditMatchesQuery(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบชุดฟังก์ชันพิมพ์ป้ายราคา');

const products = [
  {id:1,sku:'P-001',name:'สินค้าทดสอบหนึ่ง',category:'ยา',brand:'ทั่วไป',unit:'กล่อง',barcode:'',price:120,units:[{sub:'ลัง',barcode:'CASE-001',price:1100,factor:10}],extraBarcodes:[],vendorBarcodes:[]},
  {id:2,sku:'P-002',name:'สินค้าทดสอบสอง',category:'ยา',brand:'ทั่วไป',unit:'ขวด',barcode:'OLD-002',price:80,units:[],extraBarcodes:['EXTRA-002'],vendorBarcodes:[]},
];
let persistCount = 0;
let renderCount = 0;
const context = {
  products,
  barcodePrintItems: [],
  barcodePrintCatFilter: {category:'',brand:''},
  barcodePrintSearchQuery: '',
  barcodePrintLabelSize: '60x40',
  barcodePrintLabelType: 'price',
  barcodePrintPage: 1,
  BARCODE_PRINT_PAGE_SIZE: 10,
  TODAY_STR: '2026-08-21',
  promotions: [],
  categories: ['ยา'],
  brands: ['ทั่วไป'],
  escapeHtml: value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  fmtMoney: value => Number(value).toFixed(2),
  isoToDMY: value => String(value).split('-').reverse().join('/'),
  matchesBarcode: (product, query) => product.barcode === query || (product.units || []).some(unit => unit.barcode === query),
  extraBarcodeEntries: product => (product.extraBarcodes || []).map((code, index) => ({code, unit:(product.extraBarcodeUnits || [])[index] || product.unit})),
  persistWorkspaceData: () => { persistCount++; },
  showToast: () => {},
  render: () => { renderCount++; },
  alert: () => {},
  setTimeout: callback => callback(),
  document: {querySelectorAll: () => [], querySelector: () => null},
};
context.isPromotionLiveToday = promo => promo.active !== false && (!promo.startDate || context.TODAY_STR >= promo.startDate) && (!promo.endDate || context.TODAY_STR <= promo.endDate);
context.findMatchingPromotion = line => context.promotions.find(promo => context.isPromotionLiveToday(promo) && promo.scope === 'product' && Number(promo.productId) === Number(line.pid) && promo.unit === line.unit) || null;
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

assert.deepEqual(Array.from(context.code128BValues('123456')), [104,17,18,19,20,21,22,16,106]);
assert.throws(() => context.code128BValues(''), /กรุณากรอกบาร์โค้ด/);
assert.throws(() => context.code128BValues('ยา'), /ตัวเลขและตัวอักษรอังกฤษ/);
const svg = context.code128BSvg('ABC-123');
assert.match(svg, /^<svg/);
assert.match(svg, /<rect/);
assert.match(svg, /aria-label="บาร์โค้ด ABC-123"/);

const firstItem = context.createBarcodePrintItem(products[0]);
assert.equal(firstItem.unit, 'กล่อง');
assert.equal(firstItem.barcode, 'PEPOS000000100');
assert.equal(firstItem.qty, 1);
context.barcodePrintItems.push(firstItem);
assert.equal(context.barcodePrintAddProduct(products[0]), false);
assert.equal(context.barcodePrintAddProduct(products[1]), true);
assert.equal(context.barcodePrintItems[1].barcode, 'OLD-002');

const paginationItems = Array.from({length: 15}, (_, index) => ({pid:index + 1}));
const secondPage = context.barcodePrintPagination(paginationItems, 2, 7);
assert.equal(secondPage.currentPage, 2);
assert.equal(secondPage.totalPages, 3);
assert.deepEqual(Array.from(secondPage.rows, entry => entry.index), [7,8,9,10,11,12,13]);
assert.equal(context.barcodePrintPagination(paginationItems, 99, 7).currentPage, 3);
assert.equal(context.barcodePrintPagination([], 2, 7).currentPage, 1);

assert.equal(context.barcodePrintValidation().length, 0);
context.barcodePrintItems[0].barcode = 'EXTRA-002';
assert.match(context.barcodePrintValidation()[0].message, /ถูกใช้กับ/);
context.barcodePrintItems[0].barcode = 'รหัสไทย';
assert.match(context.barcodePrintValidation()[0].message, /Code 128/);
context.barcodePrintItems[0].barcode = 'NEW-001';
context.barcodePrintItems[0].qty = 0;
assert.match(context.barcodePrintValidation()[0].message, /จำนวนฉลาก/);

context.barcodePrintItems[0].qty = 2;
context.barcodePrintItems.splice(1, 1);
assert.equal(context.saveBarcodePrintItems(null), true);
assert.equal(products[0].barcode, 'NEW-001');
assert.equal(persistCount, 1);
assert.equal(renderCount, 1);

let printHtml = '';
let printCount = 0;
const printWindow = {
  closed: false,
  document: {
    open: () => {},
    write: value => { printHtml += value; },
    close: () => {},
  },
  focus: () => {},
  print: () => { printCount++; },
};
assert.equal(context.writeBarcodePrintWindow(printWindow,[{pid:1,unit:'กล่อง',barcode:'NEW-001',qty:2}],'60x40'), true);
assert.match(printHtml, /@page\{size:60mm 40mm;margin:0\}/);
assert.match(printHtml, /ป้ายราคา 60 × 40 มม\. แนวนอน/);
assert.match(printHtml, /สินค้าทดสอบหนึ่ง/);
assert.match(printHtml, /฿<\/span>120\.00/);
assert.match(printHtml, /NEW-001/);
assert.equal((printHtml.match(/<section class="label">/g)||[]).length, 2);
assert.equal(printCount, 1);

context.promotions = [];
const noPromotionErrors = context.barcodePrintValidation([{pid:1,unit:'กล่อง',barcode:'NEW-001',qty:1}],'promotion');
assert.equal(noPromotionErrors[0].field, 'promotion');
assert.match(noPromotionErrors[0].message, /ไม่มีโปรโมชั่นที่ใช้งานอยู่/);

context.promotions = [{id:10,name:'ลดทันที 25%',active:true,scope:'product',productId:1,unit:'กล่อง',type:'discount',discountMode:'percent',discountValue:25,startDate:'2026-08-01',endDate:'2026-08-31'}];
const discountDetails = context.barcodePrintPromotionDetails({pid:1,unit:'กล่อง'},products[0],context.barcodePrintUnitOptions(products[0])[0]);
assert.equal(discountDetails.price, 90);
assert.equal(discountDetails.condition, 'ลด 25%');

context.promotions = [{id:11,name:'ซื้อสองราคาพิเศษ',active:true,scope:'product',productId:1,unit:'กล่อง',type:'bundle',bundleQty:2,bundlePrice:200}];
const bundleDetails = context.barcodePrintPromotionDetails({pid:1,unit:'กล่อง'},products[0],context.barcodePrintUnitOptions(products[0])[0]);
assert.equal(bundleDetails.price, 200);
assert.equal(bundleDetails.originalPrice, 240);
assert.match(bundleDetails.condition, /ซื้อ 2 กล่อง ราคา 200\.00 บาท/);

context.promotions = [{id:12,name:'ซื้อ 1 แถม 1 คละสินค้าได้',active:true,scope:'buygetdiff',type:'buygetdiff',bgdBuyProductId:1,bgdBuyUnit:'กล่อง',bgdBuyQty:1,bgdGetProductId:1,bgdGetUnit:'กล่อง',bgdGetQty:1,startDate:'2026-08-01',endDate:'2026-08-31'}];
printHtml = '';
assert.equal(context.writeBarcodePrintWindow(printWindow,[{pid:1,unit:'กล่อง',barcode:'NEW-001',qty:1}],'60x40','promotion'), true);
assert.match(printHtml, /class="label promotion"/);
assert.match(printHtml, /<b>ซื้อ 1 แถม 1<\/b>/);
assert.match(printHtml, /คละสินค้าได้/);
assert.match(printHtml, /รับฟรี 1 กล่อง/);
assert.match(printHtml, /class="promo-price">120<sup>\.00<\/sup>/);
assert.match(printHtml, /ป้ายโปรโมชั่น 60 × 40 มม\. แนวนอน/);

assert.match(html, /barcodeprint:\s*renderBarcodePrint/);
assert.match(html, /LEVEL2_HIDDEN_TABS[^\n]+barcodeprint/);
assert.match(html, /id="savePrintBarcodeBtn"/);
assert.match(html, /id="barcodePrintAddMissingBtn"/);
assert.match(html, /พิมพ์ป้ายราคา/);
assert.match(html, /พิมพ์ป้ายราคา <span class="page-title-meta">\$\{isPromotionLabel\?/);
assert.match(html, /ค่าเริ่มต้นเป็นป้ายแนวนอน 60 × 40 มม\./);
assert.doesNotMatch(html, /class="barcode-print-help"/);
assert.match(html, /barcodePrintLabelSize = '60x40'/);
assert.match(html, /barcodePrintLabelType = 'price'/);
assert.match(html, /id="barcodePrintLabelType"/);
assert.match(html, /รูปแบบ: ป้ายโปรโมชั่น/);
assert.match(html, /value="60x40"[^>]*>ป้ายราคา 60 × 40 มม\. \(ค่าเริ่มต้น\)/);
assert.match(html, /data-barcode-print-page/);
assert.match(html, /BARCODE_PRINT_PAGE_SIZE = 10/);
assert.match(html, /\.main\.barcode-print-main\{overflow-y:hidden;\}/);
assert.match(html, /\.barcode-print-table-wrap\{[^}]*flex:1;[^}]*overflow-y:hidden;/);
assert.match(html, /classList\.toggle\('barcode-print-main',currentTab==='barcodeprint'\)/);
assert.match(html, /@page\{size:\$\{width\}mm \$\{height\}mm;margin:0\}/);

console.log('barcode print tests passed');
