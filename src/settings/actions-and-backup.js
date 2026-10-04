async function saveBusinessSettings(){
  const get=id=>(document.getElementById(id)?.value||'').trim();
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
  applyBusinessSettings({type:get('set_business_type'),vat,vatRegistrationDate,name:get('set_business_name'),address:get('set_business_address'),taxId,branch,branchCode:get('set_business_branch_code'),branchName:get('set_business_branch_name'),officePhone:get('set_business_office'),mobile:get('set_business_mobile'),fax:get('set_business_fax'),line:get('set_business_line'),website:get('set_business_website'),documentPhone:get('set_business_document_phone')==='office'?'office':'mobile',english:businessSettings.english||false});
  persistWorkspaceData(); // localStorage now, Supabase after the usual debounce
  businessSettingsDirty=false;
  businessSettingsSyncState='syncing';
  render();
  const synced=await syncBusinessSettingsToSupabase();
  showToast(synced?'บันทึกและซิงก์ข้อมูลธุรกิจแล้ว':'บันทึกในเครื่องแล้ว แต่ซิงก์ Supabase ไม่สำเร็จ',synced?'':'danger');
  render();
}

function saveDocumentPrefixes(){
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
  documentPrefixes={...next};
  saleRef=nextSaleRef();
  persistWorkspaceData();
  syncDocumentPrefixesToSupabase();
  showToast('บันทึกรหัสนำหน้าเอกสารแล้ว เอกสารใหม่จะใช้รหัสที่ตั้งไว้');
  render();
}

async function storeBackupDataSnapshot(){
  // The entire store comes from one server-side MVCC snapshot, never stale
  // device caches or the currently loaded/paginated history windows.
  const {data:payload,error}=await sb.rpc('export_store_backup');
  if(error) throw error;
  validateStoreBackupPayload(payload);
  return payload;
}

