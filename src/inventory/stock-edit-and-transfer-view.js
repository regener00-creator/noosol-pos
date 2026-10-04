function stockEditMatchesQuery(p,query){
  const q=String(query||'').trim();
  if(!q) return true;
  const needle=q.toLowerCase();
  return String(p.name||'').toLowerCase().includes(needle)
    || String(p.sku||'').toLowerCase().includes(needle)
    || matchesBarcode(p,q);
}

function stockEditPendingChanges(productList=products,draftStocks=stockEditDraftStocks){
  return Object.entries(draftStocks||{}).map(([id,newStock])=>{
    const product=productList.find(p=>p.id===Number(id));
    const stock=Number(newStock);
    return product&&Number.isFinite(stock)&&(stock!==Number(product.stock)||stockEditRequiresReconciliation(product))?{product,newStock:stock}:null;
  }).filter(Boolean);
}

function stockEditPagination(rowList=stockEditCurrentProducts(),page=stockEditPage,pageSize=STOCK_EDIT_PAGE_SIZE){
  const totalPages=Math.max(1,Math.ceil(rowList.length/pageSize));
  const currentPage=Math.min(Math.max(1,Number(page)||1),totalPages);
  const start=(currentPage-1)*pageSize;
  return {rows:rowList.slice(start,start+pageSize),currentPage,totalPages};
}

function stockEditLotControlHtml(product,difference){
  const targetStock=(Number(product.stock)||0)+(Number(difference)||0);
  const lotDifference=targetStock-stockEditLotTotal(product.id);
  if(Math.abs(lotDifference)<0.000001) return '<span class="stock-control-lot-hint">ยอด LOT ตรงกับจำนวนที่นับได้</span>';
  const lots=stockEditAvailableLots(product.id);
  let selection=stockEditLotSelections[product.id]||stockEditDefaultLotSelection(product,lotDifference);
  const validSelections=new Set(lots.map(lot=>`lot:${lot.id}`));
  validSelections.add(lotDifference<0?'auto':'new');
  if(!validSelections.has(selection)) selection=stockEditDefaultLotSelection(product,lotDifference);
  stockEditLotSelections[product.id]=selection;
  const lotOptions=lots.map(lot=>{
    const label=`${lot.manufacturer_lot||'ไม่ระบุเลข LOT'} · ${lot.expiry_date?fmtDate(lot.expiry_date):'ไม่ระบุวันหมดอายุ'} · ${inspectionListAmount(lot.quantity_base)} ${product.unit||''}`;
    return `<option value="lot:${lot.id}" ${selection===`lot:${lot.id}`?'selected':''}>${escapeHtml(label)}</option>`;
  }).join('');
  if(lotDifference<0){
    return `<select class="stock-control-lot-select" data-stock-edit-lot="${product.id}"><option value="auto" ${selection==='auto'?'selected':''}>อัตโนมัติตาม FEFO</option>${lotOptions}</select><span class="stock-control-lot-hint">เลือก LOT ที่พบส่วนต่าง หรือให้ระบบตัด LOT ใกล้หมดอายุก่อน</span>`;
  }
  const newLotFields=selection==='new'?`<div class="stock-control-new-lot-fields"><input class="stock-control-new-lot-input" data-stock-edit-new-lot="${product.id}" value="${escapeHtml(stockEditNewLotNumbers[product.id]||'')}" placeholder="เลข LOT ผู้ผลิต (ถ้ามี)"><input class="stock-control-new-lot-input dmy-input" type="text" inputmode="numeric" maxlength="10" autocomplete="off" data-stock-edit-new-expiry="${product.id}" value="${escapeHtml(isoToDMY(stockEditNewLotExpiries[product.id]||product.expiry||''))}" placeholder="วว/ดด/ปปปป" aria-label="วันหมดอายุ LOT ใหม่"></div>`:'';
  return `<select class="stock-control-lot-select" data-stock-edit-lot="${product.id}">${lotOptions}<option value="new" ${selection==='new'?'selected':''}>สร้าง LOT ใหม่</option></select>${newLotFields}<span class="stock-control-lot-hint">ของที่พบเกินต้องเข้า LOT เดิมหรือสร้าง LOT ใหม่</span>`;
}

