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
    if(tab==='productreturn') assert.equal(await page.locator('#editPOSupplierBtn').count(),0);
    if(tab==='goodsreceipt'||tab==='productreturn'){
      assert.match(await page.locator('.po-head-left').innerText(),/ที่อยู่ทดสอบ/);
      assert.doesNotMatch(await page.locator('.po-head-left').innerText(),/ชื่อผู้จำหน่าย/);
    }
    await page.evaluate(()=>{if(currentTab==='productexchange')syncProductExchangeFromDOM();else syncPOFromDOM();});
    assert.equal(await page.evaluate(()=>currentTab==='productexchange'?productExchangeDraft.supplier:activePurchaseDraft().supplier),name);
  }
  await page.evaluate(()=>{productExchangeDraft.incomingApplied=true;render();});
  assert.equal(await page.locator('[data-party-field="productExchangeSupplier"]').isDisabled(),true);
  await page.evaluate(()=>{
    contacts.push({id:3,name:'ลูกค้าเท่านั้น',code:'C0003',types:['customer'],entity:'individual',creditDays:14,line:'customer.line',address:'ที่อยู่ลูกค้า',taxId:'1234567890123',phone:'0891234567',email:'customer@example.com'});
    currentTab='quotation';editingQuotationId='new';
    taxInvoiceDraft={number:'QT-TEST',date:TODAY_STR,items:[],customerId:'',name:'',credit:0};
    render();
  });
  const customerTrigger=page.locator('[data-party-field="tax_customer_select"]');
  assert.equal(await page.locator('select#tax_customer_select').count(),0);
  await page.locator('#po_note').fill('หมายเหตุใบเสนอราคา');
  await customerTrigger.click();
  assert.equal(await page.locator('.document-party-item').count(),2,'only customer contacts are offered');
  const positions=await page.locator('.document-party-item').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().top));
  assert.equal(positions[0],positions[1],'two customers per row');
  await page.getByRole('searchbox',{name:'ค้นหารายชื่อ'}).fill('C0003');
  await page.locator('.document-party-item').click();
  assert.equal(await page.locator('#tax_customer_select').inputValue(),'3','same-name customers selected by ID');
  for(const [field,value] of Object.entries({name:'ลูกค้าเท่านั้น',address:'ที่อยู่ลูกค้า',taxid:'1234567890123',phone:'0891234567',email:'customer@example.com',line:'customer.line'})){
    assert.equal(await page.locator('#tax_form_customer_'+field).inputValue(),value);
  }
  assert.equal(await page.locator('#po_note').inputValue(),'หมายเหตุใบเสนอราคา');
  assert.equal(await page.locator('#po_credit').count(),1);
  assert.equal(await page.locator('#po_credit').inputValue(),'14');
  assert.equal(await page.locator('#tax_form_customer_branch').count(),0);
  assert.equal(await page.locator('#tax_form_customer_branch_no').count(),0);
  assert.equal(await page.locator('#addTaxCustomerBtn').count(),0);
  assert.equal(await page.locator('#quotation_customer_taxid_label').innerText(),'เลขบัตรประชาชน');
  await page.locator('input[name="quotation_customer_entity"][value="juristic"]').check();
  assert.equal(await page.locator('#quotation_customer_taxid_label').innerText(),'เลขผู้เสียภาษี');
  await page.locator('#addTaxInvoiceItemBtn').click();
  assert.equal(await page.locator('input[name="quotation_customer_entity"][value="juristic"]').isChecked(),true);
  assert.equal(await page.locator('#tax_form_customer_line').inputValue(),'customer.line');
  if(process.env.PEPOS_TEST_SCREENSHOT) await page.locator('.po-head').screenshot({path:process.env.PEPOS_TEST_SCREENSHOT});
  await customerTrigger.click();
  assert.equal(await page.locator('.document-party-item.selected').count(),1);
  await page.locator('[data-party-clear]').click();
  assert.equal(await page.locator('#tax_customer_select').inputValue(),'');
  assert.equal(await page.locator('#tax_form_customer_name').inputValue(),'');
  assert.equal(await page.locator('#po_note').inputValue(),'หมายเหตุใบเสนอราคา');
  // Save/reopen an individual without optional identity/address; keep the new snapshot fields.
  await page.evaluate(()=>{
    products=[{id:99,name:'สินค้าทดสอบ',price:10,unit:'ชิ้น'}];
    taxInvoiceDraft.items=[{name:'สินค้าทดสอบ',qty:1,unit:'ชิ้น',price:10}];
    persistQuotations=()=>{};
    render();
  });
  await page.locator('#tax_form_customer_name').fill('ลูกค้าทดสอบ');
  await page.locator('#tax_form_customer_line').fill('saved.line');
  await page.locator('#saveQuotationBtn').press('Enter');
  assert.equal(await page.evaluate(()=>quotations.find(q=>q.id==='QT-TEST')?.customerInfo.line),'saved.line');
  await page.evaluate(()=>openQuotationForm('QT-TEST'));
  assert.equal(await page.locator('#tax_form_customer_line').inputValue(),'saved.line');
  assert.equal(await page.locator('input[name="quotation_customer_entity"][value="individual"]').isChecked(),true);
  await page.evaluate(()=>{
    editingQuotationId=null;
    quotations=[{id:'QT202609120001',date:TODAY_STR,customer:'ลูกค้าชื่อยาว'.repeat(12),items:[{name:'LongProductName'.repeat(12),qty:1}],total:123456.78}];
    render();
  });
  await page.locator('.quotation-summary-table tbody .doc-check').check();
  assert.equal(await page.locator('#docBulkbar').isVisible(),true);
  assert.equal(await page.locator('#docBulkPrint').count(),0);
  assert.equal(await page.locator('[data-print-quotation]').count(),1,'per-document print stays available');
  for(const width of [1440,1280,1024]){
    await page.setViewportSize({width,height:950});
    const dimensions=await page.locator('.quotation-summary-table').evaluate(table=>{
      const host=table.parentElement;
      return {scroll:host.scrollWidth,client:host.clientWidth,right:table.getBoundingClientRect().right,viewport:innerWidth,buttons:[...table.querySelectorAll('.history-icon-btn')].map(button=>button.getBoundingClientRect().right)};
    });
    assert.ok(dimensions.scroll<=dimensions.client+1,JSON.stringify({width,...dimensions}));
    assert.ok(dimensions.right<=dimensions.viewport,JSON.stringify({width,...dimensions}));
    assert.ok(dimensions.buttons.every(right=>right<=dimensions.right),JSON.stringify({width,...dimensions}));
  }
  if(process.env.PEPOS_QUOTATION_LIST_SCREENSHOT) await page.locator('#main').screenshot({path:process.env.PEPOS_QUOTATION_LIST_SCREENSHOT});
  assert.deepEqual(errors,[]);
  console.log('Document party pickers passed: five forms, customer details, two columns, search, selection, draft retention, close/focus, locked exchange, no return editor');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
