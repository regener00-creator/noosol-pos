// ----- Business settings sync -----
// Single object (not a list), stored as one row in the generic key/value
// `settings` table (key='business') that was already part of the original
// schema but never actually used until now. Uses the same lastSyncedSnapshot
// content-hash guard as upsertAndPrune() so an unrelated render doesn't
// re-upload it needlessly.
async function syncBusinessSettingsToSupabase(){
  if(!currentProfile){ businessSettingsSyncState='local'; return false; }
  const snapshot=JSON.stringify(businessSettings);
  if(lastSyncedSnapshot.business_settings===snapshot){ businessSettingsSyncState='synced'; return true; }
  businessSettingsSyncState='syncing';
  businessSettingsSyncError='';
  try{
    const {error}=await sb.rpc('owner_set_setting',{p_key:'business',p_value:businessSettings});
    if(error) throw error;
    lastSyncedSnapshot.business_settings=snapshot;
    businessSettingsSyncState='synced';
    businessSettingsLastSyncedAt=new Date().toISOString();
    return true;
  }catch(e){
    console.warn('sync business settings failed',e);
    businessSettingsSyncState='error';
    businessSettingsSyncError=e?.message||'เชื่อมต่อ Supabase ไม่สำเร็จ';
    return false;
  }
}
function applyBusinessSettings(value){
  businessSettings={...businessSettings,...(value&&typeof value==='object'?value:{})};
  STORE_INFO.name=String(businessSettings.name||'');
  STORE_INFO.address=String(businessSettings.address||'');
  STORE_INFO.taxId=String(businessSettings.taxId||'');
  STORE_INFO.phone=businessPrimaryPhone(businessSettings);
  STORE_INFO.website=String(businessSettings.website||'');
  STORE_INFO.branch=businessTaxBranchLabel(businessSettings);
}
async function loadBusinessSettingsFromSupabase(){
  try{
    const {data,error}=await sb.from('settings').select('value').eq('key','business').maybeSingle();
    if(error){ console.warn('load business settings',error); return; }
    if(data&&data.value&&typeof data.value==='object'){
      applyBusinessSettings(data.value);
      lastSyncedSnapshot.business_settings=JSON.stringify(businessSettings);
      businessSettingsSyncState='synced';
      businessSettingsLastSyncedAt=new Date().toISOString();
    }else{
      await syncBusinessSettingsToSupabase(); // first time ever: seed Supabase from whatever's local right now
    }
  }catch(e){ console.warn('load business settings failed',e); }
}

// ----- Document number prefixes sync -----
// Another single object, same settings(key,value) table as business settings.
async function syncDocumentPrefixesToSupabase(){
  if(!currentProfile) return;
  const snapshot=JSON.stringify(documentPrefixes);
  if(lastSyncedSnapshot.document_prefixes===snapshot) return;
  try{
    const {error}=await sb.rpc('owner_set_setting',{p_key:'document_prefixes',p_value:documentPrefixes});
    if(error){ console.warn('sync document prefixes',error); return; }
    lastSyncedSnapshot.document_prefixes=snapshot;
  }catch(e){ console.warn('sync document prefixes failed',e); }
}
async function loadDocumentPrefixesFromSupabase(){
  try{
    const {data,error}=await sb.from('settings').select('value').eq('key','document_prefixes').maybeSingle();
    if(error){ console.warn('load document prefixes',error); return; }
    if(data&&data.value&&typeof data.value==='object'){
      Object.keys(DEFAULT_DOCUMENT_PREFIXES).forEach(key=>{
        documentPrefixes[key]=normalizeDocumentPrefix(data.value[key],DEFAULT_DOCUMENT_PREFIXES[key]);
      });
      lastSyncedSnapshot.document_prefixes=JSON.stringify(documentPrefixes);
    }else{
      await syncDocumentPrefixesToSupabase(); // first time ever: seed Supabase from whatever's local right now
    }
  }catch(e){ console.warn('load document prefixes failed',e); }
}

