const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
  if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});

const browserExecutable = [
  process.env.PEPOS_BROWSER_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless:true, executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1280,height:850}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const rows=[
        {representative_id:10,product_id:101,created_at:'2026-09-01',updated_at:'2026-09-01'},
        {representative_id:10,product_id:102,created_at:'2026-09-01',updated_at:'2026-09-01'}
      ];
      const queryFor=table=>{
        const data=table==='sales_representative_products'?rows:[];
        const query=new Proxy({}, {get(_target,property){
          if(property==='then') return resolve=>resolve({data,error:null});
          if(property==='range') return ()=>Promise.resolve({data,error:null});
          return ()=>query;
        }});
        return query;
      };
      window.supabase={createClient:()=>({
        auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
        from:table=>queryFor(table),rpc:()=>queryFor('')
      })};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof openShortageManagedProductsModal === 'function');
  await page.evaluate(() => {
    document.querySelectorAll('.login-screen').forEach(screen=>{ screen.style.display='none'; });
    products=[
      {id:101,name:'ยา A',sku:'A-101',barcode:'885000101',unit:'กล่อง',price:100,cost:50,stock:10,units:[],extraBarcodes:[],vendorBarcodes:[],active:true},
      {id:102,name:'ยา B',sku:'B-102',barcode:'885000102',unit:'ขวด',price:200,cost:100,stock:10,units:[],extraBarcodes:[],vendorBarcodes:[],active:true},
      {id:103,name:'ยา C',sku:'C-103',barcode:'885000103',unit:'ชิ้น',price:300,cost:150,stock:10,units:[],extraBarcodes:[],vendorBarcodes:[],active:true},
    ];
    salesRepresentatives=[{id:10,name:'PEPO',phone:'0812345678',line:'pepo',company:'บริษัท PEPO',note:''}];
    contacts=[{id:20,name:'บริษัท PEPO',types:['supplier'],creditDays:15,address:'กรุงเทพฯ',taxId:'',phone:'',line:'',email:''}];
    representativeProductAssignments=[];
    purchaseOrders=[];
    purchaseOrdersFull=[];
    currentTab='purchaseorder';
    editingPOId='new';
    editingPO2Id=null;
    po2Draft=null;
    poDraft={id:'SH202609060001',supplier:'PEPO',date:'2026-09-06',credit:0,dueDate:'',items:[{name:'',qty:1,unit:'',price:''}],note:'',discount:0,taxMode:'none'};
    render=()=>{
      document.getElementById('main').innerHTML=currentTab==='purchaseorder2'
        ? (editingPO2Id===null?renderPurchaseOrder2():renderPOForm('po2'))
        : (editingPOId===null?renderPurchaseOrder():renderPOForm('po'));
      attachEvents();
    };
    render();
  });

  assert.equal(await page.locator('#shortageManagedProductsBtn').count(), 1);
  assert.equal(await page.locator('.shortage-form-grid > .shortage-form-main').count(), 1);
  assert.equal(await page.locator('.shortage-form-grid > .shortage-rep-summary').count(), 1);
  assert.equal(await page.locator('#editPORepBtn').count(), 0, 'edit representative button must be removed from the shortage form');
  const mainBox = await page.locator('.shortage-form-main').boundingBox();
  const summaryBox = await page.locator('.shortage-rep-summary').boundingBox();
  assert.ok(mainBox && summaryBox && mainBox.x < summaryBox.x, 'form fields must be on the left and representative information on the right');
  assert.ok(Math.abs(mainBox.y - summaryBox.y) < 2, 'both shortage form columns must begin on the same row');
  assert.ok(Math.abs(mainBox.width - summaryBox.width) < 2, 'representative information must use half of the available header width');
  const controlOrder = await page.locator('.shortage-form-controls').evaluate(element=>[...element.children].map(child=>child.id||child.className));
  assert.deepEqual(controlOrder, ['shortage-date-field','shortage-rep-field','newPORepBtn','shortageManagedProductsBtn']);
  const dateFieldBox = await page.locator('.shortage-date-field').boundingBox();
  const representativeFieldBox = await page.locator('.shortage-rep-field').boundingBox();
  assert.ok(dateFieldBox && representativeFieldBox && representativeFieldBox.x-dateFieldBox.x-dateFieldBox.width <= 12, 'representative field must begin immediately after the order date without unused space');
  const dateInputBox = await page.locator('#po_date').boundingBox();
  const nativeCalendarBox = await page.locator('.shortage-date-field .dmy-native').boundingBox();
  assert.ok(dateInputBox && nativeCalendarBox && Math.abs(dateInputBox.width-dateFieldBox.width) < 2, 'order date input must extend through the calendar icon area');
  assert.ok(nativeCalendarBox.width <= 31, 'calendar picker must only cover its icon, not the text input');
  await page.locator('#po_date').click({position:{x:20,y:20}});
  await page.keyboard.press('Control+A');
  await page.keyboard.type('07092026');
  assert.equal(await page.locator('#po_date').inputValue(), '07/09/2026', 'order date must accept direct numeric typing');
  const shortageButtonColors = await page.locator('#shortageManagedProductsBtn, #savePOBtn').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundColor));
  assert.equal(shortageButtonColors[0],shortageButtonColors[1],'managed-products button must match the save-document button color');
  assert.match(await page.locator('.shortage-rep-summary').textContent(), /ข้อมูลผู้แทน[\s\S]*0812345678[\s\S]*pepo/);
  await page.locator('#shortageManagedProductsBtn').click();
  await page.waitForSelector('.shortage-managed-product-card');
  assert.equal(await page.locator('.shortage-managed-products-modal').count(), 1);
  assert.equal(await page.locator('.shortage-managed-product-card').count(), 2, 'only products assigned to the selected representative must appear');
  assert.match(await page.locator('.shortage-managed-products-modal').textContent(), /ผู้แทน PEPO/);
  assert.equal(await page.locator('.shortage-managed-products-modal').textContent().then(text=>text.includes('ยา C')), false);

  await page.locator('#shortageManagedProductsSearch').fill('B-102');
  assert.equal(await page.locator('.shortage-managed-product-card').count(), 1);
  await page.locator('#shortageManagedProductsSearch').fill('');
  await page.locator('[data-shortage-managed-product="101"]').click();
  assert.equal(await page.locator('#poItemRows .poi_name').first().inputValue(), 'ยา A');
  assert.equal(await page.locator('#poItemRows .poi_qty').first().inputValue(), '1');
  assert.equal(await page.locator('.shortage-managed-products-modal').count(), 1, 'popup must stay open so several products can be added');
  await page.locator('[data-shortage-managed-product="101"]').click();
  assert.equal(await page.locator('#poItemRows .poi_qty').first().inputValue(), '2');
  await page.locator('[data-shortage-managed-product="102"]').click();
  assert.deepEqual(await page.locator('#poItemRows .poi_name').evaluateAll(inputs=>inputs.map(input=>input.value)), ['ยา A','ยา B']);
  await page.locator('#closeShortageManagedProductsBtn').click();
  assert.equal(await page.locator('.shortage-managed-products-modal').count(), 0);
  await page.locator('#po_note').fill('สั่งรอบเย็น');
  await page.locator('#createPurchaseOrderFromShortageBtn').click();
  await page.waitForSelector('#po_tax_mode');
  assert.equal(await page.locator('#po_supplier').inputValue(), 'บริษัท PEPO');
  assert.equal(await page.locator('#po_date').inputValue(), '07/09/2026');
  assert.equal(await page.locator('#po_credit').inputValue(), '15');
  assert.deepEqual(await page.locator('#poItemRows .poi_name').evaluateAll(inputs=>inputs.map(input=>input.value)), ['ยา A','ยา B']);
  assert.deepEqual(await page.locator('#poItemRows .poi_qty').evaluateAll(inputs=>inputs.map(input=>input.value)), ['2','1']);
  assert.deepEqual(await page.locator('#poItemRows .poi_price').evaluateAll(inputs=>inputs.map(input=>input.value)), ['','']);
  assert.equal(await page.locator('#po_note').inputValue(), 'สั่งรอบเย็น');
  assert.deepEqual(await page.evaluate(()=>({shortageCount:purchaseOrders.length,formalCount:purchaseOrdersFull.length,status:purchaseOrders[0]?.status})), {shortageCount:1,formalCount:0,status:'รอสั่งของ'}, 'รายการต้นทางต้องยังอยู่และยังไม่เปลี่ยนสถานะก่อนบันทึกใบสั่งซื้อ');
  await page.locator('#savePOBtn').click();
  await page.waitForSelector('#newPO2Btn');
  assert.deepEqual(await page.evaluate(()=>({formalCount:purchaseOrdersFull.length,sourceId:purchaseOrdersFull[0]?.sourceShortageId,status:purchaseOrders[0]?.status})), {formalCount:1,sourceId:'SH202609060001',status:'สั่งแล้ว'});
  assert.equal(await page.evaluate(()=>purchaseOrdersFull[0].items.every(item=>item.productId)), true, 'รายการในใบสั่งซื้อต้องเชื่อมกับสินค้าเดิม');
  assert.deepEqual(errors, [], `พบ JavaScript error: ${errors.join(' | ')}`);
  console.log('shortage managed products browser tests passed');
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(async()=>{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
});
