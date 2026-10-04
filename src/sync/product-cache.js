// Product reads use a lightweight manifest (id + updated_at) after the first
// successful load. A normal refresh therefore downloads full JSON only for
// products that were added or changed, while ids missing from the manifest
// remove products deleted by another device. The first load remains a safe
// full download so an incomplete/stale local cache is never trusted blindly.
// v4 forces one safe full reload after fixing the product loader's accidental
// second rowToProduct() pass, which discarded JSON-only metadata such as every
// barcode collection, extra units and expiry dates from the device cache.
const PRODUCT_MANIFEST_STORAGE_KEY='pepos_product_manifest_v6';
const PRODUCT_MANIFEST_VERSION=6;
const PRODUCT_CACHE_DB_NAME='pepos-product-cache';
const PRODUCT_CACHE_DB_VERSION=2;
const PRODUCT_CACHE_PRODUCTS_STORE='products';
const PRODUCT_CACHE_META_STORE='meta';
const PRODUCT_CACHE_WORKSPACE_STORE='workspace';
const PRODUCT_CACHE_MANIFEST_KEY='product-manifest-v6';
const PRODUCT_CACHE_DIRTY_KEY='product-dirty-operations-v1';
let productCacheDbPromise=null;
let productCacheStartupBlocked=false;
let indexedProductCacheReady=false;
let cachedProductManifest=null;
let productCacheFingerprints=new Map();
let productCacheDirtyFingerprint=null;
let productCacheWriteChain=Promise.resolve();
let productDirtyOperations=new Map();
let legacyWorkspaceProducts=null;
let workspaceRecoveryEntries=new Map();
let workspaceRecoveryActorId='';
let workspaceCacheSaveFailed=false;
let workspaceRecoveryLoadedActor='';
let workspaceOutboxVersions=new Map();
const WORKSPACE_DOCUMENT_CACHE_LIMIT=100;
function readProductManifestCache(){
  const cached=cachedProductManifest;
  if(!cached||cached.version!==PRODUCT_MANIFEST_VERSION) return null;
  return cached;
}
function normalizeProductDirtyOperations(value){
  const entries=value&&typeof value.entries==='function'?[...value.entries()]:(Array.isArray(value)?value:Object.entries(value&&typeof value==='object'?value:{}));
  const normalized=new Map();
  entries.forEach(([id,operation])=>{
    const key=String(id||'').trim();
    if(key&&['insert','update','delete'].includes(operation)) normalized.set(key,operation);
  });
  return normalized;
}
function productDirtyOperationsValue(value=productDirtyOperations){
  return Object.fromEntries([...normalizeProductDirtyOperations(value).entries()].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})));
}
function markProductChangesDirty({insertedIds=[],updatedIds=[],deletedIds=[]}={}){
  insertedIds.forEach(id=>{ if(id!==null&&id!==undefined) productDirtyOperations.set(String(id),'insert'); });
  updatedIds.forEach(id=>{
    if(id===null||id===undefined) return;
    const key=String(id);
    if(productDirtyOperations.get(key)!=='insert') productDirtyOperations.set(key,'update');
  });
  deletedIds.forEach(id=>{
    if(id===null||id===undefined) return;
    const key=String(id);
    if(productDirtyOperations.get(key)==='insert') productDirtyOperations.delete(key);
    else productDirtyOperations.set(key,'delete');
  });
}
function idbRequest(request){
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('IndexedDB request failed'));
  });
}
function idbTransactionDone(transaction){
  return new Promise((resolve,reject)=>{
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error||new Error('IndexedDB transaction failed'));
    transaction.onabort=()=>reject(transaction.error||new Error('IndexedDB transaction aborted'));
  });
}
function openProductCacheDb(){
  if(productCacheDbPromise) return productCacheDbPromise;
  if(!window.indexedDB) return Promise.reject(new Error('IndexedDB unavailable'));
  productCacheDbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(PRODUCT_CACHE_DB_NAME,PRODUCT_CACHE_DB_VERSION);
    let expired=false;
    const timer=setTimeout(()=>{
      expired=true; productCacheDbPromise=null;
      const error=new Error('เปิดแคชสินค้าไม่ได้ กรุณาปิดแท็บหรือหน้าต่าง PEPOS อื่น แล้วเปิดหน้านี้ใหม่');
      error.code='PRODUCT_CACHE_BLOCKED'; reject(error);
    },10000);
    request.onblocked=()=>{
      if(typeof showToast==='function') showToast('กรุณาปิดแท็บหรือหน้าต่าง PEPOS รุ่นเก่า เพื่ออัปเดตแคชสินค้า','danger-top');
    };
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(PRODUCT_CACHE_PRODUCTS_STORE)) db.createObjectStore(PRODUCT_CACHE_PRODUCTS_STORE,{keyPath:'id'});
      if(!db.objectStoreNames.contains(PRODUCT_CACHE_META_STORE)) db.createObjectStore(PRODUCT_CACHE_META_STORE,{keyPath:'key'});
      if(!db.objectStoreNames.contains(PRODUCT_CACHE_WORKSPACE_STORE)) db.createObjectStore(PRODUCT_CACHE_WORKSPACE_STORE,{keyPath:'key'});
    };
    request.onsuccess=()=>{
      clearTimeout(timer);
      const db=request.result;
      if(expired){ db.close(); return; }
      db.onversionchange=()=>{ db.close(); productCacheDbPromise=null; };
      db.onclose=()=>{ productCacheDbPromise=null; };
      resolve(db);
    };
    request.onerror=()=>{ clearTimeout(timer); if(!expired) productCacheDbPromise=null; reject(request.error||new Error('เปิดแคชสินค้าไม่สำเร็จ')); };
  });
  return productCacheDbPromise;
}
async function loadProductCacheFromIndexedDB(){
  try{
    const db=await openProductCacheDb();
    const transaction=db.transaction([PRODUCT_CACHE_PRODUCTS_STORE,PRODUCT_CACHE_META_STORE,PRODUCT_CACHE_WORKSPACE_STORE],'readonly');
    const transactionDone=idbTransactionDone(transaction);
    const productRowsPromise=idbRequest(transaction.objectStore(PRODUCT_CACHE_PRODUCTS_STORE).getAll());
    const manifestPromise=idbRequest(transaction.objectStore(PRODUCT_CACHE_META_STORE).get(PRODUCT_CACHE_MANIFEST_KEY));
    const dirtyOperationsPromise=idbRequest(transaction.objectStore(PRODUCT_CACHE_META_STORE).get(PRODUCT_CACHE_DIRTY_KEY));
    const workspacePromise=idbRequest(transaction.objectStore(PRODUCT_CACHE_WORKSPACE_STORE).get('current'));
    const [productRows,manifestRow,dirtyOperationsRow,workspaceRow]=await Promise.all([productRowsPromise,manifestPromise,dirtyOperationsPromise,workspacePromise]);
    await transactionDone;
    if(workspaceRow?.value) applyWorkspaceData(workspaceRow.value);
    productDirtyOperations=normalizeProductDirtyOperations(dirtyOperationsRow?.value);
    if(Array.isArray(productRows)&&productRows.length){
      products=productRows;
      productCacheFingerprints=new Map(productRows.map(product=>[String(product.id),JSON.stringify(product)]));
    }else if(Array.isArray(legacyWorkspaceProducts)&&legacyWorkspaceProducts.length){
      products=legacyWorkspaceProducts;
    }
    cachedProductManifest=manifestRow?.value||null;
    indexedProductCacheReady=Array.isArray(productRows)&&productRows.length>0;
    if(!indexedProductCacheReady&&Array.isArray(legacyWorkspaceProducts)&&legacyWorkspaceProducts.length){
      await persistProductsToIndexedDB(legacyWorkspaceProducts,true);
      indexedProductCacheReady=true;
    }
    rebuildProductLookupMaps();
    refreshDataCounters();
    return indexedProductCacheReady;
  }catch(error){
    indexedProductCacheReady=false;
    if(error?.code==='PRODUCT_CACHE_BLOCKED'){
      productCacheStartupBlocked=true;
      const notice=document.getElementById('loginError');
      if(notice) notice.textContent=error.message;
      if(typeof showToast==='function') showToast(error.message,'danger-top');
      return false;
    }
    console.warn('ไม่สามารถโหลดแคชสินค้าจาก IndexedDB ได้ ระบบจะดึงข้อมูลจากเซิร์ฟเวอร์',error);
    return false;
  }
}
async function saveProductManifestCache(){
  const manifest={
    version:PRODUCT_MANIFEST_VERSION,
    savedAt:new Date().toISOString(),
  };
  try{
    const db=await openProductCacheDb();
    const transaction=db.transaction(PRODUCT_CACHE_META_STORE,'readwrite');
    const transactionDone=idbTransactionDone(transaction);
    transaction.objectStore(PRODUCT_CACHE_META_STORE).put({key:PRODUCT_CACHE_MANIFEST_KEY,value:manifest});
    await transactionDone;
    cachedProductManifest=manifest;
    localStorage.removeItem(PRODUCT_MANIFEST_STORAGE_KEY);
    localStorage.removeItem('pepos_product_manifest_v4');
    return true;
  }catch(error){ console.warn('ไม่สามารถบันทึกสารบัญแคชสินค้าใน IndexedDB ได้',error); return false; }
}
function persistProductsToIndexedDB(productRows=products,removeMissing=true,dirtyOperations=productDirtyOperations){
  const rows=JSON.parse(JSON.stringify(Array.isArray(productRows)?productRows:[]));
  const dirtyValue=productDirtyOperationsValue(dirtyOperations);
  const write=async()=>{
    try{
      const db=await openProductCacheDb();
      const nextFingerprints=new Map(rows.map(product=>[String(product.id),JSON.stringify(product)]));
      const changed=rows.filter(product=>productCacheFingerprints.get(String(product.id))!==nextFingerprints.get(String(product.id)));
      const deleted=removeMissing?[...productCacheFingerprints.keys()].filter(id=>!nextFingerprints.has(id)):[];
      const transaction=db.transaction([PRODUCT_CACHE_PRODUCTS_STORE,PRODUCT_CACHE_META_STORE],'readwrite');
      const transactionDone=idbTransactionDone(transaction);
      const store=transaction.objectStore(PRODUCT_CACHE_PRODUCTS_STORE);
      changed.forEach(product=>store.put(product));
      deleted.forEach(id=>store.delete(Number.isFinite(Number(id))?Number(id):id));
      transaction.objectStore(PRODUCT_CACHE_META_STORE).put({key:PRODUCT_CACHE_DIRTY_KEY,value:dirtyValue});
      await transactionDone;
      productCacheFingerprints=nextFingerprints;
      productCacheDirtyFingerprint=JSON.stringify(dirtyValue);
      indexedProductCacheReady=rows.length>0;
      return true;
    }catch(error){
      console.warn('ไม่สามารถบันทึกแคชสินค้าใน IndexedDB ได้',error);
      return false;
    }
  };
  productCacheWriteChain=productCacheWriteChain.then(write,write);
  return productCacheWriteChain;
}
function persistProductChangesToIndexedDB(changes={},dirtyOperations=productDirtyOperations){
  const changedIds=new Set([...(changes.insertedIds||[]),...(changes.updatedIds||[])].map(String));
  const deletedIds=[...(changes.deletedIds||[])].map(String);
  const rows=JSON.parse(JSON.stringify((products||[]).filter(product=>changedIds.has(String(product.id)))));
  const dirtyValue=productDirtyOperationsValue(dirtyOperations);
  const rowFingerprints=new Map(rows.map(product=>[String(product.id),JSON.stringify(product)]));
  const dirtyFingerprint=JSON.stringify(dirtyValue);
  const write=async()=>{
    try{
      // Compare inside the queue: an earlier write may already have saved this
      // acknowledgement. Never skip the dirty-state write after a failed write.
      const changedRows=rows.filter(product=>productCacheFingerprints.get(String(product.id))!==rowFingerprints.get(String(product.id)));
      const removedIds=deletedIds.filter(id=>productCacheFingerprints.has(id));
      if(!changedRows.length&&!removedIds.length&&productCacheDirtyFingerprint===dirtyFingerprint) return true;
      const db=await openProductCacheDb();
      const transaction=db.transaction([PRODUCT_CACHE_PRODUCTS_STORE,PRODUCT_CACHE_META_STORE],'readwrite');
      const transactionDone=idbTransactionDone(transaction);
      const store=transaction.objectStore(PRODUCT_CACHE_PRODUCTS_STORE);
      changedRows.forEach(product=>store.put(product));
      removedIds.forEach(id=>store.delete(Number.isFinite(Number(id))?Number(id):id));
      transaction.objectStore(PRODUCT_CACHE_META_STORE).put({key:PRODUCT_CACHE_DIRTY_KEY,value:dirtyValue});
      await transactionDone;
      changedRows.forEach(product=>productCacheFingerprints.set(String(product.id),rowFingerprints.get(String(product.id))));
      removedIds.forEach(id=>productCacheFingerprints.delete(id));
      productCacheDirtyFingerprint=dirtyFingerprint;
      indexedProductCacheReady=productCacheFingerprints.size>0;
      return true;
    }catch(error){
      console.warn('ไม่สามารถบันทึกการเปลี่ยนแปลงสินค้าใน IndexedDB ได้',error);
      return false;
    }
  };
  productCacheWriteChain=productCacheWriteChain.then(write,write);
  return productCacheWriteChain;
}
async function clearProductIndexedCache(){
  try{
    const db=productCacheDbPromise?await productCacheDbPromise:null;
    db?.close();
  }catch(error){}
  productCacheDbPromise=null;
  productCacheWriteChain=Promise.resolve();
  indexedProductCacheReady=false;
  cachedProductManifest=null;
  productCacheFingerprints=new Map();
  productCacheDirtyFingerprint=null;
  productDirtyOperations=new Map();
  if(!window.indexedDB) return;
  try{ await idbRequest(indexedDB.deleteDatabase(PRODUCT_CACHE_DB_NAME)); }
  catch(error){ console.warn('ล้างแคชสินค้าใน IndexedDB ไม่สำเร็จ',error); }
}
async function fetchAllProductRows(){
  const pageSize=1000;
  let lastId=null,allRows=[];
  while(true){
    let query=sb.from('products').select('*').order('id',{ascending:true}).limit(pageSize);
    if(lastId!==null) query=query.gt('id',lastId);
    const {data,error}=await query;
    if(error) return {data:null,error};
    const rows=data||[];
    allRows=allRows.concat(rows);
    if(rows.length<pageSize) break;
    lastId=rows[rows.length-1].id;
  }
  return {data:allRows,error:null};
}
async function fetchProductRevisionManifest(){
  const pageSize=1000;
  let cursor=null,allRows=[];
  while(true){
    let query=sb.from('products').select('id,revision').order('id',{ascending:true}).limit(pageSize);
    if(cursor!==null) query=query.gt('id',cursor);
    const {data,error}=await query;
    if(error) return {data:null,error};
    const rows=data||[]; allRows.push(...rows);
    if(rows.length<pageSize) break;
    cursor=rows[rows.length-1].id;
  }
  return {data:allRows,error:null};
}
async function fetchProductRowsByIds(ids){
  const allRows=[];
  for(let i=0;i<ids.length;i+=200){
    const {data,error}=await sb.from('products').select('*').in('id',ids.slice(i,i+200));
    if(error) return {data:null,error};
    allRows.push(...(data||[]));
  }
  return {data:allRows,error:null};
}
function mergeRemoteProductsWithDirtyLocal(remoteProducts,localProducts=products,dirtyOperations=productDirtyOperations){
  const dirty=normalizeProductDirtyOperations(dirtyOperations);
  const localById=new Map((localProducts||[]).map(product=>[String(product.id),product]));
  const merged=(remoteProducts||[]).filter(product=>dirty.get(String(product.id))!=='delete');
  const mergedById=new Map(merged.map((product,index)=>[String(product.id),index]));
  for(const [id,operation] of dirty){
    if(operation==='delete') continue;
    const local=localById.get(id);
    if(!local) continue;
    const index=mergedById.get(id);
    if(index===undefined){ mergedById.set(id,merged.length); merged.push(local); }
    else merged[index]=local;
  }
  return merged.sort((a,b)=>(Number(a.id)||0)-(Number(b.id)||0));
}
function reconcileProductDirtyOperationsWithRemoteIds(remoteIds){
  const available=new Set((remoteIds||[]).map(String));
  for(const [id,operation] of [...productDirtyOperations]){
    // Keep missing updates as updates: the revision guard must report a
    // conflict. Only the user may choose to discard them, never reinsert them.
    if(operation==='delete'&&!available.has(id)) productDirtyOperations.delete(id);
  }
}
function reconcileProductDirtyOperationsWithChanges(changes){
  for(const change of changes||[]){
    if(change.operation!=='delete') continue;
    const id=String(change.product_id),operation=productDirtyOperations.get(id);
    if(operation==='delete') productDirtyOperations.delete(id);
  }
}
async function loadProductRowsFromSupabase(){
  // Identity sequence values are not commit order. Reconcile authoritative
  // id/revision pairs on every refresh, then download only changed full rows.
  // This also repairs old cursors and caches that outlived log retention.
  const manifest=await fetchProductRevisionManifest();
  if(manifest.error) return {data:null,error:manifest.error};
  const remoteIds=new Set(manifest.data.map(row=>String(row.id)));
  reconcileProductDirtyOperationsWithRemoteIds([...remoteIds]);
  const fullReload=!indexedProductCacheReady||!readProductManifestCache();
  const localById=new Map(products.map(product=>[String(product.id),product]));
  const changedIds=manifest.data.filter(row=>{
    if(productDirtyOperations.has(String(row.id))) return false;
    const local=localById.get(String(row.id));
    return fullReload||!local||Number(local._revision)!==Number(row.revision);
  }).map(row=>row.id);
  const deletedIds=products.filter(product=>!remoteIds.has(String(product.id))&&!productDirtyOperations.has(String(product.id))).map(product=>product.id);
  const {data:changedRows,error}=await fetchProductRowsByIds(changedIds);
  if(error) return {data:null,error};
  const fetchedIds=new Set((changedRows||[]).map(row=>String(row.id)));
  changedIds.filter(id=>!fetchedIds.has(String(id))).forEach(id=>deletedIds.push(id));
  const changedSet=new Set(changedIds.map(String)),deletedSet=new Set(deletedIds.map(String));
  let loadedProducts=(products||[]).filter(product=>!changedSet.has(String(product.id))&&!deletedSet.has(String(product.id)));
  loadedProducts.push(...(changedRows||[]).map(rowToProduct));
  loadedProducts=mergeRemoteProductsWithDirtyLocal(loadedProducts);
  products=loadedProducts;
  const productRowsPersisted=await persistProductChangesToIndexedDB({updatedIds:changedIds,deletedIds});
  if(productRowsPersisted) await saveProductManifestCache();
  return {data:loadedProducts,error:null};
}

// Content-hash guard: snapshots make the incremental synchronizer send only changed rows.
// Failed writes are intentionally not acknowledged so a later save retries them.
