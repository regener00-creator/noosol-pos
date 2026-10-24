const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.join(__dirname,'../public');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  // This test uses the real service worker and production bundles. The sole
  // external SDK is isolated so the test cannot contact the production DB.
  const sdk=`(()=>{const q=new Proxy({}, {get(_t,k){return k==='then'?(resolve=>resolve({data:[],error:null})):(()=>q);}});
    window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get:(t,k)=>k in t?t[k]:(()=>q)})};})();`;
  let disconnected=false;
  await context.route('https://**/*',route=>disconnected?route.abort():route.fulfill({contentType:'text/javascript',body:route.request().url().includes('/@supabase/')?sdk:''}));
  const page=await context.newPage(),url='http://127.0.0.1:'+server.address().port;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.evaluate(()=>window.peposBootstrapReady);
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller) await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  });
  // Reload online once so runtime dependencies are cached by the controlling SW.
  await page.reload();await page.evaluate(()=>window.peposBootstrapReady);
  await page.evaluate(async()=>{
    currentProfile={id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',username:'shell-test',owner:true,level:1,firstName:'Tester'};
    warehouses=[{id:1,name:'Offline warehouse'}];activeWarehouseId=1;allWarehousesMode=false;
    products=[{id:1,name:'Offline item',sku:'OFF1',barcode:'111',unit:'box',stock:10,price:100,cost:40,units:[],vatMode:'none',active:true}];
    contacts=[];promotions=[];favorites=[];warehouseAccessRows=[];pagePermissionRows=[];
    inventoryBalanceRows=[{warehouse_id:1,product_id:1,stock:10}];inventoryLotRows=[];
    rebuildInventoryBalanceMap();rebuildProductLookupMaps();
    currentCashShift={id:'shift-1',shiftNo:'CS1',warehouseId:1,openedBy:currentProfile.id,status:'open',openingCash:0,openedAt:new Date().toISOString()};
    cashShifts=[currentCashShift];indexedProductCacheReady=true;offlineSnapshotReady=true;
    await rememberOfflineLogin('shell-test','TestPassword123!');
    if(!await saveOfflinePosSnapshot())throw new Error('snapshot failed');
  });
  disconnected=true;await context.setOffline(true);
  const response=await page.reload({waitUntil:'domcontentloaded'});
  assert.equal(response.fromServiceWorker(),true);
  await page.evaluate(()=>window.peposBootstrapReady);
  assert.equal(await page.evaluate(()=>navigator.onLine),false);
  if(!await page.evaluate(()=>currentProfile)) console.log(await page.evaluate(async()=>({loginError:document.getElementById('loginError')?.textContent,sdk:!!window.supabase,errors:window.__peposDependencyError,cacheKeys:await caches.keys()})));
  assert.equal(await page.evaluate(()=>currentProfile?.username),'shell-test');
  assert.equal(await page.locator('#appRoot').isVisible(),true);
  await page.evaluate(async()=>{
    applySapuriTheme('mac');
    for(const style of ['400','italic 600']){
      const loaded=await document.fonts.load(`${style} 16px "Google Sans"`,'SAPURI ภาษาไทย 123');
      if(!loaded.length||loaded.some(font=>font.status!=='loaded')) throw new Error('Google Sans must load offline');
    }
  });
  await page.evaluate(async()=>{
    cart=[{pid:1,name:'Offline item',unit:'box',factor:1,qty:1,price:100,regularPrice:100,cost:40}];
    await doCheckout('เงินสด',{cashReceived:100,cashChange:0});
  });
  assert.equal(await page.evaluate(()=>offlinePendingSales().length),1);
  await page.reload({waitUntil:'domcontentloaded'});await page.evaluate(()=>window.peposBootstrapReady);
  assert.equal(await page.evaluate(()=>offlinePendingSales().length),1);
  assert.equal(await page.evaluate(()=>warehouseStock(1,1)),9);
  await page.screenshot({path:path.join(__dirname,'../../offline-pos-verified.png')});
  assert.deepEqual(errors,[]);
  console.log('Offline shell: real network disconnect, service-worker navigation, SDK/assets, cached login, sale and reload passed');
})().finally(async()=>{await browser?.close();server.close();}).catch(e=>{console.error(e);process.exitCode=1;});
