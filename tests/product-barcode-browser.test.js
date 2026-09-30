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
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream')+'; charset=utf-8'});fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath,args:process.env.PEPOS_VERIFY_CDP?['--remote-debugging-port='+process.env.PEPOS_VERIFY_CDP]:[]});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await installIsolatedBrowser(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());document.getElementById('appRoot').hidden=false;
    renderLoginState=()=>true;currentProfile={id:'test-owner',owner:true,level:1,firstName:'Owner'};
    currentTab='products';activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ'}];
    products=[{id:1,sku:'P1',name:'สินค้าที่มีบาร์โค้ดแล้ว',category:'ยา',brand:'ทั่วไป',unit:'กล่อง',price:100,cost:50,barcode:'MAIN',units:[{sub:'ลัง',per:10,base:'กล่อง',factor:10,price:1000,barcode:'CASE'}],extraBarcodes:['EXTRA'],vendorBarcodes:[{code:'VENDOR'}],active:false}];
    window.notices=[];window.preflightCalls=0;window.failPreflight=false;window.delayPreflight=false;window.persistCalls=0;
    showToast=message=>window.notices.push(message);scheduleSupabaseCoreSync=()=>{};
    persistWorkspaceData=async()=>{window.persistCalls++;return true;};
    sb.rpc=async(name,args)=>{
      if(name!=='find_product_barcode_owners')return {data:[],error:null};
      window.preflightCalls++;
      if(window.delayPreflight)await new Promise(resolve=>window.resolvePreflight=resolve);
      if(window.failPreflight)return {error:{message:'test offline'}};
      return {data:args.p_codes.includes('remote')?[{barcode:'remote',product_id:2,name:'สินค้าจากอีกเครื่อง',sku:'P2'}]:[],error:null};
    };
    rebuildProductLookupMaps();refreshCategoryBrandUnitLists();editingProductId='new';render();
  });
  await page.locator('#f_name').fill('สินค้าใหม่');await page.locator('#f_unit').selectOption('กล่อง');await page.locator('#f_price').fill('120');
  for(const code of ['MAIN','CASE','EXTRA','VENDOR','REMOTE']){
    await page.locator('#f_barcode').fill(code);await page.locator('#saveProductBtn').click();
    await page.waitForFunction(()=>!saveProduct.saving);
    assert.equal(await page.evaluate(()=>products.length),1,`${code}: no duplicate local product`);
    assert.match(await page.evaluate(()=>notices.at(-1)),/มีอยู่ในสินค้าอื่นแล้ว/);
    assert.equal(await page.locator('#f_barcode').inputValue(),code,'failed save retains editable draft');
  }
  // The main/additional-unit duplicate in the reported screenshot must fail on
  // create and edit, including when both codes already exist on the stored row.
  for(const mode of ['new','edit','mobile']){
    await page.setViewportSize(mode==='mobile'?{width:390,height:844}:{width:1440,height:1000});
    await page.evaluate(mode=>{
      const product=products[0];
      editingProductId=mode==='new'?'new':product.id;
      currentTab=mode==='mobile'?'mobiletools':'products';
      mobileProductEditor=mode==='mobile'?{draft:structuredClone(product),baseline:mobileProductEditSignature(product),changed:false,saving:false}:null;
      render();
    },mode);
    await page.locator('#f_name').fill('ตรวจบาร์โค้ดซ้ำ');await page.locator('#f_price').fill('100');
    if(mode==='new')await page.locator('#f_unit').selectOption('กล่อง');
    if(!await page.locator('#f_multiunit').isChecked())await page.locator('label').filter({has:page.locator('#f_multiunit')}).click();
    await page.locator('#unitRows .u_sub').selectOption('ลัง');
    await page.waitForFunction(()=>document.querySelector('#unitRows .u_sub').value==='ลัง');
    await page.locator('#unitRows .u_per').fill('10');await page.locator('#unitRows .u_price').fill('1000');
    await page.locator('#f_barcode').fill('8850239004056');
    await page.locator('#unitRows .u_barcode').fill('8850239004056');
    const calls=await page.evaluate(()=>window.preflightCalls);
    await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>!saveProduct.saving);
    assert.match(await page.evaluate(()=>notices.at(-1)),/8850239004056.*หน่วยหลัก.*หน่วยเพิ่มเติม/);
    assert.equal(await page.evaluate(()=>window.preflightCalls),calls,'duplicate never reaches server preflight');
    assert.equal(await page.evaluate(()=>persistCalls),0);
    assert.equal(await page.locator('#unitRows .u_barcode').inputValue(),'8850239004056');
    assert.equal(await page.evaluate(()=>products[0].barcode),'MAIN','stored product must remain unchanged');
    if(mode==='edit'&&process.env.PEPOS_VERIFY_CDP){console.log('VERIFY_READY '+server.address().port);await page.waitForTimeout(60000);}
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{mobileProductEditor=null;currentTab='products';editingProductId='new';render();});
  await page.locator('#f_name').fill('สินค้าใหม่');await page.locator('#f_unit').selectOption('กล่อง');await page.locator('#f_price').fill('120');
  await page.evaluate(()=>window.failPreflight=true);
  await page.locator('#f_barcode').fill('NEW');await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>!saveProduct.saving);
  assert.match(await page.evaluate(()=>notices.at(-1)),/ยังไม่ได้บันทึก/);assert.equal(await page.evaluate(()=>persistCalls),0);
  // Cancel while a request is pending must not save the old form into a new one.
  await page.evaluate(()=>{window.failPreflight=false;window.delayPreflight=true;});
  await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>!!window.resolvePreflight);
  await page.locator('#cancelProductBtn').click();await page.evaluate(()=>window.resolvePreflight());await page.waitForFunction(()=>!saveProduct.saving);
  assert.equal(await page.evaluate(()=>products.length),1);assert.equal(await page.evaluate(()=>persistCalls),0);
  await page.evaluate(()=>{window.delayPreflight=false;editingProductId='new';render();});
  await page.locator('#f_name').fill('สินค้าไม่ซ้ำ');await page.locator('#f_unit').selectOption('กล่อง');await page.locator('#f_price').fill('120');await page.locator('#f_barcode').fill('UNIQUE');
  await page.locator('#unitRows .u_sub').selectOption('ลัง');
  await page.waitForFunction(()=>document.querySelector('#unitRows .u_sub').value==='ลัง');
  await page.locator('#unitRows .u_per').fill('10');await page.locator('#unitRows .u_price').fill('1000');
  await page.locator('#unitRows .u_barcode').fill('UNIQUE');
  await page.locator('#saveProductBtn').click();
  assert.equal(await page.evaluate(()=>persistCalls),0);
  await page.locator('#unitRows .u_barcode').fill('');
  await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>!saveProduct.saving);
  assert.equal(await page.evaluate(()=>products.length),2);assert.equal(await page.evaluate(()=>persistCalls),1);
  assert.equal(await page.evaluate(()=>products.find(p=>p.barcode==='UNIQUE').units[0].sub),'ลัง','clearing just the duplicate preserves the additional unit');
  // Exercise the real import parser, with file decoding stubbed and no production access.
  await page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/excel-tools.js`});
  await page.evaluate(()=>{
    ensureXlsxLoaded=async()=>{};loadWarehouseInventoryFromSupabase=async()=>true;
    window.importRows=[];window.importAlerts=[];window.confirmCalls=0;
    window.XLSX={read:()=>({SheetNames:['Products'],Sheets:{Products:{}}}),utils:{sheet_to_json:()=>window.importRows}};
    window.alert=message=>window.importAlerts.push(message);window.confirm=()=>{window.confirmCalls++;return false;};
  });
  for(const code of ['MAIN','CASE','EXTRA','VENDOR','REMOTE']){
    await page.evaluate(async barcode=>{window.importRows=[{'ชื่อสินค้า':'Excel duplicate','หน่วยหลัก':'กล่อง','ราคาขาย':100,'บาร์โค้ดหลัก':barcode}];await importProductsFromExcel({arrayBuffer:async()=>new ArrayBuffer(0)});},code);
    assert.equal(await page.evaluate(()=>products.length),2);assert.equal(await page.evaluate(()=>confirmCalls),0);
    assert.match(await page.evaluate(()=>importAlerts.at(-1)),/ไม่สามารถนำเข้า/);
  }
  assert.deepEqual(errors,[]);console.log('Product barcode browser: all barcode sources, stale cache, failed check, cancel, valid save and import passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
