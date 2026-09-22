const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),assets=process.argv.includes('--built')?path.join(root,'public'):root;
const server=http.createServer((req,res)=>{
  const file=path.resolve(assets,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(assets+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  await page.route('https://*.supabase.co/**',r=>r.abort());
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',r=>r.fulfill({contentType:'text/javascript',body:
    "const query=new Proxy({}, {get(_t,p){if(p==='then')return resolve=>resolve({data:null,error:null});return ()=>query;}});window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get(t,p){return p in t?t[p]:()=>query;}})};"
  }));
  const seed=async()=>{
    await page.evaluate(async()=>{
      await ensurePageCodeLoaded('rinventory');
      document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
      renderLoginState=()=>true;
      currentProfile={id:'test-owner',owner:true,level:1,firstName:'ทดสอบ'};
      activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ A',active:true},{id:2,name:'คลังทดสอบ B',active:true}];
      categories=['ยา'];brands=['ทดสอบ'];
      products=[
        {id:101,sku:'0001',barcode:'0012345678901',name:'Alpha ยาทดสอบ',unit:'เม็ด',price:240,cost:120.5,stock:237,active:true,units:[{sub:'กล่อง',factor:100},{sub:'แผง',factor:10}]},
        {id:102,sku:'0002',barcode:'0012345678902',name:'Beta สินค้าหมด',unit:'ขวด',price:50,cost:30,stock:0,active:true,units:[]},
        {id:103,sku:'0003',barcode:'0012345678903',name:'Gamma ยอดติดลบ',unit:'กล่อง',price:100,cost:60,stock:-1.27,active:true,units:[{sub:'เม็ด',factor:.01},{sub:'แผง',factor:.1}]},
        {id:104,sku:'0004',barcode:'0012345678904',name:'Delta สแกนเพิ่ม',unit:'ขวด',price:70,cost:40,stock:3,active:true,units:[]}
      ];
      inventoryBalanceRows=products.flatMap(p=>[{product_id:p.id,warehouse_id:1,stock:p.stock},{product_id:p.id,warehouse_id:2,stock:3}]);
      rebuildInventoryBalanceMap();
      stockReportItems=products.slice(0,3).map(p=>({pid:p.id,name:p.name,unit:p.unit,wh:'1'}));
      stockReportCatFilter={wh:'1',category:'',brand:''};stockReportSort={key:'name',dir:1};
      currentTab='rinventory';render();
    });
  };
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof render==='function');await seed();
  const rowIds=()=>page.locator('#srTbody [data-sr-row]').evaluateAll(rows=>rows.map(row=>Number(row.dataset.srRow)));
  const headers=()=>page.locator('.stock-report-table thead tr').first().locator('th').evaluateAll(ths=>ths.map(th=>th.querySelector('button')?.childNodes[0]?.textContent||th.childNodes[0]?.textContent||''));
  assert.deepEqual(await headers(),['รหัสสินค้า','บาร์โค้ด','สินค้า','ขาย','ทุน','คงเหลือ','']);
  assert.deepEqual(await page.locator('.stock-report-filters > .stock-report-column-controls input').evaluateAll(inputs=>inputs.map(input=>input.id)),['srShowSku','srShowBarcode','srShowPrice','srShowCost']);
  const categoryBox=await page.locator('#srCategorySelect').boundingBox(),columnsBox=await page.locator('.stock-report-column-controls').boundingBox();
  assert.ok(Math.abs(categoryBox.y+categoryBox.height/2-columnsBox.y-columnsBox.height/2)<2,'column controls share the category row on desktop');
  assert.equal(await page.locator('[data-sr-row="101"] .stock-report-stock').innerText(),'2 กล่อง 3 แผง 7 เม็ด');
  assert.equal(await page.locator('[data-sr-row="103"] .stock-report-stock').innerText(),'-1 กล่อง -2 แผง -7 เม็ด');
  assert.match(await page.locator('[data-sr-row="101"]').innerText(),/0012345678901/);
  assert.equal(await page.locator('.stock-report-table thead input,.stock-report-table thead select').count(),0);
  assert.deepEqual(await page.locator('[data-sr-row="101"] .stock-report-price').allTextContents(),['240','120.5']);
  assert.equal(await page.locator('.stock-report-price small').count(),0);
  await page.locator('[data-srsort="stock"]').click();assert.deepEqual(await rowIds(),[103,102,101]);
  await page.locator('[data-srsort="stock"]').click();assert.deepEqual(await rowIds(),[101,102,103]);
  await page.locator('[data-srsort="name"]').click();assert.deepEqual(await rowIds(),[101,102,103]);
  await page.locator('[data-srsort="name"]').click();assert.deepEqual(await rowIds(),[103,102,101]);
  await page.locator('#srShowCost').uncheck();await page.locator('#srShowPrice').uncheck();
  await page.locator('#srShowSku').uncheck();await page.locator('#srShowBarcode').uncheck();
  assert.deepEqual(await headers(),['สินค้า','คงเหลือ','']);
  assert.equal(await page.locator('.stock-report-code').count(),0);
  assert.equal(await page.locator('.stock-report-price').count(),0);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof render==='function');await seed();
  assert.equal(await page.locator('#srShowCost').isChecked(),false);assert.equal(await page.locator('#srShowPrice').isChecked(),false);
  assert.equal(await page.locator('#srShowSku').isChecked(),false);assert.equal(await page.locator('#srShowBarcode').isChecked(),false);
  await page.locator('#srShowSku').check();await page.locator('#srShowBarcode').check();
  await page.locator('#srShowPrice').check();await page.locator('#srShowCost').check();
  await page.locator('#srInput').fill('0012345678904');await page.locator('#srInput').press('Enter');
  assert.deepEqual(await rowIds(),[101,102,104,103]);
  await page.locator('[data-sr-remove="104"]').click();assert.deepEqual(await rowIds(),[101,102,103]);
  await page.locator('#srShowCost').uncheck();
  await page.locator('#srShowSku').uncheck();await page.locator('#srShowBarcode').uncheck();
  const popupPromise=page.waitForEvent('popup');await page.locator('#printStockReportBtn').click();const popup=await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  assert.deepEqual(await popup.locator('table thead th').allTextContents(),['สินค้า','ขาย','คงเหลือ']);
  assert.equal(await popup.locator('.stock-report-code').count(),0);
  assert.equal(await popup.locator('tbody tr').count(),3);assert.match(await popup.locator('tbody').innerText(),/2 กล่อง 3 แผง 7 เม็ด/);
  assert.equal(await popup.locator('[data-sr-row="101"] .stock-report-price').innerText(),'240');
  assert.equal(await popup.locator('.stock-report-price small').count(),0);await popup.close();
  await page.locator('#srShowCost').check();
  await page.locator('#srShowSku').check();await page.locator('#srShowBarcode').check();
  if(process.env.PEPOS_SCREENSHOT_DIR){
    fs.mkdirSync(process.env.PEPOS_SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.PEPOS_SCREENSHOT_DIR,'inventory-desktop.png'),fullPage:true});
  }
  await page.locator('#srWarehouseSelect').selectOption('all');
  await page.locator('#srInput').fill('0012345678901');await page.locator('#srInput').press('Enter');
  assert.deepEqual(await page.locator('[data-sr-row="101"] .stock-report-stock').allTextContents(),['2 กล่อง 3 แผง 7 เม็ด','3 เม็ด']);
  assert.match(await page.locator('.stock-report-table thead').innerText(),/คลังที่ 1[\s\S]*คลังทดสอบ A[\s\S]*คลังที่ 2[\s\S]*คลังทดสอบ B/);
  await page.setViewportSize({width:820,height:1180});
  assert.equal(await page.locator('.stock-report-table-scroll').evaluate(el=>el.scrollWidth>el.clientWidth),true,'wide tables scroll inside the report');
  if(process.env.PEPOS_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.PEPOS_SCREENSHOT_DIR,'inventory-tablet.png'),fullPage:true});
  await page.evaluate(()=>{currentProfile={...currentProfile,owner:false,level:2};render();});
  assert.equal(await page.locator('#srShowCost').count(),0);
  assert.equal((await headers()).includes('ทุน'),false);
  assert.deepEqual(errors,[]);
  console.log('Inventory browser checks passed: compact prices, no header filters, scan/remove, sorting, remembered toggles, printing, multiple warehouses, tablet scrolling, staff costs');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});

