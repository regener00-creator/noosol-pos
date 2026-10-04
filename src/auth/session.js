function loggedInUser(){ return currentProfile; }
function isLevel2User(user=loggedInUser()){ return Number(user?.level)===2; }
const LEVEL2_HIDDEN_TABS=new Set(['settingssystem','settingsbusiness','rprofit','rtax','warehouse','transfer','stockcontrol','barcodeprint','promotions','purchaseorder','productexchange','contacts','salesreps','representativehistory','taxinvoice','quotation','productreturn']);
const ALL_WAREHOUSES_TABS=new Set(['dashboard','inventorymovement','rinventory','lowstock','expiry','rproduct','rbill','rprofit','rtax','auditlog','representativehistory','settingsprinter']);
function canAccessTab(tab,user=loggedInUser()){
  if(!user) return false;
  if(isAllWarehousesMode()&&!ALL_WAREHOUSES_TABS.has(tab)) return false;
  if((tab==='settingsusers'||tab==='auditlog')&&user.owner!==true) return false;
  // Device-only receipt layout: staff who can open POS may configure their own printer.
  if(tab==='settingsprinter') return canPerformPageAction('view','checkout',user);
  if(tab==='stockcontrol') return canPerformPageAction('view','inspectionlists',user);
  if(tab==='representativehistory'&&Number(user.level)===2){
    return canPerformPageAction('view','salesreps',user)&&canPerformPageAction('view','notes',user);
  }
  return canPerformPageAction('view',tab,user);
}
function focusLoginFieldIfIdle(id){
  setTimeout(()=>{
    const active=document.activeElement;
    if(active?.closest?.('#loginForm,#ownerSetupForm')) return;
    document.getElementById(id)?.focus();
  },0);
}
function renderLoginState(){
  const user=loggedInUser();
  const hasUsers=systemHasOwner!==false; // default to "yes" until proven otherwise, avoids a flash of the setup screen
  const ownerSetupScreen=document.getElementById('ownerSetupScreen');
  const loginScreen=document.getElementById('loginScreen');
  const warehouseChoiceScreen=document.getElementById('warehouseChoiceScreen');
  const appRoot=document.getElementById('appRoot');
  const allowed=user?accessibleWarehouses():[];
  const warehouseReady=!!user&&(isAllWarehousesMode()||allowed.some(warehouse=>Number(warehouse.id)===Number(activeWarehouseId)));
  if(ownerSetupScreen) ownerSetupScreen.style.display=hasUsers?'none':'flex';
  if(loginScreen) loginScreen.style.display=hasUsers&&!user?'flex':'none';
  if(warehouseChoiceScreen) warehouseChoiceScreen.style.display=hasUsers&&!!user&&!warehouseReady?'flex':'none';
  if(appRoot) appRoot.hidden=!warehouseReady;
  if(!hasUsers){ focusLoginFieldIfIdle('setupOwnerId'); return false; }
  if(!user){ focusLoginFieldIfIdle('loginUserId'); return false; }
  if(!warehouseReady){
    const select=document.getElementById('warehouseChoiceSelect');
    if(select){
      const allOption=canUseAllWarehousesMode()?'<option value="all">ทุกคลัง — ดูรายงานภาพรวม</option>':'';
      select.innerHTML=allowed.length?allOption+allowed.map(warehouse=>`<option value="${warehouse.id}">${escapeHtml(warehouse.name)}</option>`).join(''):'<option value="">ยังไม่มีคลังที่ได้รับสิทธิ์</option>';
      select.disabled=!allowed.length;
    }
    return false;
  }
  return true;
}
function requestWarehouseChange(){
  if(readPendingCheckoutRequest()){ showToast('มีรายการชำระที่ยังรอยืนยัน กรุณากดชำระซ้ำให้เสร็จก่อนเปลี่ยนคลัง','danger-top'); return; }
  if(cart.length&&!confirm('มีสินค้าอยู่ในบิล การเปลี่ยนคลังจะล้างบิลปัจจุบัน ยืนยันเปลี่ยนคลังหรือไม่?')) return;
  activeWarehouseId=0; allWarehousesMode=false; cashShifts=[]; currentCashShift=null;
  clearActiveWarehouseSelection();
  render();
}
async function createInitialOwner(event){
  event?.preventDefault();
  if(systemHasOwner){ renderLoginState(); return; }
  const get=id=>(document.getElementById(id)?.value||'').trim();
  const username=get('setupOwnerId');
  const password=get('setupOwnerPassword');
  const passwordConfirm=get('setupOwnerPasswordConfirm');
  const firstName=get('setupOwnerName');
  const phone=get('setupOwnerPhone');
  const error=document.getElementById('ownerSetupError');
  const fail=(message,id)=>{ if(error) error.textContent=message; document.getElementById(id)?.focus(); };
  if(!username) return fail('กรุณากรอก ID เจ้าของร้าน','setupOwnerId');
  if(!/^[A-Za-z0-9._-]+$/.test(username)) return fail('ID ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง','setupOwnerId');
  if(password.length<10||!/[A-Za-z]/.test(password)||!/\d/.test(password)) return fail('Password ต้องมีอย่างน้อย 10 ตัวอักษร และมีทั้งตัวอักษรกับตัวเลข','setupOwnerPassword');
  if(password!==passwordConfirm) return fail('Password และการยืนยันไม่ตรงกัน','setupOwnerPasswordConfirm');
  if(!firstName) return fail('กรุณากรอกชื่อเจ้าของร้าน','setupOwnerName');
  const submitBtn=document.querySelector('#ownerSetupForm button[type="submit"]');
  if(submitBtn) submitBtn.disabled=true;
  try{
    const setupToken=localStorage.getItem(OWNER_BOOTSTRAP_TOKEN_STORAGE_KEY)||'';
    if(!setupToken) throw new Error('เครื่องนี้ไม่มีกุญแจตั้งค่าเจ้าของร้าน กรุณาคืนค่าโรงงานจากเครื่องเจ้าของร้านอีกครั้ง');
    await callEdgeFunction('bootstrap-owner',{username,password,firstName,phone,setupToken});
    localStorage.removeItem(OWNER_BOOTSTRAP_TOKEN_STORAGE_KEY);
  }catch(e){
    if(submitBtn) submitBtn.disabled=false;
    return fail(e.message||'สร้างบัญชีเจ้าของร้านไม่สำเร็จ','setupOwnerId');
  }
  systemHasOwner=true;
  currentUserProfile={firstName,lastName:'',phone,email:'',position:'เจ้าของกิจการ',signatureName:''};
  persistWorkspaceData();
  if(error) error.textContent='';
  const loginUserId=document.getElementById('loginUserId');
  if(loginUserId) loginUserId.value=username;
  const loginPassword=document.getElementById('loginPassword');
  if(loginPassword) loginPassword.value='';
  const loginHint=document.getElementById('loginHint');
  if(loginHint) loginHint.textContent='สร้างบัญชีเจ้าของร้านแล้ว กรุณาเข้าสู่ระบบด้วย ID และ Password ใหม่';
  if(submitBtn) submitBtn.disabled=false;
  renderLoginState();
  setTimeout(()=>loginPassword?.focus(),0);
}
async function loadCurrentProfile(){
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ currentProfile=null; return; }
  const { data, error } = await sb.from('profiles').select('*').eq('id',session.user.id).single();
  if(error||!data){ currentProfile=null; return; }
  currentProfile=mapProfileRow(data);
  resetInventoryReportWarehouseFilters();
  currentUserProfile={...currentUserProfile,firstName:currentProfile.firstName,lastName:currentProfile.lastName,phone:currentProfile.phone};
}
async function loginSystem(event){
  if(productCacheStartupBlocked){ event?.preventDefault(); showToast('กรุณาปิดแท็บ PEPOS อื่น แล้วรีเฟรชหน้านี้เพื่อโหลดข้อมูลค้างส่งอย่างปลอดภัย','danger-top'); return; }
  event?.preventDefault();
  const username=(document.getElementById('loginUserId')?.value||'').trim().toLowerCase();
  const password=document.getElementById('loginPassword')?.value||'';
  const error=document.getElementById('loginError');
  const submitBtn=document.querySelector('.login-submit');
  if(!username||!password){ if(error) error.textContent='กรุณากรอก ID และ Password'; return; }
  if(submitBtn) submitBtn.disabled=true;
  const { error:authError } = await sb.auth.signInWithPassword({ email:noosolAuthEmail(username), password });
  if(authError){
    if(submitBtn) submitBtn.disabled=false;
    if(error) error.textContent='ID หรือ Password ไม่ถูกต้อง';
    return;
  }
  await loadCurrentProfile();
  if(submitBtn) submitBtn.disabled=false;
  if(!currentProfile){
    await sb.auth.signOut();
    if(error) error.textContent='ไม่พบข้อมูลผู้ใช้งานนี้ในระบบ กรุณาติดต่อเจ้าของร้าน';
    return;
  }
  if(isMobileDeviceMode()) prepareMobileLandingPage();
  if(error) error.textContent='';
  await loadWorkspaceFromSupabase();
  render();
  await enforceOwnerRecoverySetup();
  checkOwnerDatabaseHealth();
}
async function logoutSystem(){
  if(currentWorkspacePendingChanges().length||workspaceCacheSaveFailed||productDirtyOperations.size){
    showToast('ยังมีข้อมูลรอซิงก์ กรุณาตรวจรายละเอียดการซิงก์ก่อนออกจากระบบ','danger-top');
    openSyncDetailsModal(); return false;
  }
  const pendingRequest=readPendingCheckoutRequest();
  if(pendingRequest){
    restorePendingCheckoutUi(pendingRequest);
    showToast('ยังออกจากระบบไม่ได้ เพราะมีรายการชำระที่รอยืนยัน กรุณากดชำระซ้ำก่อน','danger-top');
    render();
    return false;
  }
  clearActiveWarehouseSelection();
  await sb.auth.signOut();
  currentProfile=null;
  clearLoadedHistoryMemory();
  resetRepresentativeManagedProductIndex();
  notes=[]; notesLoaded=false; notesLoading=false; notesHasMore=false; noteLoadError=''; editingNoteId=null; noteDraft=null; noteDraftDirty=false; noteSearchQuery=''; notePageCursor=null;
  activeWarehouseId=0; allWarehousesMode=false; warehouseAccessRows=[]; pagePermissionRows=[]; inventoryBalanceRows=[]; inventoryBalanceMap=new Map(); inventoryLotRows=[]; inventoryLotMap=new Map(); resetLoadedInventoryScopes(); cashShifts=[]; currentCashShift=null;
  systemUsers=[]; systemUsersLoaded=false;
  const password=document.getElementById('loginPassword'); if(password) password.value='';
  renderLoginState();
  return true;
}
async function loadSystemUsersFromServer(){
  if(systemUsersLoading) return;
  systemUsersLoading=true;
  try{
    const result=await callEdgeFunction('admin-users',{action:'list'});
    systemUsers=(result.users||[]).map(u=>({id:u.id,username:u.username,firstName:u.first_name||'',phone:u.phone||'',note:u.note||'',owner:!!u.owner,level:Number(u.level)||2,recoveryQuestion:u.recoveryQuestion||'',hasRecoveryAnswer:u.hasRecoveryAnswer===true,warehouseIds:[...new Set((Array.isArray(u.warehouseIds)?u.warehouseIds:Array.isArray(u.warehouse_ids)?u.warehouse_ids:[]).map(Number).filter(id=>Number.isInteger(id)&&id>0))],pagePermissions:Array.isArray(u.pagePermissions)?u.pagePermissions:[]}));
    systemUsersLoaded=true;
  }catch(e){
    showToast('โหลดรายชื่อผู้ใช้งานไม่สำเร็จ: '+(e.message||''));
  }
  systemUsersLoading=false;
  render();
}
