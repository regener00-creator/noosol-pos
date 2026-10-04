// ===== ระบบโปรโมชั่น: ฟังก์ชันจัดการฟอร์ม =====
// ค้นหาสินค้าแบบพิมพ์ค้นหา (เหมือนช่องสแกน/ค้นหาสินค้าในเอกสารอื่น) สำหรับเลือกสินค้าเข้าโปรโมชั่น
function renderPromoProductResults(query){
  const box=document.getElementById('promoProductResults');
  if(!box) return;
  const q=String(query||'').trim();
  if(!q){ box.innerHTML=''; box.hidden=true; return; }
  const needle=q.toLowerCase();
  const matches=activeProducts().filter(p=>
    (p.name||'').toLowerCase().includes(needle) ||
    (p.sku||'').toLowerCase().includes(needle) ||
    (p.barcode||'').toLowerCase().includes(needle)
  ).slice(0,8);
  box.innerHTML=matches.length?matches.map(p=>
    `<button type="button" class="doc-scan-result" data-pid="${p.id}"><span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.sku||'-')} · บาร์โค้ด ${escapeHtml(p.barcode||'-')}</small></span></button>`
  ).join(''):`<div class="doc-scan-empty">ไม่พบสินค้า "${escapeHtml(q)}"</div>`;
  box.hidden=false;
  box.querySelectorAll('.doc-scan-result').forEach(btn=>{
    btn.addEventListener('mousedown',e=>e.preventDefault());
    btn.addEventListener('click',()=>selectPromoProduct(Number(btn.dataset.pid)));
  });
}
function selectPromoProduct(productId){
  const p=products.find(x=>x.id===productId); if(!p) return;
  const hidden=document.getElementById('promo_product_id');
  const searchInput=document.getElementById('promo_product_search');
  const box=document.getElementById('promoProductResults');
  if(hidden) hidden.value=p.id;
  if(searchInput) searchInput.value=p.name;
  if(box){ box.innerHTML=''; box.hidden=true; }
  updatePromoUnitOptions();
  // อัปเดตข้อความ "เลือกแล้ว: ..." โดยไม่ต้อง render ทั้งฟอร์มใหม่ (กันเสีย focus)
  const fieldWrap=document.getElementById('promo_product_field_wrap');
  if(fieldWrap){
    let hint=fieldWrap.querySelector('.promo-selected-hint');
    if(!hint){ hint=document.createElement('div'); hint.className='promo-selected-hint'; hint.style.cssText='font-size:12px;color:var(--text-muted);margin-top:6px;'; fieldWrap.appendChild(hint); }
    hint.innerHTML=`เลือกแล้ว: <b style="color:var(--text);">${escapeHtml(p.name)}</b> (${escapeHtml(p.sku||'-')})`;
  }
}
function bindPromoProductSearch(){
  const input=document.getElementById('promo_product_search');
  const box=document.getElementById('promoProductResults');
  if(!input||!box) return;
  input.addEventListener('input',()=>{
    // ถ้าผู้ใช้แก้ข้อความ ให้ล้างค่าที่เลือกไว้เดิม (ป้องกันเก็บ pid เก่ากับชื่อใหม่ไม่ตรงกัน)
    const hidden=document.getElementById('promo_product_id');
    if(hidden) hidden.value='';
    renderPromoProductResults(input.value);
  });
  input.addEventListener('focus',()=>{ if(input.value.trim()) renderPromoProductResults(input.value); });
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){ box.hidden=true; return; }
    if(e.key!=='Enter') return;
    e.preventDefault();
    const query=input.value.trim(); if(!query) return;
    const exact=activeProducts().find(p=>(p.barcode||'').toLowerCase()===query.toLowerCase()||(p.sku||'').toLowerCase()===query.toLowerCase());
    if(exact){ selectPromoProduct(exact.id); return; }
    const needle=query.toLowerCase();
    const first=activeProducts().find(p=>(p.name||'').toLowerCase().includes(needle));
    if(first) selectPromoProduct(first.id);
  });
  input.addEventListener('blur',()=>setTimeout(()=>{ box.hidden=true; },140));
}
// ===== ค้นหาสินค้าคู่ (buy/get) สำหรับโปรฯ "ซื้อสินค้าหนึ่ง แถมอีกสินค้าหนึ่ง" (scope='buygetdiff') แยกจากช่องค้นหาสินค้ารายตัวเดิมทั้งหมด =====
const PROMO_BGD_FIELD_CONFIG={
  buy:{searchId:'promo_bgd_buy_product_search',hiddenId:'promo_bgd_buy_product_id',resultsId:'promoBgdBuyProductResults',wrapId:'promo_bgd_buy_field_wrap',unitSelectId:'promo_bgd_buy_unit'},
  get:{searchId:'promo_bgd_get_product_search',hiddenId:'promo_bgd_get_product_id',resultsId:'promoBgdGetProductResults',wrapId:'promo_bgd_get_field_wrap',unitSelectId:'promo_bgd_get_unit'},
};
function renderPromoBgdProductResults(which,query){
  const cfg=PROMO_BGD_FIELD_CONFIG[which]; if(!cfg) return;
  const box=document.getElementById(cfg.resultsId);
  if(!box) return;
  const q=String(query||'').trim();
  if(!q){ box.innerHTML=''; box.hidden=true; return; }
  const needle=q.toLowerCase();
  const matches=activeProducts().filter(p=>
    (p.name||'').toLowerCase().includes(needle) ||
    (p.sku||'').toLowerCase().includes(needle) ||
    (p.barcode||'').toLowerCase().includes(needle)
  ).slice(0,8);
  box.innerHTML=matches.length?matches.map(p=>
    `<button type="button" class="doc-scan-result" data-pid="${p.id}"><span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.sku||'-')} · บาร์โค้ด ${escapeHtml(p.barcode||'-')}</small></span></button>`
  ).join(''):`<div class="doc-scan-empty">ไม่พบสินค้า "${escapeHtml(q)}"</div>`;
  box.hidden=false;
  box.querySelectorAll('.doc-scan-result').forEach(btn=>{
    btn.addEventListener('mousedown',e=>e.preventDefault());
    btn.addEventListener('click',()=>selectPromoBgdProduct(which,Number(btn.dataset.pid)));
  });
}
function selectPromoBgdProduct(which,productId){
  const cfg=PROMO_BGD_FIELD_CONFIG[which]; if(!cfg) return;
  const p=products.find(x=>x.id===productId); if(!p) return;
  const hidden=document.getElementById(cfg.hiddenId);
  const searchInput=document.getElementById(cfg.searchId);
  const box=document.getElementById(cfg.resultsId);
  if(hidden) hidden.value=p.id;
  if(searchInput) searchInput.value=p.name;
  if(box){ box.innerHTML=''; box.hidden=true; }
  updatePromoBgdUnitOptions(which);
  const fieldWrap=document.getElementById(cfg.wrapId);
  if(fieldWrap){
    let hint=fieldWrap.querySelector('.promo-selected-hint');
    if(!hint){ hint=document.createElement('div'); hint.className='promo-selected-hint'; hint.style.cssText='font-size:12px;color:var(--text-muted);margin-top:6px;'; fieldWrap.appendChild(hint); }
    hint.innerHTML=`เลือกแล้ว: <b style="color:var(--text);">${escapeHtml(p.name)}</b> (${escapeHtml(p.sku||'-')})`;
  }
}
function bindPromoBgdProductSearch(which){
  const cfg=PROMO_BGD_FIELD_CONFIG[which]; if(!cfg) return;
  const input=document.getElementById(cfg.searchId);
  const box=document.getElementById(cfg.resultsId);
  if(!input||!box) return;
  input.addEventListener('input',()=>{
    const hidden=document.getElementById(cfg.hiddenId);
    if(hidden) hidden.value='';
    renderPromoBgdProductResults(which,input.value);
  });
  input.addEventListener('focus',()=>{ if(input.value.trim()) renderPromoBgdProductResults(which,input.value); });
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){ box.hidden=true; return; }
    if(e.key!=='Enter') return;
    e.preventDefault();
    const query=input.value.trim(); if(!query) return;
    const exact=activeProducts().find(p=>(p.barcode||'').toLowerCase()===query.toLowerCase()||(p.sku||'').toLowerCase()===query.toLowerCase());
    if(exact){ selectPromoBgdProduct(which,exact.id); return; }
    const needle=query.toLowerCase();
    const first=activeProducts().find(p=>(p.name||'').toLowerCase().includes(needle));
    if(first) selectPromoBgdProduct(which,first.id);
  });
  input.addEventListener('blur',()=>setTimeout(()=>{ box.hidden=true; },140));
}
function updatePromoBgdUnitOptions(which){
  const cfg=PROMO_BGD_FIELD_CONFIG[which]; if(!cfg) return;
  const unitSelect=document.getElementById(cfg.unitSelectId); if(!unitSelect) return;
  const productId=Number(document.getElementById(cfg.hiddenId)?.value);
  const p=products.find(x=>x.id===productId);
  if(!p){ unitSelect.innerHTML='<option value="">เลือกสินค้าก่อน</option>'; return; }
  const opts=[p.unit,...(p.units||[]).map(u=>u.sub)];
  unitSelect.innerHTML=opts.map(u=>{
    const usedBy=findPromotionUsingSlot(productId,u,editingPromotionId);
    return usedBy?`<option value="${escapeHtml(u)}" disabled>${escapeHtml(u)} (ใช้ในโปรฯ "${escapeHtml(usedBy.name)}" แล้ว)</option>`:`<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`;
  }).join('');
  if(unitSelect.options.length && unitSelect.options[unitSelect.selectedIndex]?.disabled){
    const firstEnabled=Array.from(unitSelect.options).find(o=>!o.disabled);
    if(firstEnabled) unitSelect.value=firstEnabled.value;
  }
}
// อัปเดตตัวเลือกหน่วยในช่อง "สินค้ารายตัว" ตามสินค้าที่เลือกไว้ - หน่วยที่ถูกใช้ในโปรฯ อื่นแล้วจะถูก disable
function updatePromoUnitOptions(){
  const unitSelect=document.getElementById('promo_unit'); if(!unitSelect) return;
  const productId=Number(document.getElementById('promo_product_id')?.value);
  const p=products.find(x=>x.id===productId);
  if(!p){ unitSelect.innerHTML='<option value="">เลือกสินค้าก่อน</option>'; return; }
  const opts=[p.unit,...(p.units||[]).map(u=>u.sub)];
  unitSelect.innerHTML=opts.map(u=>{
    const usedBy=findPromotionUsingSlot(productId,u,editingPromotionId);
    return usedBy?`<option value="${escapeHtml(u)}" disabled>${escapeHtml(u)} (ใช้ในโปรฯ "${escapeHtml(usedBy.name)}" แล้ว)</option>`:`<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`;
  }).join('');
  // ถ้าตัวเลือกแรกโดน disable ให้เลื่อนไปเลือกตัวแรกที่ยังว่างอยู่แทน (กันเลือก option disabled โดยไม่ตั้งใจ)
  if(unitSelect.options.length && unitSelect.options[unitSelect.selectedIndex]?.disabled){
    const firstEnabled=Array.from(unitSelect.options).find(o=>!o.disabled);
    if(firstEnabled) unitSelect.value=firstEnabled.value;
  }
}
// สลับว่าจะโชว์ช่องหน่วยแบบไหน: สินค้ารายตัว (unit เดียว) / เจาะจงสินค้า (หน่วยแยกต่อรายการ ไม่โชว์ช่องนี้)
function updatePromoUnitFieldVisibility(){
  const scopeEl=document.querySelector('input[name="promo_scope"]:checked');
  const scope=scopeEl?scopeEl.value:'product';
  const productUnitWrap=document.getElementById('promo_scope_product_unit');
  if(productUnitWrap) productUnitWrap.style.display=(scope==='product')?'block':'none';
  if(scope==='product') updatePromoUnitOptions();
}
// ดึงสินค้าตามหมวดหมู่/แบรนด์ที่เลือกไว้ สำหรับ modal เลือกสินค้า
function promoCategoryItemPool(){
  const category=document.getElementById('promo_category')?.value||'';
  const brand=document.getElementById('promo_brand')?.value||'';
  return activeProducts().filter(p=>{
    const productCategory=String(p.category||'').trim()||'ไม่ทราบหมวดหมู่';
    if(category && productCategory!==category) return false;
    if(brand && (p.brand||'ทั่วไป')!==brand) return false;
    return true;
  });
}
// เปิด modal เลือกสินค้าแบบติ๊กหลายตัว (checkbox) จากหมวดหมู่/แบรนด์ที่เลือกไว้
function openPromoItemPicker(){
  const category=document.getElementById('promo_category')?.value||'';
  if(!category){ showToast('กรุณาเลือกหมวดหมู่ก่อน'); return; }
  const brand=document.getElementById('promo_brand')?.value||'';
  const pool=promoCategoryItemPool();
  const alreadySelected=new Set((currentPromoDraftItems||[]).map(it=>it.productId));
  const checkedIds=new Set(alreadySelected);
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal promo-item-picker-modal">
    <div class="modal-head"><h3>เลือกสินค้าในหมวดนี้</h3><button class="modal-close" aria-label="ปิด">×</button></div>
    <div class="promo-picker-sub">${escapeHtml(category)}${brand?` › ${escapeHtml(brand)}`:''} · พบ ${pool.length} รายการ</div>
    <div class="promo-picker-toolbar"><button type="button" class="btn ghost small" id="promoPickAllBtn">เลือกทั้งหมด</button><button type="button" class="btn ghost small" id="promoPickNoneBtn">ไม่เลือกเลย</button></div>
    <div class="promo-picker-list" id="promoPickerList">${pool.map(p=>`<label class="promo-picker-row"><input type="checkbox" data-pid="${p.id}" ${checkedIds.has(p.id)?'checked':''}><span>${escapeHtml(p.name)}</span></label>`).join('')||'<div class="promo-picker-empty">ไม่พบสินค้าในหมวด/แบรนด์นี้</div>'}</div>
    <div class="promo-picker-actions"><button type="button" class="btn ghost" id="promoPickerCancelBtn">ยกเลิก</button><button type="button" class="btn primary" id="promoPickerAddBtn">เพิ่มที่เลือก</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#promoPickerCancelBtn').onclick=close;
  overlay.querySelector('#promoPickAllBtn').onclick=()=>overlay.querySelectorAll('.promo-picker-row input[type="checkbox"]').forEach(cb=>cb.checked=true);
  overlay.querySelector('#promoPickNoneBtn').onclick=()=>overlay.querySelectorAll('.promo-picker-row input[type="checkbox"]').forEach(cb=>cb.checked=false);
  overlay.querySelector('#promoPickerAddBtn').onclick=()=>{
    const checked=Array.from(overlay.querySelectorAll('.promo-picker-row input[type="checkbox"]:checked')).map(cb=>Number(cb.dataset.pid));
    if(!currentPromoDraftItems) currentPromoDraftItems=[];
    checked.forEach(pid=>{
      if(currentPromoDraftItems.some(it=>it.productId===pid)) return;
      const p=products.find(x=>x.id===pid); if(!p) return;
      const unitOpts=[p.unit,...(p.units||[]).map(u=>u.sub)];
      const freeUnit=unitOpts.find(u=>!findPromotionUsingSlot(pid,u,editingPromotionId));
      currentPromoDraftItems.push({productId:pid,unit:freeUnit||p.unit});
    });
    // เอาตัวที่ถูกยกเลิกติ๊กออกจากรายการที่เลือกไว้เดิมด้วย (เฉพาะที่อยู่ในหมวด/แบรนด์นี้)
    const poolIds=new Set(pool.map(p=>p.id));
    const stillChecked=new Set(checked);
    currentPromoDraftItems=currentPromoDraftItems.filter(it=>!poolIds.has(it.productId)||stillChecked.has(it.productId));
    const listWrap=document.getElementById('promoCategoryItemsList');
    if(listWrap){ listWrap.innerHTML=renderPromoCategoryItemsList(currentPromoDraftItems); bindPromoCategoryItemListEvents(); }
    close();
  };
}
function bindPromoCategoryItemListEvents(){
  document.querySelectorAll('.promo-item-unit').forEach(sel=>{
    sel.addEventListener('change',()=>{
      const idx=Number(sel.dataset.idx);
      if(currentPromoDraftItems&&currentPromoDraftItems[idx]) currentPromoDraftItems[idx].unit=sel.value;
    });
  });
  document.querySelectorAll('.promo-item-remove').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const idx=Number(btn.dataset.idx);
      if(!currentPromoDraftItems) return;
      currentPromoDraftItems.splice(idx,1);
      const listWrap=document.getElementById('promoCategoryItemsList');
      if(listWrap){ listWrap.innerHTML=renderPromoCategoryItemsList(currentPromoDraftItems); bindPromoCategoryItemListEvents(); }
    });
  });
}
function savePromotion(){
  const g=id=>document.getElementById(id);
  const name=(g('promo_name')?.value||'').trim();
  if(!name){ showToast('กรุณากรอกชื่อโปรโมชั่น'); g('promo_name')?.focus(); return; }
  const active=document.querySelector('input[name="promo_active"]:checked')?.value==='1';
  const startDate=dmyToISO(g('promo_start')?.value)||'';
  const endDate=dmyToISO(g('promo_end')?.value)||'';
  if(startDate && endDate && startDate>endDate){ showToast('วันเริ่มต้องมาก่อนวันสิ้นสุด'); return; }
  const type=document.querySelector('input[name="promo_type"]:checked')?.value||'discount';
  let scope='product', productId=null, category='', brand='', categoryMode='all', unit='', items=[];
  let bgdBuyProductId=null, bgdBuyUnit='', bgdBuyQty=0, bgdGetProductId=null, bgdGetUnit='', bgdGetQty=0;
  if(type==='buygetdiff'){
    scope='buygetdiff';
    bgdBuyProductId=Number(g('promo_bgd_buy_product_id')?.value)||null;
    if(!bgdBuyProductId){ showToast('กรุณาเลือกสินค้าที่ต้องซื้อ'); g('promo_bgd_buy_product_search')?.focus(); return; }
    bgdBuyUnit=(g('promo_bgd_buy_unit')?.value||'').trim();
    if(!bgdBuyUnit){ showToast('กรุณาเลือกหน่วยสินค้าที่ต้องซื้อ'); return; }
    bgdBuyQty=parseInt(g('promo_bgd_buy_qty')?.value)||0;
    if(bgdBuyQty<=0){ showToast('กรุณากรอกจำนวนที่ต้องซื้อให้ถูกต้อง'); return; }
    bgdGetProductId=Number(g('promo_bgd_get_product_id')?.value)||null;
    if(!bgdGetProductId){ showToast('กรุณาเลือกสินค้าที่จะแถม'); g('promo_bgd_get_product_search')?.focus(); return; }
    bgdGetUnit=(g('promo_bgd_get_unit')?.value||'').trim();
    if(!bgdGetUnit){ showToast('กรุณาเลือกหน่วยสินค้าที่จะแถม'); return; }
    bgdGetQty=parseInt(g('promo_bgd_get_qty')?.value)||0;
    if(bgdGetQty<=0){ showToast('กรุณากรอกจำนวนที่จะแถมให้ถูกต้อง'); return; }
  } else {
    scope=document.querySelector('input[name="promo_scope"]:checked')?.value||'product';
    if(scope==='product'){
      productId=Number(g('promo_product_id')?.value)||null;
      if(!productId){ showToast('กรุณาเลือกสินค้าจากผลการค้นหา'); g('promo_product_search')?.focus(); return; }
      unit=(g('promo_unit')?.value||'').trim();
      if(!unit){ showToast('กรุณาเลือกหน่วยที่ร่วมโปรโมชั่น'); return; }
    } else {
      category=(g('promo_category')?.value||'').trim();
      if(!category){ showToast('กรุณาเลือกหมวดหมู่'); return; }
      brand=(g('promo_brand')?.value||'').trim();
      categoryMode='select';
      items=(currentPromoDraftItems||[]).map(it=>({productId:it.productId,unit:it.unit}));
      if(items.length===0){ showToast('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ'); return; }
    }
  }
  // ป้องกันสินค้า+หน่วยซ้ำกับโปรฯ อื่นที่เปิดใช้งานอยู่ (เช็คเฉพาะตอนโปรฯ นี้เปิดใช้งานด้วย เพราะโปรฯ ที่ปิดอยู่ไม่มีผลจริง)
  if(active){
    const slotsToCheck=type==='buygetdiff'?[{productId:bgdBuyProductId,unit:bgdBuyUnit},{productId:bgdGetProductId,unit:bgdGetUnit}]:(scope==='product'?[{productId,unit}]:items);
    for(const slot of slotsToCheck){
      const usedBy=findPromotionUsingSlot(slot.productId,slot.unit,editingPromotionId);
      if(usedBy){
        const p=products.find(x=>x.id===slot.productId);
        showToast(`${p?p.name:'สินค้า'} หน่วย ${slot.unit} ถูกใช้ในโปรโมชั่น "${usedBy.name}" อยู่แล้ว`);
        return;
      }
    }
  }
  const data={name,active,startDate,endDate,scope,productId,category,brand,categoryMode,items,unit,type,
    discountMode:'percent',discountValue:'',bundleQty:'',bundlePrice:'',
    bgdBuyProductId,bgdBuyUnit,bgdBuyQty,bgdGetProductId,bgdGetUnit,bgdGetQty};
  if(type==='discount'){
    data.discountMode=document.querySelector('input[name="promo_discount_mode"]:checked')?.value||'percent';
    data.discountValue=parseFloat(g('promo_discount_value')?.value)||0;
    if(data.discountValue<=0){ showToast('กรุณากรอกมูลค่าส่วนลดให้ถูกต้อง'); return; }
    if(data.discountMode==='percent' && data.discountValue>100){ showToast('ส่วนลดเป็น % ต้องไม่เกิน 100'); return; }
  } else if(type==='bundle'){
    data.bundleQty=parseInt(g('promo_bundle_qty')?.value)||0;
    data.bundlePrice=parseFloat(g('promo_bundle_price')?.value)||0;
    if(data.bundleQty<=1){ showToast('จำนวนที่ซื้อครบต้องมากกว่า 1 ชิ้น'); return; }
    if(data.bundlePrice<=0){ showToast('กรุณากรอกราคาพิเศษให้ถูกต้อง'); return; }
  }
  if(editingPromotionId==='new'){
    promotions.push({id:generateClientRecordId(promotions),...data});
    showToast(`สร้างโปรโมชั่น "${name}" แล้ว`);
  } else {
    Object.assign(promotions.find(x=>x.id===editingPromotionId),data);
    showToast(`บันทึกโปรโมชั่น "${name}" แล้ว`);
  }
  persistPromotions();
  editingPromotionId=null;
  promoDraftItemsSyncedFor=undefined;
  currentPromoDraftItems=null;
  render();
}
function deletePromotion(id){
  const promo=promotions.find(x=>x.id===id); if(!promo) return;
  if(!confirm(`ยืนยันลบโปรโมชั่น "${promo.name}" ?`)) return;
  promotions=promotions.filter(x=>x.id!==id);
  persistPromotions();
  showToast(`ลบโปรโมชั่น "${promo.name}" แล้ว`);
  render();
}
