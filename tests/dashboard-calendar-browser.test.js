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
  assert.equal(await page.locator('.dashboard-summary-card').count(),1);
  const month=page.locator('[data-dashboard-period="month"]');
  assert.equal(await page.locator('[data-dashboard-period="today"]').count(),0);
  assert.equal(await page.getByText('ยอดขายวันนี้',{exact:true}).count(),0);
  assert.equal(await page.getByText('กำไรวันนี้',{exact:true}).count(),0);
  assert.match(await month.innerText(),/ยอดขายเดือนนี้/);assert.match(await month.innerText(),/กำไรเดือนนี้/);
  assert.equal(await month.locator('[data-summary-sales]').innerText(),'330.00');assert.equal(await month.locator('[data-summary-profit]').innerText(),'45.00');
  assert.equal(await page.getByText('ยอดขาย 7 วันล่าสุด',{exact:true}).count(),0);assert.equal(await page.getByText('สินค้าขายดี เดือนนี้',{exact:true}).count(),0);
  assert.equal(await page.locator('[data-dashboard-date]').count(),31);assert.equal(await page.locator('.dashboard-weekday').count(),7);
  const day=page.locator('[data-dashboard-date="2026-10-31"]');
  assert.equal(await day.locator('[data-day-sales]').innerText(),'230.00');assert.equal(await day.locator('[data-day-profit]').innerText(),'25.00');assert.equal(await day.locator('[data-day-orders]').innerText(),'2');
  assert.equal(await day.locator('[aria-current="date"]').count(),1);
  assert.match(await day.locator('.dashboard-bill-label').innerText(),/^\| บิล: 2$/);
  assert.equal(await day.locator('.dashboard-day-separator').count(),1,'only the separator between sales and profit remains');
  assert.equal(await page.locator('[data-dashboard-date="2026-10-02"] [data-day-sales]').innerText(),'0.00');
  assert.equal(await page.locator('[data-dashboard-date="2026-10-01"]').evaluate(el=>[...el.parentElement.children].indexOf(el)),11,'October starts on Thursday');
  await page.evaluate(()=>{allWarehousesMode=true;render();});
  assert.equal(await month.locator('[data-summary-sales]').innerText(),'1,107.00');assert.equal(await day.locator('[data-day-orders]').innerText(),'3');
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
  // Best sellers rank net base quantities, combine units, and exclude other periods/voids/holds/custom lines.
  await page.evaluate(()=>{
    window.originalCalendarProducts=products;
    products=Array.from({length:11},(_,i)=>({id:i+1,name:i===0?'<img src=x onerror=alert(1)>':`สินค้า ${i+1}`,unit:'Pcs',wh:1}));
    salesHistory=products.map((product,i)=>({...window.calendarFixture[0],id:`rank-${i}`,items:[{productId:product.id,name:product.name,qty:11-i,unit:'Pcs',factor:1}]}));
    salesHistory.push({...window.calendarFixture[0],items:[{productId:2,qty:2,factor:10,baseQty:20,unit:'กล่อง'}]});
    salesHistory.push({...window.calendarFixture[0],customerReturn:true,items:[{productId:2,qty:1,factor:10,baseQty:-10,unit:'กล่อง'}]});
    for(const extra of [{status:'void'},{status:'hold'},{date:'2026-09-30'},{warehouseId:2}])salesHistory.push({...window.calendarFixture[0],...extra,items:[{productId:11,qty:999,factor:1}]});
    salesHistory.push({...window.calendarFixture[0],items:[{custom:true,name:'กรอกเอง',qty:999}]});render();
  });
  assert.equal(await page.locator('.dashboard-best-seller').count(),5);
  assert.deepEqual(await page.locator('.dashboard-best-rank').allTextContents(),['🏆','🥈','🥉']);
  assert.equal(await page.getByText('เดือนนี้ · จำนวนขายสุทธิ',{exact:true}).count(),0);
  assert.match(await page.locator('.dashboard-best-seller').first().innerText(),/สินค้า 2\s*20 Pcs/);
  assert.equal(await page.locator('.dashboard-best-seller img').count(),0);
  assert.equal(await page.locator('.dashboard-best-seller b').nth(1).innerText(),'<img src=x onerror=alert(1)>');
  const boxes=await page.locator('.dashboard-best-seller').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y};}));
  assert.equal(new Set(boxes.map(box=>box.y)).size,1);assert.equal(new Set(boxes.map(box=>box.x)).size,5);
  assert.ok((await month.boundingBox()).x<(await page.locator('.dashboard-top-products').boundingBox()).x,'month summary is on the left');
  fs.mkdirSync(path.resolve(__dirname,'../outputs'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../outputs/dashboard-best-sellers.png')});
  await page.evaluate(()=>{products[1].unit='เม็ด';products[1].units=[{sub:'Pcs',factor:10},{sub:'กล่อง',factor:100}];render();});
  assert.match(await page.locator('.dashboard-best-seller').first().innerText(),/สินค้า 2\s*2 กล่อง/,'historical units are converted when the base unit changes');
  await page.evaluate(()=>{
    products=[{id:2,name:'สินค้าหลายหน่วย',unit:'ซอง',units:[{sub:'กล่อง',factor:125},{sub:'ลัง',factor:1000}],wh:1}];
    salesHistory=[{...window.calendarFixture[0],items:[{productId:2,qty:1265,unit:'ซอง',factor:1}]}];render();
  });
  assert.equal(await page.locator('.dashboard-best-quantity').innerText(),'1 ลัง 2 กล่อง 15 ซอง');
  assert.equal(await page.locator('.dashboard-best-quantity').evaluate(el=>getComputedStyle(el).fontWeight),'700');
  assert.ok(await page.locator('.dashboard-best-rank').evaluate(el=>el.getBoundingClientRect().left-el.parentElement.getBoundingClientRect().left<15),'rank sits at the left edge');
  await page.evaluate(()=>{products=window.originalCalendarProducts;salesHistory=window.calendarFixture;render();});
  // Historical data must come from the server, without replacing the current cards/history.
  await page.evaluate(()=>{
    window.calendarQueries=[];window.calendarFail=false;window.calendarDeferred=null;
    window.calendarRows=Array.from({length:1001},(_,i)=>({id:String(i).padStart(5,'0'),sale_date:'2026-09-21',status:'done',warehouseId:'1',total:2,gross_profit:1,cost_total:1}));
    window.calendarRows.push({id:'zz',sale_date:'2026-09-21',status:'done',warehouseId:'2',total:999,gross_profit:99,cost_total:900});
    sb.from=table=>{
      if(table!=='sales')throw new Error('Unexpected query '+table);
      const filters={},q={select(){return q;},eq(k,v){filters[k]=v;return q;},gte(k,v){filters.from=v;return q;},lte(k,v){filters.to=v;return q;},order(){return q;},limit(v){filters.limit=v;return q;},gt(k,v){filters.cursor=v;return q;},then(resolve){
        window.calendarQueries.push({...filters});
        const result=()=>window.calendarFail?{error:{message:'ทดสอบโหลดไม่สำเร็จ'}}:{data:window.calendarRows.filter(row=>row.status===filters.status&&row.sale_date>=filters.from&&row.sale_date<=filters.to&&(!filters.cursor||row.id>filters.cursor)).slice(0,filters.limit),error:null};
        if(window.calendarHold)window.calendarDeferred=()=>resolve(result());else resolve(result());
      }};return q;
    };
  });
  const previous=page.getByRole('button',{name:'เดือนก่อนหน้า'}),next=page.getByRole('button',{name:'เดือนถัดไป'});
  assert.equal(await next.isDisabled(),true,'future months cannot be selected');
  await previous.click();await page.waitForSelector('[data-dashboard-date="2026-09-21"]');
  assert.equal(await page.locator('[data-dashboard-date="2026-09-21"] [data-day-sales]').innerText(),'2,002.00');
  assert.equal(await page.locator('[data-dashboard-date="2026-09-21"] [data-day-orders]').innerText(),'1,001');
  assert.equal(await month.locator('[data-summary-sales]').innerText(),'330.00');
  assert.deepEqual(await page.evaluate(()=>window.calendarQueries.map(q=>q.cursor||null)),[null,'00499','00999']);
  assert.equal(await page.evaluate(()=>salesHistory.length),8,'historical rows stay out of the shared current-month history');
  await page.evaluate(()=>{allWarehousesMode=true;render();});await page.waitForSelector('[data-dashboard-date="2026-09-21"]');
  assert.equal(await page.locator('[data-dashboard-date="2026-09-21"] [data-day-sales]').innerText(),'3,001.00');
  await page.evaluate(()=>{allWarehousesMode=false;currentProfile={id:'calendar-staff',level:2};render();});await page.waitForSelector('[data-dashboard-date="2026-09-21"]');
  assert.equal(await page.locator('[data-day-profit]').count(),0);
  await page.evaluate(()=>{currentProfile={id:'calendar-owner',owner:true,level:1};render();});await page.waitForSelector('[data-dashboard-date="2026-09-21"]');
  await next.click();assert.equal(await day.locator('[data-day-sales]').innerText(),'230.00');
  // A late response from an abandoned month cannot replace the newly selected month.
  await page.evaluate(()=>{dashboardCalendarCache.clear();window.calendarHold=true;});await previous.click();await page.waitForFunction(()=>!!window.calendarDeferred);
  await next.click();await page.evaluate(()=>{window.calendarHold=false;window.calendarDeferred();window.calendarDeferred=null;});
  assert.equal(await day.locator('[data-day-sales]').innerText(),'230.00');
  await page.evaluate(()=>{window.calendarFail=true;});await previous.click();await page.waitForSelector('#retryDashboardCalendar');
  assert.equal(await page.locator('[data-dashboard-date]').count(),0,'an error is not displayed as zero sales');
  await page.evaluate(()=>{window.calendarFail=false;});await page.locator('#retryDashboardCalendar').click();await page.waitForSelector('[data-dashboard-date="2026-09-21"]');
  assert.equal(await page.locator('[data-dashboard-date="2026-09-21"] [data-day-sales]').innerText(),'2,002.00');
  await page.evaluate(()=>{dashboardCalendarMonth='2026-01';dashboardCalendarLoad=null;render();});
  await previous.click();await page.waitForSelector('[data-dashboard-date="2025-12-31"]');
  await next.click();await page.waitForSelector('[data-dashboard-date="2026-01-31"]');
  // Exactly twelve selectable months, including the current month.
  await previous.click();await previous.click();await page.waitForSelector('[data-dashboard-date="2025-11-01"]');
  assert.equal(await previous.isDisabled(),true,'November 2025 is the oldest month in October 2026');
  const requestsAtBoundary=await page.evaluate(()=>window.calendarQueries.length);
  await previous.evaluate(button=>button.onclick());
  assert.equal(await page.evaluate(()=>window.calendarQueries.length),requestsAtBoundary,'boundary guard prevents an older query');
  await page.getByRole('button',{name:'ปัจจุบัน',exact:true}).click();
  await page.waitForFunction(()=>{const today=document.querySelector('.dashboard-calendar-day.is-today')?.getBoundingClientRect(),box=document.querySelector('.dashboard-calendar-scroll')?.getBoundingClientRect();return today&&box&&today.left>=box.left&&today.right<=box.right;});
  assert.equal(await next.isDisabled(),true);
  assert.equal(await day.locator('[aria-current="date"]').innerText(),'31');
  assert.match(await day.innerText(),/บิล:\s*2/);assert.match(await day.innerText(),/ขาย/);assert.equal(await day.locator('[data-day-sales]').innerText(),'230.00');
  // Restore or date-rollover state is clamped too, not just button clicks.
  await page.evaluate(()=>{dashboardCalendarMonth='2027-01';render();});
  assert.equal(await day.count(),1);
  await page.evaluate(()=>{dashboardCalendarMonth='2025-01';render();});await page.waitForSelector('[data-dashboard-date="2025-11-01"]');
  assert.equal(await previous.isDisabled(),true);
  await page.evaluate(()=>{currentDateStr=()=> '2026-11-01';render();});await page.waitForSelector('[data-dashboard-date="2025-12-01"]');
  assert.equal(await previous.isDisabled(),true,'oldest allowed month moves forward with the date');
  await page.evaluate(()=>{currentDateStr=()=> '2026-10-31';dashboardCalendarMonth='';dashboardCalendarLoad=null;render();});
  for(const width of [1600,1000,600]){
    await page.setViewportSize({width,height:1100});
    assert.equal(await page.locator('.dashboard-calendar').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`calendar stays contained at ${width}`);
    assert.equal(await day.evaluate(el=>{const a=el.querySelector('time').getBoundingClientRect(),b=el.querySelector('.dashboard-day-summary').getBoundingClientRect();return Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)<2;}),true,'day number and summary share one row');
    assert.equal(await day.locator('.dashboard-day-summary').evaluate(el=>getComputedStyle(el).textAlign),'center','daily summary is centered');
    const bill=await day.locator('.dashboard-bill-label').boundingBox(),zeroBill=await page.locator('[data-dashboard-date="2026-10-24"] .dashboard-bill-label').boundingBox();
    assert.ok(Math.abs(bill.x-zeroBill.x)<1,'bill labels align for zero and nonzero days');

  }
  await page.setViewportSize({width:1600,height:1100});
  fs.mkdirSync(path.resolve(__dirname,'../outputs'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../outputs/dashboard-calendar.png')});
  assert.deepEqual(errors,[]);console.log('Dashboard calendar: totals, permissions, 12-month bounds, Today navigation, paging, stale requests, retry, year boundary, leap years and one-row responsive layout passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
