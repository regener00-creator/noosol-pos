const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
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
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // No real customer, stock or auth request can leave this isolated browser.
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(url.startsWith('http://127.0.0.1:')) return route.continue();
    if(url.includes('cdn.jsdelivr.net/npm/@supabase/')) return route.fulfill({contentType:'text/javascript',body:`
      const empty=new Proxy({}, {get(_t,key){if(key==='then')return resolve=>resolve({data:[],error:null});return ()=>empty;}});
      window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:table=>window.testFrom?window.testFrom(table):empty},{get(t,k){return k in t?t[k]:()=>empty;}})};
    `});
    return route.fulfill({contentType:url.includes('fonts.googleapis.com')?'text/css':'text/javascript',body:''});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof openSyncDetailsModal==='function');
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen').forEach(el=>el.remove());
    render=()=>{};renderLoginState=()=>true;
    currentProfile={id:'sync-test-owner',owner:true,level:1};
    currentDeviceId=()=> 'sync-test-device';
    adoptRemoteMaintenanceEpoch=async()=>false;syncWarehousesIncrementally=async()=>true;syncProductsIncrementally=async()=>true;syncInspectionListsToSupabase=async()=>true;
    reportClientEvent=()=>{};flushPendingClientEvents=()=>{};resolveOwnSyncEventsThrough=async()=>{};
    currentTab='customers';salesRepresentatives=[];inspectionLists=[];
    contacts=Array.from({length:89},(_,i)=>({id:i+1,name:'ผู้จำหน่าย '+(i+1),types:['supplier'],phone:'',_revision:2,loyaltyJoinedAt:'2026-09-03T04:00:00Z'}));
    workspaceRecoveryEntries=new Map();syncedTableRows.contacts=new Map();
    window.masterRemote=contacts.map(item=>{const row=contactToRow(item);delete row.data.loyaltyJoinedAt;return structuredClone(row);});
    for(const item of contacts){const baseline=JSON.stringify(contactToRow(item));syncedTableRows.contacts.set(String(item.id),baseline);workspaceRecoveryEntries.set('contacts:'+item.id,{table:'contacts',id:String(item.id),baseline,record:item,legacy:true});}
    for(const id of [998,999]){const baseline=JSON.stringify(contactToRow({id,name:'ลบแล้ว',types:['customer'],_revision:1}));syncedTableRows.contacts.set(String(id),baseline);workspaceRecoveryEntries.set('contacts:'+id,{table:'contacts',id:String(id),baseline,record:null});}
    window.masterWrites=[];
    window.testFrom=table=>{
      const filters=[];let remove=false,single=false;
      const q={select:()=>q,eq:(key,value)=>{filters.push(row=>String(row[key])===String(value));return q;},in:(key,ids)=>{filters.push(row=>ids.map(String).includes(String(row[key])));return q;},
        delete:()=>{remove=true;return q;},maybeSingle:()=>{single=true;return q;},
        update:()=>{throw new Error('Unexpected update during legacy reconciliation');},insert:()=>{throw new Error('Unexpected insert during legacy reconciliation');},
        then:resolve=>{const data=table==='contacts'?window.masterRemote.filter(row=>filters.every(fn=>fn(row))):[];if(remove){window.masterWrites.push(...data.map(row=>row.id));}return Promise.resolve({data:single?(data[0]||null):data,error:null}).then(resolve);}};return q;
    };
    syncUiState='error';syncUiErrorCount=1;syncUiLastError={table_name:'contacts',error_code:'REVISION_CONFLICT',record_id:'999',local:true,message:'งานเก่ารอลบ',occurred_at:new Date().toISOString()};
    loadSyncEventDetails=async()=>[{id:'old-other',device_id:'another-device',table_name:'products',status:'open',message:'ประวัติจากอีกเครื่อง',occurred_at:'2026-09-02T10:00:00Z'},{id:'resolved',device_id:'sync-test-device',status:'resolved',message:'แก้แล้ว',occurred_at:'2026-09-01T10:00:00Z'}];
    openSyncDetailsModal();
  });
  assert.match(await page.locator('.sync-recovery-panel').innerText(),/งานรอซิงก์ 91 รายการ/);
  await page.getByRole('button',{name:'ตรวจเทียบ',exact:true}).first().click();
  await page.getByRole('dialog',{name:'ตรวจเทียบงานค้าง'}).waitFor();
  assert.match(await page.getByRole('dialog',{name:'ตรวจเทียบงานค้าง'}).innerText(),/วันที่เริ่มสมาชิก/);
  await page.getByRole('dialog',{name:'ตรวจเทียบงานค้าง'}).getByRole('button',{name:'ปิด',exact:true}).click();
  await page.getByRole('button',{name:'ลองซิงก์ใหม่',exact:true}).click();
  await page.waitForFunction(()=>syncUiState==='synced');
  assert.match(await page.locator('.sync-recovery-panel').innerText(),/งานรอซิงก์ 0 รายการ/);
  assert.equal(await page.evaluate(()=>window.masterWrites.length),0,'no existing record was deleted or changed');
  assert.equal(await page.evaluate(()=>contacts.length),89);
  assert.match(await page.locator('.sync-detail-list').innerText(),/รายการยังเปิดจากเครื่องอื่น/);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.sync-detail-modal').evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('master sync browser: 91 pending -> 0, no master writes, comparison/history/mobile checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
