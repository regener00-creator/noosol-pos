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
    currentProfile={id:'refresh-owner',owner:true,level:1};activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ',active:true}];
    renderLoginState=()=>true;isMobileDeviceMode=()=>false;currentDateStr=()=> '2026-10-31';
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    salesHistory=[{id:'A',ref:'A',date:'2026-10-31',time:'12:00',status:'done',warehouseId:1,total:100,costTotal:80,grossProfit:20,items:[]}];
    products=[];window.refreshFresh=true;window.refreshToasts=[];
    salesRequestLoaded=()=>window.refreshFresh;salesRequestTruncated=()=>false;showToast=message=>window.refreshToasts.push(message);
    loadSalesHistoryFromSupabase=()=>new Promise((resolve,reject)=>{
      window.finishRefresh=(total=100,fail=false)=>{
        if(fail){reject(new Error('connection lost'));return;}
        salesHistory=[{...salesHistory[0],total}];window.refreshFresh=true;resolve(true);
      };
    });
    const nativeTimeout=window.setTimeout;
    window.setTimeout=(fn,ms,...args)=>ms===SALES_CACHE_TTL_MS?(window.refreshTick=fn,-1):nativeTimeout(fn,ms,...args);
    currentTab='dashboard';render();
    window.refreshOriginal=document.querySelector('.dashboard-calendar');
    window.refreshMain=document.getElementById('main');window.refreshLoadingSeen=false;
    new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.textContent?.includes('กำลังโหลดข้อมูลจากระบบ'))window.refreshLoadingSeen=true;}).observe(window.refreshMain,{childList:true});
  });
  const total=page.locator('[data-summary-sales]');
  const tick=()=>page.evaluate(()=>{window.refreshFresh=false;window.refreshTick();});
  const finish=(amount,fail=false)=>page.evaluate(async({amount,fail})=>{window.finishRefresh(amount,fail);await Promise.resolve();await Promise.resolve();},{amount,fail});
  await page.evaluate(()=>document.activeElement?.blur());
  await tick();
  assert.equal(await page.evaluate(()=>typeof window.finishRefresh),'function',JSON.stringify(await page.evaluate(()=>({tab:currentTab,idle:salesViewIdle(),active:document.activeElement?.outerHTML,modal:document.querySelector('.modal-overlay')?.outerHTML,offline:offlinePosMode(),editing:editingDocumentForm(),jobs:onDemandTabJobs.size}))));
  assert.equal(await page.evaluate(()=>window.refreshOriginal.isConnected),true,'expired cache must not clear the screen');
  await finish(100);
  assert.equal(await page.evaluate(()=>window.refreshOriginal===document.querySelector('.dashboard-calendar')),true,'same visible data preserves DOM identity');
  await page.evaluate(()=>{document.querySelector('.dashboard-calendar-scroll').scrollLeft=120;});
  await tick();await finish(350);await page.waitForFunction(()=>document.querySelector('[data-summary-sales]')?.textContent==='350.00');
  assert.equal(await page.locator('.dashboard-calendar-scroll').evaluate(el=>el.scrollLeft),120,'changed data keeps calendar scroll');
  assert.equal(await page.evaluate(()=>window.refreshLoadingSeen),false);
  // Typing or opening a dialog while the request is in flight must defer completion rendering.
  await tick();
  await page.evaluate(()=>{const input=document.createElement('input');input.id='refreshTyping';input.value='ข้อความที่กำลังพิมพ์';document.body.append(input);input.focus();});
  await finish(400);assert.equal(await total.innerText(),'350.00');
  assert.equal(await page.locator('#refreshTyping').inputValue(),'ข้อความที่กำลังพิมพ์');
  await page.evaluate(()=>{document.getElementById('refreshTyping').remove();applyPendingSalesViewRefresh();});
  assert.equal(await total.innerText(),'400.00');
  await tick();
  await page.evaluate(()=>{const input=document.createElement('input');input.id='longTyping';document.body.append(input);input.focus();});
  await finish(420);assert.equal(await total.innerText(),'400.00');
  await page.evaluate(()=>{document.getElementById('longTyping').remove();window.refreshFresh=false;window.refreshTick();});
  assert.equal(await total.innerText(),'400.00','a deferred result that aged out cannot trigger a loading flash');
  await finish(425);assert.equal(await total.innerText(),'425.00');
  await tick();await page.evaluate(()=>{const modal=document.createElement('div');modal.className='modal-overlay';modal.id='refreshModal';document.body.append(modal);});
  await finish(450);assert.equal(await total.innerText(),'425.00');
  await page.evaluate(()=>{document.getElementById('refreshModal').remove();applyPendingSalesViewRefresh();});assert.equal(await total.innerText(),'450.00');
  // Failure keeps the last visible result and is retried next tick, rather than flashing an error page.
  await tick();await finish(0,true);assert.equal(await total.innerText(),'450.00');
  assert.equal(await page.evaluate(()=>window.refreshToasts.length),1);
  await tick();await finish(0,true);assert.equal(await page.evaluate(()=>window.refreshToasts.length),1,'do not repeat the same warning every minute');
  await tick();await finish(500);assert.equal(await total.innerText(),'500.00');
  // Late results cannot repaint a different page or warehouse.
  await tick();await page.evaluate(()=>{currentTab='notes';window.refreshMain.innerHTML='<p id="otherView">Another page</p>';});
  await finish(600);assert.equal(await page.locator('#otherView').count(),1);
  await page.evaluate(()=>{currentTab='dashboard';render();});
  await tick();await page.evaluate(()=>{activeWarehouseId=2;window.refreshMain.innerHTML='<p id="otherWarehouse">Another warehouse</p>';});
  await finish(650);assert.equal(await page.locator('#otherWarehouse').count(),1);
  await page.evaluate(()=>{activeWarehouseId=1;render();});
  await tick();await page.evaluate(()=>{activeWarehouseId=2;render();});
  assert.match(await page.locator('#main').innerText(),/กำลังโหลดข้อมูลจากระบบ/);
  await finish(675);await page.waitForFunction(()=>document.querySelector('[data-summary-sales]')?.textContent==='0.00');
  // First-load and explicit navigation keep their loading state; only the timer refresh is silent.
  await page.evaluate(()=>{activeWarehouseId=1;window.refreshFresh=false;render();});
  assert.match(await page.locator('#main').innerText(),/กำลังโหลดข้อมูลจากระบบ/);
  await finish(700);await page.waitForFunction(()=>document.querySelector('[data-summary-sales]')?.textContent==='700.00');
  // Document list refresh follows the same non-blocking path.
  await page.evaluate(()=>{
    currentTab='purchaseorder';window.docFresh=true;window.docLabel='เอกสารเดิม';
    showPageCodeLoading=()=>false;RENDERERS.purchaseorder=()=>`<p id="documentRefreshResult">${window.docLabel}</p>`;
    documentRequestLoaded=()=>window.docFresh;documentRequestTruncated=()=>false;
    loadDocumentTableFromSupabase=()=>new Promise(resolve=>{window.finishDocumentRefresh=label=>{window.docLabel=label;window.docFresh=true;resolve(true);};});render();
    window.documentOriginal=document.getElementById('documentRefreshResult');window.docFresh=false;window.refreshTick();
  });
  assert.equal(await page.evaluate(()=>window.documentOriginal.isConnected),true);
  await page.evaluate(async()=>{window.finishDocumentRefresh('เอกสารเดิม');await Promise.resolve();await Promise.resolve();});
  assert.equal(await page.evaluate(()=>window.documentOriginal===document.getElementById('documentRefreshResult')),true);
  await page.evaluate(async()=>{window.docFresh=false;window.refreshTick();window.finishDocumentRefresh('เอกสารล่าสุด');await Promise.resolve();await Promise.resolve();});
  assert.equal(await page.locator('#documentRefreshResult').innerText(),'เอกสารล่าสุด');
  assert.deepEqual(errors,[]);
  console.log('Background refresh: no loading flash, unchanged DOM, changed totals, preserved scroll, in-flight editing/dialogs, retry, late responses and document lists passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