// ----- Saved product inspection lists sync -----
// Each list is its own row so two devices can add/edit different lists without
// replacing the entire shared array in settings.
function inspectionListToRow(list){ return {id:list.id,data:additionalData(list,['id','_revision']),revision:Number(list._revision)||0}; }
function rowToInspectionList(row){ return normalizeInspectionLists([{...(row.data||{}),id:row.id,_revision:Number(row.revision)||1}])[0]; }
function inspectionCompletionMatches(local,remote){
  // Only acknowledge the very same completed count; never overwrite an edit
  // to the name, products, units, owner or warehouse to silence a conflict.
  if(!local.stockAdjustedAt||!remote.stockAdjustedAt||Date.parse(local.stockAdjustedAt)!==Date.parse(remote.stockAdjustedAt)) return false;
  if(local.stockAdjustmentDocumentNo&&local.stockAdjustmentDocumentNo!==remote.stockAdjustmentDocumentNo) return false;
  if(local.warehouseId&&Number(local.warehouseId)!==Number(remote.warehouseId)) return false;
  const identity=list=>({id:String(list.id),name:list.name,items:list.items,createdAt:list.createdAt,createdBy:list.createdBy,token:list._clientCreateToken||'',stockAdjustedBy:list.stockAdjustedBy});
  return JSON.stringify(canonicalProductInsertValue(identity(local)))===JSON.stringify(canonicalProductInsertValue(identity(remote)));
}
async function reconcileCompletedInspectionLists(){
  const baseline=syncedTableRows.inspection_lists||new Map();
  const candidates=inspectionLists.filter(list=>list.stockAdjustedAt&&baseline.get(String(list.id))!==JSON.stringify(inspectionListToRow(list)));
  for(let offset=0;offset<candidates.length;offset+=100){
    const {data,error}=await sb.from('inspection_lists').select('*').in('id',candidates.slice(offset,offset+100).map(list=>list.id));
    if(error) throw error;
    for(const row of data||[]){
      const remote=rowToInspectionList(row),local=inspectionLists.find(list=>String(list.id)===String(remote.id));
      if(!local||!inspectionCompletionMatches(local,remote)) continue;
      const index=inspectionLists.indexOf(local);
      inspectionLists[index]=remote;
      syncAcknowledgement('inspection_lists',inspectionLists,inspectionListToRow)(remote);
    }
  }
}
async function syncInspectionListsToSupabase(){
  if(!currentProfile) return false;
  syncInspectionListsToSupabase.requested=true;
  if(syncInspectionListsToSupabase.busy) return syncInspectionListsToSupabase.busy;
  const work=Promise.resolve().then(async()=>{
    do{
      syncInspectionListsToSupabase.requested=false;
      await reconcileCompletedInspectionLists();
      if(!await upsertAndPrune('inspection_lists',inspectionLists,inspectionListToRow)) return false;
    }while(syncInspectionListsToSupabase.requested);
    return true;
  }).catch(e=>{ console.warn('sync inspection lists failed',e); return noteCoreSyncFailure(e,{operation:'sync_inspection_lists',tableName:'inspection_lists',fallbackMessage:'ซิงก์รายการตรวจสินค้าไม่สำเร็จ'}); })
    .finally(()=>{ syncInspectionListsToSupabase.busy=null; });
  syncInspectionListsToSupabase.busy=work;
  return work;
}
async function loadInspectionListsFromSupabase(){
  try{
    const {data,error}=await fetchAllRows(()=>sb.from('inspection_lists').select('*').order('id'));
    if(error){ console.warn('load inspection lists',error); return; }
    if((data||[]).length){
      inspectionLists=mergeWorkspaceRemoteRows('inspection_lists',inspectionLists,data.map(rowToInspectionList),inspectionListToRow,{replace:true});
    }else{
      // One-time migration from the former settings-array storage.
      const {data:legacy}=await sb.from('settings').select('value').eq('key','inspection_lists').maybeSingle();
      if(legacy&&Array.isArray(legacy.value)&&legacy.value.length) inspectionLists=normalizeInspectionLists(legacy.value);
      seedTableSnapshot('inspection_lists',[],inspectionListToRow);
      if(inspectionLists.length) await syncInspectionListsToSupabase();
    }
    refreshDataCounters();
  }catch(e){ console.warn('load inspection lists failed',e); }
}

// ----- Shared favorites sync (one store-wide list for every signed-in user) -----
// The table keeps user_id only as the last editor. product_id is the shared
// primary key, so every account loads and edits the same ordered list.
async function syncFavoritesToSupabase(){
  if(!currentProfile) return;
  favorites=normalizeFavorites(favorites);
  const snapshot=JSON.stringify(favorites);
  if(lastSyncedSnapshot.favorites===snapshot) return;
  try{
    const rows=favorites.map((entry,position)=>({user_id:currentProfile.id,product_id:entry.pid,unit:entry.unit||'',position}));
    if(rows.length){ const {error}=await sb.from('favorites').upsert(rows,{onConflict:'product_id'}); if(error){ console.warn('sync favorites',error); return; } }
    const {data:existing}=await fetchAllRows(()=>sb.from('favorites').select('product_id'));
    const localIds=new Set(favorites.map(entry=>entry.pid));
    const del=(existing||[]).filter(r=>!localIds.has(r.product_id)).map(r=>r.product_id);
    if(del.length) await sb.from('favorites').delete().in('product_id',del);
    lastSyncedSnapshot.favorites=snapshot;
  }catch(e){ console.warn('sync favorites failed',e); }
}
async function loadFavoritesFromSupabase(){
  if(!currentProfile) return;
  try{
    const {data,error}=await fetchAllRows(()=>sb.from('favorites').select('product_id,unit,position,created_at').order('position').order('created_at'));
    if(error){ console.warn('load favorites',error); return; }
    favorites=normalizeFavorites((data||[]).map(row=>({pid:row.product_id,unit:row.unit})));
    lastSyncedSnapshot.favorites=JSON.stringify(favorites);
  }catch(e){ console.warn('load favorites failed',e); }
}

