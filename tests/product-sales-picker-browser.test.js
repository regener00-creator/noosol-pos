const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..',process.env.PEPOS_TEST_STATIC==='1'?'public':'');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
  if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});

let browser;
const browserExecutable = [
  process.env.PEPOS_BROWSER_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบหน้าเว็บ');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route(url=>url.pathname==='/vendor/supabase.js'||(url.hostname==='cdn.jsdelivr.net'&&url.pathname.startsWith('/npm/@supabase/')), route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const query=new Proxy({}, {get(_target,property){
        if(property==='then') return resolve=>resolve({data:null,error:null});
        return ()=>query;
      }});
      window.supabase={createClient:()=>new Proxy({
        auth:{
          getSession:async()=>({data:{session:null}}),
          onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
          signOut:async()=>({error:null})
        }
      }, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof ensurePageCodeLoaded === 'function');
  await page.evaluate(async()=>{await ensurePageCodeLoaded('rproduct');});
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    document.getElementById('appRoot').style.display='';
    currentProfile={id:'sales-picker-test',owner:true,level:1};
    warehouses=[{id:1,name:'คลังทดสอบ',active:true}];activeWarehouseId=1;
    products=Array.from({length:9},(_,i)=>({id:i+1,name:'สินค้ารายงาน '+(i+1),sku:'P'+(i+1),category:i===8?'อาหารเสริม':'ยา',brand:i===8?'อาหารเสริมเฉพาะ':(i%2?'ย่อย B':'ย่อย A'),unit:'กล่อง',price:(i+1)*10,active:true,units:[]}));
    categories=['ยา','อาหารเสริม'];brands=['ย่อย A','ย่อย B','อาหารเสริมเฉพาะ'];
    salesHistory=[{id:'SALE-TEST',date:TODAY_STR,status:'done',warehouseId:1,items:products.map(p=>({name:p.name,unit:p.unit,qty:1,price:p.price,lineTotal:p.price}))}];
    rproductFilter={period:'today',wh:'1',scope:'all',category:'',brand:'',products:[],applied:false};
    currentTab='rproduct';
    render=()=>{document.getElementById('main').innerHTML=renderRProduct();attachEvents();};render();
  });
  await page.locator('#rpf_scope').selectOption('category');
  assert.equal(await page.locator('#rpPickCategoryBtn').isDisabled(),true);
  await page.locator('#rpf_category').selectOption('ยา');
  assert.deepEqual(await page.locator('#rpf_category_brand option').allTextContents(),['หมวดสินค้าย่อย: ทั้งหมด','ทั่วไป','ย่อย A','ย่อย B'],'main category exposes only its own subcategories');
  assert.equal(await page.locator('#rpPickCategoryBtn').isEnabled(),true);
  await page.locator('#rpPickCategoryBtn').click();
  const cards=page.locator('#rproductPickList>.fav-check');
  const tops=await cards.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));
  assert.equal(tops.length,8);assert.equal(tops[0],tops[2]);assert.ok(tops[3]>tops[2]);assert.equal(tops[3],tops[5]);
  await page.locator('#rproductPickAllBtn').click();assert.equal(await page.locator('#rproductPickList input:checked').count(),8);
  await page.locator('#rproductPickNoneBtn').click();assert.equal(await page.locator('#rproductPickList input:checked').count(),0);
  await cards.nth(1).locator('input').check();await cards.nth(4).locator('input').check();
  await page.locator('#rproductPickAddBtn').click();
  assert.deepEqual(await page.evaluate(()=>rproductFilter.products),['สินค้ารายงาน 2','สินค้ารายงาน 5']);
  assert.equal(await page.locator('.stock-report-product-chip').count(),2);
  assert.equal(await page.locator('.rpt-table tbody tr').count(),0,'report waits for Apply');
  await page.locator('#rpApplyBtn').click();
  assert.equal(await page.locator('.rpt-table tbody tr').count(),2);
  assert.equal(await page.locator('.rpt-meta-total-v').textContent(),'70.00');
  const printed=await page.evaluate(()=>{
    const doc=document.implementation.createHTMLDocument('print test');window.open=()=>({document:doc});standardizePrintPreview=()=>{};
    printRProduct();return Array.from(doc.querySelectorAll('.pd-name'),el=>el.textContent);
  });
  assert.deepEqual(printed,['สินค้ารายงาน 2','สินค้ารายงาน 5'],'print uses the same chosen subset');
  await page.locator('#rpPickCategoryBtn').click();
  assert.equal(await page.locator('#rproductPickList input:disabled').count(),2,'reopening retains prior selections');
  await page.locator('#rproductPickCancelBtn').click();
  await page.locator('.stock-report-product-chip .rpt-row-x').first().click();
  assert.equal(await page.locator('.rpt-table tbody tr').count(),1);
  await page.locator('#rpClearProductsBtn').click();assert.equal(await page.locator('.rpt-table tbody tr').count(),8,'clearing restores the whole selected category');
  await page.locator('#rpPickCategoryBtn').click();await cards.first().locator('input').check();await page.locator('#rproductPickAddBtn').click();
  await page.locator('#rpf_category').selectOption('อาหารเสริม');
  assert.deepEqual(await page.evaluate(()=>rproductFilter.products),[],'changing category clears stale selected products');
  assert.deepEqual(await page.locator('#rpf_category_brand option').allTextContents(),['หมวดสินค้าย่อย: ทั้งหมด','ทั่วไป','อาหารเสริมเฉพาะ']);
  await page.locator('#rpPickCategoryBtn').click();assert.equal(await cards.count(),1);await page.locator('#rproductPickCancelBtn').click();
  await page.locator('#rpf_category').selectOption('ยา');await page.locator('#rpf_category_brand').selectOption('ย่อย B');
  await page.locator('#rpPickCategoryBtn').click();assert.equal(await cards.count(),4,'subcategory narrows products inside the selected main category');await page.locator('#rproductPickCancelBtn').click();
  await page.locator('#rpf_scope').selectOption('brand');await page.locator('#rpf_brand').selectOption('ย่อย A');
  await page.locator('#rpPickCategoryBtn').click();assert.equal(await cards.count(),4,'standalone subcategory scope still works');
  await page.locator('#rproductPickAllBtn').click();await page.locator('#rproductPickAddBtn').click();
  assert.equal(await page.evaluate(()=>rproductFilter.products.length),4);
  await page.locator('#rpf_scope').selectOption('all');assert.deepEqual(await page.evaluate(()=>rproductFilter.products),[]);
  await page.screenshot({path:path.join(os.tmpdir(),'sapuri-product-sales-picker.png')});
  await page.evaluate(()=>{
    TODAY_STR='2027-01-01';
    warehouses=[1,2].map(id=>({id,name:'ร้าน '+id,active:true}));
    salesHistory=warehouses.flatMap(({id})=>{
      const bill=(status,total,index)=>({id:status+'-'+index+'-'+total,warehouseId:id,status,total,date:TODAY_STR,
        items:[{name:products[index].name,qty:1,price:total,unit:'กล่อง'}]});
      const refund=bill('done',-20,0);
      refund.customerReturn=true;
      Object.assign(refund.items[0],{qty:-1,price:25,lineTotal:-20,reportLineTotal:-25});
      return [bill('done',100*id,0),bill('done',30,1),bill('hold',50,0),bill('void',70,0),refund];
    });
  });
  for(const store of [1,2]){
    const result=await page.evaluate(store=>{
      activeWarehouseId=store;
      const filter={wh:String(store),applied:true,period:'today',scope:'all',products:[],pay:'all'};
      Object.assign(rproductFilter,filter);
      Object.assign(rbillFilter,filter);
      rprofitFilter.period='today';
      const bills=rbillCollect();
      render();
      const total=()=>document.querySelector('.rpt-meta-total-v').textContent;
      const allProducts=total();
      Object.assign(rproductFilter,{scope:'product',products:[products[0].name]});
      render();
      const selected=total(),meta=document.querySelector('.rpt-meta-left').innerText;
      const doc=document.implementation.createHTMLDocument();
      window.open=()=>({document:doc});printRProduct();
      rproductFilter.period=rbillFilter.period='selectyear';
      render();
      const productYear=document.querySelector('#rpf_year').value;
      const billView=document.createElement('div');
      billView.innerHTML=renderRBill();
      return {allProducts,selected,meta,printed:doc.querySelector('.meta').textContent,
        bills:bills.grandVal,docCount:bills.docCount,profitDay:rprofitPeriodRange().from,productYear,billYear:billView.querySelector('#rbf_year').value};
    },store);
    assert.equal(result.allProducts,(100*store+30-25).toFixed(2));
    assert.equal(result.selected,(100*store-25).toFixed(2));
    assert.equal(result.bills,100*store+30-20);assert.equal(result.docCount,3);
    assert.match(result.meta,/2 เอกสาร/);assert.match(result.meta,/1 ม.ค. 2027/);
    assert.match(result.printed,/2 เอกสาร/);assert.ok(result.printed.includes(result.selected));
    assert.equal(result.profitDay,'2027-01-01');
    assert.equal(result.productYear,'2027');assert.equal(result.billYear,'2027');
    const downloadStarted=page.waitForEvent('download');
    await page.evaluate(()=>exportRProductExcel());
    const download=await downloadStarted;
    const lines=fs.readFileSync(await download.path(),'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length,2);
    assert.equal(lines[1],`"2027-01-01","สินค้ารายงาน 1",0,"กล่อง",${result.selected}`);
  }
  assert.deepEqual(errors,[]);
  console.log('Sales report picker: 3 columns, category/subcategory, selection, filters, clear, reopen and print passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
