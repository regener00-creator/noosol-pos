function storeResetConfig(mode=storeResetMode){
  if(mode==='products'){
    const shop=activeWarehouse()?.name||'';
    return {title:'ล้างสินค้า · '+shop,phrase:'ล้างสินค้า '+shop,button:'ยืนยันล้างสินค้า',
      description:`ลบสินค้า ${products.length.toLocaleString('th-TH')} รายการของร้าน ${shop} รวมถึงประวัติเปลี่ยนหน่วยหลัก สินค้าโปรด และรายการสินค้าที่ผู้แทนดูแล`,
      impact:'สินค้าในใบตรวจที่ยังไม่ยืนยันจะถูกนำออกจากใบตรวจ ระบบจะหยุดหากสินค้ามีสต๊อก LOT หรือยังผูกกับบิล เอกสารที่บันทึกไว้ โปรโมชั่น หรือราคาพิเศษลูกค้า'};
  }
  if(mode==='factory') return {
    title:'คืนค่าโรงงาน',phrase:'คืนค่าโรงงาน',button:'ยืนยันคืนค่าโรงงาน',
    description:'ล้างข้อมูลร้าน สินค้า เอกสาร สต๊อก LOT การตั้งค่า และบัญชีผู้ใช้งานทั้งหมด',
    impact:'เมื่อเสร็จแล้วโปรแกรมจะออกจากระบบ และกลับไปหน้าสร้าง ID เจ้าของร้านคนแรกใหม่'
  };
  return {
    title:'ล้างเอกสารและสต๊อก · '+(activeWarehouse()?.name||''),phrase:'ล้างเอกสารและสต๊อก',button:'ยืนยันล้างเอกสารและสต๊อก',
    description:'ล้างบิล เอกสาร ประวัติการเคลื่อนไหว LOT และยอดคงเหลือทั้งหมด',
    impact:'ยอดคงเหลือในร้านที่เลือกจะเป็นศูนย์ ข้อมูลของร้านอื่นจะคงเดิม'
  };
}

function renderFactoryReset(){
  return `<div class="factory-reset-page">
    <section class="factory-reset-panel" aria-labelledby="factoryResetHeading">
      <h2 id="factoryResetHeading">คืนค่าโรงงานทั้งระบบ</h2>
      <p id="factoryResetImpact">ลบข้อมูลทุกคลังและบัญชีผู้ใช้ทั้งหมด</p>
      <button type="button" class="btn factory-reset-button" id="openFactoryResetBtn" aria-describedby="factoryResetImpact"><span aria-hidden="true">⚠︎</span> คืนค่าโรงงานทั้งระบบ</button>
    </section>
  </div>${renderStoreResetDialog()}`;
}

function renderStoreMaintenanceSection(){
  if(!loggedInUser()?.owner||isAllWarehousesMode())return '';
  const name=escapeHtml(activeWarehouse()?.name||'');
  return `<div class="settings-section"><h2>ล้างเอกสารและสต๊อก · ${name}</h2><p>ล้างเฉพาะเอกสาร LOT และยอดคงเหลือของร้าน ${name} โดยเก็บสินค้าและรายชื่อผู้ติดต่อไว้</p><button class="btn reset-keep-products" id="openDocumentResetBtn">ล้างเอกสารและสต๊อก</button></div>
    <div class="settings-section"><h2>ล้างสินค้า · ${name}</h2><p>เริ่มรายการสินค้าใหม่ในร้าน ${name} แล้วนำเข้า Excel ได้ที่หน้า PRODUCT</p><button class="btn danger" id="openProductResetBtn" ${products.length?'':'disabled'}>ล้างสินค้าเฉพาะร้านนี้</button></div>`;
}

