async function saveBusinessSettings(){
  const get=id=>(document.getElementById(id)?.value||'').trim();
  const form=document.getElementById('businessSettingsForm');
  const warehouseId=Number(form?.dataset.warehouseId);
  if(!warehouseId||isAllWarehousesMode()||warehouseId!==activeWarehouseId)return;
  const vat=get('set_business_vat'),taxId=get('set_business_tax').replace(/\D/g,''),selectedBranch=document.querySelector('input[name="set_branch"]:checked')?.value||'none',branch=vat===VAT_REGISTERED_LABEL?selectedBranch:'none';
  const vatDateText=get('set_business_vat_date'),vatRegistrationDate=vatDateText?dmyToISO(vatDateText):'';
  if(taxId&&!/^\d{13}$/.test(taxId)){ showToast('เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก','danger'); document.getElementById('set_business_tax')?.focus(); return; }
  if(vat===VAT_REGISTERED_LABEL){
    if(!get('set_business_name')||!get('set_business_address')){ showToast('กรุณากรอกชื่อและที่อยู่ธุรกิจให้ครบก่อนเปิดใช้ VAT','danger'); return; }
    if(!taxId){ showToast('กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก','danger'); document.getElementById('set_business_tax')?.focus(); return; }
    if(!vatRegistrationDate){ showToast('กรุณากรอกวันที่เริ่มจด VAT ตาม ภ.พ.20 เป็น วัน/เดือน/ปี','danger'); document.getElementById('set_business_vat_date')?.focus(); return; }
    if(!['head','branch'].includes(branch)){ showToast('กรุณาเลือกสำนักงานใหญ่หรือสาขาตาม ภ.พ.20','danger'); return; }
    if(branch==='branch'&&!/^\d{5}$/.test(get('set_business_branch_code'))){ showToast('รหัสสาขาต้องมี 5 หลัก','danger'); document.getElementById('set_business_branch_code')?.focus(); return; }
    if(branch==='branch'&&!get('set_business_branch_name')){ showToast('กรุณากรอกชื่อสาขา','danger'); document.getElementById('set_business_branch_name')?.focus(); return; }
  }
  const documentPhone=document.querySelector('input[name="set_business_document_phone"]:checked')?.value||'mobile';
  const profile=businessDocumentSnapshot({
    ...warehouseBusinessSettings(warehouseId),type:get('set_business_type'),vat,vatRegistrationDate,
    name:get('set_business_name'),address:get('set_business_address'),taxId,branch,
    branchCode:get('set_business_branch_code'),branchName:get('set_business_branch_name'),
    officePhone:get('set_business_office'),mobile:get('set_business_mobile'),line:get('set_business_line'),
    website:get('set_business_website'),documentPhone,
  });
  const button=document.getElementById('saveBusinessSettingsBtn');
  if(button?.disabled)return;
  if(button)button.disabled=true;
  const context=captureWorkspaceRead();
  try{
    const {error}=await sb.rpc('owner_set_setting',{p_key:`business-warehouse:${warehouseId}`,p_value:profile});
    if(error)throw error;
    if(!isWorkspaceReadCurrent(context))return;
    warehouseBusinessProfiles={...warehouseBusinessProfiles,[warehouseId]:{...warehouseBusinessProfiles[warehouseId],...profile}};
    persistWorkspaceData();
    if(form.isConnected && activeWarehouseId===warehouseId){
      businessSettingsDirty=false;
      businessSettingsSyncState='synced';
      businessSettingsLastSyncedAt=new Date().toISOString();
      render();
    }
    showToast(`บันทึกข้อมูลธุรกิจของคลัง ${whName(warehouseId)} แล้ว`);
  }catch(error){
    showToast(error?.message||'บันทึกข้อมูลธุรกิจไม่สำเร็จ กรุณาลองอีกครั้ง','danger');
  }finally{if(button)button.disabled=false;}
}

