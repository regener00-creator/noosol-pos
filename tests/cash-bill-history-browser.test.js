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
  await installIsolatedBrowser(page);
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await waitForIsolatedBootstrap(page);
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('cashbill');
    renderLoginState=()=>true;renderSidebar=()=>{};
    ensureOnDemandDataForTab=()=>({status:'ready'});
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    currentProfile={id:'test',owner:true,level:1};
    warehouses=[{id:1,name:'คลังทดสอบ'}];activeWarehouseId=1;products=[];
    salesHistory=[{id:'sale-test',ref:'RE-TEST-001',date:currentDateStr(),status:'done',total:100,items:[],warehouseId:1}];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedBill=value;},readText:async()=>window.copiedBill}});
    currentTab='cashbill';cashBillLookupOpen=false;render();
  });
  await page.evaluate(()=>{
    window.originalBillRpc=sb.rpc;
    window.billWrites=[];
    window.failSecondBill=true;
    for(let i=1;i<=12;i++){
      salesHistory.push({...salesHistory[0],id:'bill-'+i,warehouseId:i===12?2:1,
        cashReceiptA4Meta:{number:'CB-'+i},fullTaxInvoice:{number:'INV-'+i}});
    }
    sb.rpc=async(name,args)=>{
      window.billWrites.push({name,...args});
      if(args.p_sale_id==='bill-2'&&window.failSecondBill)return {error:new Error('test failure')};
      return {data:{sale:args.p_metadata}};
    };
    render();
  });
  const allBills=page.getByRole('checkbox',{name:'เลือกบิลเงินสดทั้งหมดในหน้านี้'});
  await page.evaluate(()=>{
    const items=Array.from({length:9},(_,i)=>({name:'รายการ '+(i+1),qty:1}));
    salesHistory.find(s=>s.id==='bill-1').items=items;
    salesHistory.find(s=>s.id==='bill-2').items=items.slice(0,4);
    render();
  });
  const billItems=id=>page.locator('tr').filter({has:page.locator('[data-cashbill-edit="bill-'+id+'"]')}).locator('.doc-items-cell');
  assert.equal(await billItems(2).locator('summary').count(),0);
  assert.doesNotMatch(await billItems(1).innerText(),/รายการ 5/);
  await billItems(1).getByText('+5',{exact:true}).click();
  assert.match(await billItems(1).innerText(),/รายการ 9 ×1/);
  await billItems(1).locator('summary').press('Enter');
  assert.doesNotMatch(await billItems(1).innerText(),/รายการ 9/);
  assert.equal(await page.locator('.doc-check:checked').count(),0);
  await allBills.check();
  assert.equal(await page.locator('#docSelectedCount').innerText(),'10');
  await page.locator('#docSelectedClear').click();
  const selectBill=n=>page.getByRole('checkbox',{name:'เลือกบิลเงินสด CB-'+n,exact:true});
  await selectBill(1).check();
  await selectBill(2).check();
  assert.ok(await allBills.evaluate(el=>el.indeterminate));
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('#docBulkDelete').click();
  assert.equal(await page.evaluate(()=>window.billWrites.length),0);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#docBulkDelete').click();
  await page.getByText('ลบสำเร็จ 1 จาก 2 รายการ กรุณาตรวจรายการที่เหลือ',{exact:true}).waitFor();
  assert.equal(await selectBill(1).count(),0);
  await page.evaluate(()=>{window.failSecondBill=false;});
  await selectBill(2).check();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#docBulkDelete').click();
  await selectBill(2).waitFor({state:'detached'});
  const result=await page.evaluate(()=>({
    writes:window.billWrites,
    documents:salesHistory.slice(1).map(s=>[s.id,s.cashReceiptA4Meta?.number||null,s.fullTaxInvoice.number,s.total,s.status])
  }));
  assert.deepEqual(result.writes,[1,2,2].map(n=>({name:'update_sale_document_metadata',p_sale_id:'bill-'+n,p_metadata:{cashReceiptA4Meta:null}})));
  assert.deepEqual(result.documents,Array.from({length:12},(_,i)=>['bill-'+(i+1),i<2?null:'CB-'+(i+1),'INV-'+(i+1),100,'done']));
  await page.evaluate(()=>{
    salesHistory=salesHistory.filter(s=>s.id==='sale-test');
    sb.rpc=window.originalBillRpc;
    currentTab='history';
    render();
  });
  await page.locator('[data-sale-view="sale-test"]').click();
  await page.getByRole('button',{name:'ออกบิลเงินสด A4'}).click();
  assert.ok(await page.locator('#a4CashReceiptForm').isVisible());
  await page.locator('#closeA4CashReceiptBtn').click();
  await page.evaluate(()=>{salesHistory[0].cashReceiptA4Meta={number:'CB-EXISTING',customer:{name:'ผู้ซื้อเดิม'}};});
  await page.locator('[data-sale-view="sale-test"]').click();
  await page.getByRole('button',{name:'เปิดบิลเงินสด A4'}).click();
  assert.equal(await page.locator('#a4_receipt_customer_name').inputValue(),'ผู้ซื้อเดิม');
  assert.match(await page.locator('.modal-head:visible').last().innerText(),/CB-EXISTING/);
  async function checkDocumentPreview(preview,number){
    const meta=preview.locator('.docmeta span').nth(1);
    await meta.waitFor();
    for(const media of ['screen','print']){
      await preview.emulateMedia({media});
      assert.equal(await meta.innerText(),number);
      assert.doesNotMatch(await preview.locator('body').innerText(),/ต้นฉบับ|สำเนา/);
    }
  }
  async function checkTwoPrints(button,number){
    for(let i=0;i<2;i++){
      const popup=page.waitForEvent('popup');
      await button.click();
      const preview=await popup;
      await checkDocumentPreview(preview,number);
      await preview.close();
    }
  }
  await page.evaluate(()=>{sb.rpc=async(name,args)=>({data:args.p_metadata});});
  await checkTwoPrints(page.locator('#a4CashReceiptForm button[type=submit]'),'CB-EXISTING');
  await page.locator('#closeA4CashReceiptBtn').click();
  await page.evaluate(()=>{
    delete salesHistory[0].cashReceiptA4Meta;
    const items=Array.from({length:9},(_,i)=>({name:'สินค้า '+(i+1),qty:1,price:20}));
    quotations=[{id:'QT',warehouseId:1,items,date:TODAY_STR}];
    standaloneTaxInvoices=[{number:'INV',warehouseId:1,items,date:TODAY_STR}];
    currentTab='quotation';render();
  });
  for(const tab of ['quotation','taxinvoice']){
    await page.evaluate(tab=>{currentTab=tab;render();},tab);
    const cell=page.locator('.doc-items-cell').first();
    assert.doesNotMatch(await cell.innerText(),/สินค้า 5/);
    await cell.getByText('+5',{exact:true}).click();
    assert.match(await cell.innerText(),/สินค้า 9/);
    await cell.locator('summary').press('Enter');
    assert.doesNotMatch(await cell.innerText(),/สินค้า 9/);
    if(tab==='quotation'){
      await checkTwoPrints(page.locator('[data-print-quotation="QT"]'),'QT');
    }else{
      await checkTwoPrints(page.locator('[data-print-tax="INV"]'),'INV');
      await page.evaluate(()=>{
        salesHistory[0].fullTaxInvoice={number:'INV-HISTORY',saleDate:TODAY_STR,customer:{name:'QA'}};
        render();
      });
      await checkTwoPrints(page.locator('[data-print-tax="sale-test"]'),'INV-HISTORY');
      await page.evaluate(()=>{delete salesHistory[0].fullTaxInvoice;sb.rpc=window.originalBillRpc;});
    }
  }
  const printState=await page.evaluate(()=>({sales:salesHistory,warehouses,tab:currentTab}));
  await page.evaluate(()=>{
    const open=window.open.bind(window);
    window.nativePopupOpen=open;
    window.open=(...args)=>{const win=open(...args);win.print=()=>{};return win;};
    warehouses=[{id:1,name:'A'},{id:2,name:'B'}];
    window.persistTaxDocs=persistStandaloneTaxInvoices;
    persistStandaloneTaxInvoices=()=>{};
    sb.rpc=async(name,args)=>{
      if(name!=='update_sale_document_metadata')return {data:null};
      const sale=salesHistory.find(s=>s.id===args.p_sale_id&&documentInActiveStore(s));
      const [key,payload]=Object.entries(args.p_metadata)[0],saved=sale[key];
      const log=[...(saved?.printLog||[])];
      if(payload.printEvent)log.push(payload.printEvent);
      return {data:{[key]:{...(payload.printEvent?saved:payload),printLog:log}}};
    };
  });
  for(const store of [1,2]){
    await page.evaluate(w=>{
      activeWarehouseId=w;storeViewGeneration++;
      const items=[{name:'สินค้า VAT',qty:2,unit:'ชิ้น',price:100,vatMode:'excl'}];
      const invoice={number:'TAX-'+w,date:TODAY_STR,warehouseId:w,customer:{name:'QA'},items,total:214,printLog:[]};
      standaloneTaxInvoices=[invoice];
      salesHistory=[{id:'sale-'+w,warehouseId:w,date:TODAY_STR,status:'done',vatRegistered:true,total:214,items,
        fullTaxInvoice:{...invoice,number:'TAX-POS-'+w,printLog:[]},
        cashReceiptA4Meta:{number:'CB-'+w,customer:{name:'QA'},printLog:[]}}];
      businessSettings={...businessSettings,vat:VAT_REGISTERED_LABEL,vatRegistrationDate:''};
      currentTab='taxinvoice';editingTaxInvoiceSaleId=null;render();
    },store);
    for(const [i,id] of ['TAX-'+store,'sale-'+store].entries()){
      const openPreview=async()=>{
        const popup=page.waitForEvent('popup');
        await page.locator('[data-print-tax="'+id+'"]').click();
        return popup;
      };
      const getCount=()=>page.evaluate(index=>(index?salesHistory[0].fullTaxInvoice:standaloneTaxInvoices[0]).printLog.length,i);
      const closed=await openPreview();
      await closed.locator('#closeTaxPreview').click();
      assert.equal(await getCount(),0);
      const preview=await openPreview();
      const cells=await preview.locator('.items tbody tr').first().locator('td').allTextContents();
      assert.deepEqual(cells.slice(-2),['107.00','214.00']);
      for(const count of [1,2]){
        await preview.locator('#confirmTaxPrint').click();
        assert.equal(await getCount(),count);
      }
      await preview.close();
    }
    await page.evaluate(()=>{currentTab='cashbill';render();});
    await page.locator('[data-cashbill-edit="sale-'+store+'"]').click();
    for(const count of [1,2]){
      const popup=page.waitForEvent('popup');
      await page.locator('#a4CashReceiptForm button[type=submit]').click();
      const preview=await popup;
      await checkDocumentPreview(preview,'CB-'+store);
      await page.waitForFunction(n=>salesHistory[0].cashReceiptA4Meta.printLog.length===n,count);
      await preview.close();
    }
    await page.locator('#closeA4CashReceiptBtn').click();
  }
  await page.evaluate(state=>{
    window.open=window.nativePopupOpen;
    sb.rpc=window.originalBillRpc;
    persistStandaloneTaxInvoices=window.persistTaxDocs;
    activeWarehouseId=1;storeViewGeneration++;warehouses=state.warehouses;salesHistory=state.sales;
  },printState);
  await page.evaluate(()=>{
    standaloneTaxInvoices=[];
    currentTab='cashbill';
    window.manualRows=[];
    const orig=sb.from;
    sb.from=table=>{
      if(table!=='standalone_cash_bills')return orig(table);
      let op='list',payload,filters=[];
      const query={
        insert(data){op='insert';payload=data;return this;},update(data){op='update';payload=data;return this;},delete(){op='delete';return this;},
        select(){return this;},order(){return this;},eq(key,value){filters.push([key,value]);return this;},
        range(a,b){const rows=window.manualRows.filter(row=>filters.every(([k,v])=>row[k]===v));return {data:rows.slice(a,b+1),count:rows.length};},
        single(){
          if(op==='insert'){const row={...payload,number:'ACB-TEST',printed:false,issued_at:new Date().toISOString()};window.manualRows.push(row);return {data:row};}
          const row=window.manualRows.find(row=>filters.every(([k,v])=>row[k]===v));
          if(op==='delete')window.manualRows=window.manualRows.filter(r=>r!==row);
          if(op==='update'&&row)Object.assign(row,payload);
          return {data:row};
        },maybeSingle(){return this.single();}
      };return query;
    };
    render();
  });
  await page.locator('#newCashBillBtn').click();
  await page.locator('#addTaxCustomerBtn').click();
  await page.locator('#tax_form_customer_name').fill('ผู้ซื้อบิลกรอกเอง');
  await page.locator('#tax_form_customer_phone').fill('0999999999');
  await page.locator('#tax_customer_select').selectOption({label:'ลูกค้าทั่วไป'});
  assert.equal(await page.locator('#saveTaxCustomerBtn').count(),0);
  assert.equal(await page.locator('#tax_form_customer_phone').inputValue(),'');
  const contactCount=await page.evaluate(()=>customersList().length);
  await page.locator('.poi_name').first().fill('สินค้าทดสอบ');
  await page.locator('.poi_qty').first().fill('2');
  await page.locator('.poi_price').first().fill('15');
  await page.locator('#po_discount').fill('5');
  await page.locator('#saveStandaloneTaxInvoiceBtn').click();
  const manualRow=page.locator('tr').filter({hasText:'ACB-TEST'});
  await manualRow.locator('[data-cashbill-edit]').click();
  assert.equal(await page.locator('#tax_form_customer_name').inputValue(),'ลูกค้าทั่วไป');
  assert.equal(await page.locator('#tax_customer_select').inputValue(),'walk-in');
  assert.equal(await page.evaluate(()=>customersList().length),contactCount);
  assert.equal(await page.locator('.po-total-amt').innerText(),'25.00');
  const popup=page.waitForEvent('popup');
  await page.locator('#printStandaloneTaxInvoiceBtn').click();
  const preview=await popup;
  await checkDocumentPreview(preview,'ACB-TEST');
  assert.match(await preview.locator('.items').innerText(),/สินค้าทดสอบ/);
  assert.equal(await preview.locator('.customer-name').innerText(),'ผู้ซื้อ: ลูกค้าทั่วไป');
  await preview.close();
  const secondPopup=page.waitForEvent('popup');
  await page.locator('#printStandaloneTaxInvoiceBtn').click();
  const copy=await secondPopup;
  await checkDocumentPreview(copy,'ACB-TEST');
  await copy.close();
  await page.locator('#cancelTaxInvoiceFormBtn').click();
  await manualRow.locator('.doc-check').check();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#docBulkDelete').click();
  await manualRow.waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>[window.manualRows.length,salesHistory.length,standaloneTaxInvoices.length]),[0,1,0]);
  const actionGap=async id=>page.locator('#'+id).evaluate(btn=>Math.round(btn.nextElementSibling.getBoundingClientRect().left-btn.getBoundingClientRect().right));
  const cashGap=await actionGap('historicalCashBillBtn');
  assert.equal(cashGap,8);
  await page.locator('#historicalCashBillBtn').click();
  assert.deepEqual(await page.locator('.cash-bill-lookup button strong').allTextContents(),['ค้นหาออเดอร์','วางเลขที่บิล','ดำเนินการต่อ']);
  const tiles=await page.locator('.cash-bill-lookup-actions > *').evaluateAll(els=>els.map(el=>[el.offsetWidth,el.offsetHeight]));
  assert.deepEqual(tiles,[tiles[0],tiles[0],tiles[0]]);
  assert.equal(await page.getByRole('button',{name:'ค้นหาออเดอร์'}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  await page.locator('#cash_bill_order_number').fill('keep-draft');
  await page.locator('#searchCashBillOrderBtn').click();
  assert.equal(await page.locator('.pos-sales-history-modal').count(),1);
  await page.evaluate(()=>{
    salesHistory[0].items=Array.from({length:4},(_,i)=>({name:'สินค้า '+(i+1),qty:1,price:10,unit:'ชิ้น'}));
    render();
  });
  const itemsCell=page.locator('.history-items-cell');
  assert.equal(await itemsCell.getByRole('button').count(),0);
  await page.evaluate(()=>{salesHistory[0].items.push(...['สินค้า 5','สินค้า 6','สินค้าชิ้นสุดท้าย'].map(name=>({name,qty:2,price:30,unit:'ชิ้น'})));render();});
  assert.match(await itemsCell.innerText(),/สินค้า 4/);
  assert.doesNotMatch(await itemsCell.innerText(),/สินค้าชิ้นสุดท้าย/);
  assert.match(await itemsCell.innerText(),/สินค้า 4 ×1\s+\+3$/);
  await itemsCell.locator('summary').click();
  assert.ok(await itemsCell.locator('details').evaluate(el=>el.open));
  assert.match(await itemsCell.innerText(),/สินค้าชิ้นสุดท้าย/);
  assert.equal(await page.locator('.sale-detail-modal').count(),0);
  await itemsCell.locator('summary').press('Enter');
  assert.ok(await itemsCell.locator('details').evaluate(el=>!el.open));
  await page.locator('.history-icon-btn[data-sale-view]').click();
  const details=page.locator('.sale-detail-modal');
  assert.equal(await details.locator('.sale-detail-table tbody tr').count(),7);
  assert.match(await details.innerText(),/สินค้าชิ้นสุดท้าย/);
  await details.locator('#closeSaleDetailBtn').click();
  assert.equal(await page.locator('.pos-sales-history-modal').count(),1);
  assert.equal(await page.evaluate(()=>currentTab),'cashbill');
  await page.locator('#closePOSSalesHistoryBtn').click();
  assert.equal(await page.locator('#cash_bill_order_number').inputValue(),'keep-draft');
  await page.locator('#searchCashBillOrderBtn').click();
  assert.equal(await page.locator('#closePOSSalesHistoryBottomBtn').count(),0);
  await page.locator('[data-pick-order-number="RE-TEST-001"] td').first().click();
  assert.equal(await page.locator('.pos-sales-history-modal').count(),0);
  assert.equal(await page.evaluate(()=>window.copiedBill),undefined);
  assert.equal(await page.locator('#cash_bill_order_number').inputValue(),'RE-TEST-001');
  await page.locator('#searchCashBillOrderBtn').click();
  await page.getByRole('button',{name:'เลือกบิล RE-TEST-001'}).press('Enter');
  assert.equal(await page.locator('.pos-sales-history-modal').count(),0);
  await page.locator('#cash_bill_order_number').fill('');
  await page.evaluate(()=>{window.copiedBill='RE-TEST-001';});
  await page.locator('#pasteCashBillNumberBtn').click();
  assert.equal(await page.locator('#cash_bill_order_number').inputValue(),'RE-TEST-001');
  await page.evaluate(()=>{
    findSaleByIdentifier=async query=>salesHistory.find(s=>s.ref===query);
    openA4CashReceiptModal=id=>{window.openedCashBill=id;};
  });
  await page.locator('#continueCashBillOrderBtn').click();
  assert.equal(await page.evaluate(()=>window.openedCashBill),'sale-test');
  await page.evaluate(()=>{
    businessSettings={...businessSettings,vat:VAT_REGISTERED_LABEL,vatRegistrationDate:''};
    salesHistory[0].vatRegistered=true;
    currentTab='taxinvoice';editingTaxInvoiceSaleId=null;render();
  });
  assert.equal(await actionGap('historicalTaxInvoiceBtn'),cashGap);
  await page.locator('#historicalTaxInvoiceBtn').click();
  assert.equal(await page.getByRole('button',{name:'ค้นหาออเดอร์'}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  assert.deepEqual(await page.locator('.cash-bill-lookup button strong').allTextContents(),['ค้นหาออเดอร์','วางเลขที่บิล','ดำเนินการต่อ']);
  assert.ok(await page.locator('#tax_order_number').evaluate(el=>el.offsetHeight>=48&&getComputedStyle(el).backgroundColor==='rgb(255, 255, 255)'));
  await page.locator('#pasteTaxInvoiceNumberBtn').click();
  assert.equal(await page.locator('#tax_order_number').inputValue(),'RE-TEST-001');
  await page.locator('#tax_order_number').fill('tax-draft');
  await page.locator('#searchTaxInvoiceOrderBtn').click();
  assert.equal(await page.locator('.pos-sales-history-modal').count(),1);
  await page.locator('#closePOSSalesHistoryBtn').click();
  assert.equal(await page.locator('#tax_order_number').inputValue(),'tax-draft');
  await page.locator('#searchTaxInvoiceOrderBtn').click();
  await page.getByRole('button',{name:'เลือกบิล RE-TEST-001'}).click();
  assert.equal(await page.locator('.pos-sales-history-modal').count(),0);
  assert.equal(await page.locator('#tax_order_number').inputValue(),'RE-TEST-001');
  await page.locator('#continueTaxInvoiceOrderBtn').click();
  assert.equal(await page.evaluate(()=>editingTaxInvoiceSaleId),'sale-test');
  assert.equal(await page.locator('.pos-sales-history-modal').count(),0);
  assert.equal(await page.locator('#tax_form_customer_email').count(),0);
  await page.locator('#cancelTaxInvoiceFormBtn').click();
  await page.locator('#newTaxInvoiceBtn').click();
  assert.equal(await page.locator('#poItemRows .po-item-row').count(),1);
  assert.equal(await page.locator('#tax_form_customer_email').count(),0);
  const sameRow=async ids=>{
    const boxes=await Promise.all(ids.map(id=>page.locator('#'+id).boundingBox()));
    assert.ok(boxes.every(box=>Math.abs(box.y-boxes[0].y)<2),ids.join(',')+' share a row');
  };
  await sameRow(['tax_form_customer_name','tax_form_customer_taxid']);
  await sameRow(['tax_form_customer_branch','tax_form_customer_branch_no','tax_form_customer_phone']);
  await sameRow(['po_date','po_credit']);
  assert.ok((await page.locator('#tax_form_customer_address').boundingBox()).y>(await page.locator('#tax_form_customer_phone').boundingBox()).y);
  assert.ok((await page.locator('#po_due').boundingBox()).y>(await page.locator('#po_credit').boundingBox()).y);
  await page.locator('#tax_form_customer_name').fill('ลูกค้าทดสอบ');
  await page.evaluate(()=>{taxInvoiceDraft.email='preserve@example.test';});
  await page.locator('#po_credit').fill('7');
  await page.locator('#po_credit').dispatchEvent('input');
  await page.locator('#addTaxInvoiceItemBtn').click();
  assert.equal(await page.locator('#poItemRows .po-item-row').count(),2);
  assert.equal(await page.locator('#tax_form_customer_name').inputValue(),'ลูกค้าทดสอบ');
  assert.equal(await page.evaluate(()=>taxInvoiceDraft.email),'preserve@example.test','removing the email field does not erase an existing email');
  assert.equal(await page.locator('#po_due').inputValue(),await page.evaluate(()=>isoToDMY(addDaysToDate(taxInvoiceDraft.date,7))));
  await page.setViewportSize({width:390,height:900});
  assert.ok(await page.locator('.tax-invoice-head').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'customer and date fields fit mobile width');
  await page.setViewportSize({width:1440,height:950});
  await page.locator('#cancelTaxInvoiceFormBtn').click();
  await page.evaluate(()=>{
    window.receiptCalls=[];
    printShortReceipt=id=>{window.receiptCalls.push(id);return true;};
    const search=document.createElement('input');search.id='search';document.body.appendChild(search);
    openPostPaymentModal('sale-test');
  });
  const closeBox=await page.locator('#closePostPaymentBtn').boundingBox();
  const printBox=await page.locator('#finishAndPrintReceiptBtn').boundingBox();
  assert.ok(closeBox.x<printBox.x&&Math.abs(closeBox.y-printBox.y)<2,'close is left and receipt right in one row');
  await page.locator('#closePostPaymentBtn').focus();
  await page.locator('#closePostPaymentBtn').press('Enter');
  assert.equal(await page.locator('#afterPayContent').count(),0);
  await page.waitForFunction(()=>document.activeElement?.id==='search');
  assert.deepEqual(await page.evaluate(()=>window.receiptCalls),[],'closing never starts receipt printing');
  assert.equal(await page.evaluate(()=>salesHistory[0].status),'done','sale stays completed');
  await page.evaluate(()=>openPostPaymentModal('sale-test'));
  await page.locator('#afterPayContent').locator('..').locator('.modal-close').click();
  assert.equal(await page.locator('#afterPayContent').count(),0,'top close also allows continuing');
  await page.evaluate(()=>openPostPaymentModal('sale-test'));
  await page.locator('#finishAndPrintReceiptBtn').click();
  assert.deepEqual(await page.evaluate(()=>window.receiptCalls),['sale-test']);
  assert.equal(await page.locator('#afterPayContent').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Cash bill history and post-payment actions passed: close without printing, keyboard, search focus and optional receipt');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
