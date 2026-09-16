const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..',process.env.PEPOS_TEST_BUILT==='1'?'public':'');
const server=http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json'}[path.extname(file)]||'application/octet-stream')+'; charset=utf-8'});
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const query=new Proxy({}, {get(t,p){if(p==='then')return resolve=>resolve({data:null,error:null});return ()=>query;}});
    window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get(t,p){return p in t?t[p]:()=>query;}})};
  });
  await page.route('https://**/*',route=>route.fulfill({body:'',contentType:'text/plain'}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof openMobileProductEditor==='function');
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    renderLoginState=()=>true; isMobileDeviceMode=()=>true;
    currentProfile={id:'owner-test',owner:true,level:1,firstName:'Owner'};
    currentTab='mobiletools';activeWarehouseId=1;warehouses=[{id:1,name:'คลังหนึ่ง'},{id:2,name:'คลังสอง'}];
    products=[{id:9101,name:'สินค้าทดสอบ A',sku:'A',category:'ยา',brand:'ทั่วไป',unit:'กล่อง',price:100,cost:60,stock:25,barcode:'8850000000001',multiunit:true,units:[{sub:'ลัง',per:10,base:'กล่อง',factor:10,price:900,cost:600,barcode:'8850000000010'}],active:true,extraBarcodes:['OLD-A'],extraBarcodeUnits:['กล่อง'],vendorBarcodes:[{vendor:'ผู้จำหน่าย',code:'VENDOR-A'}],dataReviewStatus:'pending',_revision:1}];
    inventoryBalanceRows=[{product_id:9101,warehouse_id:1,stock:25},{product_id:9101,warehouse_id:2,stock:5}];
    rebuildInventoryBalanceMap();rebuildProductLookupMaps();refreshCategoryBrandUnitLists();
    productDirtyOperations.clear();seedTableSnapshot('products',products,productMetadataToRow);
    window.remoteProducts=new Map(products.map(p=>[p.id,productMetadataToRow(p)]));
    window.writes=[];window.baseCalls=[];window.failWrites=false;
    window.notices=[];showToast=message=>window.notices.push(message);
    scheduleSupabaseCoreSync=()=>{};
    sb.from=table=>{
      let action='select',payload,columns='*',filters=[];
      const q={select(c='*'){columns=c;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},order(){return q;},limit(){return q;},range(){return q;},
        update(v){action='update';payload=v;return q;},insert(v){action='insert';payload=v;return q;},
        then(resolve,reject){return Promise.resolve().then(()=>{
          if(table!=='products')return {data:[],error:null};
          if(action!=='select'&&window.failWrites)return {data:null,error:{message:'Network test failure',code:'TEST_OFFLINE'}};
          if(action==='insert'){
            for(const row of payload){if(window.remoteProducts.has(row.id))return {error:{code:'23505',message:'duplicate'}};}
            for(const row of payload){window.remoteProducts.set(row.id,{...structuredClone(row),revision:1});window.writes.push({action,row:structuredClone(row)});}
            return {data:null,error:null};
          }
          const rows=[...window.remoteProducts.values()].filter(r=>filters.every(fn=>fn(r)));
          if(action==='update') rows.forEach(row=>{Object.assign(row,structuredClone(payload),{revision:row.revision+1});window.writes.push({action,row:structuredClone(row)});});
          return {data:rows.map(row=>columns==='*'?structuredClone(row):Object.fromEntries(columns.split(',').map(k=>[k,row[k]]))),error:null};
        }).then(resolve,reject);},async maybeSingle(){const r=await q;return {...r,data:r.data?.[0]||null};}};
      return q;
    };
    syncCoreDataToSupabase=async()=>syncProductsIncrementally();
    loadInventoryBalancesFromSupabase=async()=>true;
    runStockOperation=async(name,args)=>{
      window.baseCalls.push({name,args});
      const row=window.remoteProducts.get(args.productId);
      Object.assign(row,{unit:args.newUnit,price:args.price,cost:args.cost,data:structuredClone(args.productData),revision:row.revision+1});
      return {balances:inventoryBalanceRows.filter(b=>b.product_id===args.productId).map(b=>({warehouseId:b.warehouse_id,stock:b.stock*args.conversionFactor}))};
    };
    render();
  });
  await page.locator('#mobileNewProduct').click();
  await page.locator('#f_name').waitFor();
  assert.equal(await page.locator('#extraBarcodeRows,#vendorBarcodeRows,#deleteProductBtn').count(),0,'mobile omits extra/vendor barcode and delete controls');
  assert.equal(await page.locator('#f_stock').getAttribute('type'),'hidden','stock cannot be edited here');
  assert.equal(await page.locator('#topbarFormActions #saveProductBtn').count(),0,'save remains visible on mobile, not hidden desktop topbar');
  await page.locator('#f_name').fill('สินค้ามือถือใหม่');
  await page.locator('#f_unit').selectOption('กล่อง');
  await page.locator('#f_price').fill('125');
  await page.locator('#f_cost').fill('75');
  await page.locator('#f_barcode').fill('8850000000999');
  await page.locator('.switch:has(#f_multiunit)').click();
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  assert.equal(await page.locator('#f_name').inputValue(),'สินค้ามือถือใหม่','network rerender preserves draft');
  assert.equal(await page.locator('#f_multiunit').isChecked(),false,'network rerender preserves unchecked additional units');
  // All visible form controls fit narrow phone screens; actions have touch-sized targets.
  for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});
    const overflow=await page.locator('#mobileProductEditor').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,children:[...el.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().right>el.getBoundingClientRect().right+1).map(node=>({tag:node.tagName,id:node.id,cls:node.className,right:node.getBoundingClientRect().right}))}));
    if(process.env.PEPOS_TEST_SCREENSHOT)await page.screenshot({path:process.env.PEPOS_TEST_SCREENSHOT,fullPage:true});
    assert.ok(overflow.scroll<=overflow.width+1,`no overflow at ${width}px: ${JSON.stringify(overflow)}`);
    assert.ok((await page.locator('#saveProductBtn').boundingBox()).height>=44);
  }
  await page.locator('.switch:has(#f_multiunit)').click();
  await page.locator('#unitRows .u_sub').selectOption('ลัง');
  await page.locator('#unitRows .u_per').fill('12');
  await page.locator('#unitRows .u_price').fill('1300');
  await page.locator('#unitRows .u_cost').fill('800');
  await page.locator('#unitRows .u_barcode').fill('8850000000777');
  await page.locator('#addUnitBtn').click();
  assert.equal(await page.locator('#unitRows .mobile-unit-field').count(),6,'additional rows get mobile labels after refresh');
  await page.locator('#unitRows .u_del').last().click();
  assert.equal(await page.locator('#unitRows .u_sub').count(),1);
  assert.equal(await page.locator('#unitRows .u_price').inputValue(),'1300');
  await page.setViewportSize({width:320,height:844});
  assert.ok(await page.locator('#mobileProductEditor').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'additional unit cards fit a 320px screen');
  if(process.env.PEPOS_TEST_SCREENSHOT)await page.screenshot({path:process.env.PEPOS_TEST_SCREENSHOT.replace(/\.png$/,'-units.png'),fullPage:true});
  await page.locator('#saveProductBtn').click();
  await page.waitForFunction(()=>!mobileProductEditor&&productDirtyOperations.size===0);
  const created=await page.evaluate(()=>[...window.remoteProducts.values()].find(p=>p.name==='สินค้ามือถือใหม่'));
  assert.ok(created&&created.id&&created.sku);
  assert.equal(created.price,125);assert.equal(created.cost,75);
  assert.equal(created.data.barcode,'8850000000999');
  assert.equal(created.data.units[0].factor,12);assert.equal(created.data.units[0].barcode,'8850000000777');
  assert.equal(Object.hasOwn(created,'stock'),false,'create payload never includes opening stock');
  assert.equal(await page.evaluate(()=>window.writes.filter(w=>w.action==='insert').length),1);
  assert.ok(await page.evaluate(()=>window.notices.includes('บันทึกและซิงก์สินค้าแล้ว')));
  // Unknown scan -> create with prefilled barcode; cancel never writes anything.
  await page.locator('#mobilePriceInput').fill('8850000000888');
  await page.locator('#mobileCreateProductFromCode').click();
  assert.equal(await page.locator('#f_barcode').inputValue(),'8850000000888');
  await page.locator('#cancelProductBtn').click();
  assert.equal(await page.locator('#mobileProductEditor').count(),0);
  // Edit an existing product through the actual result button.
  await page.evaluate(()=>{mobileSelectPriceProduct(products.find(p=>p.id===9101));render();});
  await page.locator('#mobileEditProduct').click();
  await page.locator('#f_name').waitFor();
  assert.equal(await page.locator('#f_unit').isDisabled(),true);
  await page.locator('#f_name').fill('แก้ชื่อจากมือถือ');
  await page.locator('#f_price').fill('110');
  await page.locator('#f_barcode').fill('8850000000999');
  await page.locator('#saveProductBtn').click();
  assert.ok(await page.evaluate(()=>window.notices.at(-1).includes('สินค้าอื่นแล้ว')),'duplicate barcode blocked');
  await page.locator('#f_barcode').fill('8850000000001');
  await page.locator('#unitRows .u_price').fill('950');
  await page.locator('#saveProductBtn').click();
  await page.waitForFunction(()=>!mobileProductEditor&&productDirtyOperations.size===0);
  const updated=await page.evaluate(()=>window.remoteProducts.get(9101));
  assert.equal(updated.name,'แก้ชื่อจากมือถือ');assert.equal(updated.price,110);
  assert.deepEqual(updated.data.extraBarcodes,['OLD-A']);
  assert.deepEqual(updated.data.extraBarcodeUnits,['กล่อง']);
  assert.deepEqual(updated.data.vendorBarcodes,[{vendor:'ผู้จำหน่าย',code:'VENDOR-A'}]);
  assert.equal(updated.data.units[0].price,950);
  assert.equal(updated.data.dataReviewStatus,'pending');
  assert.equal(await page.evaluate(()=>warehouseStock(9101,1)),25,'catalog edit leaves stock unchanged');
  // Same row is shown correctly by desktop renderer (including hidden barcodes).
  const desktop=await page.evaluate(()=>{editingProductId=9101;return renderProductForm();});
  assert.ok(desktop.includes('แก้ชื่อจากมือถือ')&&desktop.includes('OLD-A')&&desktop.includes('VENDOR-A'));
  // Unsaved form cannot silently disappear on cancel or base-unit change.
  await page.locator('#mobileEditProduct').click();await page.locator('#f_name').waitFor();
  await page.locator('#f_name').fill('ยังไม่บันทึก');
  await page.evaluate(()=>{window.realMobileIsOnline=mobileIsOnline;mobileIsOnline=()=>false;});
  await page.locator('#saveProductBtn').click();
  assert.equal(await page.evaluate(()=>window.remoteProducts.get(9101).name),'แก้ชื่อจากมือถือ','offline cannot submit catalog edits');
  await page.evaluate(()=>{mobileIsOnline=window.realMobileIsOnline;});
  await page.locator('#changeBaseUnitBtn').click();
  assert.equal(await page.locator('#baseUnitChangeForm').count(),0);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#cancelProductBtn').click();
  assert.equal(await page.locator('#f_name').inputValue(),'ยังไม่บันทึก');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#cancelProductBtn').click();
  // Base-unit flow shares the existing conversion, confirmation and stock RPC.
  await page.locator('#mobileEditProduct').click();await page.locator('#f_name').waitFor();
  await page.evaluate(()=>{cart=[{pid:9101}];});
  await page.locator('#changeBaseUnitBtn').click();
  assert.equal(await page.locator('#baseUnitChangeForm').count(),0,'open-cart blocker is retained');
  await page.evaluate(()=>{cart=[];});
  await page.locator('#changeBaseUnitBtn').click();
  await page.locator('#baseUnitNewName').fill('เม็ด');
  await page.locator('#baseUnitConversion').fill('10');
  assert.ok((await page.locator('#baseUnitStockPreview').textContent()).includes('250 เม็ด'));
  assert.ok((await page.locator('#baseUnitStockPreview').textContent()).includes('50 เม็ด'));
  if(process.env.PEPOS_TEST_SCREENSHOT)await page.screenshot({path:process.env.PEPOS_TEST_SCREENSHOT,fullPage:true});
  page.once('dialog',dialog=>dialog.accept());await page.locator('#confirmBaseUnitChange').click();
  await page.waitForFunction(()=>!mobileProductEditor&&products.find(p=>p.id===9101).unit==='เม็ด');
  assert.equal(await page.evaluate(()=>window.baseCalls[0].name),'change_product_base_unit');
  assert.equal(await page.evaluate(()=>warehouseStock(9101,1)),250);
  const converted=await page.evaluate(()=>window.remoteProducts.get(9101));
  assert.equal(converted.data.units.find(u=>u.sub==='กล่อง').factor,10);
  assert.equal(converted.data.units.find(u=>u.sub==='ลัง').factor,100);
  assert.equal(await page.evaluate(()=>products.find(p=>p.id===9101)._revision),converted.revision);
  // Another device's concurrent metadata edit must not be overwritten.
  await page.locator('#mobileEditProduct').click();await page.locator('#f_name').waitFor();
  await page.locator('#f_price').fill('19');
  await page.evaluate(()=>{const row=window.remoteProducts.get(9101);row.name='แก้จากคอมอีกเครื่อง';row.revision++;});
  await page.locator('#saveProductBtn').click();
  await page.waitForFunction(()=>!mobileProductEditor&&mobileDataStatusState==='error');
  assert.equal(await page.evaluate(()=>window.remoteProducts.get(9101).name),'แก้จากคอมอีกเครื่อง');
  assert.equal(await page.evaluate(()=>productDirtyOperations.has('9101')),true);
  assert.equal(await page.locator('#mobileProductSyncDetails').count(),1);
  // New product with failed network keeps its id and creation token in durable recovery.
  await page.evaluate(()=>{window.failWrites=true;});
  await page.locator('#mobileNewProduct').click();await page.locator('#f_name').waitFor();
  await page.locator('#f_name').fill('สินค้าเครือข่ายหลุด');await page.locator('#f_unit').selectOption('กล่อง');await page.locator('#f_price').fill('99');
  await page.locator('#saveProductBtn').click();
  await page.waitForFunction(()=>!mobileProductEditor&&products.some(p=>p.name==='สินค้าเครือข่ายหลุด'));
  const queued=await page.evaluate(async()=>{const p=products.find(p=>p.name==='สินค้าเครือข่ายหลุด');const db=await openProductCacheDb();const tx=db.transaction(PRODUCT_CACHE_PRODUCTS_STORE,'readonly');const cached=await idbRequest(tx.objectStore(PRODUCT_CACHE_PRODUCTS_STORE).get(p.id));return {id:p.id,token:p._clientCreateToken,cachedToken:cached._clientCreateToken};});
  assert.ok(queued.token);assert.equal(queued.token,queued.cachedToken);
  await page.evaluate(async()=>{window.failWrites=false;await syncCoreDataToSupabase();});
  assert.equal(await page.evaluate(id=>window.remoteProducts.has(id),queued.id),true);
  assert.equal(await page.evaluate(id=>window.writes.filter(w=>w.action==='insert'&&w.row.id===id).length,queued.id),1);
  // Failed durable storage can be retried without allocating a second product or losing its SKU.
  await page.locator('#mobileNewProduct').click();await page.locator('#f_name').waitFor();
  await page.locator('#f_name').fill('สินค้าลองบันทึกอีกครั้ง');await page.locator('#f_unit').selectOption('กล่อง');await page.locator('#f_price').fill('45');
  await page.evaluate(()=>{window.realPersistProducts=persistProductChangesToIndexedDB;persistProductChangesToIndexedDB=async()=>false;});
  await page.locator('#saveProductBtn').click();
  await page.waitForFunction(()=>mobileProductEditor&&!mobileProductEditor.saving&&typeof editingProductId==='number');
  const retryId=await page.evaluate(()=>editingProductId);
  const retrySku=await page.locator('#f_sku').inputValue();
  assert.ok(retrySku);
  await page.evaluate(()=>{persistProductChangesToIndexedDB=window.realPersistProducts;});
  await page.locator('#saveProductBtn').click();
  await page.waitForFunction(id=>window.remoteProducts.has(id),retryId);
  assert.equal(await page.evaluate(id=>window.remoteProducts.get(id).sku,retryId),retrySku);
  assert.equal(await page.evaluate(()=>products.filter(p=>p.name==='สินค้าลองบันทึกอีกครั้ง').length),1);
  // Level 2 cannot expose or invoke the new catalog editor.
  await page.evaluate(()=>{currentProfile={id:'staff',owner:false,level:2};mobilePriceProductId=9101;render();});
  assert.equal(await page.locator('#mobileNewProduct,#mobileEditProduct').count(),0);
  await page.evaluate(()=>openMobileProductEditor());
  assert.equal(await page.locator('#mobileProductEditor').count(),0);
  assert.deepEqual(errors,[]);
  console.log('mobile product editor browser tests passed'+(process.env.PEPOS_TEST_BUILT==='1'?' (built)':''));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
});
