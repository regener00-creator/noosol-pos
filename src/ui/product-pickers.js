function favoriteUnitOptionsHtml(product,selectedUnit){
  return productUnitOptions(product).map(option=>`<option value="${escapeHtml(option.name)}" ${option.name===selectedUnit?'selected':''}>${escapeHtml(option.name)} · ${fmtMoney(option.price)}</option>`).join('');
}
function favManageListHtml(){
  if(!favorites.length) return `<div class="fav-manage-empty">ยังไม่มีสินค้าโปรด — ค้นหาด้านบนเพื่อเพิ่ม</div>`;
  return favorites.map((entry,i)=>{
    const id=favoriteProductId(entry);
    const p=products.find(x=>Number(x.id)===id);
    if(!p) return '';
    const selectedUnit=favoriteSelectedUnit(entry,p);
    return `<div class="fav-manage-row" draggable="true" tabindex="0" data-fav-drag-index="${i}" data-fav-product-id="${id}" aria-label="${escapeHtml(p.name)} คลิกค้างแล้วลากเพื่อจัดลำดับ">
      <span class="fav-drag-handle" aria-hidden="true">⠿</span>
      <div class="fav-manage-info"><span class="fav-manage-name">${escapeHtml(p.name)}</span><select class="fav-manage-unit" data-fav-unit-change="${i}" aria-label="หน่วยสินค้าโปรด ${escapeHtml(p.name)}">${favoriteUnitOptionsHtml(p,selectedUnit)}</select></div>
      <div class="fav-manage-actions">
        <button class="icon-btn danger" data-fav-remove="${i}" title="ลบออกจากสินค้าโปรด">×</button>
      </div>
    </div>`;
  }).join('');
}

function openInspectionListCategoryPicker(filter){
  if(!inspectionListDraft) return;
  const matches=activeProducts().filter(product=>(!filter.category||product.category===filter.category)&&(!filter.brand||product.brand===filter.brand));
  if(!matches.length){ showToast('ไม่พบสินค้าในหมวดที่เลือก'); return; }
  const alreadyIn=id=>inspectionListDraft.items.some(item=>Number(item.pid)===Number(id));
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:520px;max-height:82vh;display:flex;flex-direction:column;">
    <div class="modal-head"><h3>เลือกสินค้าเข้ารายการตรวจ</h3><button class="modal-close" aria-label="ปิด">×</button></div>
    <div class="modal-sub">${filter.wh?`${escapeHtml(whName(Number(filter.wh)))} · `:''}${escapeHtml(filter.category||'ทุกหมวดหลัก')}${filter.brand?` · ${escapeHtml(filter.brand)}`:''} · พบ ${matches.length} รายการ</div>
    <div style="padding:0 16px 8px;display:flex;gap:14px;"><button class="btn ghost small" id="inspectionPickAllBtn">เลือกทั้งหมด</button><button class="btn ghost small" id="inspectionPickNoneBtn">ไม่เลือกเลย</button></div>
    <div class="manage-list" id="inspectionPickList" style="flex:1;">${matches.map(product=>`<label class="fav-check"><input type="checkbox" data-pid="${product.id}" ${alreadyIn(product.id)?'checked disabled':''}> <span>${escapeHtml(product.name)}</span> <span class="mono" style="margin-right:auto;color:var(--text-muted);font-size:12px;">${alreadyIn(product.id)?'อยู่ในรายการแล้ว':`ขาย ${fmtMoney(product.price)} · ${escapeHtml(stockInLargestUnit(product))}`}</span></label>`).join('')}</div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);text-align:left;display:flex;gap:8px;"><button class="btn ghost" id="inspectionPickCancelBtn">ยกเลิก</button><button class="btn primary" id="inspectionPickAddBtn">เพิ่มที่เลือก</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#inspectionPickCancelBtn').onclick=close;
  const checkboxes=()=>[...overlay.querySelectorAll('#inspectionPickList input[type="checkbox"]:not(:disabled)')];
  overlay.querySelector('#inspectionPickAllBtn').onclick=()=>checkboxes().forEach(checkbox=>checkbox.checked=true);
  overlay.querySelector('#inspectionPickNoneBtn').onclick=()=>checkboxes().forEach(checkbox=>checkbox.checked=false);
  overlay.querySelector('#inspectionPickAddBtn').onclick=()=>{
    let added=0;
    checkboxes().filter(checkbox=>checkbox.checked).forEach(checkbox=>{
      const product=products.find(entry=>entry.id===Number(checkbox.dataset.pid));
      if(inspectionListAddProduct(product,product?.unit)) added++;
    });
    close(); showToast(added?`เพิ่มสินค้า ${added} รายการแล้ว`:'ไม่ได้เลือกสินค้าเพิ่ม'); render();
  };
}

