// Legacy primary-store settings stay in "business" so old backups still restore.
function storeLabelSettings(){
  if(isAllWarehousesMode()) return {};
  return activeWarehouseId>1?(warehouseBusinessProfiles[activeWarehouseId]||{}):businessSettings;
}
let labelSettingsSave=Promise.resolve();
function saveStoreLabelSettings(patch,size=null){
  if(isAllWarehousesMode()) return;
  const store=Number(activeWarehouseId)||1;
  const previous=storeLabelSettings();
  const next={...previous};
  for(const [key,value] of Object.entries(patch)){
    next[key]=size?{...previous[key],[size]:value}:value;
  }
  if(store===1) businessSettings=next;
  else warehouseBusinessProfiles={...warehouseBusinessProfiles,[store]:next};
  persistWorkspaceData();
  if(!activeWarehouseId||!currentProfile) return;
  const context=captureWorkspaceRead();
  const save=async()=>{
    if(!isWorkspaceReadCurrent(context)) return;
    try{
      const {error}=await sb.rpc('update_store_label_settings',{p_warehouse_id:store,p_patch:patch,p_size:size});
      if(error) throw error;
    }catch(error){
      if(isWorkspaceReadCurrent(context)) showToast('บันทึกการตั้งค่าฉลากของ '+whName(store)+' ไม่สำเร็จ: '+error.message,'danger-top');
    }
  };
  labelSettingsSave=labelSettingsSave.then(save,save);
}
function applyBusinessSettings(value){
  businessSettings={...DEFAULT_BUSINESS_SETTINGS,...(value||{})};
  STORE_INFO.name=String(businessSettings.name||'');
  STORE_INFO.address=String(businessSettings.address||'');
  STORE_INFO.taxId=String(businessSettings.taxId||'');
  STORE_INFO.phone=businessPrimaryPhone(businessSettings);
  STORE_INFO.website=String(businessSettings.website||'');
  STORE_INFO.branch=businessTaxBranchLabel(businessSettings);
}
async function loadBusinessSettingsFromSupabase(){
  const context=captureStoreView();
  if(!context.store||context.combined) return;
  await labelSettingsSave;
  if(!isStoreViewCurrent(context)) return;
  const profileKey='business-warehouse:'+context.store;
  const before=warehouseBusinessProfiles[context.store];
  const legacyBefore=businessSettings;
  const keys=context.store===1?[profileKey,'business']:[profileKey];
  const {data,error}=await sb.from('settings').select('key,value').in('key',keys);
  if(!isStoreViewCurrent(context)) return;
  if(error){console.warn('load business settings',error);return;}
  if(context.store===1&&legacyBefore===businessSettings) applyBusinessSettings(data?.find(row=>row.key==='business')?.value);
  if(before===warehouseBusinessProfiles[context.store]){
    const profile=data?.find(row=>row.key===profileKey)?.value;
    warehouseBusinessProfiles={...warehouseBusinessProfiles,[context.store]:profile};
  }
  businessSettingsSyncState='synced';
  businessSettingsLastSyncedAt=new Date().toISOString();
}
// ----- Document number prefixes sync -----
// Another single object, same settings(key,value) table as business settings.
async function loadDocumentPrefixesFromSupabase(){
  if(!currentProfile||!activeWarehouseId||isAllWarehousesMode())return;
  const context=captureStoreView();
  const before=documentPrefixesByStore[context.store];
  try{
    const {data,error}=await sb.from('settings').select('value').eq('key',storeToolKey('document_prefixes',context.store)).maybeSingle();
    if(!isStoreViewCurrent(context)||documentPrefixesByStore[context.store]!==before)return;
    if(error)throw error;
    documentPrefixesByStore[context.store]=Object.fromEntries(Object.entries(DEFAULT_DOCUMENT_PREFIXES).map(([key,fallback])=>[key,normalizeDocumentPrefix(data?.value?.[key],fallback)]));
    selectDocumentPrefixes();
  }catch(e){console.warn('load document prefixes failed',e);}
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
  const context=captureWorkspaceRead();
  try{
    const {data,error}=await fetchAllRows(()=>sb.from('inspection_lists').select('*').order('id'));
    if(!isWorkspaceReadCurrent(context)) return;
    if(error){ console.warn('load inspection lists',error); return; }
    if((data||[]).length||maintenanceHasStoreSnapshot()){
      inspectionLists=mergeWorkspaceRemoteRows('inspection_lists',inspectionLists,data.map(rowToInspectionList),inspectionListToRow,{replace:true});
    }else{
      // One-time migration from the former settings-array storage.
      const {data:legacy}=await sb.from('settings').select('value').eq('key','inspection_lists').maybeSingle();
      if(!isWorkspaceReadCurrent(context)) return;
      const migrated=Array.isArray(legacy?.value)?normalizeInspectionLists(legacy.value):[];
      inspectionLists=mergeWorkspaceRemoteRows('inspection_lists',inspectionLists,[],inspectionListToRow,{replace:true});
      if(migrated.length){
        for(const list of migrated)if(!inspectionLists.some(item=>item.id===list.id))inspectionLists.push(list);
        await syncInspectionListsToSupabase();
      }
    }
    refreshDataCounters();
  }catch(e){ console.warn('load inspection lists failed',e); }
}

