function renderInvoice(){
  return `<div class="pagehead"><div><h1>ใบแจ้งหนี้ (ขายเชื่อ)</h1><div class="sub">สำหรับลูกค้าองค์กรที่ชำระภายหลัง เช่น คลินิก/ร้านค้าคู่ค้า</div></div></div>
  <table><thead><tr><th>เลขที่</th><th>วันที่ออก</th><th>ครบกำหนด</th><th>ลูกค้า</th><th class="mono">ยอดรวม</th><th>สถานะ</th><th></th></tr></thead>
  <tbody>${invoicesAR.map(iv=>`<tr><td class="mono">${escapeHtml(iv.id)}</td><td>${escapeHtml(fmtDate(iv.date))}</td><td>${escapeHtml(fmtDate(iv.dueDate))}</td><td>${escapeHtml(iv.customer||'-')}</td><td class="mono">${fmtMoney(iv.total)}</td><td><span class="badge ${iv.paid?'ok':'danger'}">${iv.paid?'ชำระแล้ว':'ค้างชำระ'}</span></td><td>${iv.paid?'':`<button class="btn ghost small" data-act="markpaid" data-id="${escapeHtml(iv.id)}">รับชำระ</button>`}</td></tr>`).join('')}</tbody></table>`;
}

function renderCreditNote(){
  return `<div class="pagehead"><div><h1>ใบลดหนี้ (รับคืนสินค้า)</h1><div class="sub">บันทึกการรับคืน/ลดหนี้ให้ลูกค้า</div></div></div>
  <table><thead><tr><th>เลขที่</th><th>อ้างอิงบิล</th><th>วันที่</th><th>ลูกค้า</th><th>เหตุผล</th><th>รายการ</th><th class="mono">ยอดลดหนี้</th></tr></thead>
  <tbody>${creditNotes.map(c=>`<tr><td class="mono">${escapeHtml(c.id)}</td><td class="mono">${escapeHtml(c.ref||'-')}</td><td>${escapeHtml(fmtDate(c.date))}</td><td>${escapeHtml(c.customer||'-')}</td><td>${escapeHtml(c.reason||'-')}</td><td>${escapeHtml((c.items||[]).map(i=>i.name).join(', '))}</td><td class="mono">${fmtMoney(c.total)}</td></tr>`).join('')}</tbody></table>`;
}

