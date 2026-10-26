function renderProductCategorySettings(){
  const settings=effectiveProductCategorySettings();
  const ready=productCategorySettingsLoaded&&!productCategorySettingsLoading&&!productCategorySettingsError;
  const buttons=(kind,name)=>`<div style="display:flex;gap:8px"><button type="button" class="btn ghost small" data-category-edit="${kind}" data-name="${escapeHtml(name)}" ${ready?'':'disabled'}>แก้ไข</button><button type="button" class="btn ghost small" data-category-delete="${kind}" data-name="${escapeHtml(name)}" ${ready?'':'disabled'}>ลบ</button></div>`;
  return `<div class="pagehead"><h1>ตั้งค่าหมวดสินค้า</h1><button type="button" class="btn ghost" id="reloadProductCategories" ${productCategorySettingsLoading?'disabled':''}>โหลดข้อมูลล่าสุด</button></div>
    <p class="hint">สินค้าแต่ละรายการต้องเลือกหมวดหลัก ส่วนหมวดย่อยไม่บังคับ หากไม่เลือกจะอยู่ใน “ทั่วไป” ของหมวดหลักนั้น</p>
    ${productCategorySettingsError?`<p role="alert" class="hint">${escapeHtml(productCategorySettingsError)}</p>`:''}
    ${productCategorySettingsLoading?'<p role="status">กำลังโหลดหมวดสินค้า...</p>':''}
    <div class="panel"><div class="paneltoggle"><h3>หมวดสินค้าหลัก</h3><button type="button" class="btn primary" data-category-edit="main" data-name="" ${ready?'':'disabled'}>+ เพิ่มหมวดหลัก</button></div>
      <div class="manage-list product-category-grid-list">${settings.categories.map(name=>`<div class="manage-item"><span>${escapeHtml(name)}</span>${buttons('main',name)}</div>`).join('')||'<p class="hint">ยังไม่มีหมวดหลัก กดเพิ่มหมวดหลักเพื่อเริ่มใช้งาน</p>'}</div></div>
    <div class="panel"><div class="paneltoggle"><h3>หมวดสินค้าย่อย</h3><button type="button" class="btn primary" data-category-edit="sub" data-name="" ${ready&&settings.categories.length?'':'disabled'}>+ เพิ่มหมวดย่อย</button></div>
      <p class="hint">เลือกหมวดหลักที่ต้องการให้ใช้หมวดย่อยนี้ได้มากกว่าหนึ่งหมวด เช่น BLACKMORES ใช้ได้ทั้งยาและอาหารเสริม</p>
      <div class="manage-list product-category-grid-list"><div class="manage-item"><span><b>ทั่วไป</b><br><small>มีในทุกหมวดหลักโดยอัตโนมัติ</small></span></div>${settings.subcategories.map(row=>`<div class="manage-item"><span><b>${escapeHtml(row.name)}</b><br><small>${escapeHtml(row.categories.join(' · ')||'ยังไม่ได้เลือกหมวดหลัก')}</small></span>${buttons('sub',row.name)}</div>`).join('')}</div>
    </div>`;
}
function categorySettingsInUse(kind,name,cat=null){
  return products.some(product=>kind==='main'?categoryName(product.category)===name:categoryName(product.brand)===name&&(cat===null||categoryName(product.category)===cat));
}
function attachProductCategorySettingsEvents(){
  if(currentTab!=='settingscategories'||currentProfile?.owner!==true) return;
  const reload=async()=>{
    const pending=loadProductCategorySettingsFromSupabase();
    render();
    await pending;
    if(currentTab==='settingscategories') render();
  };
  document.getElementById('reloadProductCategories')?.addEventListener('click',reload);
  document.querySelectorAll('[data-category-edit]').forEach(button=>button.addEventListener('click',()=>openProductCategoryDialog(button.dataset.categoryEdit,button.dataset.name)));
  document.querySelectorAll('[data-category-delete]').forEach(button=>button.addEventListener('click',async()=>{
    const kind=button.dataset.categoryDelete,name=button.dataset.name;
    if(categorySettingsInUse(kind,name)){ showToast('ยังมีสินค้าใช้หมวดนี้อยู่ กรุณาย้ายสินค้าก่อนลบ','danger'); return; }
    if(!confirm(`ลบหมวด${kind==='main'?'หลัก':'ย่อย'} “${name}” หรือไม่?`)) return;
    const next=effectiveProductCategorySettings();
    if(kind==='main'){
      next.categories=next.categories.filter(cat=>cat!==name);
      next.subcategories.forEach(row=>{ row.categories=row.categories.filter(cat=>cat!==name); });
    }else next.subcategories=next.subcategories.filter(row=>row.name!==name);
    button.disabled=true;
    try{ await saveProductCategorySettings(next); showToast('ลบหมวดสินค้าแล้ว'); if(currentTab==='settingscategories') render(); }
    catch(error){ showToast('บันทึกไม่สำเร็จ: '+error.message,'danger'); button.disabled=false; }
  }));
  if(!productCategorySettingsLoaded&&!productCategorySettingsLoading&&!productCategorySettingsError) reload();
}
function openProductCategoryDialog(kind,originalName=''){
  if(currentProfile?.owner!==true||!productCategorySettingsLoaded) return;
  const settings=effectiveProductCategorySettings();
  const existing=settings.subcategories.find(row=>row.name===originalName);
  const inUse=!!originalName&&categorySettingsInUse(kind,originalName);
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="categoryDialogTitle">
    <div class="modal-head"><h3 id="categoryDialogTitle">${originalName?'แก้ไข':'เพิ่ม'}หมวด${kind==='main'?'หลัก':'ย่อย'}</h3><button type="button" class="modal-close" aria-label="ปิด">×</button></div>
    <form id="categorySettingsForm" style="padding:0 18px 18px;overflow:auto"><div class="field"><label for="categorySettingsName">ชื่อหมวด${kind==='main'?'หลัก':'ย่อย'}</label><input id="categorySettingsName" required maxlength="120" value="${escapeHtml(originalName)}" ${inUse?'readonly':''}></div>
    ${inUse?'<p class="hint">ชื่อนี้มีสินค้าใช้อยู่ หากต้องการเปลี่ยนชื่อ ให้สร้างหมวดใหม่แล้วย้ายสินค้าไปก่อน</p>':''}
    ${kind==='sub'?`<p>ใช้ในหมวดหลัก <small>(เลือกได้หลายหมวด)</small></p><div style="display:grid;gap:12px;max-height:40vh;overflow:auto;padding:8px 0">${settings.categories.map(cat=>{
      const used=!!originalName&&categorySettingsInUse('sub',originalName,cat);
      return `<label style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="categoryParent" value="${escapeHtml(cat)}" ${existing?.categories.includes(cat)?'checked':''} ${used?'disabled':''}>${escapeHtml(cat)}${used?' <small>(มีสินค้าใช้อยู่)</small>':''}</label>`;
    }).join('')}</div>`:''}
    <p id="categorySettingsFeedback" role="alert"></p><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button type="button" class="btn ghost" id="cancelCategorySettings">ยกเลิก</button><button type="submit" class="btn primary" id="saveCategorySettings">บันทึก</button></div></form></div>`;
  document.body.appendChild(overlay);
  let saving=false;
  const close=()=>{ if(!saving) overlay.remove(); };
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#cancelCategorySettings').onclick=close;
  overlay.addEventListener('keydown',event=>{ if(event.key==='Escape') close(); });
  overlay.querySelector('#categorySettingsName').focus();
  overlay.querySelector('form').onsubmit=async event=>{
    event.preventDefault(); if(saving) return;
    const feedback=overlay.querySelector('#categorySettingsFeedback');
    const name=categoryName(overlay.querySelector('#categorySettingsName').value);
    const next=effectiveProductCategorySettings();
    const names=kind==='main'?next.categories:next.subcategories.map(row=>row.name);
    if(!name||name.length>120||name.startsWith('__')||name==='ไม่ทราบหมวดหมู่'||(kind==='sub'&&name==='ทั่วไป')){ feedback.textContent='กรุณาระบุชื่อหมวดใหม่ที่ถูกต้อง'; return; }
    if(names.some(other=>other!==originalName&&other.toLocaleLowerCase('th')===name.toLocaleLowerCase('th'))){ feedback.textContent='มีชื่อหมวดนี้อยู่แล้ว'; return; }
    if(inUse&&name!==originalName){ feedback.textContent='หมวดนี้มีสินค้าใช้อยู่ จึงยังเปลี่ยนชื่อไม่ได้'; return; }
    if(kind==='main'){
      next.categories=originalName?next.categories.map(cat=>cat===originalName?name:cat):[...next.categories,name];
      next.subcategories.forEach(row=>{ row.categories=row.categories.map(cat=>cat===originalName?name:cat); });
    }else{
      const parents=Array.from(overlay.querySelectorAll('[name="categoryParent"]:checked')).map(input=>input.value);
      if(!parents.length){ feedback.textContent='กรุณาเลือกหมวดหลักอย่างน้อยหนึ่งหมวด'; return; }
      next.subcategories=next.subcategories.filter(row=>row.name!==originalName);
      next.subcategories.push({name,categories:parents});
    }
    saving=true; feedback.textContent='กำลังบันทึก...';
    overlay.querySelector('#saveCategorySettings').disabled=true;
    try{
      await saveProductCategorySettings(next);
      overlay.remove(); showToast('บันทึกหมวดสินค้าแล้ว');
      if(currentTab==='settingscategories') render();
    }catch(error){
      feedback.textContent='บันทึกไม่สำเร็จ: '+error.message+' กรุณาลองใหม่';
      overlay.querySelector('#saveCategorySettings').disabled=false;
    }finally{ saving=false; }
  };
}