async function saveDocumentPrefixes(){
  if(!activeWarehouseId||isAllWarehousesMode()||!loggedInUser()?.owner)return;
  const context=captureStoreView();
  if(!documentPrefixesByStore[context.store]){showToast('กรุณาโหลดรหัสนำหน้าเอกสารของร้านนี้ก่อนบันทึก');return;}
  const next={};
  const used=new Map();
  for(const field of DOCUMENT_PREFIX_FIELDS){
    const input=document.getElementById(`doc_prefix_${field.key}`);
    const value=normalizeDocumentPrefix(input?.value,'');
    if(!value){
      showToast(`กรุณากรอกรหัสนำหน้า ${field.label}`);
      input?.focus();
      return;
    }
    if(used.has(value)){
      showToast(`รหัส ${value} ซ้ำกับ ${used.get(value)} กรุณาใช้รหัสที่ไม่ซ้ำกัน`);
      input?.focus();
      return;
    }
    used.set(value,field.label);
    next[field.key]=value;
  }
  try{
    const {error}=await sb.rpc('owner_set_setting',{p_key:storeToolKey('document_prefixes',context.store),p_value:next});
    if(error)throw error;
  }catch(error){showToast(error.message||'บันทึกรหัสนำหน้าไม่สำเร็จ','danger');return;}
  if(!isStoreViewCurrent(context))return;
  documentPrefixesByStore[context.store]=next;selectDocumentPrefixes();
  saleRef=nextSaleRef();
  persistWorkspaceData();
  showToast('บันทึกรหัสนำหน้าเอกสารแล้ว เอกสารใหม่จะใช้รหัสที่ตั้งไว้');
  render();
}