function renderPurchaseOrder(){
  if(editingPOId!==null) return renderPOForm();
  const allDocs=sortedDocuments(purchaseOrders,'po');
  const totalPages=Math.max(1, Math.ceil(allDocs.length/DOC_LIST_PAGE_SIZE));
  if(docListPage.po>totalPages) docListPage.po=totalPages;
  if(docListPage.po<1) docListPage.po=1;
  const start=(docListPage.po-1)*DOC_LIST_PAGE_SIZE;
  const pageDocs=allDocs.slice(start,start+DOC_LIST_PAGE_SIZE);
  return `<div class="pagehead"><div><h1>สั่งซื้อสินค้า <span class="page-title-meta">บันทึกรายการสินค้าที่ต้องแจ้งสั่งกับผู้แทน · ${allDocs.length} รายการ</span></h1></div><button class="btn primary" id="newPOBtn">+ สร้างรายการสั่งซื้อ</button></div>
  ${documentBulkToolbar('po')}
  <div class="doc-list-wrap">
  <table class="grid-table doc-list po-doc-list"><colgroup><col style="width:42px"><col style="width:100px"><col style="width:130px"><col style="width:170px"><col style="width:340px"><col style="width:130px"><col style="width:130px"><col style="width:90px"><col style="width:100px"></colgroup><thead><tr><th style="width:42px;"><input class="doc-check" type="checkbox" aria-label="เลือกทั้งหมด"></th><th>${documentSortHeader('po','date','วันที่สั่ง')}</th><th>${documentSortHeader('po','supplier','ชื่อผู้แทน')}</th><th>ข้อมูลติดต่อ</th><th>รายการสั่งของ</th><th>หมายเหตุ</th><th>${documentSortHeader('po','status','สถานะ')}</th><th>${documentSortHeader('po','elapsed','ผ่านมาแล้ว')}</th><th style="width:100px;"></th></tr></thead>
  <tbody>${pageDocs.map(po=>`<tr>
    <td style="text-align:center;"><input class="doc-check" type="checkbox" value="${escapeHtml(po.id)}" aria-label="เลือก ${escapeHtml(po.id)}"></td><td style="text-align:center;">${escapeHtml(fmtDate(po.date))}</td><td style="text-align:center;">${escapeHtml(po.supplier)}</td><td style="text-align:center;">${shortageRepresentativeContact(po.supplier)}</td>
    <td>${shortageAllItems(po.items,po.id)}</td><td>${escapeHtml(po.note||'-')}</td><td style="text-align:center;">${documentStatusControl('po',po)}</td><td style="text-align:center;"><span class="elapsed-days">${elapsedDaysSince(po.date)} วัน</span></td>
    <td style="text-align:center;"><div class="history-actions shortage-row-actions"><button class="shortage-edit-btn" data-act="editpo" data-id="${escapeHtml(po.id)}" title="แก้ไขรายการ" aria-label="แก้ไข ${escapeHtml(po.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="history-icon-btn" data-act="printpo" data-id="${escapeHtml(po.id)}" title="พิมพ์เอกสาร" aria-label="พิมพ์ ${escapeHtml(po.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/></svg></button></div></td></tr>${expandableDocumentItemsDetailRow('shortage',po.id,po.items,9)}`).join('')||'<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px;">ยังไม่มีรายการสั่งซื้อสินค้า</td></tr>'}</tbody></table>
  </div>
  ${pagerHtml(docListPage.po, totalPages, 'docpage-po')}`;
}

function poUnitOptions(p){
  if(!p) return [];
  return productUnitOptions(p);
}

function documentPartyFieldHtml(id,value,kind='supplier',disabled=false){
  const title=kind==='representative'?'เลือกผู้แทน':kind==='customer'?'เลือกลูกค้า':'เลือกผู้จำหน่าย';
  const label=kind==='customer'?(customersList().find(c=>String(c.id)===String(value))?.name||title):(value||title);
  return `<input type="hidden" id="${id}" value="${escapeHtml(value||'')}" ${disabled?'disabled':''}><button class="document-party-trigger" type="button" data-document-party="${kind}" data-party-field="${id}" aria-haspopup="dialog" aria-label="${title}" ${disabled?'disabled':''}><span>${escapeHtml(label)}</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button>`;
}
function openDocumentPartyPicker(trigger){
  const field=document.getElementById(trigger.dataset.partyField);
  if(!field||field.disabled||trigger.disabled||document.querySelector('.document-party-overlay')) return;
  const isRepresentative=trigger.dataset.documentParty==='representative';
  const isCustomer=trigger.dataset.documentParty==='customer';
  const title=isRepresentative?'เลือกผู้แทน':isCustomer?'เลือกลูกค้า':'เลือกผู้จำหน่าย';
  const records=isRepresentative?salesRepresentatives:isCustomer?customersList():suppliersList();
  const recordValue=record=>String(isCustomer?record.id:record.name);
  const overlay=document.createElement('div');
  overlay.className='modal-overlay document-party-overlay';
  overlay.innerHTML=`<div class="modal document-party-modal" role="dialog" aria-modal="true" aria-labelledby="documentPartyTitle"><div class="modal-head"><h3 id="documentPartyTitle">${title}</h3><button class="modal-close" type="button" aria-label="ปิด">×</button></div><div class="document-party-search"><input type="search" aria-label="ค้นหารายชื่อ" placeholder="ค้นหาชื่อ รหัส เบอร์โทร ไลน์ หรือบริษัท" autocomplete="off"></div><div class="document-party-list"></div><div class="document-party-footer"><span role="status" aria-live="polite"></span><button class="btn ghost" type="button" data-party-clear>ล้างการเลือก</button><button class="btn primary" type="button" data-party-close>ปิด</button></div></div>`;
  document.body.appendChild(overlay);
  const search=overlay.querySelector('input'),list=overlay.querySelector('.document-party-list'),status=overlay.querySelector('[role="status"]');
  const close=()=>{overlay.remove();if(trigger.isConnected) trigger.focus();};
  const choose=value=>{
    field.value=value;
    trigger.querySelector('span').textContent=records.find(record=>recordValue(record)===value)?.name||title;
    close();
    field.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector(`[data-party-field="${field.id}"]`)?.focus();
  };
  const renderRows=()=>{
    const words=search.value.trim().toLocaleLowerCase('th').split(/\s+/).filter(Boolean);
    const matches=records.map((record,index)=>({record,index})).filter(({record})=>{
      const text=[record.name,record.code,record.phone,record.line,record.company,record.contactName,record.taxId].filter(Boolean).join(' ').toLocaleLowerCase('th');
      return words.every(word=>text.includes(word));
    });
    status.textContent=`${matches.length} รายการ`;
    list.innerHTML=matches.map(({record,index})=>`<button type="button" class="document-party-item ${recordValue(record)===field.value?'selected':''}" data-party-index="${index}" aria-pressed="${recordValue(record)===field.value}"><span><strong>${escapeHtml(record.name||'-')}</strong><small>${escapeHtml([record.code,record.company,record.phone,record.line].filter(Boolean).join(' · '))}</small></span><span aria-hidden="true">${recordValue(record)===field.value?'✓':''}</span></button>`).join('')||`<div class="document-party-empty">${records.length?'ไม่พบรายชื่อที่ค้นหา':'ยังไม่มีรายชื่อ'}</div>`;
  };
  search.addEventListener('input',renderRows);
  list.addEventListener('click',event=>{const row=event.target.closest('[data-party-index]');if(row) choose(recordValue(records[Number(row.dataset.partyIndex)]));});
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('[data-party-close]').onclick=close;
  overlay.querySelector('[data-party-clear]').onclick=()=>choose('');
  overlay.addEventListener('mousedown',event=>{if(event.target===overlay) close();});
  overlay.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    if(event.key==='Tab'){
      const focusable=[...overlay.querySelectorAll('button,input')].filter(el=>!el.disabled&&el.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  renderRows();
  search.focus();
}
function renderPOForm(kind='po'){
  const styled=isSupplierStyleDoc(kind);
  const editingId=docEditingId(kind);
  const isNew=editingId==='new';
  let draft=docDraft(kind);
  if(!draft){
    const list=docList(kind);
    draft=isNew
      ? {id:docPrefix(kind)+TODAY_STR.replace(/-/g,'')+String(docCounter(kind)).padStart(4,'0'), supplier:'', date:TODAY_STR, credit:0, dueDate:TODAY_STR, items:[{name:'',qty:1,unit:'',price:''}], note:'', discount:0, taxMode:'incl', supplierTaxInvoiceNo:'', supplierTaxInvoiceDate:'', ...((kind==='gr'||kind==='ret')?{warehouseId:Number(activeWarehouseId)||0}:{})}
      : JSON.parse(JSON.stringify(list.find(x=>x.id===editingId)));
    if(!draft.discount) draft.discount=0;
    if(draft.credit===undefined) draft.credit=0;
    draft.dueDate=documentDueDate(draft);
    setDocDraft(kind,draft);
  }
  const po = draft;
  if(kind==='ret') return renderProductReturnForm(po,isNew);
  if(!styled) return renderShortageOrderForm(po,isNew);
  if(!['incl','excl','none'].includes(po.taxMode)) po.taxMode='incl';
  const docLabel=docLabelText(kind);
  if(kind==='gr'&&!Number(po.warehouseId)) po.warehouseId=goodsReceiptWarehouseId(po);
  const supplierObj = suppliersList().find(s=>s.name===po.supplier);
  const canEditSupplierInline=kind!=='gr';
  const discount = po.discount||0;
  const tax = calculatePurchaseTaxSummary(po.items,discount,po.taxMode);
  const dueDate = addDaysToDate(po.date,po.credit||0);

  return `
    <div class="pagehead"><div><div class="breadcrumb">${escapeHtml(docLabel)} › ${escapeHtml(isNew?'สร้าง'+docLabel:'แก้ไข'+docLabel)}</div><h1>${escapeHtml(po.id)}</h1></div></div>
    <div class="po-head">
      <div class="po-head-left">
        <div class="crow"><label>ผู้จำหน่าย <span class="req">*</span></label>
          <div class="po-supplier-pick">${documentPartyFieldHtml('po_supplier',po.supplier)}${canEditSupplierInline?`<button class="btn ghost small" id="editPOSupplierBtn" type="button" ${supplierObj?'':'disabled'}>${poSupplierEditorOpen?'ปิด':'แก้ไขข้อมูล'}</button>`:''}</div></div>
        ${kind==='gr'?`<div class="crow"><label>รับเข้าคลัง / สาขา <span class="req">*</span></label><select id="po_warehouse" ${po.stockApplied===true?'disabled':''}><option value="">เลือกคลัง / สาขา</option>${accessibleWarehouses().map(warehouse=>`<option value="${warehouse.id}" ${Number(po.warehouseId)===Number(warehouse.id)?'selected':''}>${escapeHtml(warehouse.name)}</option>`).join('')}</select></div>`:''}
        ${canEditSupplierInline&&supplierObj&&poSupplierEditorOpen?poSupplierEditorHtml(supplierObj):''}
        <div class="crow"><label>ที่อยู่</label><div class="po-addr">${supplierObj?escapeHtml(supplierObj.address||'-'):'(เลือกผู้จำหน่ายเพื่อแสดงที่อยู่)'}</div></div>
        <div class="crow"><label>เลขผู้เสียภาษี</label><div class="po-addr mono">${supplierObj?escapeHtml(supplierObj.taxId||'-'):'-'}</div></div>
        <div class="crow"><label>ภาษีในเอกสาร</label><select id="po_tax_mode"><option value="incl" ${po.taxMode==='incl'?'selected':''}>ราคารวม VAT แล้ว</option><option value="excl" ${po.taxMode==='excl'?'selected':''}>ราคายังไม่รวม VAT</option><option value="none" ${po.taxMode==='none'?'selected':''}>ไม่มี VAT</option></select></div>
        <div class="crow"><label>เลขที่ใบกำกับภาษีผู้จำหน่าย</label><input id="po_supplier_tax_invoice_no" value="${escapeHtml(po.supplierTaxInvoiceNo||'')}" placeholder="กรอกเมื่อได้รับใบกำกับภาษี"></div>
        <div class="crow"><label>วันที่ใบกำกับภาษี</label><input id="po_supplier_tax_invoice_date" class="dmy-input" value="${escapeHtml(isoToDMY(po.supplierTaxInvoiceDate))}" placeholder="วว/ดด/ปปปป" inputmode="numeric" maxlength="10" autocomplete="off"></div>
      </div>
      <div class="po-head-right">
        <div class="po-total-label">จำนวนเงินรวมทั้งสิ้น</div>
        <div class="po-total-amt mono">${fmtMoney(tax.total)}</div>
        <div class="crow"><label>วันที่</label>${dmyDateFieldHtml('po_date',po.date)}</div>
        <div class="crow"><label>เครดิต (วัน)</label><input id="po_credit" type="number" value="${escapeHtml(po.credit||0)}"></div>
        <div class="crow"><label>ครบกำหนด</label>${dmyDateFieldHtml('po_due',dueDate,{readonly:true,extraClass:'due-readonly'})}</div>
      </div>
    </div>

    ${documentProductScannerHtml()}
    <table class="grid-table po-items ${kind==='gr'?'goods-receipt-items':''}"><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th class="mono">จำนวน</th><th>หน่วย</th><th class="mono">ราคาต่อหน่วย</th>${kind==='gr'?'<th>เลข Lot</th><th>วันหมดอายุ</th>':''}<th class="mono">ราคารวม</th><th></th></tr></thead>
    <tbody id="poItemRows">${po.items.map((it,i)=>poItemRowHtml(it,i)).join('')}</tbody></table>
    <button class="btn ghost small" id="addPOItemBtn" style="margin-top:8px;">+ เพิ่มแถวรายการ</button>

    <div class="po-foot">
      <div class="po-foot-left">
        <div class="crow"><label>หมายเหตุ</label><textarea id="po_note" rows="3">${escapeHtml(po.note||'')}</textarea></div>
      </div>
      <div class="po-foot-right">
        <div class="sumrow"><span>รวมเป็นเงิน</span><span class="mono">${fmtMoney(tax.subtotal)}</span></div>
        <div class="sumrow"><span>ส่วนลด</span><span class="sumdiscount"><input id="po_discount" type="number" value="${escapeHtml(discount)}" style="width:90px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;text-align:right;"></span></div>
        ${taxSummaryRowsHtml(tax,{purchase:true})}
        <div class="sumrow grand"><span>จำนวนเงินรวมทั้งสิ้น</span><span class="mono">${fmtMoney(tax.total)}</span></div>
      </div>
    </div>
    <div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelPOBtn">ปิดหน้าต่าง</button><button class="btn primary" id="savePOBtn">บันทึกเอกสาร</button></div>`;
}

function documentProductScannerHtml(hideHint=['purchaseorder','goodsreceipt','productreturn','quotation'].includes(currentTab)){
  return `<div class="doc-scanner-wrap"><div class="doc-scanner"><span class="doc-scanner-icon"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/></svg></span><input id="docProductScanner" placeholder="สแกนบาร์โค้ด หรือค้นหาชื่อ / รหัสสินค้า" autocomplete="off"></div>${hideHint?'':'<div class="doc-scanner-hint">สแกนซ้ำเพื่อเพิ่มจำนวนในรายการเดิม</div>'}<div class="doc-scan-results" id="docScanResults" hidden></div></div>`;
}

function shortageRepresentativeEditorHtml(){
  const isNew=poRepresentativeEditorId==='new';
  const rep=isNew?{name:'',phone:'',line:'',note:''}:salesRepresentatives.find(x=>x.id===poRepresentativeEditorId);
  if(!rep) return '';
  return `<div class="po-supplier-edit wide"><div class="po-supplier-edit-title"><span>${isNew?'เพิ่มรายชื่อผู้แทน':'แก้ไขรายชื่อผู้แทน'}</span><span style="font-size:11px;color:var(--text-muted);font-weight:400;">ข้อมูลจะอัปเดตในสมุดรายชื่อด้วย</span></div>
    <div class="po-supplier-edit-grid"><div><label>ชื่อผู้แทน *</label><input id="po_rep_name" value="${escapeHtml(rep.name||'')}"></div><div><label>เบอร์โทร</label><input id="po_rep_phone" class="phone-input" value="${escapeHtml(rep.phone||'')}"></div><div><label>ไลน์</label><input id="po_rep_line" value="${escapeHtml(rep.line||'')}"></div><div class="wide"><label>ข้อมูลเพิ่มเติม</label><textarea id="po_rep_note" rows="2">${escapeHtml(rep.note||'')}</textarea></div></div>
    <div class="po-supplier-edit-actions"><button class="btn ghost small" id="cancelPORepEditBtn" type="button">ยกเลิก</button><button class="btn primary small" id="savePORepEditBtn" type="button">${isNew?'เพิ่มและเลือกผู้แทน':'บันทึกข้อมูลผู้แทน'}</button></div></div>`;
}

function shortageManagedProductsForRepresentative(representativeId){
  const productIds=new Set(managedProductIdsForRepresentative(representativeId));
  return activeProducts()
    .filter(product=>productIds.has(Number(product.id)))
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'th'));
}

function shortageManagedProductStatus(product){
  const draft=activePurchaseDraft();
  const lines=(draft?.items||[]).filter(item=>Number(item.productId)===Number(product.id)||item.name===product.name);
  if(!lines.length) return 'กดเพื่อเพิ่ม';
  if(lines.length===1) return `ในรายการ ${Number(lines[0].qty)||0} ${lines[0].unit||product.unit||''}`;
  return `อยู่ในรายการแล้ว ${lines.length} แถว`;
}

async function openShortageManagedProductsModal(){
  syncPOFromDOM();
  const draft=activePurchaseDraft();
  const representative=salesRepresentatives.find(rep=>rep.name===draft?.supplier);
  if(!representative){ showToast('กรุณาเลือกผู้แทนก่อนดูสินค้าที่ดูแล'); return; }
  const overlay=document.createElement('div');
  overlay.className='modal-overlay shortage-managed-products-overlay';
  overlay.innerHTML=`<section class="modal shortage-managed-products-modal" role="dialog" aria-modal="true" aria-labelledby="shortageManagedProductsTitle">
    <div class="modal-head"><div><h3 id="shortageManagedProductsTitle">สินค้าที่ดูแล</h3><div class="sub">ผู้แทน ${escapeHtml(representative.name)}</div></div><button class="modal-close" type="button" aria-label="ปิด">×</button></div>
    <div class="shortage-managed-products-search"><input id="shortageManagedProductsSearch" type="search" placeholder="ค้นหาชื่อ รหัส หรือบาร์โค้ดสินค้า" autocomplete="off"></div>
    <div class="shortage-managed-products-status" id="shortageManagedProductsStatus">กำลังโหลดสินค้าที่ดูแล…</div>
    <div class="shortage-managed-products-list" id="shortageManagedProductsList"></div>
    <div class="shortage-managed-products-actions"><button class="btn primary" id="closeShortageManagedProductsBtn" type="button">ปิด</button></div>
  </section>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').addEventListener('click',close);
  overlay.querySelector('#closeShortageManagedProductsBtn').addEventListener('click',close);
  overlay.addEventListener('click',event=>{ if(event.target===overlay) close(); });
  const search=overlay.querySelector('#shortageManagedProductsSearch');
  const status=overlay.querySelector('#shortageManagedProductsStatus');
  const list=overlay.querySelector('#shortageManagedProductsList');
  let managedProducts=[];
  const renderProducts=()=>{
    const query=String(search.value||'').trim().toLowerCase();
    const visible=managedProducts.filter(product=>!query||[product.name,product.sku,product.barcode,...extraBarcodeEntries(product).map(item=>item.code)]
      .some(value=>String(value||'').toLowerCase().includes(query)));
    status.textContent=query?`พบ ${visible.length} จาก ${managedProducts.length} รายการ`:`${managedProducts.length} รายการ · กดที่สินค้าเพื่อเพิ่มลงรายการสั่ง`;
    list.innerHTML=visible.length?visible.map(product=>`<button type="button" class="shortage-managed-product-card" data-shortage-managed-product="${escapeHtml(product.id)}">
      <span class="shortage-managed-product-info"><b>${escapeHtml(product.name)}</b><small>รหัส ${escapeHtml(product.sku||'-')} · บาร์โค้ด ${escapeHtml(product.barcode||'-')}</small></span>
      <span class="shortage-managed-product-add">${escapeHtml(shortageManagedProductStatus(product))}</span>
    </button>`).join(''):`<div class="shortage-managed-products-empty">${managedProducts.length?'ไม่พบสินค้าที่ค้นหา':'ผู้แทนคนนี้ยังไม่มีสินค้าที่ดูแล'}</div>`;
    list.querySelectorAll('[data-shortage-managed-product]').forEach(button=>button.addEventListener('click',()=>{
      const product=products.find(item=>Number(item.id)===Number(button.dataset.shortageManagedProduct));
      if(!product) return;
      addDocumentScannedProduct(product.id,product.unit);
      button.classList.add('added');
      button.querySelector('.shortage-managed-product-add').textContent=shortageManagedProductStatus(product);
      showToast(`เพิ่ม “${product.name}” ลงรายการแล้ว`);
    }));
  };
  search.addEventListener('input',renderProducts);
  const cached=shortageManagedProductsForRepresentative(representative.id);
  try{
    const {data,error}=await fetchAllRows(()=>sb.from('sales_representative_products')
      .select('representative_id,product_id,created_at,updated_at')
      .eq('representative_id',Number(representative.id))
      .order('product_id'));
    if(error) throw error;
    representativeProductAssignments=[
      ...representativeProductAssignments.filter(row=>Number(row.representativeId)!==Number(representative.id)),
      ...(data||[]).map(row=>({representativeId:Number(row.representative_id),productId:Number(row.product_id),createdAt:row.created_at||'',updatedAt:row.updated_at||''}))
    ];
    managedProducts=shortageManagedProductsForRepresentative(representative.id);
    renderProducts();
    search.focus();
  }catch(error){
    console.warn('load shortage managed products',error);
    if(cached.length){
      managedProducts=cached;
      renderProducts();
      status.textContent=`แสดงข้อมูลที่โหลดไว้ ${cached.length} รายการ · โหลดข้อมูลล่าสุดไม่สำเร็จ`;
    }else{
      status.textContent='โหลดสินค้าที่ดูแลไม่สำเร็จ กรุณาปิดแล้วลองใหม่';
      status.classList.add('error');
      list.innerHTML='<div class="shortage-managed-products-empty">ยังไม่สามารถแสดงรายการสินค้าได้</div>';
    }
  }
}

function renderShortageOrderForm(po,isNew){
  const representative=salesRepresentatives.find(rep=>rep.name===po.supplier);
  return `<div class="pagehead"><div><div class="breadcrumb">สั่งซื้อสินค้า › ${isNew?'สร้างรายการ':'แก้ไขรายการ'}</div><h1>${escapeHtml(po.id)}</h1></div></div>
    <div class="panel"><div class="shortage-form-grid">
      <div class="shortage-form-main">
        <div class="shortage-form-controls">
          <div class="shortage-date-field"><label>วันที่สั่ง <span class="req">*</span></label>${dmyDateFieldHtml('po_date',po.date||TODAY_STR)}</div>
          <div class="shortage-rep-field"><label>ชื่อผู้แทน <span class="req">*</span></label>${documentPartyFieldHtml('po_supplier',po.supplier,'representative')}</div>
          <button class="btn ghost small" id="newPORepBtn" type="button">+ เพิ่ม</button>
          <button class="btn primary" id="shortageManagedProductsBtn" type="button" ${representative?'':'disabled'}>สินค้าที่ดูแล</button>
        </div>
        <div class="shortage-note-field"><label>หมายเหตุ</label><textarea id="po_note" rows="2" placeholder="ระบุหมายเหตุเพิ่มเติม">${escapeHtml(po.note||'')}</textarea></div>
        ${poRepresentativeEditorId!==null?shortageRepresentativeEditorHtml():''}
      </div>
      <aside class="shortage-rep-summary"><label>ข้อมูลผู้แทน</label><div class="shortage-rep-info">${representative?`<div><small>เบอร์โทร</small><b class="mono">${escapeHtml(representative.phone||'-')}</b></div><div><small>ไลน์</small><b>${escapeHtml(representative.line||'-')}</b></div><div><small>บริษัท</small><b>${escapeHtml(representative.company||'-')}</b></div><div class="wide"><small>ข้อมูลเพิ่มเติม</small><b>${escapeHtml(representative.note||'-')}</b></div>`:'<div class="wide shortage-rep-empty">เลือกผู้แทนเพื่อแสดงข้อมูลติดต่อ</div>'}</div></aside>
    </div></div>
    ${documentProductScannerHtml()}
    <div class="shortage-section-title">รายการที่สั่ง</div>
    <table class="grid-table po-items shortage-document-items"><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th class="mono">จำนวน</th><th>หน่วย</th><th style="width:48px;"></th></tr></thead><tbody id="poItemRows">${po.items.map((it,i)=>shortageItemRowHtml(it,i)).join('')}</tbody></table>
    <button class="btn ghost small" id="addPOItemBtn" style="margin-top:8px;">+ เพิ่มแถวรายการ</button>
    <div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelPOBtn">ปิดหน้าต่าง</button><button class="btn primary" id="savePOBtn">บันทึกเอกสาร</button></div>`;
}

function renderProductReturnForm(po,isNew){
  const supplierObj=suppliersList().find(s=>s.name===po.supplier);
  if(!Number(po.warehouseId)) po.warehouseId=Number(activeWarehouseId)||0;
  const locked=po.stockApplied===true;
  return `<div class="pagehead"><div><div class="breadcrumb">ใบคืนสินค้า › ${isNew?'สร้างใบคืนสินค้า':'แก้ไขใบคืนสินค้า'}</div><h1>${escapeHtml(po.id)}</h1></div></div>
    <div class="po-head">
      <div class="po-head-left">
        <div class="crow"><label>ผู้จำหน่าย <span class="req">*</span></label><div class="po-supplier-pick">${documentPartyFieldHtml('po_supplier',po.supplier)}</div></div>
        <div class="crow"><label>คืนจากคลัง / สาขา <span class="req">*</span></label><select id="po_warehouse" ${locked?'disabled':''}><option value="">เลือกคลัง / สาขา</option>${accessibleWarehouses().map(warehouse=>`<option value="${warehouse.id}" ${Number(po.warehouseId)===Number(warehouse.id)?'selected':''}>${escapeHtml(warehouse.name)}</option>`).join('')}</select></div>
        <div class="crow"><label>ที่อยู่</label><div class="po-addr">${supplierObj?escapeHtml(supplierObj.address||'-'):'(เลือกผู้จำหน่ายเพื่อแสดงที่อยู่)'}</div></div>
        <div class="crow"><label>เลขผู้เสียภาษี</label><div class="po-addr mono">${supplierObj?escapeHtml(supplierObj.taxId||'-'):'-'}</div></div>
      </div>
      <div class="po-head-right"><div class="crow"><label>วันที่</label>${dmyDateFieldHtml('po_date',po.date||TODAY_STR)}</div></div>
    </div>
    ${documentProductScannerHtml()}
    <table class="grid-table po-items product-return-items document-centered-items"><thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th class="mono">จำนวน</th><th>หน่วย</th><th>Lot ที่คืน</th><th>วันหมดอายุ</th><th style="width:48px;"></th></tr></thead><tbody id="poItemRows">${po.items.map((it,i)=>productReturnItemRowHtml(it,i,po.warehouseId,locked)).join('')}</tbody></table>
    <button class="btn ghost small" id="addPOItemBtn" style="margin-top:8px;" ${locked?'disabled':''}>+ เพิ่มแถวรายการ</button>
    <div class="po-foot" style="grid-template-columns:minmax(0,1fr);"><div class="po-foot-left"><div class="crow"><label>หมายเหตุ</label><textarea id="po_note" rows="3">${escapeHtml(po.note||'')}</textarea></div></div></div>
    <div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelPOBtn">ปิดหน้าต่าง</button><button class="btn primary" id="savePOBtn">บันทึกเอกสาร</button></div>`;
}

function shortageItemRowHtml(it,i){
  const product=products.find(p=>p.name===it.name);
  const options=product?poPurchaseUnitOptions(product):[];
  return `<tr class="po-item-row" data-i="${escapeHtml(i)}"><td class="mono">${i+1}</td><td><input class="poi_name" value="${escapeHtml(it.name||'')}" placeholder="สแกน/ค้นหาสินค้าจากช่องด้านบน หรือพิมพ์แก้ไขชื่อเอง" autocomplete="off"></td><td><input class="poi_qty mono" type="number" min="0" value="${escapeHtml(it.qty||0)}" style="width:90px;text-align:right;"></td><td><select class="poi_unit" style="min-width:100px;" ${product?'':'disabled'}>${product?options.map(u=>`<option value="${escapeHtml(u.name)}" ${it.unit===u.name?'selected':''}>${escapeHtml(u.name)}</option>`).join(''):'<option value="">เลือกสินค้า</option>'}</select></td><td class="num"><button class="poi_del" title="ลบ">×</button></td></tr>`;
}

function poItemRowHtml(it,i){
  const product = products.find(p=>Number(p.id)===Number(it.productId))||products.find(p=>p.name===it.name);
  const unitOptions = product ? poPurchaseUnitOptions(product) : [];
  const lineTotal = (it.qty||0)*(it.price||0);
  const goodsReceipt=currentTab==='goodsreceipt';
  const locked=goodsReceipt&&activePurchaseDraft()?.stockApplied===true;
  return `<tr class="po-item-row" data-i="${escapeHtml(i)}" data-product-id="${escapeHtml(product?.id||it.productId||'')}">
    <td class="mono">${i+1}</td>
    <td><input class="poi_name" value="${escapeHtml(it.name||'')}" placeholder="สแกน/ค้นหาสินค้าจากช่องด้านบน หรือพิมพ์แก้ไขชื่อเอง" autocomplete="off" ${locked?'disabled':''}></td>
    <td><input class="poi_qty mono no-spin" type="number" min="0" value="${escapeHtml(it.qty||0)}" style="width:70px;text-align:right;" ${locked?'disabled':''}></td>
    <td><select class="poi_unit" style="min-width:90px;" ${product&&!locked?'':'disabled'}>${product?unitOptions.map(u=>`<option value="${escapeHtml(u.name)}" ${it.unit===u.name?'selected':''}>${escapeHtml(u.name)}</option>`).join(''):'<option value="">เลือกสินค้า</option>'}</select></td>
    <td><input class="poi_price mono" type="number" min="0" value="${escapeHtml(it.price??'')}" placeholder="กรอกราคา" style="width:90px;text-align:right;" ${locked?'disabled':''}></td>
    ${goodsReceipt?`<td><input class="poi_lot" value="${escapeHtml(it.lotNumber||'')}" placeholder="ไม่บังคับ" ${locked?'disabled':''}></td><td><input class="poi_expiry dmy-input" inputmode="numeric" maxlength="10" autocomplete="off" value="${escapeHtml(isoToDMY(it.expiry))}" placeholder="วว/ดด/ปปปป" ${locked?'disabled':''}></td>`:''}
    <td class="mono num poi_total">${fmtMoney(lineTotal)}</td>
    <td class="num"><button class="poi_del" title="ลบ" ${locked?'disabled':''}>×</button></td>
  </tr>`;
}

function productReturnItemRowHtml(it,i,warehouseId,locked=false){
  const product=products.find(p=>Number(p.id)===Number(it.productId))||products.find(p=>p.name===it.name);
  const options=product?poPurchaseUnitOptions(product):[];
  const lots=product?activeInventoryLotsForProduct(product.id,warehouseId):[];
  const selectedLot=lots.find(lot=>Number(lot.id)===Number(it.lotId));
  const savedMissing=it.lotId&&!selectedLot?`<option value="${escapeHtml(it.lotId)}" data-lot-number="${escapeHtml(it.lotNumber||'')}" data-expiry="${escapeHtml(it.expiry||'')}" selected>${escapeHtml(it.lotNumber||'Lot เดิม')} · ${escapeHtml(it.expiry?fmtDateShort(it.expiry):'ไม่ระบุวันหมดอายุ')}</option>`:'';
  const lotOptions=lots.map(lot=>`<option value="${escapeHtml(lot.id)}" data-lot-number="${escapeHtml(lot.manufacturer_lot||lot.internal_code||'')}" data-expiry="${escapeHtml(lot.expiry_date||'')}" ${Number(lot.id)===Number(it.lotId)?'selected':''}>${escapeHtml(lot.manufacturer_lot||lot.internal_code||'-')} · ${escapeHtml(lot.expiry_date?fmtDateShort(lot.expiry_date):'ไม่ระบุวันหมดอายุ')} · ${escapeHtml(lotQuantityText(product,lot))}</option>`).join('');
  const expiry=selectedLot?.expiry_date||it.expiry||'';
  return `<tr class="po-item-row" data-i="${escapeHtml(i)}" data-product-id="${escapeHtml(product?.id||it.productId||'')}"><td class="mono">${i+1}</td><td><input class="poi_name" value="${escapeHtml(it.name||'')}" placeholder="สแกนหรือค้นหาสินค้า" autocomplete="off" ${locked?'disabled':''}></td><td><input class="poi_qty mono" type="number" min="0.01" step="any" value="${escapeHtml(it.qty||0)}" style="width:90px;text-align:right;" ${locked?'disabled':''}></td><td><select class="poi_unit" style="min-width:100px;" ${product&&!locked?'':'disabled'}>${product?options.map(u=>`<option value="${escapeHtml(u.name)}" ${it.unit===u.name?'selected':''}>${escapeHtml(u.name)}</option>`).join(''):'<option value="">เลือกสินค้า</option>'}</select></td><td><select class="poi_return_lot" ${product&&!locked?'':'disabled'}><option value="">เลือก Lot</option>${savedMissing}${lotOptions}</select></td><td class="poi_return_expiry">${escapeHtml(expiry?fmtDateShort(expiry):'-')}</td><td class="num"><button class="poi_del" title="ลบ" ${locked?'disabled':''}>×</button></td></tr>`;
}

function poPurchaseUnitOptions(p){
  if(!p) return [];
  const mainCost = Number(p.cost)||0;
  const result = [{name:p.unit, cost:mainCost, factor:1}];
  (p.units||[]).forEach(u=>{
    if(!u.sub) return;
    const factor = Number(u.factor)||1;
    const cost = u.cost!==undefined && u.cost!=='' ? Number(u.cost)||0 : mainCost*factor;
    result.push({name:u.sub, cost, factor});
  });
  return result;
}

function normalizeGoodsReceiptItems(items,targetWarehouseId=0){
  return (items||[]).map((item,index)=>{
    const product=products.find(p=>p.id===Number(item.productId))||products.find(p=>p.name===item.name);
    const unitInfo=poPurchaseUnitOptions(product).find(option=>option.name===item.unit);
    const warehouseId=Number(targetWarehouseId)||Number(item.warehouseId)||Number(product?.wh)||0;
    return {...item,lineId:String(item.lineId||index+1),productId:product?.id||item.productId||'',warehouseId,stockFactor:Number(item.stockFactor)||(unitInfo?.factor||1),lotNumber:String(item.lotNumber||'').trim(),expiry:String(item.expiry||'')};
  });
}

async function changeGoodsReceiptStatus(id,status){
  const doc=goodsReceipts.find(item=>item.id===id);
  if(!doc) return;
  if(!canManageGoodsReceipt(doc)){ showToast('แก้ไขสถานะไม่ได้ เพราะใบรับสินค้านี้สร้างโดยผู้ใช้งานอื่น','danger-top'); render(); return; }
  const plan=goodsReceiptStatusChangePlan(doc,status);
  if(!plan.allowed){
    showToast(plan.locked?'รับสินค้าเข้าสต๊อกแล้ว ไม่สามารถย้อนกลับเป็น “รอรับสินค้า” ได้':'กรุณาเปลี่ยนสถานะเป็น “รับสินค้าแล้ว” ก่อนชำระเงิน');
    render();
    return;
  }
  doc.warehouseId=goodsReceiptWarehouseId(doc);
  doc.items=normalizeGoodsReceiptItems(doc.items,doc.warehouseId);
  if(plan.stockDirection>0){
    const missingExpiry=doc.items.filter(item=>!item.expiry);
    if(missingExpiry.length&&!confirm(`มีสินค้า ${missingExpiry.length} รายการที่ไม่ได้ระบุวันหมดอายุ\nระบบจะสร้าง Lot โดยไม่มีวันหมดอายุ ต้องการรับสินค้าเข้าสต๊อกต่อหรือไม่?`)){ render(); return; }
    try{
      await saveRevisionedDocument('goods_receipts',doc);
      const data=await runStockOperation('apply_goods_receipt_lots',{receiptId:doc.id});
      Object.assign(doc,data?.receipt||{},data?.receipt?{id:doc.id}:{});
      seedTableSnapshot('goods_receipts',goodsReceipts,docToRow);
      await refreshDocumentInventory(doc);
    }catch(error){
      console.warn('apply goods receipt lots',error);
      showToast('รับสินค้าเข้าสต๊อกไม่สำเร็จ กรุณาตรวจจำนวน Lot และลองใหม่','danger-top');
      render(); return;
    }
  }
  doc.status=plan.status;
  doc.stockApplied=plan.stockApplied||doc.stockApplied===true;
  doc.stockAppliedAt=plan.stockApplied?(doc.stockAppliedAt||new Date().toISOString()):'';
  persistWorkspaceData();
  if(plan.status==='รอรับสินค้า'){
    showToast('เปลี่ยนสถานะเป็น “รอรับสินค้า” แล้ว');
  }else if(plan.status==='รับสินค้าแล้ว'){
    showToast(plan.stockDirection>0?'รับสินค้าแล้วและเพิ่มสต๊อกเรียบร้อย':'สถานะเป็น “รับสินค้าแล้ว”');
  }
  render();
}

async function changeProductReturnStatus(id,status){
  const doc=productReturns.find(item=>item.id===id);
  if(!doc) return;
  if(status==='รอรับคืน'&&doc.stockApplied===true){
    showToast('คืนสินค้าและตัดสต๊อกแล้ว ไม่สามารถย้อนกลับเป็น “รอรับคืน” ได้');
    render(); return;
  }
  if(status==='คืนเรียบร้อย'&&doc.stockApplied!==true){
    doc.warehouseId=Number(doc.warehouseId)||Number(activeWarehouseId)||0;
    doc.items=normalizeGoodsReceiptItems(doc.items,doc.warehouseId);
    if(!doc.warehouseId||doc.items.some(item=>!Number(item.lotId))){ showToast('กรุณาเลือกคลังและ Lot ที่คืนให้ครบทุกสินค้า','danger-top'); render(); return; }
    try{
      await saveRevisionedDocument('product_returns',doc);
      const data=await runStockOperation('apply_product_return_lots',{returnId:doc.id});
      Object.assign(doc,data?.return||{},data?.return?{id:doc.id}:{});
      seedTableSnapshot('product_returns',productReturns,docToRow);
      await refreshDocumentInventory(doc);
    }catch(error){ console.warn('apply product return lots',error); showToast('ตัดสต๊อกตาม Lot ไม่สำเร็จ กรุณาตรวจจำนวนสินค้าใน Lot','danger-top'); render(); return; }
  }
  doc.status=status==='คืนเรียบร้อย'?'คืนเรียบร้อย':'รอรับคืน';
  doc.stockApplied=doc.status==='คืนเรียบร้อย'||doc.stockApplied===true;
  persistWorkspaceData();
  showToast(doc.status==='คืนเรียบร้อย'?'คืนสินค้าเรียบร้อยและตัดสต๊อกตาม Lot แล้ว':'สถานะเป็นรอรับคืน');
  render();
}

function poSupplierEditorHtml(s){
  return `<div class="po-supplier-edit">
    <div class="po-supplier-edit-title"><span>แก้ไขข้อมูลผู้จำหน่ายจากหน้าเอกสาร</span><span style="font-size:11px;color:var(--text-muted);font-weight:400;">ข้อมูลจะอัปเดตในสมุดรายชื่อด้วย</span></div>
    <div class="po-supplier-edit-grid">
      <div><label>ชื่อผู้จำหน่าย *</label><input id="po_sup_name" value="${escapeHtml(s.name||'')}"></div>
      <div><label>เลขผู้เสียภาษี</label><input id="po_sup_taxid" value="${escapeHtml(s.taxId||'')}"></div>
      <div><label>ชื่อผู้ติดต่อ</label><input id="po_sup_contact" value="${escapeHtml(s.contactName||'')}"></div>
      <div><label>เบอร์โทรศัพท์</label><input id="po_sup_phone" class="phone-input" value="${escapeHtml(s.phone||'')}"></div>
      <div><label>อีเมล</label><input id="po_sup_email" type="email" value="${escapeHtml(s.email||'')}"></div>
      <div><label>เครดิต (วัน)</label><input id="po_sup_credit" type="number" min="0" value="${escapeHtml(s.creditDays||'')}"></div>
      <div class="wide"><label>ที่อยู่</label><textarea id="po_sup_address" rows="2">${escapeHtml(s.address||'')}</textarea></div>
    </div>
    <div class="po-supplier-edit-actions"><button class="btn ghost small" id="cancelPOSupplierEditBtn" type="button">ยกเลิก</button><button class="btn primary small" id="savePOSupplierEditBtn" type="button">บันทึกข้อมูลผู้จำหน่าย</button></div>
  </div>`;
}

function renderProductReturn(){
  if(editingReturnId!==null) return renderPOForm('ret');
  const allDocs=sortedDocuments(productReturns,'ret');
  const totalPages=Math.max(1,Math.ceil(allDocs.length/DOC_LIST_PAGE_SIZE));
  if(docListPage.ret>totalPages) docListPage.ret=totalPages;
  if(docListPage.ret<1) docListPage.ret=1;
  const start=(docListPage.ret-1)*DOC_LIST_PAGE_SIZE;
  const pageDocs=allDocs.slice(start,start+DOC_LIST_PAGE_SIZE);
  return `<div class="pagehead"><div><h1>ใบคืนสินค้า <span class="page-title-meta">บันทึกการคืนสินค้าให้ผู้จำหน่าย · ${allDocs.length} รายการ</span></h1></div><button class="btn primary" id="newReturnBtn">+ สร้างใบคืนสินค้า</button></div>
  ${documentBulkToolbar('ret')}
  <div class="doc-list-wrap">
  <table class="grid-table doc-list supplier-doc-list"><colgroup><col style="width:42px"><col style="width:130px"><col style="width:180px"><col style="width:220px"><col style="width:360px"><col style="width:150px"><col style="width:110px"></colgroup><thead><tr><th style="width:42px;"><input class="doc-check" type="checkbox" aria-label="เลือกทั้งหมด"></th><th>${documentSortHeader('ret','date','วันที่')}</th><th>${documentSortHeader('ret','id','เลขที่เอกสาร')}</th><th>${documentSortHeader('ret','supplier','ชื่อผู้จำหน่าย')}</th><th>รายการ</th><th>${documentSortHeader('ret','status','สถานะ')}</th><th></th></tr></thead>
  <tbody>${pageDocs.map(doc=>{
    const posted=documentHasPostedStock('ret',doc);
    const deleteButton=posted?'':`<button class="history-icon-btn danger" data-doc-action="delete" data-kind="ret" data-id="${escapeHtml(doc.id)}" title="ลบ" aria-label="ลบ ${escapeHtml(doc.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`;
    return `<tr><td style="text-align:center;"><input class="doc-check" type="checkbox" value="${escapeHtml(doc.id)}" aria-label="เลือก ${escapeHtml(doc.id)}" ${posted?'disabled':''}></td><td style="text-align:center;">${escapeHtml(fmtDate(doc.date))}</td><td class="mono" style="text-align:center;">${escapeHtml(doc.id)}</td><td style="text-align:center;">${escapeHtml(doc.supplier||'-')}</td><td>${documentItemsPreview(doc.items)}</td><td style="text-align:center;">${documentStatusControl('ret',doc)}</td><td style="text-align:center;"><div class="history-actions product-return-actions"><button class="history-icon-btn" data-doc-action="edit" data-kind="ret" data-id="${escapeHtml(doc.id)}" title="แก้ไข" aria-label="แก้ไข ${escapeHtml(doc.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button>${deleteButton}</div></td></tr>`;
  }).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">ยังไม่มีใบคืนสินค้า</td></tr>'}</tbody></table>
  </div>${pagerHtml(docListPage.ret,totalPages,'docpage-ret')}`;
}

function renderGoodsReceipt(){
  if(editingGRId!==null) return renderPOForm('gr');
  const allDocs=sortedDocuments(goodsReceipts,'gr');
  const totalPages=Math.max(1, Math.ceil(allDocs.length/DOC_LIST_PAGE_SIZE));
  if(docListPage.gr>totalPages) docListPage.gr=totalPages;
  if(docListPage.gr<1) docListPage.gr=1;
  const start=(docListPage.gr-1)*DOC_LIST_PAGE_SIZE;
  const pageDocs=allDocs.slice(start,start+DOC_LIST_PAGE_SIZE);
  return `<div class="pagehead"><div><h1>ใบรับสินค้า <span class="page-title-meta">บันทึกและตรวจสอบการรับสินค้าเข้าคลัง · ${allDocs.length} รายการ</span></h1></div><button class="btn primary" id="newGRBtn">+ สร้างใบรับสินค้า</button></div>
  ${documentBulkToolbar('gr')}
  <div class="doc-list-wrap">
  <table class="grid-table doc-list supplier-doc-list"><colgroup><col style="width:42px"><col style="width:120px"><col style="width:160px"><col style="width:180px"><col style="width:240px"><col style="width:180px"><col style="width:120px"><col style="width:110px"><col style="width:130px"><col style="width:126px"></colgroup><thead><tr><th style="width:42px;"><input class="doc-check" type="checkbox" aria-label="เลือกทั้งหมด"></th><th>${documentSortHeader('gr','date','วันที่')}</th><th>${documentSortHeader('gr','id','เลขที่เอกสาร')}</th><th>${documentSortHeader('gr','supplier','ชื่อผู้จำหน่าย')}</th><th>รายการ</th><th>สาขา</th><th>${documentSortHeader('gr','due','วันครบกำหนด')}</th><th class="mono">${documentSortHeader('gr','total','ยอดรวม')}</th><th>${documentSortHeader('gr','status','สถานะ')}</th><th style="width:126px;"></th></tr></thead>
  <tbody>${pageDocs.map(g=>{
    const posted=documentHasPostedStock('gr',g);
    const canManage=canManageGoodsReceipt(g);
    const editButton=posted||!canManage?'':`<button class="history-icon-btn gr-edit-btn" data-doc-action="edit" data-kind="gr" data-id="${escapeHtml(g.id)}" title="แก้ไข" aria-label="แก้ไข ${escapeHtml(g.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button>`;
    const deleteButton=posted||!canManage?'':`<button class="history-icon-btn danger" data-doc-action="delete" data-kind="gr" data-id="${escapeHtml(g.id)}" title="ลบ" aria-label="ลบ ${escapeHtml(g.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`;
    return `<tr><td style="text-align:center;"><input class="doc-check" type="checkbox" value="${escapeHtml(g.id)}" aria-label="เลือก ${escapeHtml(g.id)}" ${posted||!canManage?'disabled':''}></td><td style="text-align:center;">${fmtDate(g.date)}</td><td class="mono" style="text-align:center;">${escapeHtml(g.id)}</td><td style="text-align:center;">${escapeHtml(g.supplier)}</td><td>${expandableDocumentItemsPreview('goods-receipt',g.id,g.items)}</td><td style="text-align:center;">${escapeHtml(goodsReceiptWarehouseName(g))}</td><td style="text-align:center;">${documentDueBadge(g)}</td><td class="mono num" style="text-align:center;">${fmtMoney(g.total)}</td><td style="text-align:center;">${documentStatusControl('gr',g)}</td><td style="text-align:center;"><div class="history-actions">${editButton}<button class="history-icon-btn" data-doc-action="print" data-kind="gr" data-id="${escapeHtml(g.id)}" title="พิมพ์" aria-label="พิมพ์ ${escapeHtml(g.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/></svg></button>${deleteButton}</div></td></tr>${expandableDocumentItemsDetailRow('goods-receipt',g.id,g.items,10)}`;
  }).join('')||`<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:24px;">ยังไม่มีการรับสินค้า</td></tr>`}</tbody></table>
  </div>
  ${pagerHtml(docListPage.gr, totalPages, 'docpage-gr')}`;
}

function productExchangeDocumentNumber(){
  const prefix=documentPrefixes.productExchange||'EX';
  return buildDocNumber(prefix,nextDailySeq(prefix,productExchanges.map(doc=>doc.id)));
}
function newProductExchangeDraft(){
  return {id:productExchangeDocumentNumber(),date:TODAY_STR,supplier:'',warehouseId:Number(activeWarehouseId)||Number(accessibleWarehouses()[0]?.id)||0,note:'',status:'ร่าง',outgoingItems:[],incomingItems:[],outgoingApplied:false,incomingApplied:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function activeProductExchangeDraft(){
  if(productExchangeDraft) return productExchangeDraft;
  if(editingProductExchangeId==='new') productExchangeDraft=newProductExchangeDraft();
  else{
    const saved=productExchanges.find(doc=>doc.id===editingProductExchangeId);
    productExchangeDraft=saved?JSON.parse(JSON.stringify(saved)):newProductExchangeDraft();
  }
  return productExchangeDraft;
}
function productExchangeStatusBadge(status){
  const value=PRODUCT_EXCHANGE_STATUSES.includes(status)?status:'ร่าง';
  const cls=value==='รับสินค้ากลับแล้ว'?'po-complete':value==='ส่งไปเปลี่ยนแล้ว'?'po-done':'po-pending';
  return `<span class="doc-status-select ${cls}" style="display:inline-flex;align-items:center;justify-content:center;min-width:142px;">${escapeHtml(value)}</span>`;
}
function productExchangeWarehouseName(doc){
  return warehouses.find(warehouse=>Number(warehouse.id)===Number(doc?.warehouseId))?.name||'-';
}
function productExchangeItemsPreview(items){
  const list=items||[];
  const shown=list.slice(0,3).map(item=>{
    const qty=item?.qty?` ×${escapeHtml(item.qty)}`:'';
    const unit=item?.unit?` ${escapeHtml(item.unit)}`:'';
    return `${escapeHtml(item?.name||'-')}${qty}${unit}`;
  }).join('<br>');
  const more=list.length>3?`<span class="doc-item-more">+${list.length-3} รายการ</span>`:'';
  return `<div class="doc-item-preview">${shown||'-'} ${more}</div>`;
}
function productExchangeDisplayItems(doc){
  const rows=(items,kind)=>(items||[]).map(item=>({...item,name:item?.name||products.find(product=>Number(product.id)===Number(item?.pid))?.name||'-',kind}));
  return [...rows(doc?.outgoingItems,'ส่งไป'),...rows(doc?.incomingItems,'รับกลับ')];
}
function productExchangePreview(doc){
  const displayItems=productExchangeDisplayItems(doc);
  const unreturned=productExchangeReconciliation(doc).unreturnedItems;
  const unreturnedNote=doc.status==='รับสินค้ากลับแล้ว'&&unreturned.length?`<div style="margin-top:5px;color:var(--danger);"><b>ไม่ได้รับคืน</b> ${unreturned.length} รายการ (ตัดสต๊อกแล้ว)</div>`:'';
  return `${expandableDocumentItemsPreview('product-exchange',doc.id,displayItems)}${unreturnedNote}`;
}
