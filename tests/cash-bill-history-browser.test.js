const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:950}});
  page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('cashbill');
    renderLoginState=()=>true;renderSidebar=()=>{};
    ensureOnDemandDataForTab=()=>({status:'ready'});
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    currentProfile={id:'test',owner:true,level:1};
    warehouses=[{id:1,name:'คลังทดสอบ'}];activeWarehouseId=1;products=[];
    salesHistory=[{id:'sale-test',ref:'RE-TEST-001',date:currentDateStr(),status:'done',total:100,items:[],warehouseId:1}];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedBill=value;}}});
    currentTab='cashbill';cashBillLookupOpen=false;render();
  });
  await page.locator('#newCashBillBtn').click();
  await page.locator('#cash_bill_order_number').fill('keep-draft');
  await page.locator('#searchCashBillOrderBtn').click();
  assert.equal(await page.locator('.pos-sales-history-modal').count(),1);
  assert.equal(await page.evaluate(()=>currentTab),'cashbill');
  await page.locator('#closePOSSalesHistoryBtn').click();
  assert.equal(await page.locator('#cash_bill_order_number').inputValue(),'keep-draft');
  await page.locator('#searchCashBillOrderBtn').click();
  await page.locator('[data-copy-bill="RE-TEST-001"]').click();
  assert.equal(await page.evaluate(()=>window.copiedBill),'RE-TEST-001');
  await page.locator('#closePOSSalesHistoryBottomBtn').click();
  assert.equal(await page.locator('#cash_bill_order_number').inputValue(),'RE-TEST-001');
  await page.evaluate(()=>{
    findSaleByIdentifier=async query=>salesHistory.find(s=>s.ref===query);
    openA4CashReceiptModal=id=>{window.openedCashBill=id;};
  });
  await page.locator('#continueCashBillOrderBtn').click();
  assert.equal(await page.evaluate(()=>window.openedCashBill),'sale-test');
  assert.deepEqual(errors,[]);
  console.log('Cash bill history passed: popup, copy, draft retention, close and continue');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