function openInventoryMovementCategoryPicker(filter){
  const matches=products.filter(product=>(!filter.category||product.category===filter.category)&&(!filter.brand||product.brand===filter.brand));
  if(!matches.length){ showToast('ไม่พบสินค้าในหมวดที่เลือก'); return; }
  const alreadySelected=id=>(filter.products||[]).some(productId=>Number(productId)===Number(id));
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:500px;max-height:82vh;display:flex;flex-direction:column;">
    <div class="modal-head"><h3>เลือกสินค้าสำหรับรายงาน</h3><button class="modal-close" aria-label="ปิด">×</button></div>
    <div class="modal-sub">${escapeHtml(filter.category||'ทุกหมวดหลัก')}${filter.brand?` · ${escapeHtml(filter.brand)}`:''} · พบ ${matches.length} รายการ</div>
    <div style="padding:0 16px 8px;display:flex;gap:14px;"><button class="btn ghost small" id="movementPickAll">เลือกทั้งหมด</button><button class="btn ghost small" id="movementPickNone">ไม่เลือกเลย</button></div>
    <div class="manage-list" id="movementPickList" style="flex:1;">${matches.map(product=>`<label class="fav-check"><input type="checkbox" data-movement-pid="${product.id}" ${alreadySelected(product.id)?'checked disabled':''}><span>${escapeHtml(product.name)}</span><span class="mono" style="margin-right:auto;color:var(--text-muted);font-size:12px;">${alreadySelected(product.id)?'เลือกไว้แล้ว':escapeHtml(product.sku||'-')}</span></label>`).join('')}</div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);text-align:left;display:flex;gap:8px;"><button class="btn ghost" id="movementPickCancel">ยกเลิก</button><button class="btn primary" id="movementPickAdd">เพิ่มที่เลือก</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  const checkboxes=()=>Array.from(overlay.querySelectorAll('#movementPickList input[type="checkbox"]:not(:disabled)'));
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#movementPickCancel').onclick=close;
  overlay.querySelector('#movementPickAll').onclick=()=>checkboxes().forEach(checkbox=>checkbox.checked=true);
  overlay.querySelector('#movementPickNone').onclick=()=>checkboxes().forEach(checkbox=>checkbox.checked=false);
  overlay.querySelector('#movementPickAdd').onclick=()=>{
    const selected=checkboxes().filter(checkbox=>checkbox.checked).map(checkbox=>Number(checkbox.dataset.movementPid));
    let added=0;
    selected.forEach(id=>{ if(!alreadySelected(id)){ filter.products.push(id); added++; } });
    filter.page=1; close(); showToast(added?`เพิ่มสินค้า ${added} รายการแล้ว`:'ไม่ได้เลือกสินค้าเพิ่ม'); render();
  };
}

function openStockReportCategoryPicker(catf, onDone){
  const matches=products.filter(product=>stockReportProductMatchesFilter(product,catf));
  const warehouseValue=String(catf.wh||(isAllWarehousesMode()?'all':activeWarehouseId));
  if(!matches.length){ showToast('ไม่พบสินค้าในหมวดที่เลือก'); return; }
  const alreadyIn = id => stockReportItems.some(r=>r.pid===id);
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:480px;max-height:82vh;display:flex;flex-direction:column;">
    <div class="modal-head"><h3>เลือกสินค้าในหมวดนี้</h3><button class="modal-close">×</button></div>
    <div class="modal-sub">${warehouseValue==='all'?'ทุกคลัง':escapeHtml(warehouses.find(warehouse=>String(warehouse.id)===warehouseValue)?.name||'คลังที่เลือก')} · ${escapeHtml(catf.category||'ทุกหมวดหลัก')}${catf.brand?` · ${escapeHtml(catf.brand)}`:''} · พบ ${matches.length} รายการ</div>
    <div style="padding:0 16px 8px;display:flex;gap:14px;">
      <button class="btn ghost small" id="srPickAllBtn">เลือกทั้งหมด</button>
      <button class="btn ghost small" id="srPickNoneBtn">ไม่เลือกเลย</button>
    </div>
    <div class="manage-list" id="srPickList" style="flex:1;">${matches.map(p=>`<label class="fav-check"><input type="checkbox" data-pid="${p.id}" ${alreadyIn(p.id)?'checked disabled':''}> <span>${escapeHtml(p.name)}</span> <span class="mono" style="margin-right:auto;color:var(--text-muted);font-size:12px;">${alreadyIn(p.id)?'อยู่ในรายงานแล้ว':stockInLargestUnit({...p,stock:reportStock(p.id,warehouseValue)})}</span></label>`).join('')}</div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;"><button class="btn ghost" id="srPickCancelBtn">ยกเลิก</button><button class="btn primary" id="srPickAddBtn">เพิ่มที่เลือก</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#srPickCancelBtn').onclick=close;

  const checkboxes=()=>Array.from(overlay.querySelectorAll('#srPickList input[type=checkbox]:not(:disabled)'));
  overlay.querySelector('#srPickAllBtn').onclick=()=>{ checkboxes().forEach(cb=>cb.checked=true); };
  overlay.querySelector('#srPickNoneBtn').onclick=()=>{ checkboxes().forEach(cb=>cb.checked=false); };
  overlay.querySelector('#srPickAddBtn').onclick=()=>{
    const chosenIds=checkboxes().filter(cb=>cb.checked).map(cb=>Number(cb.dataset.pid));
    let added=0;
    chosenIds.forEach(id=>{
      const p=products.find(x=>x.id===id);
      if(p && !stockReportItems.some(r=>r.pid===id)){ stockReportItems.unshift({pid:p.id, name:p.name, stock:reportStock(p.id,warehouseValue), unit:p.unit, expiry:reportExpiry(p.id,warehouseValue), wh:warehouseValue}); added++; }
    });
    close();
    showToast(added?`เพิ่มสินค้า ${added} รายการแล้ว`:'ไม่ได้เลือกสินค้าเพิ่ม');
    if(onDone) onDone();
    render();
  };
}

