const DEVICE_ID_STORAGE_KEY='pepos_device_id_v1';
const PENDING_STOCK_OPERATIONS_KEY='pepos_pending_stock_operations_v1';
const PENDING_CLIENT_EVENTS_KEY='pepos_pending_client_events_v1';
const MAX_PENDING_CLIENT_EVENTS=100;
let syncUiState=navigator.onLine?'synced':'offline';
let syncUiErrorCount=0;
let syncUiLastError=null;
let coreSyncFailureDetail=null;
function currentDeviceId(){
  let id=''; try{ id=localStorage.getItem(DEVICE_ID_STORAGE_KEY)||''; }catch(_error){}
  if(!id){ id=globalThis.crypto?.randomUUID?.()||`device-${Date.now()}-${Math.random().toString(36).slice(2)}`; try{ localStorage.setItem(DEVICE_ID_STORAGE_KEY,id); }catch(_error){} }
  return id;
}
function renderSyncStatusChip(){
  const chip=document.getElementById('syncStatusChip'); if(!chip) return;
  const state=navigator.onLine?syncUiState:'offline';
  const labels={synced:'ซิงก์แล้ว',syncing:'กำลังซิงก์…',error:`ซิงก์ไม่สำเร็จ${syncUiErrorCount?` (${syncUiErrorCount})`:''}`,offline:'ออฟไลน์'};
  chip.dataset.state=state; chip.textContent=labels[state]||labels.synced;
  chip.title='กดเพื่อดูรายละเอียดการซิงก์';
}
function setSyncUiState(state,errorCount=syncUiErrorCount){ syncUiState=state; syncUiErrorCount=Math.max(0,Number(errorCount)||0); renderSyncStatusChip(); }
function rememberSyncUiError(error,{operation='sync_core_data',tableName='',recordId='',fallbackMessage='ซิงก์ข้อมูลไม่สำเร็จ'}={}){
  syncUiLastError={
    operation:String(operation||'sync_core_data'),
    table_name:String(tableName||''),
    record_id:String(recordId||error?.recordId||error?.productId||''),
    error_code:String(error?.code||''),
    message:String(error?.message||fallbackMessage),
    occurred_at:new Date().toISOString(),
    local:true,
  };
  setSyncUiState(navigator.onLine?'error':'offline',syncUiErrorCount+(error?.syncPaused?0:1));
  return syncUiLastError;
}
function noteCoreSyncFailure(error,{operation='sync_core_data',tableName='',recordId='',fallbackMessage='ซิงก์ข้อมูลไม่สำเร็จ'}={}){
  coreSyncFailureDetail={error,operation,tableName,recordId:recordId||error?.recordId||error?.productId||'',fallbackMessage};
  return false;
}
const SYNC_TABLE_LABELS={warehouses:'คลังสินค้า',products:'สินค้า',contacts:'สมุดรายชื่อ',sales_representatives:'ผู้แทนจำหน่าย',inspection_lists:'รายการตรวจสินค้า',promotions:'โปรโมชั่น',inventory_balances:'ยอดสต๊อก',inventory_lots:'LOT สินค้า'};
const SYNC_OPERATION_LABELS={sync_core_data:'ซิงก์ข้อมูลหลัก',save_revisioned_document:'บันทึกเอกสาร',run_stock_operation:'ปรับข้อมูลสต๊อก',owner_upsert_warehouse:'บันทึกคลังสินค้า',owner_delete_warehouse:'ลบคลังสินค้า'};
function syncEventTitle(row={}){
  const table=SYNC_TABLE_LABELS[String(row.table_name||'')]||String(row.table_name||'');
  return table||SYNC_OPERATION_LABELS[String(row.operation||'')]||String(row.operation||'ซิงก์ข้อมูล');
}
function syncEventCause(row={}){
  const message=String(row.message||'ไม่พบข้อความจากเซิร์ฟเวอร์'),code=String(row.error_code||'');
  const text=`${code} ${message}`.toLowerCase();
  if(!navigator.onLine||/(failed to fetch|network|load failed|offline)/.test(text)) return 'การเชื่อมต่ออินเทอร์เน็ตหรือเซิร์ฟเวอร์ขาดหาย';
  if(/(jwt|401|refresh token|not authenticated)/.test(text)) return 'การเข้าสู่ระบบหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่';
  if(/(42501|permission denied|row-level security|rls)/.test(text)) return 'บัญชีนี้ไม่มีสิทธิ์อ่านหรือบันทึกข้อมูลส่วนนี้';
  if(/(revision_conflict|40001|ถูกแก้ไขจากอีกเครื่อง)/.test(text)) return 'ข้อมูลในเครื่องต่างจากเซิร์ฟเวอร์ การแก้ไขยังเก็บไว้ในเครื่อง กรุณาตรวจสอบก่อนโหลดข้อมูลล่าสุด';
  if(/บาร์โค้ด.*มีอยู่ในสินค้าอื่น|duplicate_product_barcode|product_barcode_unique/.test(text)) return 'บาร์โค้ดซ้ำกับสินค้าอื่น กรุณาแก้หรือนำบาร์โค้ดที่ซ้ำออกก่อนบันทึกใหม่';
  if(/(23505|duplicate key|already exists)/.test(text)) return 'มีรหัสข้อมูลซ้ำกับรายการที่มีอยู่แล้ว';
  if(/(23503|foreign key)/.test(text)) return 'ไม่พบข้อมูลที่รายการนี้อ้างอิงอยู่';
  return message;
}
function syncEventTime(value){
  const date=new Date(value||Date.now());
  if(Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
}
function syncConflictProductId(row={}){
  row=row||{};
  if(row.table_name&&row.table_name!=='products') return 0;
  const code=String(row.error_code||'').toUpperCase(),message=String(row.message||'');
  if(code!=='REVISION_CONFLICT'&&!message.includes('ถูกแก้ไขจากอีกเครื่อง')) return 0;
  const explicit=String(row.record_id||'').trim();
  if(explicit&&Number.isFinite(Number(explicit))) return Number(explicit);
  const token=String(message.match(/สินค้า\s+(.+?)\s+ถูกแก้ไขจากอีกเครื่อง/)?.[1]||'').trim();
  if(!token) return 0;
  const local=(products||[]).find(product=>String(product.sku||'').trim()===token)||(products||[]).find(product=>String(product.id)===token);
  return Number(local?.id)||0;
}
function syncDetailRowsHtml(rows=[]){
  if(!rows.length) return '<div class="sync-detail-empty">ยังไม่มีประวัติข้อผิดพลาดจากเซิร์ฟเวอร์</div>';
  return rows.map(row=>{
    const cause=syncEventCause(row),message=String(row.message||'');
    const repeated=Math.max(1,Number(row.occurrence_count)||1);
    const device=row.device_id?`เครื่อง ${String(row.device_id).slice(0,8)}`:'';
    const meta=[row.status==='resolved'?'แก้ไขแล้ว':'ยังเปิดอยู่',device,repeated>1?`เกิดซ้ำ ${repeated.toLocaleString('th-TH')} ครั้ง`:'',row.error_code?`รหัส ${row.error_code}`:'',row.record_id?`รายการ ${row.record_id}`:''].filter(Boolean).join(' · ');
    const conflictProductId=(row.local||currentProfile?.owner)?syncConflictProductId(row):0;
    return `<article class="sync-detail-item">
      <div class="sync-detail-item-head"><strong>${escapeHtml(syncEventTitle(row))}</strong><time>${escapeHtml(syncEventTime(row.occurred_at))}</time></div>
      <div class="sync-detail-cause">${escapeHtml(cause)}</div>
      ${message&&message!==cause?`<div class="sync-detail-technical">รายละเอียด: ${escapeHtml(message)}</div>`:''}
      ${meta?`<div class="sync-detail-meta">${escapeHtml(meta)}</div>`:''}
      <div class="sync-detail-row-actions">${conflictProductId?`<button class="btn primary sync-conflict-load-latest" type="button" data-product-id="${conflictProductId}" data-event-id="${escapeHtml(row.id||'')}">โหลดข้อมูลล่าสุด</button>`:''}${currentProfile?.owner&&row.status!=='resolved'&&!row.local?`<button class="btn ghost sync-event-resolve" type="button" data-event-id="${escapeHtml(row.id||'')}">ปิดรายการ</button>`:''}</div>
    </article>`;
  }).join('');
}
async function loadLatestConflictedProduct(productId,eventId=''){
  const id=Number(productId)||0;
  const current=(products||[]).find(product=>Number(product.id)===id);
  if(!id||!current) throw new Error('ไม่พบสินค้าที่ต้องการโหลดในเครื่องนี้');
  if(!confirm(`โหลดข้อมูลล่าสุดของ “${current.name||current.sku||id}” จากเซิร์ฟเวอร์หรือไม่?\n\nข้อมูลที่แก้ไขค้างอยู่ในเครื่องสำหรับสินค้านี้จะถูกแทนที่ แต่สต๊อกและ LOT จะไม่ถูกแก้ไข`)) return false;
  const {data,error}=await sb.from('products').select('*').eq('id',id).maybeSingle();
  if(error) throw error;
  if(!data&&!confirm('สินค้านี้ถูกลบบนเซิร์ฟเวอร์แล้ว ต้องการทิ้งการแก้ไขที่ค้างในเครื่องและนำออกจากรายการในเครื่องหรือไม่?')) return false;
  const normalizedRemote=data?rowToProduct(data):null;
  const remote=data?{...normalizedRemote,stock:Number(current.stock)||0,expiry:current.expiry||'',_catalogExpiry:normalizedRemote._catalogExpiry}:null;
  const nextProducts=data?products.map(product=>Number(product.id)===id?remote:product):products.filter(product=>Number(product.id)!==id);
  const nextDirtyOperations=new Map(productDirtyOperations);
  nextDirtyOperations.delete(String(id));
  const persisted=await persistProductsToIndexedDB(nextProducts,true,nextDirtyOperations);
  if(!persisted) throw new Error('บันทึกข้อมูลล่าสุดลงเครื่องไม่สำเร็จ');
  products=nextProducts;
  productDirtyOperations=nextDirtyOperations;
  updateProductMetadataInChunks.paused?.delete(String(id));
  insertRowsInChunks.paused?.delete(String(id));
  rebuildProductLookupMaps();
  refreshCategoryBrandUnitLists();
  refreshDataCounters();
  seedProductSyncSnapshot(products,productDirtyOperations);
  if(Number(syncConflictProductId(syncUiLastError))===id) syncUiLastError=null;
  setSyncUiState('syncing');
  await syncCoreDataToSupabase();
  if(eventId) await resolveSyncEventAsOwner(eventId);
  render();
  return true;
}
async function resolveSyncEventAsOwner(eventId){
  if(!eventId||!currentProfile?.owner) return false;
  const {data,error}=await sb.rpc('owner_resolve_sync_event',{p_event_id:eventId});
  if(error) throw error;
  return data===true;
}
async function loadSyncEventDetails(){
  if(!sb||!currentProfile) return [];
  const {data,error}=await sb.from('sync_events')
    .select('id,device_id,severity,category,operation,table_name,record_id,error_code,message,status,first_occurred_at,occurred_at,resolved_at,occurrence_count')
    .order('occurred_at',{ascending:false})
    .limit(30);
  if(error) throw error;
  return Array.isArray(data)?data:[];
}
function openSyncDetailsModal(){
  document.querySelector('.sync-detail-overlay')?.remove();
  const overlay=document.createElement('div');
  overlay.className='modal-overlay sync-detail-overlay';
  const localRows=syncUiLastError?[syncUiLastError]:[];
  overlay.innerHTML=`<section class="modal sync-detail-modal" role="dialog" aria-modal="true" aria-labelledby="syncDetailTitle">
    <div class="modal-head"><div><h3 id="syncDetailTitle">รายละเอียดการซิงก์</h3><div class="sync-detail-summary">${navigator.onLine?'เชื่อมต่ออินเทอร์เน็ตแล้ว':'อุปกรณ์ออฟไลน์'}${syncUiErrorCount?` · ล้มเหลวสะสม ${syncUiErrorCount} รอบ`:''}</div></div><button class="modal-close" type="button" aria-label="ปิด">×</button></div>
    <div class="sync-detail-body">
    <div class="sync-detail-local">${localRows.length?`<div class="sync-detail-section-title">สาเหตุล่าสุดบนเครื่องนี้</div>${syncDetailRowsHtml(localRows)}`:''}</div>
    <div class="sync-recovery-panel"></div>
    <div class="sync-detail-section-title sync-detail-history-title">ประวัติล่าสุดจากเซิร์ฟเวอร์</div>
    <div class="sync-detail-list"><div class="sync-detail-loading">กำลังโหลดรายละเอียด…</div></div>
    <div class="sync-detail-note">ตัวเลขบนปุ่มคือจำนวนรอบที่ซิงก์ล้มเหลว ไม่ใช่จำนวนรายการข้อมูล</div>
    </div>
    <div class="sync-detail-actions"><button class="btn ghost sync-detail-close" type="button">ปิด</button><button class="btn primary sync-detail-retry" type="button">ลองซิงก์ใหม่</button></div>
  </section>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  renderWorkspaceRecoveryPanel(overlay.querySelector('.sync-recovery-panel'));
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('.sync-detail-close').onclick=close;
  overlay.onclick=async event=>{
    if(event.target===overlay) return;
    const resolveButton=event.target.closest?.('.sync-event-resolve');
    if(resolveButton&&!resolveButton.disabled){
      resolveButton.disabled=true; resolveButton.textContent='กำลังปิด…';
      try{ await resolveSyncEventAsOwner(resolveButton.dataset.eventId); await refresh(); }
      catch(error){ resolveButton.disabled=false; resolveButton.textContent='ปิดรายการ'; showToast(error?.message||'ปิดรายการไม่สำเร็จ','danger-top'); }
      return;
    }
    const button=event.target.closest?.('.sync-conflict-load-latest');
    if(!button||button.disabled) return;
    button.disabled=true; button.textContent='กำลังโหลด…';
    try{
      const loaded=await loadLatestConflictedProduct(button.dataset.productId,button.dataset.eventId);
      if(!overlay.isConnected) return;
      if(!loaded){ button.disabled=false; button.textContent='โหลดข้อมูลล่าสุด'; return; }
      overlay.querySelector('.sync-detail-local').innerHTML='<div class="sync-detail-resolved">โหลดข้อมูลล่าสุดแล้ว</div>';
      const summary=overlay.querySelector('.sync-detail-summary');
      summary.textContent=syncUiState==='synced'?'โหลดและซิงก์ข้อมูลล่าสุดสำเร็จแล้ว':`${navigator.onLine?'เชื่อมต่ออินเทอร์เน็ตแล้ว':'อุปกรณ์ออฟไลน์'}${syncUiErrorCount?` · ล้มเหลวสะสม ${syncUiErrorCount} รอบ`:''}`;
      refresh();
    }catch(error){
      if(!overlay.isConnected) return;
      button.disabled=false; button.textContent='โหลดข้อมูลล่าสุด';
      showToast(error?.message||'โหลดข้อมูลล่าสุดไม่สำเร็จ','danger-top');
    }
  };
  const list=overlay.querySelector('.sync-detail-list');
  const refresh=async()=>{
    renderWorkspaceRecoveryPanel(overlay.querySelector('.sync-recovery-panel'));
    list.innerHTML='<div class="sync-detail-loading">กำลังโหลดรายละเอียด…</div>';
    try{
      const rows=await loadSyncEventDetails();
      if(!overlay.isConnected) return;
      const device=currentDeviceId();
      const localOpen=rows.filter(row=>row.status!=='resolved'&&row.device_id===device);
      const otherOpen=rows.filter(row=>row.status!=='resolved'&&row.device_id!==device);
      const resolved=rows.filter(row=>row.status==='resolved');
      list.innerHTML=`<div class="sync-detail-section-title">รายการยังเปิดบนเครื่องนี้ (${localOpen.length})</div>${syncDetailRowsHtml(localOpen)}${otherOpen.length?`<details><summary>รายการยังเปิดจากเครื่องอื่น (${otherOpen.length}) — ไม่ใช่งานค้างบนเครื่องนี้</summary>${syncDetailRowsHtml(otherOpen)}</details>`:''}${resolved.length?`<details><summary>ประวัติที่แก้ไขแล้ว (${resolved.length})</summary>${syncDetailRowsHtml(resolved)}</details>`:''}`;
    }catch(error){
      if(!overlay.isConnected) return;
      list.innerHTML=`<div class="sync-detail-load-error">โหลดประวัติจากเซิร์ฟเวอร์ไม่ได้<br><span>${escapeHtml(syncEventCause({message:error?.message,error_code:error?.code}))}</span></div>`;
    }
  };
  overlay.querySelector('.sync-detail-retry').onclick=async event=>{
    const button=event.currentTarget;
    button.disabled=true; button.textContent='กำลังซิงก์…';
    // Explicit user retry is allowed; automatic retries leave conflicts paused.
    updateProductMetadataInChunks.paused?.clear();
    insertRowsInChunks.paused?.clear();
    syncRevisionedDocuments.paused?.clear();
    upsertAndPrune.paused?.clear();
    await syncCoreDataToSupabase();
    if(!overlay.isConnected) return;
    const summary=overlay.querySelector('.sync-detail-summary');
    summary.textContent=syncUiState==='synced'?'ซิงก์ล่าสุดสำเร็จแล้ว':`${navigator.onLine?'เชื่อมต่ออินเทอร์เน็ตแล้ว':'อุปกรณ์ออฟไลน์'}${syncUiErrorCount?` · ล้มเหลวสะสม ${syncUiErrorCount} รอบ`:''}`;
    button.disabled=false; button.textContent='ลองซิงก์ใหม่';
    refresh();
  };
  refresh();
}
function readPendingClientEvents(){
  try{
    const legacy=JSON.parse(localStorage.getItem(PENDING_CLIENT_EVENTS_KEY)||'[]');
    // Migrate the old shared array before deleting it. Each event now owns a
    // separate key so an acknowledgement cannot overwrite a concurrent append.
    if(Array.isArray(legacy)&&legacy.length){
      legacy.forEach((event,index)=>{
        const id=event.id||`legacy-${index}-${event.createdAt||''}`;
        localStorage.setItem(`${PENDING_CLIENT_EVENTS_KEY}:${id}`,JSON.stringify({...event,id}));
      });
      localStorage.removeItem(PENDING_CLIENT_EVENTS_KEY);
    }
    const rows=[];
    for(let index=0;index<localStorage.length;index++){
      const key=localStorage.key(index);
      if(!key?.startsWith(`${PENDING_CLIENT_EVENTS_KEY}:`)) continue;
      try{ const event=JSON.parse(localStorage.getItem(key)); if(event?.id) rows.push(event); }catch(_error){}
    }
    return rows.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)));
  }
  catch(_error){ return []; }
}
function enqueuePendingClientEvent(event){
  try{
    localStorage.setItem(`${PENDING_CLIENT_EVENTS_KEY}:${event.id}`,JSON.stringify(event));
    const excess=readPendingClientEvents().slice(0,-MAX_PENDING_CLIENT_EVENTS);
    excess.forEach(row=>localStorage.removeItem(`${PENDING_CLIENT_EVENTS_KEY}:${row.id}`));
    return true;
  }
  catch(_error){ return false; }
}
let pendingClientEventFlushPromise=null;
async function flushPendingClientEvents(){
  if(pendingClientEventFlushPromise) return pendingClientEventFlushPromise;
  if(!currentProfile||!sb||!navigator.onLine) return false;
  pendingClientEventFlushPromise=(async()=>{
    const attempted=new Set();
    let allSaved=true;
    while(navigator.onLine){
      const event=readPendingClientEvents().find(row=>!attempted.has(row.id));
      if(!event) break;
      attempted.add(event.id);
      try{
        const {error}=await sb.rpc('report_client_event',{p_device_id:currentDeviceId(),p_severity:event.severity,p_category:event.category,p_operation:event.operation,p_table_name:event.tableName||null,p_record_id:event.recordId||null,p_error_code:event.errorCode||null,p_message:event.message,p_context:event.context||{}});
        if(error) throw error;
        localStorage.removeItem(`${PENDING_CLIENT_EVENTS_KEY}:${event.id}`);
      }catch(_error){ allSaved=false; }
    }
    return allSaved;
  })().finally(()=>{ pendingClientEventFlushPromise=null; });
  return pendingClientEventFlushPromise;
}
async function reportClientEvent({severity='error',category='sync',operation,tableName='',recordId='',errorCode='',message,context={}}){
  if(!operation||!message) return false;
  const event={id:globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`,severity,category,operation:String(operation),tableName:String(tableName||''),recordId:String(recordId||''),errorCode:String(errorCode||''),message:String(message).slice(0,1000),context:cloudClean(context||{}),createdAt:new Date().toISOString()};
  if(!enqueuePendingClientEvent(event)){ console.warn('ไม่สามารถเก็บ Error เพื่อส่งซ้ำได้'); return false; }
  return flushPendingClientEvents();
}
async function resolveOwnSyncEventsThrough(through){
  if(!currentProfile) return;
  try{
    const {error}=await sb.rpc('resolve_own_sync_events',{p_device_id:currentDeviceId(),p_through:through||new Date().toISOString()});
    if(error&&!['PGRST202','42883'].includes(String(error.code||''))) console.warn('resolve sync events failed',error);
  }
  catch(_error){ /* compatible with the short rollout window before the RPC exists */ }
}
function readPendingStockOperations(){ try{ const rows=JSON.parse(localStorage.getItem(PENDING_STOCK_OPERATIONS_KEY)||'{}'); return rows&&typeof rows==='object'?rows:{}; }catch(_error){ return {}; } }
function writePendingStockOperations(rows){ try{ localStorage.setItem(PENDING_STOCK_OPERATIONS_KEY,JSON.stringify(rows||{})); return true; }catch(_error){ return false; } }
async function beginDurableOperation(operation,payloadHash){
  const actorId=String(currentProfile?.id||'');
  if(!actorId) throw new Error('กรุณาเข้าสู่ระบบก่อนบันทึกรายการ');
  const key=`operation:${actorId}:${payloadHash}`;
  const legacy=readPendingStockOperations()[payloadHash];
  try{
    const db=await openProductCacheDb();
    const transaction=db.transaction(PRODUCT_CACHE_META_STORE,'readwrite');
    const done=idbTransactionDone(transaction),store=transaction.objectStore(PRODUCT_CACHE_META_STORE);
    const legacyCompletion=store.get(`legacy-completed:${actorId}:${payloadHash}`);
    const request=store.get(key);
    let saved;
    request.onsuccess=()=>{
      try{
        saved=request.result?.value;
        if(!saved){
          const legacyUsable=legacy?.requestId&&legacyCompletion.result?.value!==legacy.requestId&&(!legacy.actorId||legacy.actorId===actorId);
          const requestId=legacyUsable?legacy.requestId:null;
          saved={requestId:requestId||globalThis.crypto.randomUUID(),actorId,operation,payloadHash,createdAt:new Date().toISOString()};
          store.put({key,value:saved});
        }
      }catch(_error){ try{ transaction.abort(); }catch(_){} }
    };
    await done;
    if(!saved?.requestId) throw new Error('ไม่พบรหัสป้องกันรายการซ้ำ');
    return {...saved,key};
  }catch(cause){
    const error=new Error('ยังไม่ได้ส่งรายการ: เก็บรหัสป้องกันรายการซ้ำลงเครื่องไม่ได้ กรุณาตรวจพื้นที่ว่างหรืออนุญาตการเก็บข้อมูลของเว็บไซต์');
    error.code='LOCAL_STORAGE_UNAVAILABLE'; error.cause=cause;
    rememberSyncUiError(error,{operation});
    throw error;
  }
}
async function finishDurableOperation(request){
  try{
    const db=await openProductCacheDb(),transaction=db.transaction(PRODUCT_CACHE_META_STORE,'readwrite');
    const done=idbTransactionDone(transaction);
    const legacy=readPendingStockOperations();
    if(legacy[request.payloadHash]?.requestId) transaction.objectStore(PRODUCT_CACHE_META_STORE).put({key:`legacy-completed:${request.actorId}:${request.payloadHash}`,value:legacy[request.payloadHash].requestId});
    transaction.objectStore(PRODUCT_CACHE_META_STORE).delete(request.key);
    await done;
    delete legacy[request.payloadHash]; writePendingStockOperations(legacy);
  }catch(error){
    // Keeping the token is safe: a retry retrieves the committed server result.
    console.warn('เก็บรหัสรายการไว้เพื่อตรวจสอบซ้ำ',error);
    showToast('บันทึกบนเซิร์ฟเวอร์แล้ว แต่เครื่องยังล้างรหัสรอตรวจสอบไม่ได้ กรุณาตรวจพื้นที่ว่างก่อนทำรายการเดิมอีกครั้ง','warning-top');
  }
}
async function runStockOperation(operation,args={}){
  const payload=cloudClean(args||{}),payloadHash=await sha256Hex({operation,payload});
  const request=await beginDurableOperation(operation,payloadHash),requestId=request.requestId;
  setSyncUiState('syncing');
  const {data,error}=await sb.rpc('run_stock_operation',{p_request_id:requestId,p_operation:operation,p_args:payload});
  if(error){
    rememberSyncUiError(error,{operation,recordId:String(payload.receiptId||payload.returnId||payload.exchangeId||payload.saleId||payload.productId||''),fallbackMessage:'บันทึกการเปลี่ยนแปลงสต๊อกไม่สำเร็จ'});
    reportClientEvent({operation,recordId:String(payload.receiptId||payload.returnId||payload.exchangeId||payload.saleId||payload.productId||''),errorCode:error.code||'',message:error.message||'Stock operation failed',context:{payloadHash}});
    throw error;
  }
  await finishDurableOperation(request);
  setSyncUiState('synced',0);
  return data;
}
async function recordPrintEvent(documentType,documentId='',metadata={}){
  if(!currentProfile) return;
  try{ await sb.rpc('record_print_event',{p_document_type:String(documentType||'document'),p_document_id:String(documentId||'')||null,p_print_kind:'print',p_copies:1,p_warehouse_id:Number(activeWarehouseId)||null,p_metadata:cloudClean(metadata||{})}); }
  catch(error){ reportClientEvent({category:'print',operation:'record_print_event',recordId:String(documentId||''),message:error?.message||'บันทึกประวัติการพิมพ์ไม่สำเร็จ'}); }
}
function mapProfileRow(row){
  if(!row) return null;
  return { id:row.id, username:row.username, firstName:row.first_name||'', lastName:row.last_name||'', phone:row.phone||'', note:row.note||'', owner:!!row.owner, level:Number(row.level)||2 };
}
