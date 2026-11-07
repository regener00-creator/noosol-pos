const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'public');
const server=http.createServer((req,res)=>{
  const file=path.join(publicRoot,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');
  if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream'));fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  execFileSync(process.execPath,[path.join(root,'scripts/build-static.mjs')],{cwd:root,stdio:'pipe'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&fs.existsSync(file))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installIsolatedBrowser(page);await page.goto(`http://127.0.0.1:${server.address().port}/`);await waitForIsolatedBootstrap(page);
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('barcodeprint');await ensurePageCodeLoaded('products');await ensurePageCodeLoaded('rinventory');
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());document.getElementById('appRoot').hidden=false;
    currentProfile={id:'test-owner',owner:true,level:1};renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});
    loadWarehouseInventoryFromSupabase=async()=>true;loadCashShiftsFromSupabase=async()=>{};saveOfflinePosSnapshot=async()=>{};
    warehouses=[{id:1,name:'พระยาสุเรนทร์'},{id:2,name:'พรชัย'}];
    const item=(id,wh,name,barcode,price,cost)=>({id,wh,name,barcode,sku:'SKU'+id,price,cost,category:'ยา',brand:'ทั่วไป',unit:'ซอง',units:[],active:true});
    const rows=[item(11,1,'Decolgen','0001',40,22),item(12,2,'Decolgen','0001',45,28),item(13,2,'พรชัยเท่านั้น','0022',33,11),item(14,1,'พระยาสุเรนทร์เท่านั้น','0033',17,9)];
    rows[1].units=[{sub:'กล่อง',factor:10,price:399,cost:270,barcode:'0044'}];
    currentTab='products';activeWarehouseId=1;allWarehousesMode=false;setWarehouseProductCatalog(rows);
    contacts=[{id:901,name:'ชื่อเหมือนกัน',phone:'0801111111',types:['customer','supplier']},
      {id:902,warehouseId:2,name:'ชื่อเหมือนกัน',phone:'0801111111',types:['customer','supplier']}];
    loadedInventoryBalanceWarehouseIds=new Set([1,2]);inventoryBalanceRows=[{product_id:11,warehouse_id:1,stock:0},{product_id:12,warehouse_id:2,stock:17}];rebuildInventoryBalanceMap();
    selectActiveWarehouse(1);render();
  });
  for(const [wh,id,price,cost] of [[1,11,40,22],[2,12,45,28]]){
    const result=await page.evaluate(({wh})=>{
      selectActiveWarehouse(wh);const found=findProductByExactCode('0001');addToCart(found.product.id,found.unitName,1);
      return {id:found.product.id,price:cart[0].price,cost:cart[0].cost,wrong:products.some(product=>product.wh!==wh),all:completeProductCatalog().length};
    },{wh});assert.deepEqual(result,{id,price,cost,wrong:false,all:4});
    assert.deepEqual(await page.evaluate(()=>[customersList().map(c=>c.id),suppliersList().map(c=>c.id),duplicateCustomerPhone('080-111-1111')?.id]),[[900+wh],[900+wh],900+wh]);
  }
  await page.evaluate(()=>{selectActiveWarehouse('all');render();});
  const nav=await page.locator('.navbtn').evaluateAll(buttons=>buttons.map(b=>b.dataset.tab).sort());
  assert.deepEqual(nav,['products','representativehistory','rinventory']);
  await page.evaluate(()=>ensurePageCodeLoaded('representativehistory'));
  assert.deepEqual(await page.evaluate(()=>[canEditNote({createdBy:currentProfile.id}),canDeleteNote({createdBy:currentProfile.id})]),[false,false]);
  const dec=page.locator('[data-combined-results] tr').filter({hasText:'Decolgen'}).filter({hasText:'ซอง'});
  assert.deepEqual(await dec.locator('td').allTextContents(),['Decolgen','ซอง','40.00','22.00','45.00','28.00']);
  assert.equal(await page.locator('.only-phonchai').count(),2);assert.equal(await page.locator('.only-phraya').count(),1);
  const collision=await page.evaluate(()=>combinedCatalogRows([{...products.find(p=>p.id===11),name:'Drug one'},{...products.find(p=>p.id===12),name:'Drug two',units:[]}]).length);
  assert.equal(collision,2,'Unrelated products that reuse a barcode do not merge');
  await page.locator('[data-combined-search]').fill('0022');assert.equal(await page.locator('[data-combined-results] tbody tr').count(),1);
  await page.setViewportSize({width:2300,height:1100});
  async function assertUsesPageWidth(){
    const width=await page.locator('.combined-catalog').evaluate(el=>({width:el.clientWidth,available:el.parentElement.clientWidth-parseFloat(getComputedStyle(el.parentElement).paddingLeft)-parseFloat(getComputedStyle(el.parentElement).paddingRight)}));
    assert.ok(width.available>1400&&Math.abs(width.available-width.width)<=2,JSON.stringify(width));
  }
  await assertUsesPageWidth();
  await page.evaluate(()=>{
    const more=Array.from({length:11},(_,i)=>({...products.find(p=>p.id===11),id:301+i,name:'Pagination '+String(i).padStart(2,'0'),barcode:'page'+i}));
    setWarehouseProductCatalog([...completeProductCatalog(),...more]);render();
  });
  await page.locator('[data-combined-search]').fill('Pagination');
  assert.equal(await page.locator('[data-combined-results] tbody tr').count(),10);
  await page.locator('[data-combined-next]').click();
  assert.equal(await page.locator('[data-combined-results] tbody tr').count(),1);
  assert.match(await page.locator('[data-combined-results] tbody').innerText(),/Pagination 10/);
  await page.locator('.navbtn[data-tab="rinventory"]').click();
  const stock=page.locator('[data-combined-results] tr').filter({hasText:'0001'});
  assert.deepEqual(await stock.locator('td').allTextContents(),['0001','Decolgen','ซอง','0','17']);
  await assertUsesPageWidth();
  assert.deepEqual(await page.locator('[data-combined-results] tr').filter({hasText:'0022'}).locator('td').allTextContents(),['0022','พรชัยเท่านั้น','ซอง','—','0']);
  await page.evaluate(()=>{selectActiveWarehouse(2);currentTab='transfer';render();});
  assert.equal(await page.locator('.navbtn[data-tab="transfer"]').count(),0);assert.notEqual(await page.evaluate(()=>currentTab),'transfer');
  assert.deepEqual(errors,[]);
  console.log('Store switching, POS scan/price/cost, combined menu, barcode/unit matching, exclusive colors and separate stock passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
