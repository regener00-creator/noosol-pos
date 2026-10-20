const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.join(__dirname,'..');
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
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await installIsolatedBrowser(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url='http://127.0.0.1:'+server.address().port;
  await page.goto(url,{waitUntil:'domcontentloaded'});await waitForIsolatedBootstrap(page);
  await page.evaluate(async()=>{
    currentProfile={id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',username:'offline-test',owner:true,level:1,firstName:'Tester'};
    warehouses=[{id:1,name:'Test warehouse'}];activeWarehouseId=1;allWarehousesMode=false;
    products=[{id:1,sku:'P001',barcode:'111',name:'Test medicine',unit:'box',stock:10,price:100,cost:40,units:[],vatMode:'none',active:true}];
    contacts=[];promotions=[];favorites=[];
    inventoryBalanceRows=[{warehouse_id:1,product_id:1,stock:10}];inventoryLotRows=[];
    rebuildInventoryBalanceMap();rebuildProductLookupMaps();
    businessSettings={...DEFAULT_BUSINESS_SETTINGS,vatRegistered:false};
    currentCashShift={id:'shift-1',shiftNo:'CS1',warehouseId:1,openedBy:currentProfile.id,status:'open',openingCash:0,openedAt:new Date().toISOString()};
    cashShifts=[currentCashShift];indexedProductCacheReady=true;offlineSnapshotReady=true;
    await rememberOfflineLogin('offline-test','TestPassword123!');
    if(!await saveOfflinePosSnapshot()) throw new Error('snapshot not saved');
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
    await enterOfflinePos({restore:true});
  });
  assert.equal(await page.evaluate(()=>offlinePosActive),true);
  // Exercise real checkout and IndexedDB, not a replacement checkout function.
  async function sell(){
    return page.evaluate(async()=>{
      cart=[{pid:1,name:'Test medicine',unit:'box',factor:1,qty:1,price:100,regularPrice:100,priceSource:'standard',cost:40}];
      saleDiscount=0;saleMember=null;saleLoyaltySelection=null;saleSourceQuotationId=null;
      await doCheckout('เงินสด',{cashReceived:100,cashChange:0});
      return {count:offlinePendingSales().length,cart:cart.length,stock:warehouseStock(1,1),pending:!!readPendingCheckoutRequest()};
    });
  }
  assert.deepEqual(await sell(),{count:1,cart:0,stock:9,pending:false});
  await page.locator('.modal-close').last().click().catch(()=>{});
  assert.deepEqual(await sell(),{count:2,cart:0,stock:8,pending:false});
  await page.evaluate(()=>document.querySelectorAll('.modal-overlay').forEach(el=>el.remove()));
  // A full new JS context must restore the account and both receipts.
  await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
  await page.reload({waitUntil:'domcontentloaded'});await waitForIsolatedBootstrap(page);
  assert.deepEqual(await page.evaluate(()=>({account:currentProfile?.username,count:offlinePendingSales().length,stock:warehouseStock(1,1)})),
    {account:'offline-test',count:2,stock:8});
  assert.equal(await page.evaluate(async()=>{
    try{await enterOfflinePos({username:'offline-test',password:'incorrect'});return false;}catch(e){return true;}
  }),true);
  // Storage failures cannot clear a cart or claim that payment was recorded.
  await page.evaluate(()=>{
    window.realEditOfflineSales=editOfflineSales;
    editOfflineSales=async()=>{throw new Error('disk full');};
  });
  const failed=await sell();assert.equal(failed.cart,1);assert.equal(failed.count,2);
  await page.evaluate(async()=>{
    editOfflineSales=realEditOfflineSales;
    // Retry the same durable checkout: one additional receipt, not two.
    await doCheckout('เงินสด',{cashReceived:100,cashChange:0});
    document.querySelectorAll('.modal-overlay').forEach(el=>el.remove());
  });
  assert.equal(await page.evaluate(()=>offlinePendingSales().length),3);
  // The real server contract is covered separately by offline-sales-database.mjs.
  // Here simulate commit + lost response, including reuse of the exact UUID.
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});
    window.remoteSales=new Map();window.rpcCalls=[];window.loseFirstResponse=true;
    sb.auth.getUser=async()=>({data:{user:{id:currentProfile.id}}});
    flushPendingClientEvents=()=>{};
    sb.from=table=>{
      const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:currentProfile.id,username:'offline-test',owner:true,level:1,first_name:'Tester'}})};
      return q;
    };
    sb.rpc=async(name,args)=>{
      if(name!=='complete_sale')throw new Error('unexpected RPC '+name);
      rpcCalls.push(structuredClone(args));
      if(!remoteSales.has(args.p_request_id)){
        remoteSales.set(args.p_request_id,{...args.p_sale,id:'SERVER-'+args.p_request_id,ref:'RE-'+remoteSales.size,checkoutRequestId:args.p_request_id,items:args.p_items});
      }
      if(loseFirstResponse){loseFirstResponse=false;throw new TypeError('Failed to fetch');}
      return {data:{sale:remoteSales.get(args.p_request_id)}};
    };
    loadWorkspaceFromSupabase=async()=>{offlineSnapshotReady=true;inventoryBalanceRows=[{warehouse_id:1,product_id:1,stock:7}];rebuildInventoryBalanceMap();};
  });
  // A different server account must never receive another cashier's queue.
  await page.evaluate(async()=>{
    const original=sb.auth.getUser;sb.auth.getUser=async()=>({data:{user:{id:'another-cashier'}}});
    await syncOfflineSales();sb.auth.getUser=original;
  });
  assert.equal(await page.evaluate(()=>rpcCalls.length),0);
  assert.equal(await page.evaluate(()=>offlinePendingSales().length),3);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>!offlineSyncRunning&&remoteSales.size===1);
  assert.equal(await page.evaluate(()=>offlinePendingSales().length),3);
  assert.equal(await page.evaluate(()=>remoteSales.size),1);
  await page.evaluate(()=>syncOfflineSales());
  assert.equal(await page.evaluate(()=>offlinePendingSales().length),0);
  assert.equal(await page.evaluate(()=>remoteSales.size),3);
  assert.equal(await page.evaluate(()=>rpcCalls[0].p_request_id===rpcCalls[1].p_request_id),true);
  assert.equal(await page.evaluate(()=>warehouseStock(1,1)),7);
  assert.equal(await page.evaluate(()=>salesHistory.filter(s=>s.id.startsWith('SERVER-')).length),3);
  assert.deepEqual(errors,[]);
  console.log('Offline browser: cached login/reload, password check, multiple durable sales, disk failure, lost response retry, exact-once posting and inventory passed');
})().finally(async()=>{await browser?.close();server.close();}).catch(e=>{console.error(e);process.exitCode=1;});
