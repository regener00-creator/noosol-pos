function renderCashBillLookup(){
  return renderDocumentOrderLookup(false);
}

function renderDocumentOrderLookup(isTaxInvoice){
  const docType=isTaxInvoice?'TaxInvoice':'CashBill';
  const documentName=isTaxInvoice?'ใบกำกับภาษี':'บิลเงินสด';
  return `<section class="cash-bill-lookup" aria-label="สร้าง${documentName}">
    <div class="cash-bill-lookup-actions">
      <button class="barcode-print-mode-card" id="search${docType}OrderBtn" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/></svg>
        <strong>ค้นหาออเดอร์</strong>
      </button>
      <div class="barcode-print-mode-card cash-bill-number-entry">
        <button id="paste${docType}NumberBtn" data-paste-order-number type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 5H5v16h14V5h-3M8 3h8v4H8zM8 12h8M8 16h6"/></svg>
          <strong>วางเลขที่บิล</strong>
        </button>
        <input id="${isTaxInvoice?'tax_order_number':'cash_bill_order_number'}" aria-label="เลขที่ออเดอร์" placeholder="กรอกเลขที่ออเดอร์" autocomplete="off" value="${escapeHtml(isTaxInvoice?taxInvoiceOrderNumberDraft:cashBillOrderNumberDraft)}">
      </div>
      <button class="barcode-print-mode-card" id="continue${docType}OrderBtn" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 3h10l5 5v13H4zM14 3v5h5M7 14l3 3 6-6"/></svg>
        <strong>ดำเนินการต่อ</strong>
      </button>
    </div>
  </section>${posSalesHistoryModalOpen?renderPOSSalesHistoryModal():''}`;
}

