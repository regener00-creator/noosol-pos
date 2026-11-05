const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID}=require('node:crypto');

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
  currentProfile:{id:'owner-test'},
  navigator:{onLine:true},
  crypto:{randomUUID},
  productDirtyOperations:new Map(),
  syncedTableRows:{},
  captureWorkspaceRead:()=>({actor:'owner-test'}),
  isWorkspaceReadCurrent:()=>true,
  isProductActive: product => Boolean(product)&&product.active!==false,
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
  persistProductChangesToIndexedDB:async options=>{persistCount++;persistOptions=options;return true;},
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
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/data/record-mappers.js'),'utf8'),context);
vm.runInContext(html.slice(start, end), context);
const requests=new Map();
const rpcCalls=[];
let nextNumber=0;
context.sb={rpc:async(name,args)=>{
  assert.equal(name,'assign_price_label_barcodes');
  rpcCalls.push(args);
  if(requests.has(args.p_request_id)) return {data:requests.get(args.p_request_id),error:null};
  const items=args.p_items.map(item=>({...item,barcode:item.barcode||'P'+String(nextNumber++).padStart(11,'0')}));
  const rows=items.map(item=>{
    const product=JSON.parse(JSON.stringify(products.find(product=>product.id===item.pid)));
    if(item.unit===product.unit) product.barcode=item.barcode;
    else product.units.find(unit=>unit.sub===item.unit).barcode=item.barcode;
    product._revision=(product._revision||0)+1;
    return context.productMetadataToRow(product);
  });
  const data={items,products:rows}; requests.set(args.p_request_id,data);return {data,error:null};
}};

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
assert.equal(firstItem.barcode, '', 'ไม่คาดเดาเลขส่วนกลางก่อนบันทึกและพิมพ์');
assert.equal(firstItem.qty, 1);
assert.deepEqual(Array.from(context.barcodeReprintUnitOptions(products[0]),option=>option.name),['ลัง']);
assert.deepEqual(JSON.parse(JSON.stringify(context.barcodeReprintItem(1,'ลัง',3))),{pid:1,unit:'ลัง',barcode:'CASE-001',qty:3});
assert.equal(context.barcodeReprintItem(2,'ขวด',1).barcode,'OLD-002');
assert.throws(()=>context.barcodeReprintItem(1,'กล่อง',1),/ไม่พบหน่วย/);
assert.throws(()=>context.barcodeReprintItem(999,'กล่อง',1),/ไม่พบหน่วย/);
for(const qty of [0,-1,1.5,501,'abc','']) assert.throws(()=>context.barcodeReprintItem(2,'ขวด',qty),/จำนวนป้าย/);
products[1].active=false;
assert.throws(()=>context.barcodeReprintItem(2,'ขวด',1),/ไม่พบหน่วย/);
delete products[1].active;
assert.equal(rpcCalls.length,0,'preparing a reprint does not allocate a barcode');
assert.equal(persistCount,0,'preparing a reprint does not save product data');
context.barcodePrintItems.push(firstItem);
assert.equal(context.barcodePrintAddProduct(products[0]), false);
assert.equal(context.barcodePrintAddProduct(products[1]), false, 'สินค้าที่มีบาร์โค้ดครบแล้วต้องเพิ่มเข้าคิวไม่ได้');
assert.equal(context.barcodePrintAddProduct(null), false);
assert.deepEqual(Array.from(context.barcodePrintAvailableProducts(),product=>product.id),[1]);
assert.deepEqual(Array.from(context.barcodePrintAvailableProducts({category:'อื่น'})),[]);
assert.deepEqual(Array.from(context.barcodePrintAvailableProducts({brand:'อื่น'})),[]);
const mixedUnitProduct={id:3,sku:'P-003',name:'สินค้ามีบาร์โค้ดเฉพาะหน่วยหลัก',unit:'กล่อง',barcode:'MAIN-003',units:[{sub:'แผง',barcode:'  ',price:10}]};
products.push(mixedUnitProduct,{id:4,name:'เลิกใช้',unit:'ชิ้น',barcode:'',active:false});
assert.deepEqual(Array.from(context.barcodePrintAvailableProducts(),product=>product.id),[1,3]);
assert.equal(context.barcodePrintAddProduct(products[3]),false,'ไม่เพิ่มสินค้าที่เลิกใช้');
assert.equal(context.barcodePrintAddProduct(mixedUnitProduct),true);
assert.equal(context.barcodePrintItems[1].unit,'แผง','เลือกหน่วยที่ยังไม่มีบาร์โค้ดเป็นค่าเริ่มต้น');
assert.deepEqual(Array.from(context.barcodePrintMissingUnitOptions(mixedUnitProduct),option=>option.name),['แผง']);
assert.equal(context.createBarcodePrintItem(products[1]),null,'ไม่สร้างรายการจากหน่วยที่มีบาร์โค้ดครบแล้ว');
for(const code of ['MAIN-003','REPLACEMENT-003']){
  assert.match(context.barcodePrintValidation([{pid:3,unit:'กล่อง',barcode:code,qty:1}])[0].message,/มีบาร์โค้ดแล้ว/,'ห้ามพิมพ์รหัสเดิมหรือเขียนทับรหัสเดิม');
}
context.barcodePrintItems.pop();
mixedUnitProduct.units[0].barcode='SUB-003';
assert.equal(context.barcodePrintNeedsBarcode(mixedUnitProduct),false);
products.splice(2);

