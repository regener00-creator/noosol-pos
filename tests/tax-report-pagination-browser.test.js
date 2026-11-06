const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const ExcelJS=require('exceljs');
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
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof render==='function');
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('rtax');
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    currentProfile={id:'test-owner',owner:true,level:1};
    currentTab='rtax';rtaxMonth='2026-11';rtaxPages={sales:1,purchases:1};
    ensureOnDemandDataForTab=()=>({status:'ready'});
    businessSettings={...businessSettings,vat:VAT_REGISTERED_LABEL,vatRegistrationDate:''};
    warehouses=[{id:1,name:'คลังทดสอบ'}];
    const taxSummary={registered:true,beforeVat:100,vat:7,total:107};
    salesHistory=Array.from({length:23},(_,i)=>({id:'SALE-'+(i+1),ref:'SALE-'+(i+1),date:'2026-11-01',status:'done',vatRegistered:true,warehouseId:1,taxSummary}));
    goodsReceipts=Array.from({length:12},(_,i)=>({id:'GR-'+(i+1),supplier:'บริษัททดสอบ',date:'2026-11-01',supplierTaxInvoiceDate:'2026-11-01',supplierTaxInvoiceNo:'TAX-'+(i+1),status:'รับแล้ว',taxSummary}));
    render=()=>{main.innerHTML=renderRTax();attachEvents();};
    render();
  });
  const sales=page.locator('[data-tax-section="sales"]');
  const purchases=page.locator('[data-tax-section="purchases"]');
  assert.equal(await sales.locator('tbody tr').count(),10);
  assert.equal(await purchases.locator('tbody tr').count(),10);
  const totals=await page.locator('.tax-report tfoot').allTextContents();
  assert.match(totals[0],/2,461\.00/,'sales total includes all 23 documents');
  assert.match(totals[1],/1,284\.00/,'purchase total includes all 12 documents');
  await page.locator('[data-rtax-sales-page="next"]').click();
  assert.match(await sales.locator('tbody tr').first().textContent(),/SALE-11/);
  assert.match(await purchases.locator('tbody tr').first().textContent(),/GR-1\b/);
  await page.locator('[data-rtax-sales-page="3"]').first().click();
  assert.equal(await sales.locator('tbody tr').count(),3);
  assert.equal(await page.locator('[data-rtax-sales-page="next"]').isDisabled(),true);
  await page.locator('[data-rtax-purchases-page="next"]').click();
  assert.equal(await purchases.locator('tbody tr').count(),2);
  assert.equal(await sales.locator('tbody tr').count(),3);
  assert.deepEqual(await page.locator('.tax-report tfoot').allTextContents(),totals,'pagination must not change monthly tax totals');
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#taxReportExcelBtn').click()]);
  assert.equal(download.suggestedFilename(),'SAPURI-รายงานภาษี-2026-11.xlsx');
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(await download.path());
  assert.equal(book.getWorksheet('ภาษีขาย').rowCount,28,'download includes 23 sales plus headings and total, not only the current 3');
  assert.equal(book.getWorksheet('ภาษีซื้อ').rowCount,17,'download includes 12 purchases plus headings and total');
  assert.match(book.getWorksheet('ภาษีขาย').getCell('B27').value,/SALE-23/);
  for(const width of [1920,390]){
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.locator('.tax-report th,.tax-report td,.tax-report-summary h2,.tax-report-summary small').evaluateAll(elements=>elements.every(el=>getComputedStyle(el).textAlign==='center')),'all headings, values and totals centered');
    const layout=await page.locator('.tax-report').evaluate(el=>{
      const main=el.parentElement,style=getComputedStyle(main);
      return {width:el.getBoundingClientRect().width,available:main.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),scroll:el.scrollWidth,client:el.clientWidth};
    });
    assert.ok(Math.abs(layout.width-layout.available)<2,'tax report fills available content width');
    assert.ok(layout.scroll<=layout.client+1,'tables remain within the report on narrow screens');
    if(width===1920) assert.ok(layout.width>1400,'report no longer capped at 1400px');
  }
  await page.locator('#rtax_month').fill('2026-12');
  await page.locator('#rtax_month').dispatchEvent('change');
  assert.deepEqual(await page.evaluate(()=>rtaxPages),{sales:1,purchases:1});
  assert.equal(await page.locator('.tax-report .pager').count(),0);
  assert.match(await sales.locator('tbody').textContent(),/ไม่มีรายการ/);
  await page.locator('#rtax_month').fill('2026-11');
  await page.locator('#rtax_month').dispatchEvent('change');
  assert.equal(await sales.locator('tbody tr').count(),10);
  await page.locator('[data-rtax-sales-page="3"]').first().click();
  await page.evaluate(()=>{salesHistory=salesHistory.slice(0,1);render();});
  assert.equal(await sales.locator('tbody tr').count(),1);
  assert.equal(await page.evaluate(()=>rtaxPages.sales),1,'clamp page if documents disappear after refresh');
  assert.deepEqual(errors,[]);
  console.log('tax report pagination browser tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
});