function renderCashBills(){
  if(cashBillLookupOpen) return renderCashBillLookup();
  if(editingTaxInvoiceSaleId!==null&&taxInvoiceDraft)return renderStandaloneTaxInvoiceForm();
  const manual=standaloneCashBillPage();
  const dateOf=s=>s.cashReceiptA4Meta.saleDate||s.date,numberOf=s=>s.cashReceiptA4Meta.number||shortReceiptNumber(s);
  const range=documentPeriodRange('cashbill');
  const issued=salesHistory.filter(s=>documentInActiveStore(s)&&s.status==='done'&&s.cashReceiptA4Meta&&dateOf(s)>=range.from&&dateOf(s)<=range.to);
  const total=issued.length+manual.count;
  const docs=salesDocumentList(issued.concat(manual.rows),'cashbill',dateOf,numberOf);
  const totalPages=Math.max(1,Math.ceil(total/DOC_LIST_PAGE_SIZE));
  if(docListPage.cashbill>totalPages) docListPage.cashbill=totalPages;
  if(docListPage.cashbill<1) docListPage.cashbill=1;
  const start=(docListPage.cashbill-1)*DOC_LIST_PAGE_SIZE;
  const rows=docs.slice(start,start+DOC_LIST_PAGE_SIZE).map(s=>{ const meta=s.cashReceiptA4Meta||{},number=meta.number||shortReceiptNumber(s),buyer=meta.customer?.name||(typeof s.member==='object'?s.member?.name:s.member)||s.name||'ลูกค้าทั่วไป'; return `<tr><td class="mono">${escapeHtml(number)}</td><td>${escapeHtml(fmtDate(meta.saleDate||s.date))}</td><td class="doc-customer-cell">${escapeHtml(buyer)}</td><td class="doc-items-cell">${salesHistoryItemsPreview(s.items)}</td><td class="mono num">${fmtMoney(s.total)}</td><td class="num"><div class="history-actions"><button class="history-icon-btn" data-cashbill-edit="${escapeHtml(s.id)}" title="เปิดบิลเงินสด" aria-label="เปิดบิลเงินสด ${escapeHtml(number)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="history-icon-btn" data-cashbill-print="${escapeHtml(s.id)}" title="พิมพ์บิลเงินสด" aria-label="พิมพ์บิลเงินสด ${escapeHtml(number)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/></svg></button></div></td></tr>`; }).join('');
  return `<div class="pagehead document-list-heading"><div><h1>บิลเงินสด <span class="page-title-meta">เอกสารรับเงินกระดาษ A4 · ${total} รายการ</span></h1></div><div class="document-issue-actions"><button class="btn ghost" id="historicalCashBillBtn">บิลเงินสดย้อนหลัง</button><button class="btn primary" id="newCashBillBtn">+ สร้างบิลเงินสด</button></div>
    ${documentPeriodToolbar('cashbill')}</div>
    ${manual.error?'<div role="alert">โหลดบิลเงินสดที่สร้างเองไม่สำเร็จ <button class="btn ghost" id="retryManualCashBills">ลองใหม่</button></div>':''}
    <div class="doc-list-wrap seamless-table-wrap"><table class="grid-table doc-list doc-head-blue doc-summary-table customer-items-summary-table"><colgroup><col style="width:180px"><col style="width:120px"><col style="width:220px"><col><col style="width:120px"><col style="width:124px"></colgroup><thead><tr><th>${documentSortHeader('cashbill','number','เลขที่เอกสาร')}</th><th>${documentSortHeader('cashbill','date','วันที่')}</th><th>ผู้ซื้อ</th><th>รายการ</th><th class="mono">ยอดรวม</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px;">ยังไม่มีบิลเงินสด</td></tr>`}</tbody></table></div>
    ${pagerHtml(docListPage.cashbill,totalPages,'docpage-cashbill')}`;
}

async function searchCashBillOrder(){
  const input=document.getElementById('cash_bill_order_number');
  const query=String(input?.value||'').trim();
  if(!query){ showToast('กรุณากรอกเลขออเดอร์'); input?.focus(); return; }
  let sale;
  try{ sale=await findSaleByIdentifier(query); }
  catch(error){ console.warn('search cash bill order',error); showToast('ค้นหาออเดอร์ไม่สำเร็จ กรุณาลองใหม่','danger-top'); return; }
  if(sale?.status!=='done') sale=null;
  if(!sale){ showToast('ไม่พบออเดอร์ที่ชำระเงินเรียบร้อยแล้ว','danger'); input?.focus(); return; }
  cashBillLookupOpen=false;
  openA4CashReceiptModal(sale.id);
}

async function deleteCashBills(ids){
  if(deleteCashBills.busy)return;
  const selected=new Set(ids);
  const bills=salesHistory.concat(cashBillPageCache?.rows||[]).filter(s=>selected.has(String(s.id))&&documentInActiveStore(s)&&s.status==='done'&&s.cashReceiptA4Meta);
  if(!bills.length)return;
  const label=bills.length===1?(bills[0].cashReceiptA4Meta.number||shortReceiptNumber(bills[0])):`ที่เลือก ${bills.length} รายการ`;
  if(!confirm(`ยืนยันลบบิลเงินสด ${label} ?\nยอดขายและสต็อกจะไม่เปลี่ยนแปลง`))return;
  const view=captureStoreView();
  let deleted=0;
  deleteCashBills.busy=true;
  try{
    for(const sale of bills){
      if(!isStoreViewCurrent(view))break;
      try{
        if(sale.standalone)await deleteManualCashBill(sale);
        else await updateSaleDocumentMetadata(sale.id,{cashReceiptA4Meta:null});
        deleted++;
      }catch(error){console.warn('delete cash bill',sale.id,error);}
    }
    if(!isStoreViewCurrent(view))return;
    if(currentTab==='cashbill')render();
    showToast(deleted===bills.length?`ลบบิลเงินสดแล้ว ${deleted} รายการ`:`ลบสำเร็จ ${deleted} จาก ${bills.length} รายการ กรุณาตรวจรายการที่เหลือ`,deleted===bills.length?'':'danger-top');
  }finally{deleteCashBills.busy=false;}
}

function renderTaxInvoices(){
  if(editingTaxInvoiceSaleId!==null) return renderTaxInvoiceForm();
  const vatRegistered=isBusinessVatRegistered();
  const sales=salesHistory.filter(documentInActiveStore).filter(s=>s.status==='done'&&s.fullTaxInvoice);
  const allItems=salesDocumentList([
    ...sales.map(s=>({date:s.date,number:s.fullTaxInvoice.number,buyer:s.fullTaxInvoice.customer?.name||'-',items:s.items,total:s.total,typeLabel:'ออกย้อนหลัง',openAct:`data-tax-sale="${escapeHtml(s.id)}"`,printAct:`data-print-tax="${escapeHtml(s.id)}"`,ariaNum:s.fullTaxInvoice.number})),
    ...standaloneTaxInvoices.filter(documentInActiveStore).map(doc=>({date:doc.saleDate||doc.date,number:doc.number,buyer:doc.customer?.name||'-',items:doc.items,total:doc.total,typeLabel:'สร้างใหม่',openAct:`data-tax-doc="${escapeHtml(doc.number)}"`,printAct:`data-print-tax="${escapeHtml(doc.number)}"`,ariaNum:doc.number})),
  ],'taxinvoice',row=>row.date,row=>row.number);
  const totalPages=Math.max(1, Math.ceil(allItems.length/DOC_LIST_PAGE_SIZE));
  if(docListPage.taxinvoice>totalPages) docListPage.taxinvoice=totalPages;
  if(docListPage.taxinvoice<1) docListPage.taxinvoice=1;
  const start=(docListPage.taxinvoice-1)*DOC_LIST_PAGE_SIZE;
  const pageItems=allItems.slice(start,start+DOC_LIST_PAGE_SIZE);
  const rowsHtml=pageItems.map(it=>`<tr><td class="mono">${escapeHtml(it.number)}</td><td>${fmtDate(it.date)}</td><td class="doc-customer-cell">${escapeHtml(it.buyer)}</td><td class="doc-items-cell">${salesHistoryItemsPreview(it.items)}</td><td class="mono num">${fmtMoney(it.total)}</td><td><span class="badge ok">${escapeHtml(it.typeLabel)}</span></td><td class="num"><div class="history-actions"><button class="history-icon-btn" ${it.openAct} title="แก้ไขเอกสาร" aria-label="แก้ไขใบกำกับภาษี ${escapeHtml(it.ariaNum)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="history-icon-btn" ${it.printAct} title="พิมพ์เอกสาร" aria-label="พิมพ์ใบกำกับภาษี ${escapeHtml(it.ariaNum)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/></svg></button></div></td></tr>`).join('');
  return `<div class="pagehead document-list-heading"><div><h1>ใบกำกับภาษีเต็มรูปแบบ <span class="page-title-meta">สร้างเอกสารใหม่ หรือ ออกเอกสารจากออเดอร์ย้อนหลัง · ${allItems.length} รายการ</span></h1></div>${vatRegistered?`<div class="document-issue-actions"><button class="btn ghost" id="historicalTaxInvoiceBtn">ออกใบกำกับภาษีย้อนหลัง</button><button class="btn primary" id="newTaxInvoiceBtn">+ สร้างใบกำกับภาษี</button></div>`:''}
    ${documentPeriodToolbar('taxinvoice')}</div>
    ${vatRegistered?'':'<div class="panel" style="border-color:#f0c36d;background:#fff8e8;color:#855d12;">กิจการยังไม่จดภาษีมูลค่าเพิ่ม จึงสร้างใบกำกับภาษีใหม่ไม่ได้ แต่ยังเปิดดูหรือพิมพ์เอกสารเดิมได้</div>'}
    <div class="doc-list-wrap seamless-table-wrap">
    <table class="grid-table doc-head-blue doc-summary-table customer-items-summary-table"><colgroup><col style="width:170px"><col style="width:120px"><col style="width:220px"><col><col style="width:110px"><col style="width:100px"><col style="width:124px"></colgroup><thead><tr><th>${documentSortHeader('taxinvoice','number','เลขที่เอกสาร')}</th><th>${documentSortHeader('taxinvoice','date','วันที่')}</th><th>ผู้ซื้อ</th><th>รายการ</th><th class="mono">ยอดรวม</th><th>ประเภท</th><th></th></tr></thead><tbody>${rowsHtml||`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:28px;">ยังไม่มีใบกำกับภาษีเต็มรูปแบบ</td></tr>`}</tbody></table>
    </div>
    ${pagerHtml(docListPage.taxinvoice, totalPages, 'docpage-taxinvoice')}`;
}

async function deleteTaxInvoiceFromSale(saleId){
  const sale=salesHistory.find(s=>s.id===saleId); if(!sale||!sale.fullTaxInvoice) return;
  const number=sale.fullTaxInvoice.number;
  if(!confirm(`ยืนยันลบใบกำกับภาษี ${number} ?`)) return;
  try{
    await updateSaleDocumentMetadata(sale.id,{fullTaxInvoice:null});
    showToast(`ลบใบกำกับภาษี ${number} แล้ว`);
    render();
  }catch(error){
    console.warn('delete tax invoice',error);
    showToast('ลบใบกำกับภาษีไม่สำเร็จ ข้อมูลเดิมยังอยู่','danger-top');
  }
}

function deleteStandaloneTaxInvoice(number){
  const doc=standaloneTaxInvoices.find(d=>d.number===number); if(!doc) return;
  if(!confirm(`ยืนยันลบใบกำกับภาษี ${doc.number} ?`)) return;
  standaloneTaxInvoices=standaloneTaxInvoices.filter(d=>d.number!==number); persistStandaloneTaxInvoices(); showToast(`ลบใบกำกับภาษี ${doc.number} แล้ว`); render();
}

function openNewTaxInvoiceForm(){
  const cash=currentTab==='cashbill';
  if(!cash&&!isBusinessVatRegistered()){ showToast('กิจการยังไม่จด VAT จึงสร้างใบกำกับภาษีไม่ได้','danger'); return; }
  editingTaxInvoiceSaleId='manual-new';
  taxInvoiceAddingCustomer=false;
  const number='ออกเลขเมื่อบันทึก';
  taxInvoiceDraft={id:number,number,warehouseId:activeWarehouseId,date:TODAY_STR,credit:0,dueDate:TODAY_STR,customerId:'',name:'',taxId:'',address:'',branch:'สำนักงานใหญ่',branchNo:'',phone:'',email:'',items:[{name:'',qty:1,unit:'',price:''}],discount:0,note:''};
  render();
}

function openHistoricalTaxInvoiceForm(){
  if(!isBusinessVatRegistered()){ showToast('กิจการยังไม่จด VAT จึงออกใบกำกับภาษีย้อนหลังไม่ได้','danger'); return; }
  editingTaxInvoiceSaleId='lookup'; taxInvoiceDraft=null; taxInvoiceAddingCustomer=false; taxInvoiceOrderNumberDraft=''; currentTab='taxinvoice'; render();
}

function renderTaxInvoiceOrderLookup(){
  return renderDocumentOrderLookup(true);
}

async function searchTaxInvoiceOrder(){
  const input=document.getElementById('tax_order_number');
  const query=(input?.value||'').trim();
  if(!query){ showToast('กรุณากรอกเลขออเดอร์'); input?.focus(); return; }
  let sale;
  try{ sale=await findSaleByIdentifier(query); }
  catch(error){ console.warn('search tax invoice order',error); showToast('ค้นหาออเดอร์ไม่สำเร็จ กรุณาลองใหม่','danger-top'); return; }
  if(sale?.status!=='done') sale=null;
  if(!sale){ showToast('ไม่พบออเดอร์ที่ชำระเงินเรียบร้อยแล้ว'); input?.focus(); return; }
  if(!canIssueTaxInvoiceForSale(sale)&&!sale.fullTaxInvoice){ showToast('รายการขายนี้เกิดขึ้นขณะที่กิจการยังไม่จด VAT จึงออกใบกำกับภาษีไม่ได้','danger'); return; }
  if(sale.fullTaxInvoice) showToast('ออเดอร์นี้เคยออกใบกำกับภาษีแล้ว กำลังเปิดเอกสารเดิม');
  startTaxInvoiceForm(sale.id);
}

function taxInvoiceCustomerFieldsHtml(draft,lockAttr){
  const required=currentTab==='cashbill'?'':' *';
  return `<div class="po-supplier-edit-grid tax-invoice-customer-grid">
    <div class="tax-customer-name"><label>ชื่อลูกค้า *</label><input id="tax_form_customer_name" value="${escapeHtml(draft.name||'')}" ${lockAttr}></div>
    <div class="tax-customer-taxid"><label>เลขผู้เสียภาษี${required}</label><input id="tax_form_customer_taxid" value="${escapeHtml(draft.taxId||'')}" maxlength="13" ${lockAttr}></div>
    <div class="tax-customer-branch"><label>สถานประกอบการ</label><input id="tax_form_customer_branch" value="${escapeHtml(draft.branch||'')}" placeholder="เช่น สำนักงานใหญ่ หรือ สาขา" ${lockAttr}></div>
    <div class="tax-customer-branchno"><label>สาขา</label><input id="tax_form_customer_branch_no" value="${escapeHtml(draft.branchNo||'')}" maxlength="5" ${lockAttr}></div>
    <div class="tax-customer-phone"><label>เบอร์โทร</label><input id="tax_form_customer_phone" class="phone-input" value="${escapeHtml(draft.phone||'')}" ${lockAttr}></div>
    <div class="tax-customer-address"><label>ที่อยู่${required}</label><textarea id="tax_form_customer_address" rows="2" ${lockAttr}>${escapeHtml(draft.address||'')}</textarea></div>
  </div>`;
}

function startStandaloneTaxInvoiceForm(number,cashDoc=null){
  const doc=cashDoc||standaloneTaxInvoices.find(item=>item.number===number); if(!doc) return;
  editingTaxInvoiceSaleId='manual:'+number;
  taxInvoiceAddingCustomer=false;
  const rawBranch=doc.customer?.branch;
  const branchText=rawBranch==='head'?'สำนักงานใหญ่':rawBranch==='branch'?'สาขา':(rawBranch||'สำนักงานใหญ่');
  taxInvoiceDraft={id:doc.number,number:doc.number,date:doc.saleDate||doc.date,credit:doc.credit||0,dueDate:doc.dueDate||addDaysToDate(doc.saleDate||doc.date,doc.credit||0),customerId:'',name:doc.customer?.name||'',taxId:doc.customer?.taxId||'',address:doc.customer?.address||'',branch:branchText,branchNo:doc.customer?.branchNo||'',phone:doc.customer?.phone||'',email:doc.customer?.email||'',items:JSON.parse(JSON.stringify(doc.items||[])),discount:doc.discount||0,note:doc.note||''};
  if(cashDoc){
    taxInvoiceDraft.cashDocument=cashDoc;
    if(doc.customer?.walkIn){taxInvoiceDraft.customerId='walk-in';taxInvoiceDraft.branch=rawBranch||'';}
  }
  currentTab=cashDoc?'cashbill':'taxinvoice';
  render();
}

function renderStandaloneTaxInvoiceForm(){
  const locked=String(editingTaxInvoiceSaleId).startsWith('manual:');
  const cash=currentTab==='cashbill';
  const doc=locked?(cash?taxInvoiceDraft.cashDocument:standaloneTaxInvoices.find(item=>item.number===String(editingTaxInvoiceSaleId).slice(7))):null;
  if(locked&&!doc) return '<div class="panel">ไม่พบใบกำกับภาษี</div>';
  const draft=taxInvoiceDraft;
  const items=draft.items||[];
  const discount=Number(draft.discount)||0;
  const tax=locked&&doc?.taxSummary?doc.taxSummary:calculateDocumentTaxSummary(items,discount,cash?isBusinessVatRegistered():true,doc?documentBusinessSettings(doc):warehouseBusinessSettings());
  const subtotal=tax.subtotal,total=tax.total;
  const lockAttr=locked?'readonly':'';
  const vatMode=item=>documentItemVatMode(item,tax.registered,documentBusinessSettings(doc));
  return `<div class="pagehead"><div><div class="breadcrumb">${cash?'บิลเงินสด':'ใบกำกับภาษีเต็มรูปแบบ'} › ${locked?'ดูเอกสาร':cash?'สร้างบิลเงินสด':'สร้างใบกำกับภาษี'}</div><h1>${draft.number}</h1></div>${locked?`<div class="form-final-actions" style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ย้อนกลับ</button><button class="btn primary" id="printStandaloneTaxInvoiceBtn">🖨 พิมพ์</button></div>`:''}</div>
    <div class="po-head tax-invoice-head"><div class="po-head-left">
      <div class="crow tax-customer-picker-row"><div class="po-supplier-pick"><select id="tax_customer_select" ${locked?'disabled':''}><option value="">เลือกข้อมูลลูกค้าสำหรับออกเอกสาร</option>${cash?`<option value="walk-in" ${draft.customerId==='walk-in'?'selected':''}>ลูกค้าทั่วไป</option>`:''}${customersList().map(c=>`<option value="${c.id}" ${String(draft.customerId)===String(c.id)||(!draft.customerId&&draft.name===c.name)?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select>${locked?'':'<button class="btn ghost small" id="addTaxCustomerBtn" type="button">+ เพิ่มลูกค้า</button>'}</div></div>
      <div class="po-supplier-edit tax-customer-details" style="margin-top:10px;">${taxInvoiceAddingCustomer?'<div class="po-supplier-edit-title"><span>เพิ่มลูกค้าใหม่</span><span style="font-size:11px;color:var(--text-muted);font-weight:400;">บันทึกแล้วจะเพิ่มในสมุดรายชื่อทันที</span></div>':''}${taxInvoiceCustomerFieldsHtml(draft,lockAttr)}${!locked&&taxInvoiceAddingCustomer?'<div class="po-supplier-edit-actions"><button class="btn ghost small" id="cancelTaxCustomerBtn" type="button">ยกเลิก</button><button class="btn primary small" id="saveTaxCustomerBtn" type="button">บันทึก</button></div>':''}</div></div>
      <div class="po-head-right"><div class="po-total-label">จำนวนเงินรวมทั้งสิ้น</div><div class="po-total-amt mono">${fmtMoney(total)}</div><div class="tax-invoice-dates"><div class="crow"><label>วันที่</label>${dmyDateFieldHtml('po_date',draft.date,locked?{readonly:true,extraClass:'due-readonly'}:{})}</div><div class="crow"><label>เครดิต (วัน)</label><input id="po_credit" type="number" min="0" value="${draft.credit||0}" ${locked?'readonly class="due-readonly"':''}></div><div class="crow"><label>ครบกำหนด</label>${dmyDateFieldHtml('po_due',addDaysToDate(draft.date,draft.credit||0),{readonly:true,extraClass:'due-readonly'})}</div></div></div>
    </div>
    ${locked?'<div class="doc-scanner-wrap"><div class="doc-scanner-hint" style="font-size:13px;color:var(--primary-dark);">🔒 เอกสารถูกล็อกแล้ว</div></div>':documentProductScannerHtml(true)}
    <table class="grid-table po-items document-centered-items"><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th class="mono">จำนวน</th><th>หน่วย</th><th class="mono">ราคาต่อหน่วย</th><th class="mono">ราคารวม</th>${locked?'':'<th></th>'}</tr></thead><tbody id="poItemRows">${locked?items.map((item,index)=>`<tr><td class="mono">${index+1}</td><td>${escapeHtml(item.name)}</td><td class="mono num">${escapeHtml(item.qty)}</td><td>${escapeHtml(item.unit||'-')}</td><td class="mono num">${fmtMoney(cash?item.price:grossAmountForVatMode(item.price,vatMode(item),tax.registered))}</td><td class="mono num">${fmtMoney(cash?item.qty*item.price:invoiceLineGross(item,vatMode(item),tax.registered))}</td></tr>`).join(''):items.map((item,index)=>poItemRowHtml(item,index)).join('')}</tbody></table>${locked?'':'<button class="btn ghost small" id="addTaxInvoiceItemBtn" style="margin-top:8px;">+ เพิ่มแถวรายการ</button>'}
    <div class="po-foot"><div class="po-foot-left"><div class="crow"><label>หมายเหตุ</label><textarea id="po_note" rows="3" ${lockAttr}>${escapeHtml(draft.note||'')}</textarea></div>${locked?`<div style="margin-top:10px;color:var(--text-muted);font-size:12px;">ออกเอกสารเมื่อ ${auditDisplay(doc.issuedAt)} · ${cash?(doc.cashReceiptA4Meta.printLog.length?'พิมพ์แล้ว':'ยังไม่เคยพิมพ์'):`พิมพ์แล้ว <span data-tax-print-count="${escapeHtml(doc.number)}">${doc.printLog?.length||0}</span> ครั้ง`}</div>`:''}</div>
      <div class="po-foot-right"><div class="sumrow"><span>รวมเป็นเงิน</span><span class="mono" data-po-summary="subtotal">${fmtMoney(subtotal)}</span></div><div class="sumrow"><span>ส่วนลด</span><span class="sumdiscount">${locked?`<span class="mono">${fmtMoney(discount)}</span>`:`<input id="po_discount" type="number" value="${discount}" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;text-align:right;">`}</span></div><div class="sumrow"><span>ราคาหลังหักส่วนลด</span><span class="mono" data-po-summary="total">${fmtMoney(total)}</span></div>${cash?'':taxSummaryRowsHtml(tax)}<div class="sumrow grand"><span>จำนวนเงินรวมทั้งสิ้น</span><span class="mono" data-po-summary="total">${fmtMoney(total)}</span></div></div></div>${locked?'':`<div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ย้อนกลับ</button><button class="btn primary" id="saveStandaloneTaxInvoiceBtn" title="ตัดสต็อกเมื่อกดบันทึก">บันทึก</button></div>`}`;
}

async function saveStandaloneTaxInvoice(){
  const cash=currentTab==='cashbill';
  if(!cash&&!isBusinessVatRegistered()){ showToast('กิจการยังไม่จด VAT จึงบันทึกใบกำกับภาษีไม่ได้','danger'); return; }
  if(editingTaxInvoiceSaleId!=='manual-new') return;
  syncPOFromDOM(); syncTaxInvoiceDraftFromDOM();
  const d=taxInvoiceDraft,items=(d.items||[]).filter(item=>item.name&&Number(item.qty)>0);
  if(!d.name){ showToast('กรุณากรอกชื่อลูกค้า'); return; }
  d.taxId=String(d.taxId||'').replace(/\D/g,'');
  if((!cash||d.taxId)&&!/^\d{13}$/.test(d.taxId)){ showToast('เลขประจำตัวผู้เสียภาษีลูกค้าต้องมี 13 หลัก','danger'); return; }
  if(d.branch==='สาขา'&&!/^\d{5}$/.test(String(d.branchNo||'').replace(/\D/g,''))){ showToast('เลขที่สาขาลูกค้าต้องมี 5 หลัก','danger'); return; }
  if(!cash&&!d.address){ showToast('กรุณากรอกที่อยู่ลูกค้า'); return; }
  if(!items.length){ showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ'); return; }
  if(items.some(item=>!item.productId&&documentProductPool().some(product=>product.name===item.name))){showToast('พบชื่อสินค้าซ้ำ กรุณาเลือกสินค้าจากผลค้นหาหรือสแกนบาร์โค้ด','danger');return;}
  if(cash&&items.some(item=>Number(item.price)<0)){showToast('ราคาสินค้าต้องไม่ติดลบ');return;}
  const discount=Number(d.discount)||0;
  const registered=cash?isBusinessVatRegistered():true;
  const itemsWithVat=items.map(item=>({...item,productId:item.productId||item.pid||null,vatMode:documentItemVatMode(item,registered,warehouseBusinessSettings())}));
  const taxSummary=calculateDocumentTaxSummary(itemsWithVat,discount,registered,warehouseBusinessSettings());
  const view=captureStoreView();
  if(Number(d.warehouseId)!==view.store)return;
  const doc={date:d.date,saleDate:d.date,credit:d.credit||0,dueDate:addDaysToDate(d.date,d.credit||0),issuedAt:auditNow(),customer:{...(cash&&d.customerId==='walk-in'&&d.name==='ลูกค้าทั่วไป'?{walkIn:true}:{}),name:d.name,taxId:d.taxId,address:d.address,branch:d.branch,branchNo:d.branchNo,phone:d.phone,email:d.email},items:itemsWithVat,discount:taxSummary.discount,total:taxSummary.total,vatRegistered:registered,taxSummary,warehouseId:activeWarehouseId,businessSnapshot:businessDocumentSnapshot(),note:d.note||'',printLog:[]};
  if(d.saving)return;
  d.saving=true;
  d.requestId||=crypto.randomUUID();
  let number;
  try{
    const {data,error}=await sb.rpc('issue_stock_sales_document',{p_kind:cash?'cashBill':'taxInvoice',p_warehouse_id:view.store,p_request_id:d.requestId,p_document:doc});
    if(error)throw error;
    number=data.number;
    if(!isStoreViewCurrent(view))return;
    if(cash)cashBillPageCache=null;
    else{
      const saved=rowToDoc(data.row);
      standaloneTaxInvoices=[saved,...standaloneTaxInvoices.filter(item=>item.id!==saved.id)];
      (syncedTableRows.standalone_tax_invoices||=new Map()).set(saved.id,JSON.stringify(docToRow(saved)));
    }
    await refreshDocumentInventory(data.row.data);
    if(!isStoreViewCurrent(view)||taxInvoiceDraft!==d||editingTaxInvoiceSaleId!=='manual-new')return;
  }catch(error){
    if(isStoreViewCurrent(view))showToast('บันทึกเอกสารไม่สำเร็จ · '+(error.message||'กรุณาลองใหม่'),'danger-top');
    return;
  }finally{d.saving=false;}
  editingTaxInvoiceSaleId=null; taxInvoiceDraft=null; taxInvoiceAddingCustomer=false;
  showToast(`บันทึก${cash?'บิลเงินสด':'ใบกำกับภาษี'} ${number} แล้ว`);
  render();
}

function startTaxInvoiceForm(saleId){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale||!documentInActiveStore(sale)||sale.status!=='done') return;
  if(!sale.fullTaxInvoice&&!canIssueTaxInvoiceForSale(sale)){ showToast('รายการขายนี้ออกใบกำกับภาษีไม่ได้','danger'); return; }
  const member=sale.member&&typeof sale.member==='object'?sale.member:{};
  const memberName=typeof sale.member==='string'?sale.member:member.name;
  const invoice=sale.fullTaxInvoice,matched=customersList().find(c=>String(c.id)===String(sale.customerId||member.id)||c.name===(memberName||sale.customerName||sale.name));
  const source=invoice?.customer||matched||member||{};
  editingTaxInvoiceSaleId=saleId;
  taxInvoiceAddingCustomer=false;
  const rawBranch=source.branch;
  const branchText=rawBranch==='head'?'สำนักงานใหญ่':rawBranch==='branch'?'สาขา':(rawBranch||'สำนักงานใหญ่');
  taxInvoiceDraft={customerId:matched?.id||member.id||'',name:source.name||memberName||sale.customerName||sale.name||'',taxId:source.taxId||'',address:source.address||'',branch:branchText,branchNo:source.branchNo||'',phone:source.phone||'',email:source.email||'',note:invoice?.note||''};
  currentTab='taxinvoice';
  render();
}

function syncTaxInvoiceDraftFromDOM(){
  if(!taxInvoiceDraft) return;
  const get=id=>document.getElementById(id)?.value??'';
  taxInvoiceDraft.customerId=get('tax_customer_select');
  taxInvoiceDraft.name=get('tax_form_customer_name').trim();
  taxInvoiceDraft.taxId=get('tax_form_customer_taxid').trim();
  taxInvoiceDraft.address=get('tax_form_customer_address').trim();
  if(document.getElementById('tax_form_customer_branch')) taxInvoiceDraft.branch=get('tax_form_customer_branch').trim()||(currentTab==='cashbill'&&taxInvoiceDraft.customerId==='walk-in'?'':'สำนักงานใหญ่');
  if(document.getElementById('tax_form_customer_branch_no')) taxInvoiceDraft.branchNo=get('tax_form_customer_branch_no').trim();
  taxInvoiceDraft.phone=get('tax_form_customer_phone').trim();
  if(document.getElementById('tax_form_customer_email')) taxInvoiceDraft.email=get('tax_form_customer_email').trim();
  if(currentTab==='quotation'){
    taxInvoiceDraft.line=get('tax_form_customer_line').trim();
    taxInvoiceDraft.entity=document.querySelector('input[name="quotation_customer_entity"]:checked')?.value||'individual';
  }
  const note=document.getElementById('tax_form_note'); if(note) taxInvoiceDraft.note=note.value;
}

function beginAddTaxInvoiceCustomer(){
  if(editingTaxInvoiceSaleId==='manual-new'||(currentTab==='quotation'&&editingQuotationId!==null)) syncPOFromDOM();
  syncTaxInvoiceDraftFromDOM();
  Object.assign(taxInvoiceDraft,{customerId:'',name:'',taxId:'',address:'',branch:'สำนักงานใหญ่',branchNo:'',phone:'',email:''});
  taxInvoiceAddingCustomer=true;
  render();
  setTimeout(()=>document.getElementById('tax_form_customer_name')?.focus(),0);
}

function cancelAddTaxInvoiceCustomer(){ taxInvoiceAddingCustomer=false; render(); }

function saveTaxInvoiceCustomer(){
  if(editingTaxInvoiceSaleId==='manual-new'||(currentTab==='quotation'&&editingQuotationId!==null)) syncPOFromDOM();
  syncTaxInvoiceDraftFromDOM();
  const d=taxInvoiceDraft,name=(d.name||'').trim();
  if(!name){ showToast('กรุณากรอกชื่อลูกค้า'); document.getElementById('tax_form_customer_name')?.focus(); return; }
  const duplicate=customersList().find(customer=>customer.name.trim().toLowerCase()===name.toLowerCase());
  if(duplicate){ d.customerId=duplicate.id; taxInvoiceAddingCustomer=false; showToast('มีชื่อลูกค้านี้อยู่แล้ว ระบบเลือกรายชื่อเดิมให้แล้ว'); render(); return; }
  const customer={id:generateClientRecordId(contacts),warehouseId:activeWarehouseId,name,entity:d.taxId?'juristic':'individual',types:['customer'],contactName:'',phone:d.phone||'',email:d.email||'',taxId:d.taxId||'',creditDays:d.credit||'',address:d.address||'',bank:'',bankAcc:'',note:''};
  contacts.push(customer);
  persistContacts();
  d.customerId=customer.id;
  taxInvoiceAddingCustomer=false;
  showToast(`เพิ่มลูกค้า “${name}” ในสมุดรายชื่อแล้ว`);
  render();
}

function renderTaxInvoiceForm(){
  if(editingTaxInvoiceSaleId==='lookup') return renderTaxInvoiceOrderLookup();
  if(editingTaxInvoiceSaleId==='manual-new'||String(editingTaxInvoiceSaleId).startsWith('manual:')) return renderStandaloneTaxInvoiceForm();
  const sale=salesHistory.find(item=>item.id===editingTaxInvoiceSaleId);
  if(!sale) return '<div class="panel">ไม่พบรายการขายต้นทาง</div>';
  const invoice=sale.fullTaxInvoice,locked=!!invoice;
  if(!taxInvoiceDraft) startTaxInvoiceForm(sale.id);
  const draft=taxInvoiceDraft||{};
  const tax=saleTaxSummary(sale);
  const subtotal=tax.subtotal,discount=tax.discount,total=tax.total,beforeVat=tax.beforeVat,vat=tax.vat;
  const docNo=invoice?.number||fullTaxInvoiceNumber(sale);
  const lockAttr=locked?'readonly':'';
  return `<div class="pagehead"><div><div class="breadcrumb">ใบกำกับภาษีเต็มรูปแบบ › ${locked?'ดูเอกสาร':'สร้างใบกำกับภาษี'}</div><h1>${docNo}</h1></div>${locked?`<div class="form-final-actions" style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ย้อนกลับ</button><button class="btn primary" id="printTaxInvoiceFormBtn">🖨 พิมพ์</button></div>`:''}</div>
    <div class="po-head">
      <div class="po-head-left">
        <div class="crow tax-customer-picker-row"><div class="po-supplier-pick"><select id="tax_customer_select" ${locked?'disabled':''}><option value="">เลือกข้อมูลลูกค้าสำหรับออกเอกสาร</option>${customersList().map(c=>`<option value="${c.id}" ${String(draft.customerId)===String(c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select>${locked?'':'<button class="btn ghost small" id="addTaxCustomerBtn" type="button">+ เพิ่มลูกค้า</button>'}</div></div>
        <div class="po-supplier-edit tax-customer-details" style="margin-top:10px;">${taxInvoiceAddingCustomer?'<div class="po-supplier-edit-title"><span>เพิ่มลูกค้าใหม่</span><span style="font-size:11px;color:var(--text-muted);font-weight:400;">บันทึกแล้วจะเพิ่มในสมุดรายชื่อทันที</span></div>':''}${taxInvoiceCustomerFieldsHtml(draft,lockAttr)}${!locked&&taxInvoiceAddingCustomer?'<div class="po-supplier-edit-actions"><button class="btn ghost small" id="cancelTaxCustomerBtn" type="button">ยกเลิก</button><button class="btn primary small" id="saveTaxCustomerBtn" type="button">บันทึก</button></div>':''}</div>
      </div>
      <div class="po-head-right"><div class="po-total-label">จำนวนเงินรวมทั้งสิ้น</div><div class="po-total-amt mono">${fmtMoney(total)}</div>
        <div class="crow"><label>วันที่</label>${dmyDateFieldHtml('sale_date_view',sale.date,{readonly:true,extraClass:'due-readonly'})}</div>
        <div class="crow"><label>เลขที่บิลอ้างอิง</label><input value="${escapeHtml(sale.ref||shortReceiptNumber(sale))}" readonly class="due-readonly"></div>
        <div class="crow"><label>วิธีชำระ</label><input value="${escapeHtml(sale.payMethod||'-')}" readonly class="due-readonly"></div>
      </div>
    </div>
    <div class="doc-scanner-wrap"><div class="doc-scanner-hint" style="font-size:13px;color:var(--primary-dark);">🔒 รายการสินค้าดึงจากบิลขายเดิมและไม่สามารถแก้ไขได้ เพื่อป้องกันยอดขายและสต็อกคลาดเคลื่อน</div></div>
    <table class="grid-table po-items document-centered-items"><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th class="mono">จำนวน</th><th>หน่วย</th><th class="mono">ราคาต่อหน่วย</th><th class="mono">ราคารวม</th></tr></thead><tbody>${(sale.items||[]).map((item,index)=>`<tr><td class="mono">${index+1}</td><td>${escapeHtml(item.name)}</td><td class="mono num">${item.qty}</td><td>${escapeHtml(item.unit||'-')}</td><td class="mono num">${fmtMoney(grossAmountForVatMode(item.price,item.vatMode,tax.registered))}</td><td class="mono num">${fmtMoney(invoiceLineGross(item,item.vatMode,tax.registered))}</td></tr>`).join('')}</tbody></table>
    <div class="po-foot"><div class="po-foot-left"><div class="crow"><label>หมายเหตุ</label><textarea id="tax_form_note" rows="3" ${lockAttr}>${escapeHtml(draft.note||'')}</textarea></div>${locked?`<div style="margin-top:10px;color:var(--text-muted);font-size:12px;">ออกเอกสารเมื่อ ${auditDisplay(invoice.issuedAt)} · พิมพ์แล้ว <span data-tax-print-count="${escapeHtml(invoice.number)}">${invoice.printLog?.length||0}</span> ครั้ง</div>`:''}</div>
      <div class="po-foot-right"><div class="sumrow"><span>รวมเป็นเงิน</span><span class="mono">${fmtMoney(subtotal)}</span></div>${discount?`<div class="sumrow"><span>ส่วนลด</span><span class="mono">- ${fmtMoney(discount)}</span></div>`:''}<div class="sumrow"><span>ราคาหลังหักส่วนลด</span><span class="mono">${fmtMoney(total)}</span></div>${taxSummaryRowsHtml(tax)}<div class="sumrow grand"><span>จำนวนเงินรวมทั้งสิ้น</span><span class="mono">${fmtMoney(total)}</span></div></div></div>${locked?'':`<div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ย้อนกลับ</button><button class="btn primary" id="saveTaxInvoiceFormBtn">บันทึก</button></div>`}`;
}

async function saveTaxInvoiceForm(){
  const sale=salesHistory.find(item=>item.id===editingTaxInvoiceSaleId); if(!sale||sale.fullTaxInvoice) return;
  syncTaxInvoiceDraftFromDOM();
  const d=taxInvoiceDraft;
  if(!d.name){ showToast('กรุณากรอกชื่อลูกค้า'); document.getElementById('tax_form_customer_name')?.focus(); return; }
  d.taxId=String(d.taxId||'').replace(/\D/g,'');
  if(!/^\d{13}$/.test(d.taxId)){ showToast('เลขประจำตัวผู้เสียภาษีลูกค้าต้องมี 13 หลัก','danger'); document.getElementById('tax_form_customer_taxid')?.focus(); return; }
  if(d.branch==='สาขา'&&!/^\d{5}$/.test(String(d.branchNo||'').replace(/\D/g,''))){ showToast('เลขที่สาขาลูกค้าต้องมี 5 หลัก','danger'); document.getElementById('tax_form_customer_branch_no')?.focus(); return; }
  if(!d.address){ showToast('กรุณากรอกที่อยู่ลูกค้า'); document.getElementById('tax_form_customer_address')?.focus(); return; }
  const fullTaxInvoice={number:fullTaxInvoiceNumber(sale),saleDate:sale.date,issuedAt:auditNow(),customer:{name:d.name,taxId:d.taxId,address:d.address,branch:d.branch,branchNo:d.branchNo,phone:d.phone,email:d.email},note:d.note||'',printLog:[]};
  try{
    const updated=await updateSaleDocumentMetadata(sale.id,{fullTaxInvoice});
    editingTaxInvoiceSaleId=null; taxInvoiceDraft=null; taxInvoiceAddingCustomer=false;
    showToast(`บันทึกใบกำกับภาษี ${updated.fullTaxInvoice?.number||fullTaxInvoice.number} แล้ว`);
    render();
  }catch(error){
    console.warn('save tax invoice',error);
    showToast('บันทึกใบกำกับภาษีไม่สำเร็จ กรุณาลองใหม่','danger-top');
  }
}