function storeBackupFileName(){
  const now=new Date(),pad=value=>String(value).padStart(2,'0');
  return `PEPOS-backup-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

async function downloadStoreBackup(){
  if(loggedInUser()?.owner!==true){ showToast('เฉพาะเจ้าของร้านเท่านั้นที่สามารถสำรองข้อมูลได้'); return; }
  const button=document.getElementById('downloadStoreBackupBtn');
  const oldLabel=button?.textContent||'ดาวน์โหลดไฟล์สำรอง';
  if(button){ button.disabled=true; button.textContent='กำลังเตรียมไฟล์...'; }
  try{
    const payload=await storeBackupDataSnapshot();
    const createdAt=payload.createdAt;
    // Unsent work is preserved separately and is never applied by restore.
    payload.pendingDeviceWork={workspace:cloneSyncRecords(currentWorkspacePendingChanges()),products:products.filter(p=>productDirtyOperations.has(String(p.id))),productOperations:[...productDirtyOperations]};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=storeBackupFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    localStorage.setItem(STORE_BACKUP_LAST_KEY,createdAt);
    showToast('ดาวน์โหลดไฟล์สำรองข้อมูลร้านแล้ว');
    render();
  }catch(error){
    console.error('สำรองข้อมูลร้านไม่สำเร็จ',error);
    showToast('สร้างไฟล์สำรองไม่สำเร็จ กรุณาลองอีกครั้ง','danger');
    if(button){ button.disabled=false; button.textContent=oldLabel; }
  }
}

async function submitStoreReset(event){
  event?.preventDefault();
  if(loggedInUser()?.owner!==true||!storeResetMode){ showToast('เฉพาะเจ้าของร้านเท่านั้นที่สามารถรีเซ็ตข้อมูลได้','danger'); return; }
  const mode=storeResetMode,config=storeResetConfig(mode);
  const password=document.getElementById('storeResetPassword')?.value||'';
  const phrase=(document.getElementById('storeResetPhrase')?.value||'').trim();
  const backupConfirmed=document.getElementById('storeResetBackupConfirmed')?.checked===true;
  if(!password){ showToast('กรุณากรอกรหัสผ่านเจ้าของร้าน','danger'); document.getElementById('storeResetPassword')?.focus(); return; }
  if(phrase!==config.phrase){ showToast(`กรุณาพิมพ์ “${config.phrase}” ให้ถูกต้อง`,'danger'); document.getElementById('storeResetPhrase')?.focus(); return; }
  if(!backupConfirmed){ showToast('กรุณายืนยันว่าได้ดาวน์โหลดไฟล์สำรองแล้ว','danger'); return; }
  const button=document.getElementById('confirmStoreResetBtn');
  if(button){ button.disabled=true; button.textContent='กำลังรีเซ็ตข้อมูล...'; }
  try{
    const response=await callEdgeFunction('admin-users',{action:'reset-store',mode,password,phrase});
    const bootstrapToken=String(response?.reset?.bootstrapToken||'');
    if(mode==='factory'&&!bootstrapToken) throw new Error('ระบบไม่ได้รับกุญแจตั้งค่าเจ้าของร้าน กรุณาติดต่อผู้ดูแลระบบก่อนปิดหน้านี้');
    await clearLocalStoreCachesForReset();
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

function validateStoreBackupPayload(payload){
  if(!payload||typeof payload!=='object'||payload.format!==STORE_BACKUP_FORMAT) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของ PEPOS');
  if(Number(payload.version)!==STORE_BACKUP_VERSION) throw new Error('ต้องใช้ไฟล์สำรองครบถ้วนเวอร์ชัน 3 ไฟล์เก่าไม่ครอบคลุมกะ NOTE และสต๊อกนอก LOT กรุณาเก็บไฟล์เดิมไว้และติดต่อผู้ดูแลหากต้องกู้คืน');
  const data=payload.data;
  if(!data||typeof data!=='object') throw new Error('ไม่พบข้อมูลร้านในไฟล์สำรอง');
  const required=['public.products','public.warehouses','public.contacts','public.sales','public.sale_items','public.cash_shifts','public.inventory_balances','public.inventory_lots','public.inventory_lot_movements','public.notes','public.representative_activity_items','public.sales_representative_products','public.profile_warehouse_access','public.profile_page_permissions','private.operation_ledger'];
  if(!data.tables||!payload.manifest||required.some(key=>!Array.isArray(data.tables[key]))) throw new Error('ข้อมูลในไฟล์สำรองไม่ครบถ้วน');
  if(Object.entries(data.tables).some(([key,rows])=>!Array.isArray(rows)||Number(payload.manifest[key]?.rows)!==rows.length||!/^[a-f0-9]{32}$/.test(payload.manifest[key]?.md5||''))) throw new Error('รายการตรวจสอบไฟล์สำรองไม่ครบถ้วน');
  return cloudClean(data);
}

async function restoreStoreBackup(file){
  if(loggedInUser()?.owner!==true){ showToast('เฉพาะเจ้าของร้านเท่านั้นที่สามารถกู้คืนข้อมูลได้'); return; }
  if(!file||file.size>100*1024*1024){ showToast('ไฟล์สำรองมีขนาดใหญ่เกินไป','danger'); return; }
  let payload,data;
  try{
    payload=JSON.parse(await file.text());
    data=validateStoreBackupPayload(payload);
  }catch(error){
    console.error('ตรวจไฟล์สำรองไม่สำเร็จ',error);
    showToast(error.message||'อ่านไฟล์สำรองไม่สำเร็จ','danger');
    return;
  }
  const summary=storeBackupSummary(data);
  const backupDate=new Date(payload.createdAt||'');
  const dateText=!Number.isNaN(backupDate.getTime())?backupDate.toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'ไม่ระบุเวลา';
  const warning=`ยืนยันกู้คืนข้อมูลร้านจากไฟล์สำรองหรือไม่?\n\nวันที่สำรอง: ${dateText}\nสินค้า: ${summary.products} รายการ\nLOT: ${summary.lots} รายการ\nการเคลื่อนไหวสต๊อก: ${summary.movements} รายการ\nรายชื่อ: ${summary.contacts} รายการ\nโปรโมชั่น: ${summary.promotions} รายการ\nเอกสารและรายการขาย: ${summary.documents} รายการ\nกะขาย: ${summary.shifts} รายการ\nNOTE: ${summary.notes} รายการ\n\nข้อมูลปัจจุบันในร้านจะถูกแทนที่ด้วยข้อมูลจากไฟล์นี้ ประวัติ AUDIT LOG และการพิมพ์เดิมจะไม่ถูกลบ\nงานรอซิงก์ที่แนบในไฟล์ไม่ถูกนำเข้าขณะกู้คืน กรุณาหยุดใช้งานและซิงก์ทุกเครื่องให้เรียบร้อยก่อนดำเนินการ`;
  if(!confirm(warning)) return;
  try{ localStorage.setItem(RESET_BACKUP_KEY,JSON.stringify(workspaceSnapshot())); }catch(error){ console.warn('ไม่สามารถเก็บข้อมูลก่อนกู้คืนไว้ในอุปกรณ์ได้',error); }
  const button=document.getElementById('restoreStoreBackupBtn');
  if(button){ button.disabled=true; button.textContent='กำลังกู้คืนข้อมูล...'; }
  try{
    const {data:result,error}=await sb.rpc('restore_store_backup_atomic',{p_backup:payload});
    if(error) throw error;
    await clearLocalStoreCachesForReset();
    clearRemoteResetSensitiveMemory();
    maintenanceEpoch=String(result?.epoch||'');
    if(maintenanceEpoch) localStorage.setItem(MAINTENANCE_EPOCH_STORAGE_KEY,maintenanceEpoch);
    await Promise.all([
      loadCoreDataFromSupabase(),loadSalesHistoryFromSupabase(),loadBusinessSettingsFromSupabase(),
      loadDocumentPrefixesFromSupabase(),loadInspectionListsFromSupabase(),loadPromotionsFromSupabase(),loadFavoritesFromSupabase()
    ]);
    await loadCashShiftsFromSupabase();
    refreshDataCounters();
    persistWorkspaceData();
    currentTab='settingssystem';
    showToast('กู้คืนข้อมูลร้านสำเร็จ');
    render();
  }catch(error){
    console.error('กู้คืนข้อมูลร้านไม่สำเร็จ',error);
    showToast('กู้คืนข้อมูลไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล','danger');
    render();
  }
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
