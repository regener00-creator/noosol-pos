const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.join(__dirname,'..');
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await installIsolatedBrowser(page);
  await page.goto(`http://127.0.0.1:${server.address().port}`);await waitForIsolatedBootstrap(page);
  await page.evaluate(async()=>{
    currentProfile={id:'owner-a',username:'owner-a',owner:true,level:1,firstName:'A'};
    warehouses=[{id:1,name:'Test'}];activeWarehouseId=1;allWarehousesMode=false;
    products=[{id:1,name:'Medicine A',unit:'box',price:100,stock:10,units:[]},{id:2,name:'Medicine B',unit:'box',price:50,units:[]}];
    contacts=[];promotions=[];favorites=[];inventoryBalanceRows=[{warehouse_id:1,product_id:1,stock:10}];inventoryLotRows=[];
    currentCashShift=null;cashShifts=[];rebuildInventoryBalanceMap();rebuildProductLookupMaps();
    offlineSnapshotReady=true;
    await persistProductsToIndexedDB(products);
    await rememberOfflineLogin('owner-a','TestPassword123!');
    await saveOfflinePosSnapshot();
    window.originalIdbPut=IDBObjectStore.prototype.put;window.snapshotWrites=0;window.catalogWrites=0;
    IDBObjectStore.prototype.put=function(row,...args){
      if(this.name===OFFLINE_PRODUCTS_STORE) catalogWrites++;
      if(this.name===PRODUCT_CACHE_META_STORE&&String(row.key).includes(':snapshot:')) snapshotWrites++;
      return originalIdbPut.call(this,row,...args);
    };
    await Promise.all([saveOfflinePosSnapshot(),saveOfflinePosSnapshot(),saveOfflinePosSnapshot()]);
  });
  assert.deepEqual(await page.evaluate(()=>({snapshots:snapshotWrites,catalog:catalogWrites})),{snapshots:1,catalog:0});
  assert.equal(await page.evaluate(async()=>Object.hasOwn(await offlineStoreRead(`${OFFLINE_POS_KEY}:snapshot:owner-a`),'products')),false);
  await page.evaluate(async()=>{
    products[0].price=200;products=products.filter(p=>p.id!==2);
    if(!await persistProductChangesToIndexedDB({updatedIds:[1],deletedIds:[2]})) throw new Error('cache write failed');
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
    await enterOfflinePos({restore:true});
  });
  assert.deepEqual(await page.evaluate(()=>products.map(p=>[p.id,p.price])),[[1,200]],'offline uses committed updates/deletions, not the old snapshot');
  await page.evaluate(async()=>{
    offlinePosActive=false;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});
    currentProfile={id:'owner-b',username:'owner-b',owner:true,level:1,firstName:'B'};
    products=[{id:9,name:'B only',unit:'box',price:900,units:[]}];
    await rememberOfflineLogin('owner-b','TestPassword123!');await saveOfflinePosSnapshot({refreshProducts:true});
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
    await enterOfflinePos({username:'owner-a',password:'TestPassword123!'});
  });
  assert.deepEqual(await page.evaluate(()=>products.map(p=>[p.id,p.price])),[[1,200]],'another account cannot overwrite this offline catalog');
  await page.evaluate(async()=>{
    offlinePosActive=false;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});
    // Preserve old installations until their first successful online migration.
    const snapshot=await offlineStoreRead(`${OFFLINE_POS_KEY}:snapshot:owner-a`);
    delete snapshot.format;snapshot.products=[{id:7,name:'Legacy',unit:'box',price:70,units:[]}];
    await offlineStoreWrite(`${OFFLINE_POS_KEY}:snapshot:owner-a`,snapshot);
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});await enterOfflinePos({restore:true});
  });
  assert.equal(await page.evaluate(()=>products[0].id),7,'legacy snapshot remains readable');
  await page.evaluate(async()=>{
    offlinePosActive=false;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});
    await saveOfflinePosSnapshot({refreshProducts:true});
  });
  assert.equal(await page.evaluate(async()=>(await offlineStoreRead(`${OFFLINE_POS_KEY}:snapshot:owner-a`)).format),2);
  const rollback=await page.evaluate(async()=>{
    const before=await offlineStoreRead(`${OFFLINE_POS_KEY}:snapshot:owner-a`);
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){
      if(this.name===OFFLINE_PRODUCTS_STORE) throw new DOMException('Test: disk full','QuotaExceededError');
      return original.apply(this,args);
    };
    products[0].price=999;
    const incremental=await persistProductChangesToIndexedDB({updatedIds:[7]});
    let snapshotFailed=false;
    try{await saveOfflinePosSnapshot({refreshProducts:true});}catch(error){snapshotFailed=true;}
    IDBObjectStore.prototype.put=original;
    const after=await offlineStoreRead(`${OFFLINE_POS_KEY}:snapshot:owner-a`);
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
    await enterOfflinePos({restore:true});
    return {incremental,snapshotFailed,snapshotUnchanged:JSON.stringify(before)===JSON.stringify(after),price:products[0].price};
  });
  assert.deepEqual(rollback,{incremental:false,snapshotFailed:true,snapshotUnchanged:true,price:70},'a failed catalog transaction preserves the previous offline snapshot');
  assert.deepEqual(errors,[]);
  console.log('Offline catalog: incremental prices/deletions, actor isolation, coalesced snapshots and legacy migration passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
