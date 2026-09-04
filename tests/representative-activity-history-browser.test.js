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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless:true, executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1600,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const query=new Proxy({}, {get(_target,property){
        if(property==='then') return resolve=>resolve({data:[],error:null});
        return ()=>query;
      }});
      window.supabase={createClient:()=>new Proxy({
        auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}
      }, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof renderRepresentativeHistory === 'function');

  await page.evaluate(() => {
    currentProfile={id:'owner-test',level:1,owner:true,firstName:'เจ้าของ'};
    warehouses=[{id:1,name:'คลังทดสอบ'}]; activeWarehouseId=1; warehouseAccessRows=[];
    salesRepresentatives=[
      {id:10,code:'REP-10',name:'PEPO',company:'บริษัทตัวแทน A'},
      {id:11,code:'REP-11',name:'NANA',company:'บริษัทตัวแทน B'},
      {id:12,code:'REP-12',name:'JOJO',company:'บริษัทตัวแทน C'}
    ];
    products=[
      {id:20,sku:'LIP10',name:'LIPITOR 10 MG',unit:'กล่อง',barcode:'8850000000001',extraBarcodes:[],supplierBarcodes:[]},
      {id:21,sku:'LIP20',name:'LIPITOR 20 MG',unit:'กล่อง',barcode:'8850000000002',extraBarcodes:[],supplierBarcodes:[]},
      {id:22,sku:'LIP30',name:'LIPITOR 30 MG',unit:'กล่อง',barcode:'8850000000003',extraBarcodes:[],supplierBarcodes:[]}
    ];
    representativeHistoryContext={representativeId:10,productId:null,originTab:'salesreps'};
    representativeProductAssignments=[
      {representativeId:10,productId:20},{representativeId:10,productId:21},{representativeId:10,productId:22}
    ];
    representativeActivityNotes=[
      {id:'note-1',title:'เล่นรายการทอง',contentHtml:'<p>บลาบลาบลา</p>',hiddenFromLevel2:false,representativeId:10,activityType:'general',eventDate:'2026-09-04',updatedAt:'2026-09-04T10:00:00Z'},
      {id:'note-2',title:'ซื้อครบไปเที่ยวฟรี',contentHtml:'<p>ซื้อครบตามยอดที่กำหนด</p>',hiddenFromLevel2:false,representativeId:10,activityType:'general',eventDate:'2026-09-02',updatedAt:'2026-09-02T10:00:00Z'}
    ];
    representativeActivityLoadedKey=representativeHistoryKey();
    currentTab='salesreps';
    document.getElementById('main').innerHTML=renderSalesRepresentatives();
    attachEvents();
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(screen=>{screen.style.display='none';});
  });

  assert.equal(await page.locator('.representative-history-page h1').textContent(), 'ข้อมูลผู้แทน PEPO');
  assert.equal(await page.locator('.representative-group-card').count(), 1);
  assert.match(await page.locator('.representative-group-card').textContent(), /LIPITOR 10 MG/);
  assert.match(await page.locator('.representative-group-card').textContent(), /NOTE 1 : เล่นรายการทอง/);
  assert.match(await page.locator('.representative-group-card').textContent(), /วันที่ 04-09-2026/);
  assert.match(await page.locator('.representative-group-card').textContent(), /NOTE 2 : ซื้อครบไปเที่ยวฟรี/);

  await page.locator('#newRepresentativeActivityBtn').click();
  assert.equal(await page.locator('#repActivityRepresentative').inputValue(), '10');
  assert.equal(await page.locator('.representative-activity-item-editor').count(),3);
  assert.equal(await page.locator('#repActivityType,#repActivityValidFrom,#repActivityValidTo,#repActivityReminderDate,[data-representative-item-field="quotedPrice"],[data-representative-item-field="minimumQuantity"],[data-representative-item-field="unit"],[data-representative-item-field="conditionNote"]').count(),0);
  await page.locator('#addRepresentativeActivityItemBtn').click();
  const lastItem=page.locator('.representative-activity-item-editor').last();
  await lastItem.locator('[data-representative-item-field="productSearch"]').fill('LIP30');
  await lastItem.locator('[data-representative-item-field="productSearch"]').press('Enter');
  assert.equal(await lastItem.locator('[data-representative-item-field="productId"]').inputValue(),'22');
  assert.equal(await page.locator('.representative-activity-item-editor').first().locator('[data-representative-item-field="productId"]').inputValue(),'20','adding another product must preserve existing managed products');
  await page.locator('#cancelRepresentativeActivityBottomBtn').click();

  await page.evaluate(() => {
    currentTab='representativehistory';
    representativeHistoryContext=centralRepresentativeHistoryContext();
    representativeHistoryFilter=emptyRepresentativeHistoryFilter();
    representativeProductAssignments=[
      {representativeId:10,productId:20},{representativeId:10,productId:21},{representativeId:10,productId:22},
      {representativeId:11,productId:20},{representativeId:12,productId:21}
    ];
    representativeActivityNotes=[...representativeActivityNotes,
      {id:'note-3',title:'แจ้งรอบส่งสินค้า',contentHtml:'<p>ส่งทุกวันจันทร์</p>',hiddenFromLevel2:false,representativeId:11,activityType:'general',eventDate:'2026-09-03',updatedAt:'2026-09-03T10:00:00Z'},
      {id:'note-4',title:'รายการหน้าฝน',contentHtml:'<p>เริ่มเดือนหน้า</p>',hiddenFromLevel2:false,representativeId:12,activityType:'general',eventDate:'2026-09-01',updatedAt:'2026-09-01T10:00:00Z'}
    ];
    representativeActivityLoadedKey=representativeHistoryKey();
    document.getElementById('main').innerHTML=renderRepresentativeHistoryOverview();
    attachEvents();
  });
  assert.equal(await page.locator('.representative-group-card').count(),3);
  assert.equal(await page.locator('#representativeHistoryRepresentativeSearch,#representativeHistoryProductSearch,#representativeHistoryNoteSearch').count(),3);
  const cardPositions=await page.locator('.representative-group-card').evaluateAll(elements=>elements.map(element=>Math.round(element.getBoundingClientRect().y)));
  assert.equal(cardPositions[0],cardPositions[1]);
  assert.equal(cardPositions[1],cardPositions[2]);

  await page.locator('#representativeHistoryRepresentativeSearch').fill('NANA');
  await page.locator('#searchRepresentativeHistoryBtn').click();
  assert.equal(await page.locator('.representative-group-card').count(),1);
  assert.match(await page.locator('.representative-group-card').textContent(),/NANA/);
  await page.locator('#representativeHistoryRepresentativeSearch').fill('');
  await page.locator('#representativeHistoryProductSearch').fill('LIPITOR 30');
  await page.locator('#representativeHistoryProductSearch').press('Enter');
  assert.equal(await page.locator('.representative-group-card').count(),1);
  assert.match(await page.locator('.representative-group-card').textContent(),/PEPO/);
  await page.locator('#representativeHistoryProductSearch').fill('');
  await page.locator('#representativeHistoryNoteSearch').fill('หน้าฝน');
  await page.locator('#searchRepresentativeHistoryBtn').click();
  assert.equal(await page.locator('.representative-group-card').count(),1);
  assert.match(await page.locator('.representative-group-card').textContent(),/JOJO/);

  await page.locator('#representativeHistoryNoteSearch').fill('');
  await page.locator('#searchRepresentativeHistoryBtn').click();
  await page.locator('[data-open-product-history="20"]').first().click();
  assert.equal(await page.locator('.representative-history-page h1').textContent(), 'ผู้แทนที่ดูแล LIPITOR 10 MG');
  assert.equal(await page.locator('#closeRepresentativeHistoryBtn').count(),1);
  assert.deepEqual(errors, []);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
});
