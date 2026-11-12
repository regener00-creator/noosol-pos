function inspectionListLocalDateKey(value=new Date()){
  const date=value instanceof Date?value:new Date(value||'');
  if(Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function inspectionListDefaultName(now=new Date()){
  const todayKey=inspectionListLocalDateKey(now);
  let highest=0;
  inspectionLists.forEach(list=>{
    if(!documentInActiveStore(list)||inspectionListLocalDateKey(list.createdAt)!==todayKey) return;
    const matched=String(list.name||'').trim().match(/^ตรวจสินค้า:\s*(\d+)$/);
    if(matched) highest=Math.max(highest,Number(matched[1])||0);
  });
  return `ตรวจสินค้า: ${highest+1}`;
}
function openInspectionListEditor(id='new',shouldRender=true){
  editingInspectionListId=id;
  inspectionListCatFilter={wh:'',category:'',brand:''}; inspectionListSearchQuery=''; inspectionListPage=1; inspectionListSort={key:'sku',dir:1};
  if(id==='new'){
    const now=new Date();
    inspectionListDraft={id:null,name:inspectionListDefaultName(now),warehouseId:Number(activeWarehouseId)||0,items:[],createdAt:now.toISOString(),updatedAt:now.toISOString(),createdBy:currentProfile?.firstName||currentProfile?.username||'',stockAdjustedAt:'',stockAdjustedBy:''};
  }else{
    const list=inspectionLists.find(entry=>documentInActiveStore(entry)&&String(entry.id)===String(id));
    if(list?.stockAdjustedAt){
      editingInspectionListId=null; inspectionListDraft=null;
      showToast('รายการนี้บันทึกผลแล้ว');
      if(shouldRender) render();
      return;
    }
    inspectionListDraft=list?JSON.parse(JSON.stringify(list)):null;
    if(!inspectionListDraft){ editingInspectionListId=null; showToast('ไม่พบรายการตรวจสินค้า'); }
  }
  if(shouldRender) render();
}
function inspectionListAddProduct(product,unitName){
  if(!product||!inspectionListDraft) return false;
  const selected=inspectionListUnitOptions(product).find(option=>option.name===unitName)||inspectionListUnitOptions(product)[0];
  const existing=inspectionListDraft.items.find(item=>Number(item.pid)===Number(product.id));
  if(existing){ if(selected) existing.unit=selected.name; return false; }
  inspectionListDraft.items.push({pid:product.id,unit:selected?.name||product.unit});
  inspectionListPage=Math.max(1,Math.ceil(inspectionListDraft.items.length/INSPECTION_LIST_PAGE_SIZE));
  return true;
}
async function saveInspectionListDraft(){
  if(!inspectionListDraft||!documentInActiveStore(inspectionListDraft)) return false;
  const name=(document.getElementById('inspectionListName')?.value||inspectionListDraft.name||'').trim();
  if(!name){ showToast('กรุณากรอกชื่อรายการตรวจสินค้า','danger'); document.getElementById('inspectionListName')?.focus(); return false; }
  if(!inspectionListDraft.items.length){ showToast('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ','danger'); document.getElementById('inspectionListSearch')?.focus(); return false; }
  const now=new Date().toISOString();
  const saved={...inspectionListDraft,name,warehouseId:Number(inspectionListDraft.warehouseId)||Number(activeWarehouseId)||0,items:inspectionListDraft.items.map(item=>({pid:Number(item.pid),unit:String(item.unit||'')})),updatedAt:now,stockAdjustedAt:'',stockAdjustedBy:''};
  const view=captureStoreView(),draft=inspectionListDraft,isNew=editingInspectionListId==='new';
  if(isNew){
    saved.id=await reserveDraftNumber(draft,'inspection');
    if(!saved.id||inspectionListDraft!==draft||editingInspectionListId!=='new') return false;
    draft.id=saved.id;
    draft.createdAt||=now;
    saved.createdAt=draft.createdAt;
    saved.updatedAt=draft.createdAt;
    draft._clientCreateToken||=generateProductCreateToken();
    saved._clientCreateToken=draft._clientCreateToken;
  }
  if(!await commitInspectionList(saved,isNew?'create':'update'))return false;
  if(!isStoreViewCurrent(view)||inspectionListDraft!==draft)return true;
  editingInspectionListId=null; inspectionListDraft=null; inspectionListSearchQuery=''; inspectionListCatFilter={wh:'',category:'',brand:''}; inspectionListPage=1;
  showToast('บันทึกรายการตรวจสินค้าแล้ว'); render(); return true;
}

function clearInspectionListRuntimeReferences(id){
  const normalizedId=String(id);
  inspectionListOverviewSelectedIds.delete(normalizedId);
  mobileInspectionCheckedByList.delete(normalizedId);
  if(String(mobileInspectionListId)===normalizedId) mobileInspectionListId='';
  if(String(mobileInspectionOpenedListId)===normalizedId){ mobileInspectionOpenedListId=''; resetMobileInspectionSavedAdd(); }
  if(String(mobileStockSourceListId)===normalizedId) mobileStockSourceListId='';
  if(String(stockEditSourceInspectionListId)===normalizedId){
    stockEditSourceInspectionListId=null;
    stockEditSourcePending=false;
  }
}
async function deleteInspectionListById(id){
  const list=inspectionLists.find(entry=>documentInActiveStore(entry)&&String(entry.id)===String(id));
  if(!list) return false;
  if(!confirm(`ต้องการลบรายการ “${list.name}” ใช่หรือไม่?`)) return false;
  const view=captureStoreView();
  if(!await commitInspectionList(list,'delete'))return false;
  if(!isStoreViewCurrent(view))return true;
  showToast('ลบรายการตรวจสินค้าแล้ว');
  render();
  return true;
}
async function deleteSelectedInspectionLists(){
  const existingIds=new Set(inspectionLists.filter(documentInActiveStore).map(list=>String(list.id)));
  const selectedIds=new Set([...inspectionListOverviewSelectedIds].filter(id=>existingIds.has(String(id))).map(String));
  if(!selectedIds.size){ showToast('กรุณาติ๊กรายการที่ต้องการลบ','danger'); return false; }
  if(!confirm(`ต้องการลบรายการตรวจสินค้าที่เลือก ${selectedIds.size} รายการ ใช่หรือไม่?`)) return false;
  const view=captureStoreView();
  const selected=inspectionLists.filter(list=>documentInActiveStore(list)&&selectedIds.has(String(list.id)));
  for(const list of selected){
    if(!isStoreViewCurrent(view))return false;
    if(!await commitInspectionList(list,'delete')){if(isStoreViewCurrent(view))render();return false;}
  }
  if(!isStoreViewCurrent(view))return true;
  showToast(`ลบรายการตรวจสินค้าแล้ว ${selectedIds.size} รายการ`);
  render();
  return true;
}

const CODE128_PATTERNS=[
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'
];