function stockEditRowsHtml(rows=stockEditCurrentProducts()){
  if(!rows.length) return '<tr><td colspan="8" class="stock-edit-empty">ยังไม่มีรายการ — ดึงรายการตรวจสินค้า ค้นหา/สแกนบาร์โค้ด หรือเลือกสินค้าในหมวดด้านบนเพื่อเพิ่ม</td></tr>';
  return rows.map(p=>{
    const unitOptions=[{name:p.unit,barcode:p.barcode||'',factor:1},...(p.units||[]).filter(u=>u.sub&&Number(u.factor)>0).map(u=>({name:u.sub,barcode:u.barcode||'',factor:Number(u.factor)}))];
    const selectedUnit=stockEditRowUnitSel[p.id]||p.unit;
    const selectedOption=unitOptions.find(u=>u.name===selectedUnit)||unitOptions[0];
    const hasDraft=Object.prototype.hasOwnProperty.call(stockEditDraftStocks,p.id);
    const selectedBaseStock=hasDraft?stockEditDraftStocks[p.id]:p.stock;
    const selectedAmount=stockUnitAmountFromBase(selectedBaseStock,selectedOption.factor);
    const systemAmount=stockUnitAmountFromBase(p.stock,selectedOption.factor);
    const differenceBase=Number(selectedBaseStock)-Number(p.stock);
    const differenceAmount=stockUnitAmountFromBase(differenceBase,selectedOption.factor);
    const reconcileOnly=Math.abs(differenceBase)<=0.000001&&stockEditRequiresReconciliation(p);
    const differenceHtml=Math.abs(differenceBase)>0.000001?`<span class="stock-control-difference ${differenceBase>0?'in':'out'}">${differenceAmount>0?'+':''}${inspectionListAmount(differenceAmount)}</span>`:reconcileOnly?'<span class="stock-control-difference out">ปรับ LOT</span>':'-';
    const unitHtml=unitOptions.length>1
      ? `<select class="stock-edit-unit-select" data-stock-edit-unit="${p.id}">${unitOptions.map(u=>`<option value="${escapeHtml(u.name)}" ${u.name===selectedOption.name?'selected':''}>${escapeHtml(u.name)}</option>`).join('')}</select>`
      : `<span class="stock-edit-unit-fixed">${escapeHtml(p.unit||'-')}</span>`;
    return `<tr data-stock-edit-row="${p.id}">
      <td class="mono" style="text-align:center;">${escapeHtml(selectedOption.barcode||'-')}</td>
      <td>${escapeHtml(p.name)}</td>
      <td style="text-align:center;">${unitHtml}</td>
      <td class="mono" style="text-align:center;">${inspectionListAmount(systemAmount)}</td>
      <td style="text-align:center;"><input type="number" min="0" step="any" class="stock-edit-stock-input ${Number(selectedBaseStock)<0?'stock-negative':''} ${hasDraft?'stock-edit-pending':''}" data-stock-edit-amount="${p.id}" data-factor="${selectedOption.factor}" data-unit="${escapeHtml(selectedOption.name)}" value="${selectedAmount}" aria-label="จำนวนที่นับได้ ${escapeHtml(p.name)} หน่วย ${escapeHtml(selectedOption.name)}" title="กรอกจำนวนที่นับได้จริง แล้วกดยืนยันเพื่อบันทึก"></td>
      <td style="text-align:center;">${differenceHtml}</td>
      <td class="stock-control-lot-cell">${stockEditLotControlHtml(p,differenceBase)}</td>
      <td style="text-align:center;"><button class="stock-edit-remove-btn" data-stock-edit-remove="${p.id}" title="ลบ ${escapeHtml(p.name)} ออกจากรายการ" aria-label="ลบ ${escapeHtml(p.name)} ออกจากรายการ"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></td>
    </tr>`;
  }).join('');
}