// ----- Shared favorites sync (one store-wide list for every signed-in user) -----
// The table keeps user_id only as the last editor. product_id is the shared
// primary key, so every account loads and edits the same ordered list.
async function syncFavoritesToSupabase(){
  if(!currentProfile||!activeWarehouseId||isAllWarehousesMode()) return;
  const context=captureStoreView();
  const storeIds=new Set(products.map(product=>Number(product.id)));
  favorites=normalizeFavorites(favorites).filter(entry=>storeIds.has(entry.pid));
  const snapshot=JSON.stringify(favorites);
  if(lastSyncedSnapshot.favorites===snapshot) return;
  try{
    const localIds=new Set(favorites.map(entry=>entry.pid));
    const previous=JSON.parse(lastSyncedSnapshot.favorites||'[]');
    const del=previous.map(entry=>entry.pid).filter(id=>storeIds.has(id)&&!localIds.has(id));
    const rows=favorites.map((entry,position)=>({user_id:currentProfile.id,product_id:entry.pid,unit:entry.unit||'',position}));
    if(rows.length){ const {error}=await sb.from('favorites').upsert(rows,{onConflict:'product_id'}); if(error){ console.warn('sync favorites',error); return; } }
    if(del.length){const {error}=await sb.from('favorites').delete().in('product_id',del);if(error)throw error;}
    if(isStoreViewCurrent(context))lastSyncedSnapshot.favorites=snapshot;
  }catch(e){ console.warn('sync favorites failed',e); }
}
async function loadFavoritesFromSupabase(){
  if(!currentProfile||!activeWarehouseId||isAllWarehousesMode()) return;
  const context=captureStoreView();
  try{
    const {data,error}=await fetchAllRows(()=>{
      const query=sb.from('favorites').select('product_id,unit,position,created_at,products!inner(warehouse_id)');
      const scoped=Number(context.store)===1?query.or('warehouse_id.eq.1,warehouse_id.is.null',{referencedTable:'products'}):query.eq('products.warehouse_id',context.store);
      return scoped.order('position').order('created_at');
    });
    if(!isStoreViewCurrent(context)) return;
    if(error){ console.warn('load favorites',error); return; }
    favorites=normalizeFavorites((data||[]).map(row=>({pid:row.product_id,unit:row.unit})));
    lastSyncedSnapshot.favorites=JSON.stringify(favorites);
  }catch(e){ console.warn('load favorites failed',e); }
}

