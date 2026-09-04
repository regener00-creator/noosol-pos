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
  const page = await browser.newPage({viewport:{width:1366,height:900}});
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
    products=[{id:20,sku:'50264',name:'Decolgen',unit:'กล่อง',barcode:'8850000000001',extraBarcodes:[],supplierBarcodes:[]}];
    representativeHistoryContext={representativeId:10,productId:null,originTab:'salesreps'};
    representativeActivityLoadedKey=representativeHistoryKey();
    representativeActivityNotes=[{
      id:'activity-1',title:'โปรโมชั่นเดือนกันยายน',contentHtml:'<p>ซื้อ 10 กล่อง แถม 1 กล่อง</p>',hiddenFromLevel2:false,
      representativeId:10,productId:20,activityType:'promotion',eventDate:'2026-09-01',validFrom:'2026-09-01',validTo:'2026-09-30',
      quotedPrice:160,minimumQuantity:10,unit:'กล่อง',reminderDate:'2026-09-25',updatedAt:'2026-09-01T10:00:00Z'
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
  await page.locator('#repActivityProductSearch').fill('50264');
  await page.locator('#repActivityProductSearch').press('Enter');
  assert.equal(await page.locator('#repActivityProductId').inputValue(), '20');
  assert.equal(await page.locator('#repActivityUnit').inputValue(), 'กล่อง');

  await page.locator('#cancelRepresentativeActivityBottomBtn').click();
  await page.locator('#representativeHistoryTypeFilter').selectOption('contact');
  assert.equal(await page.locator('.representative-activity-card').count(), 0);
  assert.match(await page.locator('.representative-history-empty').textContent(), /ยังไม่มีประวัติ/);

  await page.evaluate(() => {
    currentTab='representativehistory';
    representativeHistoryContext=centralRepresentativeHistoryContext();
    representativeHistoryFilter=emptyRepresentativeHistoryFilter();
    representativeActivityLoadedKey=representativeHistoryKey();
    document.getElementById('main').innerHTML=renderRepresentativeHistoryOverview();
    attachEvents();
  });
  assert.equal(await page.locator('.representative-history-page h1').textContent(), 'ประวัติผู้แทน');
  assert.equal(await page.locator('#representativeHistoryRepresentativeFilter').count(), 1);
  assert.equal(await page.locator('#representativeHistoryProductFilter option').count(), 2);
  assert.equal(await page.locator('#representativeHistoryReminderFilter').count(), 1);
  assert.match(await page.locator('.representative-history-result-count').textContent(), /1 จาก 1 รายการ/);
  await page.locator('#representativeHistoryReminderFilter').selectOption('scheduled');
  assert.equal(await page.locator('.representative-activity-card').count(), 1);
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