function renderStockEdit(){
  const filter=stockEditCatFilter;
  const brandOptions=filter.category
    ? brands.filter(brand=>products.some(p=>p.category===filter.category&&p.brand===brand))
    : brands.slice();
  const matchCount=products.filter(p=>(!filter.category||p.category===filter.category)&&(!filter.brand||p.brand===filter.brand)&&(filter.category||filter.brand)).length;
  const rows=stockEditCurrentProducts();
  const pagination=stockEditPagination(rows);
  stockEditPage=pagination.currentPage;
  const pendingChanges=stockEditPendingChanges();
  const sourceList=stockEditInspectionSourceList();
  return `<div class="rpt stock-edit-page">
    <div class="stock-edit-page-actions form-final-actions"><button class="btn primary" id="importInspectionListBtn">ดึงรายการตรวจนับ</button>${rows.length?`<button class="btn ghost" id="clearStockEditBtn">ล้างรายการ</button><button class="btn primary" id="confirmStockEditBtn" ${(pendingChanges.length||stockEditSourcePending)&&!stockEditPosting?'':'disabled'}>${stockEditPosting?'กำลังบันทึก...':'ยืนยันผลตรวจนับ'}</button>`:''}</div>
    <div class="stock-edit-section">
      <div class="rpt-filters" style="margin-bottom:14px;">
        <div class="rpf-item"><select id="stockEditCategorySelect" class="rpt-select"><option value="">หมวดสินค้าหลัก: ทั้งหมด</option>${categories.map(c=>`<option value="${escapeHtml(c)}" ${filter.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select></div>
        <div class="rpf-item"><select id="stockEditBrandSelect" class="rpt-select"><option value="">หมวดสินค้าย่อย: ทั้งหมด</option>${brandOptions.map(b=>`<option value="${escapeHtml(b)}" ${filter.brand===b?'selected':''}>${escapeHtml(b)}</option>`).join('')}</select></div>
        <button class="btn ghost" id="stockEditAddByCategoryBtn" ${(filter.category||filter.brand)?'':'disabled'}>เลือกสินค้าในหมวดนี้${(filter.category||filter.brand)?` (${matchCount})`:''}</button>
      </div>
      ${sourceList?`<div class="stock-edit-source-note"><span>ดึงข้อมูลจาก <strong>${escapeHtml(sourceList.name)}</strong> · ${(sourceList.items||[]).length} สินค้า</span><span class="stock-edit-source-status ${stockEditSourcePending?'pending':'done'}">${stockEditSourcePending?'รอยืนยันการแก้ไข':'แก้จำนวนเรียบร้อย'}</span></div>`:''}
      <div style="position:relative;margin-bottom:14px;">
        <input id="stockEditInput" value="${escapeHtml(stockEditSearchQuery)}" placeholder="ค้นหาหรือสแกนบาร์โค้ด..." style="width:100%;padding:11px 13px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;" autocomplete="off">
        <div id="stockEditResults" class="fav-add-results" hidden style="left:0;right:0;top:calc(100% - 6px);"></div>
      </div>
      <div class="stock-edit-table-wrap seamless-table-wrap">
        <table class="grid-table doc-head-blue stock-edit-table">
          <colgroup><col class="stock-edit-col-barcode"><col class="stock-edit-col-name"><col class="stock-edit-col-unit"><col class="stock-edit-col-stock"><col class="stock-edit-col-count"><col class="stock-edit-col-difference"><col class="stock-edit-col-lot"><col class="stock-edit-col-action"></colgroup>
          <thead><tr><th>บาร์โค้ด</th><th>สินค้า</th><th>หน่วย</th><th>ในระบบ</th><th>นับได้</th><th>ต่าง</th><th>LOT ที่ปรับ</th><th aria-label="จัดการ"></th></tr></thead>
          <tbody id="stockEditTbody">${stockEditRowsHtml(pagination.rows)}</tbody>
        </table>
      </div>
      ${pagerHtml(stockEditPage,pagination.totalPages,'stock-edit-page')}
    </div>
  </div>`;
}

function renderTransferForm(){
  const draft=activeTransferDraft();
  const totalQty=(draft.items||[]).reduce((sum,item)=>sum+(Number(item.qty)||0),0);
  return `<div class="transfer-form">
    <div class="pagehead"><div><div class="breadcrumb">คลัง & สินค้า › โอนสินค้าระหว่างคลัง › สร้างใบโอนสินค้า</div><h1>สร้างใบโอนสินค้า</h1><div class="sub mono">${escapeHtml(draft.id)}</div></div></div>
    <div class="panel transfer-card">
      <div class="transfer-meta">
        <div class="transfer-meta-fields">
          <label for="transfer_date">วันที่</label>${dmyDateFieldHtml('transfer_date',draft.date)}
          <label for="transfer_from">คลังต้นทาง *</label><select id="transfer_from"><option value="">กรุณาระบุคลังต้นทาง</option>${warehouses.map(w=>`<option value="${w.id}" ${Number(draft.fromId)===Number(w.id)?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}</select>
          <label for="transfer_by">ผู้ขอโอน</label><input id="transfer_by" value="${escapeHtml(draft.transferor||'')}">
          <label for="transfer_to">คลังปลายทาง *</label><select id="transfer_to"><option value="">กรุณาระบุคลังปลายทาง</option>${warehouses.map(w=>`<option value="${w.id}" ${Number(draft.toId)===Number(w.id)?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}</select>
        </div>
        <div class="transfer-count"><span>จำนวนสินค้ารวม</span><b id="transferTotalQty">${totalQty.toLocaleString('th-TH')}</b></div>
      </div>
      ${documentProductScannerHtml(true)}
      <div class="transfer-items-wrap seamless-table-wrap">
        <table class="grid-table po-items transfer-items"><colgroup><col style="width:80px"><col><col style="width:150px"><col style="width:180px"><col style="width:60px"></colgroup>
          <thead><tr><th>ลำดับ</th><th>ชื่อสินค้า</th><th>จำนวน</th><th>หน่วย</th><th></th></tr></thead>
          <tbody id="transferItemRows">${(draft.items||[]).map(transferItemRowHtml).join('')}</tbody>
        </table>
      </div>
      <button class="btn ghost small" id="addTransferItemBtn" type="button">+ เพิ่มแถวรายการ</button>
      <div class="transfer-notes"><div><label for="transfer_note">หมายเหตุ</label><textarea id="transfer_note">${escapeHtml(draft.note||'')}</textarea></div><div><label for="transfer_internal_note">โน้ตภายในบริษัท</label><textarea id="transfer_internal_note">${escapeHtml(draft.internalNote||'')}</textarea></div></div>
      <div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelTransferBottomBtn">ย้อนกลับ</button><button class="btn primary" id="saveTransferBottomBtn">บันทึกเอกสาร</button></div>
    </div>
  </div>`;
}
