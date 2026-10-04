const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
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
  await installIsolatedBrowser(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await waitForIsolatedBootstrap(page);
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
      mobileProductEditor=mobile?{token:'test-unit-editor',draft:structuredClone(p),baseline:mobileProductEditSignature(p),changed:false,saving:false}:null;
      document.getElementById('main').innerHTML=mobile?renderMobileTools():renderProductForm();attachEvents();
    };
    window.openUnitForm();
  });
  // Additional-unit rows must be validated before unnamed rows are filtered out.
  for(const mobile of [false,true]){
    await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});
    // Settle the application's responsive transition before replacing its form.
    await page.waitForFunction(()=>isMobileDeviceMode()===document.body.classList.contains('mobile-device-mode'));
    for(const invalid of ['negative-price','negative-cost','duplicate-unit']){
      await page.evaluate(({mobile,invalid})=>{
        window.openUnitForm(mobile);window.toasts=[];window.preflights=0;
        assertProductBarcodesAvailable=async()=>{window.preflights++;throw new Error('TEST_PREFLIGHT');};
        if(invalid==='negative-price') document.getElementById('f_price').value='-1';
        if(invalid==='negative-cost') document.getElementById('f_cost').value='-1';
        if(invalid==='duplicate-unit') document.querySelector('#unitRows .u_sub').value='กล่อง';
      },{mobile,invalid});
      await page.locator('#saveProductBtn').click();
      assert.equal(await page.evaluate(()=>window.preflights),0,invalid+' rejected before any network/write');
      assert.ok(await page.evaluate(()=>window.toasts.length)>0);
      assert.equal(await page.evaluate(()=>productDirtyOperations.size),0);
    }
    for(const [field,value] of [['.u_per','12'],['.u_price','0'],['.u_cost','25'],['.u_barcode','DRAFT-BC']]){
      await page.evaluate(mobile=>{
        window.openUnitForm(mobile);
        document.getElementById('unitRows').innerHTML=unitRowHtml({},'กล่อง',[]);
        bindUnitRowEvents();window.toasts=[];window.preflights=0;
        assertProductBarcodesAvailable=async()=>{window.preflights++;throw new Error('TEST_PREFLIGHT');};
      },mobile);
      await page.locator('#unitRows '+field).fill(value);
      await page.evaluate(()=>refreshUnitRows());
      assert.equal(await page.locator('#unitRows '+field).inputValue(),value,'row refresh preserves explicit zero and incomplete input');
      await page.locator('#saveProductBtn').click();
      const context=JSON.stringify(await page.evaluate(({mobile,field})=>({mobile,field,toasts:window.toasts,focus:document.activeElement?.outerHTML,rows:collectUnitRowsFromDOM()}),{mobile,field}));
      assert.match(await page.evaluate(()=>window.toasts.at(-1)),/ระบุหน่วยเพิ่มเติมแถวที่ 1/,context);
      assert.equal(await page.locator('#unitRows '+field).inputValue(),value,'validation preserves the entered value');
      assert.equal(await page.locator('#unitRows .u_sub').evaluate(el=>el===document.activeElement),true,'focus the missing unit: '+context);
      assert.equal(await page.evaluate(()=>window.preflights),0,'invalid row must not reach any save preflight');
      assert.equal(await page.evaluate(()=>products[0].units[0].sub),'ลัง','invalid draft must not mutate stored data');
      assert.equal(await page.evaluate(()=>productDirtyOperations.size),0,'invalid draft must not queue a sync');
    }
    // A populated second row cannot hide behind a valid first row.
    await page.evaluate(mobile=>{
      window.openUnitForm(mobile);window.toasts=[];window.preflights=0;
      document.getElementById('unitRows').insertAdjacentHTML('beforeend',unitRowHtml({price:50},'กล่อง',['ลัง']));
      bindUnitRowEvents();
    },mobile);
    await page.locator('#saveProductBtn').click();
    assert.match(await page.evaluate(()=>window.toasts.at(-1)),/ระบุหน่วยเพิ่มเติมแถวที่ 2/);
    assert.equal(await page.evaluate(()=>window.preflights),0);
    await page.locator('#unitRows .u_sub').nth(1).selectOption('Pcs');
    await page.waitForFunction(()=>Array.from(document.querySelector('#unitRows .u_base').options).some(option=>option.value==='Pcs'));
    for(const quantity of ['', '0', '-1']){
      await page.locator('#unitRows .u_per').nth(1).fill(quantity);
      await page.locator('#saveProductBtn').click();
      assert.match(await page.evaluate(()=>window.toasts.at(-1)),mobile&&quantity==='-1'?/อัตราแปลงเป็นตัวเลขที่ถูกต้อง|จำนวนต่อหน่วย.*แถวที่ 2.*มากกว่า 0/:/จำนวนต่อหน่วย.*แถวที่ 2.*มากกว่า 0/);
      assert.equal(await page.locator('#unitRows .u_per').nth(1).evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.locator('#unitRows .u_per').nth(1).inputValue(),quantity,'quantity validation preserves the draft');
      assert.equal(await page.evaluate(()=>window.preflights),0,'invalid conversion quantity cannot reach save preflight');
      assert.equal(await page.evaluate(()=>products[0].units.length),1,'invalid second row never mutates the product');
      assert.equal(await page.evaluate(()=>productDirtyOperations.size),0);
    }
    await page.locator('#unitRows .u_per').nth(1).fill('12');
    await page.locator('#saveProductBtn').click();
    await page.waitForFunction(()=>!saveProduct.saving);
    assert.equal(await page.evaluate(()=>window.preflights),1,'selecting the missing unit allows save to proceed');
    // A completely empty placeholder is optional; deleting a partial row also unblocks save.
    await page.evaluate(mobile=>{
      window.openUnitForm(mobile);window.preflights=0;
      document.getElementById('unitRows').innerHTML=unitRowHtml({barcode:'REMOVE-ME'},'กล่อง',[]);bindUnitRowEvents();
    },mobile);
    await page.locator('#unitRows .u_del').click();
    await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>!saveProduct.saving);
    assert.equal(await page.evaluate(()=>window.preflights),1,'empty default row must not block save');
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.waitForFunction(()=>isMobileDeviceMode()===document.body.classList.contains('mobile-device-mode'));
  await page.evaluate(()=>{assertProductBarcodesAvailable=async()=>{};window.openUnitForm();});
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
