const WORKSPACE_STORAGE_KEY='pharmacy_pos_workspace_v1';
const RESET_BACKUP_KEY='pos2_reset_backup_v1';
const STORE_BACKUP_LAST_KEY='pepos_store_backup_last_v1';
const STORE_BACKUP_FORMAT='pepos-pharmacy-store-backup';
const STORE_BACKUP_VERSION=3;
const PENDING_CHECKOUT_REQUEST_KEY='pepos_pending_checkout_request_v2';
const MAINTENANCE_EPOCH_STORAGE_KEY='pepos_maintenance_epoch_v1';
const OWNER_BOOTSTRAP_TOKEN_STORAGE_KEY='pepos_owner_bootstrap_token_v1';
let maintenanceEpoch=localStorage.getItem(MAINTENANCE_EPOCH_STORAGE_KEY)||'';
let workspacePersistTimer=null;
let workspaceCachePendingSnapshot=null;
let workspaceCacheWritePromise=Promise.resolve(true);
let checkoutInFlight=false;
let pendingCheckoutContextMemory=null;
function cloudClean(value){
  return JSON.parse(JSON.stringify(value,(key,item)=>{
    if(key==='password'||key==='updatedAt'||item===undefined) return undefined;
    return item;
  }));
}
function stableJsonValue(value){
  if(Array.isArray(value)) return value.map(stableJsonValue);
  if(value&&typeof value==='object') return Object.keys(value).sort().reduce((result,key)=>{ if(value[key]!==undefined) result[key]=stableJsonValue(value[key]); return result; },{});
  return value;
}
async function sha256Hex(value){
  const text=typeof value==='string'?value:JSON.stringify(stableJsonValue(value));
  if(globalThis.crypto?.subtle){
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  let output='';
  for(let seed=0;seed<8;seed++){
    let hash=(2166136261^seed)>>>0;
    for(let i=0;i<text.length;i++){ hash^=text.charCodeAt(i); hash=Math.imul(hash,16777619)>>>0; }
    output+=hash.toString(16).padStart(8,'0');
  }
  return output;
}
function readPendingCheckoutRequest(){
  let saved=pendingCheckoutContextMemory;
  if(!saved){ try{ saved=JSON.parse(localStorage.getItem(PENDING_CHECKOUT_REQUEST_KEY)||'null'); }catch(error){} }
  if(!saved){ try{ saved=JSON.parse(sessionStorage.getItem(PENDING_CHECKOUT_REQUEST_KEY)||'null'); }catch(error){} }
  const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved?.id||'');
  if(!validId) return null;
  pendingCheckoutContextMemory=saved;
  return saved;
}
function savePendingCheckoutRequest(context){
  pendingCheckoutContextMemory=context;
  const serialized=JSON.stringify(context);
  try{ localStorage.setItem(PENDING_CHECKOUT_REQUEST_KEY,serialized); }
  catch(error){ console.warn('เก็บ request id การชำระแบบถาวรไม่สำเร็จ',error); }
  try{ sessionStorage.setItem(PENDING_CHECKOUT_REQUEST_KEY,serialized); }
  catch(error){ console.warn('เก็บ request id การชำระใน session ไม่สำเร็จ',error); }
  return context;
}
function checkoutUiSnapshot(payMethod,options={}){
  return cloudClean({cart,saleDiscount,saleMember,saleLoyaltySelection,saleSourceQuotationId,pendingQty,activeWarehouseId,payMethod:payMethod||'เงินสด',options});
}
function restorePendingCheckoutUi(context){
  const snapshot=context?.uiSnapshot;
  if(!snapshot||!Array.isArray(snapshot.cart)) return false;
  cart=JSON.parse(JSON.stringify(snapshot.cart));
  saleDiscount=Number(snapshot.saleDiscount)||0;
  saleMember=snapshot.saleMember||null;
  saleLoyaltySelection=snapshot.saleLoyaltySelection||null;
  saleSourceQuotationId=snapshot.saleSourceQuotationId||null;
  pendingQty=Math.max(1,Number(snapshot.pendingQty)||1);
  return true;
}
async function checkoutRequestContext(payload,uiSnapshot=null){
  const payloadHash=await sha256Hex(payload);
  const saved=readPendingCheckoutRequest();
  const draft={id:crypto.randomUUID(),actorId:String(currentProfile?.id||''),payloadHash,payload:cloudClean(payload),uiSnapshot:uiSnapshot||null,warehouseId:Number(payload?.warehouseId)||null,createdAt:new Date().toISOString()};
  const context=await updateDurableCheckout({draft,legacy:saved});
  savePendingCheckoutRequest(context);
  return {...context,currentPayloadHash:payloadHash,payloadMismatch:context.payloadHash!==payloadHash};
}
async function updateDurableCheckout({draft=null,legacy=null,completedId=''}={}){
  const actor=String(currentProfile?.id||'');
  if(!actor) throw new Error('กรุณาเข้าสู่ระบบก่อนชำระ');
  try{
    const db=await openProductCacheDb(),transaction=db.transaction(PRODUCT_CACHE_META_STORE,'readwrite');
    const done=idbTransactionDone(transaction),store=transaction.objectStore(PRODUCT_CACHE_META_STORE),key=`checkout:${actor}`,request=store.get(key);
    let context=null;
    request.onsuccess=()=>{
      try{
        const previous=request.result?.value;
        if(completedId){
          if(!previous?.id||previous.id===completedId) store.put({key,value:{completedId}});
          return;
        }
        if(!draft){ context=previous?.id?previous:null; return; }
        const usableLegacy=legacy?.id&&legacy.id!==previous?.completedId&&(!legacy.actorId||legacy.actorId===actor);
        context=previous?.id?previous:usableLegacy?{...legacy,actorId:actor}:draft;
        store.put({key,value:context});
      }catch(_error){try{transaction.abort();}catch(_){} }
    };
    await done;
    return context;
  }catch(cause){const error=new Error('ยังไม่ได้ส่งการชำระ: เก็บข้อมูลป้องกันบิลซ้ำลงเครื่องไม่ได้ กรุณาตรวจพื้นที่ว่าง');error.code='LOCAL_STORAGE_UNAVAILABLE';error.cause=cause;throw error;}
}
async function clearCheckoutRequestId(requestId=''){
  try{
    if(requestId){
      const saved=readPendingCheckoutRequest();
      if(saved?.id!==requestId) return;
    }
    if(!requestId) return;
    await updateDurableCheckout({completedId:requestId});
    pendingCheckoutContextMemory=null;
    localStorage.removeItem(PENDING_CHECKOUT_REQUEST_KEY);
    sessionStorage.removeItem(PENDING_CHECKOUT_REQUEST_KEY);
  }catch(error){showToast('รายการได้รับคำตอบแล้ว แต่เครื่องยังล้างข้อมูลรอตรวจสอบไม่ได้ กรุณาตรวจพื้นที่ว่าง','warning-top');}
}
async function clearLocalStoreCachesForReset(){
  try{
    Object.keys(localStorage).filter(key=>key.startsWith('pharmacy_pos_')||key.startsWith('pepos_')||key.startsWith('pos2_')).forEach(key=>localStorage.removeItem(key));
    Object.keys(sessionStorage).filter(key=>key.startsWith('pepos_')||key.startsWith('pharmacy_pos_')).forEach(key=>sessionStorage.removeItem(key));
  }catch(error){ console.warn('ล้างแคชหลังรีเซ็ตไม่สำเร็จ',error); }
  await clearProductIndexedCache();
  clearTimeout(workspacePersistTimer);
  workspaceRecoveryEntries=new Map(); workspaceOutboxVersions=new Map(); workspaceRecoveryLoadedActor=''; workspaceRecoveryActorId=''; workspaceCacheSaveFailed=false;
  pendingCheckoutContextMemory=null;
  workspaceCachePendingSnapshot=null;
}
function clearRemoteResetSensitiveMemory(){
  clearLoadedHistoryMemory();
  inspectionLists=[]; promotions=[]; favorites=[]; cart=[]; inventoryBalanceRows=[]; inventoryBalanceMap=new Map(); inventoryLotRows=[]; inventoryLotMap=new Map();
  resetLoadedInventoryScopes();
  resetRepresentativeManagedProductIndex();
  notes=[]; notesLoaded=false; notesLoading=false; notesHasMore=false; noteLoadError=''; editingNoteId=null; noteDraft=null; noteDraftDirty=false; noteSearchQuery=''; notePageCursor=null;
  cashShifts=[]; currentCashShift=null; cashShiftCloseDraft={countedCash:'',reason:''};
  documentPrefixes={...DEFAULT_DOCUMENT_PREFIXES};
  businessSettings={...DEFAULT_BUSINESS_SETTINGS};
  businessSettingsDirty=false;
  businessSettingsSyncState='local';
}
async function adoptRemoteMaintenanceEpoch(){
  if(!currentProfile) return false;
  try{
    const {data,error}=await sb.from('settings').select('value').eq('key','maintenance_epoch').maybeSingle();
    if(error) throw error;
    const remoteEpoch=String(data?.value?.epoch||'');
    if(!remoteEpoch||remoteEpoch===maintenanceEpoch) return false;
    await clearLocalStoreCachesForReset();
    clearRemoteResetSensitiveMemory();
    maintenanceEpoch=remoteEpoch;
    localStorage.setItem(MAINTENANCE_EPOCH_STORAGE_KEY,remoteEpoch);
    return true;
  }catch(error){
    console.warn('ตรวจรุ่นข้อมูลหลังรีเซ็ตไม่สำเร็จ',error);
    return false;
  }
}
function normalizeInspectionLists(value){
  if(!Array.isArray(value)) return [];
  return value.filter(list=>list&&typeof list==='object').map((list,index)=>{
    const seen=new Set();
    const items=(Array.isArray(list.items)?list.items:[]).map(item=>({pid:Number(item?.pid),unit:String(item?.unit||'').trim()})).filter(item=>{
      if(!Number.isFinite(item.pid)||item.pid<=0||seen.has(item.pid)) return false;
      seen.add(item.pid); return true;
    });
    return {
      ...list,
      ...(list._clientCreateToken?{_clientCreateToken:String(list._clientCreateToken)}:{}),
      _revision:Number(list._revision)||0,
      id:String(list.id||`${documentPrefixes.inspection}-${String(index+1).padStart(4,'0')}`),
      name:String(list.name||`รายการตรวจสินค้า ${index+1}`).trim()||`รายการตรวจสินค้า ${index+1}`,
      items,
      createdAt:String(list.createdAt||new Date().toISOString()),
      updatedAt:String(list.updatedAt||list.createdAt||new Date().toISOString()),
      createdBy:String(list.createdBy||''),
      stockAdjustedAt:String(list.stockAdjustedAt||''),
      stockAdjustedBy:String(list.stockAdjustedBy||''),
    };
  });
}
function workspaceSnapshot(){
  return {warehouses,products,contacts,salesRepresentatives,salesHistory,quotations,invoicesAR,creditNotes,purchaseOrders,goodsReceipts,productExchanges,productReturns,transfers,standaloneTaxInvoices,promotions,favorites,inspectionLists,currentUserProfile,documentPrefixes,businessSettings};
}
function localWorkspaceSnapshot(){
  const snapshot=workspaceSnapshot();
  snapshot._inspectionRecoveryVersion=1;
  delete snapshot.products;
  delete snapshot.salesHistory;
  const pending=currentWorkspacePendingChanges();
  snapshot._recoveryActorId=String(currentProfile?.id||workspaceRecoveryActorId||'');
  snapshot._pendingWorkspaceChanges=cloneSyncRecords(pending);
  // History is a disposable cache; unsent edits/deletions are never evicted.
  DOC_TABLES.forEach(([table,getRows])=>{
    const rows=getRows(),key=Object.keys(snapshot).find(key=>snapshot[key]===rows);
    if(!key) return;
    const pendingIds=new Set(pending.filter(entry=>entry.table===table).map(entry=>entry.id));
    snapshot[key]=rows.filter((row,index)=>index<WORKSPACE_DOCUMENT_CACHE_LIMIT||pendingIds.has(String(row.id)));
  });
  return structuredClone(snapshot);
}
function workspaceRecoveryTables(){
  return [
    ['contacts',()=>contacts,rows=>{contacts=rows;},contactToRow],
    ['sales_representatives',()=>salesRepresentatives,rows=>{salesRepresentatives=rows;},salesRepToRow],
    ['inspection_lists',()=>inspectionLists,rows=>{inspectionLists=rows;},inspectionListToRow],
    ...DOC_TABLES.map(([table,getRows,setRows])=>[table,getRows,setRows,docToRow]),
  ];
}
function renderWorkspaceRecoveryPanel(panel){
  if(!panel) return;
  const entries=currentWorkspacePendingChanges();
  const labels={contacts:'ลูกค้า / ผู้จำหน่าย',sales_representatives:'ผู้แทน',quotations:'ใบเสนอราคา',purchase_orders:'สั่งซื้อสินค้า',goods_receipts:'รับเข้าสินค้า',product_returns:'คืนสินค้า'};
  panel.innerHTML=`<div class="sync-detail-section-title">งานรอซิงก์ ${entries.length} รายการ${workspaceCacheSaveFailed?' · ยังเก็บลงเครื่องไม่สำเร็จ':''}</div>${entries.length?`<button class="btn ghost" type="button" data-export-recovery>ดาวน์โหลดสำเนางานรอซิงก์</button><div class="sync-recovery-list">${entries.map((entry,index)=>`<div class="sync-recovery-row"><span>${escapeHtml(labels[entry.table]||entry.table)} · ${escapeHtml(entry.record?.name||entry.record?.id||entry.id)}${entry.record?'':' · รอลบ'}</span><button class="btn ghost" type="button" data-discard-recovery="${index}">ใช้ข้อมูลเซิร์ฟเวอร์</button></div>`).join('')}</div>`:'<div class="sync-detail-note">ไม่มีงานค้างของสมุดรายชื่อหรือเอกสาร</div>'}`;
  panel.querySelector('[data-export-recovery]')?.addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({format:'SAPURI-pending-work',createdAt:new Date().toISOString(),changes:entries},null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url; link.download=`SAPURI-pending-work-${currentDateStr()}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  panel.querySelectorAll('[data-discard-recovery]').forEach(button=>{
    const compare=document.createElement('button');
    compare.className='btn ghost'; compare.type='button'; compare.textContent='ตรวจเทียบ';
    compare.onclick=()=>openWorkspaceRecoveryComparison(entries[Number(button.dataset.discardRecovery)]);
    button.before(compare);
  });
  panel.querySelectorAll('[data-discard-recovery]').forEach(button=>button.onclick=async()=>{
    const entry=entries[Number(button.dataset.discardRecovery)];
    if(!confirm('ใช้ข้อมูลเซิร์ฟเวอร์แทนงานที่แก้ค้างในเครื่องรายการนี้หรือไม่? แนะนำให้ดาวน์โหลดสำเนางานก่อน ข้อมูลสต๊อกจะไม่เปลี่ยน')) return;
    button.disabled=true;
    try{ await discardWorkspaceRecovery(entry); renderWorkspaceRecoveryPanel(panel); }
    catch(error){ showToast(error.message,'danger-top'); button.disabled=false; }
  });
}
async function openWorkspaceRecoveryComparison(entry){
  const config=workspaceRecoveryTables().find(([table])=>table===entry.table);
  if(!config) return;
  try{
    const {data,error}=await sb.from(entry.table).select('*').eq('id',entry.id).maybeSingle();
    if(error) throw error;
    const remote=data?revisionedRecordFromRow(entry.table,data):null;
    const local=entry.record?config[3](entry.record):null,server=remote?config[3](remote):null;
    const flatten=(value,prefix='',out={})=>{
      if(value&&typeof value==='object'&&!Array.isArray(value)) for(const [key,item] of Object.entries(value)) flatten(item,prefix?`${prefix}.${key}`:key,out);
      else out[prefix]=value;
      return out;
    };
    const left=flatten(local),right=flatten(server);
    const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].filter(key=>JSON.stringify(canonicalProductInsertValue(left[key]))!==JSON.stringify(canonicalProductInsertValue(right[key])));
    const labels={name:'ชื่อ',phone:'เบอร์โทร',type:'ประเภท',revision:'เวอร์ชัน','data.code':'รหัส','data.address':'ที่อยู่','data.note':'หมายเหตุ','data.customerPrices':'ราคาพิเศษ','data.loyaltyJoinedAt':'วันที่เริ่มสมาชิก'};
    const display=value=>escapeHtml(value===undefined?'ไม่มีข้อมูล':value===null?'ไม่มีรายการ':typeof value==='object'?JSON.stringify(value):String(value));
    const overlay=document.createElement('div'); overlay.className='modal-overlay';
    overlay.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-label="ตรวจเทียบงานค้าง"><div class="modal-head"><h3>ตรวจเทียบ: ${escapeHtml(entry.record?.name||entry.id)}</h3><button class="modal-close" type="button" aria-label="ปิด">×</button></div><div style="padding:20px;max-height:65vh;overflow:auto"><p>แสดงความต่างเท่านั้น หน้านี้ไม่เปลี่ยนข้อมูลหรือจำนวนสต๊อก</p>${!local?'<p>เครื่องนี้มีคำสั่งรอลบรายการ</p>':''}${!server?'<p>ไม่พบรายการบนเซิร์ฟเวอร์ที่บัญชีนี้อ่านได้</p>':''}${keys.length?`<table class="table"><thead><tr><th>ข้อมูล</th><th>ในเครื่อง</th><th>เซิร์ฟเวอร์</th></tr></thead><tbody>${keys.map(key=>`<tr><td>${escapeHtml(labels[key]||key)}</td><td style="overflow-wrap:anywhere">${display(left[key])}</td><td style="overflow-wrap:anywhere">${display(right[key])}</td></tr>`).join('')}</tbody></table>`:'<p>ข้อมูลตรงกัน ไม่พบความแตกต่าง</p>'}</div></section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').onclick=()=>overlay.remove();
    overlay.onclick=event=>{ if(event.target===overlay) overlay.remove(); };
  }catch(error){ showToast(error.message||'ตรวจเทียบไม่สำเร็จ','danger-top'); }
}
async function discardWorkspaceRecovery(entry){
  const requestedFingerprint=JSON.stringify(entry);
  const config=workspaceRecoveryTables().find(([table])=>table===entry.table);
  if(!config) throw new Error('ไม่พบรายการที่ต้องการตรวจสอบ');
  const [table,getRows,setRows,toRow]=config;
  const {data,error}=await sb.from(table).select('*').eq('id',entry.id).maybeSingle();
  if(error) throw error;
  const latest=currentWorkspacePendingChanges().find(item=>item.table===table&&item.id===entry.id);
  if(JSON.stringify(latest)!==requestedFingerprint) throw new Error('ข้อมูลรายการนี้เปลี่ยนระหว่างตรวจสอบ กรุณาเปิดรายละเอียดอีกครั้ง');
  const fromRow=table==='contacts'?rowToContact:table==='sales_representatives'?rowToSalesRep:table==='inspection_lists'?rowToInspectionList:rowToDoc;
  const remote=data?fromRow(data):null,previousRows=getRows(),previousBaseline=syncedTableRows[table];
  const key=`${table}:${entry.id}`,previousEntries=new Map(workspaceRecoveryEntries);
  setRows([...previousRows.filter(row=>String(row.id)!==entry.id),...(remote?[remote]:[])]);
  const baseline=new Map(previousBaseline||[]);
  if(remote) baseline.set(entry.id,JSON.stringify(toRow(remote))); else baseline.delete(entry.id);
  syncedTableRows[table]=baseline; workspaceRecoveryEntries.delete(key);
  try{ await ensureWorkspaceRecoveryDurable(); }
  catch(error){ setRows(previousRows); syncedTableRows[table]=previousBaseline; workspaceRecoveryEntries=previousEntries; workspaceCachePendingSnapshot=localWorkspaceSnapshot(); throw error; }
  syncRevisionedDocuments.paused?.delete(key);
  upsertAndPrune.paused?.delete(key);
  showToast('ใช้ข้อมูลล่าสุดจากเซิร์ฟเวอร์แล้ว');
}
function currentWorkspacePendingChanges(){
  const actor=String(currentProfile?.id||'');
  if(actor&&workspaceRecoveryActorId&&workspaceRecoveryActorId!==actor) return [];
  const pending=new Map(workspaceRecoveryEntries);
  workspaceRecoveryTables().forEach(([table,getRows,_setRows,toRow])=>{
    const baseline=syncedTableRows[table];
    if(!baseline) return;
    const rows=getRows(),ids=new Set(rows.map(row=>String(row.id)));
    rows.forEach(row=>{
      const id=String(row.id),key=`${table}:${id}`,previous=baseline.get(id)||null;
      if(pending.get(key)?.legacy||pending.get(key)?.detached) return;
      if(previous===JSON.stringify(toRow(row))) pending.delete(key);
      else pending.set(key,{table,id,baseline:previous,record:row});
    });
    baseline.forEach((previous,id)=>{ if(!ids.has(String(id))&&!pending.get(`${table}:${id}`)?.detached) pending.set(`${table}:${id}`,{table,id:String(id),baseline:previous,record:null}); });
  });
  workspaceRecoveryEntries=pending;
  return [...pending.values()];
}
function mergeWorkspaceRemoteRows(table,current,incoming,toRow,{replace=false}={}){
  const pending=currentWorkspacePendingChanges().filter(entry=>entry.table===table);
  const next=new Map((replace?[]:current).map(row=>[String(row.id),row]));
  const baseline=new Map(replace?[]:(syncedTableRows[table]||[]));
  const incomingById=new Map(incoming.map(row=>[String(row.id),row]));
  incoming.forEach(row=>{ next.set(String(row.id),row); baseline.set(String(row.id),JSON.stringify(toRow(row))); });
  pending.forEach(entry=>{
    const remote=incomingById.get(entry.id);
    if(entry.legacy&&remote&&entry.record){
      const stripRevision=row=>{
        const value={...toRow(row)}; delete value.revision;
        if(table==='contacts'&&Array.isArray(row.types)&&!row.types.includes('customer')){
          // Older clients synthesized a customer-only loyalty date for suppliers.
          value.data={...value.data}; delete value.data.loyaltyJoinedAt;
        }
        if(table==='inspection_lists'){
          value.data={...value.data};
          // Older cache normalization dropped these two server fields.
          for(const key of ['warehouseId','stockAdjustmentDocumentNo']) if(!Object.hasOwn(entry.record,key)) delete value.data[key];
        }
        return canonicalProductInsertValue(value);
      };
      if(JSON.stringify(stripRevision(entry.record))===JSON.stringify(stripRevision(remote))||(table==='inspection_lists'&&inspectionCompletionMatches(entry.record,remote))){ workspaceRecoveryEntries.delete(`${table}:${entry.id}`); return; }
    }
    if(entry.record) next.set(entry.id,entry.record); else next.delete(entry.id);
    delete entry.detached;
    if(entry.baseline) baseline.set(entry.id,entry.baseline); else baseline.delete(entry.id);
  });
  syncedTableRows[table]=baseline;
  return [...next.values()];
}
async function reconcileLegacyWorkspaceRows(table,current,toRow){
  const entries=[...workspaceRecoveryEntries.values()].filter(entry=>entry.table===table&&entry.legacy&&entry.record&&upsertAndPrune.paused?.get(`${table}:${entry.id}`)?.fingerprint!==JSON.stringify(entry));
  if(!entries.length) return;
  // Reading master rows is safe. Only exact content matches are acknowledged;
  // unknown edits and pending deletions keep their original revision baseline.
  for(let offset=0;offset<entries.length;offset+=100){
    const {data,error}=await sb.from(table).select('*').in('id',entries.slice(offset,offset+100).map(entry=>entry.id));
    if(error) throw error;
    const config=workspaceRecoveryTables().find(([name])=>name===table);
    if(!config) continue;
    const next=mergeWorkspaceRemoteRows(table,config[1](),(data||[]).map(row=>revisionedRecordFromRow(table,row)),toRow);
    config[2](next);
  }
  await ensureWorkspaceRecoveryDurable();
}
async function ensureWorkspaceRecoveryDurable(){
  workspaceCachePendingSnapshot=localWorkspaceSnapshot();
  clearTimeout(workspacePersistTimer);
  const saved=await flushWorkspaceCacheToIndexedDB();
  if(!saved){
    const error=new Error('ยังไม่ได้ส่งข้อมูล: บันทึกสำเนากู้คืนลงเครื่องไม่สำเร็จ กรุณาตรวจพื้นที่ว่าง อย่าเพิ่งปิดหน้านี้');
    error.code='LOCAL_STORAGE_UNAVAILABLE';
    throw error;
  }
  return true;
}
async function loadWorkspaceRecoveryForUser(){
  const actor=String(currentProfile?.id||'');
  if(!actor||workspaceRecoveryLoadedActor===actor) return;
  const db=await openProductCacheDb(),transaction=db.transaction(PRODUCT_CACHE_WORKSPACE_STORE,'readonly');
  const done=idbTransactionDone(transaction);
  const stored=await idbRequest(transaction.objectStore(PRODUCT_CACHE_WORKSPACE_STORE).getAll());
  await done;
  const row=stored.find(item=>item.key===`user:${actor}`);
  const pending=stored.filter(item=>item.key.startsWith(`pending:${actor}:`));
  workspaceOutboxVersions=new Map(pending.map(item=>[item.key,item.version]));
  if(row?.value) applyWorkspaceData({...row.value,...(row.value._outboxVersion?{_pendingWorkspaceChanges:pending.map(item=>item.value)}:{})});
  else if(workspaceRecoveryActorId&&workspaceRecoveryActorId!==actor){
    workspaceRecoveryEntries=new Map();
    workspaceRecoveryTables().forEach(([table,_getRows,setRows])=>{ setRows([]); delete syncedTableRows[table]; });
  }
  workspaceRecoveryActorId=actor;
  workspaceRecoveryLoadedActor=actor;
  const checkout=await updateDurableCheckout();
  if(checkout) savePendingCheckoutRequest(checkout);
}
async function writeWorkspaceOutbox(transaction,store,snapshot){
  const actor=String(snapshot._recoveryActorId||'');
  if(!actor) return;
  const prefix=`pending:${actor}:`,request=store.getAll();
  const nextVersions=new Map(workspaceOutboxVersions);
  await new Promise((resolve,reject)=>{
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      try{
        const stored=new Map(request.result.filter(row=>row.key.startsWith(prefix)).map(row=>[row.key,row]));
        const pending=new Map((snapshot._pendingWorkspaceChanges||[]).map(entry=>[`${prefix}${entry.table}:${entry.id}`,entry]));
        for(const [key,value] of pending){
          const previous=stored.get(key);
          if(previous&&JSON.stringify(previous.value)===JSON.stringify(value)){ nextVersions.set(key,previous.version); continue; }
          if(previous?.version!==workspaceOutboxVersions.get(key)) throw new Error('งานรอซิงก์รายการนี้เปลี่ยนจากอีกแท็บ กรุณาดาวน์โหลดสำเนางานและตรวจสอบก่อน อย่าเพิ่งปิดหน้านี้');
          const version=globalThis.crypto.randomUUID();store.put({key,value,version});nextVersions.set(key,version);
        }
        for(const [key,version] of workspaceOutboxVersions){
          if(!key.startsWith(prefix)||pending.has(key)) continue;
          // Never erase another tab's newer work when acknowledging our own.
          if(stored.get(key)?.version===version) store.delete(key);
          nextVersions.delete(key);
        }
        resolve();
      }catch(error){try{transaction.abort();}catch(_){} reject(error);}
    };
  });
  return nextVersions;
}
function refreshDataCounters(){
  nextWarehouseId=maxArrayValue(warehouses,w=>(Number(w.id)||0)+1,1);
  nextProductSkuNumber=maxArrayValue(products,p=>productSkuSequenceNumber(p.sku)+1,1);
  invoiceCounter=maxArrayValue(salesHistory,s=>(Number(String(s.id||'').replace(/\D/g,''))||0)+1,1);
  quotationCounter=maxArrayValue(quotations,doc=>(Number(String(doc.id||'').replace(/\D/g,'').slice(-4))||0)+1,1);
  poCounter=maxArrayValue(purchaseOrders,doc=>(Number(String(doc.id||'').replace(/\D/g,'').slice(-4))||0)+1,1);
  grCounter=maxArrayValue(goodsReceipts,doc=>(Number(String(doc.id||'').replace(/\D/g,'').slice(-4))||0)+1,1);
  productExchangeCounter=maxArrayValue(productExchanges,doc=>(Number(String(doc.id||'').replace(/\D/g,'').slice(-4))||0)+1,1);
  returnCounter=maxArrayValue(productReturns,doc=>(Number(String(doc.id||'').replace(/\D/g,'').slice(-4))||0)+1,1);
  standaloneTaxInvoiceCounter=maxArrayValue(standaloneTaxInvoices,doc=>(Number(String(doc.number||'').slice(-4))||0)+1,1);
  transferCounter=maxArrayValue(transfers,t=>(Number(String(t.id||'').slice(-4))||0)+1,1);
}
function applyWorkspaceData(saved){
  if(!saved||typeof saved!=='object') return false;
  const validTables=new Set(workspaceRecoveryTables().map(([table])=>table));
  workspaceRecoveryActorId=String(saved._recoveryActorId||'');
  workspaceRecoveryEntries=new Map((Array.isArray(saved._pendingWorkspaceChanges)?saved._pendingWorkspaceChanges:[])
    .filter(entry=>entry&&validTables.has(entry.table)&&entry.id&&(entry.record===null||typeof entry.record==='object'))
    .map(entry=>[`${entry.table}:${entry.id}`,{...entry,id:String(entry.id)}]));
  if(Array.isArray(saved.warehouses)) warehouses=saved.warehouses;
  if(Array.isArray(saved.products)) products=saved.products;
  if(Array.isArray(saved.contacts)) contacts=saved.contacts;
  if(Array.isArray(saved.salesRepresentatives)) salesRepresentatives=saved.salesRepresentatives;
  if(Array.isArray(saved.quotations)) quotations=saved.quotations;
  if(Array.isArray(saved.invoicesAR)) invoicesAR=saved.invoicesAR;
  if(Array.isArray(saved.creditNotes)) creditNotes=saved.creditNotes;
  if(Array.isArray(saved.purchaseOrders)) purchaseOrders=saved.purchaseOrders;
  if(Array.isArray(saved.goodsReceipts)) goodsReceipts=normalizeGoodsReceiptDocuments(saved.goodsReceipts);
  if(Array.isArray(saved.productExchanges)) productExchanges=saved.productExchanges;
  if(Array.isArray(saved.productReturns)) productReturns=saved.productReturns;
  if(Array.isArray(saved.transfers)) transfers=saved.transfers;
  if(Array.isArray(saved.standaloneTaxInvoices)) standaloneTaxInvoices=saved.standaloneTaxInvoices;
  if(Array.isArray(saved.promotions)) promotions=saved.promotions;
  if(Array.isArray(saved.favorites)) favorites=normalizeFavorites(saved.favorites,products);
  if(saved.documentPrefixes&&typeof saved.documentPrefixes==='object'){
    Object.keys(DEFAULT_DOCUMENT_PREFIXES).forEach(key=>{
      documentPrefixes[key]=normalizeDocumentPrefix(saved.documentPrefixes[key],DEFAULT_DOCUMENT_PREFIXES[key]);
    });
  }
  if(Array.isArray(saved.inspectionLists)) inspectionLists=normalizeInspectionLists(saved.inspectionLists);
  if(saved.currentUserProfile&&typeof saved.currentUserProfile==='object') currentUserProfile={...currentUserProfile,...saved.currentUserProfile};
  if(saved.businessSettings&&typeof saved.businessSettings==='object'){
    applyBusinessSettings(saved.businessSettings);
  }
  workspaceRecoveryTables().forEach(([table,getRows,setRows,toRow])=>{
    const baseline=new Map(getRows().map(row=>[String(row.id),JSON.stringify(toRow(row))]));
    if(!Array.isArray(saved._pendingWorkspaceChanges)||(table==='inspection_lists'&&saved._inspectionRecoveryVersion!==1)){
      // Legacy caches have no baseline: reconcile rather than discard edits.
      getRows().forEach(row=>workspaceRecoveryEntries.set(`${table}:${row.id}`,{table,id:String(row.id),baseline:Number(row._revision)?JSON.stringify(toRow(row)):null,record:row,legacy:true}));
    }
    workspaceRecoveryEntries.forEach(entry=>{ if(entry.table!==table) return; if(entry.baseline) baseline.set(entry.id,entry.baseline); else baseline.delete(entry.id); });
    syncedTableRows[table]=baseline;
    const restored=new Map(getRows().map(row=>[String(row.id),row]));
    workspaceRecoveryEntries.forEach(entry=>{
      if(entry.table!==table) return;
      if(entry.record) restored.set(entry.id,entry.record); else restored.delete(entry.id);
      delete entry.detached;
    });
    setRows([...restored.values()]);
  });
  rebuildProductLookupMaps();
  refreshDataCounters();
  saleRef=nextSaleRef();
  return true;
}
function loadWorkspaceData(){
  try{
    let saved=JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)||'null');
    if(Array.isArray(saved?.products)) legacyWorkspaceProducts=saved.products;
    if(saved&&typeof saved==='object'&&Object.hasOwn(saved,'salesHistory')){
      saved={...saved};
      delete saved.salesHistory;
      const cleaned=JSON.stringify(saved);
      safeLocalStorageSet(WORKSPACE_STORAGE_KEY,cleaned,'ข้อมูลระบบ');
    }
    localStorage.removeItem(SALES_STORAGE_KEY);
    applyWorkspaceData(saved);
  }
  catch(error){ console.warn('ไม่สามารถโหลดข้อมูลระบบที่บันทึกไว้ได้',error); }
}
function flushWorkspaceCacheToIndexedDB(){
  const snapshot=workspaceCachePendingSnapshot;
  workspaceCachePendingSnapshot=null;
  if(!snapshot) return workspaceCacheWritePromise;
  const write=async()=>{
    try{
      const db=await openProductCacheDb();
      const transaction=db.transaction(PRODUCT_CACHE_WORKSPACE_STORE,'readwrite');
      const done=idbTransactionDone(transaction);
      const store=transaction.objectStore(PRODUCT_CACHE_WORKSPACE_STORE);
      // Attach a rejection handler immediately: quota/abort may reject before
      // the outbox read callback returns, but must not escape as an unhandled error.
      done.catch(()=>{});
      const versions=await writeWorkspaceOutbox(transaction,store,snapshot);
      const row={key:'current',value:{...snapshot,_outboxVersion:1},savedAt:new Date().toISOString()};
      store.put(row);
      if(snapshot._recoveryActorId) store.put({...row,key:`user:${snapshot._recoveryActorId}`});
      await done;
      if(versions) workspaceOutboxVersions=versions;
      workspaceCacheSaveFailed=false;
      try{ localStorage.removeItem(WORKSPACE_STORAGE_KEY); }catch(_error){}
      return true;
    }catch(error){
      workspaceCacheSaveFailed=true;
      if(!workspaceCachePendingSnapshot) workspaceCachePendingSnapshot=snapshot;
      console.warn('บันทึกแคชข้อมูลระบบลง IndexedDB ไม่สำเร็จ',error);
      rememberSyncUiError(error,{operation:'local_recovery',fallbackMessage:'เก็บข้อมูลลงเครื่องไม่สำเร็จ อย่าเพิ่งปิดหน้านี้'});
      if(typeof showToast==='function') showToast('เก็บข้อมูลลงเครื่องไม่สำเร็จ กรุณาตรวจพื้นที่ว่าง อย่าเพิ่งปิดหน้านี้','danger-top');
      return false;
    }
  };
  workspaceCacheWritePromise=workspaceCacheWritePromise.then(write,write);
  return workspaceCacheWritePromise;
}
function scheduleWorkspaceCacheWrite(){
  clearTimeout(workspacePersistTimer);
  workspacePersistTimer=setTimeout(flushWorkspaceCacheToIndexedDB,120);
}
function persistWorkspaceData(options={}){
  const productChanges=options?.productChanges||null;
  if(productChanges) markProductChangesDirty(productChanges);
  workspaceCachePendingSnapshot=localWorkspaceSnapshot();
  scheduleWorkspaceCacheWrite();
  let productCachePromise=Promise.resolve(true);
  if(productChanges) productCachePromise=persistProductChangesToIndexedDB(productChanges);
  try{ [WAREHOUSE_STORAGE_KEY,CONTACTS_STORAGE_KEY,SALES_STORAGE_KEY,QUOTATION_STORAGE_KEY,TRANSFER_STORAGE_KEY,TAX_INVOICE_STORAGE_KEY,PROMOTIONS_STORAGE_KEY].forEach(key=>localStorage.removeItem(key)); }catch(_error){}
  if(productChanges){
    // Never send a new product/token before its local recovery copy is durable.
    // Otherwise an ambiguous network success followed by a close/reload would
    // lose the only token capable of proving the retry belongs to the same row.
    productCachePromise.then(saved=>{ if(saved) scheduleSupabaseCoreSync(); });
  }else scheduleSupabaseCoreSync();
  return productCachePromise;
}
function schedulePersistWorkspaceData(){
  workspaceCachePendingSnapshot=localWorkspaceSnapshot();
  scheduleWorkspaceCacheWrite();
  scheduleSupabaseCoreSync();
}
// Supabase writes are debounced separately. The incremental synchronizer then
// sends only changed rows instead of the complete catalog.
let supabaseCoreSyncTimer=null;
function scheduleSupabaseCoreSync(){
  clearTimeout(supabaseCoreSyncTimer);
  supabaseCoreSyncTimer=setTimeout(syncCoreDataToSupabase,2500);
}
loadWorkspaceData();
