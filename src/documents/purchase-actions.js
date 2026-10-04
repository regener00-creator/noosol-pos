function updateDocumentSelectionUI(){
  const rows=[...document.querySelectorAll('.doc-list tbody .doc-check')];
  const selected=rows.filter(box=>box.checked);
  rows.forEach(box=>box.closest('tr')?.classList.toggle('selected',box.checked));
  const head=document.querySelector('.doc-list thead .doc-check');
  if(head){ head.checked=rows.length>0&&selected.length===rows.length; head.indeterminate=selected.length>0&&selected.length<rows.length; }
  const bar=document.getElementById('docBulkbar'); if(bar) bar.hidden=selected.length===0;
  const count=document.getElementById('docSelectedCount'); if(count) count.textContent=selected.length;
}
function selectedDocumentIds(){ return [...document.querySelectorAll('.doc-list tbody .doc-check:checked')].map(box=>box.value); }
function deleteShortageOrders(ids){
  ids=[...new Set(ids||[])].filter(Boolean); if(!ids.length) return;
  const message=ids.length===1?'ยืนยันลบรายการสั่งซื้อนี้หรือไม่?':`ยืนยันลบรายการสั่งซื้อที่เลือกทั้งหมด ${ids.length} รายการหรือไม่?`;
  if(!confirm(message)) return;
  let deleted=0;
  for(let i=purchaseOrders.length-1;i>=0;i--){ if(ids.includes(purchaseOrders[i].id)){ purchaseOrders.splice(i,1); deleted++; } }
  persistWorkspaceData();
  showToast(`ลบรายการสั่งซื้อ ${deleted} รายการแล้ว`);
  render();
}
function documentHasPostedStock(kind,doc){
  if(!doc) return false;
  if(kind==='gr'||kind==='ret') return doc.stockApplied===true;
  if(kind==='exchange') return doc.outgoingApplied===true||doc.incomingApplied===true||['ส่งไปเปลี่ยนแล้ว','รับสินค้ากลับแล้ว'].includes(doc.status);
  if(kind==='transfer') return doc.stockApplied!==false;
  return false;
}
function refusePostedDocumentDeletion(kind,doc){
  if(!documentHasPostedStock(kind,doc)) return false;
  showToast(`ลบ ${doc.id||'เอกสารนี้'} ไม่ได้ เพราะเอกสารนี้เคยส่งผลต่อสต๊อกแล้ว กรุณาเก็บไว้เป็นประวัติ`,'danger');
  return true;
}
function deleteSelectedDocuments(kind,ids){
  ids=[...new Set(ids||[])].filter(Boolean);
  if(!ids.length) return;
  if(kind==='po'){ deleteShortageOrders(ids); return; }

  if(kind==='quotation'){
    const selected=quotations.filter(doc=>ids.includes(doc.id));
    if(!selected.length) return;
    const message=selected.length===1
      ?`ยืนยันลบใบเสนอราคา ${selected[0].id} ?`
      :`ยืนยันลบใบเสนอราคาที่เลือกทั้งหมด ${selected.length} รายการหรือไม่?`;
    if(!confirm(message)) return;
    quotations=quotations.filter(doc=>!ids.includes(doc.id));
    persistQuotations();
    showToast(`ลบใบเสนอราคา ${selected.length} รายการแล้ว`);
    render();
    return;
  }

  if(kind==='ret'){
    const list=docList(kind);
    const selected=list.filter(doc=>ids.includes(doc.id));
    if(!selected.length) return;
    const posted=selected.find(doc=>documentHasPostedStock(kind,doc));
    if(posted){ refusePostedDocumentDeletion(kind,posted); return; }
    const label=docLabelText(kind);
    const message=selected.length===1
      ?`ยืนยันลบ ${selected[0].id} ?`
      :`ยืนยันลบ${label}ที่เลือกทั้งหมด ${selected.length} รายการหรือไม่?`;
    if(!confirm(message)) return;
    for(let index=list.length-1;index>=0;index--){ if(ids.includes(list[index].id)) list.splice(index,1); }
    persistWorkspaceData();
    showToast(`ลบ${label} ${selected.length} รายการแล้ว`);
    render();
  }
}
function printSelectedDocuments(){
  const ids=selectedDocumentIds(); if(!ids.length) return;
  const kind=document.getElementById('docBulkbar')?.dataset.kind||'po';
  if(kind==='quotation'){ printQuotation(ids); return; }
  printPO(ids,kind);
}
function openGoodsReceiptPayment(id){
  const doc=goodsReceipts.find(x=>x.id===id); if(!doc) return;
  if(!canManageGoodsReceipt(doc)){ showToast('บันทึกการชำระเงินไม่ได้ เพราะใบรับสินค้านี้สร้างโดยผู้ใช้งานอื่น','danger-top'); return; }
  if(doc.stockApplied!==true){ showToast('กรุณาเปลี่ยนสถานะเป็น “รับสินค้าแล้ว” ก่อนชำระเงิน'); render(); return; }
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal payment-modal">
    <div class="modal-head"><h3>บันทึกการชำระเงิน</h3><button class="modal-close" aria-label="ปิด">×</button></div>
    <div class="payment-body">
      <div class="payment-summary"><b>เลขที่เอกสาร:</b><strong>${escapeHtml(doc.id)} (${escapeHtml(doc.supplier)})</strong><b>ยอดที่ต้องชำระ:</b><span>${fmtMoney(doc.total)} บาท</span></div>
      <div class="payment-row"><label>วันที่ชำระ:</label><input id="pay_date" class="dmy-input" type="text" inputmode="numeric" maxlength="10" autocomplete="off" value="${isoToDMY(TODAY_STR)}" placeholder="วว/ดด/ปปปป"></div>
      <div class="payment-row"><label>ยอดจ่ายสุทธิ:</label><input id="pay_amount" type="number" min="0" step="0.01" value="${(Number(doc.total)||0).toFixed(2)}"></div>
      <div class="payment-row"><label></label><label class="payment-check"><input id="pay_withholding" type="checkbox"> หัก ณ ที่จ่าย</label></div>
      <div class="payment-row"><label>ยอดเงินขาด/เงินเกิน:</label><div class="payment-diff"><span id="pay_diff">0.00</span> บาท</div></div>
      <div class="payment-row"><label>ระบุสาเหตุ:</label><div><div class="payment-radio"><label><input type="radio" name="pay_reason_type" value="business" checked> หมวดหมู่ธุรกิจ</label><label><input type="radio" name="pay_reason_type" value="accounting"> หมวดหมู่นักบัญชี</label></div><select id="pay_reason" style="margin-top:12px;"><option value="">กรุณาเลือกสาเหตุ</option><option>ส่วนลดจากผู้จำหน่าย</option><option>ค่าธรรมเนียม</option><option>ยอดปัดเศษ</option><option>อื่น ๆ</option></select></div></div>
      <div class="payment-section">วิธีการชำระ</div>
      <div class="payment-row"><label>วิธีการชำระ:</label><select id="pay_method"><option>เงินสด</option><option>โอนธนาคาร</option><option>บัตรเครดิต</option><option>เช็ค</option></select></div>
      <div class="payment-section">รายละเอียดเพิ่มเติม</div>
      <div class="payment-row"><label>หมายเหตุ:</label><textarea id="pay_note" rows="4"></textarea></div>
    </div>
    <div class="payment-actions"><button class="btn ghost" id="cancelPaymentBtn">ยกเลิก</button><button class="btn save-payment" id="savePaymentBtn">บันทึก</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>{ overlay.remove(); render(); };
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#cancelPaymentBtn').onclick=close;

  const amount=overlay.querySelector('#pay_amount'), diff=overlay.querySelector('#pay_diff');
  const updateDiff=()=>{ diff.textContent=fmtMoney((parseFloat(amount.value)||0)-(Number(doc.total)||0)); };
  amount.addEventListener('input',updateDiff); updateDiff();
  const savePaymentBtn=overlay.querySelector('#savePaymentBtn');
  savePaymentBtn.onclick=async()=>{
    const paid=parseFloat(amount.value); if(isNaN(paid)||paid<0){ showToast('กรุณากรอกยอดจ่ายสุทธิ'); amount.focus(); return; }
    const paymentDateInput=overlay.querySelector('#pay_date'),paymentDate=dmyToISO(paymentDateInput.value);
    if(!paymentDate){ showToast('กรุณากรอกวันที่ชำระเป็น วัน/เดือน/ปี'); paymentDateInput.focus(); return; }
    const payment={date:paymentDate,amount:paid,withholding:overlay.querySelector('#pay_withholding').checked,reasonType:overlay.querySelector('input[name="pay_reason_type"]:checked')?.value||'',reason:overlay.querySelector('#pay_reason').value,method:overlay.querySelector('#pay_method').value,note:overlay.querySelector('#pay_note').value};
    const originalLabel=savePaymentBtn.textContent;
    savePaymentBtn.disabled=true;
    savePaymentBtn.textContent='กำลังบันทึก...';
    try{
      const {data,error}=await sb.rpc('record_goods_receipt_payment',{p_receipt_id:doc.id,p_payment:payment});
      if(error) throw error;
      if(!data?.receipt||typeof data.receipt!=='object') throw new Error('ระบบไม่ได้ส่งข้อมูลใบรับสินค้าที่บันทึกแล้วกลับมา');
      Object.assign(doc,data.receipt);
      seedTableSnapshot('goods_receipts',goodsReceipts,docToRow);
      persistWorkspaceData();
      overlay.remove();
      showToast(`บันทึกการชำระเงิน ${doc.id} แล้ว`);
      render();
    }catch(error){
      console.warn('record goods receipt payment',error);
      savePaymentBtn.disabled=false;
      savePaymentBtn.textContent=originalLabel;
      showToast(error?.message||'บันทึกการชำระเงินไม่สำเร็จ กรุณาลองใหม่','danger-top');
    }
  };
  setTimeout(()=>amount.focus(),30);
}

