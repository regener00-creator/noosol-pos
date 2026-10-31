let coreSyncInFlight=false, coreSyncPending=false;
// Simple id+data-jsonb document tables (Milestone 5) -- same shape, no extra
// reporting columns needed for these yet.
function docToRow(doc){ const {createdByUserId,_revision,...data}=doc||{}; return {id:doc?.id,data,revision:Number(_revision)||0}; }
function rowToDoc(row){ return { ...(row.data||{}), id:row.id, _revision:Number(row.revision)||1, ...(row.created_by?{createdByUserId:String(row.created_by)}:{}) }; }
async function recoverProductExchangeRevision(doc){
  if(Number(doc?._revision)>0||doc?.outgoingApplied!==true) return;
  const table='product_exchanges',key=String(doc.id);
  const baselineText=syncedTableRows[table]?.get(key);
  const baseline=baselineText?JSON.parse(baselineText):null;
  // Older stock responses lost the revision; legacy outboxes can also lack
  // their acknowledged baseline entirely after a reload.
  const {data,error}=await sb.from(table).select('*').eq('id',doc.id).maybeSingle();
  if(error) throw error;
  const comparable=value=>JSON.stringify(stableJsonValue(cloudClean(docToRow(value).data)));
  const remote=data?rowToDoc(data):null;
  const baselineMatches=remote&&baseline?.data?.outgoingApplied===true&&comparable(baseline.data)===comparable(remote);
  // Without a usable baseline, accept only the very same posted shipment with
  // no receipt work on the server. All fields except the new local receipt
  // lines must match, including the server-issued outgoing transaction time.
  const shipmentData=value=>{
    const {incomingItems,unreturnedItems,...shipment}=value;
    return comparable(shipment);
  };
  const untouchedReceiptMatches=remote&&doc.status==='ส่งไปเปลี่ยนแล้ว'&&remote.status===doc.status&&
    doc.incomingApplied===false&&remote.incomingApplied===false&&
    typeof doc.outgoingAppliedAt==='string'&&doc.outgoingAppliedAt.length>0&&
    Array.isArray(remote.incomingItems)&&remote.incomingItems.length===0&&
    (remote.unreturnedItems===undefined||Array.isArray(remote.unreturnedItems)&&remote.unreturnedItems.length===0)&&
    shipmentData(doc)===shipmentData(remote);
  if(!baselineMatches&&!untouchedReceiptMatches){
    const conflict=new Error('เอกสารเปลี่ยนสินค้าบนเซิร์ฟเวอร์เปลี่ยนแล้ว กรุณาตรวจเทียบงานรอซิงก์ก่อนบันทึก');
    conflict.code='REVISION_CONFLICT'; conflict.recordId=key; throw conflict;
  }
  doc._revision=remote._revision;
  if(remote.createdByUserId) doc.createdByUserId=remote.createdByUserId;
  if(typeof productExchangeDraft!=='undefined'&&productExchangeDraft?.id===doc.id&&!Number(productExchangeDraft._revision)){
    productExchangeDraft._revision=remote._revision;
  }
  (syncedTableRows[table]||=new Map()).set(key,JSON.stringify(docToRow(remote)));
  const pending=workspaceRecoveryEntries.get(`${table}:${key}`);
  if(pending) pending.baseline=JSON.stringify(docToRow(remote));
}
const DOC_TABLES = [
  ['quotations', ()=>quotations, v=>{quotations=v;}],
  ['invoices_ar', ()=>invoicesAR, v=>{invoicesAR=v;}],
  ['credit_notes', ()=>creditNotes, v=>{creditNotes=v;}],
  ['purchase_orders', ()=>purchaseOrders, v=>{purchaseOrders=v;}],
  ['goods_receipts', ()=>goodsReceipts, v=>{goodsReceipts=v;}],
  ['product_exchanges', ()=>productExchanges, v=>{productExchanges=v;}],
  ['product_returns', ()=>productReturns, v=>{productReturns=v;}],
  ['transfers', ()=>transfers, v=>{transfers=v;}],
  ['standalone_tax_invoices', ()=>standaloneTaxInvoices, v=>{standaloneTaxInvoices=v;}],
];
const DOCUMENT_QUERY_PAGE_SIZE=250;
const DOCUMENT_QUERY_MAX_ROWS=1000;
const DOCUMENT_CACHE_TTL_MS=60000;
const DOCUMENT_MEMORY_ROW_LIMIT=2500;
const documentFreshRequests=new Map();
const documentLoadStates=Object.fromEntries(DOC_TABLES.map(([table])=>[table,{loaded:false,full:false,recent:false,ranges:[],recentTruncated:false,truncatedRanges:[]}]));
const documentLoadPromises=new Map();
function documentTableEntry(table){ return DOC_TABLES.find(([name])=>name===table)||null; }
function resetDocumentLoadStates(){
  documentFreshRequests.clear();
  Object.values(documentLoadStates).forEach(state=>{ state.loaded=false; state.full=false; state.recent=false; state.ranges=[]; state.recentTruncated=false; state.truncatedRanges=[]; });
  documentLoadPromises.clear();
  DOC_TABLES.forEach(([table])=>{ delete syncedTableRows[table]; });
}
function mergeRowsById(current,incoming){
  const rows=new Map((current||[]).map(row=>[String(row.id),row]));
  (incoming||[]).forEach(row=>rows.set(String(row.id),row));
  return [...rows.values()].sort((a,b)=>String(b.id||'').localeCompare(String(a.id||'')));
}
function documentRequestLoaded(table,{range=null,recent=false,full=false}={}){
  const state=documentLoadStates[table];
  if(!state) return true;
  const fresh=(documentFreshRequests.get(table)||[]).some(item=>isWorkspaceReadCurrent(item.context)&&Date.now()-item.at<DOCUMENT_CACHE_TTL_MS&&
    (item.full||(!full&&(!range||item.range&&item.range.from<=range.from&&item.range.to>=range.to)&&(!recent||item.recent))));
  if(!fresh) return false;
  if(state.full) return true;
  if(full) return false;
  if(range) return rangeCoveredBy(state.ranges,range);
  return recent?state.recent:state.loaded;
}
function documentRequestTruncated(table,{range=null,recent=false}={}){
  const state=documentLoadStates[table];
  if(!state||state.full) return false;
  if(range&&rangeOverlapsAny(state.truncatedRanges,range)) return true;
  return !!recent&&state.recentTruncated;
}
async function loadDocumentTableFromSupabase(table,{range=null,recent=false,full=false,force=false,readStatus=null}={}){
  const context=captureWorkspaceRead();
  const entry=documentTableEntry(table),state=documentLoadStates[table];
  if(!entry||!state) return false;
  const normalizedRange=range?serverDateRange(range.from,range.to):null;
  const request={range:normalizedRange,recent:!!recent,full:!!full};
  if(!force&&documentRequestLoaded(table,request)) return true;
  const requestKey=`${context.actor}:${context.generation}:${table}:${full?'full':normalizedRange?`${normalizedRange.from}:${normalizedRange.to}`:'recent'}`;
  if(documentLoadPromises.has(requestKey)) return dataReadWithStatus(documentLoadPromises.get(requestKey),readStatus);
  const initialRows=new Map(entry[1]().map(row=>[String(row.id),row]));
  const promise=(async()=>{
    try{
      const signature=await readVisibleDataSignature(table);
      if(!isWorkspaceReadCurrent(context)) return false;
      if(!force&&reuseDataReadSignature(requestKey,signature,documentFreshRequests.get(table)||[])){promise.unchanged=true;return true;}
      const buildQuery=()=>{
        let query=sb.from(table).select('*').order('id',{ascending:false});
        // These generic document tables keep their business date in data.date.
        // Standalone tax invoices can use saleDate, so their normal list uses
        // the bounded recent-page path rather than an incomplete date filter.
        if(normalizedRange&&table!=='standalone_tax_invoices') query=query.gte('data->>date',normalizedRange.from).lte('data->>date',normalizedRange.to);
        return query;
      };
      const result=full
        ?await fetchAllRows(buildQuery)
        :await fetchBoundedRows(buildQuery,{pageSize:DOCUMENT_QUERY_PAGE_SIZE,maxRows:DOCUMENT_QUERY_MAX_ROWS});
      if(!isWorkspaceReadCurrent(context)) return false;
      if(result.error) throw result.error;
      let incoming=(result.data||[]).map(rowToDoc);
      if(table==='goods_receipts') incoming=normalizeGoodsReceiptDocuments(incoming);
      const [,getArr,setArr]=entry;
      const current=getArr(),pendingIds=new Set(currentWorkspacePendingChanges({tables:[table]}).filter(item=>item.table===table).map(item=>String(item.id)));
      const incomingById=new Map(incoming.map(row=>[String(row.id),row]));
      const protectedIds=new Set();
      current.forEach(row=>{
        const id=String(row.id),remote=incomingById.get(id);
        if(initialRows.get(id)!==row||Number(row._revision)>Number(remote?._revision||0)&&remote){
          protectedIds.add(id);
          if(!pendingIds.has(id)) incomingById.set(id,row);
        }
      });
      incoming=[...incomingById.values()];
      let next=mergeWorkspaceRemoteRows(table,current,incoming,docToRow,{replace:full||!state.loaded});
      if(!result.truncated){
        next=next.filter(row=>{
          const id=String(row.id),date=String(row.date||row.saleDate||'');
          const inScope=full||!normalizedRange||(date>=normalizedRange.from&&date<=normalizedRange.to);
          if(!inScope||incomingById.has(id)||pendingIds.has(id)||protectedIds.has(id)) return true;
          syncedTableRows[table]?.delete(id);
          return false;
        });
      }
      const keepIds=new Set([...incomingById.keys(),...pendingIds,...protectedIds]);
      let budget=Math.max(0,DOCUMENT_MEMORY_ROW_LIMIT-next.filter(row=>keepIds.has(String(row.id))).length);
      const trimmed=next.filter(row=>{
        if(keepIds.has(String(row.id))||budget-->0) return true;
        syncedTableRows[table]?.delete(String(row.id));
        return false;
      });
      const evicted=trimmed.length<next.length;
      setArr(trimmed);
      // A partial snapshot contains only rows actually observed by this
      // browser. Merge newly observed ids into the snapshot instead of
      // replacing it, otherwise a locally deleted row could disappear from
      // change tracking while another date window is loading.
      // mergeWorkspaceRemoteRows retains the original revision baseline of
      // unsent records, including deletions, instead of acknowledging them.
      state.loaded=true;
      state.full=!!full;
      state.recent=state.recent||!!recent||(!normalizedRange&&!full);
      const fresh=documentFreshRequests.get(table)||[];
      if(evicted){ fresh.length=0;state.ranges=[];state.truncatedRanges=[]; }
      const freshMarker={...request,context,at:Date.now()};
      fresh.push(freshMarker);
      rememberDataReadSignature(requestKey,signature,freshMarker);
      documentFreshRequests.set(table,fresh.slice(-12));
      if(normalizedRange) state.ranges=rememberLoadedRange(state.ranges,normalizedRange);
      if(full){ state.recentTruncated=false; state.truncatedRanges=[]; }
      else if(!result.truncated){
        if(normalizedRange) state.truncatedRanges=state.truncatedRanges.filter(item=>!(normalizedRange.from<=item.from&&normalizedRange.to>=item.to));
        else if(recent) state.recentTruncated=false;
      }else if(result.truncated){
        if(normalizedRange) state.truncatedRanges=rememberLoadedRange(state.truncatedRanges,normalizedRange);
        else if(recent) state.recentTruncated=true;
      }
      refreshDataCounters();
      return true;
    }catch(error){
      if(!isWorkspaceReadCurrent(context)) return false;
      console.warn(`load ${table}`,error);
      throw error;
    }finally{ if(isWorkspaceReadCurrent(context)) documentLoadPromises.delete(requestKey); }
  })();
  documentLoadPromises.set(requestKey,promise);
  return dataReadWithStatus(promise,readStatus);
}
async function syncCoreDataToSupabase(){
  if(!currentProfile) return;
  if(offlinePosMode()||offlinePendingSales().length||offlineSyncRunning) return;
  if(coreSyncInFlight){ coreSyncPending=true; return; }
  coreSyncInFlight=true;
  try{
  if(await adoptRemoteMaintenanceEpoch()){
    await loadCoreDataFromSupabase(); await loadSalesHistoryFromSupabase(); await loadCashShiftsFromSupabase(); await loadInspectionListsFromSupabase(); await loadPromotionsFromSupabase(); await loadFavoritesFromSupabase();
    render(); return;
  }
  setSyncUiState('syncing');
  do{
    coreSyncPending=false;
    const syncAttemptStartedAt=new Date().toISOString();
    try{
      coreSyncFailureDetail=null;
      // Scan once to select work. Each writer still durably captures its own
      // current payload before sending, so edits made during awaits stay safe.
      const pendingTables=new Set(currentWorkspacePendingChanges().map(entry=>entry.table));
      const failures=[];
      const run=async(task,tableName,operation='sync_core_data')=>{
        coreSyncFailureDetail=null;
        try{
          if(await task()===false) failures.push(coreSyncFailureDetail||{error:new Error(`ซิงก์ ${SYNC_TABLE_LABELS[tableName]||tableName} ไม่สำเร็จ`),tableName,operation});
        }catch(error){ failures.push(coreSyncFailureDetail||{error,tableName,operation,recordId:error?.recordId||''}); }
      };
      if(loggedInUser()?.owner===true){
        await run(()=>syncWarehousesIncrementally(),'warehouses');
        await run(()=>syncProductsIncrementally({dirtyOnly:true}),'products','update_products');
        if(pendingTables.has('contacts')||!syncedTableRows.contacts) await run(()=>upsertAndPrune('contacts',contacts,contactToRow),'contacts','upsert_rows');
        if(pendingTables.has('sales_representatives')||!syncedTableRows.sales_representatives) await run(()=>upsertAndPrune('sales_representatives',salesRepresentatives,salesRepToRow),'sales_representatives','upsert_rows');
        for(const [table,getArr] of DOC_TABLES){
          // Unopened document tables are intentionally absent from memory.
          // Never compare an empty/unloaded array with the remote table.
          if(pendingTables.has(table)) await run(()=>syncRevisionedDocuments(table,getArr()),table,'save_revisioned_document');
        }
      }
      if(pendingTables.has('inspection_lists')||!syncedTableRows.inspection_lists) await run(()=>syncInspectionListsToSupabase(),'inspection_lists','upsert_rows');
      if(failures.length){
        for(const detail of failures){
          const latest=rememberSyncUiError(detail.error,detail);
          if(!detail.error?.syncPaused&&!detail.error?.syncEventReported) reportClientEvent({operation:latest.operation,tableName:latest.table_name,recordId:latest.record_id,errorCode:latest.error_code,message:latest.message,context:{tab:currentTab}});
        }
      }else if(currentWorkspacePendingChanges().length){
        const error=Object.assign(new Error('ยังมีงานในเครื่องรอตรวจเทียบ กรุณาเปิดรายละเอียดการซิงก์'),{code:'PENDING_RECOVERY',syncPaused:true});
        rememberSyncUiError(error,{operation:'local_recovery'});
      }else{
        await resolveOwnSyncEventsThrough(syncAttemptStartedAt);
        syncUiLastError=null;
        setSyncUiState('synced',0);
      }
      flushPendingClientEvents();
    }catch(e){
      console.warn('sync core data failed',e);
      const detail=coreSyncFailureDetail||{error:e,operation:'sync_core_data',tableName:'',recordId:'',fallbackMessage:'ซิงก์ข้อมูลไม่สำเร็จ'};
      const latest=rememberSyncUiError(detail.error||e,detail);
      if(!detail.error?.syncPaused&&!detail.error?.syncEventReported) reportClientEvent({operation:latest.operation,tableName:latest.table_name,recordId:latest.record_id,errorCode:latest.error_code,message:latest.message,context:{tab:currentTab}});
      if(e?.code==='REVISION_CONFLICT'&&!e.syncPaused) showToast(e.message,'danger-top');
    }
  }while(coreSyncPending);
  }finally{ coreSyncInFlight=false; }
}

// Stock never travels through product metadata sync. It is written atomically
// to inventory_balances/inventory_lots and then reflected into the local UI.
async function transferProductStockOnSupabase(productId,fromWarehouseId,toWarehouseId,quantity){
  if(!currentProfile||!quantity) return null;
  try{
    const data=await runStockOperation('transfer_inventory_stock',{productId,fromWarehouseId:Number(fromWarehouseId),toWarehouseId:Number(toWarehouseId),quantity:Number(quantity)});
    updateInventoryBalanceLocal(productId,fromWarehouseId,Number(data?.fromStock)||0);
    updateInventoryBalanceLocal(productId,toWarehouseId,Number(data?.toStock)||0);
    await loadInventoryLotsFromSupabase({warehouseIds:[fromWarehouseId,toWarehouseId]});
    return data;
  }catch(error){ console.warn('transfer product stock failed',productId,error); return null; }
}
