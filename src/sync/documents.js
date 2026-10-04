let coreSyncInFlight=false, coreSyncPending=false;
// Simple id+data-jsonb document tables (Milestone 5) -- same shape, no extra
// reporting columns needed for these yet.
function docToRow(doc){ const {createdByUserId,_revision,...data}=doc||{}; return {id:doc?.id,data,revision:Number(_revision)||0}; }
function rowToDoc(row){ return { ...(row.data||{}), id:row.id, _revision:Number(row.revision)||1, ...(row.created_by?{createdByUserId:String(row.created_by)}:{}) }; }
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
const documentLoadStates=Object.fromEntries(DOC_TABLES.map(([table])=>[table,{loaded:false,full:false,recent:false,ranges:[],recentTruncated:false,truncatedRanges:[]}]));
const documentLoadPromises=new Map();
function documentTableEntry(table){ return DOC_TABLES.find(([name])=>name===table)||null; }
function resetDocumentLoadStates(){
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
async function loadDocumentTableFromSupabase(table,{range=null,recent=false,full=false}={}){
  const entry=documentTableEntry(table),state=documentLoadStates[table];
  if(!entry||!state) return false;
  const normalizedRange=range?serverDateRange(range.from,range.to):null;
  const request={range:normalizedRange,recent:!!recent,full:!!full};
  if(documentRequestLoaded(table,request)) return true;
  const requestKey=`${table}:${full?'full':normalizedRange?`${normalizedRange.from}:${normalizedRange.to}`:'recent'}`;
  if(documentLoadPromises.has(requestKey)) return documentLoadPromises.get(requestKey);
  const promise=(async()=>{
    try{
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
      if(result.error) throw result.error;
      let incoming=(result.data||[]).map(rowToDoc);
      if(table==='goods_receipts') incoming=normalizeGoodsReceiptDocuments(incoming);
      const [,getArr,setArr]=entry;
      const next=mergeWorkspaceRemoteRows(table,getArr(),incoming,docToRow,{replace:full||!state.loaded});
      setArr(next);
      // A partial snapshot contains only rows actually observed by this
      // browser. Merge newly observed ids into the snapshot instead of
      // replacing it, otherwise a locally deleted row could disappear from
      // change tracking while another date window is loading.
      // mergeWorkspaceRemoteRows retains the original revision baseline of
      // unsent records, including deletions, instead of acknowledging them.
      state.loaded=true;
      state.full=!!full;
      state.recent=state.recent||!!recent||(!normalizedRange&&!full);
      if(normalizedRange) state.ranges=rememberLoadedRange(state.ranges,normalizedRange);
      if(full){ state.recentTruncated=false; state.truncatedRanges=[]; }
      else if(result.truncated){
        if(normalizedRange) state.truncatedRanges=rememberLoadedRange(state.truncatedRanges,normalizedRange);
        else if(recent) state.recentTruncated=true;
      }
      refreshDataCounters();
      return true;
    }catch(error){
      console.warn(`load ${table}`,error);
      throw error;
    }finally{ documentLoadPromises.delete(requestKey); }
  })();
  documentLoadPromises.set(requestKey,promise);
  return promise;
}
async function syncCoreDataToSupabase(){
  if(!currentProfile) return;
  if(await adoptRemoteMaintenanceEpoch()){
    await loadCoreDataFromSupabase(); await loadSalesHistoryFromSupabase(); await loadCashShiftsFromSupabase(); await loadInspectionListsFromSupabase(); await loadPromotionsFromSupabase(); await loadFavoritesFromSupabase();
    render(); return;
  }
  if(coreSyncInFlight){ coreSyncPending=true; return; }
  coreSyncInFlight=true;
  setSyncUiState('syncing');
  do{
    coreSyncPending=false;
    const syncAttemptStartedAt=new Date().toISOString();
    try{
      coreSyncFailureDetail=null;
      if(currentWorkspacePendingChanges().length) await ensureWorkspaceRecoveryDurable();
      const failures=[];
      const run=async(task,tableName,operation='sync_core_data')=>{
        coreSyncFailureDetail=null;
        try{
          if(await task()===false) failures.push(coreSyncFailureDetail||{error:new Error(`ซิงก์ ${SYNC_TABLE_LABELS[tableName]||tableName} ไม่สำเร็จ`),tableName,operation});
        }catch(error){ failures.push(coreSyncFailureDetail||{error,tableName,operation,recordId:error?.recordId||''}); }
      };
      if(loggedInUser()?.owner===true){
        await run(()=>syncWarehousesIncrementally(),'warehouses');
        await run(()=>syncProductsIncrementally(),'products','update_products');
        await run(()=>upsertAndPrune('contacts',contacts,contactToRow),'contacts','upsert_rows');
        await run(()=>upsertAndPrune('sales_representatives',salesRepresentatives,salesRepToRow),'sales_representatives','upsert_rows');
        const pendingDocumentTables=new Set(currentWorkspacePendingChanges().map(entry=>entry.table));
        for(const [table,getArr] of DOC_TABLES){
          // Unopened document tables are intentionally absent from memory.
          // Never compare an empty/unloaded array with the remote table.
          if(documentLoadStates[table]?.loaded||pendingDocumentTables.has(table)) await run(()=>syncRevisionedDocuments(table,getArr()),table,'save_revisioned_document');
        }
      }
      await run(()=>syncInspectionListsToSupabase(),'inspection_lists','upsert_rows');
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
  coreSyncInFlight=false;
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
