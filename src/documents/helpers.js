function whName(id){ return warehouses.find(w=>w.id===id)?.name || '-'; }
function addDaysToDate(dateStr, days){
  if(!dateStr) return '';
  const [y,m,d]=dateStr.split('-').map(Number);
  const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+(parseInt(days)||0));
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function documentDueDate(doc){ return doc.dueDate || addDaysToDate(doc.date, doc.credit||0); }
// ---------- ตัวช่วยสร้างแถบเปลี่ยนหน้า (pagination) แบบมีปุ่มเลขหน้า ----------
function pagerHtml(current, total, attr){
  if(total<=1) return '';
  let startP=Math.max(1,current-2);
  let endP=Math.min(total,startP+4);
  startP=Math.max(1,endP-4);
  const pages=[]; for(let p=startP;p<=endP;p++) pages.push(p);
  const btn=(label,val,disabled,extraCls,title)=>`<button class="pagebtn ${extraCls||''}" data-${attr}="${val}" ${disabled?'disabled':''} ${title?`title="${title}"`:''}>${label}</button>`;
  return `<div class="pager">
    ${btn('«',1,current===1,'','หน้าแรก')}
    ${btn('‹','prev',current===1,'','ก่อนหน้า')}
    ${pages.map(p=>btn(p,p,false,p===current?'active':'')).join('')}
    ${btn('›','next',current===total,'','ถัดไป')}
    ${btn('»',total,current===total,'','หน้าสุดท้าย')}
  </div>`;
}
// ---------- ตัวช่วยจัดการเอกสารตามประเภท (po=สั่งซื้อสินค้า, gr=ใบรับสินค้า, ret=คืนสินค้า) ----------
function isSupplierStyleDoc(kind){ return kind==='gr'||kind==='ret'; }
function docList(kind){ return kind==='gr'?goodsReceipts:kind==='ret'?productReturns:purchaseOrders; }
function docEditingId(kind){ return kind==='gr'?editingGRId:kind==='ret'?editingReturnId:editingPOId; }
function setDocEditingId(kind,val){ if(kind==='gr') editingGRId=val; else if(kind==='ret') editingReturnId=val; else editingPOId=val; }
function docDraft(kind){ return kind==='gr'?grDraft:kind==='ret'?returnDraft:poDraft; }
function setDocDraft(kind,val){ if(kind==='gr') grDraft=val; else if(kind==='ret') returnDraft=val; else poDraft=val; }
function docPrefix(kind){ return kind==='gr'?documentPrefixes.goodsReceipt:kind==='ret'?documentPrefixes.productReturn:documentPrefixes.shortage; }
// ---------- ตัวช่วยออกเลขที่เอกสารแบบรีเซ็ตรายวัน/รายปี (ฝังวันที่ในเลขที่เอกสารเสมอ ปลอดภัยแม้รีเซ็ต) ----------
function docNumberParts(prefix,value){
  const re=new RegExp('^'+prefix+'(\\d{4})(\\d{2})(\\d{2})(\\d{4})$');
  const m=String(value||'').match(re);
  if(!m) return null;
  return {year:m[1],month:m[2],day:m[3],seq:parseInt(m[4],10)};
}
function nextDailySeq(prefix, values){
  const y=TODAY_STR.slice(0,4), mo=TODAY_STR.slice(5,7), d=TODAY_STR.slice(8,10);
  let max=0;
  (values||[]).forEach(v=>{ const p=docNumberParts(prefix,v); if(p&&p.year===y&&p.month===mo&&p.day===d&&p.seq>max) max=p.seq; });
  return max+1;
}
function nextYearlySeq(prefix, values){
  const y=TODAY_STR.slice(0,4);
  let max=0;
  (values||[]).forEach(v=>{ const p=docNumberParts(prefix,v); if(p&&p.year===y&&p.seq>max) max=p.seq; });
  return max+1;
}
function buildDocNumber(prefix, seq){ return `${prefix}${TODAY_STR.replace(/-/g,'')}${String(seq).padStart(4,'0')}`; }
function docCounter(kind){ const list=docList(kind); return nextDailySeq(docPrefix(kind), list.map(d=>d.id)); }
function bumpDocCounter(kind){ /* ไม่ต้องทำอะไร: เลขคำนวณสดจากรายการเอกสารเสมอ (รีเซ็ตรายวันอัตโนมัติ) */ }
function docLabelText(kind){ return kind==='gr'?'ใบรับสินค้า':kind==='ret'?'ใบคืนสินค้า':'สั่งซื้อสินค้า'; }
function docDefaultStatus(kind){ return kind==='gr'?'รอรับสินค้า':kind==='ret'?'รอรับคืน':'รอสั่งของ'; }
const GOODS_RECEIPT_STATUSES=['รอรับสินค้า','รับสินค้าแล้ว','ชำระเรียบร้อย'];
function goodsReceiptWarehouseId(doc,warehouseList,productList){
  const warehouseRows=Array.isArray(warehouseList)?warehouseList:(typeof warehouses!=='undefined'&&Array.isArray(warehouses)?warehouses:[]);
  const productRows=Array.isArray(productList)?productList:(typeof products!=='undefined'&&Array.isArray(products)?products:[]);
  const explicitId=Number(doc?.warehouseId)||0;
  if(explicitId&&warehouseRows.some(warehouse=>Number(warehouse.id)===explicitId)) return explicitId;
  for(const item of (doc?.items||[])){
    const itemWarehouseId=Number(item?.warehouseId)||0;
    if(itemWarehouseId&&warehouseRows.some(warehouse=>Number(warehouse.id)===itemWarehouseId)) return itemWarehouseId;
    const product=productRows.find(row=>Number(row.id)===Number(item?.productId))||productRows.find(row=>row.name===item?.name);
    const productWarehouseId=Number(product?.wh)||0;
    if(productWarehouseId&&warehouseRows.some(warehouse=>Number(warehouse.id)===productWarehouseId)) return productWarehouseId;
  }
  return Number(warehouseRows[0]?.id)||0;
}
function goodsReceiptWarehouseName(doc){
  const warehouseId=goodsReceiptWarehouseId(doc);
  return warehouses.find(warehouse=>Number(warehouse.id)===warehouseId)?.name||'-';
}
function goodsReceiptItemsMatchWarehouse(doc,warehouseList,productList){
  const productRows=Array.isArray(productList)?productList:(typeof products!=='undefined'&&Array.isArray(products)?products:[]);
  const warehouseId=goodsReceiptWarehouseId(doc,warehouseList,productRows);
  if(!warehouseId) return false;
  const items=doc?.items||[];
  return items.length>0&&items.every(item=>{
    const product=productRows.find(row=>Number(row.id)===Number(item?.productId))||productRows.find(row=>row.name===item?.name);
    return !!product;
  });
}
function normalizeGoodsReceiptDocument(doc){
  if(!doc||typeof doc!=='object') return doc;
  // ใบรับสินค้าเดิมถูกบวกสต๊อกตั้งแต่ตอนสร้างและไม่มี stockApplied=false
  // จึงถือว่าเคยนับสต๊อกแล้ว เพื่อไม่ให้ข้อมูลเก่าถูกบวกซ้ำหลังอัปเกรด
  const stockApplied=doc.stockApplied!==false;
  const status=stockApplied
    ? (doc.status==='ชำระเรียบร้อย'?'ชำระเรียบร้อย':'รับสินค้าแล้ว')
    : 'รอรับสินค้า';
  const warehouseId=goodsReceiptWarehouseId(doc);
  return {...doc,...(warehouseId?{warehouseId}:{}),status,stockApplied,stockAppliedAt:stockApplied?String(doc.stockAppliedAt||doc.date||''):''};
}
function normalizeGoodsReceiptDocuments(list){ return (Array.isArray(list)?list:[]).map(normalizeGoodsReceiptDocument); }
function canManageGoodsReceipt(doc,user=loggedInUser()){
  if(user?.owner===true) return true;
  const userId=String(user?.id||''),createdByUserId=String(doc?.createdByUserId||'');
  return !!userId&&!!createdByUserId&&userId===createdByUserId;
}
function goodsReceiptStatusChangePlan(doc,nextStatus){
  const status=GOODS_RECEIPT_STATUSES.includes(nextStatus)?nextStatus:'รอรับสินค้า';
  const alreadyApplied=doc?.stockApplied===true;
  if(status==='ชำระเรียบร้อย'&&!alreadyApplied){
    return {allowed:false,status:doc?.status||'รอรับสินค้า',stockDirection:0,stockApplied:false};
  }
  if(status==='รอรับสินค้า'&&alreadyApplied){
    return {allowed:false,status:doc?.status||'รับสินค้าแล้ว',stockDirection:0,stockApplied:true,locked:true};
  }
  const stockDirection=status==='รับสินค้าแล้ว'&&!alreadyApplied?1:0;
  return {allowed:true,status,stockDirection,stockApplied:status!=='รอรับสินค้า'};
}
// ---------- ตรรกะเอกสารเปลี่ยนสินค้า (แยกจากใบรับ/ใบคืนเพื่อกันลงสต๊อกซ้ำ) ----------
const PRODUCT_EXCHANGE_STATUSES=['ร่าง','ส่งไปเปลี่ยนแล้ว','รับสินค้ากลับแล้ว'];
function productExchangeItemBaseQty(item){
  const qty=Number(item?.qty)||0;
  const factor=Number(item?.factor)>0?Number(item.factor):1;
  return Math.round(qty*factor*1000000)/1000000;
}
function productExchangeTransitionPlan(doc,nextStatus){
  const status=PRODUCT_EXCHANGE_STATUSES.includes(nextStatus)?nextStatus:'ร่าง';
  const current=PRODUCT_EXCHANGE_STATUSES.includes(doc?.status)?doc.status:'ร่าง';
  const outgoingApplied=doc?.outgoingApplied===true;
  const incomingApplied=doc?.incomingApplied===true;
  const rank=value=>PRODUCT_EXCHANGE_STATUSES.indexOf(value);
  if(rank(status)<rank(current)||incomingApplied){
    return {allowed:false,status:current,applyOutgoing:false,applyIncoming:false};
  }
  if(status==='ร่าง') return {allowed:true,status,applyOutgoing:false,applyIncoming:false};
  if(status==='ส่งไปเปลี่ยนแล้ว') return {allowed:true,status,applyOutgoing:!outgoingApplied,applyIncoming:false};
  return {allowed:true,status,applyOutgoing:!outgoingApplied,applyIncoming:!incomingApplied};
}
function normalizeProductExchangeItem(item){
  const product=products.find(entry=>Number(entry.id)===Number(item?.pid));
  if(!product) return null;
  const options=productUnitOptions(product);
  const selected=options.find(option=>option.name===item?.unit)||options[0];
  const qty=Math.max(0,Number(item?.qty)||0);
  return {
    lineId:Number(item?.lineId)||Date.now()+Math.floor(Math.random()*10000),
    pid:Number(product.id),sku:String(product.sku||''),barcode:String(selected?.barcode||product.barcode||''),name:String(product.name||''),
    qty,unit:selected?.name||product.unit,factor:Number(selected?.factor)||1,
    baseQty:productExchangeItemBaseQty({qty,factor:selected?.factor||1}),
    lotNumber:String(item?.lotNumber||''),expiry:String(item?.expiry||'')
  };
}
function productExchangeItemsTotal(items){
  return Math.round((items||[]).reduce((total,item)=>total+productExchangeItemBaseQty(item),0)*1000000)/1000000;
}
function productExchangeReconciliation(doc){
  const incomingByProduct=new Map();
  (doc?.incomingItems||[]).forEach(item=>{
    const pid=Number(item?.pid),baseQty=productExchangeItemBaseQty(item);
    if(pid&&baseQty>0) incomingByProduct.set(pid,(incomingByProduct.get(pid)||0)+baseQty);
  });
  const outgoingProductIds=new Set((doc?.outgoingItems||[]).map(item=>Number(item?.pid)).filter(Boolean));
  const unreturnedItems=[];
  (doc?.outgoingItems||[]).forEach(item=>{
    const pid=Number(item?.pid),sent=productExchangeItemBaseQty(item),received=incomingByProduct.get(pid)||0;
    const matched=Math.min(sent,received),remaining=Math.round((sent-matched)*1000000)/1000000;
    incomingByProduct.set(pid,Math.max(0,received-matched));
    if(remaining<=0) return;
    const factor=Number(item?.factor)>0?Number(item.factor):1;
    unreturnedItems.push({...item,qty:Math.round((remaining/factor)*1000000)/1000000,baseQty:remaining});
  });
  const replacementItems=(doc?.incomingItems||[]).filter(item=>!outgoingProductIds.has(Number(item?.pid)));
  return {unreturnedItems,replacementItems,fullyReturned:unreturnedItems.length===0};
}
function earlierExpiry(currentExpiry,newExpiry){
  const current=String(currentExpiry||''), next=String(newExpiry||'');
  if(!next) return current;
  if(!current) return next;
  return next<current?next:current;
}
function applyProductExchangeLocally(doc,plan){
  if(plan?.applyOutgoing){
    (doc.outgoingItems||[]).forEach(item=>{
      const product=products.find(entry=>Number(entry.id)===Number(item.pid));
      if(product) product.stock=(Number(product.stock)||0)-productExchangeItemBaseQty(item);
    });
  }
  if(plan?.applyIncoming){
    (doc.incomingItems||[]).forEach(item=>{
      const product=products.find(entry=>Number(entry.id)===Number(item.pid));
      if(!product) return;
      const stockBefore=Number(product.stock)||0;
      product.stock=stockBefore+productExchangeItemBaseQty(item);
      if(item.expiry) product.expiry=stockBefore<=0?item.expiry:earlierExpiry(product.expiry,item.expiry);
    });
  }
}
function currentDocKind(){ if(currentTab==='goodsreceipt') return 'gr'; if(currentTab==='productreturn') return 'ret'; return 'po'; }
function daysFromToday(dateStr){
  const parse=s=>{ const [y,m,d]=String(s).slice(0,10).split('-').map(Number); return new Date(y,m-1,d); };
  return Math.ceil((parse(dateStr)-parse(TODAY_STR))/86400000);
}
function documentDueBadge(doc){
  const due=documentDueDate(doc), days=daysFromToday(due);
  const cls=days<=3?'red':days<=7?'orange':days<=14?'yellow':'normal';
  const note=days<0?`เลยกำหนด ${Math.abs(days)} วัน`:days===0?'ครบกำหนดวันนี้':`เหลือ ${days} วัน`;
  return `<span class="due-badge ${cls}" title="${escapeHtml(note)}">${escapeHtml(fmtDate(due))}</span>`;
}
function documentStatusControl(kind,doc){
  if(kind==='po'){
    const status=['รอสั่งของ','สั่งแล้ว','เรียบร้อย'].includes(doc.status)?doc.status:'รอสั่งของ';
    const cls=status==='เรียบร้อย'?'po-complete':status==='สั่งแล้ว'?'po-done':'po-pending';
    return `<select class="doc-status-select ${cls}" data-status-kind="po" data-id="${escapeHtml(doc.id)}"><option value="รอสั่งของ" ${status==='รอสั่งของ'?'selected':''}>รอสั่งของ</option><option value="สั่งแล้ว" ${status==='สั่งแล้ว'?'selected':''}>สั่งแล้ว</option><option value="เรียบร้อย" ${status==='เรียบร้อย'?'selected':''}>เรียบร้อย</option></select>`;
  }
  if(kind==='ret'){
    const status=doc.status==='คืนเรียบร้อย'?'คืนเรียบร้อย':'รอรับคืน';
    const cls=status==='คืนเรียบร้อย'?'po-complete':'po-pending';
    return `<select class="doc-status-select ${cls}" data-status-kind="ret" data-id="${escapeHtml(doc.id)}"><option value="รอรับคืน" ${status==='รอรับคืน'?'selected':''}>รอรับคืน</option><option value="คืนเรียบร้อย" ${status==='คืนเรียบร้อย'?'selected':''}>คืนเรียบร้อย</option></select>`;
  }
  const status=GOODS_RECEIPT_STATUSES.includes(doc.status)?doc.status:(doc.stockApplied===true?'รับสินค้าแล้ว':'รอรับสินค้า');
  const cls=status==='ชำระเรียบร้อย'?'po-complete':status==='รับสินค้าแล้ว'?'po-done':'gr-pending';
  const canManage=canManageGoodsReceipt(doc);
  return `<select class="doc-status-select ${cls}" data-status-kind="gr" data-id="${escapeHtml(doc.id)}" ${canManage?'':'disabled title="ดูได้อย่างเดียว: ใบรับสินค้านี้สร้างโดยผู้ใช้งานอื่น"'}><option value="รอรับสินค้า" ${status==='รอรับสินค้า'?'selected':''}>รอรับสินค้า</option><option value="รับสินค้าแล้ว" ${status==='รับสินค้าแล้ว'?'selected':''}>รับสินค้าแล้ว</option><option value="ชำระเรียบร้อย" ${status==='ชำระเรียบร้อย'?'selected':''}>ชำระเรียบร้อย</option></select>`;
}
function documentSortHeader(kind,key,label){
  const sort=documentSort[kind], active=sort.key===key;
  const arrow=active?(sort.dir===1?'▲':'▼'):'↕';
  return `<button class="doc-sort-btn" data-doc-sort="${kind}:${key}">${label}<span class="doc-sort-arrow">${arrow}</span></button>`;
}
function sortedDocuments(list,kind){
  const sort=documentSort[kind];
  const value=(doc,key)=>key==='due'?documentDueDate(doc):key==='total'?Number(doc.total)||0:key==='elapsed'?elapsedDaysSince(doc.date):String(doc[key]||'').toLowerCase();
  return list.slice().sort((a,b)=>{ const av=value(a,sort.key),bv=value(b,sort.key); if(typeof av==='number') return (av-bv)*sort.dir; return av.localeCompare(bv,'th')*sort.dir; });
}
function elapsedDaysSince(dateStr){ return Math.max(0,-daysFromToday(dateStr)); }
function expandableDocumentItemRows(items){
  return (items||[]).filter(item=>String(item?.name||'').trim()).map(item=>({
    name:String(item.name||'-'),
    qty:item.qty===undefined||item.qty===null||item.qty===''?'':item.qty,
    unit:String(item.unit||''),
    kind:[item.kind||item.detail||'',item.lotNumber?`Lot ${item.lotNumber}`:'',item.expiry?`หมดอายุ ${fmtDateShort(item.expiry)}`:''].filter(Boolean).join(' · ')
  }));
}
function expandableDocumentItemKey(kind,id){ return `${String(kind||'document')}:${String(id||'')}`; }
function expandableDocumentItemsPreview(kind,id,items,limit=3){
  const list=expandableDocumentItemRows(items);
  if(!list.length) return '<div class="doc-expandable-items">-</div>';
  const key=expandableDocumentItemKey(kind,id),expanded=expandedDocumentItemLists.has(key),visible=list.slice(0,limit),remaining=Math.max(0,list.length-visible.length);
  const lines=visible.map(item=>`<span class="doc-expandable-item-line" title="${escapeHtml(item.name)}">${item.kind?`<small class="doc-expandable-item-kind">${escapeHtml(item.kind)}</small>`:''}${escapeHtml(item.name)}${item.qty!==''?` ×${escapeHtml(item.qty)}`:''}${item.unit?` ${escapeHtml(item.unit)}`:''}</span>`).join('');
  if(!remaining) return `<div class="doc-expandable-items">${lines}</div>`;
  return `<button type="button" class="doc-expandable-items" data-document-items-toggle="${escapeHtml(encodeURIComponent(key))}" aria-expanded="${expanded?'true':'false'}" aria-label="${expanded?'ซ่อน':'แสดง'}สินค้าทั้งหมด ${list.length} รายการ">${lines}<span class="doc-expandable-more"><span class="doc-expandable-toggle" aria-hidden="true">▶</span>+${remaining} รายการ</span></button>`;
}
function expandableDocumentItemsDetailRow(kind,id,items,colspan){
  const list=expandableDocumentItemRows(items),key=expandableDocumentItemKey(kind,id);
  if(list.length<=3||!expandedDocumentItemLists.has(key)) return '';
  return `<tr class="doc-items-detail-row"><td colspan="${Number(colspan)||1}"><div class="doc-items-detail-list"><div class="doc-items-detail-head"><span>สินค้า</span><span>จำนวน</span><span>หน่วย</span><span>รายละเอียด</span></div>${list.map(item=>`<div class="doc-items-detail-item"><span>${escapeHtml(item.name)}</span><span class="doc-items-detail-qty">${item.qty===''?'-':escapeHtml(item.qty)}</span><span class="doc-items-detail-unit">${escapeHtml(item.unit||'-')}</span><span class="doc-items-detail-kind">${escapeHtml(item.kind||'-')}</span></div>`).join('')}</div></td></tr>`;
}
function documentItemsPreview(items){
  const list=items||[];
  const shown=list.slice(0,2).map(i=>`${escapeHtml(i.name)}${i.qty?` ×${escapeHtml(i.qty)}`:''}`).join('<br>');
  const more=list.length>2?`<span class="doc-item-more">+${list.length-2} รายการ</span>`:'';
  return `<div class="doc-item-preview">${shown||'-'} ${more}</div>`;
}
function shortageRepresentativeContact(name){
  const rep=salesRepresentatives.find(item=>item.name===name);
  if(!rep) return '<div class="shortage-contact">-</div>';
  return `<div class="shortage-contact"><div><small>โทร</small><span class="mono">${escapeHtml(rep.phone||'-')}</span></div><div><small>ไลน์</small><span>${escapeHtml(rep.line||'-')}</span></div></div>`;
}
function shortageAllItems(items,id){ return expandableDocumentItemsPreview('shortage',id,items); }
function documentActionMenu(kind,id){
  const key=`${kind}:${id}`;
  if(openDocMenu!==key) return '';
  const item=(action,icon,label,cls='')=>`<button class="doc-action-item ${escapeHtml(cls)}" data-doc-action="${escapeHtml(action)}" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(id)}"><span class="doc-action-icon">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span></button>`;
  return `<div class="doc-action-menu">
    ${item('edit','✎','แก้ไข')}${item('print','▣','พิมพ์')}${item('duplicate','▱','สร้างซ้ำ')}${item('delete','▰','ลบ','danger')}
  </div>`;
}
function documentBulkToolbar(kind){
  const canPrint=kind!=='ret'&&kind!=='po'&&kind!=='quotation';
  const canDelete=['po','quotation','ret'].includes(kind);
  return `<div class="doc-bulkbar" id="docBulkbar" data-kind="${kind}" hidden>
    <div class="doc-selected-pill"><span>เลือก <b id="docSelectedCount">0</b> รายการ</span><button class="doc-selected-clear" id="docSelectedClear" title="ยกเลิกการเลือก">×</button></div>
    <span class="doc-bulk-divider"></span>
    ${canPrint?'<button class="doc-bulk-icon" id="docBulkPrint" title="พิมพ์เอกสาร" aria-label="พิมพ์เอกสาร"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></svg></button>':''}
    ${canDelete?'<button class="doc-bulk-icon danger" id="docBulkDelete" title="ลบรายการที่เลือก" aria-label="ลบรายการที่เลือก"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>':''}
  </div>`;
}
function expiryBadge(expiry){
  const d = daysUntil(expiry);
  if(d < 0) return {cls:'danger', label:`หมดอายุแล้ว ${Math.abs(d)} วัน`};
  if(d <= 30) return {cls:'danger', label:`เหลือ ${d} วัน`};
  if(d <= 90) return {cls:'warn', label:`เหลือ ${d} วัน`};
  return {cls:'ok', label: fmtDate(expiry)};
}
