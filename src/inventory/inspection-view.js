// ---------- รายการตรวจสินค้า ----------
function inspectionListUnitOptions(product){
  if(!product) return [];
  return productUnitOptions(product).map(option=>{
    const sub=option.name===product.unit?null:(product.units||[]).find(unit=>unit.sub===option.name);
    return {...option,barcode:option.name===product.unit?(product.barcode||''):(sub?.barcode||'')};
  });
}
function inspectionListSelectedOption(item,product){
  const options=inspectionListUnitOptions(product);
  return options.find(option=>option.name===item?.unit)||options[0]||{name:'-',price:0,cost:0,factor:1,barcode:''};
}
function inspectionListAmount(value){
  const number=Number(value)||0;
  return number.toLocaleString('th-TH',{minimumFractionDigits:Number.isInteger(number)?0:0,maximumFractionDigits:2});
}
function inspectionListSortValue(item,key){
  const product=products.find(entry=>entry.id===Number(item?.pid));
  if(!product) return null;
  const selected=inspectionListSelectedOption(item,product);
  if(key==='barcode') return selected.barcode||'';
  if(key==='name') return product.name||'';
  if(key==='stock') return stockUnitAmountFromBase(warehouseStock(product.id,inspectionListDraft?.warehouseId||inspectionListCatFilter?.wh||activeWarehouseId),selected.factor);
  return product.sku||'';
}
function inspectionListSortedEntries(itemList=inspectionListDraft?.items||[]){
  const key=['sku','barcode','name','stock'].includes(inspectionListSort?.key)?inspectionListSort.key:'sku';
  const dir=Number(inspectionListSort?.dir)===-1?-1:1;
  return itemList.map((item,index)=>({item,index})).sort((a,b)=>{
    const left=inspectionListSortValue(a.item,key);
    const right=inspectionListSortValue(b.item,key);
    if(left===null&&right===null) return a.index-b.index;
    if(left===null) return 1;
    if(right===null) return -1;
    const compared=key==='stock'
      ? (Number(left)-Number(right))
      : String(left).localeCompare(String(right),'th',{numeric:true,sensitivity:'base'});
    return compared===0?a.index-b.index:compared*dir;
  });
}
function inspectionListPagination(itemList=inspectionListDraft?.items||[],page=inspectionListPage,pageSize=INSPECTION_LIST_PAGE_SIZE){
  const sortedEntries=inspectionListSortedEntries(itemList);
  const totalPages=Math.max(1,Math.ceil(sortedEntries.length/pageSize));
  const currentPage=Math.min(totalPages,Math.max(1,Number(page)||1));
  const start=(currentPage-1)*pageSize;
  return {rows:sortedEntries.slice(start,start+pageSize),currentPage,totalPages};
}
function inspectionListSortHeader(key,label){
  const active=inspectionListSort?.key===key;
  const arrow=active?(Number(inspectionListSort.dir)===-1?'▼':'▲'):'↕';
  return `<button type="button" class="inspection-list-sort-btn ${active?'active':''}" data-inspection-sort="${key}" aria-label="เรียงตาม${label}">${label}<span class="sort-indicator" aria-hidden="true">${arrow}</span></button>`;
}
function inspectionListRowsHtml(entries){
  if(!entries.length){
    const message=inspectionListDraft?.items?.length?'ไม่พบสินค้าในคลังที่เลือก':'ยังไม่มีสินค้า — ค้นหา/สแกนบาร์โค้ด หรือเลือกสินค้าจากหมวดด้านบน';
    return `<tr><td colspan="5" style="padding:30px;text-align:center;color:var(--text-muted);">${message}</td></tr>`;
  }
  return entries.map(({item,index})=>{
    const product=products.find(entry=>entry.id===Number(item.pid));
    const removeButton=`<button class="inspection-list-remove" data-inspection-remove="${index}" title="ลบออกจากรายการ" aria-label="ลบสินค้าออกจากรายการ"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`;
    if(!product) return `<tr><td class="mono" style="text-align:center;">-</td><td class="mono" style="text-align:center;">-</td><td>ไม่พบสินค้าในระบบ (รหัส ${escapeHtml(item.pid)})</td><td style="text-align:center;">-</td><td style="text-align:center;">${removeButton}</td></tr>`;
    const selected=inspectionListSelectedOption(item,product);
    const baseStock=warehouseStock(product.id,inspectionListDraft?.warehouseId||inspectionListCatFilter?.wh||activeWarehouseId);
    const selectedStock=stockUnitAmountFromBase(baseStock,selected.factor);
    return `<tr data-inspection-row="${index}">
      <td class="mono" style="text-align:center;">${escapeHtml(product.sku||'-')}</td>
      <td class="mono" style="text-align:center;">${escapeHtml(selected.barcode||'-')}</td>
      <td>${escapeHtml(product.name)}</td>
      <td><span class="inspection-list-stock ${Number(baseStock)<0?'stock-negative':''}">${inspectionListAmount(selectedStock)} ${escapeHtml(selected.name)}</span></td>
      <td style="text-align:center;">${removeButton}</td>
    </tr>`;
  }).join('');
}
function inspectionListDisplayItems(list){
  return (list?.items||[]).map(item=>{
    const product=products.find(entry=>entry.id===Number(item.pid));
    return {name:product?.name||`ไม่พบสินค้า (${item.pid})`,unit:item.unit||product?.unit||'',kind:product?.sku?`รหัส ${product.sku}`:''};
  });
}
function inspectionListPreviewHtml(list){ return expandableDocumentItemsPreview('inspection',list?.id,inspectionListDisplayItems(list)); }
function inspectionListDateTime(value){
  const date=new Date(value||'');
  if(Number.isNaN(date.getTime())) return '-';
  const day=String(date.getDate()).padStart(2,'0');
  const month=String(date.getMonth()+1).padStart(2,'0');
  const year=date.getFullYear();
  const hours=String(date.getHours()).padStart(2,'0');
  const minutes=String(date.getMinutes()).padStart(2,'0');
  return `${day}-${month}-${year} / ${hours}:${minutes}`;
}
function inspectionListOverviewSortValue(list,key){
  if(key==='status') return String(list?.stockAdjustedAt||'').trim()?1:0;
  const timestamp=new Date(list?.[key]||'').getTime();
  return Number.isFinite(timestamp)?timestamp:0;
}
function inspectionListOverviewSortedLists(){
  const key=['createdAt','updatedAt','status'].includes(inspectionListOverviewSort?.key)?inspectionListOverviewSort.key:'updatedAt';
  const dir=Number(inspectionListOverviewSort?.dir)===-1?-1:1;
  return [...inspectionLists].sort((a,b)=>{
    const compared=inspectionListOverviewSortValue(a,key)-inspectionListOverviewSortValue(b,key);
    if(compared!==0) return compared*dir;
    return String(b.id||'').localeCompare(String(a.id||''),'th',{numeric:true});
  });
}
function inspectionListOverviewSortHeader(key,label){
  const active=inspectionListOverviewSort?.key===key;
  const arrow=active?(Number(inspectionListOverviewSort.dir)===-1?'▼':'▲'):'↕';
  return `<button type="button" class="inspection-list-sort-btn ${active?'active':''}" data-inspection-overview-sort="${key}" aria-label="เรียงตาม${label}">${label}<span class="sort-indicator" aria-hidden="true">${arrow}</span></button>`;
}
function renderInspectionListOverview(){
  const lists=inspectionListOverviewSortedLists();
  const selectedCount=lists.filter(list=>inspectionListOverviewSelectedIds.has(String(list.id))).length;
  const allSelected=lists.length>0&&lists.every(list=>inspectionListOverviewSelectedIds.has(String(list.id)));
  return `<div class="rpt inspection-list-page">
    <div class="inspection-list-overview-head-actions form-final-actions">${selectedCount?`<button type="button" class="icon-btn danger inspection-list-bulk-delete" id="deleteSelectedInspectionListsBtn" title="ลบรายการที่เลือก ${selectedCount} รายการ" aria-label="ลบรายการที่เลือก ${selectedCount} รายการ"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`:''}<button class="btn primary" id="newInspectionListBtn">+ สร้างรายการ</button></div>
    <div class="inspection-list-overview-wrap seamless-table-wrap"><table class="grid-table doc-head-blue inspection-list-overview-table"><colgroup><col class="inspection-overview-check-col"><col class="inspection-overview-date-col"><col class="inspection-overview-date-col"><col class="inspection-overview-name-col"><col class="inspection-overview-products-col"><col class="inspection-overview-status-col"><col class="inspection-overview-action-col"></colgroup><thead><tr><th class="inspection-overview-check-col"><input type="checkbox" class="inspection-list-overview-check" id="inspectionListSelectAll" aria-label="เลือกทุกรายการ" ${allSelected?'checked':''}></th><th>${inspectionListOverviewSortHeader('createdAt','วันที่สร้าง')}</th><th>${inspectionListOverviewSortHeader('updatedAt','แก้ไขล่าสุด')}</th><th>ชื่อรายการ</th><th>สินค้า</th><th>${inspectionListOverviewSortHeader('status','สถานะ')}</th><th>จัดการ</th></tr></thead><tbody>${lists.length?lists.map(list=>`<tr><td class="inspection-overview-check-col"><input type="checkbox" class="inspection-list-overview-check" data-inspection-list-select="${escapeHtml(list.id)}" aria-label="เลือก ${escapeHtml(list.name)}" ${inspectionListOverviewSelectedIds.has(String(list.id))?'checked':''}></td><td style="text-align:center;">${escapeHtml(inspectionListDateTime(list.createdAt))}</td><td style="text-align:center;">${escapeHtml(inspectionListDateTime(list.updatedAt))}</td><td class="inspection-list-overview-name">${escapeHtml(list.name)}</td><td><div class="inspection-list-overview-products">${inspectionListPreviewHtml(list)}</div></td><td class="inspection-list-overview-status">${list.stockAdjustedAt?'<span class="inspection-list-status">บันทึกผลแล้ว</span>':'<span class="inspection-list-status pending">รอยืนยันปรับสต๊อก</span>'}</td><td class="inspection-list-overview-action"><div class="inspection-list-overview-actions">${list.stockAdjustedAt?'':`<button class="icon-btn" type="button" data-stock-control-import-list="${escapeHtml(list.id)}" title="นำไปยืนยันปรับสต๊อก" aria-label="นำ ${escapeHtml(list.name)} ไปยืนยันปรับสต๊อก"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`}<button class="icon-btn" type="button" data-open-inspection-list="${escapeHtml(list.id)}" title="แก้ไขรายการ" aria-label="แก้ไข ${escapeHtml(list.name)}"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button><button class="icon-btn danger" type="button" data-delete-inspection-list="${escapeHtml(list.id)}" title="ลบรายการ" aria-label="ลบ ${escapeHtml(list.name)}"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div></td></tr>${expandableDocumentItemsDetailRow('inspection',list.id,inspectionListDisplayItems(list),7)}`).join(''):'<tr><td colspan="7" style="padding:38px;text-align:center;color:var(--text-muted);">ยังไม่มีรายการตรวจสินค้า — กด “สร้างรายการ” เพื่อเริ่มเพิ่มสินค้า</td></tr>'}</tbody></table></div>
  </div>`;
}
function renderInspectionListEditor(){
  if(!inspectionListDraft) openInspectionListEditor(editingInspectionListId||'new',false);
  if(!inspectionListDraft) return renderInspectionListOverview();
  const draft=inspectionListDraft;
  const filter=inspectionListCatFilter;
  const inWarehouse=()=>true;
  const brandOptions=filter.category?brands.filter(brand=>products.some(product=>inWarehouse(product)&&product.category===filter.category&&product.brand===brand)):brands.filter(brand=>products.some(product=>inWarehouse(product)&&product.brand===brand));
  const matchCount=products.filter(product=>inWarehouse(product)&&(!filter.category||product.category===filter.category)&&(!filter.brand||product.brand===filter.brand)&&(filter.wh||filter.category||filter.brand)).length;
  const pagination=inspectionListPagination();
  inspectionListPage=pagination.currentPage;
  return `<div class="rpt inspection-list-page">
    <div class="pagehead"><div>${editingInspectionListId==='new'?'':'<h1>แก้ไขรายการตรวจสินค้า</h1>'}</div><div class="inspection-list-actions form-final-actions"><button class="btn ghost" id="cancelInspectionListBtn">ยกเลิก</button><button class="btn primary" id="saveInspectionListBtn">บันทึกรายการ</button></div></div>
    <div class="inspection-list-editor-section">
      <div class="inspection-list-editor-toolbar">
        <div class="inspection-list-name-field"><label for="inspectionListName">ชื่อรายการ *</label><input id="inspectionListName" class="inspection-list-name-input" value="${escapeHtml(draft.name||'')}" placeholder="เช่น รายการตรวจสินค้าหน้าร้าน"></div>
        <div class="rpt-filters inspection-list-editor-filters">
          <div class="rpf-item"><select id="inspectionListWarehouse" class="rpt-select" aria-label="คลังสินค้า">${accessibleWarehouses().map(warehouse=>`<option value="${warehouse.id}" ${String(draft.warehouseId||filter.wh||activeWarehouseId)===String(warehouse.id)?'selected':''}>${escapeHtml(warehouse.name)}</option>`).join('')}</select></div>
          <div class="rpf-item"><select id="inspectionListCategory" class="rpt-select"><option value="">หมวดสินค้าหลัก: ทั้งหมด</option>${categories.map(category=>`<option value="${escapeHtml(category)}" ${filter.category===category?'selected':''}>${escapeHtml(category)}</option>`).join('')}</select></div>
          <div class="rpf-item"><select id="inspectionListBrand" class="rpt-select"><option value="">หมวดสินค้าย่อย: ทั้งหมด</option>${brandOptions.map(brand=>`<option value="${escapeHtml(brand)}" ${filter.brand===brand?'selected':''}>${escapeHtml(brand)}</option>`).join('')}</select></div>
          <button class="btn ghost" id="inspectionListAddCategoryBtn" ${(filter.category||filter.brand)?'':'disabled'}>เลือกสินค้าในหมวดนี้${(filter.category||filter.brand)?` (${matchCount})`:''}</button>
        </div>
      </div>
      <div class="inspection-list-search-wrap"><input id="inspectionListSearch" class="inspection-list-search" value="${escapeHtml(inspectionListSearchQuery)}" placeholder="ค้นหาหรือสแกนบาร์โค้ด..." autocomplete="off"><div id="inspectionListResults" class="fav-add-results" hidden style="left:0;right:0;top:calc(100% - 6px);"></div></div>
      <div class="inspection-list-table-wrap seamless-table-wrap"><table class="grid-table doc-head-blue inspection-list-table"><colgroup><col class="inspection-col-sku"><col class="inspection-col-barcode"><col class="inspection-col-name"><col class="inspection-col-stock"><col class="inspection-col-action"></colgroup><thead><tr><th>${inspectionListSortHeader('sku','รหัสสินค้า')}</th><th>${inspectionListSortHeader('barcode','บาร์โค้ด')}</th><th>${inspectionListSortHeader('name','สินค้า')}</th><th>${inspectionListSortHeader('stock','คงเหลือ')}</th><th aria-label="จัดการ"></th></tr></thead><tbody>${inspectionListRowsHtml(pagination.rows)}</tbody></table></div>
      ${pagerHtml(inspectionListPage,pagination.totalPages,'inspection-list-page')}
    </div>
  </div>`;
}
function renderInspectionLists(){ return editingInspectionListId===null?renderInspectionListOverview():renderInspectionListEditor(); }