function activePurchaseDraft(){
  if(currentTab==='taxinvoice'&&editingTaxInvoiceSaleId==='manual-new') return taxInvoiceDraft;
  if(currentTab==='quotation'&&editingQuotationId!==null) return taxInvoiceDraft;
  return docDraft(currentDocKind());
}

function documentProductPool(){
  return activeProducts();
}

function documentProductMatches(query){
  const q=String(query||'').trim().toLowerCase();
  if(!q) return [];
  return documentProductPool().filter(p=>
    (p.name||'').toLowerCase().includes(q) ||
    (p.sku||'').toLowerCase().includes(q) ||
    (p.barcode||'').toLowerCase().includes(q) ||
    (p.extraBarcodes||[]).some(code=>(code||'').toLowerCase().includes(q)) ||
    (p.vendorBarcodes||[]).some(v=>(v.code||'').toLowerCase().includes(q)) ||
    (p.units||[]).some(u=>(u.barcode||'').toLowerCase().includes(q))
  );
}

function exactDocumentProduct(query){
  const q=String(query||'').trim().toLowerCase();
  if(!q) return null;
  const productPool=documentProductPool();
  // ให้บาร์โค้ดหลักและรหัสสินค้ามีสิทธิ์ก่อนบาร์โค้ดของหน่วยย่อย
  let product=productPool.find(p=>(p.barcode||'').toLowerCase()===q || (p.sku||'').toLowerCase()===q || (p.vendorBarcodes||[]).some(v=>(v.code||'').toLowerCase()===q));
  if(product) return {product,unit:product.unit};
  for(const p of productPool){
    const extra=extraBarcodeEntries(p).find(item=>String(item.code).toLowerCase()===q);
    if(extra) return {product:p,unit:extraBarcodeAvailableUnits(p).includes(extra.unit)?extra.unit:p.unit};
  }
  for(const p of productPool){
    const unit=(p.units||[]).find(u=>(u.barcode||'').toLowerCase()===q);
    if(unit) return {product:p,unit:unit.sub||p.unit};
  }
  return null;
}

