let lastSyncedSnapshot={};
const syncedTableRows={};
function tableSnapshot(localArray,toRow){
  const snapshot=new Map();
  (localArray||[]).forEach(item=>{
    const row=toRow(item);
    snapshot.set(String(row.id),JSON.stringify(row));
  });
  return snapshot;
}
function seedTableSnapshot(table,localArray,toRow){ syncedTableRows[table]=tableSnapshot(localArray,toRow); }
function seedProductSyncSnapshot(localProducts=products,dirtyOperations=productDirtyOperations){
  const snapshot=tableSnapshot(localProducts,productMetadataToRow);
  for(const [id,operation] of normalizeProductDirtyOperations(dirtyOperations)){
    if(operation==='delete') snapshot.set(id,'__dirty_remote_product__');
    else snapshot.delete(id);
  }
  syncedTableRows.products=snapshot;
}
async function clearAcknowledgedProductDirtyOperations(ids,expectedOperations){
  const expected=normalizeProductDirtyOperations(expectedOperations);
  const removable=(ids||[]).map(String).filter(id=>productDirtyOperations.get(id)===expected.get(id));
  if(!removable.length) return true;
  const next=new Map(productDirtyOperations);
  const removableSet=new Set(removable);
  const expectedRows=tableSnapshot(products.filter(product=>removableSet.has(String(product.id))),productMetadataToRow);
  removable.forEach(id=>next.delete(id));
  const persisted=await persistProductChangesToIndexedDB({updatedIds:removable,deletedIds:removable.filter(id=>!expectedRows.has(id))},next);
  if(!persisted) return false;
  const latestRows=tableSnapshot(products.filter(product=>removableSet.has(String(product.id))),productMetadataToRow);
  removable.forEach(id=>{ if(productDirtyOperations.get(id)===expected.get(id)&&latestRows.get(id)===expectedRows.get(id)) productDirtyOperations.delete(id); });
  return true;
}
async function refreshDocumentInventory(document){
  const items=document?.items||[];
  const productIds=normalizedInventoryProductIds(items.map(item=>item.productId));
  if(!productIds.length) return true;
  const warehouseIds=normalizedInventoryWarehouseIds([document?.warehouseId,...items.map(item=>item.warehouseId)]);
  const scope={productIds,warehouseIds:warehouseIds.length?warehouseIds:inventoryScopeWarehouseIds(),force:true};
  try{
    const results=await Promise.all([loadInventoryBalancesFromSupabase(scope),loadInventoryLotsFromSupabase(scope)]);
    if(results.every(Boolean)) return true;
  }catch(error){ console.warn('refresh document inventory',error); }
  // The stock transaction has already committed. A read failure must not tell
  // the cashier that the sale/return failed or invite a duplicate transaction.
  showToast('บันทึกรายการแล้ว แต่โหลดสต๊อกล่าสุดไม่สำเร็จ กรุณารีเฟรชข้อมูล','warning-top');
  return false;
}
function cloneSyncRecords(records){ return JSON.parse(JSON.stringify(records||[])); }
function revisionedLiveRows(table,fallback){
  return typeof workspaceRecoveryTables==='function'?workspaceRecoveryTables().find(([name])=>name===table)?.[1]()||fallback:fallback;
}
function withRevisionedTableLock(table,work){
  const locks=withRevisionedTableLock.pending||(withRevisionedTableLock.pending=new Map());
  const previous=locks.get(table)||Promise.resolve();
  const next=previous.catch(()=>{}).then(work);
  locks.set(table,next);
  const release=()=>{ if(locks.get(table)===next) locks.delete(table); };
  next.then(release,release);
  return next;
}
function syncAcknowledgement(table,localArray,toRow){
  // Only detached payloads acknowledged by the server become the baseline.
  return item=>{
    const snapshot=syncedTableRows[table]||(syncedTableRows[table]=new Map());
    const live=revisionedLiveRows(table,localArray).find(row=>String(row.id)===String(item.id));
    if(live){
      live._revision=Number(item._revision)||Number(live._revision)||0;
      if(item._clientCreateToken) live._clientCreateToken=item._clientCreateToken;
      if(table==='contacts'&&item.code&&!live.code){ live.code=item.code; delete live._autoCode; }
    }
    if(typeof workspaceRecoveryEntries!=='undefined') workspaceRecoveryEntries.delete(`${table}:${item.id}`);
    snapshot.set(String(item.id),JSON.stringify(toRow(item)));
    if(table==='products'&&typeof persistProductChangesToIndexedDB==='function') persistProductChangesToIndexedDB({updatedIds:[item.id]});
    else if(typeof scheduleWorkspaceCacheWrite==='function'){
      workspaceCachePendingSnapshot=localWorkspaceSnapshot(); scheduleWorkspaceCacheWrite();
    }
  };
}
async function upsertRowsInChunks(table,rows){
  for(let i=0;i<rows.length;i+=200){
    const {error}=await sb.from(table).upsert(rows.slice(i,i+200));
    if(error) return error;
  }
  return null;
}
function persistentSyncPauseMap(owner,kind){
  const actor=typeof currentProfile==='undefined'?'':String(currentProfile?.id||'');
  if(owner.paused&&owner.pausedActor===actor) return owner.paused;
  const storageKey=`pepos_sync_pauses_v1:${actor}:${kind}`;
  let entries=[];
  try{ entries=JSON.parse(localStorage.getItem(storageKey)||'[]'); }catch{}
  const paused=new Map(Array.isArray(entries)?entries.filter(row=>Array.isArray(row)&&row.length===2).slice(-256):[]);
  let scheduled=false;
  const persist=()=>{
    if(scheduled) return; scheduled=true;
    Promise.resolve().then(()=>{
      scheduled=false;
      try{
        const recent=[...paused].slice(-256);
        let json=JSON.stringify(recent);
        // Bound this optional retry cache, not the durable drafts in IndexedDB.
        while(json.length>65536&&recent.length){recent.shift();json=JSON.stringify(recent);}
        localStorage.setItem(storageKey,json);
      }catch{}
    });
  };
  paused.set=(key,value)=>{Map.prototype.set.call(paused,key,value);persist();return paused;};
  paused.delete=key=>{const removed=Map.prototype.delete.call(paused,key);if(removed)persist();return removed;};
  paused.clear=()=>{Map.prototype.clear.call(paused);persist();};
  owner.paused=paused; owner.pausedActor=actor;
  return paused;
}
function productCreateTokenFromRow(row){
  return String(row?.data?._clientCreateToken||'').trim();
}
function canonicalProductInsertValue(value){
  if(Array.isArray(value)) return value.map(canonicalProductInsertValue);
  if(value&&typeof value==='object'){
    const canonical={};
    Object.keys(value).sort().forEach(key=>{ if(value[key]!==undefined) canonical[key]=canonicalProductInsertValue(value[key]); });
    return canonical;
  }
  return typeof value==='number'&&!Number.isFinite(value)?null:value;
}
function productInsertMetadataRow(row){
  const data={...(row?.data||{})};
  delete data.stock;
  delete data._catalogExpiry;
  return {
    id:row?.id,
    sku:row?.sku??null,
    name:row?.name||'',
    category:row?.category??null,
    brand:row?.brand??null,
    product_type:row?.product_type??null,
    warehouse_id:row?.warehouse_id??null,
    cost:Number(row?.cost)||0,
    price:Number(row?.price)||0,
    unit:row?.unit??null,
    data,
  };
}
function canonicalProductInsertSignature(row){
  return JSON.stringify(canonicalProductInsertValue(productInsertMetadataRow(row)));
}
function productInsertCollisionError(id){
  const error=new Error(`รหัสอ้างอิงสินค้า ${id} ชนกับสินค้าคนละรายการ ระบบหยุดซิงก์เพื่อป้องกันข้อมูลถูกเขียนทับ`);
  error.code='PRODUCT_ID_COLLISION';
  error.productId=id;
  return error;
}
function productBarcodeConstraintError(error){
  if(String(error?.code)!=='23505'||!/product_barcode_unique|duplicate_product_barcode/i.test([error.message,error.hint,error.constraint].join(' '))) return null;
  let detail={};try{detail=JSON.parse(error.details||'{}');}catch{}
  return Object.assign(new Error(error.message||'บาร์โค้ดซ้ำกับสินค้าอื่น กรุณาแก้บาร์โค้ดก่อนบันทึกใหม่'),{
    code:'DUPLICATE_PRODUCT_BARCODE',productId:detail.productId,recordId:detail.productId,
  });
}
async function verifyProductInsertChunk(table,rows){
  const ids=(rows||[]).map(row=>row.id);
  const {data,error}=await sb.from(table).select('id,sku,name,category,brand,product_type,warehouse_id,cost,price,unit,data').in('id',ids);
  if(error) return {error,missing:[],metadataMismatches:[]};
  const remoteById=new Map((data||[]).map(row=>[String(row.id),row]));
  const missing=[],metadataMismatches=[];
  for(const row of rows||[]){
    const remote=remoteById.get(String(row.id));
    if(!remote){ missing.push(row); continue; }
    const localToken=productCreateTokenFromRow(row);
    const remoteToken=productCreateTokenFromRow(remote);
    // The token is immutable creation identity. Other fields may legitimately
    // change after the first insert (stock RPC, metadata edit) before retry.
    if(!localToken||!remoteToken||localToken!==remoteToken){
      return {error:productInsertCollisionError(row.id),missing:[],metadataMismatches:[]};
    }
    if(canonicalProductInsertSignature(row)!==canonicalProductInsertSignature(remote)){
      // Creation identity proves only that INSERT succeeded, never that our
      // older metadata may overwrite a later edit from another device.
      const conflict=new Error(`สินค้า ${row.sku||row.id} ถูกสร้างแล้วแต่ข้อมูลต่างจากเซิร์ฟเวอร์ เก็บงานในเครื่องไว้เพื่อตรวจเทียบ`);
      conflict.code='REVISION_CONFLICT'; conflict.productId=row.id; conflict.recordId=row.id;
      return {error:conflict,missing:[],metadataMismatches:[]};
    }
  }
  return {error:null,missing,metadataMismatches};
}
async function insertRowsInChunks(table,rows){
  const paused=typeof persistentSyncPauseMap==='function'?persistentSyncPauseMap(insertRowsInChunks,'product-inserts'):(insertRowsInChunks.paused||=new Map());
  for(let i=0;i<rows.length;i+=200){
    let pending=rows.slice(i,i+200),lastError=null;
    for(const row of pending){
      const saved=paused.get(String(row.id));
      if(saved?.fingerprint===canonicalProductInsertSignature(row)) return Object.assign(new Error(saved.message),{code:saved.code||'REVISION_CONFLICT',productId:row.id,recordId:row.id,syncPaused:true});
    }
    for(let attempt=0;attempt<3&&pending.length;attempt++){
      const {error}=await sb.from(table).insert(pending);
      if(!error){ pending.forEach(row=>paused.delete(String(row.id))); pending=[]; break; }
      lastError=error;
      if(table!=='products') return error;
      const duplicate=productBarcodeConstraintError(error);
      if(duplicate){
        const row=pending.find(row=>String(row.id)===String(duplicate.productId));
        if(row) paused.set(String(row.id),{fingerprint:canonicalProductInsertSignature(row),code:duplicate.code,message:duplicate.message});
        return duplicate;
      }
      const verification=await verifyProductInsertChunk(table,pending);
      if(verification.error){
        if(verification.error.code==='REVISION_CONFLICT'){
          const row=pending.find(row=>String(row.id)===String(verification.error.productId));
          if(row) paused.set(String(row.id),{fingerprint:canonicalProductInsertSignature(row),message:verification.error.message});
        }
        return verification.error;
      }
      pending.filter(row=>!verification.missing.some(missing=>String(missing.id)===String(row.id))).forEach(row=>paused.delete(String(row.id)));
      // A previous ambiguous request may have committed only the earlier rows
      // or chunks. Retry only rows that are still absent; never update matches.
      pending=verification.missing;
    }
    if(pending.length) return lastError||new Error('บันทึกสินค้าใหม่ไม่สำเร็จ');
  }
  return null;
}
async function updateProductMetadataInChunks(productRows,onAcknowledged=()=>{}){
  // Pause unchanged conflicts in this session, without dropping the durable
  // dirty queue. A new revision/draft or explicit reload permits another try.
  const paused=typeof persistentSyncPauseMap==='function'?persistentSyncPauseMap(updateProductMetadataInChunks,'product-updates'):(updateProductMetadataInChunks.paused||=new Map());
  const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
  const content=row=>{ const {revision,...metadata}=row; return stable(metadata); };
  let firstConflict=null;
  for(let i=0;i<productRows.length;i+=12){
    const batch=productRows.slice(i,i+12);
    const results=await Promise.all(batch.map(async product=>{
      const row=productMetadataToRow(product),{id,revision,...changes}=row;
      const key=String(id),fingerprint=stable(row);
      if(paused.get(key)===fingerprint) return {data:null,paused:true};
      const saved=paused.get(key);
      if(saved?.fingerprint===fingerprint) return {data:null,error:Object.assign(new Error(saved.message),{code:saved.code,productId:id,recordId:id,syncPaused:true})};
      const checkBarcodeError=result=>{
        if(!result.error) return result;
        const duplicate=productBarcodeConstraintError(result.error);
        if(!duplicate) return result;
        duplicate.productId=id; duplicate.recordId=id;
        paused.set(key,{fingerprint,code:duplicate.code,message:duplicate.message});
        return {...result,error:duplicate};
      };
      const result=await sb.from('products').update(changes).eq('id',id).eq('revision',revision).select('id,revision').maybeSingle();
      if(result.error||result.data){ if(result.data) paused.delete(key); return checkBarcodeError(result); }
      const remote=await sb.from('products').select('*').eq('id',id).maybeSingle();
      if(remote.error) return remote;
      if(remote.data){
        const canonical=productMetadataToRow(rowToProduct(remote.data));
        // A previously successful write may have lost its response. Identical
        // metadata is already saved; acknowledge it without another write.
        if(content(canonical)===content(row)){
          paused.delete(key);
          return {data:{id,revision:remote.data.revision}};
        }
        const baseline=syncedTableRows.products?.get(key);
        let previous=null;
        try{ previous=JSON.parse(baseline||'null'); }catch(error){}
        // Stock/LOT operations also bump revision. Rebase only when ALL
        // catalog fields still match our known baseline, then use CAS again.
        if(previous&&content(previous)===content(canonical)){
          const retried=await sb.from('products').update(changes).eq('id',id).eq('revision',remote.data.revision).select('id,revision').maybeSingle();
          if(retried.error||retried.data){ if(retried.data) paused.delete(key); return checkBarcodeError(retried); }
        }
      }
      paused.set(key,fingerprint);
      return {data:null};
    }));
    results.forEach((result,index)=>{
      if(result.error||!result.data) return;
      batch[index]._revision=Number(result.data.revision)||Number(batch[index]._revision)||1;
      onAcknowledged(batch[index]);
    });
    const failed=results.find(result=>result.error);
    if(failed) return failed.error;
    const conflictIndex=results.findIndex(result=>!result.data);
    if(conflictIndex>=0){
      const error=new Error(`สินค้า ${batch[conflictIndex]?.sku||batch[conflictIndex]?.id} มีข้อมูลต่างจากเซิร์ฟเวอร์ — เก็บการแก้ไขไว้และพักส่งรายการนี้ กรุณาตรวจสอบก่อนโหลดข้อมูลล่าสุด`);
      error.code='REVISION_CONFLICT'; error.productId=batch[conflictIndex]?.id;
      error.syncPaused=results.filter(result=>!result.data).every(result=>result.paused);
      if(!firstConflict||firstConflict.syncPaused&&!error.syncPaused) firstConflict=error;
    }
  }
  return firstConflict;
}
function revisionConflictError(table,id){
  const error=new Error(`${SYNC_TABLE_LABELS[table]||table} รายการ ${id} มีข้อมูลหรือเวอร์ชันต่างจากเซิร์ฟเวอร์ เก็บงานไว้ในเครื่องแล้ว กรุณาตรวจเทียบก่อนเลือกข้อมูล`);
  error.code='REVISION_CONFLICT';
  error.recordId=id;
  return error;
}
function revisionedRecordFromRow(table,row){
  if(table==='contacts') return rowToContact(row);
  if(table==='sales_representatives') return rowToSalesRep(row);
  if(table==='inspection_lists') return rowToInspectionList(row);
  if(typeof DOC_TABLES!=='undefined'&&DOC_TABLES.some(([name])=>name===table)) return rowToDoc(row);
  throw new Error('ไม่รองรับการตรวจเทียบตาราง '+table);
}
function revisionedContentMatches(table,local,remote,toRow,remoteSource=null){
  const content=record=>{
    const row=toRow(record); delete row.revision;
    if(table==='contacts'&&remoteSource&&!Object.hasOwn(local,'loyaltyJoinedAt')&&!Object.hasOwn(remoteSource.data||{},'loyaltyJoinedAt')){
      row.data={...row.data}; delete row.data.loyaltyJoinedAt;
    }
    return canonicalProductInsertValue(row);
  };
  return JSON.stringify(content(local))===JSON.stringify(content(remote));
}
async function insertRevisionedRows(table,items,toRow,onAcknowledged=()=>{}){
  for(let index=0;index<items.length;index+=100){
    const batch=items.slice(index,index+100);
    batch.forEach(item=>{ if(!item._clientCreateToken) item._clientCreateToken=generateProductCreateToken(); });
    const rows=batch.map(item=>{ const {revision,...row}=toRow(item); return row; });
    const {data,error}=await sb.from(table).insert(rows).select('id,revision,data');
    if(error){
      // A retry may hit either the ID or phone index of our own committed row.
      // Verify ownership/content first; real collisions retain the original code.
      const ids=rows.map(row=>row.id);
      const verification=await sb.from(table).select('*').in('id',ids);
      if(verification.error) return error;
      const remoteById=new Map((verification.data||[]).map(row=>[String(row.id),row]));
      for(const item of batch){
        const remote=remoteById.get(String(item.id));
        if(!remote||String(remote.data?._clientCreateToken||'')!==String(item._clientCreateToken||'')) return error;
        const remoteRecord=revisionedRecordFromRow(table,remote);
        const comparable={...item};
        if(table==='contacts'&&remote.data?.code&&!comparable.code){ comparable.code=remote.data.code; delete comparable._autoCode; }
        if(!revisionedContentMatches(table,comparable,remoteRecord,toRow,remote)) return String(error.code||'')==='23505'&&/contacts_customer_phone_unique/.test([error.message,error.details,error.constraint].join(' '))?error:revisionConflictError(table,item.id);
        item._revision=Number(remote.revision)||1;
        if(table==='contacts'&&remote.data?.code){ item.code=remote.data.code; delete item._autoCode; }
        onAcknowledged(item);
      }
      continue;
    }
    const revisionById=new Map((data||[]).map(row=>[String(row.id),Number(row.revision)||1]));
    const remoteById=new Map((data||[]).map(row=>[String(row.id),row]));
    batch.forEach(item=>{
      item._revision=revisionById.get(String(item.id))||1;
      if(table==='contacts'&&remoteById.get(String(item.id))?.data?.code){ item.code=remoteById.get(String(item.id)).data.code; delete item._autoCode; }
      onAcknowledged(item);
    });
  }
  return null;
}
async function updateRevisionedRows(table,items,toRow,onAcknowledged=()=>{}){
  for(let index=0;index<items.length;index+=12){
    const batch=items.slice(index,index+12);
    const results=await Promise.all(batch.map(async item=>{
      const row=toRow(item),{id,revision,...changes}=row;
      const result=await sb.from(table).update(changes).eq('id',id).eq('revision',revision).select('id,revision').maybeSingle();
      if(result.error||result.data) return result;
      const remote=await sb.from(table).select('*').eq('id',id).maybeSingle();
      if(remote.error) return remote;
      if(remote.data&&revisionedContentMatches(table,item,revisionedRecordFromRow(table,remote.data),toRow,remote.data)) return {data:remote.data,error:null};
      return result;
    }));
    results.forEach((result,index)=>{
      if(result.error||!result.data) return;
      batch[index]._revision=Number(result.data.revision)||Number(batch[index]._revision)||1;
      onAcknowledged(batch[index]);
    });
    const failed=results.find(result=>result.error);
    if(failed) return failed.error;
    const conflictIndex=results.findIndex(result=>!result.data);
    if(conflictIndex>=0) return revisionConflictError(table,batch[conflictIndex]?.id);
    results.forEach((result,resultIndex)=>{ batch[resultIndex]._revision=Number(result.data?.revision)||Number(batch[resultIndex]._revision)||1; });
  }
  return null;
}
async function deleteRevisionedRows(table,deletedIds,previous,onAcknowledged=()=>{}){
  for(const id of deletedIds){
    let previousRow={};
    try{ previousRow=JSON.parse(previous.get(String(id))||'{}'); }catch(error){}
    const revision=Number(previousRow.revision)||0;
    if(!revision) return revisionConflictError(table,id);
    const {data,error}=await sb.from(table).delete().eq('id',id).eq('revision',revision).select('id');
    if(error) return error;
    if(!(data||[]).length){
      // These master tables are SELECT-visible to authenticated users. A
      // successful authoritative read can distinguish already deleted from
      // a changed revision; never retry with the newer revision automatically.
      const remote=await sb.from(table).select('id,revision').eq('id',id).maybeSingle();
      if(remote.error) return remote.error;
      if(remote.data||!['contacts','sales_representatives'].includes(table)) return revisionConflictError(table,id);
    }
    onAcknowledged(String(id));
  }
  return null;
}
// Sync only rows changed since this device last loaded/saved them. Deletions
// are derived from that same baseline, never by comparing against every remote
// id, so a stale device cannot delete records created by another device.
async function upsertAndPrune(table,localArray,toRow){
  return withRevisionedTableLock(table,async()=>{
  localArray=revisionedLiveRows(table,localArray);
  // Old caches must be compared, not treated as edits to every contact.
  if(typeof reconcileLegacyWorkspaceRows==='function'){
    await reconcileLegacyWorkspaceRows(table,localArray,toRow);
    localArray=revisionedLiveRows(table,localArray);
  }
  const previous=syncedTableRows[table]||new Map();
  const current=tableSnapshot(localArray,toRow);
  const changedLive=(localArray||[]).filter(item=>{
    if(workspaceRecoveryEntries.get(`${table}:${item.id}`)?.legacy) return false;
    const row=toRow(item);
    return previous.get(String(row.id))!==JSON.stringify(row);
  });
  changedLive.forEach(item=>{ if(!(Number(item._revision)||0)&&!item._clientCreateToken) item._clientCreateToken=generateProductCreateToken(); });
  const changed=cloneSyncRecords(changedLive);
  if(changed.length||[...previous.keys()].some(id=>!current.has(id))) await ensureWorkspaceRecoveryDurable();
  const acknowledge=syncAcknowledgement(table,localArray,toRow);
  const deleted=[...previous.keys()].filter(id=>!current.has(id));
  const paused=typeof persistentSyncPauseMap==='function'?persistentSyncPauseMap(upsertAndPrune,'master'):(upsertAndPrune.paused||=new Map());
  const work=[...changed.map(item=>({id:String(item.id),item})),...deleted.map(id=>({id,remove:true}))];
  // Unknown legacy edits are retained for review, never silently called synced.
  for(const entry of workspaceRecoveryEntries.values()) if(entry.table===table&&entry.legacy&&!work.some(row=>row.id===entry.id)) work.push({id:entry.id,legacy:entry});
  let failure=null;
  const fail=(error,job)=>{
    error.recordId=job.id;
    if(!failure||failure.error.syncPaused&&!error.syncPaused) failure={error,operation:job.remove?'delete_rows':'upsert_rows',tableName:table,recordId:job.id};
  };
  for(let offset=0;offset<work.length;offset+=12){
    await Promise.all(work.slice(offset,offset+12).map(async job=>{
      const key=`${table}:${job.id}`,fingerprint=JSON.stringify(job.remove?{remove:true,baseline:previous.get(job.id)}:job.legacy||toRow(job.item));
      if(paused.get(key)?.fingerprint===fingerprint){ fail(Object.assign(new Error(paused.get(key).message),{code:paused.get(key).code,syncPaused:true}),job); return; }
      let error;
      try{
        if(job.legacy) error=revisionConflictError(table,job.id);
        else if(job.remove){
          const deleted=[job.id];
          error=await deleteRevisionedRows(table,deleted,previous,id=>{ syncedTableRows[table].delete(id); workspaceRecoveryEntries.delete(`${table}:${id}`); });
        }else{
          const inserts=Number(job.item._revision)?[]:[job.item],updates=Number(job.item._revision)?[job.item]:[];
          error=(inserts.length?await insertRevisionedRows(table,inserts,toRow,acknowledge):null)||(updates.length?await updateRevisionedRows(table,updates,toRow,acknowledge):null);
        }
      }catch(cause){ error=cause; }
      if(error){
        if(['REVISION_CONFLICT','23505'].includes(String(error.code))) paused.set(key,{fingerprint,code:error.code,message:error.message});
        fail(error,job);
      }else paused.delete(key);
    }));
  }
  if(work.length) await ensureWorkspaceRecoveryDurable();
  if(failure) return noteCoreSyncFailure(failure.error,failure);
  return true;
  });
}
async function syncWarehousesIncrementally(){
  const table='warehouses';
  const previous=syncedTableRows[table]||new Map();
  const current=tableSnapshot(warehouses,warehouseToRow);
  const changed=warehouses.filter(warehouse=>{
    const row=warehouseToRow(warehouse);
    return previous.get(String(row.id))!==JSON.stringify(row);
  });
  const deleted=[...previous.keys()].filter(id=>!current.has(id));
  if(!changed.length&&!deleted.length) return true;
  for(const warehouse of changed){
    const row=warehouseToRow(warehouse);
    const {error}=await sb.rpc('owner_upsert_warehouse',{
      p_id:Number(row.id)||null,
      p_name:row.name,
      p_data:row.data,
    });
    if(error){ console.warn('sync warehouse',row.id,error); return noteCoreSyncFailure(error,{operation:'owner_upsert_warehouse',tableName:table,recordId:row.id,fallbackMessage:'ซิงก์คลังสินค้าไม่สำเร็จ'}); }
  }
  for(const id of deleted){
    const {error}=await sb.rpc('owner_delete_warehouse',{p_id:Number(id)});
    if(error){ console.warn('sync delete warehouse',id,error); return noteCoreSyncFailure(error,{operation:'owner_delete_warehouse',tableName:table,recordId:id,fallbackMessage:'ลบคลังสินค้าจากเซิร์ฟเวอร์ไม่สำเร็จ'}); }
  }
  syncedTableRows[table]=current;
  return true;
}
async function prepareProductInsertCandidatesForSync(previous){
  // Older caches can contain a product that predates dirty-operation tracking.
  // Give every row that this sync will classify as a new insert the same durable
  // identity marker as an explicitly dirty insert before any network request.
  const implicitInsertCandidates=products.filter(product=>{
    const id=String(product.id);
    return !productDirtyOperations.has(id)&&!previous.has(id);
  });
  const tokenlessDirtyInserts=products.filter(product=>productDirtyOperations.get(String(product.id))==='insert'&&!String(product._clientCreateToken||'').trim());
  const insertPreparationProducts=[...new Map([...implicitInsertCandidates,...tokenlessDirtyInserts].map(product=>[String(product.id),product])).values()];
  if(insertPreparationProducts.length){
    const operationAssignments=implicitInsertCandidates.map(product=>({id:String(product.id),hadOperation:productDirtyOperations.has(String(product.id)),previousOperation:productDirtyOperations.get(String(product.id))}));
    operationAssignments.forEach(entry=>{ productDirtyOperations.set(entry.id,'insert'); });
    const tokenAssignments=insertPreparationProducts.filter(product=>!String(product._clientCreateToken||'').trim()).map(product=>({product,hadToken:Object.hasOwn(product,'_clientCreateToken'),previousToken:product._clientCreateToken,token:generateProductCreateToken()}));
    tokenAssignments.forEach(entry=>{ entry.product._clientCreateToken=entry.token; });
    const tokenCacheSaved=await persistProductChangesToIndexedDB({updatedIds:insertPreparationProducts.map(product=>product.id)});
    if(!tokenCacheSaved){
      tokenAssignments.forEach(entry=>{ if(entry.hadToken) entry.product._clientCreateToken=entry.previousToken; else delete entry.product._clientCreateToken; });
      operationAssignments.forEach(entry=>{ if(entry.hadOperation) productDirtyOperations.set(entry.id,entry.previousOperation); else productDirtyOperations.delete(entry.id); });
      console.warn('sync new products: creation token cache failed');
      if(typeof noteCoreSyncFailure==='function') return noteCoreSyncFailure(new Error('บันทึกรหัสป้องกันสินค้าใหม่ชนกันลงเครื่องไม่สำเร็จ'),{operation:'prepare_product_insert',tableName:'products'});
      return false;
    }
  }
  return true;
}
async function syncProductsIncrementally(){
  const table='products';
  const previous=syncedTableRows[table]||new Map();
  if(!await prepareProductInsertCandidatesForSync(previous)) return false;
  const current=tableSnapshot(products,productMetadataToRow);
  const dirtyAtStart=new Map(productDirtyOperations);
  const changed=cloneSyncRecords(products.filter(product=>previous.get(String(product.id))!==current.get(String(product.id))));
  const acknowledge=syncAcknowledgement(table,products,productMetadataToRow);
  const inserted=changed.filter(product=>dirtyAtStart.get(String(product.id))==='insert'||(!dirtyAtStart.has(String(product.id))&&!previous.has(String(product.id))));
  const updated=changed.filter(product=>dirtyAtStart.get(String(product.id))==='update'||(!dirtyAtStart.has(String(product.id))&&previous.has(String(product.id))));
  const deleted=[...previous.keys()].filter(id=>!current.has(id));
  let productUpdateError=null;
  if(updated.length){
    const error=await updateProductMetadataInChunks(updated,acknowledge);
    if(error){
      if(error.code!=='REVISION_CONFLICT') return noteCoreSyncFailure(error,{operation:'update_products',tableName:table,recordId:error.productId||'',fallbackMessage:'แก้ไขสินค้าบนเซิร์ฟเวอร์ไม่สำเร็จ'});
      productUpdateError=error;
    }
  }
  if(inserted.length){
    // New client-generated ids must fail closed on a primary-key collision.
    // Upsert would silently replace the product created by another device.
    const error=await insertRowsInChunks(table,inserted.map(productToRow));
    if(error){ console.warn('sync new products',error); return noteCoreSyncFailure(error,{operation:'insert_products',tableName:table,recordId:error.productId||'',fallbackMessage:'เพิ่มสินค้าใหม่บนเซิร์ฟเวอร์ไม่สำเร็จ'}); }
    const {data:insertedRevisions,error:revisionError}=await sb.from('products').select('id,revision').in('id',inserted.map(product=>product.id));
    if(revisionError){ console.warn('load new product revisions',revisionError); return noteCoreSyncFailure(revisionError,{operation:'load_product_revisions',tableName:table,fallbackMessage:'ตรวจสอบข้อมูลสินค้าใหม่ไม่สำเร็จ'}); }
    const revisions=new Map((insertedRevisions||[]).map(row=>[String(row.id),Number(row.revision)||1]));
    inserted.forEach(product=>{ product._revision=revisions.get(String(product.id))||1; acknowledge(product); });
  }
  if(deleted.length){
    const {error}=await sb.from(table).delete().in('id',deleted);
    if(error){ console.warn('sync delete products',error); return noteCoreSyncFailure(error,{operation:'delete_products',tableName:table,fallbackMessage:'ลบสินค้าจากเซิร์ฟเวอร์ไม่สำเร็จ'}); }
    deleted.forEach(id=>syncedTableRows[table].delete(id));
  }
  const acknowledgedDirtyIds=[];
  for(const [id,operation] of dirtyAtStart){
    const unchangedOperation=productDirtyOperations.get(id)===operation;
    const live=products.find(product=>String(product.id)===id);
    const unchangedProduct=operation==='delete'?!live:syncedTableRows[table].get(id)===JSON.stringify(productMetadataToRow(live||{}));
    if(operation==='insert'&&!unchangedProduct&&syncedTableRows[table].has(id)) productDirtyOperations.set(id,live?'update':'delete');
    if(unchangedOperation&&unchangedProduct) acknowledgedDirtyIds.push(id);
  }
  if(acknowledgedDirtyIds.length){
    const dirtyStatePersisted=await clearAcknowledgedProductDirtyOperations(acknowledgedDirtyIds,dirtyAtStart);
    if(!dirtyStatePersisted){ seedProductSyncSnapshot(products,productDirtyOperations); return noteCoreSyncFailure(new Error('บันทึกสถานะสินค้าที่ซิงก์แล้วลงเครื่องไม่สำเร็จ'),{operation:'persist_product_sync_state',tableName:table}); }
  }
  if(changed.length) await persistProductChangesToIndexedDB({updatedIds:changed.map(product=>product.id)});
  if(productUpdateError) return noteCoreSyncFailure(productUpdateError,{operation:'update_products',tableName:table,recordId:productUpdateError.productId||'',fallbackMessage:'มีสินค้ารอตรวจสอบข้อมูลที่ขัดแย้ง'});
  return true;
}