async function loadCoreDataFromSupabase(){
  try{
    await adoptRemoteMaintenanceEpoch();
    const [{data:whRows,error:whErr},{data:prodRows,error:prodErr},{data:contactRows,error:contactErr},{data:repRows,error:repErr},{data:accessRows,error:accessErr},{data:permissionRows,error:permissionErr}]=await Promise.all([
      fetchAllRows(()=>sb.from('warehouses').select('*').order('id')),
      loadProductRowsFromSupabase(),
      fetchAllRows(()=>sb.from('contacts').select('*').order('id')),
      fetchAllRows(()=>sb.from('sales_representatives').select('*').order('id')),
      fetchAllRows(()=>sb.from('profile_warehouse_access').select('*').eq('user_id',currentProfile.id).order('warehouse_id')),
      fetchAllRows(()=>sb.from('profile_page_permissions').select('*').eq('user_id',currentProfile.id).order('page_key')),
    ]);
    // Keep the current app usable during the short rolling-deploy window before
    // the page-permission migration reaches Supabase. Every other core table is
    // still mandatory; only this newly introduced table has a legacy fallback.
    const permissionTablePending=permissionErr&&['42P01','PGRST205'].includes(String(permissionErr.code||''));
    if(whErr||prodErr||contactErr||repErr||accessErr||(permissionErr&&!permissionTablePending)){ console.warn('load core data',whErr||prodErr||contactErr||repErr||accessErr||permissionErr); return; }
    const masterDataEmpty=(whRows||[]).length===0&&(prodRows||[]).length===0&&(contactRows||[]).length===0&&(repRows||[]).length===0;
    let remoteDocumentsExist=false;
    if(masterDataEmpty){
      const presenceChecks=[];
      for(const [table] of DOC_TABLES) presenceChecks.push(sb.from(table).select('id').limit(1));
      const presenceResults=await Promise.all(presenceChecks);
      const presenceError=presenceResults.find(result=>result.error)?.error;
      if(presenceError){ console.warn('check remote document presence',presenceError); return; }
      remoteDocumentsExist=presenceResults.some(result=>(result.data||[]).length>0);
    }
    const allEmpty=masterDataEmpty&&!remoteDocumentsExist;
    if(allEmpty){
      // Import only a real saved workspace. Never push the built-in demo rows
      // into an intentionally empty production database.
      if(indexedProductCacheReady&&products.length){ await syncCoreDataToSupabase(); return; }
      warehouses=[]; products=[]; contacts=[]; salesRepresentatives=[];
    }
    warehouses=(whRows||[]).map(rowToWarehouse);
    // loadProductRowsFromSupabase() already returns normalized product objects.
    // Mapping them as database rows a second time strips JSON-only fields such
    // as barcode, extraBarcodes, vendorBarcodes, units and expiry.
    products=prodRows||[];
    rebuildProductLookupMaps();
    warehouseAccessRows=accessRows||[];
    pagePermissionRows=permissionTablePending?[]:(permissionRows||[]);
    inventoryBalanceRows=[];
    inventoryLotRows=[];
    resetLoadedInventoryScopes();
    rebuildInventoryBalanceMap();
    rebuildInventoryLotMap();
    restoreActiveWarehouseSelection();
    if(!await loadWarehouseInventoryFromSupabase(inventoryScopeWarehouseIds(),{force:true})){
      console.warn('load core inventory failed');
      return;
    }
    contacts=mergeWorkspaceRemoteRows('contacts',contacts,(contactRows||[]).map(rowToContact),contactToRow,{replace:true});
    salesRepresentatives=mergeWorkspaceRemoteRows('sales_representatives',salesRepresentatives,(repRows||[]).map(rowToSalesRep),salesRepToRow,{replace:true});
    refreshCategoryBrandUnitLists();
    // Seed the change-detection cache to match what we just loaded, so the
    // next debounced sync doesn't immediately re-upload everything again
    // merely because it hasn't "seen" this exact snapshot before.
    seedTableSnapshot('warehouses',warehouses,warehouseToRow);
    seedProductSyncSnapshot(products,productDirtyOperations);
    nextWarehouseId=maxArrayValue(warehouses,w=>(Number(w.id)||0)+1,1);
    refreshDataCounters();
    if(productDirtyOperations.size||currentWorkspacePendingChanges().length) scheduleSupabaseCoreSync();
  }catch(e){ console.warn('load core data failed',e); }
}