function addDocumentScannedProduct(productId,unitName){
  if(currentTab==='transfer'&&editingTransferId!==null){
    syncTransferFromDOM();
    const draft=activeTransferDraft();
    const product=products.find(p=>p.id===productId);
    if(!draft||!product) return;
    const sourceId=Number(draft.fromId)||0;
    const unit=unitName||product.unit;
    const cost=transferUnitOptions(product).find(option=>option.name===unit)?.cost||0;
    const existing=draft.items.find(item=>Number(item.productId)===Number(product.id)&&(item.unit||product.unit)===unit);
    if(existing){
      existing.qty=(Number(existing.qty)||0)+1;
    }else{
      const item={lineId:transferLineCounter++,productId:product.id,name:product.name,qty:1,unit,cost};
      const blank=draft.items.find(row=>!row.name);
      if(blank) Object.assign(blank,item,{lineId:blank.lineId||item.lineId}); else draft.items.push(item);
    }
    render();
    setTimeout(()=>document.getElementById('docProductScanner')?.focus(),0);
    return;
  }
  syncPOFromDOM();
  if((currentTab==='taxinvoice'||currentTab==='quotation')&&typeof syncTaxInvoiceDraftFromDOM==='function') syncTaxInvoiceDraftFromDOM();
  const draft=activePurchaseDraft();
  const product=products.find(p=>p.id===productId);
  if(!draft||!product) return;
  const unit=unitName||product.unit;
  const existing=currentTab==='productreturn'?null:draft.items.find(item=>item.name===product.name && (item.unit||product.unit)===unit);
  if(existing){
    existing.qty=(Number(existing.qty)||0)+1;
  }else{
    const saleUnit=productUnitOptions(product).find(option=>option.name===unit);
    const item={productId:product.id,name:product.name,qty:1,unit,price:(currentTab==='goodsreceipt'||currentTab==='productreturn')?'':(currentTab==='taxinvoice'||currentTab==='quotation')?(saleUnit?.price??product.price):0,...(currentTab==='goodsreceipt'?{lineId:String(Date.now()),warehouseId:Number(draft.warehouseId)||0}:currentTab==='productreturn'?{lineId:String(Date.now()),warehouseId:Number(draft.warehouseId)||0,lotId:null,lotNumber:'',expiry:''}:{})};
    const blank=draft.items.find(row=>!row.name);
    if(blank) Object.assign(blank,item); else draft.items.push(item);
  }
  render();
  setTimeout(()=>document.getElementById('docProductScanner')?.focus(),0);
}

