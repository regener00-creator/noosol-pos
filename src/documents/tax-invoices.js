function renderCashBillLookup(){
  return `<div class="pagehead"><div><div class="breadcrumb">บิลเงินสด › สร้างบิลเงินสด</div><h1>สร้างบิลเงินสด</h1></div><div class="form-final-actions"><button class="btn ghost" id="closeCashBillLookupBtn">ปิดหน้าต่าง</button></div></div>
    <div class="po-head"><div class="po-head-left"><div class="crow"><label>เลขออเดอร์ / เลขที่บิล <span class="req">*</span></label><div class="po-supplier-pick"><input id="cash_bill_order_number" value="${escapeHtml(cashBillOrderNumberDraft)}" placeholder="กรอกเลขออเดอร์ เลขที่บิล หรือเลขที่ใบเสร็จ" autocomplete="off"><button class="btn ghost" id="searchCashBillOrderBtn" type="button">ค้นหาออเดอร์</button><button class="btn primary" id="continueCashBillOrderBtn" type="button">ดำเนินการต่อ</button></div></div><div class="po-addr" style="margin-top:12px;">เลือกได้เฉพาะรายการที่ชำระเงินเรียบร้อยแล้ว ระบบจะใช้รายการและยอดขายเดิม</div></div>
      <div class="po-head-right"><div class="po-total-label">ขั้นตอนการออกบิลเงินสด</div><div style="line-height:1.8;color:var(--text-muted);font-size:13px;margin-top:8px;">1. กรอกเลขออเดอร์<br>2. กรอกข้อมูลผู้ซื้อ (ถ้ามี)<br>3. พิมพ์เอกสาร A4</div></div></div>
    <div class="panel" style="border-color:#DDCEC8;background:#FAF6F4;color:var(--primary-dark);">บิลเงินสดเป็นเอกสารรับเงิน ไม่ใช่ใบกำกับภาษี และการสร้างเอกสารจะไม่เพิ่มยอดขายหรือตัดสต๊อกซ้ำ</div>${posSalesHistoryModalOpen?renderPOSSalesHistoryModal():''}`;
}

function renderCashBills(){
  if(cashBillLookupOpen) return renderCashBillLookup();
  const docs=salesHistory.filter(s=>s.status==='done'&&s.cashReceiptA4Meta).sort((a,b)=>String(b.cashReceiptA4Meta?.issuedAt||b.date||'').localeCompare(String(a.cashReceiptA4Meta?.issuedAt||a.date||'')));
  const totalPages=Math.max(1,Math.ceil(docs.length/DOC_LIST_PAGE_SIZE));
  if(docListPage.cashbill>totalPages) docListPage.cashbill=totalPages;
  if(docListPage.cashbill<1) docListPage.cashbill=1;
  const start=(docListPage.cashbill-1)*DOC_LIST_PAGE_SIZE;
  const rows=docs.slice(start,start+DOC_LIST_PAGE_SIZE).map(s=>{ const meta=s.cashReceiptA4Meta||{},number=meta.number||shortReceiptNumber(s),buyer=meta.customer?.name||(typeof s.member==='object'?s.member?.name:s.member)||s.name||'ลูกค้าทั่วไป'; return `<tr><td class="mono">${escapeHtml(number)}</td><td>${escapeHtml(fmtDate(meta.saleDate||s.date))}</td><td class="doc-customer-cell">${escapeHtml(buyer)}</td><td class="doc-items-cell">${salesHistoryItemsPreview(s.items)}</td><td class="mono num">${fmtMoney(s.total)}</td><td class="num"><div class="history-actions"><button class="history-icon-btn" data-cashbill-edit="${escapeHtml(s.id)}" title="เปิดบิลเงินสด" aria-label="เปิดบิลเงินสด ${escapeHtml(number)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="history-icon-btn" data-cashbill-print="${escapeHtml(s.id)}" title="พิมพ์บิลเงินสด" aria-label="พิมพ์บิลเงินสด ${escapeHtml(number)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/></svg></button><button class="history-icon-btn danger" data-cashbill-delete="${escapeHtml(s.id)}" title="ลบเอกสาร" aria-label="ลบบิลเงินสด ${escapeHtml(number)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div></td></tr>`; }).join('');
  return `<div class="pagehead"><div><h1>บิลเงินสด <span class="page-title-meta">เอกสารรับเงินกระดาษ A4 · ${docs.length} รายการ</span></h1></div><button class="btn primary" id="newCashBillBtn">+ สร้างบิลเงินสด</button></div>
    <div class="doc-list-wrap seamless-table-wrap"><table class="grid-table doc-head-blue doc-summary-table customer-items-summary-table"><colgroup><col style="width:180px"><col style="width:120px"><col style="width:220px"><col><col style="width:120px"><col style="width:124px"></colgroup><thead><tr><th>เลขที่เอกสาร</th><th>วันที่</th><th>ผู้ซื้อ</th><th>รายการ</th><th class="mono">ยอดรวม</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px;">ยังไม่มีบิลเงินสด</td></tr>`}</tbody></table></div>
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

