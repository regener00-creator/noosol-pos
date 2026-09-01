const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();
const start = html.indexOf('const CODE128_PATTERNS=');
const end = html.indexOf('function stockEditMatchesQuery(', start);
assert.ok(start >= 0 && end > start, 'ไม่พบชุดฟังก์ชันพิมพ์ป้ายราคา');

const products = [
  {id:1,sku:'P-001',name:'สินค้าทดสอบหนึ่ง',category:'ยา',brand:'ทั่วไป',unit:'กล่อง',barcode:'',price:120,units:[{sub:'ลัง',barcode:'CASE-001',price:1100,factor:10}],extraBarcodes:[],vendorBarcodes:[]},
  {id:2,sku:'P-002',name:'สินค้าทดสอบสอง',category:'ยา',brand:'ทั่วไป',unit:'ขวด',barcode:'OLD-002',price:80,units:[],extraBarcodes:['EXTRA-002'],vendorBarcodes:[]},
];
let persistCount = 0;
let persistOptions = null;
let renderCount = 0;
const context = {
  products,
  barcodePrintItems: [],
  barcodePrintCatFilter: {category:'',brand:''},
  barcodePrintSearchQuery: '',
  barcodePrintLabelSize: '50x30',
  barcodePrintPage: 1,
  BARCODE_PRINT_PAGE_SIZE: 10,
  BARCODE_PRINT_LABEL_DIMENSIONS: {'80x50':[80,50],'60x40':[60,40],'50x30':[50,30],'40x30':[40,30]},
  PRICE_LABEL_ELEMENT_META: {name:{label:'ชื่อสินค้า'},unit:{label:'หน่วย'},price:{label:'ราคา'},barcode:{label:'บาร์โค้ด'},code:{label:'เลขบาร์โค้ด'}},
  PRICE_LABEL_TEXT_COLORS: ['#000000','#e60012'],
  PRICE_LABEL_PRESET_LABELS: {left:'ชิดซ้าย / เว้นด้านขวา',full:'เต็มพื้นที่',center:'เน้นราคากึ่งกลาง',custom:'กำหนดเอง'},
  businessSettings: {priceLabelTemplates:{},priceLabelTemplateLibraries:{}},
  priceLabelTemplateSyncPromise: Promise.resolve(),
  priceLabelNamedTemplateCounter: 0,
  TODAY_STR: '2026-08-21',
  promotions: [],
  categories: ['ยา'],
  brands: ['ทั่วไป'],
  escapeHtml: value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  fmtMoney: value => Number(value).toFixed(2),
  isoToDMY: value => String(value).split('-').reverse().join('/'),
  matchesBarcode: (product, query) => product.barcode === query || (product.units || []).some(unit => unit.barcode === query),
  extraBarcodeEntries: product => (product.extraBarcodes || []).map((code, index) => ({code, unit:(product.extraBarcodeUnits || [])[index] || product.unit})),
  persistWorkspaceData: async options => { persistCount++; persistOptions=options; return true; },
  rebuildProductLookupMaps: () => {},
  syncBusinessSettingsToSupabase: async () => true,
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

async function run(){
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
assert.equal(await context.saveBarcodePrintItems(null), true);
assert.equal(products[0].barcode, 'NEW-001');
assert.equal(persistCount, 1);
assert.deepEqual(JSON.parse(JSON.stringify(persistOptions)),{productChanges:{updatedIds:[1]}});
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
assert.equal(context.writeBarcodePrintWindow(printWindow,[{pid:1,unit:'กล่อง',barcode:'NEW-001',qty:2}],'80x50'), true);
assert.match(printHtml, /@page\{size:80mm 50mm;margin:0\}/);
assert.match(printHtml, /ป้ายราคา 80 × 50 มม\. แนวนอน/);
assert.match(printHtml, /สินค้าทดสอบหนึ่ง/);
assert.match(printHtml, /data-price-label-element="price"[^>]*>120\.00<\/div>/);
assert.doesNotMatch(printHtml, /฿/);
assert.match(printHtml, /data-price-label-element="price"[^>]*color:#e60012;/);
assert.match(printHtml, /class="regular-layout"/);
assert.match(printHtml, /data-price-label-element="name"[^>]*left:3%;top:4%;width:61%;/);
assert.doesNotMatch(printHtml, /P-001/);
assert.match(printHtml, /family=Noto\+Sans\+Thai:wght@400;500;600;700;800/);
assert.match(printHtml, /body,.toolbar button,.label\{font-family:'Noto Sans Thai',Tahoma,sans-serif\}/);
assert.match(printHtml, /data-price-label-element="barcode"[^>]*left:3%;top:63%;width:55%;height:25%;/);
assert.match(printHtml, /data-price-label-element="code"[^>]*left:3%;top:90%;width:55%;height:7%;[^>]*>NEW-001<\/div>/);
assert.match(printHtml, /NEW-001/);
assert.equal((printHtml.match(/<section class="label"/g)||[]).length, 2);
assert.equal(printCount, 1);

const minimum40 = context.priceLabelBarcodeMinimum('40x30');
assert.equal(minimum40.width, 60);
assert.equal(minimum40.height, 20);
assert.equal(minimum40.recommendedWidth, 80);
assert.ok(minimum40.recommendedHeight > 26 && minimum40.recommendedHeight < 27);
const minimum50 = context.priceLabelBarcodeMinimum('50x30');
assert.equal(minimum50.width, 48);
assert.equal(minimum50.height, 20);
assert.equal(minimum50.recommendedWidth, 64);
const compactTemplate = context.priceLabelPresetTemplate('40x30', 'left');
assert.ok(compactTemplate.elements.barcode.width >= 60);
assert.ok(compactTemplate.elements.barcode.height >= minimum40.height);
assert.ok(Math.abs(context.priceLabelPreviewScale(80*96/25.4,80)-1)<0.0001);
assert.ok(Math.abs(context.priceLabelPreviewScale(760,80)-2.5135)<0.001);
assert.match(context.priceLabelElementStyle({x:0,y:0,width:50,height:20,fontSize:25,fontWeight:700,color:'#000000',align:'left',reverse:false},'name',2),/font-size:50pt/);
assert.equal(context.normalizePriceLabelElement('name',{color:'#123456'},'80x50',{color:'#000000'}).color,'#000000');
assert.equal(context.normalizePriceLabelElement('name',{fontSize:96},'50x30',{fontSize:10}).fontSize,96);
assert.equal(context.normalizePriceLabelElement('name',{fontSize:150},'50x30',{fontSize:10}).fontSize,120);
const currentTemplate = context.getPriceLabelTemplate('80x50');
const savedTemplate = context.savePriceLabelTemplate('80x50', {...currentTemplate,preset:'custom',elements:{...currentTemplate.elements,price:{...currentTemplate.elements.price,x:35,color:'#e60012',reverse:true}},customTexts:[{id:'sale-note',text:'สินค้าขายดี',x:63,y:5,width:32,height:12,fontSize:11,fontWeight:700,color:'#000000',align:'center',reverse:true,visible:true}]});
assert.equal(savedTemplate.preset, 'custom');
assert.equal(savedTemplate.elements.price.x, 35);
assert.equal(savedTemplate.elements.price.color, '#e60012');
assert.equal(savedTemplate.elements.price.reverse, true);
assert.equal(savedTemplate.customTexts[0].text, 'สินค้าขายดี');
assert.equal(savedTemplate.customTexts[0].reverse, true);
assert.equal(context.businessSettings.priceLabelTemplates['80x50'].elements.price.x, 35);
printHtml = '';
assert.equal(context.writeBarcodePrintWindow(printWindow,[{pid:1,unit:'กล่อง',barcode:'NEW-001',qty:1}],'80x50'), true);
assert.match(printHtml, /<section class="label" style="padding:0">/);
assert.match(printHtml, /data-price-label-element="price"[^>]*left:35%;[^>]*background:#e60012;color:#ffffff;/);
assert.match(printHtml, /data-price-label-custom-text="sale-note"[^>]*background:#000000;color:#ffffff;[^>]*>สินค้าขายดี<\/div>/);
assert.match(printHtml, /\.price-label-print-element\{-webkit-print-color-adjust:exact;print-color-adjust:exact\}/);
const namedOne = context.saveNamedPriceLabelTemplate('80x50','หน้าชั้นยา',savedTemplate);
const secondDraft = {...savedTemplate,elements:{...savedTemplate.elements,price:{...savedTemplate.elements.price,x:5,color:'#000000',reverse:false}}};
const namedTwo = context.saveNamedPriceLabelTemplate('80x50','ป้ายราคาดำ',secondDraft,'',{activate:false});
let templateLibrary = context.getPriceLabelTemplateLibrary('80x50');
assert.equal(templateLibrary.templates.length,2);
assert.equal(templateLibrary.activeId,namedOne.id);
assert.equal(context.getPriceLabelTemplate('80x50').elements.price.x,35);
assert.equal(context.saveNamedPriceLabelTemplate('80x50','หน้าชั้นยา',secondDraft),null,'ห้ามบันทึกชื่อแม่แบบซ้ำ');
context.saveNamedPriceLabelTemplate('80x50','ป้ายราคาดำ',secondDraft,namedTwo.id);
templateLibrary = context.getPriceLabelTemplateLibrary('80x50');
assert.equal(templateLibrary.activeId,namedTwo.id);
assert.equal(context.getPriceLabelTemplate('80x50').elements.price.x,5);
const deletedTemplate = context.deleteNamedPriceLabelTemplate('80x50',namedTwo.id);
assert.equal(deletedTemplate.library.templates.length,1);
assert.equal(deletedTemplate.library.activeId,namedOne.id);
assert.equal(context.getPriceLabelTemplate('80x50').elements.price.x,35);

printHtml = '';
assert.equal(context.writeBarcodePrintWindow(printWindow,[{pid:1,unit:'กล่อง',barcode:'NEW-001',qty:1}]), true);
assert.match(printHtml, /@page\{size:50mm 30mm;margin:0\}/);
assert.match(printHtml, /ป้ายราคา 50 × 30 มม\. แนวนอน/);
assert.doesNotMatch(printHtml, /promotion|ป้ายโปรโมชั่น/);

assert.match(html, /barcodeprint:\s*renderBarcodePrint/);
assert.match(html, /LEVEL2_HIDDEN_TABS[^\n]+barcodeprint/);
assert.match(html, /id="savePrintBarcodeBtn"/);
assert.match(html, /id="barcodePrintAddMissingBtn"/);
assert.match(html, /พิมพ์ป้ายราคา/);
assert.match(html, /ค่าเริ่มต้นเป็นป้ายแนวนอน 50 × 30 มม\./);
assert.doesNotMatch(html, /class="barcode-print-help"/);
assert.match(html, /barcodePrintLabelSize = '50x30'/);
assert.doesNotMatch(html, /id="barcodePrintLabelType"/);
assert.doesNotMatch(html, /barcodePrintPromotionDetails|barcodePrintPromotionForItem/);
assert.doesNotMatch(html, /รูปแบบ: ป้ายโปรโมชั่น|ป้ายโปรโมชั่นจะดึงเงื่อนไข/);
assert.match(html, /value="50x30"[^>]*>ป้ายราคา 50 × 30 มม\. \(ค่าเริ่มต้น\)/);
assert.match(html, /data-barcode-print-page/);
assert.match(html, /BARCODE_PRINT_PAGE_SIZE = 10/);
assert.match(html, /\.main\.barcode-print-main\{overflow-y:hidden;\}/);
assert.match(html, /\.barcode-print-table-wrap\{[^}]*flex:1;[^}]*overflow-y:hidden;/);
assert.match(html, /classList\.toggle\('barcode-print-main',currentTab==='barcodeprint'\)/);
assert.match(html, /@page\{size:\$\{width\}mm \$\{height\}mm;margin:0\}/);

console.log('barcode print tests passed');
}

run().catch(error=>{ console.error(error); process.exitCode=1; });