const pendingItem=context.barcodePrintItems[0];
context.barcodePrintItems.push({pid:2,unit:'ขวด',barcode:'OLD-002',qty:1});
const rowsBefore=context.barcodePrintRowsHtml();
assert.doesNotMatch(rowsBefore,/>ลัง<\/option>/,'หน่วยที่มีบาร์โค้ดแล้วไม่อยู่ใน dropdown');
assert.doesNotMatch(rowsBefore,/OLD-002/,'รายการเก่าที่มีบาร์โค้ดแล้วไม่แสดงเป็นแถวพิมพ์');
context.reconcileBarcodePrintItems();
assert.deepEqual(Array.from(context.barcodePrintItems),[pendingItem],'เอาเฉพาะรายการเดิมที่มีบาร์โค้ดแล้วออก');
const queueBeforeBlockedSave=context.barcodePrintItems;
context.barcodePrintItems=[{pid:2,unit:'ขวด',barcode:'REPLACEMENT',qty:1}];
let rejectedWindowClosed=false;
assert.equal(await context.saveBarcodePrintItems({closed:false,close(){rejectedWindowClosed=true;}}),false);
assert.equal(rejectedWindowClosed,true);
assert.equal(products[1].barcode,'OLD-002');
assert.equal(persistCount,0,'ต้องปฏิเสธก่อนบันทึกข้อมูล');
context.barcodePrintItems=queueBeforeBlockedSave;

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
assert.equal(context.barcodePrintItems.length,0,'หลังบันทึกไม่เหลือหน่วยที่สร้างบาร์โค้ดแล้วในคิว');
assert.deepEqual(Array.from(context.barcodePrintAvailableProducts()),[],'สินค้าที่สร้างบาร์โค้ดครบแล้วไม่ปรากฏให้เลือกอีก');
assert.equal(persistCount, 1);
assert.deepEqual(JSON.parse(JSON.stringify(persistOptions)),{updatedIds:[1]});
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

for(const qty of [1,36,37,72]){
  printHtml='';
  context.writeBarcodePrintWindow(printWindow,[{pid:1,unit:'กล่อง',barcode:'NEW-001',qty}],'a4-50x30');
  assert.match(printHtml,/@page\{size:A4 portrait;margin:0\}/);
  assert.equal((printHtml.match(/<section class="label"/g)||[]).length,qty);
  assert.equal((printHtml.match(/<section class="label-sheet"/g)||[]).length,Math.ceil(qty/36));
  assert.equal((printHtml.match(/class="label-cut-cell"/g)||[]).length,Math.ceil(qty/36)*36);
}