async function loadCoreDataFromSupabase(){
  const context=captureWorkspaceRead();
  offlineSnapshotReady=false;
  try{
    await adoptRemoteMaintenanceEpoch(context);
    if(!isWorkspaceReadCurrent(context)) return false;
    const [{data:whRows,error:whErr},{data:prodRows,error:prodErr},{data:contactRows,error:contactErr},{data:repRows,error:repErr},{data:accessRows,error:accessErr},{data:permissionRows,error:permissionErr}]=await Promise.all([
      fetchAllRows(()=>sb.from('warehouses').select('*').order('id')),
      loadProductRowsFromSupabase(),
      fetchAllRows(()=>sb.from('contacts').select('*').order('id')),
      fetchAllRows(()=>sb.from('sales_representatives').select('*').order('id')),
      fetchAllRows(()=>sb.from('profile_warehouse_access').select('*').eq('user_id',currentProfile.id).order('warehouse_id')),
      fetchAllRows(()=>sb.from('profile_page_permissions').select('*').eq('user_id',currentProfile.id).order('page_key')),
    ]);
    if(!isWorkspaceReadCurrent(context)) return false;
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
      if(!isWorkspaceReadCurrent(context)) return false;
      const presenceError=presenceResults.find(result=>result.error)?.error;
      if(presenceError){ console.warn('check remote document presence',presenceError); return; }
      remoteDocumentsExist=presenceResults.some(result=>(result.data||[]).length>0);
    }
    const allEmpty=masterDataEmpty&&!remoteDocumentsExist;
    if(allEmpty){
      // Import only a real saved workspace. Never push the built-in demo rows
      // into an intentionally empty production database.
      if(indexedProductCacheReady&&completeProductCatalog().length){ await syncCoreDataToSupabase(); return; }
      warehouses=[]; setWarehouseProductCatalog([]); contacts=[]; salesRepresentatives=[];
    }
    warehouses=(whRows||[]).map(rowToWarehouse);
    // loadProductRowsFromSupabase() already returns normalized product objects.
    // Mapping them as database rows a second time strips JSON-only fields such
    // as barcode, extraBarcodes, vendorBarcodes, units and expiry.
    setWarehouseProductCatalog(prodRows||[]);
    rebuildProductLookupMaps();
    warehouseAccessRows=accessRows||[];
    const visibleStores=new Set(accessibleWarehouses().map(w=>Number(w.id)));
    warehouseBusinessProfiles=Object.fromEntries(Object.entries(warehouseBusinessProfiles).filter(([id])=>visibleStores.has(Number(id))));
    if(!visibleStores.has(1)) applyBusinessSettings(null);
    pagePermissionRows=permissionTablePending?[]:(permissionRows||[]);
    inventoryBalanceRows=[];
    inventoryLotRows=[];
    resetLoadedInventoryScopes();
    rebuildInventoryBalanceMap();
    rebuildInventoryLotMap();
    restoreActiveWarehouseSelection();
    applyStoreCategoryView();
    selectDocumentPrefixes();
    await Promise.all([loadBusinessSettingsFromSupabase(),loadProductCategorySettingsFromSupabase(),loadFavoritesFromSupabase(),loadDocumentPrefixesFromSupabase()]);
    if(!isWorkspaceReadCurrent(context)) return false;
    if(!await loadWarehouseInventoryFromSupabase(inventoryScopeWarehouseIds(),{force:true})){
      console.warn('load core inventory failed');
      return;
    }
    if(!isWorkspaceReadCurrent(context)) return false;
    contacts=mergeWorkspaceRemoteRows('contacts',contacts,(contactRows||[]).map(rowToContact),contactToRow,{replace:true});
    salesRepresentatives=mergeWorkspaceRemoteRows('sales_representatives',salesRepresentatives,(repRows||[]).map(rowToSalesRep),salesRepToRow,{replace:true});
    refreshCategoryBrandUnitLists();
    // Seed the change-detection cache to match what we just loaded, so the
    // next debounced sync doesn't immediately re-upload everything again
    // merely because it hasn't "seen" this exact snapshot before.
    seedTableSnapshot('warehouses',warehouses,warehouseToRow);
    seedProductSyncSnapshot(completeProductCatalog(),productDirtyOperations);
    nextWarehouseId=maxArrayValue(warehouses,w=>(Number(w.id)||0)+1,1);
    refreshDataCounters();
    if(productDirtyOperations.size||currentWorkspacePendingChanges().length) scheduleSupabaseCoreSync();
    offlineSnapshotReady=true;
    await saveOfflinePosSnapshot({refreshProducts:true});
  }catch(e){ console.warn('load core data failed',e); }
}
