const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.join(__dirname,'..');
const assetRoot=process.argv.includes('--built')?path.join(root,'public'):root;
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(assetRoot,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(assetRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime+'; charset=utf-8'});fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installIsolatedBrowser(page);
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
  await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());
    document.getElementById('appRoot').hidden=false;
    document.getElementById('main').innerHTML='';
    render=()=>{};renderLoginState=()=>true;
    currentProfile={id:'sync-chip-owner',owner:true,level:1};
    currentDeviceId=()=> 'sync-chip-device';
    syncUiLastError=null;
    window.testSyncCalls=0;
    window.testPending=[{table:'contacts',id:'fixture-only',record:{name:'งานทดสอบที่ต้องเก็บไว้'}}];
    currentWorkspacePendingChanges=()=>window.testPending;
    loadSyncEventDetails=async()=>[{id:'fixture-history',device_id:'another-device',table_name:'products',status:'open',message:'ประวัติงานจากเครื่องอื่น',occurred_at:'2026-09-17T10:00:00Z'}];
    syncCoreDataToSupabase=async()=>{window.testSyncCalls++;setSyncUiState('synced',0);};
    syncTopbarFormActions();
  });
  const chip=page.locator('#syncStatusChip');
  const dialog=page.getByRole('dialog',{name:'รายละเอียดการซิงก์',exact:true});
  for(const state of ['synced','syncing','error','offline']){
    await page.evaluate(state=>{
      Object.defineProperty(navigator,'onLine',{configurable:true,value:state!=='offline'});
      setSyncUiState(state,state==='error'?1:0);
    },state);
    assert.equal(await chip.getAttribute('data-state'),state);
    assert.equal(await chip.getAttribute('title'),'กดเพื่อดูรายละเอียดการซิงก์');
    await chip.click();
    await dialog.waitFor({state:'visible'});
    assert.match(await dialog.innerText(),/งานรอซิงก์ 1 รายการ/);
    await page.locator('.sync-detail-list details').waitFor();
    assert.match(await page.locator('.sync-detail-list').innerText(),/รายการยังเปิดจากเครื่องอื่น/);
    assert.equal(await page.evaluate(()=>window.testSyncCalls),0,'opening details must not start or retry a sync');
    assert.equal(await page.evaluate(()=>window.testPending.length),1,'opening details must not discard pending work');
    await dialog.locator('.sync-detail-close').click();
    await dialog.waitFor({state:'detached'});
  }
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
    setSyncUiState('synced',0);
  });
  await chip.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor({state:'visible'});
  await dialog.getByRole('button',{name:'ลองซิงก์ใหม่',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.sync-detail-summary')?.textContent==='ซิงก์ล่าสุดสำเร็จแล้ว');
  assert.equal(await page.evaluate(()=>window.testSyncCalls),1,'only the explicit retry button starts syncing');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await dialog.evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth),true);
  await dialog.locator('.sync-detail-close').click();
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{
    window.testPending=[];
    loadSyncEventDetails=async()=>{throw new Error('History unavailable in test');};
  });
  await chip.click();
  await dialog.locator('.sync-detail-load-error').waitFor();
  assert.match(await dialog.innerText(),/งานรอซิงก์ 0 รายการ/);
  assert.match(await dialog.innerText(),/โหลดประวัติจากเซิร์ฟเวอร์ไม่ได้/);
  assert.equal(await page.evaluate(()=>window.testSyncCalls),1);
  assert.deepEqual(errors,[]);
  console.log('sync status chip browser: all states open details, keyboard/retry/history failure/mobile passed; no implicit sync or discarded work');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
