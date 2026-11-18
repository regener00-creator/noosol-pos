const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
require('../scripts/app-source.cjs').writeDevelopmentApp();
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg'};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
  if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});

let browser;
const browserExecutable = [
  process.env.PEPOS_BROWSER_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบตัวออกแบบป้ายราคา');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const query=new Proxy({}, {get(_target,property){
        if(property==='then') return resolve=>resolve({data:null,error:null});
        return ()=>query;
      }});
      window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}}, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof openPriceLabelDesigner === 'function');

  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    clearTimeout(supabaseCoreSyncTimer);
    scheduleSupabaseCoreSync=()=>{};
    currentProfile={id:'reserve-owner',owner:true,firstName:'ทดสอบ'};
    currentTab='barcodeprint';
    barcodePrintMode='new';barcodePrintShowMenu=false;
    persistProductChangesToIndexedDB=async()=>true;
    render=()=>{main.innerHTML=renderBarcodePrint();attachEvents();};
    window.testCalls=[];window.testPrints=[];
    window.testPrintBlocked=false;
    window.open=()=>window.testPrintBlocked?null:{closed:false,close(){this.closed=true;}};
    writeBarcodePrintWindow=(_win,items)=>{window.testPrints.push(structuredClone(items));return true;};
    sb.rpc=async(name,args)=>{
      window.testCalls.push(structuredClone(args));
      const items=args.p_items.map((item,index)=>({...item,barcode:(args.p_warehouse_id===1?'AP':'BP')+String(window.testCalls.length*10+index).padStart(11,'0')}));
      return {data:{items,products:items.map(item=>{
        const product=structuredClone(products.find(p=>p.id===item.pid));
        if(item.unit===product.unit)product.barcode=item.barcode;
        else product.units.find(u=>u.sub===item.unit).barcode=item.barcode;
        return productMetadataToRow(product);
      })},error:null};
    };
  });
  page.on('dialog',dialog=>dialog.accept());
  for(const store of [1,2]){
    await page.evaluate(store=>{
      activeWarehouseId=store;
      captureStoreView=()=>({actor:currentProfile.id,store:activeWarehouseId});
      isStoreViewCurrent=c=>c.actor===currentProfile.id&&c.store===activeWarehouseId;
      products=[{id:store*100,wh:store,sku:'P0069',name:'[BM] Calcium (60 tablets)',unit:'ขวด',price:250,barcode:'',units:[],active:true},
        {id:store*100+1,wh:store,sku:'P0067',name:'[BM] Bio C Acerola Plus 1500mg (15 tablets)',unit:'กล่อง',price:130,barcode:'',units:[],active:true}];
      barcodePrintItems=[];barcodePrintRequest=null;barcodePrintOtherQueue=null;
      barcodePrintAddProduct(products[0]);render();
    },store);
    const count=await page.evaluate(()=>window.testCalls.length);
    assert.equal(await page.locator('#savePrintBarcodeBtn').isDisabled(),true);
    await page.locator('#clearBarcodePrintBtn').click();
    assert.equal(await page.evaluate(()=>window.testCalls.length),count);
    assert.equal(await page.locator('[data-barcode-print-row]').count(),0);
    await page.locator('#barcodePrintSearch').fill('Calcium');
    await page.locator('[data-barcode-print-result]').click();
    assert.equal(await page.evaluate(()=>window.testCalls.length),count);
    await page.locator('#reserveBarcodePrintBtn').click();
    await page.waitForFunction(()=>!barcodePrintSavePending);
    assert.equal(await page.evaluate(()=>window.testCalls.length),count+1);
    const code=await page.locator('[data-barcode-print-code]').inputValue();
    assert.ok(code.startsWith(store===1?'AP':'BP'));
    assert.equal(await page.locator('[data-barcode-print-code]').getAttribute('readonly'),'');
    assert.equal(await page.locator('#reserveBarcodePrintBtn').isDisabled(),true);
    assert.equal(await page.locator('#savePrintBarcodeBtn').isEnabled(),true);
    const printCount=await page.evaluate(()=>window.testPrints.length);
    await page.evaluate(()=>window.testPrintBlocked=true);
    await page.locator('#savePrintBarcodeBtn').click();
    assert.equal(await page.evaluate(()=>window.testPrints.length),printCount);
    await page.evaluate(()=>window.testPrintBlocked=false);
    await page.locator('[data-barcode-print-qty]').fill('2');
    await page.locator('#savePrintBarcodeBtn').click();
    await page.locator('#savePrintBarcodeBtn').click();
    assert.equal(await page.evaluate(()=>window.testCalls.length),count+1,'Printing must not allocate');
    assert.deepEqual(await page.evaluate(()=>window.testPrints.at(-1).map(i=>[i.barcode,i.qty])),[[code,2]]);
    await page.locator('#barcodePrintSearch').fill('Acerola');
    await page.locator('[data-barcode-print-result]').click();
    assert.equal(await page.locator('#savePrintBarcodeBtn').isDisabled(),true);
    await page.locator('#reserveBarcodePrintBtn').click();
    await page.waitForFunction(()=>!barcodePrintSavePending);
    assert.equal(await page.locator('[data-barcode-print-row]').count(),2);
    assert.equal(await page.evaluate(()=>window.testCalls.at(-1).p_items.length),1);
    assert.equal(await page.locator('[data-barcode-print-code="0"]').inputValue(),code);
    if(store===1){
      fs.mkdirSync(path.join(root,'outputs'),{recursive:true});
      await page.screenshot({path:path.join(root,'outputs/barcode-reservation.png')});
    }
    await page.locator('#clearBarcodePrintBtn').click();
    assert.equal(await page.evaluate(()=>products[0].barcode),code,'Clearing preserves assigned barcode');
  }
  assert.deepEqual(errors,[]);
  console.log('barcode reservation browser tests passed (both stores)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(typeof server.closeAllConnections==='function')server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
});