function renderStoreResetDialog(){
  if(!storeResetMode) return '';
  const config=storeResetConfig();
  return `<div class="store-reset-overlay" role="dialog" aria-modal="true" aria-labelledby="storeResetTitle">
    <form class="store-reset-dialog" id="storeResetForm" data-store="${Number(activeWarehouseId)}" data-product-count="${products.length}">
      <h2 id="storeResetTitle">${escapeHtml(config.title)}</h2>
      <p>${escapeHtml(config.description)}</p>
      <div class="store-reset-impact"><strong>ผลที่จะเกิดขึ้น:</strong><br>${escapeHtml(config.impact)}</div>
      <label class="store-reset-field">รหัสผ่านเจ้าของร้าน<input id="storeResetPassword" type="password" autocomplete="current-password" required></label>
      <label class="store-reset-field">พิมพ์คำว่า “${escapeHtml(config.phrase)}” เพื่อยืนยัน<input id="storeResetPhrase" type="text" autocomplete="off" required></label>
      <label class="store-reset-confirm"><input id="storeResetBackupConfirmed" type="checkbox" required><span>${storeResetMode==='factory'?'ฉันสำรองข้อมูลแยกครบทุกคลังแล้ว และเข้าใจว่าการคืนค่าโรงงานจะลบข้อมูลทุกคลังและบัญชีผู้ใช้ทั้งหมด':'ฉันสำรองข้อมูลของร้านที่เลือกแล้ว และเข้าใจว่าข้อมูลที่ล้างต้องใช้ไฟล์สำรองของร้านนี้เพื่อกู้คืน'}</span></label>
      <div class="store-reset-actions"><button class="btn ghost" id="cancelStoreResetBtn" type="button">ยกเลิก</button><button class="btn reset-danger" id="confirmStoreResetBtn" type="submit">${escapeHtml(config.button)}</button></div>
    </form>
  </div>`;
}
// ย้ายปุ่มหลักของหน้าปัจจุบันขึ้น TOPBAR ด้านขวา ทั้งปุ่มท้ายฟอร์ม ปุ่มสร้าง/เพิ่ม และปุ่มพิมพ์รายงาน
// ย้าย DOM element ตัวจริงหลัง attachEvents() (ไม่สร้างซ้ำ) เพื่อให้ listener และ id เดิมทำงานต่อได้ถูกต้อง
function syncTopbarFormActions(){
  const slot=document.getElementById('topbarFormActions');
  if(!slot) return;
  const main=document.getElementById('main');
  if(!main) return;
  renderSyncStatusChip();
  const syncChip=document.getElementById('syncStatusChip');
  if(syncChip) syncChip.onclick=()=>openSyncDetailsModal();
  const moveToTopbar=node=>{ if(node&&node!==slot&&!slot.contains(node)) slot.appendChild(node); };
  [...main.querySelectorAll('.form-final-actions')].forEach(moveToTopbar);
  [...main.querySelectorAll('.pagehead')].forEach(pagehead=>{
    [...pagehead.children].slice(1).filter(node=>node.matches?.('button')||node.querySelector?.('button')).forEach(moveToTopbar);
  });
  [...main.querySelectorAll('.rpt-head-actions')].forEach(moveToTopbar);
  [...main.querySelectorAll('button.btn')].filter(button=>button.textContent.trim()==='พิมพ์รายงาน').forEach(moveToTopbar);
  const freshCashShiftActions=[...main.querySelectorAll('.cash-shift-topbar-action')];
  if(freshCashShiftActions.length){
    [...slot.querySelectorAll('.cash-shift-topbar-action')].forEach(node=>node.remove());
    freshCashShiftActions.slice(1).forEach(node=>node.remove());
    moveToTopbar(freshCashShiftActions[0]);
  }else{
    [...slot.querySelectorAll('.cash-shift-topbar-action')].slice(1).forEach(node=>node.remove());
  }
}

