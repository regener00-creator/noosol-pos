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
    salesRepresentatives=[{id:10,name:'PEPO',phone:'0812345678',line:'pepo',note:''}];
    representativeProductAssignments=[];
    purchaseOrders=[];
    currentTab='purchaseorder';
    editingPOId='new';
    poDraft={id:'SH202609060001',supplier:'PEPO',date:'2026-09-06',credit:0,dueDate:'',items:[{name:'',qty:1,unit:'',price:''}],note:'',discount:0,taxMode:'none'};
    render=()=>{
      document.getElementById('main').innerHTML=renderPOForm();
      attachEvents();
    };
    render();
  });

  assert.equal(await page.locator('#shortageManagedProductsBtn').count(), 1);
  assert.equal(await page.locator('#shortageManagedProductsBtn + .shortage-date-field #po_date').count(), 1, 'managed-products button must be before the order date');
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
  assert.deepEqual(errors, [], `พบ JavaScript error: ${errors.join(' | ')}`);
  console.log('shortage managed products browser tests passed');
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(async()=>{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
});
