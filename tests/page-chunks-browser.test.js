const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const publicRoot=path.join(root,'public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.join(publicRoot,pathname==='/'?'index.html':pathname);
  if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
const executable=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync)||chromium.executablePath();
let browser;
(async()=>{
  const {buildStatic}=await import(pathToFileURL(path.join(root,'scripts/build-static.mjs')).href);await buildStatic();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:executable});
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
  const page=await context.newPage();const errors=[],chunks=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/\/page-[a-z]+\.js/.test(request.url())) chunks.push(request.url());});
  await page.route('https://**/*',route=>{
    if(route.request().url().includes('/@supabase/')) return route.fulfill({contentType:'text/javascript',body:`(()=>{const q=new Proxy({}, {get(_t,k){return k==='then'?(resolve=>resolve({data:[],error:null})):(()=>q);}});window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get:(t,k)=>k in t?t[k]:(()=>q)})};})();`});
    return route.fulfill({body:'',contentType:'text/plain'});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>typeof render==='function');
  assert.equal(await page.evaluate(()=>!!sb?.auth),true,'isolated Supabase client must be installed before testing routes');
  assert.equal(chunks.length,0,'login does not request desktop page code');
  assert.equal(await page.evaluate(()=>typeof window.renderProducts),'undefined');
  await page.evaluate(()=>{
    currentProfile={id:'isolated-test',level:1,owner:true,firstName:'ทดสอบ'};
    // This suite tests chunk rendering, not authenticated Edge Function calls.
    // An empty auth-session mock otherwise triggers the user loader's retry loop.
    systemUsersLoaded=true;
    systemUsers=[{id:'isolated-test',username:'test-owner',owner:true,level:1}];
    activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ',active:true}];
    renderLoginState=()=>true;canAccessTab=()=>true;isMobileDeviceMode=()=>false;
    ensureOnDemandDataForTab=()=>({status:'ready'});
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
  });
  console.log('built login ready; testing delayed page navigation');
  // A delayed report must not take over the POS after the user has navigated away.
  let release;
  await page.route('**/page-reports.js?*',route=>new Promise(resolve=>{release=async()=>{await route.continue();resolve();};}));
  await page.evaluate(()=>{currentTab='lowstock';render();});
  await page.waitForFunction(()=>document.querySelector('#main').textContent.includes('กำลังโหลดหน้านี้'));
  for(let attempt=0;!release&&attempt<100;attempt++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(release,`report request intercepted: ${chunks.join(',')}`);
  await page.evaluate(()=>{currentTab='checkout';render();});await release();
  await page.waitForFunction(()=>pageCodeReady('reports'));
  console.log('delayed page navigation passed; testing retry');
  assert.equal(await page.evaluate(()=>currentTab),'checkout');
  assert.equal(await page.locator('#main').getAttribute('data-missing-page'),null);
  // Network failure is recoverable without a reload or duplicate script requests.
  let failed=false;
  await page.route('**/page-documents.js?*',route=>{if(!failed){failed=true;return route.abort();}return route.continue();});
  await page.evaluate(()=>{currentTab='quotation';render();});
  await page.locator('#retryPageCodeBtn').waitFor();await page.locator('#retryPageCodeBtn').click();
  await page.waitForFunction(()=>pageCodeReady('documents')&&!document.querySelector('#retryPageCodeBtn'));
  console.log('retry passed; testing all lazy routes');
  // Exercise the actual built renderers and attached controls in all lazy routes.
  const tabs=await page.evaluate(()=>Object.values(PAGE_CODE_GROUPS).flatMap(group=>group.tabs));
  for(const tab of tabs){
    console.log(`checking lazy route: ${tab}`);
    await page.evaluate(async tab=>{await ensurePageCodeLoaded(tab);currentTab=tab;render();},tab);
    assert.ok((await page.locator('#main').innerText()).trim().length,`${tab} renders content`);
  }
  await page.evaluate(()=>{currentTab='products';render();});
  fs.mkdirSync(path.join(root,'outputs'),{recursive:true});
  await page.locator('#main').screenshot({path:path.join(root,'outputs','page-chunks-products.png')});
  const requestCount=chunks.length;
  await page.evaluate(async()=>{await Promise.all([ensurePageCodeLoaded('products'),ensurePageCodeLoaded('contacts')]);});
  assert.equal(chunks.length,requestCount,'revisiting a loaded group reuses its code');
  // Real IndexedDB: repeated identical acknowledgements must make no writes.
  const cache=await page.evaluate(async()=>{
    await clearProductIndexedCache();products=Array.from({length:2867},(_,i)=>({id:i+1,name:`สินค้า ${i+1}`}));
    markProductChangesDirty({updatedIds:[7]});
    const original=IDBDatabase.prototype.transaction;let writes=0;
    IDBDatabase.prototype.transaction=function(names,mode,...args){if(mode==='readwrite') writes++;return original.call(this,names,mode,...args);};
    try{
      await Promise.all([persistProductChangesToIndexedDB({updatedIds:[7]}),persistProductChangesToIndexedDB({updatedIds:[7]})]);
      const initialWrites=writes;
      await persistProductChangesToIndexedDB({updatedIds:[7]});
      const unchangedWrites=writes;
      products[6].name='แก้แล้ว';await persistProductChangesToIndexedDB({updatedIds:[7]});
      const db=await openProductCacheDb(),tx=db.transaction('products','readonly');
      const rows=await idbRequest(tx.objectStore('products').getAll());
      return {initialWrites,unchangedWrites,writes,rows};
    }finally{IDBDatabase.prototype.transaction=original;}
  });
  assert.equal(cache.initialWrites,1);assert.equal(cache.unchangedWrites,1);assert.equal(cache.writes,2);
  assert.deepEqual(cache.rows,[{id:7,name:'แก้แล้ว'}]);
  const retry=await page.evaluate(async()=>{
    const original=openProductCacheDb;
    products[6].name='retry-after-failure';
    openProductCacheDb=async()=>{throw new Error('simulated disk failure');};
    const failed=await persistProductChangesToIndexedDB({updatedIds:[7]});
    openProductCacheDb=original;
    const saved=await persistProductChangesToIndexedDB({updatedIds:[7]});
    const db=await openProductCacheDb();
    const row=await idbRequest(db.transaction('products','readonly').objectStore('products').get(7));
    return {failed,saved,name:row.name};
  });
  assert.deepEqual(retry,{failed:false,saved:true,name:'retry-after-failure'});
  // A chunk from another deployment cannot install incompatible functions.
  const other=await context.newPage();
  // Test the version guard in a clean document without the app's lexical scope.
  await other.goto('about:blank');await other.addScriptTag({content:'const APP_ASSET_VERSION="old-release";'});
  await other.addScriptTag({content:fs.readFileSync(path.join(publicRoot,'page-reports.js'),'utf8')});
  assert.equal(await other.evaluate(()=>typeof window.renderRInventory),'undefined');
  assert.deepEqual(errors,[]);
  console.log(`built page chunks browser test passed: ${tabs.length} routes, lazy requests, retry, navigation race, version guard, incremental IndexedDB writes`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
