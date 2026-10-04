function renderProductExchange(){
  if(editingProductExchangeId!==null) return renderProductExchangeForm();
  const allDocs=sortedDocuments(productExchanges,'exchange');
  const totalPages=Math.max(1,Math.ceil(allDocs.length/DOC_LIST_PAGE_SIZE));
  if(docListPage.exchange>totalPages) docListPage.exchange=totalPages;
  if(docListPage.exchange<1) docListPage.exchange=1;
  const start=(docListPage.exchange-1)*DOC_LIST_PAGE_SIZE;
  const pageDocs=allDocs.slice(start,start+DOC_LIST_PAGE_SIZE);
  return `<div class="pagehead"><div><h1>เปลี่ยนสินค้า <span class="page-title-meta">ติดตามสินค้าที่ส่งไปเปลี่ยนและสินค้าที่ได้รับกลับ · ${allDocs.length} รายการ</span></h1></div><button class="btn primary" id="newProductExchangeBtn">+ สร้างรายการเปลี่ยนสินค้า</button></div>
  <div class="doc-list-wrap"><table class="grid-table doc-list"><colgroup><col style="width:125px"><col style="width:175px"><col style="width:210px"><col style="width:190px"><col><col style="width:160px"><col style="width:110px"></colgroup><thead><tr><th>${documentSortHeader('exchange','date','วันที่')}</th><th>${documentSortHeader('exchange','id','เลขที่เอกสาร')}</th><th>${documentSortHeader('exchange','supplier','ผู้จำหน่าย')}</th><th>คลัง / สาขา</th><th>รายการสินค้า</th><th>${documentSortHeader('exchange','status','สถานะ')}</th><th></th></tr></thead><tbody>
  ${pageDocs.map(doc=>{
    const deleteButton=documentHasPostedStock('exchange',doc)?'':`<button class="history-icon-btn danger" data-product-exchange-delete="${escapeHtml(doc.id)}" title="ลบ" aria-label="ลบ ${escapeHtml(doc.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`;
    return `<tr><td style="text-align:center;">${fmtDate(doc.date)}</td><td class="mono" style="text-align:center;">${escapeHtml(doc.id)}</td><td style="text-align:center;">${escapeHtml(doc.supplier||'-')}</td><td style="text-align:center;">${escapeHtml(productExchangeWarehouseName(doc))}</td><td>${productExchangePreview(doc)}</td><td style="text-align:center;">${productExchangeStatusBadge(doc.status)}</td><td style="text-align:center;"><div class="history-actions product-exchange-actions"><button class="history-icon-btn" data-product-exchange-edit="${escapeHtml(doc.id)}" title="แก้ไข" aria-label="แก้ไข ${escapeHtml(doc.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button>${deleteButton}</div></td></tr>${expandableDocumentItemsDetailRow('product-exchange',doc.id,productExchangeDisplayItems(doc),7)}`;
  }).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:26px;">ยังไม่มีรายการเปลี่ยนสินค้า</td></tr>'}
  </tbody></table></div>${pagerHtml(docListPage.exchange,totalPages,'docpage-exchange')}`;
}
function productExchangeUnitOptionsHtml(product,selectedUnit,locked){
  return productUnitOptions(product).map(option=>`<option value="${escapeHtml(option.name)}" ${option.name===selectedUnit?'selected':''}>${escapeHtml(option.name)}</option>`).join('');
}
function productExchangeSectionHtml(side,title,subtitle,items,locked){
  const rows=(items||[]).map((raw,index)=>{
    const item=normalizeProductExchangeItem(raw); if(!item) return '';
    const product=products.find(entry=>Number(entry.id)===Number(item.pid));
    return `<tr data-product-exchange-row="${side}" data-index="${index}"><td class="mono">${escapeHtml(product?.sku||'-')}</td><td class="mono">${escapeHtml(item.barcode||product?.barcode||'-')}</td><td class="product-exchange-name">${escapeHtml(product?.name||item.name||'-')}</td><td><input class="product-exchange-qty" type="number" min="0.01" step="any" value="${item.qty}" ${locked?'disabled':''}></td><td><select class="product-exchange-unit" ${locked?'disabled':''}>${productExchangeUnitOptionsHtml(product,item.unit,locked)}</select></td><td>${side==='incoming'?`<input class="product-exchange-lot" value="${escapeHtml(item.lotNumber||'')}" placeholder="ไม่ระบุ" ${locked?'disabled':''}>`:'<span style="color:var(--text-muted);">ระบบตัด FEFO</span>'}</td><td><input class="product-exchange-expiry dmy-input" type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="วว/ดด/ปปปป" value="${escapeHtml(isoToDMY(item.expiry))}" ${locked?'disabled':''}></td><td class="mono">${productExchangeItemBaseQty(item)} ${escapeHtml(product?.unit||'')}</td><td>${locked?'':`<button type="button" class="product-exchange-delete" data-product-exchange-remove="${side}:${index}" title="ลบ" aria-label="ลบรายการสินค้า"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`}</td></tr>`;
  }).join('');
  return `<section class="product-exchange-section ${locked?'product-exchange-locked':''}" data-product-exchange-side="${side}"><div class="product-exchange-section-head"><div><h2>${title} <span>• ${subtitle}</span></h2></div>${side==='incoming'&&!locked?'<button type="button" class="btn ghost" id="copyExchangeOutgoingBtn">คัดลอกจากสินค้าที่ส่งไป</button>':''}</div>
    ${locked?'':`<div class="product-exchange-scan-wrap"><div class="product-exchange-scan-row"><input id="productExchangeScan_${side}" data-product-exchange-scan="${side}" autocomplete="off" placeholder="ค้นหา / ยิงบาร์โค้ด / รหัสสินค้า"></div><div class="product-exchange-results" id="productExchangeResults_${side}" hidden></div></div>`}
    <div class="product-exchange-table-wrap"><table class="grid-table product-exchange-table"><colgroup><col style="width:115px"><col style="width:165px"><col><col style="width:110px"><col style="width:140px"><col style="width:150px"><col style="width:160px"><col style="width:145px"><col style="width:58px"></colgroup><thead><tr><th>รหัสสินค้า</th><th>บาร์โค้ด</th><th>สินค้า</th><th>จำนวน</th><th>หน่วย</th><th>เลข Lot</th><th>วันหมดอายุ</th><th>เทียบหน่วยหลัก</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="9" class="product-exchange-empty">ยังไม่มีสินค้าในรายการ</td></tr>'}</tbody></table></div></section>`;
}
function productExchangeReconciliationHtml(doc){
  const reconciliation=productExchangeReconciliation(doc);
  if(reconciliation.fullyReturned){
    return '<div class="product-exchange-reconciliation complete"><b>รับคืนครบตามสินค้าที่ส่งไป</b>เมื่อยืนยัน ระบบจะเพิ่มสต๊อกกลับเฉพาะจำนวนที่ระบุใน “สินค้าที่ได้รับกลับ”</div>';
  }
  const unreturned=reconciliation.unreturnedItems.map(item=>`<li>${escapeHtml(item.name||products.find(product=>Number(product.id)===Number(item.pid))?.name||'-')} — ${item.qty} ${escapeHtml(item.unit||'หน่วย')}</li>`).join('');
  const replacement=reconciliation.replacementItems.length?`<div class="replacement-note">รับเป็นสินค้าคนละตัว ${reconciliation.replacementItems.length} รายการ — สินค้าเหล่านี้จะถูกเพิ่มเข้าสต๊อกตามจำนวนที่ระบุ</div>`:'';
  return `<div class="product-exchange-reconciliation"><b>ไม่ได้รับคืน ${reconciliation.unreturnedItems.length} รายการ</b><ul>${unreturned}</ul><div>รายการด้านบนถูกตัดสต๊อกตอนยืนยันส่งไปแล้ว และจะไม่ถูกบวกกลับ</div>${replacement}</div>`;
}
function renderProductExchangeForm(){
  const draft=activeProductExchangeDraft();
  const outgoingLocked=draft.outgoingApplied===true;
  const incomingLocked=draft.incomingApplied===true;
  const received=incomingLocked||draft.status==='รับสินค้ากลับแล้ว';
  return `<div class="product-exchange-form"><div class="pagehead"><div><div class="breadcrumb">ซื้อ › เปลี่ยนสินค้า</div><h1>${escapeHtml(draft.id)}</h1></div><div class="form-final-actions product-exchange-form-actions"><button class="btn ghost" id="cancelProductExchangeBtn">ยกเลิก</button><button class="btn primary" id="saveProductExchangeBtn" ${received?'disabled':''}>บันทึกเอกสาร</button></div></div>
    <div class="product-exchange-status-note">สถานะ: <b>${escapeHtml(draft.status||'ร่าง')}</b>${received?' · ปิดการรับกลับและลงสต๊อกแล้ว รายการถูกล็อกเพื่อป้องกันการบันทึกซ้ำ':''}</div>
    <div class="panel product-exchange-meta"><label>วันที่เอกสาร<input id="productExchangeDate" class="dmy-input" type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="วว/ดด/ปปปป" value="${escapeHtml(isoToDMY(draft.date||TODAY_STR))}" ${received?'disabled':''}></label><label>ผู้จำหน่าย${documentPartyFieldHtml('productExchangeSupplier',draft.supplier,'supplier',received)}</label><label>คลัง / สาขา<select id="productExchangeWarehouse" ${outgoingLocked?'disabled':''}>${accessibleWarehouses().map(item=>`<option value="${item.id}" ${Number(item.id)===Number(draft.warehouseId)?'selected':''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><label>เลขที่เอกสาร<input value="${escapeHtml(draft.id)}" readonly></label><label class="product-exchange-note">หมายเหตุ<textarea id="productExchangeNote" rows="2" ${received?'disabled':''} placeholder="รายละเอียดเพิ่มเติม">${escapeHtml(draft.note||'')}</textarea></label></div>
    ${productExchangeSectionHtml('outgoing','สินค้าที่ส่งเปลี่ยน','ตัดออกจากสต๊อกเมื่อยืนยัน “ส่งไปเปลี่ยนแล้ว”',draft.outgoingItems,outgoingLocked)}
    ${productExchangeSectionHtml('incoming','สินค้าที่ได้รับกลับ','รับคืนไม่ครบหรือรับเป็นสินค้าคนละตัวได้ · ระบบเพิ่มเฉพาะรายการและจำนวนที่ระบุ',draft.incomingItems,incomingLocked)}
    ${outgoingLocked?productExchangeReconciliationHtml(draft):''}
    <div class="product-exchange-summary"><span>ส่งไป <b>${draft.outgoingItems.length}</b> รายการ</span><span>รับกลับ <b>${draft.incomingItems.length}</b> รายการ</span>${outgoingLocked?`<span>ไม่ได้รับคืน <b>${productExchangeReconciliation(draft).unreturnedItems.length}</b> รายการ</span>`:''}</div>
    ${received?'':`<div class="form-bottom-actions" style="display:flex;justify-content:flex-end;gap:10px;">${outgoingLocked?'':'<button class="btn ghost" id="confirmExchangeSentBtn">ยืนยันส่งไปเปลี่ยนแล้ว</button>'}<button class="btn primary" id="confirmExchangeReceivedBtn">ยืนยันรับสินค้ากลับแล้ว</button></div>`}
  </div>`;
}
