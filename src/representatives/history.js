function emptyRepresentativeHistoryFilter(){ return {representativeSearch:'',productSearch:'',noteSearch:''}; }
function centralRepresentativeHistoryContext(){ return {representativeId:null,productId:null,originTab:'representativehistory',central:true,returnFilter:null}; }
function isRepresentativeHistoryScreen(){ return currentTab==='salesreps'||currentTab==='representativehistory'; }
function representativeActivityTypeLabel(type){ return REPRESENTATIVE_ACTIVITY_TYPES[type]||'หมายเหตุ'; }
function representativeActivityDateLabel(value){ return value?isoToDMY(String(value).slice(0,10)).replaceAll('/','-'):'-'; }
function representativeNoteDateLabel(value){ return value?isoToDMY(String(value).slice(0,10)).replaceAll('/',' / '):'-'; }
function representativeNoteNumber(note,fallback=1){
  const number=Number(representativeNoteMetadata.get(String(note?.id||''))?.number);
  return Number.isFinite(number)&&number>0?number:fallback;
}
function representativeNoteTotal(representativeId,fallback=0){
  const total=Number(representativeNoteTotals.get(Number(representativeId)));
  return Number.isFinite(total)&&total>=0?total:fallback;
}
function mergeRepresentativeNoteMetadata(rows,{replace=false}={}){
  if(replace){ representativeNoteMetadata=new Map(); representativeNoteTotals=new Map(); }
  (rows||[]).forEach(row=>{
    const representativeId=Number(row.representative_id);
    if(!representativeId) return;
    representativeNoteTotals.set(representativeId,Math.max(0,Number(row.note_count)||0));
    if(row.note_id) representativeNoteMetadata.set(String(row.note_id),{number:Math.max(1,Number(row.note_number)||1),total:Math.max(0,Number(row.note_count)||0)});
  });
}
function isMissingRepresentativeNoteMetadataRpc(error){
  const details=[error?.message,error?.details,error?.hint].filter(Boolean).join(' ');
  return String(error?.code||'')==='PGRST202'&&details.includes('get_representative_note_metadata');
}
async function fetchRepresentativeNoteMetadata(representativeIds,noteIds){
  const ids=(representativeIds||[]).map(Number).filter(Boolean);
  if(!ids.length) return {data:[],error:null};
  const result=await sb.rpc('get_representative_note_metadata',{
    p_representative_ids:ids,p_note_ids:(noteIds||[]).filter(Boolean)
  });
  if(isMissingRepresentativeNoteMetadataRpc(result.error)){
    console.warn('Representative NOTE metadata RPC is not available yet; using loaded-page numbering.');
    return {data:[],error:null};
  }
  return result;
}
function representativeForActivityId(id){ return salesRepresentatives.find(rep=>Number(rep.id)===Number(id))||null; }
function productForActivityId(id){ return products.find(product=>Number(product.id)===Number(id))||null; }
function resetRepresentativeActivityLoad(){
  representativeActivityNotes=[];
  representativeProductAssignments=[];
  representativeHistoryRepresentativeIds=[];
  representativeHistoryHasMore=false;
  representativeHistoryCursor=null;
  representativeNotesHasMore=false;
  representativeNotesCursor=null;
  representativeNoteMetadata=new Map();
  representativeNoteTotals=new Map();
  representativeActivityLoadedKey='';
  representativeActivityLoadError='';
  representativeActivityLoading=false;
  selectedRepresentativeNoteIdsToDelete.clear();
  selectedSalesRepresentativeIdsToDelete.clear();
}
function openRepresentativeHistory({representativeId=null,productId=null,originTab=currentTab}={}){
  if(!representativeId&&!productId) return;
  representativeHistoryContext={
    representativeId:representativeId?Number(representativeId):null,
    productId:productId?Number(productId):null,
    originTab:originTab||'salesreps',central:false,
    returnFilter:originTab==='representativehistory'?{...representativeHistoryFilter}:null
  };
  representativeHistoryFilter=emptyRepresentativeHistoryFilter();
  representativeActivityDraft=null;
  representativeActivityDraftDirty=false;
  representativeProductsEditor=null;
  selectedRepresentativeNoteId=null;
  editingSalesRepresentativeId=null;
  resetRepresentativeActivityLoad();
  currentTab=originTab==='representativehistory'?'representativehistory':'salesreps';
  render();
}
function closeRepresentativeHistory(){
  if(representativeActivityDraftDirty&&!confirm('มี NOTE ที่ยังไม่ได้บันทึก ต้องการย้อนกลับหรือไม่?')) return;
  const origin=representativeHistoryContext?.originTab||'salesreps';
  const returnFilter=representativeHistoryContext?.returnFilter;
  representativeHistoryContext=origin==='representativehistory'?centralRepresentativeHistoryContext():null;
  representativeHistoryFilter=origin==='representativehistory'&&returnFilter?returnFilter:emptyRepresentativeHistoryFilter();
  representativeActivityDraft=null;
  representativeActivityDraftDirty=false;
  representativeProductsEditor=null;
  selectedRepresentativeNoteId=null;
  resetRepresentativeActivityLoad();
  currentTab=origin;
  render();
}
function renderRepresentativeHistoryOverview(){
  if(!representativeHistoryContext){
    representativeHistoryContext=centralRepresentativeHistoryContext();
    representativeHistoryFilter=emptyRepresentativeHistoryFilter();
    resetRepresentativeActivityLoad();
  }
  return renderRepresentativeHistory();
}
async function loadRepresentativeActivityHistory({force=false,append=false}={}){
  const context=representativeHistoryContext,key=representativeHistoryKey(context);
  if(!context||representativeActivityLoading||(!force&&!append&&representativeActivityLoadedKey===key)) return;
  if(force&&!append){
    representativeActivityNotes=[];
    representativeProductAssignments=[];
    representativeHistoryRepresentativeIds=[];
    representativeHistoryHasMore=false;
    representativeHistoryCursor=null;
    representativeNotesHasMore=false;
    representativeNotesCursor=null;
    representativeNoteMetadata=new Map();
    representativeNoteTotals=new Map();
    representativeActivityLoadedKey='';
  }
  representativeActivityLoading=true;
  representativeActivityLoadError='';
  if(isRepresentativeHistoryScreen()) render();
  try{
    const detailMode=!!context.representativeId&&!context.productId&&!context.central;
    if(detailMode){
      const representativeId=Number(context.representativeId);
      const [assignmentResult,activityResult]=await Promise.all([
        fetchAllRows(()=>sb.from('sales_representative_products').select('representative_id,product_id,created_at,updated_at').eq('representative_id',representativeId).order('product_id')),
        sb.rpc('get_representative_notes_page',{
          p_representative_id:representativeId,
          p_search:String(representativeHistoryFilter.noteSearch||'').trim()||null,
          p_cursor_event_date:append?representativeNotesCursor?.eventDate||null:null,
          p_cursor_updated_at:append?representativeNotesCursor?.updatedAt||null:null,
          p_cursor_id:append?representativeNotesCursor?.id||null:null,
          p_limit:REPRESENTATIVE_NOTE_PAGE_SIZE
        }).select(NOTE_ROW_SELECT)
      ]);
      if(assignmentResult.error) throw assignmentResult.error;
      if(activityResult.error) throw activityResult.error;
      const fetched=(activityResult.data||[]).map(mapNoteRow);
      const page=fetched.slice(0,REPRESENTATIVE_NOTE_PAGE_SIZE);
      const metadataResult=await fetchRepresentativeNoteMetadata([representativeId],page.map(note=>note.id));
      if(metadataResult.error) throw metadataResult.error;
      const mappedAssignments=(assignmentResult.data||[]).map(row=>({representativeId:Number(row.representative_id),productId:Number(row.product_id),createdAt:row.created_at||'',updatedAt:row.updated_at||''}));
      if(representativeHistoryKey()!==key) return;
      representativeHistoryRepresentativeIds=[representativeId];
      representativeProductAssignments=mappedAssignments;
      if(append){
        const merged=new Map(representativeActivityNotes.map(note=>[String(note.id),note]));
        page.forEach(note=>merged.set(String(note.id),note));
        representativeActivityNotes=[...merged.values()];
      }else representativeActivityNotes=page;
      mergeRepresentativeNoteMetadata(metadataResult.data,{replace:!append});
      representativeNotesHasMore=fetched.length>REPRESENTATIVE_NOTE_PAGE_SIZE;
      const last=page.at(-1);
      representativeNotesCursor=last?{eventDate:last.eventDate||'0001-01-01',updatedAt:last.updatedAt,id:last.id}:null;
    }else{
      const cursor=append?representativeHistoryCursor:null;
      const pageResult=await sb.rpc('get_representative_page',{
        p_representative_id:context.representativeId?Number(context.representativeId):null,
        p_product_id:context.productId?Number(context.productId):null,
        p_representative_search:String(representativeHistoryFilter.representativeSearch||'').trim()||null,
        p_product_search:String(representativeHistoryFilter.productSearch||'').trim()||null,
        p_note_search:String(representativeHistoryFilter.noteSearch||'').trim()||null,
        p_cursor_name:cursor?.name||null,
        p_cursor_id:cursor?.id||null,
        p_limit:REPRESENTATIVE_HISTORY_PAGE_SIZE
      });
      if(pageResult.error) throw pageResult.error;
      const fetched=pageResult.data||[];
      const page=fetched.slice(0,REPRESENTATIVE_HISTORY_PAGE_SIZE);
      const pageIds=page.map(row=>Number(row.representative_id)).filter(Boolean);
      const [assignmentResult,noteResult]=pageIds.length?await Promise.all([
        fetchAllRows(()=>sb.from('sales_representative_products').select('representative_id,product_id,created_at,updated_at').in('representative_id',pageIds).order('representative_id').order('product_id')),
        sb.rpc('get_representative_note_cards',{p_representative_ids:pageIds,p_search:String(representativeHistoryFilter.noteSearch||'').trim()||null,p_limit_per_representative:3}).select(NOTE_ROW_SELECT)
      ]):[{data:[],error:null},{data:[],error:null}];
      if(assignmentResult.error) throw assignmentResult.error;
      if(noteResult.error) throw noteResult.error;
      const noteMetadataResult=await fetchRepresentativeNoteMetadata(pageIds,(noteResult.data||[]).map(row=>row.id));
      if(noteMetadataResult.error) throw noteMetadataResult.error;
      if(representativeHistoryKey()!==key) return;
      const assignments=(assignmentResult.data||[]).map(row=>({representativeId:Number(row.representative_id),productId:Number(row.product_id),createdAt:row.created_at||'',updatedAt:row.updated_at||''}));
      const activityNotes=(noteResult.data||[]).map(mapNoteRow);
      if(append){
        representativeHistoryRepresentativeIds=[...new Set([...representativeHistoryRepresentativeIds,...pageIds])];
        representativeProductAssignments=[...representativeProductAssignments,...assignments];
        representativeActivityNotes=[...representativeActivityNotes,...activityNotes];
      }else{
        representativeHistoryRepresentativeIds=pageIds;
        representativeProductAssignments=assignments;
        representativeActivityNotes=activityNotes;
      }
      mergeRepresentativeNoteMetadata(noteMetadataResult.data,{replace:!append});
      representativeHistoryHasMore=fetched.length>REPRESENTATIVE_HISTORY_PAGE_SIZE;
      const last=page.at(-1);
      representativeHistoryCursor=last?{name:last.sort_name||'',id:Number(last.representative_id)}:null;
    }
    representativeActivityLoadedKey=key;
  }catch(error){
    representativeActivityLoadError=error?.message||'โหลดประวัติผู้แทนและสินค้าไม่สำเร็จ';
  }finally{
    representativeActivityLoading=false;
    if(isRepresentativeHistoryScreen()&&representativeHistoryKey()===key) render();
  }
}
function normalizedActivityName(value){ return String(value||'').trim().toLocaleLowerCase('th-TH'); }
function documentRepresentative(doc){
  const explicit=representativeForActivityId(doc?.representativeId||doc?.salesRepresentativeId);
  if(explicit) return explicit;
  const supplier=normalizedActivityName(doc?.supplier||doc?.representative||doc?.salesRepresentative);
  if(!supplier) return null;
  const nameMatches=salesRepresentatives.filter(rep=>normalizedActivityName(rep.name)===supplier);
  if(nameMatches.length===1) return nameMatches[0];
  if(nameMatches.length>1) return null;
  const companyMatches=salesRepresentatives.filter(rep=>normalizedActivityName(rep.company)===supplier);
  return companyMatches.length===1?companyMatches[0]:null;
}
function documentActivityItems(doc){
  return (Array.isArray(doc?.items)?doc.items:[]).map(item=>{
    const productId=Number(item?.productId||item?.pid)||null;
    const product=productForActivityId(productId)||products.find(candidate=>normalizedActivityName(candidate.name)===normalizedActivityName(item?.name));
    return {
      productId:product?.id||productId,
      name:item?.name||product?.name||'สินค้า',
      qty:Number(item?.qty??item?.quantity)||0,
      unit:item?.unit||product?.unit||'',
      price:Number(item?.price??item?.cost)||0
    };
  });
}
function representativeDocumentActivities(context=representativeHistoryContext){
  if(!context) return [];
  const sources=[
    {key:'purchase_orders',label:'สั่งซื้อสินค้า',type:'purchase_order',rows:purchaseOrders},
    {key:'goods_receipts',label:'ใบรับสินค้า',type:'goods_receipt',rows:goodsReceipts},
    {key:'product_returns',label:'ใบคืนสินค้า',type:'product_return',rows:productReturns}
  ];
  const events=[];
  sources.forEach(source=>(source.rows||[]).forEach(doc=>{
    const representative=documentRepresentative(doc);
    if(context.representativeId&&Number(representative?.id)!==Number(context.representativeId)) return;
    if(context.central&&!representative) return;
    const items=documentActivityItems(doc);
    const relevantItems=context.productId?items.filter(item=>Number(item.productId)===Number(context.productId)):items;
    if(context.productId&&!relevantItems.length) return;
    if(!representative&&context.productId) return;
    if(!representative&&context.representativeId) return;
    events.push({
      id:`${source.key}:${doc.id}`,manual:false,activityType:source.type,eventDate:String(doc.date||doc.receivedDate||'').slice(0,10),
      title:`${source.label} ${doc.id||''}`.trim(),contentHtml:doc.note?escapeHtml(doc.note):'',representativeId:representative?.id||null,
      productId:context.productId||null,items:relevantItems,sourceLabel:source.label,sourceId:doc.id||'',status:doc.status||'',
      quotedPrice:relevantItems.length===1?relevantItems[0].price:null,minimumQuantity:relevantItems.length===1?relevantItems[0].qty:null,
      unit:relevantItems.length===1?relevantItems[0].unit:'',updatedAt:doc.updatedAt||doc.date||''
    });
  }));
  return events;
}
function representativeTimelineActivities(){
  const manual=representativeActivityNotes.map(note=>{
    const sourceItems=note.activityItems?.length?note.activityItems:(note.productId?[{
      productId:note.productId,name:productForActivityId(note.productId)?.name||'สินค้าถูกลบ',minimumQuantity:note.minimumQuantity,
      unit:note.unit||'',quotedPrice:note.quotedPrice,conditionNote:''
    }]:[]);
    return {...note,manual:true,items:sourceItems.map(item=>({
      productId:item.productId,name:item.name||productForActivityId(item.productId)?.name||'สินค้าถูกลบ',qty:item.minimumQuantity,
      unit:item.unit||'',price:item.quotedPrice,conditionNote:item.conditionNote||''
    }))};
  });
  return [...manual,...representativeDocumentActivities()].sort((a,b)=>String(b.eventDate||b.updatedAt||'').localeCompare(String(a.eventDate||a.updatedAt||''))||String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
}
function activityFilterText(activity){
  const representative=representativeForActivityId(activity.representativeId);
  const items=(activity.items||[]).map(item=>{
    const product=productForActivityId(item.productId);
    return `${item.name} ${item.unit} ${item.conditionNote||''} ${product?.sku||''} ${product?.barcode||''}`;
  }).join(' ');
  return normalizedActivityName(`${activity.title} ${notePlainText(activity.contentHtml||'')} ${representative?.name||''} ${representative?.company||''} ${items} ${activity.sourceId||''} ${activity.status||''}`);
}
function managedProductIdsForRepresentative(representativeId){
  return representativeProductAssignments
    .filter(row=>Number(row.representativeId)===Number(representativeId))
    .map(row=>Number(row.productId))
    .filter(Boolean);
}
const REPRESENTATIVE_MANAGED_PRODUCT_INDEX_TTL_MS=60*1000;
function rebuildRepresentativeManagedProductIds(){
  representativeManagedProductIds=new Set(representativeManagedProductIndexRows.map(row=>Number(row.productId)).filter(Boolean));
}
function resetRepresentativeManagedProductIndex(){
  representativeManagedProductIndexToken+=1;
  representativeManagedProductIndexRows=[];
  representativeManagedProductIds=new Set();
  representativeManagedProductIndexLoaded=false;
  representativeManagedProductIndexLoadedAt=0;
  representativeManagedProductIndexPromise=null;
}
function updateRepresentativeManagedProductIndex(representativeId,productIds){
  if(!representativeManagedProductIndexLoaded) return;
  const repId=Number(representativeId);
  representativeManagedProductIndexRows=[
    ...representativeManagedProductIndexRows.filter(row=>Number(row.representativeId)!==repId),
    ...(productIds||[]).map(Number).filter(Boolean).map(productId=>({representativeId:repId,productId}))
  ];
  rebuildRepresentativeManagedProductIds();
  representativeManagedProductIndexLoadedAt=Date.now();
}
function removeRepresentativesFromManagedProductIndex(representativeIds){
  if(!representativeManagedProductIndexLoaded) return;
  const ids=new Set((representativeIds||[]).map(Number).filter(Boolean));
  representativeManagedProductIndexRows=representativeManagedProductIndexRows.filter(row=>!ids.has(Number(row.representativeId)));
  rebuildRepresentativeManagedProductIds();
  representativeManagedProductIndexLoadedAt=Date.now();
}
function productHasManagedRepresentative(productId){
  return representativeManagedProductIndexLoaded&&representativeManagedProductIds.has(Number(productId));
}
async function loadRepresentativeManagedProductIndex({force=false}={}){
  if(!currentProfile||isLevel2User()) return false;
  const fresh=representativeManagedProductIndexLoaded&&(Date.now()-representativeManagedProductIndexLoadedAt)<REPRESENTATIVE_MANAGED_PRODUCT_INDEX_TTL_MS;
  if(!force&&fresh) return true;
  if(representativeManagedProductIndexPromise) return representativeManagedProductIndexPromise;
  const profileId=String(currentProfile.id||'');
  const requestToken=++representativeManagedProductIndexToken;
  const request=(async()=>{
    try{
      const {data,error}=await fetchAllRows(()=>sb.from('sales_representative_products').select('representative_id,product_id').order('product_id'));
      if(error) throw error;
      if(requestToken!==representativeManagedProductIndexToken||String(currentProfile?.id||'')!==profileId) return false;
      representativeManagedProductIndexRows=(data||[]).map(row=>({representativeId:Number(row.representative_id),productId:Number(row.product_id)})).filter(row=>row.representativeId&&row.productId);
      rebuildRepresentativeManagedProductIds();
      representativeManagedProductIndexLoaded=true;
      representativeManagedProductIndexLoadedAt=Date.now();
      if(currentTab==='products'&&editingProductId===null) render();
      return true;
    }catch(error){
      console.warn('load representative managed product index',error);
      return false;
    }finally{
      if(representativeManagedProductIndexPromise===request) representativeManagedProductIndexPromise=null;
    }
  })();
  representativeManagedProductIndexPromise=request;
  return request;
}
function newRepresentativeNoteDraft(){
  const context=representativeHistoryContext||{};
  const representativeId=context.representativeId||'';
  if(!representativeId) return null;
  return {id:'new',representativeId,eventDate:TODAY_STR,title:'',contentHtml:'',updatedAt:''};
}
function representativeNoteDraftFromRow(note){
  if(!note) return null;
  return {
    id:note.id,representativeId:note.representativeId||'',eventDate:note.eventDate||TODAY_STR,
    title:note.title||'',contentHtml:sanitizeNoteHtml(note.contentHtml||''),updatedAt:note.updatedAt||''
  };
}
function representativeNoteEditorPanelHtml({draft,selected,noteNumber,canCreate}){
  if(!draft) return '';
  const isNew=draft.id==='new';
  const canEdit=isNew?canCreate:canEditNote(selected);
  const canDelete=!isNew&&canDeleteNote(selected);
  return `<form class="note-editor-panel representative-note-inline-editor" id="representativeNoteEditorForm">
    <div class="representative-note-inline-fields"><div class="note-editor-heading"><label for="repActivityTitle">NOTE ${noteNumber}</label><input id="repActivityTitle" maxlength="160" autocomplete="off" value="${escapeHtml(draft.title||'')}" ${canEdit?'':'readonly'} placeholder="ตั้งชื่อโน้ต"></div><div class="note-editor-heading"><label for="repActivityEventDate">วันที่</label>${dmyDateFieldHtml('repActivityEventDate',draft.eventDate||TODAY_STR,{readonly:!canEdit,extraClass:'representative-note-date-input'})}</div></div>
    <div class="note-toolbar representative-note-toolbar" role="toolbar" aria-label="จัดรูปแบบข้อมูลเพิ่มเติม"><button type="button" data-representative-note-command="bold" title="ตัวหนา" aria-label="ตัวหนา" ${canEdit?'':'disabled'}><b>B</b></button><button type="button" data-representative-note-command="underline" title="ขีดเส้นใต้" aria-label="ขีดเส้นใต้" ${canEdit?'':'disabled'}><u>U</u></button><button type="button" data-representative-note-command="strikeThrough" title="ขีดฆ่า" aria-label="ขีดฆ่า" ${canEdit?'':'disabled'}><s>S</s></button><span class="note-toolbar-divider"></span><span class="note-color-label">สีข้อความ</span><span class="note-color-list">${NOTE_COLORS.map(([color,label])=>`<button type="button" class="note-color-swatch" data-representative-note-color="${color}" style="--note-color:${color}" title="${escapeHtml(label)}" aria-label="สี${escapeHtml(label)}" ${canEdit?'':'disabled'}></button>`).join('')}</span></div>
    <div id="repActivityContentEditor" class="note-content-editor representative-note-content-editor ${canEdit?'':'readonly'}" contenteditable="${canEdit?'true':'false'}" role="textbox" aria-multiline="true" data-placeholder="เขียนข้อความที่นี่…">${sanitizeNoteHtml(draft.contentHtml||'')}</div>
    <div class="note-editor-footer"><span>${isNew?'โน้ตใหม่':`แก้ไขล่าสุด ${escapeHtml(noteUpdatedText(selected?.updatedAt))}`}</span><div>${canDelete?'<button class="btn danger" id="deleteRepresentativeNoteBtn" type="button">ลบโน้ต</button>':''}${canEdit?'<button class="btn primary" id="saveRepresentativeActivityBtn" type="submit">บันทึกโน้ต</button>':''}</div></div>
  </form>`;
}
function openRepresentativeProductsEditor(representativeId){
  const representative=representativeForActivityId(representativeId);
  if(!representative) return;
  representativeProductsEditor={representativeId:Number(representativeId),productIds:new Set(managedProductIdsForRepresentative(representativeId)),search:''};
  render();
}
function representativeProductsEditorMatches(){
  const editor=representativeProductsEditor;
  if(!editor) return [];
  const needle=normalizedActivityName(editor.search);
  if(!needle) return [];
  const matches=products.filter(product=>normalizedActivityName(`${product.name||''} ${product.sku||''} ${product.barcode||''}`).includes(needle));
  return matches.sort((a,b)=>{
    const searchRank=product=>{
      const sku=normalizedActivityName(product.sku),barcode=normalizedActivityName(product.barcode),name=normalizedActivityName(product.name);
      if(sku===needle||barcode===needle) return 0;
      if(sku.startsWith(needle)||barcode.startsWith(needle)) return 1;
      if(name.startsWith(needle)) return 2;
      return 3;
    };
    return searchRank(a)-searchRank(b)||String(a.name||'').localeCompare(String(b.name||''),'th');
  }).slice(0,12);
}
function representativeProductsSearchResultsHtml(){
  const editor=representativeProductsEditor;
  if(!editor) return '';
  const needle=normalizedActivityName(editor.search);
  if(!needle) return '';
  const canEdit=canPerformPageAction('edit','salesreps');
  const rows=representativeProductsEditorMatches();
  return rows.length?rows.map(product=>{
    const selected=editor.productIds.has(Number(product.id));
    return `<button type="button" class="representative-product-search-result ${selected?'selected':''}" data-add-representative-product="${product.id}" ${canEdit&&!selected?'':'disabled'}><span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.sku||'-')} · ${escapeHtml(product.barcode||'ไม่มีบาร์โค้ด')}</small></span><em>${selected?'เลือกแล้ว':'เลือก'}</em></button>`;
  }).join(''):'<div class="representative-products-empty">ไม่พบสินค้าที่ค้นหา</div>';
}
function representativeProductsSelectedHtml(){
  const editor=representativeProductsEditor;
  if(!editor) return '';
  const canEdit=canPerformPageAction('edit','salesreps');
  const selected=[...editor.productIds].map(productForActivityId).filter(Boolean).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'th'));
  return selected.length?selected.map(product=>`<article class="representative-product-choice representative-product-selected-card"><span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.sku||'-')} · ${escapeHtml(product.barcode||'ไม่มีบาร์โค้ด')}</small></span>${canEdit?`<button type="button" data-remove-representative-product="${product.id}" aria-label="ลบ ${escapeHtml(product.name)}">×</button>`:''}</article>`).join(''):'<div class="representative-products-empty">ยังไม่ได้เลือกสินค้า</div>';
}
function representativeProductsEditorModalHtml(){
  const editor=representativeProductsEditor;
  if(!editor) return '';
  const representative=representativeForActivityId(editor.representativeId);
  const canEdit=canPerformPageAction('edit','salesreps');
  return `<div class="modal-overlay representative-products-overlay"><section class="modal representative-products-modal" role="dialog" aria-modal="true" aria-labelledby="representativeProductsTitle"><div class="modal-head"><div><h3 id="representativeProductsTitle">สินค้าที่ดูแล</h3><div class="sub">ผู้แทน ${escapeHtml(representative?.name||'-')} · เลือกแล้ว <b id="representativeProductsSelectedCount">${editor.productIds.size}</b> รายการ</div></div><button class="modal-close" id="closeRepresentativeProductsEditorBtn" type="button" aria-label="ปิด">×</button></div>
    <div class="representative-products-editor-body"><div class="representative-products-search"><input id="representativeProductsSearch" autocomplete="off" value="${escapeHtml(editor.search)}" placeholder="ค้นหาชื่อสินค้า รหัส หรือยิงบาร์โค้ด" role="combobox" aria-autocomplete="list" aria-controls="representativeProductsDropdown" aria-expanded="${normalizedActivityName(editor.search)?'true':'false'}"><div class="representative-products-dropdown" id="representativeProductsDropdown" role="listbox" ${normalizedActivityName(editor.search)?'':'hidden'}>${representativeProductsSearchResultsHtml()}</div></div><div class="representative-products-selected"><h4>สินค้าที่เลือก</h4><div id="representativeProductsSelectedList">${representativeProductsSelectedHtml()}</div></div></div>
    <div class="representative-products-actions"><button class="btn ghost" id="cancelRepresentativeProductsEditorBtn" type="button">${canEdit?'ยกเลิก':'ปิด'}</button>${canEdit?'<button class="btn primary" id="saveRepresentativeProductsBtn" type="button">บันทึกสินค้าที่ดูแล</button>':''}</div></section></div>`;
}
function representativeEditorModalHtml(){
  if(editingSalesRepresentativeId===null) return '';
  const isNew=editingSalesRepresentativeId==='new';
  const representative=isNew?{name:'',phone:'',line:'',company:'',note:''}:salesRepresentatives.find(item=>Number(item.id)===Number(editingSalesRepresentativeId));
  if(!representative) return '';
  return `<div class="modal-overlay representative-editor-overlay"><section class="modal representative-editor-modal" role="dialog" aria-modal="true" aria-labelledby="representativeEditorTitle">
    <div class="modal-head"><div><h3 id="representativeEditorTitle">${isNew?'เพิ่มข้อมูลผู้แทน':'แก้ไขข้อมูลผู้แทน'}</h3></div><button class="modal-close" id="cancelSalesRepBtn" type="button" aria-label="ปิด">×</button></div>
    <div class="representative-editor-body"><div class="representative-editor-grid">
      <div class="crow"><label>ชื่อผู้แทน <span class="req">*</span></label><input id="sr_name" value="${escapeHtml(representative.name||'')}" placeholder="ชื่อผู้แทน"></div>
      <div class="crow"><label>เบอร์โทร</label><input id="sr_phone" class="phone-input" value="${escapeHtml(representative.phone||'')}" placeholder="เบอร์มือถือ / โทรศัพท์"></div>
      <div class="crow"><label>ไลน์</label><input id="sr_line" value="${escapeHtml(representative.line||'')}" placeholder="LINE ID หรือเบอร์ที่ใช้กับไลน์"></div>
      <div class="crow"><label>บริษัท</label><input id="sr_company" value="${escapeHtml(representative.company||'')}" placeholder="บริษัท/ร้านที่ผู้แทนดูแล"></div>
      <div class="crow representative-editor-note"><label>ข้อมูลเพิ่มเติม</label><textarea id="sr_note" rows="5" placeholder="เช่น เขตพื้นที่ หรือช่วงเวลาที่ติดต่อสะดวก">${escapeHtml(representative.note||'')}</textarea></div>
    </div></div>
    <div class="representative-editor-actions"><button class="btn ghost" id="cancelSalesRepBottomBtn" type="button">ยกเลิก</button><button class="btn primary" id="saveSalesRepBtn" type="button">บันทึกข้อมูลผู้แทน</button></div>
  </section></div>`;
}
function openRepresentativeAdditionalInfo(representativeId){
  const representative=representativeForActivityId(representativeId);
  if(!representative) return;
  const info=String(representative.note||'').trim();
  const overlay=document.createElement('div');
  overlay.className='modal-overlay representative-info-overlay';
  overlay.innerHTML=`<section class="modal representative-info-modal" role="dialog" aria-modal="true" aria-labelledby="representativeInfoTitle"><div class="modal-head"><div><h3 id="representativeInfoTitle">ข้อมูลเพิ่มเติม</h3><div class="sub">ผู้แทน ${escapeHtml(representative.name||'-')}</div></div><button class="modal-close" type="button" aria-label="ปิด">×</button></div><div class="representative-info-body">${info?escapeHtml(info).replace(/\r?\n/g,'<br>'):'ไม่มีข้อมูลเพิ่มเติม'}</div><div class="representative-info-actions"><button class="btn primary" type="button">ปิด</button></div></section>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').addEventListener('click',close);
  overlay.querySelector('.representative-info-actions .btn').addEventListener('click',close);
  overlay.addEventListener('mousedown',event=>{ if(event.target===overlay) close(); });
}
function representativeActivityCardHtml(activity){
  const representative=representativeForActivityId(activity.representativeId);
  const product=activity.productId?productForActivityId(activity.productId):null;
  const itemHtml=(activity.items||[]).length?`<div class="representative-activity-items">${activity.items.map(item=>{
    const details=[];
    if(item.price!=null&&(activity.manual||Number(item.price)!==0)) details.push(`${fmtMoney(item.price)} บาท${item.unit?` / ${escapeHtml(item.unit)}`:''}`);
    if(item.qty) details.push(`ขั้นต่ำ ${escapeHtml(inventoryMovementRound(item.qty))} ${escapeHtml(item.unit||'')}`);
    if(item.conditionNote) details.push(escapeHtml(item.conditionNote));
    return `<div>${item.productId?`<button type="button" class="representative-activity-link" data-open-product-history="${escapeHtml(item.productId)}">${escapeHtml(item.name)}</button>`:`<b>${escapeHtml(item.name)}</b>`}${details.length?`<small>${details.join(' · ')}</small>`:''}</div>`;
  }).join('')}</div>`:'';
  const commercial=[];
  if(!(activity.items||[]).length&&activity.quotedPrice!=null) commercial.push(`ราคา ${fmtMoney(activity.quotedPrice)} บาท${activity.unit?` / ${escapeHtml(activity.unit)}`:''}`);
  if(!(activity.items||[]).length&&activity.minimumQuantity) commercial.push(`ขั้นต่ำ ${escapeHtml(inventoryMovementRound(activity.minimumQuantity))} ${escapeHtml(activity.unit||'')}`);
  if(activity.validFrom||activity.validTo) commercial.push(`ช่วง ${escapeHtml(representativeActivityDateLabel(activity.validFrom))} – ${escapeHtml(representativeActivityDateLabel(activity.validTo))}`);
  if(activity.reminderDate) commercial.push(`ติดตาม ${escapeHtml(representativeActivityDateLabel(activity.reminderDate))}`);
  const identity=[];
  if(representative) identity.push(`<button type="button" class="representative-activity-link" data-open-representative-history="${escapeHtml(representative.id)}">ผู้แทน ${escapeHtml(representative.name)}</button>`);
  else identity.push('ไม่พบผู้แทน');
  if(product&&!(activity.items||[]).length) identity.push(`<button type="button" class="representative-activity-link" data-open-product-history="${escapeHtml(product.id)}">${escapeHtml(product.name)}</button>`);
  if(activity.status) identity.push(escapeHtml(activity.status));
  return `<article class="representative-activity-card ${activity.manual?'manual':'document'}">
    <div class="representative-activity-date"><b>${escapeHtml(representativeActivityDateLabel(activity.eventDate))}</b><span>${escapeHtml(representativeActivityTypeLabel(activity.activityType))}</span></div>
    <div class="representative-activity-body"><div class="representative-activity-title"><div><h3>${escapeHtml(activity.title||'-')}</h3><p>${identity.join('<span aria-hidden="true"> · </span>')}</p></div><span class="representative-activity-source">${activity.manual?'NOTE':escapeHtml(activity.sourceLabel||'เอกสาร')}</span></div>
      ${commercial.length?`<div class="representative-activity-commercial">${commercial.map(text=>`<span>${text}</span>`).join('')}</div>`:''}${itemHtml}
      ${activity.contentHtml?`<div class="representative-activity-note">${sanitizeNoteHtml(activity.contentHtml)}</div>`:''}
    </div>
  </article>`;
}
function representativeHistoryGroups(){
  const context=representativeHistoryContext||{};
  const groupIds=new Set();
  if(context.central||context.productId) representativeHistoryRepresentativeIds.forEach(id=>groupIds.add(Number(id)));
  representativeProductAssignments.forEach(row=>groupIds.add(Number(row.representativeId)));
  representativeActivityNotes.forEach(note=>groupIds.add(Number(note.representativeId)));
  if(context.representativeId) groupIds.add(Number(context.representativeId));
  return [...groupIds].map(id=>{
    const representative=representativeForActivityId(id);
    if(!representative) return null;
    const managedProducts=representativeProductAssignments
      .filter(row=>Number(row.representativeId)===id)
      .map(row=>productForActivityId(row.productId))
      .filter(Boolean)
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'th'));
    const notesForRepresentative=representativeActivityNotes
      .filter(note=>Number(note.representativeId)===id)
      .sort((a,b)=>String(b.eventDate||b.updatedAt||'').localeCompare(String(a.eventDate||a.updatedAt||''))||String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    return {representative,managedProducts,notes:notesForRepresentative,noteTotal:representativeNoteTotal(id,notesForRepresentative.length)};
  }).filter(Boolean).sort((a,b)=>String(a.representative.name||'').localeCompare(String(b.representative.name||''),'th'));
}
function representativeHistoryGroupHtml(group,allowDeleteSelection=false){
  const visibleNotes=group.notes.slice(0,3);
  const notesHtml=visibleNotes.length?visibleNotes.map((note,index)=>representativeHistoryNoteHtml(note,Math.max(1,group.noteTotal-index))).join(''):'<div class="representative-group-empty">ยังไม่มี NOTE</div>';
  const hiddenNoteCount=Math.max(0,group.noteTotal-visibleNotes.length);
  const groupMeta=[group.representative.company?`<small>${escapeHtml(group.representative.company)}</small>`:'',hiddenNoteCount?`<span class="representative-note-overflow">+${hiddenNoteCount}</span>`:''].filter(Boolean).join('');
  const representativeId=Number(group.representative.id);
  const deleteChoice=allowDeleteSelection&&canPerformPageAction('delete','salesreps')?`<label class="representative-group-delete-choice" title="เลือกผู้แทนนี้เพื่อลบ"><input type="checkbox" data-sales-representative-delete="${representativeId}" aria-label="เลือกผู้แทน ${escapeHtml(group.representative.name)} เพื่อลบ" ${selectedSalesRepresentativeIdsToDelete.has(representativeId)?'checked':''}></label>`:'';
  return `<article class="representative-group-card" data-representative-card-open="${representativeId}" role="button" tabindex="0" aria-label="เปิดข้อมูลผู้แทน ${escapeHtml(group.representative.name)}"><header><div>${deleteChoice}<span>ชื่อผู้แทน</span><button type="button" data-open-representative-history="${representativeId}">${escapeHtml(group.representative.name)}</button></div>${groupMeta?`<div class="representative-group-meta">${groupMeta}</div>`:''}</header><section class="representative-notes-list">${notesHtml}</section></article>`;
}
function representativeHistoryNoteHtml(note,fallbackNumber){
  return `<article class="representative-note-card"><div class="representative-note-head"><b>NOTE ${representativeNoteNumber(note,fallbackNumber)} : ${escapeHtml(note.title||'-')}</b><span>${escapeHtml(representativeNoteDateLabel(note.eventDate))}</span></div>${note.contentHtml?`<div class="representative-note-body">${sanitizeNoteHtml(note.contentHtml)}</div>`:'<div class="representative-note-body muted">ไม่มีข้อมูลเพิ่มเติม</div>'}</article>`;
}
function representativeProfileHtml(group){
  const representative=group.representative;
  const field=(label,value,className='')=>`<div class="representative-profile-field ${className}">${label?`<span>${label}</span>`:''}<div>${value}</div></div>`;
  const additionalInfo=String(representative.note||'').trim();
  const additionalInfoHtml=additionalInfo
    ?`<button type="button" class="representative-profile-info-trigger" data-view-representative-info="${representative.id}" title="เปิดดูข้อมูลเพิ่มเติม"><span>${escapeHtml(additionalInfo).replace(/\r?\n/g,'<br>')}</span></button>`
    :'-';
  return `<section class="representative-profile-panel">
    ${field('ชื่อผู้แทน',`<strong>${escapeHtml(representative.name||'-')}</strong>`,'representative-profile-name')}
    ${field('',`<button type="button" class="representative-profile-products-trigger" data-manage-representative-products="${representative.id}">คลิกเพื่อดูสินค้าที่ผู้แทนดูแล</button>`,'representative-profile-products-field')}
    ${field('เบอร์โทร',escapeHtml(representative.phone||'-'),'representative-profile-contact')}
    ${field('ไลน์',escapeHtml(representative.line||'-'),'representative-profile-contact')}
    ${field('บริษัท',escapeHtml(representative.company||'-'),'representative-profile-contact')}
    ${field('ข้อมูลเพิ่มเติม',additionalInfoHtml,'representative-profile-info')}
  </section>`;
}
function representativeNoteWorkspaceHtml(group,canCreate){
  const notes=group.notes;
  const noteTotal=representativeNoteTotal(group.representative.id,notes.length);
  const isNew=representativeActivityDraft?.id==='new';
  let selected=isNew?null:notes.find(note=>String(note.id)===String(selectedRepresentativeNoteId));
  if(!isNew&&!selected&&notes.length){ selected=notes[0]; selectedRepresentativeNoteId=selected.id; }
  if(!notes.length&&!isNew){ selectedRepresentativeNoteId=null; representativeActivityDraft=null; representativeActivityDraftDirty=false; }
  const selectedIndex=selected?notes.findIndex(note=>String(note.id)===String(selected.id)):-1;
  const selectedChanged=selected&&(String(representativeActivityDraft?.id)!==String(selected.id)||(!representativeActivityDraftDirty&&String(representativeActivityDraft?.updatedAt||'')!==String(selected.updatedAt||'')));
  if(selectedChanged){
    representativeActivityDraft=representativeNoteDraftFromRow(selected);
    representativeActivityDraftDirty=false;
  }
  const list=notes.map((note,index)=>{
    const noteId=String(note.id);
    const canDelete=canDeleteNote(note);
    const checked=selectedRepresentativeNoteIdsToDelete.has(noteId);
    return `<div class="representative-note-list-row ${canDelete?'deletable':''} ${String(note.id)===String(selected?.id)?'active':''}"><button type="button" class="representative-note-list-item" data-select-representative-note="${escapeHtml(note.id)}"><span class="representative-note-list-line"><strong>NOTE ${representativeNoteNumber(note,Math.max(1,noteTotal-index))} : ${escapeHtml(note.title||'-')}</strong><small>${escapeHtml(representativeNoteDateLabel(note.eventDate))}</small></span></button>${canDelete?`<label class="representative-note-delete-choice" title="เลือกโน้ตนี้เพื่อลบ"><input type="checkbox" data-representative-note-delete="${escapeHtml(note.id)}" aria-label="เลือก NOTE ${representativeNoteNumber(note,Math.max(1,noteTotal-index))} เพื่อลบ" ${checked?'checked':''}></label>`:''}</div>`;
  }).join('');
  const draft=representativeActivityDraft;
  const noteNumber=isNew?noteTotal+1:representativeNoteNumber(selected,Math.max(1,noteTotal-selectedIndex));
  const detail=draft?representativeNoteEditorPanelHtml({draft,selected,noteNumber,canCreate}):`<section class="representative-note-detail-panel representative-note-detail-empty"><div class="note-empty-icon">NOTE</div><h2>ยังไม่มี NOTE ของผู้แทนคนนี้</h2><p>เพิ่ม NOTE เพื่อเก็บข้อมูลที่ต้องการติดตาม</p></section>`;
  const addButton=canCreate?'<button class="btn primary" id="newRepresentativeActivityBtn" type="button">+ เพิ่มโน้ต</button>':'';
  const selectedDeleteCount=[...selectedRepresentativeNoteIdsToDelete].filter(id=>notes.some(note=>String(note.id)===id&&canDeleteNote(note))).length;
  const bulkDeleteButton=notes.some(canDeleteNote)?`<button class="btn danger" id="deleteSelectedRepresentativeNotesBtn" type="button" ${selectedDeleteCount?'':'disabled'}>ลบที่เลือก${selectedDeleteCount?` (${selectedDeleteCount})`:''}</button>`:'';
  return `<div class="representative-note-workspace"><aside class="representative-note-list-panel" aria-label="รายการ NOTE ของผู้แทน"><div class="representative-note-search"><input id="representativeHistoryNoteSearch" value="${escapeHtml(representativeHistoryFilter.noteSearch)}" placeholder="ค้นหา NOTE ของผู้แทน"><button class="btn ghost" id="searchRepresentativeHistoryBtn" type="button">ค้นหา</button>${addButton}${bulkDeleteButton}</div>${list||'<div class="representative-note-list-empty">ยังไม่มี NOTE</div>'}${representativeNotesHasMore?`<button class="btn ghost representative-history-load-more" id="loadMoreRepresentativeNotesBtn" type="button" ${representativeActivityLoading?'disabled':''}>${representativeActivityLoading?'กำลังโหลด…':'โหลด NOTE เพิ่มเติม'}</button>`:''}</aside>${detail}</div>`;
}
function renderRepresentativeHistory(){
  const context=representativeHistoryContext||{};
  const representative=representativeForActivityId(context.representativeId);
  const product=productForActivityId(context.productId);
  const central=context.central===true;
  if(!central&&!representative&&!product) return '<div class="empty">ไม่พบผู้แทนหรือสินค้า</div>';
  if(!representativeActivityLoading&&representativeActivityLoadedKey!==representativeHistoryKey(context)&&!representativeActivityLoadError) setTimeout(()=>loadRepresentativeActivityHistory(),0);
  const groups=representativeHistoryGroups();
  const title=central?'ผู้แทน':representative?`ข้อมูลผู้แทน ${representative.name}`:`ผู้แทนที่ดูแล ${product.name}`;
  const canCreate=canPerformPageAction('create','notes');
  const canCreateRepresentative=canPerformPageAction('create','salesreps');
  const canDeleteRepresentative=central&&canPerformPageAction('delete','salesreps');
  const canEditRepresentative=representative&&canPerformPageAction('edit','salesreps');
  const historyFilters=`<div class="representative-history-filter representative-history-filter-minimal panel"><label><span>ชื่อผู้แทน</span><input id="representativeHistoryRepresentativeSearch" value="${escapeHtml(representativeHistoryFilter.representativeSearch)}" placeholder="ค้นหาชื่อผู้แทน"></label><label><span>ชื่อสินค้า</span><input id="representativeHistoryProductSearch" value="${escapeHtml(representativeHistoryFilter.productSearch)}" placeholder="ค้นหาตามชื่อสินค้า"></label><div class="representative-history-search"><span>ค้นหาจาก NOTE</span><div class="representative-history-search-row"><input id="representativeHistoryNoteSearch" value="${escapeHtml(representativeHistoryFilter.noteSearch)}" placeholder="หัวข้อหรือข้อมูลใน NOTE"><button class="btn primary" id="searchRepresentativeHistoryBtn" type="button">ค้นหา</button></div></div></div>`;
  const loading=representativeActivityLoading&&representativeActivityLoadedKey!==representativeHistoryKey(context);
  const representativeDetail=representative&&!product&&!central;
  const detailGroup=representativeDetail?groups.find(group=>Number(group.representative.id)===Number(representative.id)):null;
  const pageBody=representativeDetail&&detailGroup
    ?`${representativeProfileHtml(detailGroup)}${loading?'<div class="representative-history-empty">กำลังโหลดข้อมูล…</div>':representativeNoteWorkspaceHtml(detailGroup,canCreate)}`
    :`${historyFilters}<div class="representative-groups-grid">${loading?'<div class="representative-history-empty">กำลังโหลดข้อมูล…</div>':groups.map(group=>representativeHistoryGroupHtml(group,central)).join('')||'<div class="representative-history-empty">ยังไม่มีข้อมูลที่ตรงกับการค้นหา</div>'}</div>${representativeHistoryHasMore?`<button class="btn ghost representative-history-load-more" id="loadMoreRepresentativeHistoryBtn" type="button" ${representativeActivityLoading?'disabled':''}>${representativeActivityLoading?'กำลังโหลด…':'โหลดผู้แทนเพิ่มเติม'}</button>`:''}`;
  const selectedRepresentativeDeleteCount=[...selectedSalesRepresentativeIdsToDelete].filter(id=>groups.some(group=>Number(group.representative.id)===Number(id))).length;
  const deleteRepresentativesButton=canDeleteRepresentative?`<button class="btn danger" id="deleteSelectedSalesRepresentativesBtn" type="button" ${selectedRepresentativeDeleteCount?'':'disabled'}>ลบที่เลือก${selectedRepresentativeDeleteCount?` (${selectedRepresentativeDeleteCount})`:''}</button>`:'';
  const centralActions=`<button class="btn ghost" id="exportSalesRepsBtn" type="button">ส่งออก Excel</button><button class="btn ghost" id="importSalesRepsBtn" type="button">นำเข้า Excel</button><input id="salesRepImportFile" type="file" accept=".xlsx,.xls,.csv" hidden>${deleteRepresentativesButton}${canCreateRepresentative?'<button class="btn primary" id="newSalesRepBtn" type="button">+ เพิ่มผู้แทน</button>':''}`;
  const detailActions=`<button class="btn ghost" id="closeRepresentativeHistoryBtn" type="button">ย้อนกลับ</button>${canEditRepresentative?`<button class="btn primary" data-act="editsalesrep" data-id="${representative.id}" type="button">แก้ไขข้อมูลผู้แทน</button>`:''}`;
  const pageHead=representativeDetail
    ?`<div class="pagehead topbar-action-source representative-detail-pagehead"><div></div><div class="form-final-actions representative-topbar-actions">${detailActions}</div></div>`
    :`<div class="pagehead"><div>${central?'':`<div class="breadcrumb">ผู้แทน › ผู้แทนและสินค้าที่ดูแล</div>`}<h1>${escapeHtml(title)}</h1><p>${product?`รหัสสินค้า ${escapeHtml(product.sku||'-')}`:'ค้นหาผู้แทน สินค้าที่ดูแล และ NOTE ได้จากหน้าเดียว'}</p></div><div class="form-final-actions representative-topbar-actions">${central?centralActions:detailActions}</div></div>`;
  return `<div class="rpt representative-history-page">${pageHead}${representativeActivityLoadError?`<div class="notice danger">${escapeHtml(representativeActivityLoadError)}</div>`:''}${pageBody}</div>${representativeProductsEditorModalHtml()}${representativeEditorModalHtml()}`;
}
function syncRepresentativeActivityDraftFromForm(){
  if(!representativeActivityDraft) return;
  const value=id=>document.getElementById(id)?.value??'';
  Object.assign(representativeActivityDraft,{
    eventDate:dmyToISO(value('repActivityEventDate'))||'',title:value('repActivityTitle'),
    contentHtml:sanitizeNoteHtml(document.getElementById('repActivityContentEditor')?.innerHTML||'')
  });
}
async function saveRepresentativeActivity(event){
  event?.preventDefault();
  syncRepresentativeActivityDraftFromForm();
  const draft=representativeActivityDraft;
  if(draft?.id==='new'&&!canPerformPageAction('create','notes')){ showToast('บัญชีนี้ไม่มีสิทธิ์เพิ่มประวัติ','danger-top'); return; }
  if(!draft?.representativeId){ showToast('ไม่พบข้อมูลผู้แทน','danger-top'); return; }
  if(!draft.eventDate){ showToast('กรุณาเลือกวันที่','danger-top'); return; }
  if(!String(draft.title||'').trim()){ showToast('กรุณากรอกหัวข้อ NOTE','danger-top'); document.getElementById('repActivityTitle')?.focus(); return; }
  const title=String(draft.title||'').trim();
  const contentHtml=sanitizeNoteHtml(draft.contentHtml||'');
  const rpcPayload={
    p_note_id:draft.id==='new'?null:draft.id,p_expected_updated_at:draft.id==='new'?null:draft.updatedAt,p_title:title,
    p_content_html:notePlainText(contentHtml)?contentHtml:'',p_representative_id:Number(draft.representativeId),
    p_event_date:draft.eventDate,p_product_ids:[]
  };
  const button=document.getElementById('saveRepresentativeActivityBtn');
  if(button){ button.disabled=true; button.textContent='กำลังบันทึก…'; }
  try{
    const result=await sb.rpc('save_representative_note',rpcPayload);
    if(result.error) throw result.error;
    const savedId=String(result.data||'');
    if(!savedId) throw new Error('ฐานข้อมูลไม่ได้ส่งรหัสประวัติกลับมา');
    const savedResult=await sb.from('notes').select(NOTE_ROW_SELECT).eq('id',savedId).single();
    if(savedResult.error) throw savedResult.error;
    const saved=mapNoteRow(savedResult.data);
    const savedIndex=representativeActivityNotes.findIndex(note=>String(note.id)===savedId);
    if(savedIndex>=0) representativeActivityNotes[savedIndex]=saved; else representativeActivityNotes.push(saved);
    selectedRepresentativeNoteId=savedId;
    representativeActivityDraft=representativeNoteDraftFromRow(saved);
    representativeActivityDraftDirty=false;
    representativeActivityLoadedKey='';
    showToast('บันทึก NOTE แล้ว');
    await loadRepresentativeActivityHistory({force:true});
  }catch(error){
    showToast(error?.message||'บันทึกประวัติไม่สำเร็จ','danger-top');
    if(button){ button.disabled=false; button.textContent='บันทึก NOTE'; }
  }
}
async function deleteRepresentativeActivity(id){
  const note=representativeActivityNotes.find(item=>item.id===id);
  if(!note) return;
  const warning=representativeActivityDraftDirty
    ?`ลบโน้ต “${note.title}” หรือไม่? การแก้ไขที่ยังไม่ได้บันทึกจะถูกลบด้วย`
    :`ลบโน้ต “${note.title}” หรือไม่?`;
  if(!confirm(warning)) return;
  const button=document.getElementById('deleteRepresentativeNoteBtn');
  if(button){ button.disabled=true; button.textContent='กำลังลบ…'; }
  try{
    const {data,error}=await sb.from('notes').delete().eq('id',note.id).eq('updated_at',note.updatedAt).select('id').maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('รายการนี้ถูกแก้ไขหรือลบจากอีกเครื่องแล้ว');
    representativeActivityNotes=representativeActivityNotes.filter(item=>item.id!==note.id);
    if(String(selectedRepresentativeNoteId)===String(note.id)) selectedRepresentativeNoteId=null;
    representativeActivityDraft=null;
    representativeActivityDraftDirty=false;
    showToast('ลบประวัติแล้ว');
    representativeActivityLoadedKey='';
    await loadRepresentativeActivityHistory({force:true});
  }catch(error){
    showToast(error?.message||'ลบประวัติไม่สำเร็จ','danger-top');
    if(button){ button.disabled=false; button.textContent='ลบโน้ต'; }
  }
}
async function deleteSelectedRepresentativeNotes(){
  const selectedIds=new Set([...selectedRepresentativeNoteIdsToDelete].map(String));
  const notes=representativeActivityNotes.filter(note=>selectedIds.has(String(note.id))&&canDeleteNote(note));
  if(!notes.length){ showToast('กรุณาติ๊กเลือกโน้ตที่ต้องการลบ','danger-top'); return; }
  const deletingCurrent=notes.some(note=>String(note.id)===String(selectedRepresentativeNoteId));
  const warning=deletingCurrent&&representativeActivityDraftDirty
    ?`ยืนยันลบโน้ตที่เลือก ${notes.length} รายการหรือไม่? การแก้ไขที่ยังไม่ได้บันทึกจะถูกลบด้วย`
    :`ยืนยันลบโน้ตที่เลือก ${notes.length} รายการหรือไม่?`;
  if(!confirm(warning)) return;
  const button=document.getElementById('deleteSelectedRepresentativeNotesBtn');
  if(button){ button.disabled=true; button.textContent='กำลังลบ…'; }
  const deletedIds=[];
  const failed=[];
  for(const note of notes){
    try{
      const {data,error}=await sb.from('notes').delete().eq('id',note.id).eq('updated_at',note.updatedAt).select('id').maybeSingle();
      if(error) throw error;
      if(!data) throw new Error('โน้ตถูกแก้ไขหรือลบจากอีกเครื่องแล้ว');
      deletedIds.push(String(note.id));
    }catch(error){ failed.push({note,error}); }
  }
  if(deletedIds.length){
    const deletedSet=new Set(deletedIds);
    representativeActivityNotes=representativeActivityNotes.filter(note=>!deletedSet.has(String(note.id)));
    deletedIds.forEach(id=>selectedRepresentativeNoteIdsToDelete.delete(id));
    if(deletedSet.has(String(selectedRepresentativeNoteId))){
      selectedRepresentativeNoteId=null;
      representativeActivityDraft=null;
      representativeActivityDraftDirty=false;
    }
    representativeActivityLoadedKey='';
    showToast(`ลบ NOTE แล้ว ${deletedIds.length} รายการ`);
  }
  if(failed.length) showToast(`ลบไม่สำเร็จ ${failed.length} รายการ กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่`,'danger-top');
  if(deletedIds.length||failed.length) await loadRepresentativeActivityHistory({force:true});
  else if(button){ button.disabled=false; button.textContent=`ลบที่เลือก (${notes.length})`; }
}
async function deleteSelectedSalesRepresentatives(){
  if(!canPerformPageAction('delete','salesreps')){ showToast('บัญชีนี้ไม่มีสิทธิ์ลบผู้แทน','danger-top'); return; }
  const selectedIds=new Set([...selectedSalesRepresentativeIdsToDelete].map(Number).filter(Boolean));
  const representatives=salesRepresentatives.filter(representative=>selectedIds.has(Number(representative.id)));
  if(!representatives.length){ showToast('กรุณาติ๊กเลือกผู้แทนที่ต้องการลบ','danger-top'); return; }
  if(!confirm(`ยืนยันลบผู้แทนที่เลือก ${representatives.length} คนหรือไม่?\nสินค้าที่ดูแลจะถูกนำออก แต่ NOTE และเอกสารเดิมจะยังคงอยู่เป็นประวัติ`)) return;
  const button=document.getElementById('deleteSelectedSalesRepresentativesBtn');
  if(button){ button.disabled=true; button.textContent='กำลังลบ…'; }
  try{
    const ids=representatives.map(representative=>Number(representative.id));
    const {data,error}=await sb.from('sales_representatives').delete().in('id',ids).select('id');
    if(error) throw error;
    const deletedIds=new Set((data||[]).map(row=>Number(row.id)));
    if(deletedIds.size!==ids.length) throw new Error('ผู้แทนบางรายการถูกแก้ไขหรือลบจากอีกเครื่องแล้ว กรุณาโหลดข้อมูลล่าสุด');
    salesRepresentatives=salesRepresentatives.filter(representative=>!deletedIds.has(Number(representative.id)));
    representativeProductAssignments=representativeProductAssignments.filter(row=>!deletedIds.has(Number(row.representativeId)));
    removeRepresentativesFromManagedProductIndex([...deletedIds]);
    representativeActivityNotes=representativeActivityNotes.map(note=>deletedIds.has(Number(note.representativeId))?{...note,representativeId:null}:note);
    deletedIds.forEach(id=>selectedSalesRepresentativeIdsToDelete.delete(id));
    seedTableSnapshot('sales_representatives',salesRepresentatives,salesRepToRow);
    representativeActivityLoadedKey='';
    persistWorkspaceData();
    showToast(`ลบผู้แทนแล้ว ${deletedIds.size} คน`);
    await loadRepresentativeActivityHistory({force:true});
  }catch(error){
    showToast(error?.message||'ลบผู้แทนไม่สำเร็จ','danger-top');
    if(button){ button.disabled=false; button.textContent=`ลบที่เลือก (${representatives.length})`; }
  }
}
function drawRepresentativeProductsEditor(){
  const editor=representativeProductsEditor;
  if(!editor) return;
  const dropdown=document.getElementById('representativeProductsDropdown');
  const search=document.getElementById('representativeProductsSearch');
  const selected=document.getElementById('representativeProductsSelectedList');
  const count=document.getElementById('representativeProductsSelectedCount');
  const hasSearch=Boolean(normalizedActivityName(editor.search));
  if(dropdown){ dropdown.innerHTML=representativeProductsSearchResultsHtml(); dropdown.hidden=!hasSearch; }
  if(search) search.setAttribute('aria-expanded',hasSearch?'true':'false');
  if(selected) selected.innerHTML=representativeProductsSelectedHtml();
  if(count) count.textContent=editor.productIds.size;
  document.querySelectorAll('[data-add-representative-product]').forEach(button=>button.addEventListener('click',()=>{
    editor.productIds.add(Number(button.dataset.addRepresentativeProduct));
    editor.search='';
    if(search) search.value='';
    drawRepresentativeProductsEditor();
    search?.focus();
  }));
  document.querySelectorAll('[data-remove-representative-product]').forEach(button=>button.addEventListener('click',()=>{
    editor.productIds.delete(Number(button.dataset.removeRepresentativeProduct));
    drawRepresentativeProductsEditor();
  }));
}
async function saveRepresentativeManagedProducts(){
  const editor=representativeProductsEditor;
  if(!editor||!canPerformPageAction('edit','salesreps')) return;
  const button=document.getElementById('saveRepresentativeProductsBtn');
  if(button){ button.disabled=true; button.textContent='กำลังบันทึก…'; }
  try{
    const productIds=[...editor.productIds].map(Number).filter(Boolean);
    const {error}=await sb.rpc('save_representative_products',{p_representative_id:Number(editor.representativeId),p_product_ids:productIds});
    if(error) throw error;
    representativeProductAssignments=[
      ...representativeProductAssignments.filter(row=>Number(row.representativeId)!==Number(editor.representativeId)),
      ...productIds.map(productId=>({representativeId:Number(editor.representativeId),productId,createdAt:'',updatedAt:''}))
    ];
    updateRepresentativeManagedProductIndex(editor.representativeId,productIds);
    representativeProductsEditor=null;
    representativeActivityLoadedKey='';
    showToast('บันทึกสินค้าที่ดูแลแล้ว');
    await loadRepresentativeActivityHistory({force:true});
  }catch(error){
    showToast(error?.message||'บันทึกสินค้าที่ดูแลไม่สำเร็จ','danger-top');
    if(button){ button.disabled=false; button.textContent='บันทึกสินค้าที่ดูแล'; }
  }
}
function attachRepresentativeHistoryEvents(){
  if(!representativeHistoryContext) return;
  document.getElementById('closeRepresentativeHistoryBtn')?.addEventListener('click',closeRepresentativeHistory);
  const openNewNote=()=>{
    if(representativeActivityDraftDirty&&!confirm('มี NOTE ที่ยังไม่ได้บันทึก ต้องการสร้างโน้ตใหม่หรือไม่?')) return;
    representativeActivityDraft=newRepresentativeNoteDraft();
    representativeActivityDraftDirty=false;
    selectedRepresentativeNoteId=null;
    if(representativeActivityDraft){ render(); setTimeout(()=>document.getElementById('repActivityTitle')?.focus(),0); }
  };
  document.getElementById('newRepresentativeActivityBtn')?.addEventListener('click',openNewNote);
  document.getElementById('emptyAddRepresentativeNoteBtn')?.addEventListener('click',openNewNote);
  document.getElementById('representativeNoteEditorForm')?.addEventListener('submit',saveRepresentativeActivity);
  document.getElementById('deleteRepresentativeNoteBtn')?.addEventListener('click',()=>deleteRepresentativeActivity(representativeActivityDraft?.id));
  const updateRepresentativeBulkDeleteButton=()=>{
    const button=document.getElementById('deleteSelectedRepresentativeNotesBtn');
    if(!button) return;
    const count=[...selectedRepresentativeNoteIdsToDelete].filter(id=>representativeActivityNotes.some(note=>String(note.id)===String(id)&&canDeleteNote(note))).length;
    button.disabled=count===0;
    button.textContent=count?`ลบที่เลือก (${count})`:'ลบที่เลือก';
  };
  document.querySelectorAll('[data-representative-note-delete]').forEach(checkbox=>checkbox.addEventListener('change',()=>{
    const noteId=String(checkbox.dataset.representativeNoteDelete);
    if(checkbox.checked) selectedRepresentativeNoteIdsToDelete.add(noteId); else selectedRepresentativeNoteIdsToDelete.delete(noteId);
    updateRepresentativeBulkDeleteButton();
  }));
  document.getElementById('deleteSelectedRepresentativeNotesBtn')?.addEventListener('click',deleteSelectedRepresentativeNotes);
  const updateRepresentativeDeleteButton=()=>{
    const button=document.getElementById('deleteSelectedSalesRepresentativesBtn');
    if(!button) return;
    const count=[...selectedSalesRepresentativeIdsToDelete].filter(id=>salesRepresentatives.some(representative=>Number(representative.id)===Number(id))).length;
    button.disabled=count===0;
    button.textContent=count?`ลบที่เลือก (${count})`:'ลบที่เลือก';
  };
  document.querySelectorAll('[data-sales-representative-delete]').forEach(checkbox=>checkbox.addEventListener('change',()=>{
    const representativeId=Number(checkbox.dataset.salesRepresentativeDelete);
    if(checkbox.checked) selectedSalesRepresentativeIdsToDelete.add(representativeId); else selectedSalesRepresentativeIdsToDelete.delete(representativeId);
    updateRepresentativeDeleteButton();
  }));
  document.getElementById('deleteSelectedSalesRepresentativesBtn')?.addEventListener('click',deleteSelectedSalesRepresentatives);
  const updateRepresentativeNoteDraft=()=>{
    syncRepresentativeActivityDraftFromForm();
    representativeActivityDraftDirty=true;
  };
  document.getElementById('repActivityTitle')?.addEventListener('input',updateRepresentativeNoteDraft);
  document.getElementById('repActivityEventDate')?.addEventListener('input',()=>setTimeout(updateRepresentativeNoteDraft,0));
  document.getElementById('repActivityEventDate')?.addEventListener('change',updateRepresentativeNoteDraft);
  const representativeNoteEditor=document.getElementById('repActivityContentEditor');
  representativeNoteEditor?.addEventListener('input',updateRepresentativeNoteDraft);
  representativeNoteEditor?.addEventListener('paste',event=>{
    event.preventDefault();
    const html=event.clipboardData?.getData('text/html');
    const plain=event.clipboardData?.getData('text/plain')||'';
    document.execCommand('insertHTML',false,html?sanitizeNoteHtml(html):escapeHtml(plain).replace(/\r?\n/g,'<br>'));
    updateRepresentativeNoteDraft();
  });
  document.querySelectorAll('[data-representative-note-command]').forEach(button=>{
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>{ if(button.disabled||!representativeNoteEditor) return; document.execCommand(button.dataset.representativeNoteCommand,false,null); representativeNoteEditor.focus(); updateRepresentativeNoteDraft(); });
  });
  document.querySelectorAll('[data-representative-note-color]').forEach(button=>{
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>{ if(button.disabled||!representativeNoteEditor) return; document.execCommand('foreColor',false,button.dataset.representativeNoteColor); representativeNoteEditor.focus(); updateRepresentativeNoteDraft(); });
  });
  const representativeSearch=document.getElementById('representativeHistoryRepresentativeSearch');
  const productSearchFilter=document.getElementById('representativeHistoryProductSearch');
  const noteSearch=document.getElementById('representativeHistoryNoteSearch');
  const searchHistory=()=>{
    if(representativeActivityDraftDirty&&!confirm('มี NOTE ที่ยังไม่ได้บันทึก ต้องการค้นหาและละทิ้งการแก้ไขหรือไม่?')) return;
    representativeHistoryFilter.representativeSearch=representativeSearch?.value||'';
    representativeHistoryFilter.productSearch=productSearchFilter?.value||'';
    representativeHistoryFilter.noteSearch=noteSearch?.value||'';
    representativeActivityDraft=null;
    representativeActivityDraftDirty=false;
    selectedRepresentativeNoteId=null;
    selectedRepresentativeNoteIdsToDelete.clear();
    loadRepresentativeActivityHistory({force:true});
  };
  document.getElementById('searchRepresentativeHistoryBtn')?.addEventListener('click',searchHistory);
  [representativeSearch,productSearchFilter,noteSearch].forEach(input=>input?.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); searchHistory(); } }));
  document.getElementById('loadMoreRepresentativeHistoryBtn')?.addEventListener('click',()=>loadRepresentativeActivityHistory({append:true}));
  document.getElementById('loadMoreRepresentativeNotesBtn')?.addEventListener('click',()=>loadRepresentativeActivityHistory({append:true}));
  document.querySelectorAll('[data-select-representative-note]').forEach(button=>button.addEventListener('click',()=>{
    if(representativeActivityDraftDirty&&!confirm('มี NOTE ที่ยังไม่ได้บันทึก ต้องการเปิดโน้ตอื่นหรือไม่?')) return;
    const note=representativeActivityNotes.find(item=>String(item.id)===String(button.dataset.selectRepresentativeNote));
    if(!note) return;
    selectedRepresentativeNoteId=note.id;
    representativeActivityDraft=representativeNoteDraftFromRow(note);
    representativeActivityDraftDirty=false;
    render();
  }));
  const historyOrigin=representativeHistoryContext.central?'representativehistory':representativeHistoryContext.originTab;
  document.querySelectorAll('[data-open-representative-history]').forEach(button=>button.addEventListener('click',()=>openRepresentativeHistory({representativeId:Number(button.dataset.openRepresentativeHistory),originTab:historyOrigin})));
  document.querySelectorAll('[data-representative-card-open]').forEach(card=>{
    const open=()=>openRepresentativeHistory({representativeId:Number(card.dataset.representativeCardOpen),originTab:historyOrigin});
    card.addEventListener('click',event=>{ if(event.target.closest('button,a,input,label,select,textarea')) return; open(); });
    card.addEventListener('keydown',event=>{ if((event.key==='Enter'||event.key===' ')&&!event.target.closest('button,a,input,label,select,textarea')){ event.preventDefault(); open(); } });
  });
  document.querySelectorAll('[data-open-product-history]').forEach(button=>button.addEventListener('click',()=>openRepresentativeHistory({productId:Number(button.dataset.openProductHistory),originTab:historyOrigin})));
  document.querySelectorAll('[data-manage-representative-products]').forEach(button=>button.addEventListener('click',()=>openRepresentativeProductsEditor(Number(button.dataset.manageRepresentativeProducts))));
  document.querySelectorAll('[data-view-representative-info]').forEach(button=>button.addEventListener('click',()=>openRepresentativeAdditionalInfo(Number(button.dataset.viewRepresentativeInfo))));
  const closeProductsEditor=()=>{ representativeProductsEditor=null; render(); };
  document.getElementById('closeRepresentativeProductsEditorBtn')?.addEventListener('click',closeProductsEditor);
  document.getElementById('cancelRepresentativeProductsEditorBtn')?.addEventListener('click',closeProductsEditor);
  document.getElementById('saveRepresentativeProductsBtn')?.addEventListener('click',saveRepresentativeManagedProducts);
  document.getElementById('representativeProductsSearch')?.addEventListener('input',event=>{
    if(!representativeProductsEditor) return;
    representativeProductsEditor.search=event.target.value;
    drawRepresentativeProductsEditor();
  });
  document.getElementById('representativeProductsSearch')?.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!representativeProductsEditor?.search) return;
    event.preventDefault();
    representativeProductsEditor.search='';
    event.currentTarget.value='';
    drawRepresentativeProductsEditor();
  });
  drawRepresentativeProductsEditor();
  document.getElementById('cancelSalesRepBottomBtn')?.addEventListener('click',()=>{ editingSalesRepresentativeId=null; render(); });
}
