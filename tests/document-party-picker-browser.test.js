const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:950}});
  page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('purchaseorder');
    renderLoginState=()=>true;renderSidebar=()=>{};
    ensureOnDemandDataForTab=()=>({status:'ready'});
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    currentProfile={id:'test',owner:true,level:1};
    warehouses=[{id:1,name:'คลังทดสอบ'}];activeWarehouseId=1;products=[];
    contacts=[{id:1,name:'บริษัท ยาทดสอบ',code:'S001',types:['supplier'],phone:'0812345678',address:'ที่อยู่ทดสอบ'},{id:2,name:'ลูกค้าเท่านั้น',types:['customer']}];
    salesRepresentatives=[{id:3,name:'ผู้แทน PEPO',company:'บริษัท ทดสอบ',line:'pepo.line',phone:'0899999999'}];
  });
  for(const tab of ['purchaseorder','goodsreceipt','productreturn','productexchange']){
    await page.evaluate(tab=>{
      currentTab=tab;
      editingPOId='new';poDraft=null;editingGRId='new';grDraft=null;editingReturnId='new';returnDraft=null;
      editingProductExchangeId='new';productExchangeDraft=null;
      render();
    },tab);
    const field=tab==='productexchange'?'productExchangeSupplier':'po_supplier';
    const trigger=page.locator('[data-party-field="'+field+'"]');
    const note=page.locator(tab==='productexchange'?'#productExchangeNote':'#po_note');
    assert.equal(await note.count(),1,tab+': '+await page.locator('#main').innerText());
    await note.fill('เก็บหมายเหตุนี้');
    assert.equal(await page.locator('select#'+field).count(),0);
    await trigger.click();
    const search=page.getByRole('searchbox',{name:'ค้นหารายชื่อ'});
    assert.equal(await search.evaluate(el=>el===document.activeElement),true);
    await search.fill('ไม่มีรายชื่อนี้');
    assert.equal(await page.locator('.document-party-item').count(),0);
    await search.fill(tab==='purchaseorder'?'pepo.line':'081234');
    assert.equal(await page.locator('.document-party-item').count(),1);
    await page.locator('.document-party-item').click();
    const name=tab==='purchaseorder'?'ผู้แทน PEPO':'บริษัท ยาทดสอบ';
    assert.equal(await page.locator('#'+field).inputValue(),name);
    assert.equal(await note.inputValue(),'เก็บหมายเหตุนี้');
    await trigger.click();
    assert.equal(await page.locator('.document-party-item.selected').count(),1);
    await search.press('Escape');
    assert.equal(await page.locator('.document-party-overlay').count(),0);
    assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
    if(tab==='purchaseorder') assert.equal(await page.locator('#shortageManagedProductsBtn').isEnabled(),true);
    if(tab==='goodsreceipt'||tab==='productreturn'){
      assert.match(await page.locator('.po-head-left').innerText(),/ที่อยู่ทดสอบ/);
      assert.doesNotMatch(await page.locator('.po-head-left').innerText(),/ชื่อผู้จำหน่าย/);
    }
    await page.evaluate(()=>{if(currentTab==='productexchange')syncProductExchangeFromDOM();else syncPOFromDOM();});
    assert.equal(await page.evaluate(()=>currentTab==='productexchange'?productExchangeDraft.supplier:activePurchaseDraft().supplier),name);
  }
  await page.evaluate(()=>{productExchangeDraft.incomingApplied=true;render();});
  assert.equal(await page.locator('[data-party-field="productExchangeSupplier"]').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('Document party pickers passed: four forms, search, selection, draft retention, close/focus, locked exchange');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
