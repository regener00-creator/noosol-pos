const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
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
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync)||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'}),errors=[];
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript({content:`(()=>{const query=new Proxy({}, {get(_target,key){return key==='then'?(resolve=>resolve({data:[],error:null})):(()=>query);}});window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get:(target,key)=>key in target?target[key]:(()=>query)})};})();`});
  await page.route('https://**',route=>route.fulfill({body:'',contentType:'text/javascript'}));
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    renderLoginState=()=>true;renderSidebar=()=>{};ensureOnDemandDataForTab=()=>({status:'ready'});
    isMobileDeviceMode=()=>false;canAccessTab=()=>true;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');document.getElementById('appRoot').hidden=false;
    currentProfile={id:'test',owner:true,level:1};activeWarehouseId=1;
    warehouses=[{id:1,name:'คลังต้นทาง'},{id:2,name:'คลังปลายทาง'}];
    products=[{id:1,name:'ไม่มีบาร์โค้ด',sku:'1',barcode:'',unit:'เม็ด',stock:10,units:[]},
      {id:2,name:'มีหน่วยว่าง',sku:'2',barcode:'002',unit:'กล่อง',stock:10,units:[{sub:'แผง',barcode:'',factor:10}]},
      {id:3,name:'สินค้าที่ต้องการ',sku:'3',barcode:'003',unit:'กล่อง',stock:10,units:[{sub:'แผง',barcode:'0031',factor:10}]}];
    rebuildProductLookupMaps();currentTab='transfer';editingTransferId='new';transferDraft=null;render();
  });
  assert.equal(await page.locator('#transferItemRows tr').count(),1);
  assert.equal(await page.locator('#printTransferFormBtn').count(),0);
  const boxes=await Promise.all(['#transfer_date','#transfer_from','#transfer_by','#transfer_to'].map(s=>page.locator(s).boundingBox()));
  assert.ok(Math.abs(boxes[0].y-boxes[1].y)<5&&boxes[1].x>boxes[0].x);
  assert.ok(Math.abs(boxes[2].y-boxes[3].y)<5&&boxes[3].x>boxes[2].x);
  await page.locator('#docProductScanner').fill('สินค้าที่ต้องการ');
  await page.locator('.doc-scan-result[data-pid="3"]').click();
  assert.deepEqual(await page.evaluate(()=>activeTransferDraft().items.filter(i=>i.productId).map(i=>i.productId)),[3]);
  // Reproduce the old three-row draft too: a UI default change alone is not a fix.
  await page.evaluate(()=>{activeTransferDraft().items=[blankTransferItem(),blankTransferItem(),blankTransferItem()];render();});
  await page.locator('#docProductScanner').fill('0031');await page.locator('#docProductScanner').press('Enter');
  assert.deepEqual(await page.evaluate(()=>activeTransferDraft().items.filter(i=>i.productId).map(i=>[i.productId,i.unit])),[[3,'แผง']]);
  await page.locator('#docProductScanner').fill('0031');await page.locator('#docProductScanner').press('Enter');
  assert.deepEqual(await page.evaluate(()=>activeTransferDraft().items.filter(i=>i.productId).map(i=>[i.productId,i.qty])),[[3,2]]);
  const activeInput=page.locator('.transfer-product').filter({visible:true}).first();
  await activeInput.fill('');await activeInput.press('Tab');
  assert.deepEqual(await page.evaluate(()=>activeTransferDraft().items.filter(i=>i.productId).map(i=>i.productId)),[]);
  await page.evaluate(()=>{transferDraft=null;render();});
  assert.equal(await page.locator('#transferItemRows tr').count(),1);
  fs.mkdirSync(path.join(root,'outputs'),{recursive:true});await page.screenshot({path:path.join(root,'outputs/transfer-form.png')});
  await page.evaluate(()=>{
    editingTransferId=null;transferDraft=null;
    transfers=[{id:'T1',date:'2026-09-14',from:'ต้นทาง',to:'ปลายทาง',items:[],stockApplied:false},
      {id:'T2',date:'2026-09-14',from:'ต้นทาง',to:'ปลายทาง',items:[],stockApplied:false},
      {id:'POSTED',date:'2026-09-14',from:'ต้นทาง',to:'ปลายทาง',items:[],stockApplied:true}];
    window.printed=[];printTransfer=id=>window.printed.push(id);
    saveTransfer=()=>{throw Error('printing must not save/post stock');};
    ensureWorkspaceRecoveryDurable=async()=>true;persistTransfers=()=>{};render();
  });
  assert.equal(await page.locator('[data-edit-transfer="T1"]').getAttribute('title'),'แก้ไข');
  assert.equal(await page.locator('[data-edit-transfer="T1"] + [data-print-transfer="T1"]').count(),1);
  await page.locator('[data-print-transfer="T1"]').click();assert.deepEqual(await page.evaluate(()=>window.printed),['T1']);
  assert.equal(await page.locator('#selectAllTransfers,[data-select-transfer],#deleteSelectedTransfersBtn').count(),0);
  assert.deepEqual(await page.locator('.transfer-summary-table thead th').allTextContents(),['เลขที่','วันที่','จากคลัง','ไปคลัง','รายการ','สถานะ','']);
  assert.equal(await page.locator('[data-cancel-transfer]').count(),2,'unposted transfers retain individual cancel actions');
  assert.equal(await page.locator('[data-cancel-transfer="POSTED"],[data-delete-transfer="POSTED"]').count(),0,'posted transfer cannot be cancelled or deleted');
  await page.screenshot({path:path.join(root,'outputs/transfer-list.png')});
  assert.equal(await page.locator('[data-delete-transfer]').count(),0,'only a cancelled unposted transfer may expose its individual delete button');
  for(const tab of ['purchaseorder','goodsreceipt','productreturn']){
    const count=await page.evaluate(tab=>{
      currentTab=tab;editingPOId=editingGRId=editingReturnId='new';poDraft=grDraft=returnDraft=null;render();return activePurchaseDraft().items.length;
    },tab);
    assert.equal(count,1,tab);
    assert.equal(await page.locator('#poItemRows tr').count(),1,tab+' rendered rows');
  }
  assert.equal(await page.evaluate(()=>{openNewQuotationForm();return taxInvoiceDraft.items.length;}),1);
  await page.evaluate(()=>{currentTab='productexchange';editingProductExchangeId='new';productExchangeDraft=null;render();});
  assert.equal(await page.locator('[data-product-exchange-add-first]').count(),0);
  await page.evaluate(()=>{
    const draft=activeProductExchangeDraft();draft.outgoingItems=[{pid:3,name:'สินค้าที่ต้องการ',qty:1,unit:'กล่อง'}];draft.incomingItems=[{pid:3,name:'สินค้าที่ต้องการ',qty:1,unit:'กล่อง'}];render();
  });
  assert.equal(await page.locator('.product-exchange-delete svg').count(),2);
  // Test generated rows directly too, independent of exchange draft field aliases.
  assert.equal(await page.evaluate(()=>productExchangeSectionHtml('outgoing','ส่ง','',[{pid:3,qty:1,unit:'กล่อง'}],false).includes('aria-label="ลบรายการสินค้า"><svg')),true);
  await page.screenshot({path:path.join(root,'outputs/exchange-controls.png')});
  assert.deepEqual(errors,[]);
  console.log('Transfer UI passed: form, printing, no bulk selection, posted deletion protection, exchange controls');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