function renderDocumentScanResults(query){
  const box=document.getElementById('docScanResults');
  if(!box) return;
  const q=String(query||'').trim();
  if(!q){ box.innerHTML=''; box.hidden=true; return; }
  const matches=documentProductMatches(q).slice(0,8);
  box.innerHTML=matches.length?matches.map(p=>{
    const exactUnit=(p.units||[]).find(u=>(u.barcode||'').toLowerCase()===q.toLowerCase());
    const extraUnit=extraBarcodeEntries(p).find(item=>String(item.code).toLowerCase()===q.toLowerCase())?.unit;
    const unit=exactUnit?.sub||(extraBarcodeAvailableUnits(p).includes(extraUnit)?extraUnit:p.unit);
    const unitNames=[p.unit,...(p.units||[]).map(u=>u.sub).filter(Boolean)].join(', ');
    return `<button type="button" class="doc-scan-result" data-pid="${escapeHtml(Number(p.id))}" data-unit="${escapeHtml(unit)}"><span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.sku||'-')} · บาร์โค้ด ${escapeHtml(p.barcode||'-')} · หน่วย ${escapeHtml(unitNames)}</small></span><span class="stock">คงเหลือ ${escapeHtml(stockInLargestUnit(p))}</span></button>`;
  }).join(''):`<div class="doc-scan-empty">ไม่พบสินค้า “${escapeHtml(q)}”</div>`;
  box.hidden=false;
  box.querySelectorAll('.doc-scan-result').forEach(btn=>{
    btn.addEventListener('mousedown',e=>e.preventDefault());
    btn.addEventListener('click',()=>addDocumentScannedProduct(Number(btn.dataset.pid),btn.dataset.unit));
  });
}

function bindDocumentProductScanner(){
  const input=document.getElementById('docProductScanner');
  const box=document.getElementById('docScanResults');
  if(!input||!box) return;
  input.addEventListener('input',()=>renderDocumentScanResults(input.value));
  input.addEventListener('focus',()=>{ if(input.value.trim()) renderDocumentScanResults(input.value); });
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){ box.hidden=true; input.value=''; return; }
    if(e.key!=='Enter') return;
    e.preventDefault();
    const query=input.value.trim(); if(!query) return;
    const exact=exactDocumentProduct(query);
    if(exact){ addDocumentScannedProduct(exact.product.id,exact.unit); return; }
    const first=documentProductMatches(query)[0];
    if(first) addDocumentScannedProduct(first.id,first.unit);
  });
  input.addEventListener('blur',()=>setTimeout(()=>{ box.hidden=true; },140));
}

function bindPOItemEvents(){
  document.querySelectorAll('#poItemRows .po-item-row').forEach(row=>{
    const unitSel=row.querySelector('.poi_unit'); if(unitSel) unitSel.addEventListener('change', ()=>{ recalcPORow(row); if(currentTab==='productreturn'){ syncPOFromDOM(); render(); } });
    ['.poi_qty','.poi_price'].forEach(sel=>{ const el=row.querySelector(sel); if(el) el.addEventListener('input', ()=>recalcPORow(row)); });
    const returnLot=row.querySelector('.poi_return_lot'); if(returnLot) returnLot.addEventListener('change',()=>{ syncPOFromDOM(); render(); });
    row.querySelector('.poi_del').addEventListener('click', ()=>{ syncPOFromDOM(); if((currentTab==='taxinvoice'||currentTab==='quotation')&&typeof syncTaxInvoiceDraftFromDOM==='function') syncTaxInvoiceDraftFromDOM(); const draft=activePurchaseDraft(); draft.items.splice([...document.querySelectorAll('#poItemRows .po-item-row')].indexOf(row),1); if(draft.items.length===0) draft.items=[{name:'',qty:1,unit:'',price:''}]; render(); });
  });
}

