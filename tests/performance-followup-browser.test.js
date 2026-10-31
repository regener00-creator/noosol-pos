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
  const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];
  await installIsolatedBrowser(page);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    currentProfile={id:'perf-owner',owner:true,level:1};activeWarehouseId=1;warehouses=[{id:1,name:'Test',active:true}];
    renderLoginState=()=>true;isMobileDeviceMode=()=>false;currentDateStr=()=> '2026-10-31';
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    salesRequestLoaded=()=>true;salesRequestTruncated=()=>false;
    products=[1,2].map(id=>({id,sku:String(id),name:`Product ${id}`,unit:'Pcs',price:100,cost:60,units:[],active:true}));
    salesHistory=[{id:'A',date:'2026-10-31',status:'done',warehouseId:1,total:100,costTotal:60,items:[]}];
    currentTab='dashboard';render();
  });
  await page.waitForTimeout(100);
  const unchanged=await page.evaluate(async()=>{
    const main=document.getElementById('main'),before=main.firstElementChild;let calculations=0;
    const old=RENDERERS.dashboard;RENDERERS.dashboard=()=>{calculations++;return old();};
    loadSalesHistoryFromSupabase=async options=>{options.readStatus.unchanged=true;salesRequestLoaded=()=>true;return true;};
    for(let i=0;i<3;i++){
      salesRequestLoaded=()=>false;ensureOnDemandDataForTab('dashboard',{background:true});
      await Promise.all([...onDemandTabJobs.values()]);
    }
    return {calculations,retained:before===main.firstElementChild};
  });
  assert.deepEqual(unchanged,{calculations:0,retained:true});
  await page.evaluate(async()=>{
    salesRequestLoaded=()=>false;
    loadSalesHistoryFromSupabase=async options=>{options.readStatus.unchanged=false;salesHistory[0].total=170;salesRequestLoaded=()=>true;return true;};
    ensureOnDemandDataForTab('dashboard',{background:true});await Promise.all([...onDemandTabJobs.values()]);
  });
  assert.equal(await page.locator('[data-summary-sales]').innerText(),'170.00');
  await page.evaluate(()=>{
    window.calendarReads=0;window.signature='A';window.historicalTotal=100;
    readVisibleDataSignature=async()=>window.signature;
    sb.from=()=>{
      let from='';const q=new Proxy({}, {get:(_t,key)=>key==='then'?resolve=>{
        window.calendarReads++;resolve({data:[{id:'H',sale_date:from,total:window.historicalTotal,gross_profit:30,cost_total:70,warehouseId:1}]});
      }:key==='gte'?(_key,value)=>{from=value;return q;}:()=>q});return q;
    };
  });
  for(const direction of [-1,-1,1]){
    await page.locator('[data-dashboard-month-step="'+direction+'"]').click();
    await page.waitForFunction(()=>dashboardCalendarLoad?.loaded===true&&!dashboardCalendarLoad.loading);
  }
  assert.equal(await page.evaluate(()=>window.calendarReads),2,'revisiting September uses its cached daily totals');
  assert.equal(await page.locator('[data-dashboard-date="2026-09-01"] [data-day-sales]').innerText(),'100.00');
  const retained=await page.evaluate(async()=>{
    const first=document.getElementById('main').firstElementChild;
    dashboardCalendarLoad.checkedAt=0;refreshDashboardCalendarIfStale();
    await new Promise(resolve=>setTimeout(resolve,20));return first===document.getElementById('main').firstElementChild;
  });
  assert.equal(retained,true);assert.equal(await page.evaluate(()=>window.calendarReads),2);
  await page.evaluate(()=>{window.signature='B';window.historicalTotal=200;dashboardCalendarLoad.checkedAt=0;refreshDashboardCalendarIfStale();});
  await page.waitForFunction(()=>dashboardCalendarLoad?.loaded&&!dashboardCalendarLoad.loading);
  assert.equal(await page.locator('[data-dashboard-date="2026-09-01"] [data-day-sales]').innerText(),'200.00');
  assert.equal(await page.evaluate(()=>window.calendarReads),3);
  await page.evaluate(()=>{currentProfile={id:'another-owner',owner:true,level:1};render();});
  await page.waitForFunction(()=>dashboardCalendarLoad?.loaded&&!dashboardCalendarLoad.loading);
  assert.equal(await page.evaluate(()=>window.calendarReads),4,'new actor cannot reuse another actor cache');
  assert.deepEqual(errors,[]);
  console.log('Follow-up performance: unchanged reports compute zero views, changed totals paint, historical cache reuses months and revalidates changes/account passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
