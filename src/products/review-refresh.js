let editingProductId = null; // null = ยังไม่ได้เปิดฟอร์ม, 'new' = เพิ่มใหม่, ตัวเลข = แก้ไข
let nextProductSkuNumber = 113;
let selectedGroup = null; // {cat} หรือ {cat, brand}; null = ยังไม่เลือกกลุ่มสินค้า
let productSort = {key:'sku', dir:1}; // dir: 1 = น้อยไปมาก, -1 = มากไปน้อย
let contactSort = {key:'code', dir:1}; // เรียงลำดับตารางสมุดรายชื่อ
let productPage = 1;
let productReviewFilter = 'all';
let productReviewFilterUsed = false;
let productReviewRefreshInFlight=false;
let productReviewRefreshAt=0;
let productReviewRefreshTimer=null;
let productReviewRefreshDelay=15000;
let productReviewSignature=null;
let productReviewSignatureProfile=null;
let productReviewManifestCheckedAt=0;
function scheduleProductReviewRefresh(){
  clearTimeout(productReviewRefreshTimer);
  productReviewRefreshTimer=null;
  if(!currentProfile||currentTab!=='products'||editingProductId!==null||document.visibilityState==='hidden'||navigator.onLine===false) return;
  productReviewRefreshTimer=setTimeout(async()=>{
    await refreshProductReviewColors();
    scheduleProductReviewRefresh();
  },productReviewRefreshDelay);
}
function canRefreshProductReviewColors(){
  const focused=document.activeElement;
  return Boolean(currentProfile)&&currentTab==='products'&&editingProductId===null&&document.visibilityState!=='hidden'&&navigator.onLine!==false&&!coreSyncInFlight&&
    !(focused?.matches('input,textarea,select,[contenteditable="true"]')&&focused.id!=='search');
}
async function refreshProductReviewColors(){
  if(productReviewRefreshInFlight||!canRefreshProductReviewColors()||Date.now()-productReviewRefreshAt<15000) return false;
  productReviewRefreshInFlight=true;
  productReviewRefreshAt=Date.now();
  const profileId=currentProfile.id;
  try{
    // Missing RPC during a rolling deployment falls back to the existing manifest.
    let signature=null;
    if(typeof sb!=='undefined'&&typeof sb?.rpc==='function'){
      try{
        const result=await sb.rpc('get_product_catalog_signature');
        if(!result.error&&typeof result.data==='string') signature=result.data;
      }catch(error){ /* Full manifest remains the compatibility/safety path. */ }
    }
    if(currentProfile?.id!==profileId||!canRefreshProductReviewColors()) return false;
    if(signature&&signature===productReviewSignature&&productReviewSignatureProfile===profileId&&productDirtyOperations.size===0&&Date.now()-productReviewManifestCheckedAt<300000){
      productReviewRefreshDelay=Math.min(60000,productReviewRefreshDelay*2);
      return true;
    }
    // Compare compact id/revision pairs so price/unit changes are received
    // even when the review color stays the same. Fetch full rows only on change.
    const {data,error}=await fetchProductRevisionManifest();
    if(error) throw error;
    if(currentProfile?.id!==profileId||!canRefreshProductReviewColors()) return false;
    const revisions=new Map((data||[]).map(row=>[String(row.id),Number(row.revision)]));
    const localById=new Map(products.map(p=>[String(p.id),p]));
    const changedIds=(data||[]).filter(row=>!productDirtyOperations.has(String(row.id))&&(!localById.has(String(row.id))||Number(localById.get(String(row.id))._revision)!==Number(row.revision))).map(row=>row.id);
    const deletedIds=products.filter(p=>!revisions.has(String(p.id))&&!productDirtyOperations.has(String(p.id))).map(p=>p.id);
    const rememberSignature=()=>{
      if(productDirtyOperations.size===0){ productReviewSignature=signature; productReviewSignatureProfile=profileId; productReviewManifestCheckedAt=Date.now(); }
    };
    if(!changedIds.length&&!deletedIds.length){ rememberSignature(); productReviewRefreshDelay=Math.min(60000,productReviewRefreshDelay*2); return true; }
    const result=await fetchProductRowsByIds(changedIds);
    if(result.error) throw result.error;
    if(currentProfile?.id!==profileId||!canRefreshProductReviewColors()) return false;
    const byId=new Map(products.map((p,index)=>[String(p.id),index]));
    const updatedIds=[];
    for(const row of result.data||[]){
      const id=String(row.id),index=byId.get(id);
      if(productDirtyOperations.has(id)) continue;
      if(index===undefined){
        byId.set(id,products.length);
        products.push({...rowToProduct(row),stock:warehouseStock(row.id),expiry:warehouseExpiry(row.id)});
        syncedTableRows.products?.set(id,JSON.stringify(productMetadataToRow(products[products.length-1])));
        updatedIds.push(row.id);
        continue;
      }
      const previous=products[index];
      if(Number(row.revision)<Number(previous._revision)) continue;
      products[index]={...rowToProduct(row),stock:previous.stock,expiry:previous.expiry};
      syncedTableRows.products?.set(id,JSON.stringify(productMetadataToRow(products[index])));
      updatedIds.push(row.id);
    }
    // A local edit may start during either request. Never discard its draft.
    const removedIds=deletedIds.filter(id=>!productDirtyOperations.has(String(id)));
    if(removedIds.length){
      const removed=new Set(removedIds.map(String));
      products=products.filter(p=>!removed.has(String(p.id)));
      removedIds.forEach(id=>syncedTableRows.products?.delete(String(id)));
    }
    if(!updatedIds.length&&!removedIds.length) return true;
    productReviewRefreshDelay=15000;
    rebuildProductLookupMaps();
    const focused=document.activeElement;
    const searchFocused=focused?.id==='search';
    const selectionStart=focused?.selectionStart,selectionEnd=focused?.selectionEnd;
    const scrollTop=document.querySelector('.product-table-scroll')?.scrollTop||0;
    render();
    const scroller=document.querySelector('.product-table-scroll');
    if(scroller) scroller.scrollTop=scrollTop;
    if(searchFocused) restoreSearchInputFocus(selectionStart,selectionEnd);
    await persistProductChangesToIndexedDB({updatedIds,deletedIds:removedIds});
    rememberSignature();
    return true;
  }catch(error){
    console.warn('refresh product review colors failed',error);
    productReviewRefreshDelay=Math.min(60000,productReviewRefreshDelay*2);
    return false;
  }finally{ productReviewRefreshInFlight=false; }
}
// จำหน่วยที่เลือกไว้ต่อสินค้าแต่ละตัว ในหน้ารายการสินค้า (สำหรับสลับดูราคา/ทุนตามหน่วย)
let prodRowUnitSel = {};
const PRODUCT_LIST_UNIT_PREFERENCE_PREFIX='pepos_product_list_unit_v1:';
const productListUnitPreferenceFallback=new Map();
function productListUnitPreference(product){
  if(!product) return '';
  const id=String(product.id);
  let unit=productListUnitPreferenceFallback.get(id)||'';
  try{ if(!unit) unit=localStorage.getItem(PRODUCT_LIST_UNIT_PREFERENCE_PREFIX+id)||''; }catch(error){}
  return [product.unit,...(product.units||[]).map(item=>item.sub)].includes(unit)?unit:'';
}
function rememberProductListUnit(product,unit){
  if(!product||![product.unit,...(product.units||[]).map(item=>item.sub)].includes(unit)) return false;
  const id=String(product.id);
  prodRowUnitSel[id]=unit;
  try{
    // One key per product avoids serializing the catalog or overwriting another
    // tab's selections for unrelated products. This is a display preference only.
    localStorage.setItem(PRODUCT_LIST_UNIT_PREFERENCE_PREFIX+id,unit);
    productListUnitPreferenceFallback.delete(id);
    return true;
  }catch(error){
    productListUnitPreferenceFallback.set(id,unit);
    showToast('เปลี่ยนหน่วยแล้ว แต่เครื่องไม่สามารถจำหน่วยหลังปิดโปรแกรมได้ กรุณาตรวจพื้นที่หรือการตั้งค่าเบราว์เซอร์','warning-top');
    return false;
  }
}
const PRODUCTS_PER_PAGE = 10;