assert.match(html, /barcodeprint:\s*\(\)=>renderBarcodePrint\(\)/);
assert.match(html, /LEVEL2_HIDDEN_TABS[^\n]+barcodeprint/);
assert.match(html, /id="savePrintBarcodeBtn"/);
assert.match(html, /id="barcodePrintAddMissingBtn"/);
assert.match(html, /พิมพ์ป้ายราคา/);
context.pagerHtml=()=>'';
assert.match(context.renderBarcodePrint(), /data-barcode-print-mode="new"/);
assert.match(context.renderBarcodePrint(), /data-barcode-print-mode="reprint"/);
context.setBarcodePrintMode('new');
assert.match(context.renderBarcodePrint(), /ค่าเริ่มต้นเป็นป้ายแนวนอน 50 × 30 มม\./);
context.readBarcodePaperSize=()=> '60x40';
assert.match(context.renderBarcodePrint(), /ค่าเริ่มต้นเป็นป้ายแนวนอน 60 × 40 มม\./);
assert.doesNotMatch(html, /class="barcode-print-help"/);
assert.match(html, /barcodePrintLabelSize = typeof readBarcodePaperSize==='function'\?readBarcodePaperSize\(\):'50x30'/);
assert.doesNotMatch(html, /id="barcodePrintLabelType"/);
assert.doesNotMatch(html, /barcodePrintPromotionDetails|barcodePrintPromotionForItem/);
assert.doesNotMatch(html, /รูปแบบ: ป้ายโปรโมชั่น|ป้ายโปรโมชั่นจะดึงเงื่อนไข/);
assert.match(html, /value="50x30"[^>]*>ป้ายราคา 50 × 30 มม\./);
assert.match(html, /data-barcode-print-page/);
assert.match(html, /BARCODE_PRINT_PAGE_SIZE = 10/);
assert.match(html, /\.main\.barcode-print-main\{overflow-y:hidden;\}/);
assert.match(html, /\.barcode-print-table-wrap\{[^}]*flex:1;[^}]*overflow-y:hidden;/);
assert.match(html, /classList\.toggle\('barcode-print-main',currentTab==='barcodeprint'\)/);
assert.match(html, /@page\{size:\$\{width\}mm \$\{height\}mm;margin:0\}/);

// A lost response must retry the same central job, never issue a second number.
const retryProduct={id:5,unit:'กล่อง',barcode:'',units:[]};
products.push(retryProduct);
context.barcodePrintItems=[{pid:5,unit:'กล่อง',barcode:'',qty:1}];
const originalRpc=context.sb.rpc;
context.sb.rpc=async(name,args)=>{
  await originalRpc(name,args);
  context.renderBarcodePrint();
  assert.equal(context.barcodePrintItems.length,1,'การวาดหน้าระหว่างรอบันทึกต้องไม่ล้างคิวก่อนทราบผล');
  return {data:null,error:{message:'response lost'}};
};
assert.equal(await context.saveBarcodePrintItems(null),false);
assert.equal(retryProduct.barcode,'');
assert.equal(context.barcodePrintValidation().length,0);
assert.equal(context.barcodePrintItems[0].barcode,'');
assert.equal(context.barcodePrintValidation([]).length,1,'ไม่เปิดงานพิมพ์ว่าง');
context.sb.rpc=originalRpc;
printHtml='';
assert.equal(await context.saveBarcodePrintItems(printWindow),true);
assert.equal(retryProduct.barcode,'P00000000000');
assert.equal(rpcCalls.at(-1).p_request_id,rpcCalls.at(-2).p_request_id);
assert.match(printHtml,/P00000000000/,'ยังสร้างหน้าพิมพ์จากรายการที่เพิ่งบันทึกแม้เอาออกจากคิวแล้ว');
assert.equal(context.barcodePrintItems.length,0);
products.push({id:6,unit:'กล่อง',barcode:'',units:[]});
context.barcodePrintItems=[{pid:6,unit:'กล่อง',barcode:'',qty:1}];
context.navigator.onLine=false;
const callCount=rpcCalls.length;
assert.equal(await context.saveBarcodePrintItems(null),false);
assert.equal(rpcCalls.length,callCount,'offline must not allocate local numbers');
context.navigator.onLine=true;
context.productDirtyOperations.set('6','update');
assert.equal(await context.saveBarcodePrintItems(null),false);
assert.equal(rpcCalls.length,callCount,'unsynced product edits are not overwritten');
context.productDirtyOperations.clear();
context.persistProductChangesToIndexedDB=async()=>false;
assert.equal(await context.saveBarcodePrintItems(printWindow),true,'central commit remains valid when local cache fails');
assert.equal(products.at(-1).barcode,'P00000000001');

console.log('barcode print tests passed');
}

run().catch(error=>{ console.error(error); process.exitCode=1; });
