async function enforceOwnerRecoverySetup(){
  if(!currentProfile?.owner) return false;
  try{
    const result=await callEdgeFunction('admin-users',{action:'recovery-status'});
    ownerRecoverySetupRequired=result.configured!==true;
    if(ownerRecoverySetupRequired) openOwnerRecoverySetupModal();
    return ownerRecoverySetupRequired;
  }catch(error){
    reportClientEvent({category:'security',operation:'recovery_status',message:error?.message||'ตรวจคำถามกู้คืนไม่สำเร็จ'});
    return false;
  }
}
const DATABASE_HEALTH_CHECK_KEY='pepos_database_health_checked_v1';
async function checkOwnerDatabaseHealth({force=false}={}){
  if(!currentProfile?.owner||!sb) return null;
  const now=Date.now(),last=Number(localStorage.getItem(DATABASE_HEALTH_CHECK_KEY))||0;
  if(!force&&now-last<24*60*60*1000) return null;
  try{
    const {data,error}=await sb.rpc('get_owner_database_health');
    if(error){ if(['PGRST202','42883'].includes(String(error.code||''))) return null; throw error; }
    localStorage.setItem(DATABASE_HEALTH_CHECK_KEY,String(now));
    const result=Array.isArray(data)?data[0]:data;
    if(result?.level==='warning'||result?.level==='critical'){
      const used=(Number(result.databaseBytes||0)/1024/1024).toFixed(1);
      showToast(`ฐานข้อมูลใช้พื้นที่ ${used} MB ${result.level==='critical'?'เกินระดับ 250 MB แล้ว':'ถึงระดับเตือน 100 MB แล้ว'} กรุณาสำรองและตรวจพื้นที่`,'danger-top');
    }
    return result;
  }catch(error){ reportClientEvent({category:'monitoring',operation:'database_health',message:error?.message||'ตรวจพื้นที่ฐานข้อมูลไม่สำเร็จ'}); return null; }
}
function openOwnerRecoverySetupModal(){
  document.querySelector('.owner-recovery-setup-overlay')?.remove();
  const overlay=document.createElement('div');
  overlay.className='modal-overlay owner-recovery-setup-overlay';
  overlay.innerHTML=`<form class="modal recovery-dialog" id="ownerRecoverySetupForm" role="dialog" aria-modal="true"><div class="modal-head"><div><h3>ตั้งคำถามกู้คืน Password</h3><div class="sub">เจ้าของร้านต้องตั้งค่าให้เรียบร้อยก่อนใช้งานระบบต่อ</div></div></div><div class="form-grid"><label class="field full"><span>คำถาม *</span><input id="requiredRecoveryQuestion" maxlength="200" placeholder="เช่น ร้านแรกของฉันชื่ออะไร" required></label><label class="field full"><span>คำตอบ *</span><input id="requiredRecoveryAnswer" type="password" maxlength="200" autocomplete="new-password" placeholder="คำตอบจะถูกซ่อนและเข้ารหัส" required></label></div><div class="login-error" id="requiredRecoveryError"></div><div class="modal-actions"><button class="btn ghost" id="requiredRecoveryLogout" type="button">ออกจากระบบ</button><button class="btn primary" type="submit">บันทึกและใช้งานต่อ</button></div></form>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#requiredRecoveryLogout').onclick=()=>logoutSystem();
  overlay.querySelector('form').onsubmit=async event=>{
    event.preventDefault();
    const question=overlay.querySelector('#requiredRecoveryQuestion').value.trim();
    const answer=overlay.querySelector('#requiredRecoveryAnswer').value.trim();
    const errorElement=overlay.querySelector('#requiredRecoveryError');
    const button=overlay.querySelector('button[type="submit"]');
    if(question.length<5||answer.length<4){ errorElement.textContent='กรุณากรอกคำถามอย่างน้อย 5 ตัว และคำตอบอย่างน้อย 4 ตัว'; return; }
    button.disabled=true;
    try{ await callEdgeFunction('admin-users',{action:'save-own-recovery',question,answer}); ownerRecoverySetupRequired=false; overlay.remove(); showToast('ตั้งคำถามกู้คืน Password แล้ว'); }
    catch(error){ errorElement.textContent=error?.message||'บันทึกคำถามกู้คืนไม่สำเร็จ'; button.disabled=false; }
  };
  setTimeout(()=>overlay.querySelector('#requiredRecoveryQuestion')?.focus(),0);
}
function recoverOwnerPassword(){
  document.querySelector('.owner-password-recovery-overlay')?.remove();
  const overlay=document.createElement('div');
  overlay.className='modal-overlay owner-password-recovery-overlay';
  overlay.innerHTML=`<form class="modal recovery-dialog" id="ownerPasswordRecoveryForm" role="dialog" aria-modal="true"><div class="modal-head"><h3>กู้คืน Password เจ้าของร้าน</h3><button class="modal-close" type="button" aria-label="ปิด">×</button></div><div class="form-grid"><label class="field full"><span>ID เจ้าของร้าน</span><input id="recoveryUsername" autocomplete="username" required></label><div class="field full recovery-question-wrap" hidden><span>คำถาม</span><strong id="recoveryQuestionText"></strong></div><label class="field full recovery-reset-field" hidden><span>คำตอบ</span><div class="password-input-wrap"><input id="recoveryAnswer" type="password" autocomplete="off"><button class="password-eye-btn" type="button" data-toggle-password="recoveryAnswer" data-password-label="คำตอบ" aria-label="แสดงคำตอบ" title="แสดงคำตอบ"><svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6a10.5 10.5 0 0 0 5.4-1.4"/></svg></button></div></label><label class="field full recovery-reset-field" hidden><span>Password ใหม่</span><div class="password-input-wrap"><input id="recoveryNewPassword" type="password" autocomplete="new-password" minlength="10"><button class="password-eye-btn" type="button" data-toggle-password="recoveryNewPassword" aria-label="แสดง Password" title="แสดง Password"><svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6a10.5 10.5 0 0 0 5.4-1.4"/></svg></button></div></label><label class="field full recovery-reset-field" hidden><span>ยืนยัน Password ใหม่</span><div class="password-input-wrap"><input id="recoveryPasswordConfirm" type="password" autocomplete="new-password" minlength="10"><button class="password-eye-btn" type="button" data-toggle-password="recoveryPasswordConfirm" aria-label="แสดง Password" title="แสดง Password"><svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6a10.5 10.5 0 0 0 5.4-1.4"/></svg></button></div></label></div><div class="login-error" id="recoveryModalError"></div><div class="modal-actions"><button class="btn ghost recovery-cancel" type="button">ยกเลิก</button><button class="btn primary" id="recoveryContinueButton" type="submit">แสดงคำถาม</button></div></form>`;
  document.body.appendChild(overlay);
  bindPasswordVisibilityToggles(overlay);
  const close=()=>overlay.remove(); overlay.querySelector('.modal-close').onclick=close; overlay.querySelector('.recovery-cancel').onclick=close;
  const form=overlay.querySelector('form'),errorElement=overlay.querySelector('#recoveryModalError'),button=overlay.querySelector('#recoveryContinueButton');
  let questionLoaded=false;
  form.onsubmit=async event=>{
    event.preventDefault(); errorElement.textContent=''; button.disabled=true;
    const username=overlay.querySelector('#recoveryUsername').value.trim();
    try{
      if(!questionLoaded){
        const result=await callEdgeFunction('owner-recovery',{action:'question',username});
        overlay.querySelector('#recoveryQuestionText').textContent=result.question;
        overlay.querySelector('.recovery-question-wrap').hidden=false;
        overlay.querySelectorAll('.recovery-reset-field').forEach(element=>element.hidden=false);
        overlay.querySelector('#recoveryUsername').readOnly=true; questionLoaded=true; button.textContent='ตั้ง Password ใหม่';
        overlay.querySelector('#recoveryAnswer').focus();
      }else{
        const answer=overlay.querySelector('#recoveryAnswer').value.trim(),password=overlay.querySelector('#recoveryNewPassword').value,confirmation=overlay.querySelector('#recoveryPasswordConfirm').value;
        if(password!==confirmation) throw new Error('Password ใหม่ทั้งสองช่องไม่ตรงกัน');
        await callEdgeFunction('owner-recovery',{action:'reset',username,answer,password});
        const loginUser=document.getElementById('loginUserId'); if(loginUser) loginUser.value=username;
        close(); showToast('ตั้ง Password ใหม่สำเร็จแล้ว กรุณาเข้าสู่ระบบ'); document.getElementById('loginPassword')?.focus();
      }
    }catch(error){ errorElement.textContent=error?.message||'กู้คืน Password ไม่สำเร็จ'; }
    finally{ if(overlay.isConnected) button.disabled=false; }
  };
  setTimeout(()=>overlay.querySelector('#recoveryUsername')?.focus(),0);
}
