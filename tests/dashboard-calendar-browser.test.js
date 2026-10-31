const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,'../public');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.PEPOS_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
  await installIsolatedBrowser(page);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    currentProfile={id:'calendar-owner',owner:true,level:1,firstName:'ทดสอบ'};activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ',active:true}];
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});isMobileDeviceMode=()=>false;currentDateStr=()=> '2026-10-31';
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    products=[{id:1,name:'สินค้าทดสอบ',unit:'Pcs',price:100,cost:80,wh:1}];
    const sale=(id,date,total,grossProfit,extra={})=>({id,ref:id,date,time:'12:00',status:'done',total,grossProfit,costTotal:total-grossProfit,warehouseId:1,payMethod:'เงินสด',items:[{productId:1,name:'สินค้าทดสอบ',qty:1,price:total}],...extra});
    window.calendarFixture=[sale('a','2026-10-01',100,20),sale('b','2026-10-31',200,40),sale('c','2026-10-31',50,-10),sale('void','2026-10-31',999,500,{status:'void'}),sale('hold','2026-10-31',888,300,{status:'hold'}),sale('return','2026-10-31',-20,-5,{customerReturn:true}),sale('other','2026-10-31',777,400,{warehouseId:2}),sale('old','2026-09-30',90,10)];
    salesHistory=window.calendarFixture;currentTab='dashboard';render();
  });
  assert.equal(await page.locator('.dashboard-summary-card').count(),2);
  const today=page.locator('[data-dashboard-period="today"]'),month=page.locator('[data-dashboard-period="month"]');
  assert.match(await today.innerText(),/ยอดขายวันนี้/);assert.match(await today.innerText(),/กำไรวันนี้/);
  assert.equal(await today.locator('[data-summary-sales]').innerText(),'230.00');assert.equal(await today.locator('[data-summary-profit]').innerText(),'25.00');
  assert.equal(await month.locator('[data-summary-sales]').innerText(),'330.00');assert.equal(await month.locator('[data-summary-profit]').innerText(),'45.00');
  assert.equal(await page.getByText('ยอดขาย 7 วันล่าสุด',{exact:true}).count(),0);assert.equal(await page.getByText('สินค้าขายดี เดือนนี้',{exact:true}).count(),0);
  assert.equal(await page.locator('[data-dashboard-date]').count(),31);assert.equal(await page.locator('.dashboard-weekday').count(),7);
  const day=page.locator('[data-dashboard-date="2026-10-31"]');
  assert.equal(await day.locator('[data-day-sales]').innerText(),'230.00');assert.equal(await day.locator('[data-day-profit]').innerText(),'25.00');assert.equal(await day.locator('[data-day-orders]').innerText(),'2');
  assert.equal(await day.locator('[aria-current="date"]').count(),1);
  assert.equal(await page.locator('[data-dashboard-date="2026-10-02"] [data-day-sales]').innerText(),'0.00');
  assert.equal(await page.locator('[data-dashboard-date="2026-10-01"]').evaluate(el=>[...el.parentElement.children].indexOf(el)),11,'October starts on Thursday');
  await page.evaluate(()=>{allWarehousesMode=true;render();});
  assert.equal(await today.locator('[data-summary-sales]').innerText(),'1,007.00');assert.equal(await day.locator('[data-day-orders]').innerText(),'3');
  await page.evaluate(()=>{allWarehousesMode=false;currentProfile={id:'calendar-staff',level:2,owner:false};render();});
  assert.equal(await page.locator('[data-summary-profit],[data-day-profit]').count(),0,'profit stays hidden from level 2');
  await page.evaluate(()=>{currentProfile={id:'calendar-owner',owner:true,level:1};salesHistory=[{...window.calendarFixture[1],grossProfit:undefined,costTotal:undefined}];render();});
  assert.equal(await day.locator('[data-day-profit]').innerText(),'—','missing cost is not presented as zero profit');
  await page.evaluate(()=>{salesHistory=[{...window.calendarFixture[2]}];render();});
  assert.equal(await day.locator('.dashboard-loss').innerText(),'-10.00');
  await page.evaluate(()=>{salesHistory=[];currentDateStr=()=> '2024-02-29';render();});
  assert.equal(await page.locator('[data-dashboard-date]').count(),29);assert.equal(await page.locator('[data-dashboard-date="2024-02-29"] [data-day-orders]').innerText(),'0');
  await page.evaluate(()=>{currentDateStr=()=> '2025-02-28';render();});assert.equal(await page.locator('[data-dashboard-date]').count(),28);
  await page.evaluate(()=>{currentDateStr=()=> '2026-10-31';salesHistory=window.calendarFixture;render();});
  for(const width of [1600,1000,600]){
    await page.setViewportSize({width,height:1100});
    assert.equal(await page.locator('.dashboard-calendar').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`calendar stays contained at ${width}`);
  }
  await page.setViewportSize({width:1600,height:1100});
  fs.mkdirSync(path.resolve(__dirname,'../outputs'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../outputs/dashboard-calendar.png')});
  assert.deepEqual(errors,[]);console.log('Dashboard calendar: grouped cards, daily totals/profit/count, voids/holds/returns, warehouse scope, permissions, missing cost, leap years and responsive layout passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