function openBarcodePrintCategoryPicker(filter,missingOnly=false){
  const matches=activeProducts().filter(product=>(!filter.category||product.category===filter.category)&&(!filter.brand||product.brand===filter.brand)&&(!missingOnly||barcodePrintUnitOptions(product).some(option=>!option.barcode)));
  if(!matches.length){ showToast(missingOnly?'ไม่พบสินค้าที่ไม่มีบาร์โค้ด':'ไม่พบสินค้าในหมวดที่เลือก'); return; }
  const alreadyIn=id=>Boolean(barcodePrintFindProductItem(id));
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:520px;max-height:82vh;display:flex;flex-direction:column;">
    <div class="modal-head"><h3>${missingOnly?'สินค้าที่ไม่มีบาร์โค้ด':'เลือกสินค้าในหมวดนี้'}</h3><button class="modal-close" aria-label="ปิด">×</button></div>
    <div class="modal-sub">${missingOnly?'รวมทุกหมวด':`${escapeHtml(filter.category||'ทุกหมวดหลัก')}${filter.brand?` · ${escapeHtml(filter.brand)}`:''}`} · พบ ${matches.length} รายการ</div>
    <div style="padding:0 16px 8px;display:flex;gap:14px;"><button class="btn ghost small" id="barcodePickAllBtn">เลือกทั้งหมด</button><button class="btn ghost small" id="barcodePickNoneBtn">ไม่เลือกเลย</button></div>
    <div class="manage-list" id="barcodePickList" style="flex:1;">${matches.map(product=>{
      const missingUnits=barcodePrintUnitOptions(product).filter(option=>!option.barcode).map(option=>option.name);
      return `<label class="fav-check"><input type="checkbox" data-pid="${product.id}" ${alreadyIn(product.id)?'checked disabled':''}> <span>${escapeHtml(product.name)}</span> <span class="mono" style="margin-right:auto;color:var(--text-muted);font-size:12px;">${alreadyIn(product.id)?'อยู่ในรายการแล้ว':missingUnits.length?`ไม่มี: ${escapeHtml(missingUnits.join(', '))}`:'มีบาร์โค้ดแล้ว'}</span></label>`;
    }).join('')}</div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);text-align:left;display:flex;gap:8px;"><button class="btn ghost" id="barcodePickCancelBtn">ยกเลิก</button><button class="btn primary" id="barcodePickAddBtn">เพิ่มที่เลือก</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#barcodePickCancelBtn').onclick=close;
  const checkboxes=()=>[...overlay.querySelectorAll('#barcodePickList input[type="checkbox"]:not(:disabled)')];
  overlay.querySelector('#barcodePickAllBtn').onclick=()=>checkboxes().forEach(checkbox=>checkbox.checked=true);
  overlay.querySelector('#barcodePickNoneBtn').onclick=()=>checkboxes().forEach(checkbox=>checkbox.checked=false);
  overlay.querySelector('#barcodePickAddBtn').onclick=()=>{
    let added=0;
    checkboxes().filter(checkbox=>checkbox.checked).forEach(checkbox=>{
      const product=products.find(entry=>entry.id===Number(checkbox.dataset.pid));
      if(barcodePrintAddProduct(product)) added++;
    });
    close();
    showToast(added?`เพิ่มสินค้า ${added} รายการแล้ว`:'ไม่ได้เลือกสินค้าเพิ่ม');
    render();
  };
}

