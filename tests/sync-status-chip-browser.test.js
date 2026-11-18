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
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installIsolatedBrowser(page);
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
  await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());
    document.getElementById('appRoot').hidden=false;
    document.getElementById('main').innerHTML='';
    render=()=>{};renderLoginState=()=>true;
    activeWarehouseId=1;allWarehousesMode=false;
    currentProfile={id:'sync-chip-owner',owner:true,level:1};
    currentDeviceId=()=> 'sync-chip-device';
    syncUiLastError=null;
    window.testSyncCalls=0;
    window.testPending=[{table:'contacts',id:'fixture-only',record:{name:'งานทดสอบที่ต้องเก็บไว้'}}];
    currentWorkspacePendingChanges=()=>window.testPending;
    loadSyncEventDetails=async()=>[{id:'fixture-history',device_id:'another-device',table_name:'products',status:'open',message:'ประวัติงานจากเครื่องอื่น',occurred_at:'2026-09-17T10:00:00Z'}];
    window.realProductCoreSync=syncCoreDataToSupabase;
    syncCoreDataToSupabase=async()=>{window.testSyncCalls++;if(window.clearProductFixtureOnSync)productDirtyOperations.clear();setSyncUiState('synced',0);};
    syncTopbarFormActions();
  });
  const chip=page.locator('#syncStatusChip');
  const dialog=page.getByRole('dialog',{name:'รายละเอียดการซิงก์',exact:true});
  for(const store of [1,2]){
    await page.evaluate(store=>{
      activeWarehouseId=store;allWarehousesMode=false;
      window.testPending=[];
      products=Array.from({length:7},(_,index)=>({id:901+index,wh:store,sku:'P00'+index,name:'สินค้ารอส่ง '+index,unit:'กล่อง'}));
      products.push({id:999,wh:store===1?2:1,name:'สินค้าของอีกร้าน'});
      completeProductCatalog=()=>products;
      productDirtyOperations=new Map(products.slice(0,7).map((product,index)=>[String(product.id),index===0?'insert':'update']));
      productDirtyOperations.set('950','delete');
      syncedTableRows.products=new Map([['950',JSON.stringify({id:950,warehouse_id:store,name:'สินค้ารอลบ',sku:'DELETE-950',unit:'ซอง'})]]);
      setSyncUiState('synced',0);
    },store);
    assert.equal(await chip.getAttribute('data-state'),'pending');
    assert.equal(await chip.textContent(),'สินค้ารอซิงก์ 8 รายการ');
    const before=await page.evaluate(()=>JSON.stringify({products,dirty:[...productDirtyOperations]}));
    await chip.click();
    await dialog.waitFor({state:'visible'});
    assert.equal(await dialog.locator('[data-pending-product-id]').count(),8,'All eight pending products are listed, including a pending deletion');
    assert.match(await dialog.locator('.sync-recovery-panel').innerText(),/งานรอซิงก์ 8 รายการ/);
    assert.match(await dialog.innerText(),/สินค้ารอส่ง 0/);
    assert.match(await dialog.innerText(),/P000 · กล่อง · รอเพิ่มสินค้า/);
    assert.match(await dialog.innerText(),/สินค้ารอลบ/);
    assert.doesNotMatch(await dialog.innerText(),/สินค้าของอีกร้าน|ไม่มีงานค้าง/);
    assert.equal(await page.evaluate(()=>JSON.stringify({products,dirty:[...productDirtyOperations]})),before,'Opening details does not discard pending product changes');
    assert.equal(await page.evaluate(()=>window.testSyncCalls),0);
    await page.evaluate(()=>{
      window.productCompareOriginalFrom=sb.from;
      sb.from=table=>{
        if(table!=='products')throw new Error('Unexpected comparison table');
        let id;
        const q={select:()=>q,eq:(key,value)=>{if(key==='id')id=value;return q;},maybeSingle:async()=>{
          const local=products.find(product=>String(product.id)===String(id));
          return {data:local?{...productToRow(local),price:250,revision:1}:null,error:null};
        }};return q;
      };
    });
    await dialog.locator('[data-compare-product="0"]').click();
    const comparison=page.getByRole('dialog',{name:'ตรวจเทียบงานค้าง',exact:true});
    await comparison.waitFor();
    assert.match(await comparison.innerText(),/ราคาขาย/);
    assert.match(await comparison.innerText(),/250/);
    assert.equal(await comparison.getByRole('button').count(),1,'Comparison only offers close, never overwrite');
    assert.equal(await page.evaluate(()=>JSON.stringify({products,dirty:[...productDirtyOperations]})),before,'Comparison does not modify drafts');
    await comparison.getByRole('button',{name:'ปิด',exact:true}).click();
    await page.evaluate(()=>{sb.from=window.productCompareOriginalFrom;});
    await dialog.getByRole('button',{name:'ลองซิงก์ใหม่',exact:true}).click();
    assert.equal(await dialog.locator('.sync-detail-summary').textContent(),'ยังมีสินค้ารอซิงก์ 8 รายการ','A retry that leaves pending products must not report success');
    assert.equal(await dialog.locator('[data-pending-product-id]').count(),8);
    await dialog.locator('.sync-detail-close').click();
    await page.evaluate(()=>{activeWarehouseId=activeWarehouseId===1?2:1;renderSyncStatusChip();});
    assert.equal(await chip.textContent(),'ซิงก์แล้ว','Other shop pending edits do not change this shop status');
    await chip.click();
    assert.equal(await dialog.locator('[data-pending-product-id]').count(),0,'Other shop details do not expose pending products');
    await dialog.locator('.sync-detail-close').click();
    await page.evaluate(()=>{activeWarehouseId=activeWarehouseId===1?2:1;window.clearProductFixtureOnSync=true;renderSyncStatusChip();});
    await chip.click();
    await dialog.getByRole('button',{name:'ลองซิงก์ใหม่',exact:true}).click();
    assert.equal(await dialog.locator('[data-pending-product-id]').count(),0,'Successfully synced products disappear after refresh');
    assert.match(await dialog.locator('.sync-recovery-panel').innerText(),/งานรอซิงก์ 0 รายการ/);
    assert.equal(await chip.getAttribute('data-state'),'synced');
    await dialog.locator('.sync-detail-close').click();
    await page.evaluate(()=>{window.testSyncCalls=0;window.clearProductFixtureOnSync=false;});
  }
  await page.evaluate(()=>{activeWarehouseId=1;window.testPending=[{table:'contacts',id:'fixture-only',record:{name:'งานทดสอบที่ต้องเก็บไว้'}}];});
  for(const state of ['synced','syncing','error','offline']){
    await page.evaluate(state=>{
      Object.defineProperty(navigator,'onLine',{configurable:true,value:state!=='offline'});
      setSyncUiState(state,state==='error'?1:0);
    },state);
    assert.equal(await chip.getAttribute('data-state'),state);
    assert.equal(await chip.getAttribute('title'),'กดเพื่อดูรายละเอียดการซิงก์');
    await chip.click();
    await dialog.waitFor({state:'visible'});
    const desktopBounds=await dialog.boundingBox();
    assert.ok(desktopBounds.width>=1000&&desktopBounds.height>=800,'sync modal must override the smaller generic modal dimensions');
    await page.mouse.click(2,2);
    await page.mouse.click(1438,998);
    assert.equal(await dialog.isVisible(),true,'clicking the backdrop must not close sync details');
    assert.match(await dialog.innerText(),/งานรอซิงก์ 1 รายการ/);
    await page.locator('.sync-detail-list details').waitFor();
    assert.match(await page.locator('.sync-detail-list').innerText(),/รายการยังเปิดจากเครื่องอื่น/);
    assert.equal(await page.evaluate(()=>window.testSyncCalls),0,'opening details must not start or retry a sync');
    assert.equal(await page.evaluate(()=>window.testPending.length),1,'opening details must not discard pending work');
    await dialog.locator(state==='synced'?'.modal-close':'.sync-detail-close').click();
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
  await dialog.locator('.sync-detail-close').click();
  await page.evaluate(()=>{
    window.testPending=Array.from({length:91},(_,i)=>({table:'contacts',id:'fixture-'+i,record:{name:'รายการข้อมูลทดสอบที่ต้องเก็บไว้ '+(i+1)}}));
    syncUiLastError={warehouse_id:1,table_name:'contacts',error_code:'REVISION_CONFLICT',record_id:'fixture-1',local:true,message:'รายการนี้ถูกแก้ไขจากอีกเครื่อง กรุณาตรวจเทียบข้อมูลก่อนดำเนินการ',occurred_at:new Date().toISOString()};
  });
  await chip.click();
  await dialog.waitFor({state:'visible'});
  if(process.argv.includes('--screenshots')){
    fs.mkdirSync(path.join(root,'.tmp'),{recursive:true});
    await page.screenshot({path:path.join(root,'.tmp','sync-modal-ui-20260917-desktop.png')});
  }
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    await page.touchscreen.tap(2,2);
    assert.equal(await dialog.isVisible(),true,'tapping outside on small screens must not dismiss details');
    const bounds=await dialog.boundingBox();
    assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height,'modal fits the viewport');
    for(const selector of ['.modal-close','.sync-detail-close','.sync-detail-retry']){
      const button=await dialog.locator(selector).boundingBox();
      assert.ok(button.y>=bounds.y&&button.y+button.height<=bounds.y+bounds.height,'close and retry buttons stay in view');
    }
    assert.equal(await dialog.locator('.sync-detail-body').evaluate(el=>el.scrollHeight>el.clientHeight),true,'long content scrolls within the modal');
    await dialog.locator('.sync-detail-body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    assert.equal(await dialog.locator('.sync-detail-body').evaluate(el=>el.scrollTop>0),true);
    assert.equal(await page.evaluate(()=>window.testPending.length),91);
    assert.equal(await page.evaluate(()=>window.testSyncCalls),1);
    if(viewport.width===390&&process.argv.includes('--screenshots')){
      await dialog.locator('.sync-detail-body').evaluate(el=>{el.scrollTop=0;});
      await page.screenshot({path:path.join(root,'.tmp','sync-modal-ui-20260917-mobile.png')});
    }
  }
  await dialog.locator('.modal-close').click();
  await dialog.waitFor({state:'detached'});
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
  await dialog.locator('.modal-close').click();
  // Exercise the real Retry -> core -> per-shop product batches -> status flow.
  for(const store of [1,2]){
    await page.evaluate(store=>{
      activeWarehouseId=store;syncStatusByStore.clear();syncUiLastError=null;
      currentProfile={id:'sync-chip-owner',owner:true,level:1};loggedInUser=()=>currentProfile;
      captureStoreView=()=>({store:activeWarehouseId,combined:false});isStoreViewCurrent=context=>context.store===activeWarehouseId;
      offlinePosMode=()=>false;offlinePendingSales=()=>[];offlineSyncRunning=false;
      adoptRemoteMaintenanceEpoch=async()=>false;syncWarehousesIncrementally=async()=>true;
      syncInspectionListsToSupabase=async()=>true;upsertAndPrune=async()=>true;
      window.testPending=[];loadSyncEventDetails=async()=>[];
      reportClientEvent=()=>{};flushPendingClientEvents=()=>{};resolveOwnSyncEventsThrough=async()=>{};
      persistProductChangesToIndexedDB=async()=>true;
      syncCoreDataToSupabase=window.realProductCoreSync;coreSyncInFlight=false;coreSyncPending=false;
      insertRowsInChunks.paused?.clear();updateProductMetadataInChunks.paused?.clear();
      products=Array.from({length:8},(_,i)=>({id:901+i,wh:store,sku:'P'+i,name:'สินค้ารอส่ง '+i,unit:'ขวด',price:250,cost:230,_revision:1,_clientCreateToken:'token'+i}));
      const old=products.map(p=>({...p,price:200}));
      const conflict={id:999,wh:3-store,sku:'10546',name:'Thai-Bio พลูคาวสกัด (60 capsules)',unit:'ขวด',price:250,cost:230,_revision:1,_clientCreateToken:'conflict-token'};
      products.push(conflict);
      seedTableSnapshot('products',old,productMetadataToRow);
      productDirtyOperations=new Map([...old.map(p=>[String(p.id),'update']),['999','insert']]);
      window.syncTestRemote=new Map([...old.map(p=>productMetadataToRow(p)),productMetadataToRow({...conflict,price:0})].map(row=>[String(row.id),structuredClone(row)]));
      window.syncTestWrites=[];
      sb.from=table=>{
        if(table!=='products')throw new Error('Unexpected table '+table);
        let ids,id,revision,changes;
        const q={select:()=>q,in:(_key,v)=>{ids=v.map(String);return q;},eq:(key,v)=>{if(key==='id')id=String(v);else revision=v;return q;},
          update:v=>{changes=v;return q;},
          insert:async rows=>{window.syncTestWrites.push({kind:'insert',ids:rows.map(r=>r.id)});return {error:{code:'23505',message:'duplicate key'}};},
          maybeSingle:async()=>{const row=window.syncTestRemote.get(id);if(!changes)return {data:structuredClone(row||null)};
            if(!row||row.revision!==revision)return {data:null};Object.assign(row,changes,{revision:revision+1});window.syncTestWrites.push({kind:'update',id});return {data:{id:row.id,revision:row.revision}};},
          then:resolve=>Promise.resolve({data:[...window.syncTestRemote.values()].filter(row=>!ids||ids.includes(String(row.id))),error:null}).then(resolve)};return q;
      };
      setSyncUiState('synced',0);
    },store);
    assert.match(await chip.innerText(),/สินค้ารอซิงก์ 8 รายการ/);
    await chip.click();await dialog.getByRole('button',{name:'ลองซิงก์ใหม่',exact:true}).click();
    await page.waitForFunction(()=>!coreSyncInFlight&&document.querySelector('.sync-detail-summary')?.textContent==='ซิงก์ล่าสุดสำเร็จแล้ว');
    assert.equal(await dialog.locator('[data-pending-product-id]').count(),0);
    assert.equal(await chip.innerText(),'ซิงก์แล้ว');
    assert.deepEqual(await page.evaluate(()=>[...productDirtyOperations.keys()]),['999']);
    assert.equal(await page.evaluate(()=>window.syncTestRemote.get('999').price),0,'Conflicted remote price remains untouched');
    assert.equal(await page.evaluate(()=>products.find(p=>p.id===999).price),250,'Conflicted local price remains untouched');
    await dialog.locator('.modal-close').click();
    await page.evaluate(()=>{activeWarehouseId=3-activeWarehouseId;selectStoreSyncStatus();});
    assert.equal(await chip.getAttribute('data-state'),'error','Failure belongs only to the other shop');
    await chip.click();assert.equal(await dialog.locator('[data-pending-product-id]').count(),1);
    await dialog.locator('[data-compare-product="0"]').click();
    const comparison=page.getByRole('dialog',{name:'ตรวจเทียบงานค้าง',exact:true});
    await comparison.waitFor();assert.match(await comparison.innerText(),/ราคาขาย\s+250\s+0/);
    await comparison.getByRole('button',{name:'ปิด',exact:true}).click();await dialog.locator('.modal-close').click();
  }
  assert.deepEqual(errors,[]);
  console.log('sync status chip browser: all states, enlarged modal, persistent backdrop, both close buttons, mobile/tablet/landscape scrolling, keyboard/retry/history failure passed; no implicit sync or discarded work');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