function checkNegativeStockToast(pid){
  const p = products.find(x=>x.id===pid); if(!p) return;
  const totalInCart = cart.filter(l=>l.pid===pid).reduce((a,l)=>a+((l.qty||0)*(l.factor||1)),0);
  if(totalInCart > p.stock) showToast('สินค้าติดลบ', 'danger-top');
}
function attachMobilePriceResultEvents(){
  const markQuickEditDirty=()=>{
    const button=document.getElementById('mobilePriceSaveChanges');
    if(button){ button.hidden=false; button.disabled=!mobileIsOnline(); }
  };
  document.getElementById('mobileEditProduct')?.addEventListener('click',()=>openMobileProductEditor(mobilePriceProductId));
  document.getElementById('mobileCreateProductFromCode')?.addEventListener('click',()=>openMobileProductEditor('new',mobilePriceQuery));
  document.querySelectorAll('[data-mobile-price-product]').forEach(button=>button.addEventListener('click',()=>{
    const product=products.find(entry=>Number(entry.id)===Number(button.dataset.mobilePriceProduct));
    if(product){ mobileSelectPriceProduct(product,button.dataset.unit); render(); if(!mobileCameraSession) setTimeout(()=>document.getElementById('mobilePriceInput')?.select(),0); }
  }));
  document.getElementById('mobilePriceUnit')?.addEventListener('change',event=>{
    mobilePriceUnitName=event.target.value;
    const product=products.find(entry=>Number(entry.id)===Number(mobilePriceProductId));
    if(!product) return;
    const selected=inspectionListUnitOptions(product).find(option=>option.name===mobilePriceUnitName);
    if(!selected) return;
    const selectedStock=stockUnitAmountFromBase(warehouseStock(product.id,activeWarehouseId),selected.factor||1);
    const stockElement=document.getElementById('mobilePriceStock');
    const saleElement=document.getElementById('mobilePriceSale');
    const costElement=document.getElementById('mobilePriceCost');
    const editSale=document.getElementById('mobilePriceEditSale');
    const editCost=document.getElementById('mobilePriceEditCost');
    if(stockElement) stockElement.textContent=`${inspectionListAmount(selectedStock)} ${selected.name||product.unit}`;
    if(saleElement) saleElement.textContent=`${fmtMoney(selected.price||0)} บาท`;
    if(costElement) costElement.textContent=`${fmtMoney(selected.cost||0)} บาท`;
    if(editSale) editSale.value=Number(selected.price)||0;
    if(editCost) editCost.value=Number(selected.cost)||0;
  });
  document.getElementById('mobilePriceLot')?.addEventListener('change',event=>{
    mobilePriceLotId=Number(event.target.value)||null;
    const product=products.find(entry=>Number(entry.id)===Number(mobilePriceProductId));
    const lot=mobileEditableLots(product?.id,activeWarehouseId).find(entry=>Number(entry.id)===Number(mobilePriceLotId));
    const expiryInput=document.getElementById('mobilePriceEditExpiry');
    const hint=document.getElementById('mobilePriceLotHint');
    if(expiryInput){
      expiryInput.disabled=!lot;
      expiryInput.value=isoToDMY(lot?.expiry_date);
    }
    if(hint) hint.textContent=lot
      ? 'วันหมดอายุจะเปลี่ยนเฉพาะ Lot ที่เลือก และระบบจะเก็บประวัติการแก้ไข'
      : 'สินค้านี้มีหลาย Lot กรุณาเลือก Lot ที่ต้องการแก้วันหมดอายุ';
  });
  document.getElementById('mobilePriceSaveChanges')?.addEventListener('click',saveMobilePriceChanges);
  ['mobilePriceEditSale','mobilePriceEditCost','mobilePriceEditExpiry'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input',markQuickEditDirty);
  });
  document.querySelectorAll('[data-mobile-review-status]').forEach(button=>{
    button.addEventListener('click',async()=>{
      if(!canEditMobilePrice()||button.disabled) return;
      const options=[...document.querySelectorAll('[data-mobile-review-status]')];
      const previous=options.find(option=>option.getAttribute('aria-pressed')==='true');
      if(previous===button) return;
      options.forEach(option=>{
        option.setAttribute('aria-pressed',String(option===button));
      });
      const card=button.closest('.mobile-result-card');
      if(card) card.dataset.reviewStatus=button.dataset.mobileReviewStatus;
      const status=document.getElementById('mobilePriceEditStatus');
      if(status) status.textContent='กำลังบันทึกสี...';
      const saved=await saveMobilePriceChanges();
      if(!saved&&button.isConnected){
        options.forEach(option=>option.setAttribute('aria-pressed',String(option===previous)));
        if(card?.isConnected) card.dataset.reviewStatus=previous?.dataset.mobileReviewStatus||'normal';
      }
    });
  });
}