async function deleteCashBill(saleId){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale?.cashReceiptA4Meta) return;
  const number=sale.cashReceiptA4Meta.number||shortReceiptNumber(sale);
  if(!confirm(`ยืนยันลบบิลเงินสด ${number} ?\nยอดขายและสต๊อกจะไม่เปลี่ยนแปลง`)) return;
  try{
    await updateSaleDocumentMetadata(sale.id,{cashReceiptA4Meta:null});
    showToast(`ลบบิลเงินสด ${number} แล้ว`);
    render();
  }catch(error){
    console.warn('delete cash bill',error);
    showToast('ลบบิลเงินสดไม่สำเร็จ ข้อมูลเดิมยังอยู่','danger-top');
  }
}

function renderTaxInvoices(){
  if(editingTaxInvoiceSaleId!==null) return renderTaxInvoiceForm();
  const vatRegistered=isBusinessVatRegistered();
  const sales=salesHistory.filter(s=>s.status==='done'&&s.fullTaxInvoice);
  const allItems=[
    ...sales.map(s=>({date:s.date,number:s.fullTaxInvoice.number,buyer:s.fullTaxInvoice.customer?.name||'-',items:s.items,total:s.total,typeLabel:'ออกย้อนหลัง',delAct:`data-delete-tax-sale="${escapeHtml(s.id)}"`,openAct:`data-tax-sale="${escapeHtml(s.id)}"`,printAct:`data-print-tax="${escapeHtml(s.id)}"`,ariaNum:s.fullTaxInvoice.number})),
    ...standaloneTaxInvoices.map(doc=>({date:doc.saleDate||doc.date,number:doc.number,buyer:doc.customer?.name||'-',items:doc.items,total:doc.total,typeLabel:'สร้างใหม่',delAct:`data-delete-tax-doc="${escapeHtml(doc.number)}"`,openAct:`data-tax-doc="${escapeHtml(doc.number)}"`,printAct:`data-print-tax="${escapeHtml(doc.number)}"`,ariaNum:doc.number})),
  ].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const totalPages=Math.max(1, Math.ceil(allItems.length/DOC_LIST_PAGE_SIZE));
  if(docListPage.taxinvoice>totalPages) docListPage.taxinvoice=totalPages;
  if(docListPage.taxinvoice<1) docListPage.taxinvoice=1;
  const start=(docListPage.taxinvoice-1)*DOC_LIST_PAGE_SIZE;
  const pageItems=allItems.slice(start,start+DOC_LIST_PAGE_SIZE);
  const rowsHtml=pageItems.map(it=>`<tr><td class="mono">${escapeHtml(it.number)}</td><td>${fmtDate(it.date)}</td><td class="doc-customer-cell">${escapeHtml(it.buyer)}</td><td class="doc-items-cell">${salesHistoryItemsPreview(it.items)}</td><td class="mono num">${fmtMoney(it.total)}</td><td><span class="badge ok">${escapeHtml(it.typeLabel)}</span></td><td class="num"><div class="history-actions"><button class="history-icon-btn" ${it.openAct} title="แก้ไขเอกสาร" aria-label="แก้ไขใบกำกับภาษี ${escapeHtml(it.ariaNum)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="history-icon-btn" ${it.printAct} title="พิมพ์เอกสาร" aria-label="พิมพ์ใบกำกับภาษี ${escapeHtml(it.ariaNum)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/></svg></button><button class="history-icon-btn danger" ${it.delAct} title="ลบเอกสาร" aria-label="ลบใบกำกับภาษี ${escapeHtml(it.ariaNum)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div></td></tr>`).join('');
  return `<div class="pagehead"><div><h1>ใบกำกับภาษีเต็มรูปแบบ <span class="page-title-meta">สร้างเอกสารใหม่ หรือ ออกเอกสารจากออเดอร์ย้อนหลัง · ${allItems.length} รายการ</span></h1></div>${vatRegistered?`<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn ghost" id="historicalTaxInvoiceBtn">ออกใบกำกับภาษีย้อนหลัง</button><button class="btn primary" id="newTaxInvoiceBtn">+ สร้างใบกำกับภาษี</button></div>`:''}</div>
    ${vatRegistered?'':'<div class="panel" style="border-color:#f0c36d;background:#fff8e8;color:#855d12;">กิจการยังไม่จดภาษีมูลค่าเพิ่ม จึงสร้างใบกำกับภาษีใหม่ไม่ได้ แต่ยังเปิดดูหรือพิมพ์เอกสารเดิมได้</div>'}
    <div class="doc-list-wrap seamless-table-wrap">
    <table class="grid-table doc-head-blue doc-summary-table customer-items-summary-table"><colgroup><col style="width:170px"><col style="width:120px"><col style="width:220px"><col><col style="width:110px"><col style="width:100px"><col style="width:124px"></colgroup><thead><tr><th>เลขที่เอกสาร</th><th>วันที่</th><th>ผู้ซื้อ</th><th>รายการ</th><th class="mono">ยอดรวม</th><th>ประเภท</th><th></th></tr></thead><tbody>${rowsHtml||`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:28px;">ยังไม่มีใบกำกับภาษีเต็มรูปแบบ</td></tr>`}</tbody></table>
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
  if(!isBusinessVatRegistered()){ showToast('กิจการยังไม่จด VAT จึงสร้างใบกำกับภาษีไม่ได้','danger'); return; }
  editingTaxInvoiceSaleId='manual-new';
  taxInvoiceAddingCustomer=false;
  const number=nextFullTaxInvoiceNumber();
  taxInvoiceDraft={id:number,number,date:TODAY_STR,credit:0,dueDate:TODAY_STR,customerId:'',name:'',taxId:'',address:'',branch:'สำนักงานใหญ่',branchNo:'',phone:'',email:'',items:Array.from({length:3},()=>({name:'',qty:1,unit:'',price:''})),discount:0,note:''};
  currentTab='taxinvoice';
  render();
}

