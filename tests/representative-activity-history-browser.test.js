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
    salesRepresentatives=[{id:10,code:'REP-10',name:'คุณโป้',phone:'0812345678',line:'po-test',company:'บริษัทตัวแทน',note:''}];
    products=[
      {id:20,sku:'50264',name:'Decolgen',unit:'กล่อง',barcode:'8850000000001',extraBarcodes:[],supplierBarcodes:[]},
      {id:21,sku:'50265',name:'Lotemo Kids',unit:'ขวด',barcode:'8850000000002',extraBarcodes:[],supplierBarcodes:[]}
    ];
    representativeHistoryContext={representativeId:10,productId:null,originTab:'salesreps'};
    representativeActivityLoadedKey=representativeHistoryKey();
    representativeActivityNotes=[{
      id:'activity-1',title:'โปรโมชั่นเดือนกันยายน',contentHtml:'<p>ซื้อ 10 กล่อง แถม 1 กล่อง</p>',hiddenFromLevel2:false,
      representativeId:10,productId:20,activityType:'promotion',eventDate:'2026-09-01',validFrom:'2026-09-01',validTo:'2026-09-30',
      quotedPrice:160,minimumQuantity:10,unit:'กล่อง',reminderDate:'2026-09-25',updatedAt:'2026-09-01T10:00:00Z',
      activityItems:[{id:1,productId:20,name:'Decolgen',quotedPrice:160,minimumQuantity:10,unit:'กล่อง',conditionNote:'ซื้อ 10 แถม 1',sortOrder:0}]
    }];
    purchaseOrders=[]; goodsReceipts=[]; purchaseOrdersFull=[]; productReturns=[];
    currentTab='salesreps';
    document.getElementById('main').innerHTML=renderSalesRepresentatives();
    attachEvents();
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(screen=>{screen.style.display='none';});
  });

  assert.equal(await page.locator('.representative-history-page h1').textContent(), 'ประวัติผู้แทน คุณโป้');
  assert.equal(await page.locator('.representative-activity-card').count(), 1);
  assert.match(await page.locator('.representative-activity-card').textContent(), /Decolgen/);
  assert.match(await page.locator('.representative-activity-card').textContent(), /160\.00 บาท/);
  assert.match(await page.locator('.representative-activity-source').textContent(), /NOTE/);

  await page.locator('#newRepresentativeActivityBtn').click();
  assert.equal(await page.locator('#repActivityRepresentative').inputValue(), '10');
  const firstItem=page.locator('.representative-activity-item-editor').first();
  await firstItem.locator('[data-representative-item-field="productSearch"]').fill('50264');
  await firstItem.locator('[data-representative-item-field="productSearch"]').press('Enter');
  assert.equal(await firstItem.locator('[data-representative-item-field="productId"]').inputValue(), '20');
  assert.equal(await firstItem.locator('[data-representative-item-field="unit"]').inputValue(), 'กล่อง');
  await firstItem.locator('[data-representative-item-field="quotedPrice"]').fill('155');
  await page.locator('#addRepresentativeActivityItemBtn').click();
  assert.equal(await page.locator('.representative-activity-item-editor').count(),2);
  const secondItem=page.locator('.representative-activity-item-editor').nth(1);
  await secondItem.locator('[data-representative-item-field="productSearch"]').fill('50265');
  await secondItem.locator('[data-representative-item-field="productSearch"]').press('Enter');
  assert.equal(await secondItem.locator('[data-representative-item-field="productId"]').inputValue(),'21');
  assert.equal(await secondItem.locator('[data-representative-item-field="unit"]').inputValue(),'ขวด');
  assert.equal(await firstItem.locator('[data-representative-item-field="quotedPrice"]').inputValue(),'155','adding another item must preserve the first row');

  await page.locator('#cancelRepresentativeActivityBottomBtn').click();
  await page.locator('#representativeHistoryTypeFilter').selectOption('contact');
  assert.equal(await page.locator('.representative-activity-card').count(), 0);
  assert.match(await page.locator('.representative-history-empty').textContent(), /ยังไม่มีประวัติ/);

  await page.evaluate(() => {
    currentTab='representativehistory';
    representativeHistoryContext=centralRepresentativeHistoryContext();
    representativeHistoryFilter=emptyRepresentativeHistoryFilter();
    const firstActivity=representativeActivityNotes[0];
    representativeActivityNotes=[firstActivity,...[2,3,4].map(number=>({
      ...firstActivity,
      id:`activity-${number}`,
      title:`โปรโมชั่นชุดที่ ${number}`,
      eventDate:`2026-09-0${number}`,
      updatedAt:`2026-09-0${number}T10:00:00Z`
    }))];
    representativeActivityLoadedKey=representativeHistoryKey();
    document.getElementById('main').innerHTML=renderRepresentativeHistoryOverview();
    attachEvents();
  });
  assert.equal(await page.locator('.representative-history-page h1').textContent(), 'ประวัติผู้แทน');
  assert.equal(await page.locator('#representativeHistoryTypeFilter').count(), 1);
  assert.equal(await page.locator('#searchRepresentativeHistoryBtn').count(), 1);
  assert.equal(await page.locator('#representativeHistoryRepresentativeFilter,#representativeHistoryProductFilter,#representativeHistoryFromFilter,#representativeHistoryToFilter,#representativeHistoryReminderFilter,#clearRepresentativeHistoryFiltersBtn,#reloadRepresentativeHistoryBtn,.representative-history-result-count').count(), 0);
  const filterTops=await page.locator('#representativeHistoryTypeFilter,#searchRepresentativeHistoryBtn').evaluateAll(elements=>elements.map(element=>Math.round(element.getBoundingClientRect().top)));
  assert.ok(Math.abs(filterTops[0]-filterTops[1])<=2,'type and search controls must share one row');
  assert.equal(await page.locator('.representative-activity-card').count(), 4);
  const cardPositions=await page.locator('.representative-activity-card').evaluateAll(elements=>elements.map(element=>{
    const box=element.getBoundingClientRect();
    return {x:Math.round(box.x),y:Math.round(box.y)};
  }));
  assert.equal(cardPositions[0].y,cardPositions[1].y);
  assert.equal(cardPositions[1].y,cardPositions[2].y);
  assert.ok(cardPositions[0].x<cardPositions[1].x&&cardPositions[1].x<cardPositions[2].x,'desktop must show three history cards per row');
  assert.ok(cardPositions[3].y>cardPositions[0].y,'the fourth card must start a new row');
  await page.locator('#representativeHistorySearch').fill('ไม่พบรายการนี้');
  await page.locator('#searchRepresentativeHistoryBtn').click();
  assert.equal(await page.locator('.representative-activity-card').count(), 0);
  await page.locator('#representativeHistorySearch').fill('');
  await page.locator('#representativeHistorySearch').press('Enter');
  assert.equal(await page.locator('.representative-activity-card').count(), 4);
  await page.locator('[data-open-representative-history="10"]').first().click();
  assert.equal(await page.locator('.representative-history-page h1').textContent(), 'ประวัติผู้แทน คุณโป้');
  assert.equal(await page.locator('#closeRepresentativeHistoryBtn').count(), 1);
  assert.deepEqual(errors, []);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
});
