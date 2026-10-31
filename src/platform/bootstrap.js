applyReceiptPrinterSetupLink();

// คลิกช่องตัวเลขครั้งเดียวแล้วเลือกค่าทั้งหมด เพื่อพิมพ์ค่าใหม่ทับได้ทันที
document.addEventListener('focusin', e=>{
  if(e.target.matches && e.target.matches('input[type="number"]')) setTimeout(()=>{
    if(document.activeElement===e.target&&e.target.isConnected) e.target.select();
  },0);
});
document.addEventListener('mouseup', e=>{
  if(e.target.matches && e.target.matches('input[type="number"]')){ e.preventDefault(); e.target.select(); }
});
document.addEventListener('click', ()=>{
  if(openDocMenu){ openDocMenu=null; render(); }
});
document.addEventListener('pointerdown',event=>{
  const row=event.target.closest?.('[data-pos-cart-line]');
  if(row&&currentTab==='checkout') posActiveLineId=row.dataset.posCartLine;
  if(!event.target.closest?.('#posUnitCycleMenu')) closePosUnitCycleMenu();
});
document.addEventListener('focusin',event=>{
  const row=event.target.closest?.('[data-pos-cart-line]');
  if(row&&currentTab==='checkout') posActiveLineId=row.dataset.posCartLine;
});
window.addEventListener('resize',closePosUnitCycleMenu);
document.addEventListener('scroll',event=>{if(!event.target.closest?.('#posUnitCycleMenu')) closePosUnitCycleMenu();},true);
// F2 = เก็บเงิน (ลัดขั้นตอนแทนการเอื้อมมือไปคลิกปุ่ม) เฉพาะตอนอยู่หน้า POS และมีสินค้าในบิลแล้วเท่านั้น
document.addEventListener('keydown', e=>{
  if(currentTab==='checkout'&&!document.querySelector('.modal-overlay')){
    const target=e.target;
    const typing=target?.matches?.('input,textarea,select,[contenteditable="true"]');
    if(e.key==='CapsLock'&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.isComposing&&(!typing||target?.id==='search'||target?.matches?.('.line-unit,.line-qty'))){
      e.preventDefault();
      if(!e.repeat) cyclePosCartLineUnit(target);
      return;
    }
    if(e.key==='Escape'&&closePosUnitCycleMenu()){
      e.preventDefault();
      return;
    }
    if(e.key==='Enter') closePosUnitCycleMenu();
    if(e.key==='Home'&&!e.repeat&&(!typing||target?.id==='search')){
      e.preventDefault();
      setPosSmallestUnitOnce(!posSmallestUnitOnce);
      return;
    }
    if(e.key==='Escape'&&posSmallestUnitOnce){
      e.preventDefault();
      setPosSmallestUnitOnce(false);
      return;
    }
  }
  if(e.key==='F2' && currentTab==='checkout'){
    e.preventDefault();
    if(e.repeat||document.querySelector('.modal-overlay')) return;
    closePosUnitCycleMenu();
    const btn=document.getElementById('checkoutBtn');
    if(btn && !btn.disabled) btn.click();
  }
});
document.getElementById('loginForm')?.addEventListener('submit',loginSystem);
document.getElementById('recoverOwnerPasswordBtn')?.addEventListener('click',recoverOwnerPassword);
document.getElementById('ownerSetupForm')?.addEventListener('submit',createInitialOwner);
document.getElementById('warehouseChoiceForm')?.addEventListener('submit',event=>{
  event.preventDefault();
  if(!selectActiveWarehouse(document.getElementById('warehouseChoiceSelect')?.value)){
    showToast('ไม่สามารถเลือกคลังสินค้านี้ได้','error');
    return;
  }
  showToast(isAllWarehousesMode()?'กำลังดูข้อมูลทุกคลัง':`กำลังใช้งานคลัง ${activeWarehouse()?.name||''}`);
  render();
});
document.getElementById('warehouseChoiceLogout')?.addEventListener('click',logoutSystem);

sb?.auth.onAuthStateChange((event)=>{
  if(event==='SIGNED_OUT'){document.querySelector('.knowledge-editor-overlay')?.remove();knowledgeState=null;}
  if(event==='SIGNED_OUT'){ document.querySelector('.owner-recovery-setup-overlay')?.remove(); ownerRecoverySetupRequired=false; clearActiveWarehouseSelection(); currentProfile=null; clearLoadedHistoryMemory(); resetRepresentativeManagedProductIndex(); notes=[]; notesLoaded=false; notesLoading=false; notesHasMore=false; noteLoadError=''; noteSearchQuery=''; notePageCursor=null; editingNoteId=null; noteDraft=null; noteDraftDirty=false; activeWarehouseId=0; allWarehousesMode=false; inventoryBalanceRows=[]; inventoryBalanceMap=new Map(); inventoryLotRows=[]; inventoryLotMap=new Map(); resetLoadedInventoryScopes(); renderLoginState(); }
});

