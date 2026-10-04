// ---------- โหมดมือถือ / เครื่องยิงบาร์โค้ดแบบมีจอ ----------
function isMobileDeviceMode(){ return window.matchMedia('(max-width: 960px)').matches; }
function isStandalonePwa(){ return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true; }
function isAppleMobileBrowser(){
  const agent=String(navigator.userAgent||'');
  return /iPad|iPhone|iPod/i.test(agent)||(navigator.platform==='MacIntel'&&Number(navigator.maxTouchPoints)>1);
}
function mobileInstallNoticeHtml(){
  if(isStandalonePwa()) return '';
  const apple=isAppleMobileBrowser();
  return `<div class="mobile-install-notice"><div class="mobile-install-notice-text"><b>เปิดแบบแอป เพื่อตัดแถบเบราว์เซอร์สีดำ</b><span>${apple?'บน iPhone/iPad ให้เปิดด้วย Safari แล้วเพิ่มไปยังหน้าจอโฮม':'ติดตั้งผ่าน Chrome แล้วกล้องและ PWA จะทำงานได้ครบ'}</span></div><button type="button" class="mobile-install-btn" id="mobileInstallApp">${deferredPwaInstallPrompt?'ติดตั้งแอป':apple?'ดูวิธีติดตั้ง':'เปิดใน Chrome'}</button></div>`;
}
function openMobileBrowserHelp(options={}){
  document.querySelector('.mobile-browser-help')?.remove();
  const android=/Android/i.test(navigator.userAgent||'');
  const apple=isAppleMobileBrowser();
  const cameraTitle=apple?'อนุญาตกล้องบน iPad':'กล้องถูกบล็อกโดยเบราว์เซอร์นี้';
  const installText=apple?'บน iPad ต้องติดตั้งจาก Safari เพื่อให้ PWA และสิทธิ์กล้องทำงานถูกต้อง':'ต้องเปิดหน้านี้ด้วย Chrome ก่อน จึงจะติดตั้ง PWA และเอาแถบเบราว์เซอร์บน–ล่างออกได้';
  const cameraText=apple?'PWA รองรับกล้องแล้ว กดเปิดกล้องอีกครั้งและเลือก “อนุญาต” เมื่อ iPad ถามสิทธิ์':'เบราว์เซอร์ภายในแอปมักไม่ส่งสิทธิ์กล้องให้เว็บไซต์';
  const steps=apple
    ?'<li>เปิดเว็บไซต์นี้ใน Safari โดยตรง</li><li>กดปุ่มกล้อง แล้วเลือก “อนุญาต” เมื่อ iPad ถาม</li><li>เมื่อต้องการติดตั้ง ให้กดปุ่มแชร์ใน Safari แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”</li>'
    :'<li>กด “เปิดใน Chrome” ด้านล่าง</li><li>ถ้ากล้องเคยถูกปฏิเสธ ให้กดรูปกุญแจข้างที่อยู่ แล้วอนุญาต Camera</li><li>ใน Chrome กดเมนู ⋮ แล้วเลือก “ติดตั้งแอป” หรือ “เพิ่มไปยังหน้าจอหลัก”</li>';
  const overlay=document.createElement('div');
  overlay.className='mobile-browser-help';
  overlay.innerHTML=`<div class="mobile-browser-help-card"><h3>${options.cameraBlocked?cameraTitle:'ติดตั้ง PEPOS'}</h3><p>${options.cameraBlocked?cameraText:installText}</p><ol class="mobile-browser-help-steps">${steps}</ol><div class="mobile-browser-help-actions"><button type="button" class="mobile-browser-help-close">ปิด</button><button type="button" class="mobile-open-chrome">${android?'เปิดใน Chrome':apple?'เปิดใน Safari':'เปิดในเบราว์เซอร์หลัก'}</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.mobile-browser-help-close').addEventListener('click',()=>overlay.remove());
  overlay.querySelector('.mobile-open-chrome').addEventListener('click',()=>{
    if(android){
      const target=`${location.host}${location.pathname}${location.search}${location.hash}`;
      location.href=`intent://${target}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
    }else window.open(location.href,'_blank','noopener');
  });
}
async function requestMobilePwaInstall(){
  if(!deferredPwaInstallPrompt){ openMobileBrowserHelp(); return false; }
  deferredPwaInstallPrompt.prompt();
  const choice=await deferredPwaInstallPrompt.userChoice;
  deferredPwaInstallPrompt=null;
  if(choice?.outcome==='accepted') showToast('กำลังติดตั้ง PEPOS');
  render();
  return choice?.outcome==='accepted';
}
function mobileProductMatches(product,query){
  if(product?.active===false) return false;
  const q=String(query||'').trim().toLowerCase();
  if(!q) return false;
  return String(product?.name||'').toLowerCase().includes(q)||String(product?.sku||'').toLowerCase().includes(q)||matchesBarcode(product,String(query||'').trim());
}
function mobilePriceMatches(query){
  const q=String(query||'').trim();
  if(!q) return [];
  const exact=findProductByExactCode(q);
  const matches=products.filter(product=>mobileProductMatches(product,q));
  if(exact){
    const rest=matches.filter(product=>Number(product.id)!==Number(exact.product.id));
    return [exact.product,...rest].slice(0,8);
  }
  return matches.slice(0,8);
}
function mobileIsOnline(){ return typeof navigator==='undefined'||navigator.onLine!==false; }
function mobileStatusTime(value=Date.now()){
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}
function mobileDataStatusDetails(){
  const warehouseName=activeWarehouse()?.name||'ยังไม่ได้เลือกคลัง';
  if(!mobileIsOnline()||mobileDataStatusState==='offline') return {state:'offline',text:`ออฟไลน์ · คลัง: ${warehouseName}`};
  if(mobileDataStatusState==='syncing') return {state:'syncing',text:`กำลังรีเฟรช · คลัง: ${warehouseName}`};
  if(mobileDataStatusState==='saving') return {state:'saving',text:`กำลังบันทึก · คลัง: ${warehouseName}`};
  if(mobileDataStatusState==='error') return {state:'error',text:`${mobileDataStatusMessage||'บันทึกไม่สำเร็จ'} · คลัง: ${warehouseName}`};
  const latest=mobileLastRefreshAt?` · ล่าสุด ${mobileStatusTime(mobileLastRefreshAt)}`:'';
  return {state:'online',text:`${mobileDataStatusMessage||'ออนไลน์'}${latest} · คลัง: ${warehouseName}`};
}
function setMobileDataStatus(state,message=''){
  mobileDataStatusState=state;
  mobileDataStatusMessage=message;
  const details=mobileDataStatusDetails();
  const element=document.getElementById('mobileDataStatus');
  if(element){ element.dataset.state=details.state; element.textContent=details.text; }
  return details;
}
function mobileRequireOnline(action='บันทึกข้อมูล'){
  if(mobileIsOnline()) return true;
  setMobileDataStatus('offline');
  showToast(`${action}ไม่ได้ขณะออฟไลน์ กรุณาต่ออินเทอร์เน็ตแล้วลองใหม่`,'danger-top');
  return false;
}
function mobileEditableLots(productId,warehouseId=activeWarehouseId){
  return activeInventoryLotsForProduct(productId,warehouseId).slice().sort((a,b)=>{
    const expiryCompare=String(a.expiry_date||'9999-12-31').localeCompare(String(b.expiry_date||'9999-12-31'));
    if(expiryCompare) return expiryCompare;
    return String(a.received_at||'').localeCompare(String(b.received_at||''))||Number(a.id)-Number(b.id);
  });
}
function mobileSelectPriceProduct(product,unitName=''){
  if(!product) return false;
  const options=inspectionListUnitOptions(product);
  const selected=options.find(option=>option.name===unitName)||options[0];
  mobilePriceProductId=product.id;
  mobilePriceUnitName=selected?.name||product.unit;
  mobilePriceLotId=null;
  mobilePriceQuery=selected?.barcode||product.barcode||product.sku||product.name;
  return true;
}
function canEditMobilePrice(user=loggedInUser()){
  return user?.owner===true&&Number(user?.level)===1;
}
function mobileProductEditSignature(product){
  // Compare catalog values, not JSON key order or stock-only revisions.
  // The sync write still checks the latest acknowledged server revision.
  return canonicalProductInsertSignature(productMetadataToRow(product));
}
function captureMobileProductDraft(){
  const editor=mobileProductEditor,form=document.getElementById('mobileProductEditor');
  if(!editor||!form||form.dataset.editorToken!==editor.token) return;
  for(const key of ['name','sku','category','brand','unit','barcode','price','cost','desc','vat']){
    const field=form.querySelector('#f_'+key);
    if(field) editor.draft[key]=field.value;
  }
  editor.draft.active=!!form.querySelector('#f_active')?.checked;
  editor.draft.multiunit=!!form.querySelector('#f_multiunit')?.checked;
  // Keep incomplete unit rows too, so a reconnect/re-render cannot discard typing.
  editor.draft.units=collectUnitRowsFromDOM({preserveInput:true});
}
async function openMobileProductEditor(productId='new',barcode=''){
  if(!canEditMobilePrice()||mobileProductOpening||mobileProductEditor) return;
  if(!mobileRequireOnline('เพิ่มหรือแก้ไขสินค้า')) return;
  mobileProductOpening=true;
  closeMobileCameraScanner();
  try{
    if(mobileRefreshPromise) await mobileRefreshPromise;
    await ensurePageCodeLoaded('products');
    let product=null;
    if(productId!=='new'){
      if(productDirtyOperations.has(String(productId))) throw new Error('สินค้านี้มีข้อมูลรอซิงก์ กรุณาซิงก์ให้สำเร็จก่อนแก้ไขต่อ');
      const {data,error}=await sb.from('products').select('*').eq('id',Number(productId)).maybeSingle();
      if(error) throw error;
      if(!data) throw new Error('ไม่พบสินค้านี้บนเซิร์ฟเวอร์ กรุณารีเฟรชข้อมูล');
      if(productDirtyOperations.has(String(productId))) throw new Error('สินค้านี้มีข้อมูลรอซิงก์ กรุณาซิงก์ให้สำเร็จก่อนแก้ไขต่อ');
      const local=products.find(item=>Number(item.id)===Number(productId));
      product={...rowToProduct(data),stock:Number(local?.stock)||0,expiry:local?.expiry||''};
      // This is a clean record (dirty entries are refused above). Replace it
      // so fields removed remotely cannot survive in the old cached object.
      if(local) products[products.indexOf(local)]=product; else products.push(product);
      (syncedTableRows.products||=new Map()).set(String(product.id),JSON.stringify(productMetadataToRow(product)));
      rebuildProductLookupMaps();
      await persistProductChangesToIndexedDB({updatedIds:[product.id]});
    }
    if(!canEditMobilePrice()||currentTab!=='mobiletools') return;
    const draft=product?JSON.parse(JSON.stringify(product)):{name:'',sku:'',category:'',brand:'ทั่วไป',unit:'',barcode:String(barcode||'').trim(),price:'',cost:'',stock:0,desc:'',active:true,multiunit:true,units:[],vat:'incl'};
    mobileProductEditor={token:generateProductCreateToken(),draft,baseline:product?mobileProductEditSignature(product):null,changed:false,saving:false};
    editingProductId=product?product.id:'new';
    refreshCategoryBrandUnitLists();
    render();
    document.getElementById('main')?.scrollTo(0,0);
  }catch(error){
    showToast(error?.message||'เปิดข้อมูลสินค้าไม่สำเร็จ','danger-top');
  }finally{ mobileProductOpening=false; }
}
function closeMobileProductEditor(){
  if(!mobileProductEditor||mobileProductEditor.saving) return false;
  if(mobileProductEditor.changed&&!confirm('ออกจากหน้านี้โดยไม่บันทึกการแก้ไขใช่หรือไม่?')) return false;
  mobileProductEditor=null; editingProductId=null; render();
  return true;
}
async function openMobileBaseUnitChange(){
  if(!mobileProductEditor||!canEditMobilePrice()||mobileProductEditor.saving) return;
  if(mobileProductEditor.changed){ showToast('กรุณาบันทึกข้อมูลสินค้าที่แก้ไขก่อน แล้วเปิดมาเปลี่ยนหน่วยหลัก','danger-top'); return; }
  if(!mobileRequireOnline('เปลี่ยนหน่วยหลัก')) return;
  const editor=mobileProductEditor,productId=editingProductId;
  editor.saving=true;
  try{
    const loaded=await loadInventoryBalancesFromSupabase({warehouseIds:warehouses.map(row=>Number(row.id)),productIds:[Number(productId)]});
    if(loaded===false) throw new Error('โหลดสต๊อกล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง');
    if(editor!==mobileProductEditor) return;
    editor.saving=false;
    openProductBaseUnitChangeModal();
  }catch(error){ showToast(error?.message||'โหลดสต๊อกล่าสุดไม่สำเร็จ','danger-top'); }
  finally{ editor.saving=false; }
}
function mobileProductValidationError(data,existing){
  const structureError=productStructureValidationError(data);
  if(structureError) return structureError;
  const names=new Set([data.unit]);
  for(const row of data.units){
    names.add(row.sub);
  }
  if(extraBarcodeEntries(existing||{}).some(entry=>!names.has(entry.unit||data.unit))) return 'หน่วยนี้มีบาร์โค้ดเพิ่มเติมผูกอยู่ กรุณาจัดการบาร์โค้ดบนคอมก่อนลบหน่วย';
  const ownCodes=new Map();
  const entries=[{code:data.barcode,unit:data.unit},...data.units.map(row=>({code:row.barcode,unit:row.sub})),...extraBarcodeEntries(existing||{})];
  for(const entry of entries){
    const code=String(entry.code||'').trim().toLowerCase();
    if(!code) continue;
    if(ownCodes.has(code)&&ownCodes.get(code)!==entry.unit) return 'บาร์โค้ดเดียวกันไม่สามารถใช้กับคนละหน่วยได้';
    ownCodes.set(code,entry.unit);
  }
  const conflict=barcodePrintBarcodeOwners().find(owner=>Number(owner.pid)!==Number(existing?.id)&&ownCodes.has(String(owner.code||'').trim().toLowerCase()));
  if(conflict) return `บาร์โค้ด ${conflict.code} มีอยู่ในสินค้าอื่นแล้ว`;
  if(data.sku&&products.some(product=>Number(product.id)!==Number(existing?.id)&&String(product.sku||'').trim().toLowerCase()===data.sku.toLowerCase())) return 'รหัสสินค้า (SKU) นี้มีอยู่แล้ว';
  return '';
}
function attachMobileProductEditorEvents(){
  const form=document.getElementById('mobileProductEditor');
  if(!form||!mobileProductEditor) return;
  const markChanged=()=>{ if(mobileProductEditor){ captureMobileProductDraft(); mobileProductEditor.changed=true; } };
  form.addEventListener('input',markChanged);
  form.addEventListener('change',()=>setTimeout(markChanged,0));
  form.addEventListener('click',event=>{ if(event.target.closest('#addUnitBtn,.u_del')) markChanged(); });
  form.querySelectorAll('input[type="number"]').forEach(input=>{ input.inputMode='decimal'; input.min='0'; input.step='any'; });
  form.querySelectorAll('input:not([type="checkbox"]),textarea').forEach(input=>input.autocomplete='off');
  decorateMobileProductUnitRows();
}
function decorateMobileProductUnitRows(){
  const form=document.getElementById('mobileProductEditor');
  if(!form) return;
  // Unit-row fields need visible labels on the stacked phone layout.
  form.querySelectorAll('.unitrow').forEach(row=>{
    for(const [selector,label] of [['.u_price','ราคาขาย'],['.u_cost','ราคาทุน'],['.u_barcode','บาร์โค้ดประจำหน่วย']]){
      const input=row.querySelector(selector);
      if(!input||input.type==='hidden'||input.closest('.mobile-unit-field')) continue;
      if(input.type==='number'){ input.inputMode='decimal'; input.min='0'; input.step='any'; }
      const wrap=document.createElement('label'); wrap.className='mobile-unit-field'; wrap.textContent=label;
      input.before(wrap); wrap.appendChild(input);
    }
  });
}
function mobilePriceEditPayload(product,unitName,values,warehouseId,lotId=null){
  if(!product) return {error:'ไม่พบสินค้าที่ต้องการแก้ไข'};
  const selected=inspectionListUnitOptions(product).find(option=>option.name===unitName)||inspectionListUnitOptions(product)[0];
  if(!selected) return {error:'ไม่พบหน่วยสินค้าที่เลือก'};
  const readNumber=(value,label,{allowNegative=false}={})=>{
    if(String(value??'').trim()==='') return {error:`กรุณากรอก${label}`};
    const number=Number(value);
    if(!Number.isFinite(number)||(!allowNegative&&number<0)) return {error:`${label}ไม่ถูกต้อง`};
    return {value:number};
  };
  const priceValue=readNumber(values?.price,'ราคาขาย');
  if(priceValue.error) return priceValue;
  const costValue=readNumber(values?.cost,'ทุน');
  if(costValue.error) return costValue;
  const expiryText=String(values?.expiry||'').trim();
  if(expiryText&&!Number(lotId)) return {error:'กรุณาเลือก Lot ก่อนแก้วันหมดอายุ'};
  const expiry=expiryText?dmyToISO(expiryText):null;
  if(expiryText&&!expiry) return {error:'กรุณากรอกวันหมดอายุเป็น วัน/เดือน/ปี เช่น 05/07/2027'};
  const nextProduct={...product,units:(product.units||[]).map(unit=>({...unit}))};
  if(values?.reviewStatus!==undefined){
    if(!['normal','complete','pending'].includes(values.reviewStatus)) return {error:'สถานะสีสินค้าไม่ถูกต้อง'};
    const requestedStatus=values.reviewStatus==='normal'?'':values.reviewStatus;
    if(requestedStatus!==productDataReviewStatus(product)){
      const reviewFields=['dataReviewStatus','dataReviewUpdatedAt','dataReviewUpdatedBy','dataReviewedAt','dataReviewedBy'];
      reviewFields.forEach(field=>{ delete nextProduct[field]; });
      if(requestedStatus){
        const changedAt=new Date().toISOString();
        const changedBy=currentPharmacistName()||String(loggedInUser()?.username||'').trim();
        Object.assign(nextProduct,{dataReviewStatus:requestedStatus,dataReviewUpdatedAt:changedAt,dataReviewUpdatedBy:changedBy});
        if(requestedStatus==='complete') Object.assign(nextProduct,{dataReviewedAt:changedAt,dataReviewedBy:changedBy});
      }
    }
  }
  if(selected.name===product.unit){
    nextProduct.price=priceValue.value;
    nextProduct.cost=costValue.value;
  }else{
    const unit=nextProduct.units.find(entry=>entry.sub===selected.name);
    if(!unit) return {error:'ไม่พบหน่วยสินค้าที่เลือก'};
    unit.price=priceValue.value;
    unit.cost=costValue.value;
  }
  return {
    product:nextProduct,
    warehouseId:Number(warehouseId)||0,
    lotId:Number(lotId)||null,
    unitName:selected.name,
    price:priceValue.value,
    cost:costValue.value,
    expiry
  };
}
function mobilePriceResultHtml(){
  const product=products.find(entry=>Number(entry.id)===Number(mobilePriceProductId));
  if(!product){
    const matches=mobilePriceMatches(mobilePriceQuery);
    if(!String(mobilePriceQuery||'').trim()) return '<div class="mobile-empty">ยิงบาร์โค้ด หรือพิมพ์ชื่อ/รหัสสินค้าเพื่อเริ่มเช็คราคา</div>';
    if(!matches.length) return `<div class="mobile-empty">ไม่พบสินค้า “${escapeHtml(mobilePriceQuery)}”${canEditMobilePrice()?'<button type="button" class="btn primary mobile-create-from-code" id="mobileCreateProductFromCode">+ เพิ่มสินค้าจากบาร์โค้ดนี้</button>':''}</div>`;
    return `<div class="mobile-search-results">${matches.map(entry=>`<button type="button" class="mobile-search-result" data-mobile-price-product="${entry.id}"><b>${escapeHtml(entry.name)}</b><span>รหัส ${escapeHtml(entry.sku||'-')} · บาร์โค้ด ${escapeHtml(entry.barcode||'-')}</span></button>`).join('')}</div>`;
  }
  const options=inspectionListUnitOptions(product);
  const selected=options.find(option=>option.name===mobilePriceUnitName)||options[0];
  const selectedStock=stockUnitAmountFromBase(warehouseStock(product.id,activeWarehouseId),selected?.factor||1);
  const canViewCost=loggedInUser()?.owner===true;
  const canEdit=canEditMobilePrice();
  const expiry=warehouseExpiry(product.id,activeWarehouseId)||'';
  const editableLots=canEdit?mobileEditableLots(product.id,activeWarehouseId):[];
  let selectedLot=editableLots.find(lot=>Number(lot.id)===Number(mobilePriceLotId))||null;
  if(!selectedLot&&editableLots.length===1){ selectedLot=editableLots[0]; mobilePriceLotId=selectedLot.id; }
  const selectedLotExpiry=selectedLot?.expiry_date||'';
  const lotHint=!editableLots.length
    ? 'ยังไม่มี Lot ที่มีสินค้า วันหมดอายุจะแก้ได้หลังรับเข้าหรือเพิ่มสต๊อกเป็น Lot แล้ว'
    : editableLots.length>1&&!selectedLot
      ? 'สินค้านี้มีหลาย Lot กรุณาเลือก Lot ที่ต้องการแก้วันหมดอายุ'
      : 'วันหมดอายุจะเปลี่ยนเฉพาะ Lot ที่เลือก และระบบจะเก็บประวัติการแก้ไข';
  return `<article class="mobile-result-card" data-review-status="${productDataReviewStatus(product)||'normal'}">
    <div class="mobile-result-name">${escapeHtml(product.name)}</div>
    ${canEdit?`<div class="mobile-price-stock-readonly mobile-metric primary"><span>คงเหลือ</span><b id="mobilePriceStock">${inspectionListAmount(selectedStock)} ${escapeHtml(selected?.name||product.unit)}</b></div><div class="mobile-price-edit-grid">
      <div class="mobile-price-edit-field"><label for="mobilePriceEditSale">ราคาขาย</label><input id="mobilePriceEditSale" class="mobile-price-edit-input" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(selected?.price)||0}"></div>
      <div class="mobile-price-edit-field"><label for="mobilePriceEditCost">ทุน</label><input id="mobilePriceEditCost" class="mobile-price-edit-input" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(selected?.cost)||0}"></div>
      ${options.length>1?`<select class="mobile-unit-select" id="mobilePriceUnit">${options.map(option=>`<option value="${escapeHtml(option.name)}" ${option.name===selected?.name?'selected':''}>หน่วย: ${escapeHtml(option.name)}</option>`).join('')}</select>`:`<div class="mobile-unit-select" style="display:flex;align-items:center;">หน่วย: ${escapeHtml(selected?.name||product.unit)}</div>`}
      <div class="mobile-price-lot-field"><label for="mobilePriceLot">Lot ที่ต้องการแก้วันหมดอายุ</label><select id="mobilePriceLot" class="mobile-price-lot-select" ${editableLots.length?'':'disabled'}><option value="">${editableLots.length>1?'เลือก Lot ให้ชัดเจน':'ไม่มี Lot ที่มีสินค้า'}</option>${editableLots.map(lot=>`<option value="${lot.id}" ${Number(lot.id)===Number(selectedLot?.id)?'selected':''}>Lot ${escapeHtml(lot.manufacturer_lot||lot.internal_code||lot.id)} · ${escapeHtml(lotQuantityText(product,lot))} · ${escapeHtml(lot.expiry_date?fmtDateShort(lot.expiry_date):'ไม่ระบุวันหมดอายุ')}</option>`).join('')}</select></div>
      <div class="mobile-price-edit-field" style="grid-column:1/-1;"><label for="mobilePriceEditExpiry">วันหมดอายุของ Lot ที่เลือก</label><input id="mobilePriceEditExpiry" class="mobile-price-edit-input dmy-input" type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="วว/ดด/ปปปป" value="${escapeHtml(isoToDMY(selectedLotExpiry))}" ${selectedLot?'':'disabled'}></div>
      <div class="mobile-price-lot-hint" id="mobilePriceLotHint">${escapeHtml(lotHint)}</div>
    </div>
    <button type="button" class="btn ghost mobile-edit-product" id="mobileEditProduct">แก้ไขสินค้า / หน่วยหลัก</button>
    <div class="mobile-price-review-colors" role="group" aria-label="สีสถานะสินค้า">
      ${[['normal','สีปกติ'],['pending','สีเหลือง'],['complete','สีเขียว']].map(([value,label])=>`<button type="button" class="product-review-filter" data-mobile-review-status="${value}" aria-pressed="${(productDataReviewStatus(product)||'normal')===value}"><span class="product-review-filter-dot" aria-hidden="true"></span>${label}</button>`).join('')}
    </div>
    <button type="button" class="mobile-price-edit-save" id="mobilePriceSaveChanges" ${mobileIsOnline()?'':'disabled'}>${mobileIsOnline()?'บันทึกการแก้ไข':'ออฟไลน์ — ยังบันทึกไม่ได้'}</button><div class="mobile-price-edit-status" id="mobilePriceEditStatus"></div>`:`<div class="mobile-metrics">
      <div class="mobile-metric primary"><span>คงเหลือ</span><b id="mobilePriceStock">${inspectionListAmount(selectedStock)} ${escapeHtml(selected?.name||product.unit)}</b></div>
      <div class="mobile-metric"><span>ราคาขาย</span><b id="mobilePriceSale">${fmtMoney(selected?.price||0)} บาท</b></div>
      ${canViewCost?`<div class="mobile-metric"><span>ทุน</span><b id="mobilePriceCost">${fmtMoney(selected?.cost||0)} บาท</b></div>`:''}
      ${options.length>1?`<select class="mobile-unit-select" id="mobilePriceUnit">${options.map(option=>`<option value="${escapeHtml(option.name)}" ${option.name===selected?.name?'selected':''}>หน่วย: ${escapeHtml(option.name)}</option>`).join('')}</select>`:`<div class="mobile-unit-select" style="display:flex;align-items:center;">หน่วย: ${escapeHtml(selected?.name||product.unit)}</div>`}
      <div class="mobile-metric"><span>วันหมดอายุ</span><b>${escapeHtml(fmtDateShort(expiry))}</b></div>
    </div>`}
  </article>`;
}
async function saveMobilePriceChanges(){
  if(!canEditMobilePrice()){
    showToast('เฉพาะ Level 1 เจ้าของร้านเท่านั้นที่แก้ไขข้อมูลได้','danger-top');
    return false;
  }
  if(!mobileRequireOnline('บันทึกการแก้ไข')) return false;
  const product=products.find(entry=>Number(entry.id)===Number(mobilePriceProductId));
  const payload=mobilePriceEditPayload(product,mobilePriceUnitName,{
    price:document.getElementById('mobilePriceEditSale')?.value,
    cost:document.getElementById('mobilePriceEditCost')?.value,
    expiry:document.getElementById('mobilePriceEditExpiry')?.value,
    reviewStatus:document.querySelector('[data-mobile-review-status][aria-pressed="true"]')?.dataset.mobileReviewStatus
  },activeWarehouseId,document.getElementById('mobilePriceLot')?.value||mobilePriceLotId);
  if(payload.error){ showToast(payload.error,'danger-top'); return false; }
  if(!payload.warehouseId){ showToast('กรุณาเลือกคลังสินค้าก่อนแก้ไขข้อมูล','danger-top'); return false; }
  const button=document.getElementById('mobilePriceSaveChanges');
  const reviewButtons=[...document.querySelectorAll('[data-mobile-review-status]')];
  reviewButtons.forEach(btn=>{ btn.disabled=true; });
  if(button){ button.disabled=true; button.textContent='กำลังบันทึก...'; }
  setMobileDataStatus('saving');
  try{
    const metadata=productMetadataToRow(payload.product);
    const {data,error}=await sb.rpc('owner_update_mobile_product_details_revisioned',{
      p_product_id:Number(product.id),
      p_expected_revision:Number(product._revision)||0,
      p_warehouse_id:payload.warehouseId,
      p_lot_id:payload.lotId,
      p_product_data:metadata.data,
      p_price:Number(metadata.price)||0,
      p_cost:Number(metadata.cost)||0,
      p_expiry:payload.expiry||null
    });
    if(error) throw error;
    // The RPC returns the canonical saved row under the same transaction lock.
    // Never acknowledge the submitted object with its old revision.
    if(!data?.product) throw new Error('ยังรับข้อมูลสินค้าที่บันทึกไม่ได้ กรุณาลองโหลดข้อมูลอีกครั้ง');
    const savedProduct=rowToProduct(data.product);
    Object.assign(product,savedProduct,{stock:product.stock,expiry:product.expiry});
    // Object.assign alone cannot clear fields omitted when returning to normal.
    ['dataReviewStatus','dataReviewUpdatedAt','dataReviewUpdatedBy','dataReviewedAt','dataReviewedBy'].forEach(field=>{
      if(!Object.hasOwn(savedProduct,field)) delete product[field];
    });
    updateInventoryBalanceLocal(product.id,payload.warehouseId,Number(data?.stock??payload.stock),data?.expiry||'');
    await loadInventoryLotsFromSupabase();
    const dirtyOperation=productDirtyOperations.get(String(product.id));
    const productCacheSaved=dirtyOperation
      ?await clearAcknowledgedProductDirtyOperations([product.id],new Map([[String(product.id),dirtyOperation]]))
      :await persistProductsToIndexedDB(products,true);
    if(productCacheSaved){
      const productSnapshot=syncedTableRows.products;
      if(productSnapshot) productSnapshot.set(String(product.id),JSON.stringify(productMetadataToRow(product)));
    }else seedProductSyncSnapshot(products,productDirtyOperations);
    persistWorkspaceData();
    const status=document.getElementById('mobilePriceEditStatus');
    if(status) status.textContent=`บันทึกแล้ว · ${activeWarehouse()?.name||''}`;
    mobileLastRefreshAt=Date.now();
    setMobileDataStatus('online','บันทึกแล้ว');
    showToast('บันทึกข้อมูลสินค้าเรียบร้อยแล้ว');
    return true;
  }catch(error){
    console.warn('บันทึกข้อมูลสินค้าจากมือถือไม่สำเร็จ',error);
    setMobileDataStatus(mobileIsOnline()?'error':'offline','บันทึกไม่สำเร็จ');
    const message=error?.message==='REVISION_CONFLICT'
      ?'ข้อมูลสินค้าเปลี่ยนแล้ว ยังไม่ได้บันทึกการแก้ไขครั้งนี้ กรุณาจดค่าที่แก้ไว้ แล้วกดรีเฟรชข้อมูลก่อนเปิดสินค้านี้ใหม่'
      :error?.message||'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่';
    const status=document.getElementById('mobilePriceEditStatus');
    if(status) status.textContent=message;
    showToast(message,'danger-top');
    return false;
  }finally{
    reviewButtons.forEach(btn=>{ if(btn.isConnected) btn.disabled=false; });
    if(button?.isConnected){ button.disabled=!mobileIsOnline(); button.textContent=mobileIsOnline()?'บันทึกการแก้ไข':'ออฟไลน์ — ยังบันทึกไม่ได้'; }
  }
}
function mobileInspectionVisibleLists(){
  return inspectionLists.filter(list=>!String(list?.stockAdjustedAt||'').trim());
}
function mobileInspectionCurrentList(){
  const visibleLists=mobileInspectionVisibleLists();
  if(!visibleLists.length){
    mobileInspectionListId='';
    mobileInspectionOpenedListId='';
    return null;
  }
  let list=visibleLists.find(entry=>String(entry.id)===String(mobileInspectionListId));
  if(!list){
    list=[...visibleLists].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))[0];
    mobileInspectionListId=list?.id||'';
  }
  return list||null;
}
function mobileInspectionCheckedSet(listId){
  const key=String(listId||'');
  if(!mobileInspectionCheckedByList[key]) mobileInspectionCheckedByList[key]=new Set();
  return mobileInspectionCheckedByList[key];
}
function mobileInspectionEntries(list=mobileInspectionCurrentList()){
  if(!list) return [];
  return (list.items||[]).map(item=>({item,product:products.find(product=>Number(product.id)===Number(item.pid))})).filter(entry=>entry.product);
}
function mobileInspectionProgress(list=mobileInspectionCurrentList()){
  const entries=mobileInspectionEntries(list);
  const checked=mobileInspectionCheckedSet(list?.id);
  return {checked:entries.filter(entry=>checked.has(Number(entry.product.id))).length,total:entries.length};
}
function mobileInspectionItemHtml(entry,checked,latest){
  const selected=inspectionListSelectedOption(entry.item,entry.product);
  const stock=stockUnitAmountFromBase(entry.product.stock,selected.factor);
  return `<article class="mobile-inspection-item ${checked?'checked':''} ${latest?'latest':''}" data-mobile-inspection-item="${entry.product.id}">
    <div class="mobile-inspection-item-head"><span class="mobile-inspection-check">${checked?'✓':'·'}</span><div class="mobile-inspection-item-name">${escapeHtml(entry.product.name)}</div><button type="button" class="mobile-inspection-remove" data-mobile-inspection-remove="${entry.product.id}" aria-label="ลบ ${escapeHtml(entry.product.name)} ออกจากรายการ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6m4-6v6"/></svg></button></div>
    <div class="mobile-inspection-item-data">
      <div><span>รหัสสินค้า</span><b>${escapeHtml(entry.product.sku||'-')}</b></div>
      <div><span>บาร์โค้ด</span><b>${escapeHtml(selected.barcode||'-')}</b></div>
      <div class="mobile-inspection-stock"><span>คงเหลือ</span><b>${inspectionListAmount(stock)} ${escapeHtml(selected.name)}</b></div>
    </div>
  </article>`;
}
function mobileInspectionContentHtml(){
  const list=mobileInspectionCurrentList();
  if(!list) return '<div class="mobile-empty">ยังไม่มีรายการตรวจสินค้า กรุณาสร้างรายการจากคอมพิวเตอร์ก่อน</div>';
  const checked=mobileInspectionCheckedSet(list.id);
  const query=String(mobileInspectionQuery||'').trim();
  const allEntries=mobileInspectionEntries(list);
  const entries=(query?allEntries.filter(entry=>mobileProductMatches(entry.product,query)):allEntries).sort((a,b)=>{
    if(Number(a.product.id)===Number(mobileInspectionLastProductId)) return -1;
    if(Number(b.product.id)===Number(mobileInspectionLastProductId)) return 1;
    return String(a.product.sku||'').localeCompare(String(b.product.sku||''),'th',{numeric:true});
  });
  const progress=mobileInspectionProgress(list);
  const visible=entries.slice(0,mobileInspectionVisibleCount);
  return `<div class="mobile-inspection-progress"><span>ตรวจแล้ว ${progress.checked} / ${progress.total} รายการ</span>${progress.checked?'<button type="button" class="mobile-reset-checks" id="mobileResetChecks">เริ่มตรวจใหม่</button>':''}</div>
    ${visible.length?`<div class="mobile-inspection-list">${visible.map(entry=>mobileInspectionItemHtml(entry,checked.has(Number(entry.product.id)),Number(entry.product.id)===Number(mobileInspectionLastProductId))).join('')}</div>${entries.length>visible.length?`<button type="button" class="mobile-load-more" id="mobileLoadMore">แสดงเพิ่ม (${entries.length-visible.length})</button>`:''}`:`<div class="mobile-empty">ไม่พบสินค้าในรายการนี้</div>`}`;
}
function removeProductFromMobileInspection(listId,productId){
  if(!mobileRequireOnline('ลบสินค้าออกจากรายการ')) return false;
  const list=inspectionLists.find(entry=>String(entry.id)===String(listId));
  if(!list) return false;
  const itemIndex=(list.items||[]).findIndex(item=>Number(item.pid)===Number(productId));
  if(itemIndex<0) return false;
  const product=products.find(entry=>Number(entry.id)===Number(productId));
  if(!confirm(`ลบ “${product?.name||'สินค้านี้'}” ออกจากรายการตรวจสินค้าใช่หรือไม่?`)) return false;
  list.items.splice(itemIndex,1);
  list.updatedAt=new Date().toISOString();
  mobileInspectionCheckedSet(list.id).delete(Number(productId));
  if(Number(mobileInspectionLastProductId)===Number(productId)) mobileInspectionLastProductId=null;
  persistWorkspaceData();
  syncInspectionListsToSupabase();
  showToast('ลบสินค้าออกจากรายการตรวจสินค้าแล้ว');
  render();
  return true;
}
function startMobileInspectionDraft(){
  const defaultName=inspectionListDefaultName();
  const entered=window.prompt('ตั้งชื่อรายการตรวจสินค้า',defaultName);
  if(entered===null) return false;
  resetMobileInspectionSavedAdd();
  openInspectionListEditor('new',false);
  if(!inspectionListDraft) return false;
  inspectionListDraft.name=String(entered||'').trim()||defaultName;
  mobileInspectionCreating=true;
  mobileInspectionQuery='';
  mobileInspectionLastProductId=null;
  render();
  return true;
}
function cancelMobileInspectionDraft(){
  mobileInspectionCreating=false;
  editingInspectionListId=null;
  inspectionListDraft=null;
  mobileInspectionQuery='';
  mobileInspectionLastProductId=null;
  render();
}
function mobileInspectionDraftMatches(query){
  const existing=new Set((inspectionListDraft?.items||[]).map(item=>Number(item.pid)));
  return mobilePriceMatches(query).filter(product=>!existing.has(Number(product.id))).slice(0,8);
}
function mobileInspectionDraftRowsHtml(){
  const items=inspectionListDraft?.items||[];
  if(!items.length) return '<div class="mobile-empty">ยังไม่มีสินค้าในรายการ — ยิงบาร์โค้ดชิ้นแรกได้เลย</div>';
  return `<div class="mobile-draft-list">${items.map((item,index)=>{
    const product=products.find(entry=>Number(entry.id)===Number(item.pid));
    if(!product) return '';
    const selected=inspectionListSelectedOption(item,product);
    return `<article class="mobile-draft-item"><div><div class="mobile-draft-item-name">${escapeHtml(product.name)}</div><div class="mobile-draft-item-meta">รหัส ${escapeHtml(product.sku||'-')} · ${escapeHtml(selected.barcode||'-')} · ${escapeHtml(selected.name)}</div></div><button type="button" class="mobile-draft-remove" data-mobile-draft-remove="${index}" aria-label="ลบ ${escapeHtml(product.name)}">×</button></article>`;
  }).join('')}</div>`;
}
let posSearchRenderTimer=null;
let listSearchRenderTimer=null;
function addProductFromPOSAction(el){
  const pid=Number(el.dataset.id);
  const product=products.find(item=>Number(item.id)===pid);
  addToCart(pid, consumePosSaleUnit(product,el.dataset.unit||null), pendingQty);
  checkNegativeStockToast(pid);
  pendingQty=1;
  if(currentTab==='checkout') searchQuery='';
  render();
  document.getElementById('search')?.focus();
}
function bindPOSAddActions(root=document){
  root.querySelectorAll('[data-act="add"]').forEach(element=>element.addEventListener('click',()=>addProductFromPOSAction(element)));
}
function refreshPOSSearchResults(){
  const searchRow=document.querySelector('.pos-searchrow');
  if(!searchRow||currentTab!=='checkout') return;
  const previous=searchRow.nextElementSibling;
  if(previous?.classList?.contains('pos-results')) previous.remove();
  if(!searchQuery.trim()) return;
  searchRow.insertAdjacentHTML('afterend',renderSearchResults());
  const results=searchRow.nextElementSibling;
  if(results?.classList?.contains('pos-results')) bindPOSAddActions(results);
}
function restoreSearchInputFocus(selectionStart,selectionEnd){
  const input=document.getElementById('search');
  if(!input) return;
  input.focus({preventScroll:true});
  const length=input.value.length;
  const start=Number.isInteger(selectionStart)?Math.min(selectionStart,length):length;
  const end=Number.isInteger(selectionEnd)?Math.min(selectionEnd,length):start;
  try{ input.setSelectionRange(start,end); }catch(error){}
}
function mobileInspectionDraftHtml(){
  if(!inspectionListDraft) return '<div class="mobile-empty">ไม่พบร่างรายการ กรุณากดสร้างรายการใหม่</div>';
  const matches=String(mobileInspectionQuery||'').trim()?mobileInspectionDraftMatches(mobileInspectionQuery):[];
  const count=inspectionListDraft.items.length;
  return `<section class="mobile-tool-panel"><div class="mobile-draft-head"><div><b>${escapeHtml(inspectionListDraft.name)}</b><span>ยิงสินค้าเพื่อเพิ่มเข้ารายการ</span></div><button type="button" class="mobile-draft-cancel" id="mobileCancelInspectionDraft">ยกเลิก</button></div><div class="mobile-scan-row"><input id="mobileInspectionInput" class="mobile-scan-input" value="${escapeHtml(mobileInspectionQuery)}" placeholder="ยิงบาร์โค้ดหรือค้นหาสินค้า..." autocomplete="off" enterkeyhint="search"><button type="button" class="mobile-camera-btn" id="mobileInspectionCamera" aria-label="เปิดกล้องสแกนบาร์โค้ด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg></button></div><div class="mobile-camera-slot" id="mobileInspectionCameraSlot"></div>${matches.length?`<div class="mobile-draft-results">${matches.map(product=>`<button type="button" class="mobile-draft-result" data-mobile-draft-add="${product.id}"><b>${escapeHtml(product.name)}</b><span>รหัส ${escapeHtml(product.sku||'-')} · บาร์โค้ด ${escapeHtml(product.barcode||'-')}</span></button>`).join('')}</div>`:''}<div class="mobile-draft-count">เพิ่มแล้ว ${count} รายการ</div>${mobileInspectionDraftRowsHtml()}<div class="mobile-draft-save-wrap"><button type="button" class="mobile-draft-save" id="mobileSaveInspectionDraft" ${count&&mobileIsOnline()?'':'disabled'}>${mobileIsOnline()?`บันทึกรายการ (${count})`:'ออฟไลน์ — ยังบันทึกไม่ได้'}</button></div></section>`;
}
function resetMobileInspectionSavedAdd(){
  mobileInspectionAddingToSaved=false;
  mobileInspectionSavedAddQuery='';
  mobileInspectionSavedAddItems=[];
}
function mobileInspectionSavedAddMatches(list,query){
  const existingIds=new Set([...(list?.items||[]),...mobileInspectionSavedAddItems].map(item=>Number(item.pid)));
  return mobilePriceMatches(query).filter(product=>!existingIds.has(Number(product.id))).slice(0,8);
}
function mobileInspectionSavedAddPendingHtml(){
  if(!mobileInspectionSavedAddItems.length) return '<div class="mobile-empty">ยังไม่มีสินค้าใหม่ — ยิงบาร์โค้ดหรือค้นหาเพื่อเพิ่มได้หลายรายการ</div>';
  return `<div class="mobile-inspection-add-pending">${mobileInspectionSavedAddItems.map((item,index)=>{
    const product=products.find(entry=>Number(entry.id)===Number(item.pid));
    if(!product) return '';
    const selected=inspectionListSelectedOption(item,product);
    return `<div class="mobile-inspection-add-pending-item"><div><b>${escapeHtml(product.name)}</b><span>รหัส ${escapeHtml(product.sku||'-')} · ${escapeHtml(selected.name)} · ${escapeHtml(selected.barcode||'-')}</span></div><button type="button" class="mobile-inspection-add-pending-remove" data-mobile-inspection-add-remove="${index}" aria-label="เอา ${escapeHtml(product.name)} ออกจากรายการรอบนี้">×</button></div>`;
  }).join('')}</div>`;
}
function mobileInspectionSavedAddHtml(list){
  const query=String(mobileInspectionSavedAddQuery||'').trim();
  const matches=query?mobileInspectionSavedAddMatches(list,query):[];
  const count=mobileInspectionSavedAddItems.length;
  return `<div class="mobile-inspection-add-box"><div class="mobile-inspection-add-summary"><span>เพิ่มสินค้าใหม่ ${count} รายการ</span><button type="button" class="mobile-inspection-add-close" id="mobileInspectionAddClose">ปิด</button></div><div class="mobile-scan-row"><input id="mobileInspectionAddInput" class="mobile-scan-input" value="${escapeHtml(mobileInspectionSavedAddQuery)}" placeholder="ยิงบาร์โค้ดหรือค้นหาสินค้า..." autocomplete="off" enterkeyhint="search"><button type="button" class="mobile-camera-btn" id="mobileInspectionAddCamera" aria-label="เปิดกล้องสแกนบาร์โค้ด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg></button></div><div class="mobile-camera-slot" id="mobileInspectionAddCameraSlot"></div>${matches.length?`<div class="mobile-draft-results">${matches.map(product=>`<button type="button" class="mobile-draft-result" data-mobile-inspection-add-result="${product.id}"><b>${escapeHtml(product.name)}</b><span>รหัส ${escapeHtml(product.sku||'-')} · บาร์โค้ด ${escapeHtml(product.barcode||'-')}</span></button>`).join('')}</div>`:''}${mobileInspectionSavedAddPendingHtml()}<button type="button" class="mobile-inspection-add-save" id="mobileInspectionAddSave" ${count&&mobileIsOnline()?'':'disabled'}>${mobileIsOnline()?`บันทึกสินค้าที่เพิ่ม (${count})`:'ออฟไลน์ — ยังบันทึกไม่ได้'}</button></div>`;
}
function renderMobileInspectionPanel(lists){
  if(mobileInspectionCreating) return mobileInspectionDraftHtml();
  const current=mobileInspectionCurrentList();
  const opened=current&&String(mobileInspectionOpenedListId)===String(current.id);
  const progress=opened?mobileInspectionProgress(current):{checked:0,total:0};
  return `<section class="mobile-tool-panel"><button type="button" class="mobile-inspection-create-btn" id="mobileNewInspectionList">+ สร้างรายการตรวจสินค้า</button>${lists.length?`<div class="mobile-inspection-saved-label">รายการที่บันทึกไว้</div><select id="mobileInspectionList" class="mobile-inspection-select">${lists.map(list=>`<option value="${escapeHtml(list.id)}" ${String(list.id)===String(current?.id)?'selected':''}>${escapeHtml(list.name)} (${(list.items||[]).length})${list.stockAdjustedAt?' · แก้ไขจำนวนเรียบร้อย':''}</option>`).join('')}</select><div class="mobile-inspection-actions"><button type="button" class="mobile-inspection-action mobile-inspection-open" id="mobileOpenInspectionList">เปิดรายการ</button><button type="button" class="mobile-inspection-action mobile-inspection-delete" id="mobileDeleteInspectionList" ${mobileIsOnline()?'':'disabled'}>ลบบันทึก</button></div>${current?.stockAdjustedAt?'<div class="mobile-inspection-complete">✓ แก้ไขจำนวนเรียบร้อย</div>':''}${opened?`${mobileInspectionAddingToSaved?mobileInspectionSavedAddHtml(current):'<button type="button" class="mobile-inspection-add-toggle" id="mobileInspectionAddToggle">+ เพิ่มสินค้าในรายการ</button>'}<div id="mobileInspectionContent">${mobileInspectionContentHtml()}</div><button type="button" class="mobile-inspection-next" id="mobileContinueToStock">สรุปและแก้ไขสต๊อก (${progress.total})</button>`:'<div class="mobile-empty">เลือกรายการแล้วกด “เปิดรายการ” เพื่อเริ่มตรวจสินค้า</div>'}`:'<div class="mobile-empty">ยังไม่มีรายการที่บันทึกไว้ กด “สร้างรายการตรวจสินค้า” เพื่อเริ่มยิงสินค้า</div>'}</section>`;
}
function addProductToMobileInspectionSavedDraft(product,unitName=''){
  const list=mobileInspectionCurrentList();
  if(!mobileInspectionAddingToSaved||!list||!product) return false;
  const selected=inspectionListUnitOptions(product).find(option=>option.name===unitName)||inspectionListUnitOptions(product)[0];
  if((list.items||[]).some(item=>Number(item.pid)===Number(product.id))){
    showToast('สินค้านี้อยู่ในรายการตรวจแล้ว','danger-top');
    return false;
  }
  const pending=mobileInspectionSavedAddItems.find(item=>Number(item.pid)===Number(product.id));
  if(pending){
    if(selected) pending.unit=selected.name;
    showToast('สินค้านี้รอเพิ่มอยู่แล้ว','danger-top');
    return false;
  }
  mobileInspectionSavedAddItems.push({pid:Number(product.id),unit:selected?.name||product.unit||''});
  mobileInspectionSavedAddQuery='';
  mobileInspectionLastProductId=product.id;
  render();
  return true;
}
async function saveMobileInspectionSavedAdd(){
  const list=mobileInspectionCurrentList();
  if(!list||!mobileInspectionSavedAddItems.length) return false;
  if(!mobileRequireOnline('เพิ่มสินค้าในรายการตรวจสินค้า')) return false;
  const originalItems=(list.items||[]).map(item=>({...item}));
  const originalUpdatedAt=list.updatedAt;
  const additions=mobileInspectionSavedAddItems.map(item=>({pid:Number(item.pid),unit:String(item.unit||'')}));
  const button=document.getElementById('mobileInspectionAddSave');
  if(button) button.disabled=true;
  setMobileDataStatus('saving');
  list.items=[...originalItems,...additions];
  list.updatedAt=new Date().toISOString();
  persistWorkspaceData();
  const synced=await syncInspectionListsToSupabase();
  if(!synced){
    list.items=originalItems;
    list.updatedAt=originalUpdatedAt;
    persistWorkspaceData();
    setMobileDataStatus(mobileIsOnline()?'error':'offline','เพิ่มสินค้าไม่สำเร็จ');
    showToast('เพิ่มสินค้าไม่สำเร็จ รายการเดิมยังไม่เปลี่ยน กรุณาลองใหม่','danger-top');
    render();
    return false;
  }
  const addedCount=additions.length;
  resetMobileInspectionSavedAdd();
  mobileLastRefreshAt=Date.now();
  setMobileDataStatus('online','บันทึกแล้ว');
  showToast(`เพิ่มสินค้าในรายการแล้ว ${addedCount} รายการ`);
  render();
  return true;
}
function addProductToMobileInspectionDraft(product,unitName=''){
  if(!product||!inspectionListDraft) return false;
  const added=inspectionListAddProduct(product,unitName);
  mobileInspectionQuery='';
  mobileInspectionLastProductId=product.id;
  if(!added) showToast('สินค้านี้อยู่ในรายการแล้ว');
  render();
  return added;
}
async function saveMobileInspectionDraft(){
  if(!inspectionListDraft) return false;
  if(!mobileRequireOnline('บันทึกรายการตรวจสินค้า')) return false;
  setMobileDataStatus('saving');
  mobileInspectionCreating=false;
  const saved=saveInspectionListDraft({sync:false});
  if(!saved){ mobileInspectionCreating=true; setMobileDataStatus('online'); render(); return false; }
  const synced=await syncInspectionListsToSupabase();
  if(!synced){ setMobileDataStatus('error','ซิงก์รายการไม่สำเร็จ'); showToast('บันทึกในเครื่องแล้ว แต่ซิงก์รายการไม่สำเร็จ กรุณากดรีเฟรช','danger-top'); }
  else{ mobileLastRefreshAt=Date.now(); setMobileDataStatus('online','บันทึกแล้ว'); }
  mobileInspectionListId=inspectionLists[0]?.id||'';
  mobileInspectionOpenedListId=mobileInspectionListId;
  mobileInspectionQuery='';
  mobileInspectionLastProductId=null;
  render();
  return true;
}
function addProductToMobileStockEdit(product,unitName=''){
  if(!product) return false;
  if(!stockEditItems.includes(product.id)) stockEditItems.unshift(product.id);
  const selected=inspectionListUnitOptions(product).find(option=>option.name===unitName)||inspectionListUnitOptions(product)[0];
  stockEditRowUnitSel[product.id]=selected?.name||product.unit;
  if(stockEditRequiresReconciliation(product)&&!Object.prototype.hasOwnProperty.call(stockEditDraftStocks,product.id)){
    stockEditDraftStocks[product.id]=Number(product.stock)||0;
  }
  mobileStockQuery='';
  mobileStockLastProductId=product.id;
  render();
  return true;
}
function prepareMobileScanSound(){
  if(mobileScanSound||typeof Audio!=='function') return mobileScanSound;
  mobileScanSound=new Audio(MOBILE_SCAN_SOUND_URL);
  mobileScanSound.preload='auto';
  mobileScanSound.load();
  return mobileScanSound;
}
function prepareMobileScanErrorSound(){
  if(mobileScanErrorSound||typeof Audio!=='function') return mobileScanErrorSound;
  mobileScanErrorSound=new Audio(MOBILE_SCAN_ERROR_SOUND_URL);
  mobileScanErrorSound.preload='auto';
  mobileScanErrorSound.load();
  return mobileScanErrorSound;
}
function prepareMobileScanAudioContext(){
  if(mobileScanAudioContext) return mobileScanAudioContext;
  const AudioContextClass=typeof window!=='undefined'&&(window.AudioContext||window.webkitAudioContext);
  if(typeof AudioContextClass!=='function') return null;
  try{
    mobileScanAudioContext=new AudioContextClass();
    return mobileScanAudioContext;
  }catch(error){
    console.warn('เตรียมระบบเสียงสแกนบาร์โค้ดไม่สำเร็จ',error);
    return null;
  }
}
function mobileScanVibrate(kind){
  try{
    if(typeof navigator!=='undefined'&&typeof navigator.vibrate==='function'){
      navigator.vibrate(kind==='error'?[90,60,140]:45);
    }
  }catch(error){
    console.warn('สั่นแจ้งผลสแกนบาร์โค้ดไม่สำเร็จ',error);
  }
}
function mobileScanSoundUrl(kind='success'){
  return kind==='error'?MOBILE_SCAN_ERROR_SOUND_URL:MOBILE_SCAN_SOUND_URL;
}
function prepareMobileScanDecodedSound(kind='success'){
  const soundKind=kind==='error'?'error':'success';
  const context=prepareMobileScanAudioContext();
  if(!context||typeof context.decodeAudioData!=='function'||typeof atob!=='function') return null;
  if(mobileScanDecodedSounds[soundKind]) return Promise.resolve(mobileScanDecodedSounds[soundKind]);
  if(mobileScanDecodePromises[soundKind]) return mobileScanDecodePromises[soundKind];
  try{
    const encoded=mobileScanSoundUrl(soundKind).split(',')[1]||'';
    const binary=atob(encoded);
    const bytes=new Uint8Array(binary.length);
    for(let index=0;index<binary.length;index+=1) bytes[index]=binary.charCodeAt(index);
    mobileScanDecodePromises[soundKind]=new Promise((resolve,reject)=>{
      let settled=false;
      const done=buffer=>{
        if(settled) return;
        settled=true;
        mobileScanDecodedSounds[soundKind]=buffer;
        resolve(buffer);
      };
      const fail=error=>{
        if(settled) return;
        settled=true;
        reject(error);
      };
      try{
        const decoded=context.decodeAudioData(bytes.buffer,done,fail);
        if(decoded?.then) decoded.then(done).catch(fail);
      }catch(error){ fail(error); }
    }).catch(error=>{
      mobileScanDecodePromises[soundKind]=null;
      console.warn('ถอดรหัสเสียงสแกนบาร์โค้ดไม่สำเร็จ',error);
      return null;
    });
    return mobileScanDecodePromises[soundKind];
  }catch(error){
    console.warn('เตรียมข้อมูลเสียงสแกนบาร์โค้ดไม่สำเร็จ',error);
    return null;
  }
}
function playMobileScanHtmlSound(kind='success'){
  try{
    const sound=kind==='error'?prepareMobileScanErrorSound():prepareMobileScanSound();
    if(!sound){ mobileScanVibrate(kind); return false; }
    sound.pause();
    sound.currentTime=0;
    const playback=sound.play();
    if(playback?.then) playback.then(()=>mobileScanVibrate(kind)).catch(()=>mobileScanVibrate(kind));
    else mobileScanVibrate(kind);
    return true;
  }catch(error){
    console.warn('เล่นเสียงสแกนบาร์โค้ดไม่สำเร็จ',error);
    mobileScanVibrate(kind);
    return false;
  }
}
function playMobileScanDecodedSound(kind='success'){
  const soundKind=kind==='error'?'error':'success';
  const context=prepareMobileScanAudioContext();
  const prepared=prepareMobileScanDecodedSound(soundKind);
  if(!context||!prepared) return false;
  const emit=buffer=>{
    if(!buffer){ playMobileScanHtmlSound(soundKind); return; }
    try{
      const source=context.createBufferSource();
      source.buffer=buffer;
      source.connect(context.destination);
      source.start(0);
      mobileScanVibrate(soundKind);
    }catch(error){
      console.warn('เล่นไฟล์เสียงสแกนบาร์โค้ดไม่สำเร็จ',error);
      playMobileScanHtmlSound(soundKind);
    }
  };
  prepared.then(buffer=>{
    if(context.state==='suspended'&&typeof context.resume==='function'){
      const resumed=context.resume();
      if(resumed?.then) resumed.then(()=>emit(buffer)).catch(()=>playMobileScanHtmlSound(soundKind));
      else emit(buffer);
    }else emit(buffer);
  }).catch(()=>playMobileScanHtmlSound(soundKind));
  return true;
}
function playMobileScanSound(){
  return playMobileScanDecodedSound('success')||playMobileScanHtmlSound('success');
}
function playMobileScanErrorSound(){
  return playMobileScanDecodedSound('error')||playMobileScanHtmlSound('error');
}
function unlockMobileScanSound(){
  try{
    const context=prepareMobileScanAudioContext();
    if(context?.state==='suspended'&&typeof context.resume==='function'){
      const resumed=context.resume();
      if(resumed?.catch) resumed.catch(()=>{});
    }
    [prepareMobileScanSound(),prepareMobileScanErrorSound()].filter(Boolean).forEach(sound=>{
      const muted=sound.muted;
      sound.muted=true;
      const playback=sound.play();
      const reset=()=>{ sound.pause(); sound.currentTime=0; sound.muted=muted; };
      if(playback?.then) playback.then(reset).catch(()=>{ sound.muted=muted; });
      else reset();
    });
  }catch(error){
    console.warn('เตรียมเสียงสแกนบาร์โค้ดไม่สำเร็จ',error);
  }
}
function attachMobileScanSoundUnlock(){
  if(mobileScanSoundUnlockAttached||typeof document==='undefined') return;
  const unlock=()=>{
    const context=prepareMobileScanAudioContext();
    if(context?.state==='suspended'&&typeof context.resume==='function'){
      const resumed=context.resume();
      if(resumed?.catch) resumed.catch(()=>{});
    }
  };
  document.addEventListener('pointerdown',unlock,{capture:true,passive:true});
  document.addEventListener('touchstart',unlock,{capture:true,passive:true});
  document.addEventListener('keydown',unlock,{capture:true});
  mobileScanSoundUnlockAttached=true;
}
function mobileHandleStockCode(code){
  const query=String(code||'').trim();
  if(!query) return false;
  const exact=findProductByExactCode(query);
  const product=exact?.product||mobilePriceMatches(query)[0];
  if(!product){
    mobileStockQuery=query;
    mobileStockLastProductId=null;
    render();
    showToast('ไม่พบสินค้าจากรหัสนี้','danger-top');
    playMobileScanErrorSound();
    return false;
  }
  const accepted=addProductToMobileStockEdit(product,exact?.unitName||'');
  if(accepted) playMobileScanSound();
  else playMobileScanErrorSound();
  return accepted;
}
function stockEditMobileLotSelectionsReady(changes=stockEditPendingChanges()){
  return changes.every(({product,newStock})=>{
    const lotDifference=Number(newStock)-stockEditLotTotal(product.id);
    if(lotDifference<=0.000001) return true;
    const selection=stockEditLotSelections[product.id]||'';
    if(selection==='new') return true;
    if(!selection.startsWith('lot:')) return false;
    const selectedLotId=Number(selection.slice(4));
    return stockEditAvailableLots(product.id).some(lot=>Number(lot.id)===selectedLotId);
  });
}
function mobileStockEditLotHtml(product){
  const hasDraft=Object.prototype.hasOwnProperty.call(stockEditDraftStocks,product.id);
  const targetStock=hasDraft?Number(stockEditDraftStocks[product.id]):Number(product.stock);
  const lotDifference=targetStock-stockEditLotTotal(product.id);
  if(!hasDraft&&Math.abs(lotDifference)<0.000001){
    return '<div class="mobile-stock-lot-neutral">แก้จำนวนคงเหลือ แล้วเลือกว่าให้ปรับ LOT ใด</div>';
  }
  if(Math.abs(lotDifference)<0.000001){
    return '<div class="mobile-stock-lot-neutral">ยอดรวม LOT ตรงกับจำนวนที่กรอกแล้ว</div>';
  }
  const lots=stockEditAvailableLots(product.id);
  const validLotSelections=new Set(lots.map(lot=>`lot:${lot.id}`));
  let selection=stockEditLotSelections[product.id]||'';
  if(lotDifference<0){
    if(selection!=='auto'&&!validLotSelections.has(selection)) selection='auto';
  }else if(selection!=='new'&&!validLotSelections.has(selection)){
    selection='choose';
  }
  stockEditLotSelections[product.id]=selection;
  const lotOptions=lots.map(lot=>{
    const lotName=lot.manufacturer_lot||lot.internal_code||'ไม่ระบุเลข LOT';
    const expiry=lot.expiry_date?fmtDate(lot.expiry_date):'ไม่ระบุวันหมดอายุ';
    const balance=stockInLargestUnit({...product,stock:Number(lot.quantity_base)||0});
    const label=`${lotName} · หมดอายุ ${expiry} · เหลือ ${balance}`;
    return `<option value="lot:${lot.id}" ${selection===`lot:${lot.id}`?'selected':''}>${escapeHtml(label)}</option>`;
  }).join('');
  const differenceLabel=`${lotDifference>0?'+':'-'}${stockInLargestUnit({...product,stock:Math.abs(lotDifference)})}`;
  if(lotDifference<0){
    const firstLot=lots[0];
    const autoLabel=firstLot?`อัตโนมัติ FEFO — เริ่ม ${firstLot.manufacturer_lot||firstLot.internal_code||'LOT ไม่ระบุเลข'}`:'อัตโนมัติตาม FEFO';
    return `<div class="mobile-stock-lot-title"><label>LOT ที่ลดจำนวน</label><span class="mobile-stock-lot-difference out">${escapeHtml(differenceLabel)}</span></div><select class="mobile-stock-lot-select" data-mobile-stock-lot="${product.id}"><option value="auto" ${selection==='auto'?'selected':''}>${escapeHtml(autoLabel)}</option>${lotOptions}</select><span class="mobile-stock-lot-hint">ระบบจะตัด LOT ที่เลือกก่อน หากไม่พอจะตัด LOT ใกล้หมดอายุลำดับถัดไป</span>`;
  }
  const storedExpiry=Object.prototype.hasOwnProperty.call(stockEditNewLotExpiries,product.id)?stockEditNewLotExpiries[product.id]:(product.expiry||'');
  const newLotFields=selection==='new'?`<div class="mobile-stock-new-lot-fields"><label>เลข LOT ผู้ผลิต<input data-mobile-stock-new-lot="${product.id}" value="${escapeHtml(stockEditNewLotNumbers[product.id]||'')}" placeholder="เช่น ABC123" autocomplete="off"></label><label>วันหมดอายุ<input class="dmy-input" data-mobile-stock-new-expiry="${product.id}" value="${escapeHtml(isoToDMY(storedExpiry))}" placeholder="วว/ดด/ปปปป" inputmode="numeric" maxlength="10" autocomplete="off"></label></div>`:'';
  return `<div class="mobile-stock-lot-title"><label>LOT ที่เพิ่มจำนวน</label><span class="mobile-stock-lot-difference">${escapeHtml(differenceLabel)}</span></div><select class="mobile-stock-lot-select" data-mobile-stock-lot="${product.id}"><option value="choose" ${selection==='choose'?'selected':''}>เลือก LOT ที่จะเพิ่ม</option>${lotOptions}<option value="new" ${selection==='new'?'selected':''}>+ สร้าง LOT ใหม่</option></select>${newLotFields}<span class="mobile-stock-lot-hint">เลือก LOT เดิมให้ตรงกับสินค้าที่พบ หรือสร้าง LOT ใหม่พร้อมกรอกเลขและวันหมดอายุ</span>`;
}
function refreshMobileStockLotControl(productId){
  const product=products.find(entry=>Number(entry.id)===Number(productId));
  const host=document.querySelector(`[data-mobile-stock-lot-host="${Number(productId)}"]`);
  if(product&&host) host.innerHTML=mobileStockEditLotHtml(product);
}
function mobileStockEditRowsHtml(){
  const rows=stockEditCurrentProducts();
  if(!rows.length) return '<div class="mobile-empty">ดึงข้อมูลจากรายการตรวจสินค้า หรือยิงบาร์โค้ดเพื่อเพิ่มสินค้า</div>';
  return `<div class="mobile-stock-list">${rows.map(product=>{
    const options=inspectionListUnitOptions(product);
    const selected=options.find(option=>option.name===stockEditRowUnitSel[product.id])||options[0];
    const hasDraft=Object.prototype.hasOwnProperty.call(stockEditDraftStocks,product.id);
    const baseStock=hasDraft?stockEditDraftStocks[product.id]:product.stock;
    const amount=stockUnitAmountFromBase(baseStock,selected?.factor||1);
    return `<article class="mobile-stock-item" data-mobile-stock-item="${product.id}"><div class="mobile-stock-info-row"><div class="mobile-stock-field"><label>รหัสสินค้า</label><b>${escapeHtml(product.sku||'-')}</b></div><div class="mobile-stock-field"><label>สินค้า</label><b class="mobile-stock-product-name">${escapeHtml(product.name)}</b></div></div><div class="mobile-stock-edit-row"><div class="mobile-stock-field"><label>หน่วย</label>${options.length>1?`<select class="mobile-stock-unit" data-mobile-stock-unit="${product.id}">${options.map(option=>`<option value="${escapeHtml(option.name)}" ${option.name===selected?.name?'selected':''}>${escapeHtml(option.name)}</option>`).join('')}</select>`:`<b class="mobile-stock-unit-static">${escapeHtml(selected?.name||product.unit||'-')}</b>`}</div><div class="mobile-stock-field"><label>คงเหลือ</label><input type="number" min="0" step="any" class="mobile-stock-amount ${hasDraft?'pending':''}" data-mobile-stock-amount="${product.id}" data-factor="${selected?.factor||1}" value="${amount}" aria-label="คงเหลือ ${escapeHtml(product.name)}"></div><button type="button" class="mobile-stock-remove" data-mobile-stock-remove="${product.id}" title="ลบ ${escapeHtml(product.name)} ออกจากรายการ" aria-label="ลบ ${escapeHtml(product.name)} ออกจากรายการ"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div><div class="mobile-stock-lot" data-mobile-stock-lot-host="${product.id}">${mobileStockEditLotHtml(product)}</div></article>`;
  }).join('')}</div>`;
}
function renderMobileStockEditPanel(lists){
  const availableLists=lists.filter(inspectionListAvailableForStockEdit);
  let selectedSource=availableLists.find(list=>String(list.id)===String(mobileStockSourceListId));
  if(!selectedSource&&availableLists.length){ selectedSource=availableLists[0]; mobileStockSourceListId=selectedSource.id; }
  if(!availableLists.length) mobileStockSourceListId='';
  const sourceList=stockEditInspectionSourceList();
  const pendingChanges=stockEditPendingChanges();
  const canConfirm=(pendingChanges.length>0||stockEditSourcePending)&&stockEditMobileLotSelectionsReady(pendingChanges)&&!stockEditPosting&&mobileIsOnline();
  return `<section class="mobile-tool-panel"><div class="mobile-stock-source"><button type="button" class="mobile-stock-import" id="mobileStockImport" ${availableLists.length?'':'disabled'}>ดึงข้อมูล</button><select id="mobileStockSourceList" ${availableLists.length?'':'disabled'}>${availableLists.length?availableLists.map(list=>`<option value="${escapeHtml(list.id)}" ${String(list.id)===String(selectedSource?.id)?'selected':''}>${escapeHtml(list.name)} (${(list.items||[]).length})</option>`).join(''):'<option value="">ไม่มีรายการที่รอแก้ไขสต๊อก</option>'}</select></div>${sourceList?`<div class="mobile-stock-source-note"><b>${escapeHtml(sourceList.name)}</b><span>${stockEditSourcePending?'รอยืนยันการแก้ไข':'แก้ไขจำนวนเรียบร้อย'}</span></div>`:''}${mobileStockEditRowsHtml()}<div class="mobile-stock-confirm-wrap"><button type="button" class="mobile-stock-confirm" id="mobileConfirmStockEdit" ${canConfirm?'':'disabled'}>${!mobileIsOnline()?'ออฟไลน์ — ยังบันทึกไม่ได้':stockEditPosting?'กำลังบันทึก...':'ยืนยันผลตรวจนับ'}</button></div></section>`;
}
async function confirmMobileStockEditChanges(){
  if(!mobileRequireOnline('ยืนยันแก้ไขสต๊อก')) return false;
  if(!stockEditMobileLotSelectionsReady()){
    showToast('กรุณาเลือก LOT ที่จะเพิ่มให้ครบทุกรายการ','danger-top');
    return false;
  }
  if(document.querySelector('[data-mobile-stock-new-expiry].invalid')){
    showToast('กรุณากรอกวันหมดอายุรูปแบบ 05/07/2027 หรือเว้นว่าง','danger-top');
    return false;
  }
  const completedSourceId=stockEditSourcePending?stockEditSourceInspectionListId:null;
  setMobileDataStatus('saving');
  const confirmed=await confirmStockEditChanges();
  if(!confirmed){ setMobileDataStatus(mobileIsOnline()?'online':'offline'); return false; }
  mobileLastRefreshAt=Date.now();
  setMobileDataStatus('online','บันทึกแล้ว');
  if(!completedSourceId) return true;
  stockEditItems=[];
  stockEditRowUnitSel={};
  stockEditDraftStocks={};
  stockEditSourceInspectionListId=null;
  stockEditSourcePending=false;
  mobileStockSourceListId='';
  mobileStockQuery='';
  mobileStockLastProductId=null;
  mobileInventoryStep='inspection';
  render();
  return true;
}
async function refreshMobileToolsData(button,options={}){
  if(mobileProductEditor||mobileProductOpening) return false;
  if(mobileRefreshPromise) return mobileRefreshPromise;
  if(!mobileRequireOnline('รีเฟรชข้อมูล')) return false;
  if(button){ button.disabled=true; button.classList.add('loading'); }
  setMobileDataStatus('syncing');
  mobileRefreshPromise=(async()=>{
    try{
      const {error:connectionError}=await sb.from('warehouses').select('id').limit(1);
      if(connectionError) throw connectionError;
      const {data:latestProducts,error:productError}=await loadProductRowsFromSupabase();
      if(productError) throw productError;
      products=latestProducts||products;
      rebuildProductLookupMaps();
      seedProductSyncSnapshot(products,productDirtyOperations);
      await Promise.all([loadInventoryBalancesFromSupabase(),loadInventoryLotsFromSupabase(),loadInspectionListsFromSupabase()]);
      refreshCategoryBrandUnitLists();
      mobileLastRefreshAt=Date.now();
      setMobileDataStatus('online',options.silent?'ออนไลน์':'รีเฟรชแล้ว');
      if(!options.silent) showToast('รีเฟรชข้อมูลล่าสุดแล้ว');
      render();
      return true;
    }catch(error){
      console.warn('รีเฟรชข้อมูลมือถือไม่สำเร็จ',error);
      setMobileDataStatus(mobileIsOnline()?'error':'offline','รีเฟรชไม่สำเร็จ');
      if(!options.silent) showToast('รีเฟรชข้อมูลไม่สำเร็จ กรุณาลองใหม่','danger-top');
      return false;
    }finally{
      if(button?.isConnected){ button.disabled=!mobileIsOnline(); button.classList.remove('loading'); }
      mobileRefreshPromise=null;
    }
  })();
  return mobileRefreshPromise;
}
function renderMobileTools(){
  const user=loggedInUser();
  const mobileStatus=mobileDataStatusDetails();
  if(mobileProductEditor&&canEditMobilePrice()){
    return `<main class="mobile-tools-page mobile-product-page"><fieldset class="mobile-product-editor" id="mobileProductEditor" data-editor-token="${escapeHtml(mobileProductEditor.token)}" ${mobileProductEditor.saving?'disabled':''}>${renderProductForm({mobile:true})}</fieldset></main>`;
  }
  if(mobileToolMode==='inspection'||mobileToolMode==='stock'){
    mobileInventoryStep=mobileToolMode==='stock'?'stock':'inspection';
    mobileToolMode='inventory';
  }
  // Mobile only shows lists still waiting for a stock adjustment. Completed
  // records remain untouched in `inspectionLists`, so desktop history is kept.
  const lists=[...mobileInspectionVisibleLists()].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  return `<main class="mobile-tools-page">
    ${mobileInstallNoticeHtml()}
    <nav class="mobile-tools-tabs ${canEditMobilePrice()?'has-product-action':''}" aria-label="เมนูมือถือ"><button type="button" class="mobile-tools-tab ${mobileToolMode==='price'?'active':''}" data-mobile-tool="price">เช็คราคา</button><button type="button" class="mobile-tools-tab ${mobileToolMode==='inventory'?'active':''}" data-mobile-tool="inventory">ตรวจแก้สต๊อก</button>${canEditMobilePrice()?'<button type="button" class="mobile-product-add" id="mobileNewProduct" title="เพิ่มสินค้า" aria-label="เพิ่มสินค้า">+</button>':''}</nav>
    <div class="mobile-tools-tab-brand">P R A N C - H I B E S</div>
    ${mobileToolMode==='price'&&canEditMobilePrice()&&productDirtyOperations.size?`<div class="mobile-product-toolbar"><button type="button" class="btn ghost" id="mobileProductSyncDetails">สินค้ารอซิงก์ ${productDirtyOperations.size} รายการ</button></div>`:''}
    ${mobileToolMode==='price'?`<section class="mobile-tool-panel"><div class="mobile-scan-row mobile-scan-row-camera-left"><button type="button" class="mobile-camera-btn" id="mobilePriceCamera" aria-label="เปิดกล้องสแกนบาร์โค้ด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg></button><input id="mobilePriceInput" class="mobile-scan-input" value="${escapeHtml(mobilePriceQuery)}" placeholder="ยิงบาร์โค้ดหรือค้นหาสินค้า..." autocomplete="off" enterkeyhint="search"></div><div class="mobile-camera-slot" id="mobilePriceCameraSlot"></div><div id="mobilePriceResult">${mobilePriceResultHtml()}</div></section>`:`<div class="mobile-inventory-workflow"><div class="mobile-inventory-steps" role="tablist" aria-label="ขั้นตอนตรวจและแก้ไขสต๊อก"><button type="button" class="mobile-inventory-step ${mobileInventoryStep==='inspection'?'active':''}" data-mobile-inventory-step="inspection" role="tab" aria-selected="${mobileInventoryStep==='inspection'}"><span class="mobile-inventory-step-number">1</span><span>ตรวจนับ</span></button><button type="button" class="mobile-inventory-step ${mobileInventoryStep==='stock'?'active':''}" data-mobile-inventory-step="stock" role="tab" aria-selected="${mobileInventoryStep==='stock'}"><span class="mobile-inventory-step-number">2</span><span>สรุปและยืนยัน</span></button></div>${mobileInventoryStep==='inspection'?renderMobileInspectionPanel(lists):renderMobileStockEditPanel(lists)}</div>`}
    <header class="mobile-tools-head"><div class="mobile-tools-actions"><button type="button" class="mobile-tools-logout" id="mobileToolsLogout">ออกจากระบบ</button><button type="button" class="mobile-tools-refresh" id="mobileToolsRefresh" aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล" ${mobileIsOnline()?'':'disabled'}><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg></button></div><div class="mobile-tools-brand"><div><h1>SAPURI</h1><span>${escapeHtml(user?.firstName||user?.username||'ผู้ใช้งาน')}</span><span class="mobile-tools-context" id="mobileDataStatus" data-state="${mobileStatus.state}" aria-live="polite">${escapeHtml(mobileStatus.text)}</span></div><div class="mobile-tools-logo"><img src="/sapuri-brand-logo.webp" alt="SAPURI"></div></div></header>
  </main>`;
}
function mobileHandlePriceCode(code){
  const query=String(code||'').trim();
  if(!query) return false;
  mobilePriceQuery=query;
  const exact=findProductByExactCode(query);
  const product=exact?.product||mobilePriceMatches(query)[0];
  if(!product){ mobilePriceProductId=null; mobilePriceLotId=null; render(); playMobileScanErrorSound(); return false; }
  mobileSelectPriceProduct(product,exact?.unitName||'');
  render();
  if(!mobileCameraSession) setTimeout(()=>document.getElementById('mobilePriceInput')?.select(),0);
  playMobileScanSound();
  return true;
}
function mobileHandleInspectionCode(code){
  const query=String(code||'').trim();
  if(!query) return false;
  if(mobileInspectionCreating){
    const exact=findProductByExactCode(query);
    const product=exact?.product||mobilePriceMatches(query)[0];
    if(!product){ mobileInspectionQuery=query; render(); showToast('ไม่พบสินค้าจากรหัสนี้','danger-top'); playMobileScanErrorSound(); return false; }
    const accepted=addProductToMobileInspectionDraft(product,exact?.unitName||'');
    if(accepted) playMobileScanSound();
    else playMobileScanErrorSound();
    return accepted;
  }
  if(mobileInspectionAddingToSaved){
    const exact=findProductByExactCode(query);
    const product=exact?.product||mobilePriceMatches(query)[0];
    if(!product){ mobileInspectionSavedAddQuery=query; render(); showToast('ไม่พบสินค้าจากรหัสนี้','danger-top'); playMobileScanErrorSound(); return false; }
    const accepted=addProductToMobileInspectionSavedDraft(product,exact?.unitName||'');
    if(accepted) playMobileScanSound();
    else playMobileScanErrorSound();
    return accepted;
  }
  const list=mobileInspectionCurrentList();
  const exact=findProductByExactCode(query);
  const entry=exact&&mobileInspectionEntries(list).find(item=>Number(item.product.id)===Number(exact.product.id));
  if(!entry){
    mobileInspectionQuery=query;
    mobileInspectionLastProductId=null;
    render();
    showToast(exact?'สินค้านี้ไม่ได้อยู่ในรายการตรวจที่เลือก':'ไม่พบสินค้าจากบาร์โค้ดนี้','danger-top');
    playMobileScanErrorSound();
    return false;
  }
  mobileInspectionCheckedSet(list.id).add(Number(entry.product.id));
  mobileInspectionLastProductId=entry.product.id;
  mobileInspectionQuery='';
  render();
  playMobileScanSound();
  return true;
}
function closeMobileCameraScanner(){
  const session=mobileCameraSession;
  if(!session) return false;
  mobileCameraSession=null;
  session.closed=true;
  try{ session.decoderControls?.stop?.(); }catch(_error){}
  if(session.stream) session.stream.getTracks().forEach(track=>track.stop());
  session.element.remove();
  const button=document.getElementById(session.buttonId);
  if(button) button.setAttribute('aria-pressed','false');
  return true;
}
function preserveMobileCameraScanner(){
  const element=mobileCameraSession?.element;
  if(element?.isConnected) element.remove();
}
function restoreMobileCameraScanner(){
  const session=mobileCameraSession;
  if(!session) return false;
  const host=document.getElementById(session.hostId);
  if(!host){ closeMobileCameraScanner(); return false; }
  host.replaceChildren(session.element);
  const button=document.getElementById(session.buttonId);
  if(button) button.setAttribute('aria-pressed','true');
  return true;
}
function ensureMobileZxingLoaded(){
  if(window.ZXingBrowser?.BrowserMultiFormatReader) return Promise.resolve(window.ZXingBrowser);
  if(mobileZxingLoadPromise) return mobileZxingLoadPromise;
  mobileZxingLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=`/vendor/zxing-browser.min.js${APP_ASSET_VERSION?`?v=${encodeURIComponent(APP_ASSET_VERSION)}`:''}`;
    script.async=true;
    script.onload=()=>window.ZXingBrowser?.BrowserMultiFormatReader?resolve(window.ZXingBrowser):reject(new Error('ZXing ไม่พร้อมใช้งาน'));
    script.onerror=()=>reject(new Error('โหลดตัวอ่านบาร์โค้ดสำหรับ iPad ไม่สำเร็จ'));
    document.head.appendChild(script);
  }).catch(error=>{ mobileZxingLoadPromise=null; throw error; });
  return mobileZxingLoadPromise;
}
async function openMobileCameraScanner(onCode,options={}){
  const continuous=options.continuous===true;
  const hostId=String(options.hostId||'');
  const buttonId=String(options.buttonId||'');
  const fixedMessage=hostId==='mobilePriceCameraSlot'?'P R A N C - H I B E S':'';
  if(!navigator.mediaDevices?.getUserMedia){ playMobileScanErrorSound(); showToast('อุปกรณ์นี้ไม่รองรับการเปิดกล้อง กรุณาใช้เครื่องยิงหรือพิมพ์บาร์โค้ด','danger-top'); return false; }
  const host=document.getElementById(hostId);
  if(!host){ playMobileScanErrorSound(); showToast('ไม่พบกรอบสำหรับเปิดกล้อง กรุณารีเฟรชแล้วลองใหม่','danger-top'); return false; }
  closeMobileCameraScanner();
  const camera=document.createElement('div');
  camera.className='mobile-camera-inline';
  camera.innerHTML=`<div class="mobile-camera-box"><div class="mobile-camera-head"><button type="button" class="mobile-camera-close" aria-label="ปิดกล้อง">×</button><span>P R A N C - H I B E S</span></div><div class="mobile-camera-video-wrap"><video class="mobile-camera-video" autoplay muted playsinline></video><div class="mobile-camera-guide"></div></div><div class="mobile-camera-message">${fixedMessage||'กำลังเปิดกล้อง...'}</div></div>`;
  host.replaceChildren(camera);
  const video=camera.querySelector('video');
  const message=camera.querySelector('.mobile-camera-message');
  const session={element:camera,hostId,buttonId,video,message,stream:null,decoderControls:null,closed:false,scanErrorNotified:false};
  mobileCameraSession=session;
  const button=document.getElementById(buttonId);
  if(button) button.setAttribute('aria-pressed','true');
  camera.querySelector('.mobile-camera-close').addEventListener('click',closeMobileCameraScanner);
  camera.scrollIntoView({behavior:'smooth',block:'nearest'});
  let busy=false,lastValue='',lastValueSeenAt=0,nextDetectionAt=0;
  try{
    const nativeDetectorAvailable='BarcodeDetector' in window;
    const zxing=nativeDetectorAvailable?null:await ensureMobileZxingLoaded();
    session.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    if(session.closed||mobileCameraSession!==session){ session.stream.getTracks().forEach(track=>track.stop()); return false; }
    video.srcObject=session.stream;
    await video.play();
    message.textContent=fixedMessage||(continuous?'สแกนต่อเนื่อง — ยิงได้หลายสินค้า กด × เมื่อต้องการปิด':'พร้อมสแกน — ถือกล้องให้นิ่ง');
    const handleValue=(rawValue,controls=null)=>{
      const value=String(rawValue||'').trim();
      const now=Date.now();
      if(!value){ if(lastValue&&now-lastValueSeenAt>700) lastValue=''; return false; }
      lastValueSeenAt=now;
      if(now<nextDetectionAt||value===lastValue) return false;
      if(!continuous){ controls?.stop?.(); closeMobileCameraScanner(); onCode(value); return true; }
      lastValue=value;
      nextDetectionAt=now+650;
      const accepted=onCode(value)!==false;
      if(navigator.vibrate) navigator.vibrate(accepted?80:[40,50,40]);
      message.textContent=fixedMessage||(accepted?`สแกนแล้ว: ${value} — ยิงสินค้าชิ้นถัดไปได้เลย`:`ยังไม่เพิ่ม: ${value} — เลื่อนไปยิงสินค้าชิ้นอื่นได้เลย`);
      return true;
    };
    if(!nativeDetectorAvailable){
      const reader=new zxing.BrowserMultiFormatReader(undefined,{delayBetweenScanAttempts:100,delayBetweenScanSuccess:250});
      session.decoderControls=await reader.decodeFromVideoElement(video,(result,error,controls)=>{
        if(session.closed||mobileCameraSession!==session){ controls?.stop?.(); return; }
        if(result) handleValue(typeof result.getText==='function'?result.getText():result.text,controls);
        else if(lastValue&&Date.now()-lastValueSeenAt>700) lastValue='';
        if(error&&!/NotFoundException|ChecksumException|FormatException/.test(String(error.name||error.constructor?.name||''))&&!session.scanErrorNotified){
          session.scanErrorNotified=true;
          console.warn('ตัวอ่านบาร์โค้ดสำรองมีปัญหา',error);
        }
      });
      return true;
    }
    const desiredFormats=['code_128','ean_13','ean_8','upc_a','upc_e','code_39','itf','codabar','qr_code'];
    const supportedFormats=typeof BarcodeDetector.getSupportedFormats==='function'?await BarcodeDetector.getSupportedFormats():desiredFormats;
    const formats=desiredFormats.filter(format=>supportedFormats.includes(format));
    const detector=formats.length?new BarcodeDetector({formats}):new BarcodeDetector();
    const scan=async()=>{
      if(session.closed||mobileCameraSession!==session) return;
      if(!busy&&video.readyState>=2){
        busy=true;
        try{
          const codes=await detector.detect(video);
          if(handleValue(codes?.[0]?.rawValue)&&!continuous) return;
        }catch(error){
          console.warn('สแกนบาร์โค้ดจากกล้องไม่สำเร็จ',error);
          if(!session.scanErrorNotified){ session.scanErrorNotified=true; playMobileScanErrorSound(); }
        }
        busy=false;
      }
      requestAnimationFrame(scan);
    };
    requestAnimationFrame(scan);
    return true;
  }catch(error){
    if(mobileCameraSession===session) closeMobileCameraScanner();
    else if(session.stream) session.stream.getTracks().forEach(track=>track.stop());
    console.warn('เปิดกล้องมือถือไม่สำเร็จ',error?.name||error,error?.message||'');
    playMobileScanErrorSound();
    const permissionBlocked=['NotAllowedError','SecurityError','PermissionDeniedError'].includes(String(error?.name||''));
    showToast(permissionBlocked?'กล้องยังไม่ได้รับอนุญาต กรุณาอนุญาต Camera แล้วลองใหม่':'เปิดตัวอ่านบาร์โค้ดไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่','danger-top');
    openMobileBrowserHelp({cameraBlocked:true,errorName:error?.name||''});
    return false;
  }
}