function openStockEditInspectionListPicker(){
  const lists=inspectionLists.filter(inspectionListAvailableForStockEdit).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  if(!lists.length){ showToast('ไม่มีรายการตรวจสินค้าที่รอแก้ไขสต๊อก'); return; }
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:620px;max-height:82vh;display:flex;flex-direction:column;">
    <div class="modal-head"><h3>ดึงข้อมูลจากรายการตรวจสินค้า</h3><button class="modal-close" aria-label="ปิด">×</button></div>
    <div class="modal-sub">เลือกรายการที่บันทึกไว้เพื่อนำสินค้าและหน่วยเข้าหน้าแก้ไขสต๊อก</div>
    <div class="stock-edit-import-list">${lists.map(list=>`<div class="stock-edit-import-row">
      <div class="stock-edit-import-info"><div class="stock-edit-import-name">${escapeHtml(list.name)}</div><div class="stock-edit-import-meta">${(list.items||[]).length} สินค้า · แก้ไขล่าสุด ${escapeHtml(inspectionListDateTime(list.updatedAt))}</div></div>
      <button class="btn primary small" data-import-inspection-list="${escapeHtml(list.id)}">ดึงรายการนี้</button>
    </div>`).join('')}</div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);text-align:left;"><button class="btn ghost" id="stockEditImportCancelBtn">ยกเลิก</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#stockEditImportCancelBtn').onclick=close;
  overlay.querySelectorAll('[data-import-inspection-list]').forEach(button=>button.addEventListener('click',()=>{
    if(stockEditImportInspectionList(button.dataset.importInspectionList)) close();
  }));
}

function openStockEditCategoryPicker(filter){
  const matches=products.filter(p=>(!filter.category||p.category===filter.category)&&(!filter.brand||p.brand===filter.brand));
  if(!matches.length){ showToast('ไม่พบสินค้าในหมวดที่เลือก'); return; }
  const alreadyIn=id=>stockEditItems.includes(id);
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:480px;max-height:82vh;display:flex;flex-direction:column;">
    <div class="modal-head"><h3>เลือกสินค้าในหมวดนี้</h3><button class="modal-close" aria-label="ปิด">×</button></div>
    <div class="modal-sub">${escapeHtml(filter.category||'ทุกหมวดหลัก')}${filter.brand?` · ${escapeHtml(filter.brand)}`:''} · พบ ${matches.length} รายการ</div>
    <div style="padding:0 16px 8px;display:flex;gap:14px;"><button class="btn ghost small" id="stockEditPickAllBtn">เลือกทั้งหมด</button><button class="btn ghost small" id="stockEditPickNoneBtn">ไม่เลือกเลย</button></div>
    <div class="manage-list" id="stockEditPickList" style="flex:1;">${matches.map(p=>`<label class="fav-check"><input type="checkbox" data-pid="${p.id}" ${alreadyIn(p.id)?'checked disabled':''}> <span>${escapeHtml(p.name)}</span> <span class="mono" style="margin-right:auto;color:var(--text-muted);font-size:12px;">${alreadyIn(p.id)?'อยู่ในรายการแล้ว':escapeHtml(stockInLargestUnit(p))}</span></label>`).join('')}</div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);text-align:left;display:flex;gap:8px;"><button class="btn ghost" id="stockEditPickCancelBtn">ยกเลิก</button><button class="btn primary" id="stockEditPickAddBtn">เพิ่มที่เลือก</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#stockEditPickCancelBtn').onclick=close;
  const checkboxes=()=>[...overlay.querySelectorAll('#stockEditPickList input[type="checkbox"]:not(:disabled)')];
  overlay.querySelector('#stockEditPickAllBtn').onclick=()=>checkboxes().forEach(cb=>cb.checked=true);
  overlay.querySelector('#stockEditPickNoneBtn').onclick=()=>checkboxes().forEach(cb=>cb.checked=false);
  overlay.querySelector('#stockEditPickAddBtn').onclick=()=>{
    const chosen=checkboxes().filter(cb=>cb.checked).map(cb=>Number(cb.dataset.pid));
    let added=0;
    chosen.forEach(id=>{ if(!stockEditItems.includes(id)){ stockEditItems.push(id); added++; } });
    if(added) stockEditPage=1;
    close();
    showToast(added?`เพิ่มสินค้า ${added} รายการแล้ว`:'ไม่ได้เลือกสินค้าเพิ่ม');
    render();
  };
}