let mobileViewportResizeTimer=null;
window.addEventListener('resize',()=>{
  clearTimeout(mobileViewportResizeTimer);
  mobileViewportResizeTimer=setTimeout(()=>{
    if(!loggedInUser()) return;
    const mobileMode=isMobileDeviceMode();
    if(mobileMode!==document.body.classList.contains('mobile-device-mode')) render();
    else refreshScrollableTableHeights();
  },180);
});
document.addEventListener('visibilitychange',()=>scheduleSalesViewRefresh());

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  deferredPwaInstallPrompt=event;
  if(currentTab==='mobiletools'&&loggedInUser()) render();
});
window.addEventListener('appinstalled',()=>{
  deferredPwaInstallPrompt=null;
  showToast('ติดตั้ง PEPOS เรียบร้อยแล้ว');
  if(currentTab==='mobiletools'&&loggedInUser()) render();
});

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(error=>console.warn('ลงทะเบียนโหมดติดตั้งบนมือถือไม่สำเร็จ',error)));
}

function refreshMobileToolsOnResume(){
  if(mobileProductEditor||mobileProductOpening) return false;
  if(document.visibilityState==='hidden'||currentTab!=='mobiletools'||!loggedInUser()||!mobileIsOnline()) return false;
  if(Date.now()-mobileLastRefreshAt<30000) return false;
  refreshMobileToolsData(null,{silent:true});
  return true;
}
window.addEventListener('online',()=>{
  setSyncUiState('syncing');
  void syncOfflineSales();
  if(loggedInUser()){ flushPendingClientEvents(); syncCoreDataToSupabase(); }
  setMobileDataStatus('online','กลับมาออนไลน์แล้ว');
  if(currentTab==='mobiletools'){ render(); refreshMobileToolsOnResume(); }
});
window.addEventListener('offline',()=>{
  setSyncUiState('offline');
  setMobileDataStatus('offline');
  if(currentTab==='mobiletools') render();
  const banner=document.getElementById('offlinePosBanner');if(banner) banner.innerHTML=offlinePosBanner();
});
window.addEventListener('focus',()=>{void syncOfflineSales();});
window.addEventListener('focus',refreshMobileToolsOnResume);
// Only active product lists query review colors; other pages and hidden tabs do no work.
window.addEventListener('focus',()=>{ void refreshProductReviewColors(); scheduleProductReviewRefresh(); });
document.addEventListener('visibilitychange',()=>{ scheduleProductReviewRefresh(); if(document.visibilityState==='visible') void refreshProductReviewColors(); });
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') refreshMobileToolsOnResume(); });

let runtimeErrorNoticeShown=false;
function notifyRuntimeError(message,error){
  console.error(message,error||'');
  reportClientEvent({severity:'fatal',category:'runtime',operation:'browser_runtime',errorCode:error?.code||'',message:error?.message||String(error||message),context:{tab:currentTab}});
  if(runtimeErrorNoticeShown) return;
  runtimeErrorNoticeShown=true;
  setTimeout(()=>showToast(message,'error'),0);
}
window.addEventListener('unhandledrejection',event=>notifyRuntimeError('ระบบเชื่อมต่อขัดข้อง กรุณารีเฟรชแล้วลองอีกครั้ง',event.reason));
window.addEventListener('error',event=>notifyRuntimeError('โปรแกรมทำงานผิดพลาด กรุณารีเฟรชแล้วลองอีกครั้ง',event.error||event.message));

window.peposBootstrapReady=(async function bootstrapAuth(){
  if(!sb){
    const message=window.__peposDependencyError||'ไม่สามารถโหลดระบบฐานข้อมูล';
    const error=document.getElementById('loginError');
    if(error) error.textContent=message+' กรุณาตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้าเว็บ';
    return;
  }
  await loadProductCacheFromIndexedDB();
  if(productCacheStartupBlocked) return;
  try{if(navigator.onLine&&await resumeOfflineQueue()){void syncOfflineSales();return;}}
  catch(error){console.warn('restore pending offline receipts',error);}
  if(!navigator.onLine){
    try{await enterOfflinePos({restore:true});}
    catch(error){const el=document.getElementById('loginError');if(el) el.textContent=error.message;}
    renderLoginState();return;
  }
  try{
    const { data:ownerCheck, error:ownerErr } = await sb.rpc('has_any_owner');
    systemHasOwner = ownerErr ? true : !!ownerCheck; // default to "true" (login screen) if the check itself fails
  }catch(e){ systemHasOwner = true; }
  try{ await loadCurrentProfile(); }catch(e){ currentProfile=null; }
  if(currentProfile&&isMobileDeviceMode()) prepareMobileLandingPage();
  if(currentProfile){ try{ await loadWorkspaceFromSupabase(); }catch(e){ console.warn('load core data on boot failed',e); } }
  if(currentProfile){try{await loadOfflineSales();await saveOfflinePosSnapshot();}catch(e){console.warn('offline cache',e);}void syncOfflineSales();}
  render();
  if(currentProfile){ flushPendingClientEvents(); await enforceOwnerRecoverySetup(); checkOwnerDatabaseHealth(); }
})();