function openHistoricalTaxInvoiceForm(){
  if(!isBusinessVatRegistered()){ showToast('กิจการยังไม่จด VAT จึงออกใบกำกับภาษีย้อนหลังไม่ได้','danger'); return; }
  editingTaxInvoiceSaleId='lookup'; taxInvoiceDraft=null; taxInvoiceAddingCustomer=false; currentTab='taxinvoice'; render();
}

function renderTaxInvoiceOrderLookup(){
  return `<div class="pagehead"><div><div class="breadcrumb">ใบกำกับภาษีเต็มรูปแบบ › สร้างใบกำกับภาษี</div><h1>สร้างใบกำกับภาษีเต็มรูปแบบ</h1></div><div class="form-final-actions"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ปิดหน้าต่าง</button></div></div>
    <div class="po-head"><div class="po-head-left"><div class="crow"><label>เลขออเดอร์ / เลขที่บิล <span class="req">*</span></label><div class="po-supplier-pick"><input id="tax_order_number" placeholder="เช่น SR12345-1043, INV-1043 หรือเลขที่ใบเสร็จ" autocomplete="off"><button class="btn primary" id="searchTaxInvoiceOrderBtn" type="button">ค้นหาออเดอร์</button></div></div><div class="po-addr" style="margin-top:12px;">กรอกเลขออเดอร์จากประวัติการขาย ระบบจะดึงข้อมูลรายการเดิมมาให้อัตโนมัติ</div></div>
      <div class="po-head-right"><div class="po-total-label">ขั้นตอนการออกเอกสารย้อนหลัง</div><div style="line-height:1.8;color:var(--text-muted);font-size:13px;margin-top:8px;">1. กรอกเลขออเดอร์<br>2. ตรวจสอบและกรอกข้อมูลลูกค้า<br>3. บันทึกแล้วพิมพ์เอกสาร</div></div></div>
    <div class="doc-scanner-wrap"><div class="doc-scanner-hint" style="font-size:13px;color:var(--primary-dark);">🔎 ค้นหาได้จากเลขออเดอร์ เลขที่บิล หรือเลขที่ใบเสร็จอย่างย่อ</div></div>
    <table class="grid-table po-items document-centered-items"><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th class="mono">จำนวน</th><th>หน่วย</th><th class="mono">ราคาต่อหน่วย</th><th class="mono">ราคารวม</th></tr></thead><tbody><tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px;">กรอกเลขออเดอร์ด้านบนเพื่อแสดงรายการขายย้อนหลัง</td></tr></tbody></table>`;
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

function startStandaloneTaxInvoiceForm(number){
  const doc=standaloneTaxInvoices.find(item=>item.number===number); if(!doc) return;
  editingTaxInvoiceSaleId='manual:'+number;
  taxInvoiceAddingCustomer=false;
  const rawBranch=doc.customer?.branch;
  const branchText=rawBranch==='head'?'สำนักงานใหญ่':rawBranch==='branch'?'สาขา':(rawBranch||'สำนักงานใหญ่');
  taxInvoiceDraft={id:doc.number,number:doc.number,date:doc.saleDate||doc.date,credit:doc.credit||0,dueDate:doc.dueDate||addDaysToDate(doc.saleDate||doc.date,doc.credit||0),customerId:'',name:doc.customer?.name||'',taxId:doc.customer?.taxId||'',address:doc.customer?.address||'',branch:branchText,branchNo:doc.customer?.branchNo||'',phone:doc.customer?.phone||'',email:doc.customer?.email||'',items:JSON.parse(JSON.stringify(doc.items||[])),discount:doc.discount||0,note:doc.note||''};
  currentTab='taxinvoice';
  render();
}

function renderStandaloneTaxInvoiceForm(){
  const locked=String(editingTaxInvoiceSaleId).startsWith('manual:');
  const doc=locked?standaloneTaxInvoices.find(item=>item.number===String(editingTaxInvoiceSaleId).slice(7)):null;
  if(locked&&!doc) return '<div class="panel">ไม่พบใบกำกับภาษี</div>';
  const draft=taxInvoiceDraft;
  const items=draft.items||[];
  const discount=Number(draft.discount)||0;
  const tax=locked&&doc?.taxSummary?doc.taxSummary:calculateDocumentTaxSummary(items,discount,true,doc?.businessSnapshot||businessSettings);
  const subtotal=tax.subtotal,total=tax.total;
  const lockAttr=locked?'readonly':'';
  return `<div class="pagehead"><div><div class="breadcrumb">ใบกำกับภาษีเต็มรูปแบบ › ${locked?'ดูเอกสาร':'สร้างใบกำกับภาษี'}</div><h1>${draft.number}</h1></div>${locked?`<div class="form-final-actions" style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ปิดหน้าต่าง</button><button class="btn primary" id="printStandaloneTaxInvoiceBtn">🖨 พิมพ์</button></div>`:''}</div>
    <div class="po-head"><div class="po-head-left">
      <div class="crow tax-customer-picker-row"><div class="po-supplier-pick"><select id="tax_customer_select" ${locked?'disabled':''}><option value="">เลือกข้อมูลลูกค้าสำหรับออกเอกสาร</option>${customersList().map(c=>`<option value="${c.id}" ${String(draft.customerId)===String(c.id)||draft.name===c.name?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select>${locked?'':'<button class="btn ghost small" id="addTaxCustomerBtn" type="button">+ เพิ่มลูกค้า</button>'}</div></div>
      <div class="po-supplier-edit tax-customer-details" style="margin-top:10px;">${taxInvoiceAddingCustomer?'<div class="po-supplier-edit-title"><span>เพิ่มลูกค้าใหม่</span><span style="font-size:11px;color:var(--text-muted);font-weight:400;">บันทึกแล้วจะเพิ่มในสมุดรายชื่อทันที</span></div>':''}<div class="po-supplier-edit-grid">
        <div><label>ชื่อลูกค้า/บริษัท *</label><input id="tax_form_customer_name" value="${escapeHtml(draft.name||'')}" ${lockAttr}></div><div><label>เลขผู้เสียภาษี *</label><input id="tax_form_customer_taxid" value="${escapeHtml(draft.taxId||'')}" maxlength="13" ${lockAttr}></div>
        <div><label>สถานประกอบการ</label><input id="tax_form_customer_branch" value="${escapeHtml(draft.branch||'')}" placeholder="เช่น สำนักงานใหญ่ หรือ สาขา..." ${lockAttr}></div><div><label>เลขที่สาขา</label><input id="tax_form_customer_branch_no" value="${escapeHtml(draft.branchNo||'')}" maxlength="5" ${lockAttr}></div>
        <div class="wide"><label>ที่อยู่ *</label><textarea id="tax_form_customer_address" rows="2" ${lockAttr}>${escapeHtml(draft.address||'')}</textarea></div><div><label>เบอร์โทรศัพท์</label><input id="tax_form_customer_phone" class="phone-input" value="${escapeHtml(draft.phone||'')}" ${lockAttr}></div><div><label>อีเมล</label><input id="tax_form_customer_email" type="email" value="${escapeHtml(draft.email||'')}" ${lockAttr}></div>
      </div>${!locked&&taxInvoiceAddingCustomer?'<div class="po-supplier-edit-actions"><button class="btn ghost small" id="cancelTaxCustomerBtn" type="button">ยกเลิก</button><button class="btn primary small" id="saveTaxCustomerBtn" type="button">บันทึกเข้ารายชื่อลูกค้า</button></div>':''}</div></div>
      <div class="po-head-right"><div class="po-total-label">จำนวนเงินรวมทั้งสิ้น</div><div class="po-total-amt mono">${fmtMoney(total)}</div><div class="crow"><label>วันที่</label>${dmyDateFieldHtml('po_date',draft.date,locked?{readonly:true,extraClass:'due-readonly'}:{})}</div><div class="crow"><label>เครดิต (วัน)</label><input id="po_credit" type="number" min="0" value="${draft.credit||0}" ${locked?'readonly class="due-readonly"':''}></div><div class="crow"><label>ครบกำหนด</label>${dmyDateFieldHtml('po_due',addDaysToDate(draft.date,draft.credit||0),{readonly:true,extraClass:'due-readonly'})}</div></div>
    </div>
    ${locked?'<div class="doc-scanner-wrap"><div class="doc-scanner-hint" style="font-size:13px;color:var(--primary-dark);">🔒 เอกสารถูกล็อกแล้ว</div></div>':documentProductScannerHtml()}
    <table class="grid-table po-items document-centered-items"><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th class="mono">จำนวน</th><th>หน่วย</th><th class="mono">ราคาต่อหน่วย</th><th class="mono">ราคารวม</th>${locked?'':'<th></th>'}</tr></thead><tbody id="poItemRows">${locked?items.map((item,index)=>`<tr><td class="mono">${index+1}</td><td>${escapeHtml(item.name)}</td><td class="mono num">${item.qty}</td><td>${escapeHtml(item.unit||'-')}</td><td class="mono num">${fmtMoney(item.price)}</td><td class="mono num">${fmtMoney(item.qty*item.price)}</td></tr>`).join(''):items.map((item,index)=>poItemRowHtml(item,index)).join('')}</tbody></table>${locked?'':'<button class="btn ghost small" id="addTaxInvoiceItemBtn" style="margin-top:8px;">+ เพิ่มแถวรายการ</button>'}
    <div class="po-foot"><div class="po-foot-left"><div class="crow"><label>หมายเหตุ</label><textarea id="po_note" rows="3" ${lockAttr}>${escapeHtml(draft.note||'')}</textarea></div>${locked?`<div style="margin-top:10px;color:var(--text-muted);font-size:12px;">ออกเอกสารเมื่อ ${auditDisplay(doc.issuedAt)} · พิมพ์แล้ว ${doc.printLog?.length||0} ครั้ง</div>`:'<div style="margin-top:10px;color:var(--text-muted);font-size:12px;">เอกสารนี้ไม่ตัดสต็อกและไม่เพิ่มยอดขาย POS โดยอัตโนมัติ</div>'}</div>
      <div class="po-foot-right"><div class="sumrow"><span>รวมเป็นเงิน</span><span class="mono">${fmtMoney(subtotal)}</span></div><div class="sumrow"><span>ส่วนลด</span><span class="sumdiscount">${locked?`<span class="mono">${fmtMoney(discount)}</span>`:`<input id="po_discount" type="number" value="${discount}" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;text-align:right;">`}</span></div><div class="sumrow"><span>ราคาหลังหักส่วนลด</span><span class="mono">${fmtMoney(total)}</span></div>${taxSummaryRowsHtml(tax)}<div class="sumrow grand"><span>จำนวนเงินรวมทั้งสิ้น</span><span class="mono">${fmtMoney(total)}</span></div></div></div>${locked?'':`<div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ปิดหน้าต่าง</button><button class="btn primary" id="saveStandaloneTaxInvoiceBtn">บันทึกเอกสาร</button></div>`}`;
}

function saveStandaloneTaxInvoice(){
  if(!isBusinessVatRegistered()){ showToast('กิจการยังไม่จด VAT จึงบันทึกใบกำกับภาษีไม่ได้','danger'); return; }
  if(editingTaxInvoiceSaleId!=='manual-new') return;
  syncPOFromDOM(); syncTaxInvoiceDraftFromDOM();
  const d=taxInvoiceDraft,items=(d.items||[]).filter(item=>item.name&&Number(item.qty)>0);
  if(!d.name){ showToast('กรุณากรอกชื่อลูกค้า'); return; }
  d.taxId=String(d.taxId||'').replace(/\D/g,'');
  if(!/^\d{13}$/.test(d.taxId)){ showToast('เลขประจำตัวผู้เสียภาษีลูกค้าต้องมี 13 หลัก','danger'); return; }
  if(d.branch==='สาขา'&&!/^\d{5}$/.test(String(d.branchNo||'').replace(/\D/g,''))){ showToast('เลขที่สาขาลูกค้าต้องมี 5 หลัก','danger'); return; }
  if(!d.address){ showToast('กรุณากรอกที่อยู่ลูกค้า'); return; }
  if(!items.length){ showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ'); return; }
  const discount=Number(d.discount)||0;
  const itemsWithVat=items.map(item=>({...item,productId:item.productId||item.pid||documentProductForTax(item)?.id||null,vatMode:documentItemVatMode(item,true,businessSettings)}));
  const taxSummary=calculateDocumentTaxSummary(itemsWithVat,discount,true,businessSettings);
  const doc={id:d.number,number:d.number,date:d.date,saleDate:d.date,credit:d.credit||0,dueDate:addDaysToDate(d.date,d.credit||0),issuedAt:auditNow(),customer:{name:d.name,taxId:d.taxId,address:d.address,branch:d.branch,branchNo:d.branchNo,phone:d.phone,email:d.email},items:itemsWithVat,discount,total:taxSummary.total,vatRegistered:true,taxSummary,businessSnapshot:businessDocumentSnapshot(),note:d.note||'',printLog:[]};
  standaloneTaxInvoices.unshift(doc); persistStandaloneTaxInvoices();
  editingTaxInvoiceSaleId=null; taxInvoiceDraft=null; taxInvoiceAddingCustomer=false;
  showToast(`บันทึกใบกำกับภาษี ${doc.number} แล้ว`);
  render();
}

function startTaxInvoiceForm(saleId){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale||sale.status!=='done') return;
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
  if(document.getElementById('tax_form_customer_branch')) taxInvoiceDraft.branch=get('tax_form_customer_branch').trim()||'สำนักงานใหญ่';
  if(document.getElementById('tax_form_customer_branch_no')) taxInvoiceDraft.branchNo=get('tax_form_customer_branch_no').trim();
  taxInvoiceDraft.phone=get('tax_form_customer_phone').trim();
  taxInvoiceDraft.email=get('tax_form_customer_email').trim();
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
  const customer={id:generateClientRecordId(contacts),name,entity:d.taxId?'juristic':'individual',types:['customer'],contactName:'',phone:d.phone||'',email:d.email||'',taxId:d.taxId||'',creditDays:d.credit||'',address:d.address||'',bank:'',bankAcc:'',note:''};
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
  return `<div class="pagehead"><div><div class="breadcrumb">ใบกำกับภาษีเต็มรูปแบบ › ${locked?'ดูเอกสาร':'สร้างใบกำกับภาษี'}</div><h1>${docNo}</h1></div>${locked?`<div class="form-final-actions" style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ปิดหน้าต่าง</button><button class="btn primary" id="printTaxInvoiceFormBtn">🖨 พิมพ์</button></div>`:''}</div>
    <div class="po-head">
      <div class="po-head-left">
        <div class="crow tax-customer-picker-row"><div class="po-supplier-pick"><select id="tax_customer_select" ${locked?'disabled':''}><option value="">เลือกข้อมูลลูกค้าสำหรับออกเอกสาร</option>${customersList().map(c=>`<option value="${c.id}" ${String(draft.customerId)===String(c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select>${locked?'':'<button class="btn ghost small" id="addTaxCustomerBtn" type="button">+ เพิ่มลูกค้า</button>'}</div></div>
        <div class="po-supplier-edit tax-customer-details" style="margin-top:10px;">${taxInvoiceAddingCustomer?'<div class="po-supplier-edit-title"><span>เพิ่มลูกค้าใหม่</span><span style="font-size:11px;color:var(--text-muted);font-weight:400;">บันทึกแล้วจะเพิ่มในสมุดรายชื่อทันที</span></div>':''}<div class="po-supplier-edit-grid">
          <div><label>ชื่อลูกค้า/บริษัท *</label><input id="tax_form_customer_name" value="${escapeHtml(draft.name||'')}" ${lockAttr}></div><div><label>เลขผู้เสียภาษี *</label><input id="tax_form_customer_taxid" value="${escapeHtml(draft.taxId||'')}" maxlength="13" ${lockAttr}></div>
          <div><label>สถานประกอบการ</label><input id="tax_form_customer_branch" value="${escapeHtml(draft.branch||'')}" placeholder="เช่น สำนักงานใหญ่ หรือ สาขา..." ${lockAttr}></div><div><label>เลขที่สาขา</label><input id="tax_form_customer_branch_no" value="${escapeHtml(draft.branchNo||'')}" maxlength="5" ${lockAttr}></div>
          <div class="wide"><label>ที่อยู่ *</label><textarea id="tax_form_customer_address" rows="2" ${lockAttr}>${escapeHtml(draft.address||'')}</textarea></div>
          <div><label>เบอร์โทรศัพท์</label><input id="tax_form_customer_phone" class="phone-input" value="${escapeHtml(draft.phone||'')}" ${lockAttr}></div><div><label>อีเมล</label><input id="tax_form_customer_email" type="email" value="${escapeHtml(draft.email||'')}" ${lockAttr}></div>
        </div>${!locked&&taxInvoiceAddingCustomer?'<div class="po-supplier-edit-actions"><button class="btn ghost small" id="cancelTaxCustomerBtn" type="button">ยกเลิก</button><button class="btn primary small" id="saveTaxCustomerBtn" type="button">บันทึกเข้ารายชื่อลูกค้า</button></div>':''}</div>
      </div>
      <div class="po-head-right"><div class="po-total-label">จำนวนเงินรวมทั้งสิ้น</div><div class="po-total-amt mono">${fmtMoney(total)}</div>
        <div class="crow"><label>วันที่</label>${dmyDateFieldHtml('sale_date_view',sale.date,{readonly:true,extraClass:'due-readonly'})}</div>
        <div class="crow"><label>เลขที่บิลอ้างอิง</label><input value="${escapeHtml(sale.ref||shortReceiptNumber(sale))}" readonly class="due-readonly"></div>
        <div class="crow"><label>วิธีชำระ</label><input value="${escapeHtml(sale.payMethod||'-')}" readonly class="due-readonly"></div>
      </div>
    </div>
    <div class="doc-scanner-wrap"><div class="doc-scanner-hint" style="font-size:13px;color:var(--primary-dark);">🔒 รายการสินค้าดึงจากบิลขายเดิมและไม่สามารถแก้ไขได้ เพื่อป้องกันยอดขายและสต็อกคลาดเคลื่อน</div></div>
    <table class="grid-table po-items document-centered-items"><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th class="mono">จำนวน</th><th>หน่วย</th><th class="mono">ราคาต่อหน่วย</th><th class="mono">ราคารวม</th></tr></thead><tbody>${(sale.items||[]).map((item,index)=>`<tr><td class="mono">${index+1}</td><td>${escapeHtml(item.name)}</td><td class="mono num">${item.qty}</td><td>${escapeHtml(item.unit||'-')}</td><td class="mono num">${fmtMoney(grossAmountForVatMode(item.price,item.vatMode,tax.registered))}</td><td class="mono num">${fmtMoney(item.lineTotalGross!==undefined?item.lineTotalGross:grossAmountForVatMode(item.qty*item.price,item.vatMode,tax.registered))}</td></tr>`).join('')}</tbody></table>
    <div class="po-foot"><div class="po-foot-left"><div class="crow"><label>หมายเหตุ</label><textarea id="tax_form_note" rows="3" ${lockAttr}>${escapeHtml(draft.note||'')}</textarea></div>${locked?`<div style="margin-top:10px;color:var(--text-muted);font-size:12px;">ออกเอกสารเมื่อ ${auditDisplay(invoice.issuedAt)} · พิมพ์แล้ว ${invoice.printLog?.length||0} ครั้ง</div>`:''}</div>
      <div class="po-foot-right"><div class="sumrow"><span>รวมเป็นเงิน</span><span class="mono">${fmtMoney(subtotal)}</span></div>${discount?`<div class="sumrow"><span>ส่วนลด</span><span class="mono">- ${fmtMoney(discount)}</span></div>`:''}<div class="sumrow"><span>ราคาหลังหักส่วนลด</span><span class="mono">${fmtMoney(total)}</span></div>${taxSummaryRowsHtml(tax)}<div class="sumrow grand"><span>จำนวนเงินรวมทั้งสิ้น</span><span class="mono">${fmtMoney(total)}</span></div></div></div>${locked?'':`<div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ปิดหน้าต่าง</button><button class="btn primary" id="saveTaxInvoiceFormBtn">บันทึกเอกสาร</button></div>`}`;
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