function savePORepresentativeFromPO(){
  syncPOFromDOM();
  const draft=activePurchaseDraft();
  const get=id=>(document.getElementById(id)?.value||'').trim();
  const name=get('po_rep_name');
  if(!name){ showToast('กรุณากรอกชื่อผู้แทน'); document.getElementById('po_rep_name').focus(); return; }
  const duplicate=salesRepresentatives.find(rep=>rep.name===name && rep.id!==poRepresentativeEditorId);
  if(duplicate){ showToast('มีชื่อผู้แทนนี้อยู่แล้ว'); document.getElementById('po_rep_name').focus(); return; }
  const data={name,phone:get('po_rep_phone'),line:get('po_rep_line'),note:get('po_rep_note')};
  if(poRepresentativeEditorId==='new'){
    salesRepresentatives.push({id:generateClientRecordId(salesRepresentatives),...data});
    showToast(`เพิ่มผู้แทน “${name}” แล้ว`);
  }else{
    const rep=salesRepresentatives.find(x=>x.id===poRepresentativeEditorId);
    if(rep){
      const oldName=rep.name;
      Object.assign(rep,data);
      purchaseOrders.forEach(doc=>{ if(doc.supplier===oldName) doc.supplier=name; });
    }
    showToast(`บันทึกข้อมูลผู้แทน “${name}” แล้ว`);
  }
  if(draft) draft.supplier=name;
  poRepresentativeEditorId=null;
  persistWorkspaceData();
  render();
}

