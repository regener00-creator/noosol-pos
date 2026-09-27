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
  browser=await chromium.launch({headless:true,executablePath,args:process.env.PEPOS_VERIFY_CDP?['--remote-debugging-port='+process.env.PEPOS_VERIFY_CDP]:[]});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const query=new Proxy({}, {get(t,p){if(p==='then')return resolve=>resolve({data:null,error:null});return ()=>query;}});
    window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get(t,p){return p in t?t[p]:()=>query;}})};
  });
  await page.route('https://**/*',route=>route.fulfill({body:'',contentType:'text/plain'}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof refreshUnusedProductUnitAccess==='function');
  await page.evaluate(()=>ensurePageCodeLoaded('products'));
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    renderLoginState=()=>true;renderSidebar=()=>{};
    currentProfile={id:'owner-test',owner:true,level:1,firstName:'Owner'};
    activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ'}];
    products=[{id:93001,name:'สินค้ายังไม่เคยใช้งาน',sku:'UNIT-TEST',category:'ยา',brand:'ทั่วไป',unit:'กล่อง',price:100,cost:60,stock:0,barcode:'UNUSED-BC',multiunit:true,units:[{sub:'ลัง',per:10,base:'กล่อง',factor:10,price:900,cost:600,barcode:'UNUSED-CASE'}],active:true,extraBarcodes:['UNUSED-EXTRA'],extraBarcodeUnits:['กล่อง'],vendorBarcodes:[],_revision:1}];
    inventoryBalanceRows=[];inventoryLotRows=[];cart=[];salesHistory=[];quotations=[];invoicesAR=[];creditNotes=[];purchaseOrders=[];goodsReceipts=[];productExchanges=[];productReturns=[];transfers=[];standaloneTaxInvoices=[];inspectionLists=[];promotions=[];
    productDirtyOperations.clear();coreSyncInFlight=false;
    units=['กล่อง','ลัง','Pcs'];refreshCategoryBrandUnitLists();
    rebuildProductLookupMaps();
    window.remote=productMetadataToRow(products[0]);window.saveCalls=[];window.toasts=[];
    showToast=m=>window.toasts.push(m);
    scheduleSupabaseCoreSync=()=>{};assertProductBarcodesAvailable=async()=>{};
    syncCoreDataToSupabase=async()=>true;
    sb.rpc=async(name,args)=>{
      if(name==='get_product_unit_edit_status'){
        if(window.statusFail)return {error:{message:'offline'}};
        return {data:{canEdit:!window.used,blockers:window.used?['ประวัติขาย']:[],unit:window.remote.unit,revision:window.remote.revision}};
      }
      if(name==='save_unused_product_unit'){
        window.saveCalls.push(structuredClone(args));
        if(window.holdSave)await new Promise(resolve=>window.releaseSave=resolve);
        if(window.used)return {error:{message:'มีประวัติ กรุณาใช้ปุ่มเปลี่ยนหน่วยหลัก'}};
        if(args.p_expected_revision!==window.remote.revision)return {error:{message:'REVISION_CONFLICT'}};
        window.remote={...args.p_record,revision:window.remote.revision+1};return {data:{product:window.remote}};
      }
      return {data:null,error:null};
    };
    window.openUnitForm=(mobile=false)=>{
      const p=products[0];editingProductId=p.id;currentTab=mobile?'mobiletools':'products';
      mobileProductEditor=mobile?{draft:structuredClone(p),baseline:mobileProductEditSignature(p),changed:false,saving:false}:null;
      document.getElementById('main').innerHTML=mobile?renderMobileTools():renderProductForm();attachEvents();
    };
    window.openUnitForm();
  });
  const unit=page.locator('#f_unit');
  await page.waitForFunction(()=>!document.getElementById('f_unit').disabled);
  assert.equal(await page.locator('#changeBaseUnitBtn').isVisible(),false,'unused products have one correction path, no competing conversion button');
  if(process.env.PEPOS_VERIFY_CDP){console.log('VERIFY_READY '+server.address().port);await page.waitForTimeout(60000);}
  await unit.selectOption('Pcs');
  await page.waitForFunction(()=>document.querySelector('#unitRows .u_base').value==='Pcs');
  assert.equal(await page.locator('#extraBarcodeRows .eb_unit').inputValue(),'Pcs');
  await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>editingProductId===null);
  const saved=await page.evaluate(()=>({p:products[0],remote:window.remote,pending:productDirtyOperations.size,calls:window.saveCalls.length}));
  assert.equal(saved.p.unit,'Pcs');assert.equal(saved.pending,0);assert.equal(saved.calls,1);
  assert.equal(saved.p.units[0].base,'Pcs');assert.equal(saved.p.units[0].factor,10);
  assert.deepEqual(saved.p.extraBarcodes,['UNUSED-EXTRA']);assert.deepEqual(saved.p.extraBarcodeUnits,['Pcs']);assert.equal(saved.p.barcode,'UNUSED-BC');
  assert.equal(saved.p.units.length,1,'must not manufacture an old-unit secondary row');
  // Remote history, stale revisions, offline checks and local pending work all fail closed.
  for(const mode of ['used','statusFail','stale','dirty','cart']){
    await page.evaluate(mode=>{
      window.used=mode==='used';window.statusFail=mode==='statusFail';
      window.remote.revision=mode==='stale'?99:products[0]._revision;
      productDirtyOperations.clear();if(mode==='dirty')productDirtyOperations.set('93001','update');
      cart=mode==='cart'?[{pid:93001}]:[];window.openUnitForm();
    },mode);
    await page.waitForFunction(()=>!document.getElementById('directUnitEditHint').textContent.includes('กำลังตรวจ'));
    assert.equal(await unit.isDisabled(),true,mode);assert.equal(await page.locator('#changeBaseUnitBtn').isVisible(),true,mode);
  }
  await page.evaluate(()=>{window.used=false;window.statusFail=false;cart=[];productDirtyOperations.clear();window.remote.revision=products[0]._revision;window.openUnitForm();});
  await page.waitForFunction(()=>!document.getElementById('f_unit').disabled);await unit.selectOption('กล่อง');
  await page.evaluate(()=>window.used=true);
  await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>!saveProduct.saving);
  assert.equal(await unit.inputValue(),'กล่อง','server rejection preserves the draft');
  assert.equal(await page.evaluate(()=>products[0].unit),'Pcs','server rejection never alters local product or queues a write');
  // The mobile draft retains extra barcodes, remapping only their base unit label.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{window.used=false;isMobileDeviceMode=()=>true;window.openUnitForm(true);});
  await page.waitForFunction(()=>!document.getElementById('f_unit').disabled);await unit.selectOption('กล่อง');
  await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>!mobileProductEditor);
  assert.equal(await page.evaluate(()=>products[0].unit),'กล่อง');
  assert.deepEqual(await page.evaluate(()=>products[0].extraBarcodeUnits),['กล่อง']);
  // A late successful response updates the correct product, never another form.
  await page.evaluate(()=>{window.openUnitForm();window.holdSave=true;});
  await page.waitForFunction(()=>!document.getElementById('f_unit').disabled);await unit.selectOption('Pcs');
  await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>typeof window.releaseSave==='function');
  await page.evaluate(()=>{editingProductId='new';document.getElementById('main').innerHTML='<input id="newDraft" value="preserve me">';window.releaseSave();});
  await page.waitForFunction(()=>!saveProduct.saving);
  assert.equal(await page.locator('#newDraft').inputValue(),'preserve me');assert.equal(await page.evaluate(()=>editingProductId),'new');
  assert.equal(await page.evaluate(()=>products[0].unit),'Pcs');
  assert.deepEqual(errors,[]);
  console.log('unused product unit browser tests passed (desktop/mobile, failure guards, barcode/secondary unit preservation, navigation)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
