// Offline receipts are durable, user-scoped requests, never direct sales writes.
// The normal authenticated checkout RPC remains the only server posting path.
const OFFLINE_POS_KEY='offline-pos-v1';
const OFFLINE_SESSION_KEY='pepos_offline_session_v1';
let offlinePosActive=false;
let offlinePosAccount=null;
let offlineSales=[];
let offlineSyncRunning=false;
let offlineSyncMessage='';
let offlineSnapshotReady=false;
let offlineSyncRetryTimer=null;
let offlineInventorySettledIds=new Set();
function offlinePosMode(){ return offlinePosActive||!navigator.onLine; }
async function offlineStoreRead(key){
  const db=await openProductCacheDb();
  return (await idbRequest(db.transaction(PRODUCT_CACHE_META_STORE).objectStore(PRODUCT_CACHE_META_STORE).get(key)))?.value||null;
}
async function offlineStoreWrite(key,value){
  const db=await openProductCacheDb(),tx=db.transaction(PRODUCT_CACHE_META_STORE,'readwrite'),done=idbTransactionDone(tx);
  tx.objectStore(PRODUCT_CACHE_META_STORE).put({key,value});
  await done;
}
async function offlinePasswordHash(password,salt){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:600000},key,256);
  return [...new Uint8Array(bits)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function rememberOfflineLogin(username,password){
  if(!currentProfile||!navigator.onLine) return;
  const salt=crypto.randomUUID();
  offlinePosAccount={actorId:String(currentProfile.id),username,salt,verifier:await offlinePasswordHash(password,salt)};
  await offlineStoreWrite(`${OFFLINE_POS_KEY}:account:${username}`,offlinePosAccount);
  localStorage.setItem(OFFLINE_SESSION_KEY,username);
}
async function saveOfflinePosSnapshot(){
  if(!currentProfile||offlinePosActive||!navigator.onLine||!indexedProductCacheReady||!offlineSnapshotReady) return false;
  const actor=String(currentProfile.id);
  const snapshot=structuredClone({
    actorId:actor,profile:currentProfile,warehouses,products,contacts,promotions,favorites,
    warehouseAccessRows,pagePermissionRows,inventoryBalanceRows,inventoryLotRows,
    businessSettings,documentPrefixes,currentCashShift,cashShifts,activeWarehouseId,
    settledCheckoutIds:[...offlineInventorySettledIds],savedAt:new Date().toISOString()
  });
  await offlineStoreWrite(`${OFFLINE_POS_KEY}:snapshot:${actor}`,snapshot);
  return true;
}
async function loadOfflineSales(){
  if(!currentProfile){offlineSales=[];return;}
  const rows=await offlineStoreRead(`${OFFLINE_POS_KEY}:sales:${currentProfile.id}`);
  offlineSales=Array.isArray(rows)?rows:[];
  mergeOfflineSalesIntoHistory();
  renderSyncStatusChip();
}
function mergeOfflineSalesIntoHistory(){
  const requestIds=new Set(offlineSales.map(row=>row.id));
  salesHistory=salesHistory.filter(sale=>!sale.offlinePending&&!requestIds.has(sale.checkoutRequestId));
  salesHistory=mergeSalesRows(salesHistory,offlineSales.map(row=>row.completedSale||row.localSale));
}
async function enterOfflinePos({username='',password='',restore=false}={}){
  username=String(username||localStorage.getItem(OFFLINE_SESSION_KEY)||'').trim().toLowerCase();
  const account=await offlineStoreRead(`${OFFLINE_POS_KEY}:account:${username}`);
  if(!account||(!restore&&await offlinePasswordHash(password,account.salt)!==account.verifier))
    throw new Error('กรุณาเข้าสู่ระบบด้วยบัญชีนี้ขณะมีอินเทอร์เน็ตบนเครื่องนี้อย่างน้อยหนึ่งครั้ง');
  if(restore&&localStorage.getItem(OFFLINE_SESSION_KEY)!==username) return false;
  const snapshot=await offlineStoreRead(`${OFFLINE_POS_KEY}:snapshot:${account.actorId}`);
  if(!snapshot||snapshot.actorId!==account.actorId) throw new Error('ยังไม่มีข้อมูลพร้อมขายในเครื่อง กรุณาต่ออินเทอร์เน็ตเพื่อเตรียมข้อมูลก่อน');
  offlinePosAccount=account;offlinePosActive=true;systemHasOwner=true;
  currentProfile=snapshot.profile;
  warehouses=snapshot.warehouses;products=snapshot.products;contacts=snapshot.contacts;
  promotions=snapshot.promotions;favorites=snapshot.favorites;
  warehouseAccessRows=snapshot.warehouseAccessRows;pagePermissionRows=snapshot.pagePermissionRows;
  inventoryBalanceRows=snapshot.inventoryBalanceRows;inventoryLotRows=snapshot.inventoryLotRows;
  offlineInventorySettledIds=new Set(snapshot.settledCheckoutIds||[]);
  documentPrefixes=snapshot.documentPrefixes;applyBusinessSettings(snapshot.businessSettings);
  activeWarehouseId=Number(snapshot.activeWarehouseId)||Number(accessibleWarehouses()[0]?.id)||0;allWarehousesMode=false;
  currentCashShift=snapshot.currentCashShift;cashShifts=snapshot.cashShifts||[];
  const localShift=await offlineStoreRead(`${OFFLINE_POS_KEY}:shift:${account.actorId}:${activeWarehouseId}`);
  if(localShift){currentCashShift=localShift;cashShifts=[localShift,...cashShifts.filter(s=>s.id!==localShift.id)];}
  rebuildInventoryBalanceMap();rebuildInventoryLotMap();rebuildProductLookupMaps();refreshCategoryBrandUnitLists();
  await loadOfflineSales();
  applyActiveWarehouseInventory();
  localStorage.setItem(OFFLINE_SESSION_KEY,username);
  currentTab='checkout';render();
  return true;
}
async function resumeOfflineQueue(){
  const username=localStorage.getItem(OFFLINE_SESSION_KEY)||'';
  if(!username) return false;
  const account=await offlineStoreRead(`${OFFLINE_POS_KEY}:account:${username}`);
  if(!account) return false;
  const rows=await offlineStoreRead(`${OFFLINE_POS_KEY}:sales:${account.actorId}`);
  if(!Array.isArray(rows)||!rows.length) return false;
  return enterOfflinePos({username,restore:true});
}
function offlinePendingSales(){return offlineSales.filter(row=>!row.completedSale);}
function offlinePendingStock(productId,warehouseId){
  return offlineSales.filter(row=>!offlineInventorySettledIds.has(row.id)&&Number(row.payload.warehouseId)===Number(warehouseId))
    .reduce((total,row)=>total+row.payload.items.filter(item=>!item.custom&&Number(item.productId)===Number(productId))
      .reduce((sum,item)=>sum+(Number(item.baseQty)||0),0),0);
}
async function editOfflineSales(edit){
  const actor=String(currentProfile?.id||'');
  if(!actor) throw new Error('กรุณาเข้าสู่ระบบก่อน');
  const db=await openProductCacheDb(),tx=db.transaction(PRODUCT_CACHE_META_STORE,'readwrite'),done=idbTransactionDone(tx);
  const store=tx.objectStore(PRODUCT_CACHE_META_STORE),key=`${OFFLINE_POS_KEY}:sales:${actor}`,request=store.get(key);
  let updated;
  request.onsuccess=()=>{
    try{updated=edit(request.result?.value||[]);store.put({key,value:updated});}
    catch(error){tx.abort();}
  };
  await done;
  if(String(currentProfile?.id)===actor){offlineSales=updated;mergeOfflineSalesIntoHistory();renderSyncStatusChip();}
}
async function queueOfflineSale(context){
  if(context.actorId!==String(currentProfile?.id)) throw new Error('บัญชีผู้ขายไม่ตรงกับบิลค้าง');
  if(!canPerformPageAction('create','checkout')||!accessibleWarehouses().some(w=>Number(w.id)===Number(context.payload.warehouseId)))
    throw new Error('ไม่มีสิทธิ์ขายในคลังนี้');
  if(Number(context.payload.sale.loyaltyRedeemed)>0||context.payload.sale.sourceQuotationId)
    throw new Error('การใช้แต้มและขายจากใบเสนอราคาต้องเชื่อมต่ออินเทอร์เน็ต');
  const occurredAt=context.payload.sale.offlineOccurredAt||context.createdAt;
  const date=new Date(occurredAt);
  const localSale={...structuredClone(context.payload.sale),id:`OFF-${context.id}`,ref:`OFF-${context.id}`,
    checkoutRequestId:context.id,offlinePending:true,offlineOccurredAt:occurredAt,
    date:date.toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}),time:date.toISOString(),cashShiftId:currentCashShift?.id,status:'done'};
  // This transaction commits before clearing the active checkout. A crash in
  // between can only replay the same UUID, never mint a second receipt.
  await editOfflineSales(rows=>rows.some(row=>row.id===context.id)?rows:[...rows,{
    ...structuredClone(context),localSale,refPrefix:documentPrefixes.sale,shift:structuredClone(currentCashShift)
  }]);
  offlinePosActive=true;
  await clearCheckoutRequestId(context.id);
  if(readPendingCheckoutRequest()?.id===context.id) throw new Error('บันทึกบิลแล้ว แต่เครื่องยังเตรียมบิลถัดไปไม่ได้ กรุณาตรวจพื้นที่ว่างและลองอีกครั้ง');
  applyActiveWarehouseInventory();
  return offlineSales.find(row=>row.id===context.id)?.localSale||localSale;
}
async function openOfflineCashShift(openingCash){
  if(!canPerformPageAction('create','cashshift')) throw new Error('ไม่มีสิทธิ์เปิดระบบชำระ');
  const shift={id:`OFF-${crypto.randomUUID()}`,shiftNo:'ออฟไลน์',warehouseId:Number(activeWarehouseId),
    openedBy:String(currentProfile.id),openedByName:currentProfile.firstName||'',openedAt:new Date().toISOString(),
    openingCash,status:'open',offline:true};
  await offlineStoreWrite(`${OFFLINE_POS_KEY}:shift:${currentProfile.id}:${activeWarehouseId}`,shift);
  currentCashShift=shift;cashShifts=[shift,...cashShifts];
  const key=`${OFFLINE_POS_KEY}:snapshot:${currentProfile.id}`,snapshot=await offlineStoreRead(key);
  if(snapshot) await offlineStoreWrite(key,{...snapshot,activeWarehouseId,currentCashShift:shift});
}
async function ensureOfflineShiftOnServer(shift,actor){
  if(!shift?.offline) return;
  const warehouseId=Number(shift.warehouseId);
  const {data:shifts,error}=await sb.from('cash_shifts').select('*').eq('warehouse_id',warehouseId).eq('opened_by',actor).eq('status','open');
  if(error) throw error;
  if(!shifts?.length){
    const {error:openError}=await sb.rpc('open_cash_shift',{p_warehouse_id:warehouseId,p_opening_cash:Number(shift.openingCash)||0});
    if(openError) throw openError;
  }
}
function offlinePosBanner(){
  if(!offlinePosMode()&&!offlinePendingSales().length&&!offlineSyncMessage) return '';
  const pending=offlinePendingSales();
  return `<div class="notice" role="status"><b>${offlinePosMode()?'ขายออฟไลน์ · ใช้ข้อมูลล่าสุดที่เก็บในเครื่อง':'บิลขายจากเครื่อง'}</b> · รอซิงก์ ${pending.length} บิล${offlineSyncMessage?`<br>${escapeHtml(offlineSyncMessage)} <button class="btn ghost" type="button" onclick="reauthenticateOfflineSales()">เข้าสู่ระบบเพื่อซิงก์</button>`:''}${pending.length?'<button class="btn ghost" type="button" onclick="openOfflineSalesPanel()">ดูบิลรอซิงก์</button>':''}</div>`;
}
function reauthenticateOfflineSales(){
  const username=offlinePosAccount?.username||currentProfile?.username;
  if(!username) return;
  const overlay=document.createElement('div');overlay.className='modal-overlay';
  overlay.innerHTML=`<section class="modal"><div class="modal-head"><h3>เข้าสู่ระบบเพื่อส่งบิลค้าง</h3><button class="modal-close">×</button></div><form style="padding:18px"><label>รหัสผ่านของ ${escapeHtml(username)} <input type="password" required autocomplete="current-password"></label><p role="alert"></p><button class="btn primary" type="submit">เข้าสู่ระบบและซิงก์</button></form></section>`;
  document.body.appendChild(overlay);overlay.querySelector('.modal-close').onclick=()=>overlay.remove();
  overlay.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const button=overlay.querySelector('[type=submit]');button.disabled=true;
    try{
      const password=overlay.querySelector('input').value;
      const {data,error}=await sb.auth.signInWithPassword({email:noosolAuthEmail(username),password});
      if(error||data?.user?.id!==String(currentProfile?.id)) throw new Error('เข้าสู่ระบบไม่ได้ กรุณาตรวจรหัสผ่านและอินเทอร์เน็ต');
      await rememberOfflineLogin(username,password);overlay.remove();void syncOfflineSales();
    }catch(error){overlay.querySelector('[role=alert]').textContent=error.message;button.disabled=false;}
  };
}
function openOfflineSalesPanel(){
  const overlay=document.createElement('div');overlay.className='modal-overlay';
  overlay.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-label="บิลรอซิงก์"><div class="modal-head"><h3>บิลรอซิงก์ ${offlinePendingSales().length} บิล</h3><button class="modal-close" type="button">×</button></div><div style="padding:18px;max-height:65vh;overflow:auto">${offlinePendingSales().map(row=>`<p><b>${escapeHtml(row.localSale.ref)}</b><br>${fmtMoney(row.localSale.total)} บาท · ${escapeHtml(row.localSale.date)}<br>${escapeHtml(row.error||'บันทึกในเครื่องแล้ว รอส่งเมื่อเชื่อมต่อได้')}</p>`).join('')}<p>เปิดโปรแกรมไว้เมื่ออินเทอร์เน็ตกลับมา ระบบจะส่งบิลให้อัตโนมัติ</p><button class="btn primary" type="button" data-retry>ลองซิงก์อีกครั้ง</button> <button class="btn ghost" type="button" data-export>ดาวน์โหลดสำเนาบิล</button></div></section>`;
  document.body.appendChild(overlay);overlay.querySelector('.modal-close').onclick=()=>overlay.remove();
  overlay.querySelector('[data-retry]').onclick=()=>{overlay.remove();void syncOfflineSales();};
  overlay.querySelector('[data-export]').onclick=()=>{
    const blob=new Blob([JSON.stringify({format:'SAPURI-offline-sales',sales:offlinePendingSales()},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`SAPURI-offline-sales-${currentDateStr()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
}
async function syncOfflineSales(){
  if(offlineSyncRunning||!navigator.onLine||!currentProfile||checkoutInFlight) return;
  offlineSyncRunning=true;
  clearTimeout(offlineSyncRetryTimer);
  const actor=String(currentProfile.id);
  try{
    await loadOfflineSales();
    if(!offlineSales.length&&!offlinePosActive) return;
    const {data,error}=await sb.auth.getUser();
    if(error||data?.user?.id!==actor) throw new Error('กรุณาเข้าสู่ระบบออนไลน์ด้วยบัญชีเดิมเพื่อส่งบิลค้าง');
    // Fetch current privileges before any upload; cached permissions only
    // govern local use. All server RPCs still check current permissions.
    const {data:profile,error:profileError}=await sb.from('profiles').select('*').eq('id',actor).single();
    if(profileError||!profile) throw new Error('ตรวจสอบสิทธิ์ผู้ขายไม่สำเร็จ กรุณาเข้าสู่ระบบอีกครั้ง');
    currentProfile=mapProfileRow(profile);
    offlineSyncMessage='';
    if(!offlineSales.length) await ensureOfflineShiftOnServer(currentCashShift,actor);
    for(const row of offlinePendingSales()){
      if(!navigator.onLine||String(currentProfile?.id)!==actor) break;
      try{
        await ensureOfflineShiftOnServer(row.shift,actor);
        const {data:result,error:postError}=await sb.rpc('complete_sale',{
          p_request_id:row.id,p_ref_prefix:row.refPrefix,p_warehouse_id:Number(row.payload.warehouseId),
          p_sale:row.payload.sale,p_items:row.payload.items,p_payload_hash:row.payloadHash
        });
        if(postError) throw postError;
        if(!result?.sale?.id) throw new Error('ยังไม่ได้รับเลขบิลจากระบบ');
        await editOfflineSales(rows=>rows.map(item=>item.id===row.id?{...item,completedSale:result.sale,error:''}:item));
      }catch(error){
        const message=String(error?.message||'เชื่อมต่อไม่สำเร็จ');
        await editOfflineSales(rows=>rows.map(item=>item.id===row.id?{...item,error:message}:item));
        offlineSyncMessage='มีบิลยังส่งไม่สำเร็จ ข้อมูลยังอยู่ในเครื่อง กดดูบิลรอซิงก์เพื่อตรวจสอบ';
        break;
      }
    }
    if(!offlinePendingSales().length){
      // Refresh authoritative inventory before removing the local stock overlay.
      const previousSettled=offlineInventorySettledIds;
      offlineInventorySettledIds=new Set(offlineSales.filter(row=>row.completedSale).map(row=>row.id));
      offlinePosActive=false;
      await loadWorkspaceFromSupabase();
      if(!offlineSnapshotReady){offlineInventorySettledIds=previousSettled;offlinePosActive=true;throw new Error('ส่งบิลแล้ว กำลังรอโหลดข้อมูลสต๊อกล่าสุด');}
      const settledWarehouses=new Set([Number(activeWarehouseId),...offlineSales.map(row=>Number(row.payload.warehouseId))]);
      for(const warehouseId of settledWarehouses)
        await offlineStoreWrite(`${OFFLINE_POS_KEY}:shift:${actor}:${warehouseId}`,null);
      await editOfflineSales(rows=>rows.filter(row=>!row.completedSale));
      offlineInventorySettledIds=new Set();
      await saveOfflinePosSnapshot();
      offlineSyncMessage='';
      setSyncUiState('synced',0);
      applyActiveWarehouseInventory();
    }
  }catch(error){
    offlineSyncMessage=String(error?.message||'ยังเชื่อมต่อระบบไม่ได้ บิลยังอยู่ในเครื่อง');
  }finally{
    offlineSyncRunning=false;renderSyncStatusChip();
    // Never replace a payment dialog or typed cart while the background sends.
    const banner=document.getElementById('offlinePosBanner');
    if(banner) banner.innerHTML=offlinePosBanner();
    if(navigator.onLine&&(offlinePendingSales().length||offlinePosActive))
      offlineSyncRetryTimer=setTimeout(()=>{void syncOfflineSales();},30000);
  }
}