function savePOSupplierFromPO(){
  if(currentTab==='goodsreceipt'&&loggedInUser()?.owner!==true){
    poSupplierEditorOpen=false;
    showToast('LEVEL 2 แก้ไขข้อมูลผู้จำหน่ายจากใบรับสินค้าไม่ได้');
    render();
    return;
  }
  syncPOFromDOM();
  const draft=activePurchaseDraft();
  const supplier=suppliersList().find(s=>s.name===draft.supplier); if(!supplier) return;
  const get=id=>(document.getElementById(id)?.value||'').trim();
  const name=get('po_sup_name');
  if(!name){ showToast('กรุณากรอกชื่อผู้จำหน่าย'); document.getElementById('po_sup_name').focus(); return; }
  supplier.name=name;
  supplier.taxId=get('po_sup_taxid');
  supplier.contactName=get('po_sup_contact');
  supplier.phone=get('po_sup_phone');
  supplier.email=get('po_sup_email');
  supplier.creditDays=parseInt(get('po_sup_credit'))||0;
  supplier.address=get('po_sup_address');
  draft.supplier=name;
  poSupplierEditorOpen=false;
  persistWorkspaceData();
  showToast('บันทึกข้อมูลผู้จำหน่ายแล้ว');
  render();
}
function recalcPORow(row){
  const qty=parseFloat(row.querySelector('.poi_qty').value)||0;
  const priceEl=row.querySelector('.poi_price');
  const price=priceEl?(parseFloat(priceEl.value)||0):0;
  const totalEl=row.querySelector('.poi_total'); if(totalEl) totalEl.textContent=fmtMoney(qty*price);
  // อัปเดตยอดสรุปแบบเบาๆ โดยไม่ re-render ทั้งหน้า
  syncPOFromDOM();
  const draft=activePurchaseDraft();
  const tax=calculatePurchaseTaxSummary(draft.items,draft.discount||0,draft.taxMode||'incl');
  const amtEl=document.querySelector('.po-total-amt'); if(amtEl) amtEl.textContent=fmtMoney(tax.total);
}
function syncPOFromDOM(){
  const draft=activePurchaseDraft(); if(!draft) return;
  if((currentTab==='taxinvoice'&&editingTaxInvoiceSaleId==='manual-new')||(currentTab==='quotation'&&editingQuotationId!==null)){
    const date=document.getElementById('po_date'); if(date){ const iso=dmyToISO(date.value); if(iso) draft.date=iso; }
    const credit=document.getElementById('po_credit'); if(credit) draft.credit=parseInt(credit.value)||0;
    draft.dueDate=addDaysToDate(draft.date,draft.credit||0);
    const discount=document.getElementById('po_discount'); if(discount) draft.discount=parseFloat(discount.value)||0;
    const note=document.getElementById('po_note'); if(note) draft.note=note.value;
    const rows=document.querySelectorAll('#poItemRows .po-item-row');
    if(rows.length) draft.items=Array.from(rows).map(row=>{
      const name=row.querySelector('.poi_name').value;
      const matched=products.find(p=>p.name===name);
      return {name,qty:parseFloat(row.querySelector('.poi_qty').value)||0,unit:row.querySelector('.poi_unit').value.trim(),price:row.querySelector('.poi_price').value===''?'':(parseFloat(row.querySelector('.poi_price').value)||0),pid:matched?matched.id:null};
    });
    return;
  }
  const sup=document.getElementById('po_supplier'); if(sup) draft.supplier=sup.value;
  const warehouse=document.getElementById('po_warehouse'); if(warehouse) draft.warehouseId=Number(warehouse.value)||0;
  const d=document.getElementById('po_date'); if(d){ const iso=dmyToISO(d.value); if(iso) draft.date=iso; }
  const c=document.getElementById('po_credit'); if(c) draft.credit=parseInt(c.value)||0;
  if(currentTab==='goodsreceipt') draft.dueDate=addDaysToDate(draft.date,draft.credit||0); else { draft.credit=0; draft.dueDate=''; draft.discount=0; }
  const disc=document.getElementById('po_discount'); if(disc) draft.discount=parseFloat(disc.value)||0;
  const taxMode=document.getElementById('po_tax_mode'); if(taxMode) draft.taxMode=taxMode.value;
  const taxNo=document.getElementById('po_supplier_tax_invoice_no'); if(taxNo) draft.supplierTaxInvoiceNo=taxNo.value.trim();
  const taxDate=document.getElementById('po_supplier_tax_invoice_date');
  if(taxDate){
    const raw=taxDate.value.trim();
    draft.supplierTaxInvoiceDate=raw?(dmyToISO(raw)||raw):'';
  }
  const note=document.getElementById('po_note'); if(note) draft.note=note.value;
  const rows=document.querySelectorAll('#poItemRows .po-item-row');
  if(rows.length) draft.items=Array.from(rows).map((r,index)=>{
    const name=r.querySelector('.poi_name').value;
    const rowProduct=products.find(product=>Number(product.id)===Number(r.dataset.productId));
    const matched=rowProduct?.name===name?rowProduct:documentProductPool().find(product=>product.name===name);
    return {
      productId:matched?.id||'',name,
      qty:parseFloat(r.querySelector('.poi_qty').value)||0,
      unit:r.querySelector('.poi_unit').value.trim(),
      price:r.querySelector('.poi_price')?(r.querySelector('.poi_price').value===''?'':(parseFloat(r.querySelector('.poi_price').value)||0)):0,
      ...(currentTab==='goodsreceipt'?{
        lineId:String(draft.items?.[index]?.lineId||index+1),
        warehouseId:Number(draft.warehouseId)||0,
        lotNumber:r.querySelector('.poi_lot')?.value.trim()||'',
        expiry:(()=>{ const raw=r.querySelector('.poi_expiry')?.value.trim()||''; return raw?(dmyToISO(raw)||raw):''; })()
      }:currentTab==='productreturn'?(()=>{
        const lotSelect=r.querySelector('.poi_return_lot');
        const selected=lotSelect?.selectedOptions?.[0];
        return {
          lineId:String(draft.items?.[index]?.lineId||index+1),
          warehouseId:Number(draft.warehouseId)||0,
          lotId:Number(lotSelect?.value)||null,
          lotNumber:selected?.dataset?.lotNumber||'',
          expiry:selected?.dataset?.expiry||''
        };
      })():{}),
    };
  });
}
async function savePO(silent=false){
  silent = silent===true;
  syncPOFromDOM();
  const kind=currentDocKind();
  const styled=isSupplierStyleDoc(kind);
  const draft=activePurchaseDraft();
  const editingId=docEditingId(kind);
  const list=docList(kind);
  if(!draft.supplier){ showToast(styled?'กรุณาเลือกผู้จำหน่าย':'กรุณาเลือกผู้แทน'); return false; }
  if((kind==='gr'||kind==='ret')&&!Number(draft.warehouseId)){ showToast(kind==='gr'?'กรุณาเลือกคลัง / สาขาที่รับสินค้าเข้า':'กรุณาเลือกคลัง / สาขาที่คืนสินค้าออก'); return false; }
  const items=draft.items.filter(it=>it.name && it.qty>0);
  if(items.length===0){ showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ'); return false; }
  if(items.some(it=>!products.some(p=>p.name===it.name))){ showToast('กรุณาเลือกสินค้าจากผลการค้นหา'); return false; }
  if(styled&&draft.supplierTaxInvoiceDate&&!/^\d{4}-\d{2}-\d{2}$/.test(draft.supplierTaxInvoiceDate)){ showToast('กรุณากรอกวันที่ใบกำกับภาษีเป็น วัน/เดือน/ปี'); document.getElementById('po_supplier_tax_invoice_date')?.focus(); return false; }
  if(kind==='gr'&&items.some(item=>item.expiry&&!/^\d{4}-\d{2}-\d{2}$/.test(item.expiry))){ showToast('กรุณากรอกวันหมดอายุเป็น วัน/เดือน/ปี เช่น 05/07/2027'); return false; }
  if(kind==='ret'&&items.some(item=>!Number(item.lotId))){ showToast('กรุณาเลือก Lot ที่คืนให้ครบทุกสินค้า'); return false; }
  const tax=styled?calculatePurchaseTaxSummary(items,draft.discount||0,draft.taxMode||'incl'):calculatePurchaseTaxSummary([],0,'none');
  const old=editingId!=='new'?list.find(x=>x.id===editingId):null;
  const savedItems=(kind==='gr'||kind==='ret')?normalizeGoodsReceiptItems(items,draft.warehouseId):items;
  if(kind==='gr'&&old?.stockApplied===true){ showToast('ใบรับสินค้านี้รับเข้าสต๊อกแล้ว จึงแก้ไขเอกสารไม่ได้ กรุณาพิมพ์หรือดูจากรายการเดิม','danger-top'); return false; }
  if(kind==='ret'&&old?.stockApplied===true){
    const stockShape=value=>(value||[]).map(item=>({productId:Number(item.productId)||0,qty:Number(item.qty)||0,unit:item.unit||'',stockFactor:Number(item.stockFactor)||1,lotId:Number(item.lotId)||0}));
    if(Number(old.warehouseId)!==Number(draft.warehouseId)||JSON.stringify(stockShape(old.items))!==JSON.stringify(stockShape(savedItems))){
      showToast('ใบคืนสินค้านี้ตัดสต๊อกแล้ว จึงแก้สินค้า จำนวน หน่วย หรือ Lot ไม่ได้');
      return false;
    }
  }
  const rec={ id:draft.id, _revision:Number(old?._revision)||0, supplier:draft.supplier, date:draft.date, credit:kind==='ret'?0:(styled?(draft.credit||0):0), dueDate:kind==='ret'?'':(styled?addDaysToDate(draft.date,draft.credit||0):''), items:savedItems, discount:kind==='ret'?0:(styled?(draft.discount||0):0), total:kind==='ret'?0:tax.total, taxMode:kind==='ret'?'none':(styled?(draft.taxMode||'incl'):'none'), taxSummary:kind==='ret'?calculatePurchaseTaxSummary([],0,'none'):(styled?tax:null), supplierTaxInvoiceNo:styled?(draft.supplierTaxInvoiceNo||''):'', supplierTaxInvoiceDate:styled?(draft.supplierTaxInvoiceDate||''):'', businessSnapshot:old?.businessSnapshot||businessDocumentSnapshot(), note:draft.note||'', status:old?.status||docDefaultStatus(kind), ...(kind==='gr'?{warehouseId:Number(draft.warehouseId),stockApplied:old?.stockApplied===true,stockAppliedAt:old?.stockAppliedAt||'',createdByUserId:old?.createdByUserId||String(currentProfile?.id||'')}:kind==='ret'?{warehouseId:Number(draft.warehouseId),stockApplied:old?.stockApplied===true,stockAppliedAt:old?.stockAppliedAt||''}:{}) };
  if(kind==='gr'){
    const saveButton=document.getElementById('savePOBtn');
    if(saveButton) saveButton.disabled=true;
    try{
      if(old&&!canManageGoodsReceipt(old)) throw new Error('แก้ไขไม่ได้ เพราะใบรับสินค้านี้สร้างโดยผู้ใช้งานอื่น');
      await saveRevisionedDocument('goods_receipts',rec);
    }catch(error){
      console.warn('save goods receipt',error);
      if(saveButton) saveButton.disabled=false;
      const message=error?.code==='23505'?'เลขที่ใบรับสินค้านี้ถูกใช้งานแล้ว กรุณาปิดหน้าต่างและสร้างเอกสารใหม่':(error?.message||'กรุณาตรวจการเชื่อมต่อแล้วลองใหม่');
      showToast(`บันทึกใบรับสินค้าไม่สำเร็จ: ${message}`,'danger-top');
      return false;
    }
  }
  if(editingId==='new'){
    list.unshift(rec);
    if(kind==='gr'){ grCounter++; }
    else if(kind==='ret'){ returnCounter++; }
    else bumpDocCounter(kind);
  } else {
    const idx=list.findIndex(x=>x.id===editingId);
    if(idx>-1){
      list[idx]=rec;
    }
  }
  if(kind==='gr') seedTableSnapshot('goods_receipts',goodsReceipts,docToRow);
  const savedId=rec.id;
  persistWorkspaceData();
  if(!silent){ setDocEditingId(kind,null); setDocDraft(kind,null); if(kind==='po') poRepresentativeEditorId=null; showToast(`บันทึก${docLabelText(kind)}แล้ว`); render(); }
  else { setDocEditingId(kind,savedId); }
  return savedId;
}

async function handleDocumentAction(kind,id,action){
  const list=docList(kind);
  const doc=list.find(x=>x.id===id); if(!doc) return;
  openDocMenu=null;
  if(action==='edit'){
    if(kind==='gr'&&!canManageGoodsReceipt(doc)){ showToast('แก้ไขไม่ได้ เพราะใบรับสินค้านี้สร้างโดยผู้ใช้งานอื่น','danger-top'); render(); return; }
    if(kind==='gr'&&documentHasPostedStock(kind,doc)){ showToast('ใบรับสินค้านี้รับเข้าสต๊อกแล้ว จึงแก้ไขเอกสารไม่ได้','danger-top'); render(); return; }
    setDocEditingId(kind,id); setDocDraft(kind,null);
    if(kind==='po') poRepresentativeEditorId=null;
    currentTab = kind==='gr'?'goodsreceipt':kind==='ret'?'productreturn':'purchaseorder';
    render(); return;
  }
  if(action==='print'){ printPO(id,kind); render(); return; }
  if(action==='duplicate'&&kind!=='gr'){
    const copy=JSON.parse(JSON.stringify(doc));
    copy.id=docPrefix(kind)+TODAY_STR.replace(/-/g,'')+String(docCounter(kind)).padStart(4,'0'); copy.date=TODAY_STR; copy.dueDate=addDaysToDate(copy.date,copy.credit||0); copy.status=docDefaultStatus(kind);
    if(kind==='ret'){
      copy.items=normalizeGoodsReceiptItems(copy.items,copy.warehouseId).map((item,index)=>({...item,lineId:String(index+1),lotId:null,lotNumber:'',expiry:''}));
      copy.status='รอรับคืน';
      copy.stockApplied=false;
      copy.stockAppliedAt='';
      copy.lotAppliedAt='';
    }
    bumpDocCounter(kind);
    list.unshift(copy);
    persistWorkspaceData(); showToast(`สร้างซ้ำเป็น ${copy.id} แล้ว`); render(); return;
  }
  if(action==='delete'){
    if(kind==='gr'&&!canManageGoodsReceipt(doc)){ showToast('ลบไม่ได้ เพราะใบรับสินค้านี้สร้างโดยผู้ใช้งานอื่น','danger-top'); render(); return; }
    if(refusePostedDocumentDeletion(kind,doc)){ render(); return; }
    if(confirm(`ยืนยันลบ ${doc.id} ?`)){
      if(kind==='gr'){
        try{
          const {data,error}=await sb.from('goods_receipts').delete().eq('id',doc.id).select('id');
          if(error) throw error;
          if(!(data||[]).length){ showToast('ลบใบรับสินค้าไม่สำเร็จ ระบบไม่อนุญาตให้ลบรายการนี้','danger-top'); render(); return; }
        }catch(error){
          console.warn('delete goods receipt',error);
          showToast(`ลบใบรับสินค้าไม่สำเร็จ: ${error?.message||'กรุณาลองใหม่'}`,'danger-top');
          render();
          return;
        }
      }
      const idx=list.findIndex(x=>x.id===id); if(idx>-1) list.splice(idx,1);
      if(kind==='gr') seedTableSnapshot('goods_receipts',goodsReceipts,docToRow);
      persistWorkspaceData();
      showToast(`ลบ ${doc.id} แล้ว`);
    }
    render();
  }
}
