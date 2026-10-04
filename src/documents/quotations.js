function renderQuotation(){
  if(editingQuotationId!==null) return renderQuotationForm();
  const totalPages=Math.max(1, Math.ceil(quotations.length/DOC_LIST_PAGE_SIZE));
  if(docListPage.quotation>totalPages) docListPage.quotation=totalPages;
  if(docListPage.quotation<1) docListPage.quotation=1;
  const start=(docListPage.quotation-1)*DOC_LIST_PAGE_SIZE;
  const pageDocs=quotations.slice(start,start+DOC_LIST_PAGE_SIZE);
  return `<div class="pagehead"><div><h1>ใบเสนอราคา <span class="page-title-meta">เสนอราคา ก่อนสั่งซื้อจริง · ${quotations.length} รายการ</span></h1></div><button class="btn primary" id="newQuoteBtn">+ สร้างใบเสนอราคา</button></div>
  ${documentBulkToolbar('quotation')}
  <div class="doc-list-wrap">
  <table class="grid-table doc-list doc-head-blue doc-summary-table customer-items-summary-table quotation-summary-table"><colgroup><col class="quotation-col-check"><col style="width:16%"><col style="width:11%"><col style="width:18%"><col><col style="width:11%"><col class="quotation-col-actions"></colgroup><thead><tr><th><input class="doc-check" type="checkbox" aria-label="เลือกทั้งหมด"></th><th>เลขที่</th><th>วันที่</th><th>ลูกค้า</th><th>รายการ</th><th class="mono">ยอดรวม</th><th></th></tr></thead>
  <tbody>${pageDocs.map(q=>`<tr><td style="text-align:center;"><input class="doc-check" type="checkbox" value="${escapeHtml(q.id)}" aria-label="เลือก ${escapeHtml(q.id)}"></td><td class="mono">${escapeHtml(q.id)}</td><td>${fmtDate(q.date)}</td><td class="doc-customer-cell">${escapeHtml(q.customer)}</td><td class="doc-items-cell">${salesHistoryItemsPreview(q.items)}</td><td class="mono num">${fmtMoney(q.total)}</td><td class="num"><div class="history-actions"><button class="history-icon-btn quotation-to-pos" data-sell-quotation="${escapeHtml(q.id)}" title="นำไปขายที่ POS" aria-label="นำใบเสนอราคา ${escapeHtml(q.id)} ไปขายที่ POS"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3h2l2.4 10.5a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 2-1.6L21 7H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg></button><button class="history-icon-btn" data-print-quotation="${escapeHtml(q.id)}" title="พิมพ์ใบเสนอราคา" aria-label="พิมพ์ใบเสนอราคา ${escapeHtml(q.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/></svg></button><button class="history-icon-btn" data-edit-quotation="${escapeHtml(q.id)}" title="แก้ไขเอกสาร" aria-label="แก้ไขใบเสนอราคา ${escapeHtml(q.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="history-icon-btn danger" data-delete-quotation="${escapeHtml(q.id)}" title="ลบใบเสนอราคา" aria-label="ลบใบเสนอราคา ${escapeHtml(q.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div></td></tr>`).join('')||'<tr><td colspan="7" style="padding:30px;text-align:center;color:var(--text-muted);">ยังไม่มีใบเสนอราคา</td></tr>'}</tbody></table>
  </div>
  ${pagerHtml(docListPage.quotation, totalPages, 'docpage-quotation')}`;
}

function openNewQuotationForm(){
  editingQuotationId='new'; taxInvoiceAddingCustomer=false;
  const prefix=documentPrefixes.quotation;
  const number=buildDocNumber(prefix, nextDailySeq(prefix, quotations.map(q=>q.id)));
  taxInvoiceDraft={id:number,number,date:TODAY_STR,credit:0,dueDate:TODAY_STR,customerId:'',name:'',taxId:'',address:'',branch:'สำนักงานใหญ่',branchNo:'',phone:'',email:'',items:[{name:'',qty:1,unit:'',price:''}],discount:0,note:''};
  currentTab='quotation'; render();
}

function openQuotationForm(id){
  const doc=quotations.find(item=>item.id===id); if(!doc) return;
  const customer=doc.customerInfo||{};
  editingQuotationId=id; taxInvoiceAddingCustomer=false;
  const rawBranch=customer.branch;
  const branchText=rawBranch==='head'?'สำนักงานใหญ่':rawBranch==='branch'?'สาขา':(rawBranch||'สำนักงานใหญ่');
  taxInvoiceDraft={id:doc.id,number:doc.id,date:doc.date||TODAY_STR,credit:doc.credit||0,dueDate:doc.dueDate||addDaysToDate(doc.date||TODAY_STR,doc.credit||0),customerId:customer.id||'',name:customer.name||doc.customer||'',taxId:customer.taxId||'',address:customer.address||'',branch:branchText,branchNo:customer.branchNo||'',phone:customer.phone||'',email:customer.email||'',items:JSON.parse(JSON.stringify(doc.items||[])),discount:doc.discount||0,note:doc.note||''};
  const linkedCustomer=customersList().find(item=>String(item.id)===String(customer.id));
  Object.assign(taxInvoiceDraft,{entity:customer.entity||linkedCustomer?.entity||'individual',line:customer.line??linkedCustomer?.line??'',contactTypes:customer.types||linkedCustomer?.types||['customer']});
  currentTab='quotation'; render();
}

function renderQuotationForm(){
  const draft=taxInvoiceDraft||{};
  const isJuristic=draft.entity==='juristic';
  const customerTypes=draft.contactTypes||['customer'];
  const items=draft.items||[];
  const registered=isBusinessVatRegistered(),discount=Number(draft.discount)||0;
  const tax=calculateDocumentTaxSummary(items,discount,registered,businessSettings);
  const subtotal=tax.subtotal,total=tax.total;
  return `<div class="pagehead"><div><div class="breadcrumb">ใบเสนอราคา › สร้างใบเสนอราคา</div><h1>ใบเสนอราคา</h1><div class="sub mono">${escapeHtml(draft.number||'')}</div></div></div>
    <div class="po-head"><div class="po-head-left">
      <div class="crow tax-customer-picker-row"><div class="po-supplier-pick">${documentPartyFieldHtml('tax_customer_select',draft.customerId,'customer')}</div></div>
      <div class="tax-customer-details contact-editor-grid" style="margin-top:18px;">
        <div class="contact-editor-field"><label>ประเภท</label><div class="cradio"><label><input type="checkbox" disabled ${customerTypes.includes('customer')?'checked':''}> ลูกค้า</label><label><input type="checkbox" disabled ${customerTypes.includes('supplier')?'checked':''}> ผู้จำหน่าย</label></div></div>
        <div class="contact-editor-field"><label>ประเภทผู้ติดต่อ</label><div class="cradio"><label><input type="radio" name="quotation_customer_entity" value="juristic" ${isJuristic?'checked':''}> นิติบุคคล</label><label><input type="radio" name="quotation_customer_entity" value="individual" ${!isJuristic?'checked':''}> บุคคลธรรมดา</label></div></div>
        <div class="contact-editor-identity-row contact-editor-identity-row-customer-edit contact-editor-wide">
          <div class="contact-editor-field"><label for="tax_form_customer_name">ชื่อ-นามสกุล <span class="req">*</span></label><input id="tax_form_customer_name" value="${escapeHtml(draft.name||'')}"></div>
          <div class="contact-editor-field"><label id="quotation_customer_taxid_label" for="tax_form_customer_taxid">${isJuristic?'เลขผู้เสียภาษี':'เลขบัตรประชาชน'}</label><input id="tax_form_customer_taxid" value="${escapeHtml(draft.taxId||'')}" maxlength="13" inputmode="numeric" placeholder="${isJuristic?'เลขผู้เสียภาษี':'เลขบัตรประชาชน'} 13 หลัก (ไม่บังคับ)"></div>
          <div class="contact-editor-field"><label for="po_credit">เครดิต</label><input id="po_credit" type="number" min="0" value="${escapeHtml(draft.credit||'')}" placeholder="0 วัน"></div>
        </div>
        <div class="contact-editor-field contact-editor-wide"><label for="tax_form_customer_address">ที่อยู่</label><textarea id="tax_form_customer_address" rows="3">${escapeHtml(draft.address||'')}</textarea></div>
        <div class="contact-editor-contact-row contact-editor-wide">
          <div class="contact-editor-field"><label for="tax_form_customer_email">อีเมล์</label><input id="tax_form_customer_email" type="email" value="${escapeHtml(draft.email||'')}"></div>
          <div class="contact-editor-field"><label for="tax_form_customer_line">ไลน์</label><input id="tax_form_customer_line" value="${escapeHtml(draft.line||'')}"></div>
          <div class="contact-editor-field"><label for="tax_form_customer_phone">เบอร์โทร</label><input id="tax_form_customer_phone" class="phone-input" value="${escapeHtml(draft.phone||'')}"></div>
        </div>
      </div></div>
      <div class="po-head-right"><div class="crow"><label>วันที่</label>${dmyDateFieldHtml('po_date',draft.date||TODAY_STR)}</div><div class="po-total-label">จำนวนเงินรวมทั้งสิ้น</div><div class="po-total-amt mono">${fmtMoney(total)}</div></div>
    </div>
    ${documentProductScannerHtml()}
    <table class="grid-table po-items document-centered-items"><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th class="mono">จำนวน</th><th>หน่วย</th><th class="mono">ราคาต่อหน่วย</th><th class="mono">ราคารวม</th><th></th></tr></thead><tbody id="poItemRows">${items.map((item,index)=>poItemRowHtml(item,index)).join('')}</tbody></table><button class="btn ghost small" id="addTaxInvoiceItemBtn" style="margin-top:8px;">+ เพิ่มแถวรายการ</button>
    <div class="po-foot"><div class="po-foot-left"><div class="crow"><label>หมายเหตุ</label><textarea id="po_note" rows="3">${escapeHtml(draft.note||'')}</textarea></div><div style="margin-top:10px;color:var(--text-muted);font-size:12px;">ใบเสนอราคาไม่ตัดสต็อกและไม่เพิ่มยอดขาย POS โดยอัตโนมัติ</div></div>
      <div class="po-foot-right"><div class="sumrow"><span>รวมเป็นเงิน</span><span class="mono">${fmtMoney(subtotal)}</span></div><div class="sumrow"><span>ส่วนลด</span><span class="sumdiscount"><input id="po_discount" type="number" value="${discount}" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;text-align:right;"></span></div><div class="sumrow"><span>ราคาหลังหักส่วนลด</span><span class="mono">${fmtMoney(total)}</span></div>${taxSummaryRowsHtml(tax)}<div class="sumrow grand"><span>จำนวนเงินรวมทั้งสิ้น</span><span class="mono">${fmtMoney(total)}</span></div></div></div><div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelTaxInvoiceFormBtn">ปิดหน้าต่าง</button><button class="btn primary" id="saveQuotationBtn">บันทึกเอกสาร</button></div>`;
}

function saveQuotation(){
  syncPOFromDOM(); syncTaxInvoiceDraftFromDOM();
  const d=taxInvoiceDraft,items=(d.items||[]).filter(item=>item.name&&Number(item.qty)>0);
  if(!d.name){ showToast('กรุณากรอกชื่อลูกค้า'); return; }
  if(!items.length){ showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ'); return; }
  if(items.some(item=>!products.some(product=>product.name===item.name))){ showToast('กรุณาเลือกสินค้าจากผลการค้นหา'); return; }
  const discount=Number(d.discount)||0,vatRegistered=isBusinessVatRegistered();
  const itemsWithVat=items.map(item=>({...item,productId:item.productId||item.pid||documentProductForTax(item)?.id||null,vatMode:documentItemVatMode(item,vatRegistered,businessSettings)}));
  const taxSummary=calculateDocumentTaxSummary(itemsWithVat,discount,vatRegistered,businessSettings);
  const total=taxSummary.total;
  const old=editingQuotationId!=='new'?quotations.find(doc=>doc.id===editingQuotationId):null;
  // Keep the revision and immutable provenance when rebuilding an edited document.
  // Losing _revision turns an update into a duplicate create (expected revision 0).
  const record={...old,id:d.number,date:d.date,credit:d.credit||0,dueDate:addDaysToDate(d.date,d.credit||0),customer:d.name,customerInfo:{id:d.customerId||'',name:d.name,taxId:d.taxId,address:d.address,branch:d.branch,branchNo:d.branchNo,phone:d.phone,email:d.email},items:itemsWithVat,discount,total,vatRegistered,taxSummary,businessSnapshot:old?.businessSnapshot||businessDocumentSnapshot(),note:d.note||'',status:old?.status||'รอตอบรับ'};
  Object.assign(record.customerInfo,{entity:d.entity||'individual',line:d.line||'',types:d.contactTypes||['customer']});
  if(editingQuotationId==='new'){ quotations.unshift(record); }else{ const index=quotations.findIndex(doc=>doc.id===editingQuotationId); if(index>-1) quotations[index]=record; }
  persistQuotations(); editingQuotationId=null; taxInvoiceDraft=null; taxInvoiceAddingCustomer=false; showToast(`กำลังเก็บและซิงก์ใบเสนอราคา ${record.id} กรุณาตรวจสถานะซิงก์`); render();
}

function deleteQuotation(id){
  const quotation=quotations.find(doc=>doc.id===id); if(!quotation) return;
  if(!confirm(`ยืนยันลบใบเสนอราคา ${quotation.id} ?`)) return;
  quotations=quotations.filter(doc=>doc.id!==id); persistQuotations(); showToast(`ลบใบเสนอราคา ${quotation.id} แล้ว`); render();
}