async function storeBackupDataSnapshot(){
  const context=captureStoreView();
  if(!context.store||context.combined)throw new Error('กรุณาเลือกร้านที่จะสำรอง');
  const {data:payload,error}=await sb.rpc('export_store_backup',{p_warehouse_id:context.store});
  if(error)throw error;
  if(!isStoreViewCurrent(context))throw new Error('เปลี่ยนคลังระหว่างดาวน์โหลด กรุณาเลือกไฟล์อีกครั้ง');
  validateStoreBackupPayload(payload,context.store);
  return payload;
}
function storeBackupFileName(name){
  const now=new Date(),pad=value=>String(value).padStart(2,'0');
  const shop=String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-');
  return `PEPOS-backup-${shop}-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}
function pendingWorkForShop(id){
  const workspace=currentWorkspacePendingChanges().filter(entry=>{
    const row=entry.record;
    let baseline=null;
    if(entry.baseline){try{baseline=JSON.parse(entry.baseline);}catch{return false;}}
    const shopOf=value=>Number(value?.warehouse_id||value?.warehouseId||value?.data?.warehouseId||1);
    return (row||baseline)&&(!row||shopOf(row)===id)&&(!baseline||shopOf(baseline)===id);
  });
  const products=completeProductCatalog().filter(p=>Number(p.wh||1)===id&&productDirtyOperations.has(String(p.id)));
  const productIds=new Set(products.map(p=>String(p.id)));
  const productOperations=[...productDirtyOperations].filter(([pid])=>{
    if(productIds.has(String(pid)))return true;
    const previous=syncedTableRows.products?.get(String(pid));
    return previous&&Number(JSON.parse(previous).warehouse_id||1)===id;
  });
  return {workspace,products,productOperations};
}
function requireSyncedShop(id){
  const pending=pendingWorkForShop(id);
  if(pending.workspace.length||pending.productOperations.length||offlinePendingSales().some(s=>Number(s.payload?.warehouseId)===id)||Number(readPendingCheckoutRequest()?.payload?.warehouseId)===id)
    throw new Error('ร้านนี้มีงานรอซิงก์ กรุณาซิงก์ให้สำเร็จก่อนล้างหรือกู้คืนข้อมูล');
}
async function downloadStoreBackup(){
  if(loggedInUser()?.owner!==true||!activeWarehouseId||isAllWarehousesMode())return;
  const button=document.getElementById('downloadStoreBackupBtn');
  if(button){button.disabled=true;button.textContent='กำลังเตรียมไฟล์...';}
  try{
    const payload=await storeBackupDataSnapshot();
    payload.pendingDeviceWork=pendingWorkForShop(Number(payload.warehouseId));
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=storeBackupFileName(payload.warehouseName);
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    localStorage.setItem(STORE_BACKUP_LAST_KEY+':'+payload.warehouseId,payload.createdAt);
    showToast('ดาวน์โหลดไฟล์สำรองของ '+payload.warehouseName+' แล้ว');render();
  }catch(error){showToast(error.message||'สร้างไฟล์สำรองไม่สำเร็จ','danger');if(button){button.disabled=false;button.textContent='ดาวน์โหลดไฟล์สำรอง';}}
}

async function submitStoreReset(event){
  event?.preventDefault();
  if(loggedInUser()?.owner!==true||!storeResetMode){ showToast('เฉพาะเจ้าของร้านเท่านั้นที่สามารถรีเซ็ตข้อมูลได้','danger'); return; }
  const mode=storeResetMode,config=storeResetConfig(mode);
  if(mode==='factory'?!isAllWarehousesMode():!activeWarehouseId||isAllWarehousesMode())return;
  const context=captureStoreView();
  const password=document.getElementById('storeResetPassword')?.value||'';
  const phrase=(document.getElementById('storeResetPhrase')?.value||'').trim();
  const backupConfirmed=document.getElementById('storeResetBackupConfirmed')?.checked===true;
  if(!password){ showToast('กรุณากรอกรหัสผ่านเจ้าของร้าน','danger'); document.getElementById('storeResetPassword')?.focus(); return; }
  if(phrase!==config.phrase){ showToast(`กรุณาพิมพ์ “${config.phrase}” ให้ถูกต้อง`,'danger'); document.getElementById('storeResetPhrase')?.focus(); return; }
  if(!backupConfirmed){ showToast('กรุณายืนยันว่าได้ดาวน์โหลดไฟล์สำรองแล้ว','danger'); return; }
  const button=document.getElementById('confirmStoreResetBtn');
  if(button){ button.disabled=true; button.textContent='กำลังรีเซ็ตข้อมูล...'; }
  try{
    if(mode==='documents')requireSyncedShop(context.store);
    const response=await callEdgeFunction('admin-users',{action:'reset-store',mode,password,phrase,warehouseId:mode==='documents'?context.store:null,allWarehouses:context.combined});
    const bootstrapToken=String(response?.reset?.bootstrapToken||'');
    if(mode==='factory'&&!bootstrapToken) throw new Error('ระบบไม่ได้รับกุญแจตั้งค่าเจ้าของร้าน กรุณาติดต่อผู้ดูแลระบบก่อนปิดหน้านี้');
    if(mode==='factory')await clearLocalStoreCachesForReset();
    if(bootstrapToken) localStorage.setItem(OWNER_BOOTSTRAP_TOKEN_STORAGE_KEY,bootstrapToken);
    storeResetMode=null;
    if(mode==='factory'){
      try{ await sb.auth.signOut({scope:'local'}); }catch(error){}
      alert('คืนค่าโรงงานเรียบร้อยแล้ว โปรแกรมจะเปิดหน้าสร้าง ID เจ้าของร้านคนแรก');
    }else{
      alert('ล้างเอกสาร LOT และสต๊อกเรียบร้อยแล้ว รายการสินค้ายังคงอยู่และยอดคงเหลือเป็นศูนย์');
    }
    window.location.reload();
  }catch(error){
    console.error('รีเซ็ตข้อมูลร้านไม่สำเร็จ',error);
    showToast(error.message||'รีเซ็ตข้อมูลไม่สำเร็จ กรุณาลองใหม่','danger');
    if(button){ button.disabled=false; button.textContent=config.button; }
  }
}

function validateStoreBackupPayload(payload,warehouseId=activeWarehouseId){
  if(payload?.format!==STORE_BACKUP_FORMAT||![3,STORE_BACKUP_VERSION].includes(payload.version)||!payload.data?.tables||!payload.manifest) throw new Error('ไฟล์สำรองไม่ถูกต้องหรือเก่าเกินกว่าที่รองรับ');
  if(payload.version===3?Number(warehouseId)!==1:Number(payload.warehouseId)!==Number(warehouseId))throw new Error('ไฟล์สำรองเป็นของคนละร้าน');
  for(const key of ['public.products','public.sales','public.contacts','public.notes','public.inventory_lots']){
    if(!Array.isArray(payload.data.tables[key]))throw new Error('ข้อมูลในไฟล์สำรองไม่ครบถ้วน');
  }
  for(const [key,rows] of Object.entries(payload.data.tables)){
    if(!Array.isArray(rows)||Number(payload.manifest[key]?.rows)!==rows.length||!/^[a-f0-9]{32}$/.test(payload.manifest[key]?.md5||''))throw new Error('รายการตรวจสอบไฟล์สำรองไม่ครบถ้วน');
  }
  return payload.data;
}
async function restoreStoreBackup(file){
  if(!loggedInUser()?.owner||!activeWarehouseId||isAllWarehousesMode())return;
  const context=captureStoreView(),shop=activeWarehouse()?.name;
  try{
    if(!file||file.size>100*1024*1024)throw new Error('ไฟล์สำรองมีขนาดใหญ่เกินไป');
    const payload=JSON.parse(await file.text());
    validateStoreBackupPayload(payload,context.store);
    if(!isStoreViewCurrent(context))return;
    requireSyncedShop(context.store);
    const origin=payload.version===3?'ไฟล์เดิมเวอร์ชัน 3 · ใช้เฉพาะข้อมูลพระยาสุเรนทร์':payload.warehouseName;
    const summary=storeBackupSummary(payload.data);
    const counts=payload.version===4?`\nสินค้า ${summary.products} · เอกสาร ${summary.documents} · LOT ${summary.lots} · NOTE ${summary.notes}`:'';
    if(!confirm(`กู้คืนร้าน ${shop} จากไฟล์ของ ${origin} วันที่ ${new Date(payload.createdAt).toLocaleString('th-TH')} หรือไม่?${counts}\n\nข้อมูลร้าน ${shop} จะถูกแทนที่ กรุณาซิงก์และหยุดใช้งานร้านนี้ทุกเครื่องก่อนยืนยัน`))return;
    const button=document.getElementById('restoreStoreBackupBtn');if(button)button.disabled=true;
    const {data,error}=await sb.rpc('restore_store_backup_atomic',{p_warehouse_id:context.store,p_backup:payload});
    if(error)throw error;
    if(!data?.verified||Number(data.warehouseId)!==Number(context.store))throw new Error('ยืนยันผลกู้คืนไม่ได้ กรุณาตรวจข้อมูลก่อนลองใหม่');
    showToast('กู้คืนข้อมูลร้าน '+shop+' แล้ว');window.location.reload();
  }catch(error){showToast(error.message||'กู้คืนข้อมูลไม่สำเร็จ','danger');render();}
}

async function saveUserSettings(){
  const get=id=>(document.getElementById(id)?.value||'').trim();
  const firstName=get('set_user_first'),lastName=get('set_user_last'),phone=get('set_user_phone');
  const saveBtn=document.getElementById('saveUserSettingsBtn');
  if(saveBtn) saveBtn.disabled=true;
  try{
    await callEdgeFunction('admin-users',{action:'self-update',firstName,lastName,phone});
  }catch(e){
    if(saveBtn) saveBtn.disabled=false;
    showToast(e.message||'บันทึกข้อมูลส่วนตัวไม่สำเร็จ');
    return;
  }
  if(saveBtn) saveBtn.disabled=false;
  Object.assign(currentUserProfile,{firstName,lastName,phone});
  if(currentProfile) Object.assign(currentProfile,{firstName,lastName,phone});
  systemUsersLoaded=false; // owner's own row may be shown in ผู้ใช้งานในระบบ, refresh on next visit
  showToast('บันทึกข้อมูลส่วนตัวแล้ว'); render();
}

async function saveSystemUser(){
  if(loggedInUser()?.owner!==true){ showToast('เฉพาะเจ้าของร้านเท่านั้นที่สามารถจัดการผู้ใช้งานได้'); return; }
  const get=id=>(document.getElementById(id)?.value||'').trim();
  const username=get('new_user_id'),firstName=get('new_user_first'),password=get('new_user_password'),passwordConfirm=get('new_user_password_confirm');
  const editingUser=editingSystemUserId!==null?systemUsers.find(user=>String(user.id)===String(editingSystemUserId)):null;
  const recoveryQuestion=editingUser?.owner?get('new_user_recovery_question'):'';
  const recoveryAnswer=editingUser?.owner?get('new_user_recovery_answer'):'';
  if(!username){ showToast('กรุณากรอก ID ผู้ใช้งาน'); document.getElementById('new_user_id').focus(); return; }
  if(!/^[A-Za-z0-9._-]+$/.test(username)){ showToast('ID ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง'); document.getElementById('new_user_id').focus(); return; }
  if(!editingUser&&(password.length<10||!/[A-Za-z]/.test(password)||!/\d/.test(password))){ showToast('รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร และมีทั้งตัวอักษรกับตัวเลข'); document.getElementById('new_user_password').focus(); return; }
  if(editingUser&&password&&(password.length<10||!/[A-Za-z]/.test(password)||!/\d/.test(password))){ showToast('รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร และมีทั้งตัวอักษรกับตัวเลข'); document.getElementById('new_user_password').focus(); return; }
  if(password!==passwordConfirm){ showToast('รหัสผ่านและการยืนยันไม่ตรงกัน'); document.getElementById('new_user_password_confirm').focus(); return; }
  if(!firstName){ showToast('กรุณากรอกชื่อผู้ใช้งาน'); document.getElementById('new_user_first').focus(); return; }
  if(editingUser?.owner&&recoveryQuestion.length<5){ showToast('กรุณากรอกคำถามอย่างน้อย 5 ตัวอักษร'); document.getElementById('new_user_recovery_question').focus(); return; }
  if(editingUser?.owner&&!editingUser.hasRecoveryAnswer&&recoveryAnswer.length<4){ showToast('กรุณากรอกคำตอบอย่างน้อย 4 ตัวอักษร'); document.getElementById('new_user_recovery_answer').focus(); return; }
  if(editingUser?.owner&&recoveryQuestion!==String(editingUser.recoveryQuestion||'').trim()&&!recoveryAnswer){ showToast('เมื่อเปลี่ยนคำถาม กรุณากรอกคำตอบใหม่ด้วย'); document.getElementById('new_user_recovery_answer').focus(); return; }
  if(editingUser?.owner&&recoveryAnswer&&recoveryAnswer.length<4){ showToast('คำตอบต้องมีอย่างน้อย 4 ตัวอักษร'); document.getElementById('new_user_recovery_answer').focus(); return; }
  if(!editingUser&&systemUsers.some(u=>String(u.username||'').toLowerCase()===username.toLowerCase())){ showToast('ID นี้มีอยู่ในระบบแล้ว'); return; }
  const requestedLevel=Number(get('new_user_level'))||2;
  const level=editingUser?.owner?1:Math.min(4,Math.max(2,requestedLevel));
  const phone=get('new_user_phone'),note=get('new_user_note');
  const warehouseIds=[...new Set([...document.querySelectorAll('[data-system-user-warehouse]:checked')].map(input=>Number(input.value)).filter(id=>Number.isInteger(id)&&id>0))];
  if(!editingUser?.owner&&warehouseIds.length===0){ showToast('กรุณาเลือกคลังสินค้าอย่างน้อย 1 คลัง'); document.querySelector('[data-system-user-warehouse]')?.focus(); return; }
  const pagePermissions=editingUser?.owner?[]:[...document.querySelectorAll('[data-system-user-permission-row]')].map(row=>{
    const getAction=action=>row.querySelector(`[data-permission-action="${action}"]`)?.checked===true;
    return {pageKey:String(row.dataset.systemUserPermissionRow||''),warehouseId:null,canView:getAction('canView'),canCreate:getAction('canCreate'),canEdit:getAction('canEdit'),canDelete:getAction('canDelete'),canPrint:getAction('canPrint'),canExport:getAction('canExport')};
  }).filter(permission=>permission.pageKey&&permission.canView);
  if(!editingUser?.owner&&!pagePermissions.some(permission=>permission.pageKey==='dashboard')){ showToast('กรุณาอนุญาตหน้า “ภาพรวม” อย่างน้อย 1 หน้า'); document.querySelector('[data-system-user-permission-row="dashboard"]')?.scrollIntoView({behavior:'smooth',block:'center'}); return; }
  const saveBtn=document.getElementById('saveSystemUserBtn');
  if(saveBtn) saveBtn.disabled=true;
  try{
    if(editingUser){
      await callEdgeFunction('admin-users',{action:'update',id:editingUser.id,password:password||undefined,firstName,phone,note,level,warehouseIds,pagePermissions,...(editingUser.owner?{recoveryQuestion,recoveryAnswer:recoveryAnswer||undefined}:{})});
      if(editingUser.owner) Object.assign(currentUserProfile,{firstName,phone});
    }else{
      await callEdgeFunction('admin-users',{action:'create',username,password,firstName,phone,note,level,warehouseIds,pagePermissions});
    }
  }catch(e){
    if(saveBtn) saveBtn.disabled=false;
    showToast(e.message||'บันทึกผู้ใช้งานไม่สำเร็จ');
    return;
  }
  if(saveBtn) saveBtn.disabled=false;
  persistWorkspaceData();
  const message=editingUser?`แก้ไขผู้ใช้งาน "${username}" แล้ว`:`เพิ่มผู้ใช้งาน "${username}" แล้ว`;
  addingSystemUser=false; editingSystemUserId=null; systemUsersLoaded=false; showToast(message); render();
}

async function deleteSystemUser(id){
  if(loggedInUser()?.owner!==true){ showToast('เฉพาะเจ้าของร้านเท่านั้นที่สามารถลบผู้ใช้งานได้'); return; }
  const user=systemUsers.find(item=>String(item.id)===String(id));
  if(!user) return;
  if(user.owner){ showToast('ไม่สามารถลบผู้ใช้งานหลักของระบบได้'); return; }
  if(!confirm(`ยืนยันลบผู้ใช้งาน "${user.firstName}" (ID: ${user.username}) ออกจากระบบ?`)) return;
  try{
    await callEdgeFunction('admin-users',{action:'delete',id});
  }catch(e){
    showToast(e.message||'ลบผู้ใช้งานไม่สำเร็จ');
    return;
  }
  systemUsersLoaded=false;
  showToast(`ลบผู้ใช้งาน "${user.username}" แล้ว`);
  render();
}
