// ---------- รายงานรายการงานเคลื่อนไหว ----------
function inventoryMovementRound(value){ return Math.round((Number(value)||0)*1000000)/1000000; }
function inventoryMovementProduct(item,productList){
  const list=productList||[];
  const id=Number(item?.productId??item?.pid);
  return (id?list.find(product=>Number(product.id)===id):null)||list.find(product=>String(product.name||'')===String(item?.name||''))||null;
}
function inventoryMovementWarehouseName(id,warehouseList,fallback){
  return (warehouseList||[]).find(warehouse=>Number(warehouse.id)===Number(id))?.name||fallback||'-';
}
function productExchangeMovementLines(doc){
  const outgoingApplied=doc?.outgoingApplied===true||['ส่งไปเปลี่ยนแล้ว','รับสินค้ากลับแล้ว'].includes(doc?.status);
  const incomingApplied=doc?.incomingApplied===true||doc?.status==='รับสินค้ากลับแล้ว';
  const identity=item=>Number(item?.pid)?`id:${Number(item.pid)}`:`name:${String(item?.name||'').trim().toLowerCase()}`;
  const baseQty=item=>inventoryMovementRound((Number(item?.qty)||0)*(Number(item?.factor)>0?Number(item.factor):1));
  const qtyFromBase=(base,item)=>inventoryMovementRound(base/(Number(item?.factor)>0?Number(item.factor):1));
  const incoming=(doc?.incomingItems||[]).map(item=>({item,remaining:baseQty(item)}));
  const changed=[],received=[],sent=[];
  if(outgoingApplied){
    (doc?.outgoingItems||[]).forEach(item=>{
      let remaining=baseQty(item),matched=0;
      if(incomingApplied){
        incoming.forEach(entry=>{
          if(remaining<=0||entry.remaining<=0||identity(entry.item)!==identity(item)) return;
          const amount=Math.min(remaining,entry.remaining);
          remaining=inventoryMovementRound(remaining-amount);
          entry.remaining=inventoryMovementRound(entry.remaining-amount);
          matched=inventoryMovementRound(matched+amount);
        });
      }
      if(matched>0) changed.push({...item,qty:qtyFromBase(matched,item),direction:'เปลี่ยน'});
      if(remaining>0) sent.push({...item,qty:qtyFromBase(remaining,item),direction:'ออก'});
    });
  }
  if(incomingApplied){
    incoming.forEach(entry=>{
      if(entry.remaining>0) received.push({...entry.item,qty:qtyFromBase(entry.remaining,entry.item),direction:'เข้า'});
    });
  }
  return [...changed,...received,...sent];
}
function collectInventoryMovements(source){
  const sales=source?.sales||[],receipts=source?.receipts||[],exchanges=source?.exchanges||[],returns=source?.returns||[],transfersList=source?.transfers||[];
  const productList=source?.products||[],warehouseList=source?.warehouses||[];
  const rows=[];
  let order=0;
  const add=(meta,item)=>{
    if(item?.custom) return;
    const product=inventoryMovementProduct(item,productList);
    if(!product) return;
    const qty=inventoryMovementRound(item?.qty);
    if(qty<=0) return;
    const warehouseId=meta.warehouseId??item?.warehouseId??product.wh;
    rows.push({
      date:String(meta.date||'').slice(0,10),type:meta.type||'-',bill:meta.bill||'-',time:meta.time||'-',
      productId:Number(product.id),productName:String(item?.name||product.name||'-'),qty,unit:String(item?.unit||product.unit||''),
      direction:meta.direction||'-',warehouseId:Number(warehouseId)||0,warehouse:inventoryMovementWarehouseName(warehouseId,warehouseList,meta.warehouseName),order:order++
    });
  };
  sales.filter(sale=>sale?.status==='done').forEach(sale=>{
    const rawTime=String(sale.time||''),time=(rawTime.includes(' ')?rawTime.slice(11,16):rawTime.slice(0,5))||'-';
    (sale.items||[]).forEach(item=>{
      if(sale.customerReturn){if(item.restock&&item.tracksStock!==false)add({date:sale.date,type:'รับคืนจากลูกค้า',bill:sale.ref||sale.id,time,direction:'เข้า',warehouseId:sale.warehouseId},{...item,qty:Math.abs(Number(item.qty))});}
      else add({date:sale.date,type:'ขาย',bill:sale.ref||sale.id,time,direction:'ออก'},item);
    });
  });
  receipts.filter(doc=>doc?.stockApplied===true).forEach(doc=>{
    (doc.items||[]).forEach(item=>add({date:doc.date,type:'รับเข้าสินค้า',bill:doc.id,time:'-',direction:'เข้า',warehouseId:doc.warehouseId},item));
  });
  exchanges.forEach(doc=>{
    productExchangeMovementLines(doc).forEach(item=>add({date:doc.date,type:'เปลี่ยนสินค้า',bill:doc.id,time:'-',direction:item.direction,warehouseId:doc.warehouseId},item));
  });
  returns.filter(doc=>doc?.stockApplied===true).forEach(doc=>{
    (doc.items||[]).forEach(item=>add({date:doc.date,type:'คืนสินค้า',bill:doc.id,time:'-',direction:'ออก',warehouseId:doc.warehouseId},item));
  });
  transfersList.filter(doc=>doc?.status!=='ยกเลิก').forEach(doc=>{
    (doc.items||[]).forEach(item=>{
      add({date:doc.date,type:'โอนสินค้า',bill:doc.id,time:'-',direction:'ออก',warehouseId:doc.fromId,warehouseName:doc.from},item);
      add({date:doc.date,type:'โอนสินค้า',bill:doc.id,time:'-',direction:'เข้า',warehouseId:doc.toId,warehouseName:doc.to},item);
    });
  });
  return rows.sort((left,right)=>{
    const leftStamp=`${left.date} ${left.time==='-'?'00:00':left.time}`,rightStamp=`${right.date} ${right.time==='-'?'00:00':right.time}`;
    if(leftStamp!==rightStamp) return rightStamp.localeCompare(leftStamp);
    const billOrder=String(right.bill).localeCompare(String(left.bill),'th',{numeric:true});
    return billOrder||left.order-right.order;
  });
}
function filterInventoryMovements(rows,filter,range){
  const selectedIds=new Set((filter?.products||[]).map(Number));
  const type=filter?.type||'all',direction=filter?.direction||'all';
  const warehouse=String(filter?.warehouse||'all');
  return (rows||[]).filter(row=>
    row.date>=range.from&&row.date<=range.to&&
    (warehouse==='all'||String(row.warehouseId)===warehouse)&&
    (type==='all'||row.type===type)&&
    (direction==='all'||row.direction===direction)&&
    (!selectedIds.size||selectedIds.has(Number(row.productId)))
  );
}
function inventoryMovementGroupKey(row){
  return [row?.date||'',row?.type||'',row?.bill||'',row?.time||''].join('|');
}
function groupInventoryMovements(rows){
  const groups=[],byKey=new Map();
  (rows||[]).forEach(row=>{
    const key=inventoryMovementGroupKey(row);
    let group=byKey.get(key);
    if(!group){
      group={key,date:row.date,type:row.type,bill:row.bill,time:row.time,rows:[]};
      byKey.set(key,group); groups.push(group);
    }
    group.rows.push(row);
  });
  return groups;
}
function inventoryMovementGroupUniqueItems(group){
  const seen=new Set(),items=[];
  (group?.rows||[]).forEach(row=>{
    const key=`${Number(row.productId)||0}|${row.unit||''}`;
    if(seen.has(key)) return;
    seen.add(key); items.push(row);
  });
  return items;
}
function inventoryMovementGroupItemCount(group){
  return inventoryMovementGroupUniqueItems(group).length;
}
function inventoryMovementGroupDirections(group){
  return [...new Set((group?.rows||[]).map(row=>row.direction||'-'))];
}
function inventoryMovementGroupWarehouseText(group){
  const rows=group?.rows||[];
  if(group?.type==='โอนสินค้า'){
    const from=rows.find(row=>row.direction==='ออก')?.warehouse;
    const to=rows.find(row=>row.direction==='เข้า')?.warehouse;
    if(from&&to) return from===to?from:`${from} → ${to}`;
  }
  return [...new Set(rows.map(row=>row.warehouse||'-'))].join(' / ')||'-';
}
function inventoryMovementDateRange(filter=inventoryMovementFilter){
  if(filter.period==='month'){
    const value=filter.month||TODAY_STR.slice(0,7),[year,month]=value.split('-').map(Number);
    return {from:`${year}-${String(month).padStart(2,'0')}-01`,to:`${year}-${String(month).padStart(2,'0')}-${String(new Date(year,month,0).getDate()).padStart(2,'0')}`};
  }
  if(filter.period==='year'){
    const year=filter.year||TODAY_STR.slice(0,4);
    return {from:`${year}-01-01`,to:`${year}-12-31`};
  }
  return {from:filter.from||TODAY_STR,to:filter.to||TODAY_STR};
}
function inventoryMovementRows(){
  return collectInventoryMovements({sales:salesHistory,receipts:goodsReceipts,exchanges:productExchanges,returns:productReturns,transfers,products,warehouses});
}
function inventoryMovementFilteredRows(){
  return filterInventoryMovements(inventoryMovementRows(),inventoryMovementFilter,inventoryMovementDateRange());
}
function inventoryMovementFilteredGroups(){
  return groupInventoryMovements(inventoryMovementFilteredRows());
}
function inventoryMovementQtyText(row){
  const qty=Number(row?.qty)||0;
  const formatted=qty.toLocaleString('th-TH',{maximumFractionDigits:6});
  return `${escapeHtml(row?.productName||'-')} ×${formatted}${row?.unit?` ${escapeHtml(row.unit)}`:''}`;
}
function inventoryMovementDirectionBadge(direction){
  const cls=direction==='เข้า'?'in':direction==='ออก'?'out':'exchange';
  return `<span class="movement-direction ${cls}">${escapeHtml(direction||'-')}</span>`;
}
function inventoryMovementGroupDetailHtml(group){
  return `<tr class="movement-detail-row"><td colspan="7"><div class="movement-detail-list">
    <div class="movement-detail-head"><span>สินค้า</span><span style="text-align:center;">จำนวน</span><span style="text-align:center;">เข้า-ออก</span><span style="text-align:center;">คลังสินค้า</span></div>
    ${(group.rows||[]).map(row=>`<div class="movement-detail-item"><span class="movement-detail-product">${escapeHtml(row.productName||'-')}</span><span class="movement-detail-qty">${(Number(row.qty)||0).toLocaleString('th-TH',{maximumFractionDigits:6})} ${escapeHtml(row.unit||'')}</span><span class="movement-direction-list">${inventoryMovementDirectionBadge(row.direction)}</span><span class="movement-detail-warehouse">${escapeHtml(row.warehouse||'-')}</span></div>`).join('')}
  </div></td></tr>`;
}
function inventoryMovementGroupPreviewHtml(group,limit=2){
  const items=inventoryMovementGroupUniqueItems(group),preview=items.slice(0,limit),remaining=Math.max(0,items.length-preview.length);
  return `<div class="movement-product-preview">${preview.map(row=>`<span class="movement-product-preview-line">${inventoryMovementQtyText(row)}</span>`).join('')}${remaining?`<span class="movement-product-preview-more">+${remaining} รายการ</span>`:''}</div>`;
}
function inventoryMovementGroupRowHtml(group){
  const expanded=inventoryMovementExpandedBills.has(group.key);
  const directions=inventoryMovementGroupDirections(group);
  const encodedKey=encodeURIComponent(group.key);
  return `<tr class="movement-summary-row ${expanded?'expanded':''}" data-movement-group="${escapeHtml(encodedKey)}" tabindex="0" aria-expanded="${expanded?'true':'false'}"><td>${fmtDate(group.date)}</td><td>${escapeHtml(group.type)}</td><td class="mono"><span class="movement-summary-bill"><span class="movement-summary-toggle" aria-hidden="true">▶</span>${escapeHtml(group.bill)}</span></td><td>${escapeHtml(group.time)}</td><td class="movement-product-cell">${inventoryMovementGroupPreviewHtml(group)}</td><td><div class="movement-direction-list">${directions.map(inventoryMovementDirectionBadge).join('')}</div></td><td>${escapeHtml(inventoryMovementGroupWarehouseText(group))}</td></tr>${expanded?inventoryMovementGroupDetailHtml(group):''}`;
}
function renderInventoryMovement(){
  const filter=inventoryMovementFilter,range=inventoryMovementDateRange();
  const selectedWarehouse=String(filter.warehouse||(isAllWarehousesMode()?'all':activeWarehouseId));
  filter.warehouse=selectedWarehouse;
  const brandOptions=filter.category?brands.filter(brand=>products.some(product=>product.category===filter.category&&product.brand===brand)):brands.slice();
  const matchCount=products.filter(product=>(!filter.category||product.category===filter.category)&&(!filter.brand||product.brand===filter.brand)&&(filter.category||filter.brand)).length;
  const selectedProducts=(filter.products||[]).map(id=>products.find(product=>Number(product.id)===Number(id))).filter(Boolean);
  const rows=inventoryMovementFilteredRows(),groups=groupInventoryMovements(rows),totalPages=Math.max(1,Math.ceil(groups.length/INVENTORY_MOVEMENT_PAGE_SIZE));
  filter.page=Math.min(totalPages,Math.max(1,Number(filter.page)||1));
  const start=(filter.page-1)*INVENTORY_MOVEMENT_PAGE_SIZE,pageGroups=groups.slice(start,start+INVENTORY_MOVEMENT_PAGE_SIZE);
  const periodOptions=[['range','วันที่'],['month','เดือน'],['year','ปี']];
  const primaryFilter=filter.scope||(filter.direction!=='all'?`direction:${filter.direction}`:`type:${filter.type||'all'}`);
  return `<div class="rpt movement-report-page">
    <div class="pagehead"><div><h1>รายงานการเคลื่อนไหว <span class="page-title-meta">· ${groups.length} บิล · ${rows.length} รายการเคลื่อนไหว${totalPages>1?` · หน้า ${filter.page}/${totalPages}`:''}</span></h1></div></div>
    <div class="rpt-filters">
      <div class="rpf-item"><select id="movementPeriod" class="rpt-select">${periodOptions.map(([value,label])=>`<option value="${value}" ${filter.period===value?'selected':''}>${label}</option>`).join('')}</select></div>
      ${filter.period==='range'?`<div class="rpf-item rpf-range">${dmyDateFieldHtml('movementFrom',range.from)}<span style="color:var(--text-muted);">ถึง</span>${dmyDateFieldHtml('movementTo',range.to)}</div>`:''}
      ${filter.period==='month'?`<div class="rpf-item"><input type="month" id="movementMonth" value="${filter.month||TODAY_STR.slice(0,7)}" class="rpt-select"></div>`:''}
      ${filter.period==='year'?`<div class="rpf-item"><select id="movementYear" class="rpt-select">${(()=>{const currentYear=Number(TODAY_STR.slice(0,4));let options='';for(let year=currentYear;year>=currentYear-6;year--) options+=`<option value="${year}" ${String(filter.year||currentYear)===String(year)?'selected':''}>${year}</option>`;return options;})()}</select></div>`:''}
      <div class="rpf-item"><select id="movementWarehouse" class="rpt-select"><option value="all" ${selectedWarehouse==='all'?'selected':''}>ทุกคลัง</option>${accessibleWarehouses().map(warehouse=>`<option value="${warehouse.id}" ${String(warehouse.id)===selectedWarehouse?'selected':''}>${escapeHtml(warehouse.name)}</option>`).join('')}</select></div>
      <div class="rpf-item"><select id="movementType" class="rpt-select"><option value="type:all" ${primaryFilter==='type:all'?'selected':''}>รายการทั้งหมด</option>${['ขาย','รับเข้าสินค้า','เปลี่ยนสินค้า','คืนสินค้า','รับคืนจากลูกค้า','โอนสินค้า'].map(type=>`<option value="type:${type}" ${primaryFilter===`type:${type}`?'selected':''}>${type}</option>`).join('')}<option class="movement-filter-divider" disabled>────────────</option><option value="direction:all" ${primaryFilter==='direction:all'?'selected':''}>เข้า-ออกทั้งหมด</option>${['เข้า','ออก','เปลี่ยน'].map(direction=>`<option value="direction:${direction}" ${primaryFilter===`direction:${direction}`?'selected':''}>${direction}</option>`).join('')}</select></div>
      <button class="btn ghost rpf-apply" id="movementApplyBtn">แสดงผล</button>
    </div>
    <div class="rpt-filters">
      <div class="rpf-item"><select id="movementCategory" class="rpt-select"><option value="">หมวดสินค้าหลัก: ทั้งหมด</option>${categories.map(category=>`<option value="${escapeHtml(category)}" ${filter.category===category?'selected':''}>${escapeHtml(category)}</option>`).join('')}</select></div>
      <div class="rpf-item"><select id="movementBrand" class="rpt-select"><option value="">หมวดสินค้าย่อย: ทั้งหมด</option>${brandOptions.map(brand=>`<option value="${escapeHtml(brand)}" ${filter.brand===brand?'selected':''}>${escapeHtml(brand)}</option>`).join('')}</select></div>
      <button class="btn ghost" id="movementAddCategoryBtn" ${(filter.category||filter.brand)?'':'disabled'}>เลือกสินค้าในหมวดนี้${(filter.category||filter.brand)?` (${matchCount})`:''}</button>
      <div class="movement-report-search"><input id="movementSearch" value="${escapeHtml(inventoryMovementSearchQuery)}" placeholder="ค้นหาหรือสแกนบาร์โค้ด..." autocomplete="off"><div id="movementSearchResults" class="fav-add-results" hidden style="left:0;right:0;top:calc(100% - 6px);"></div></div>
    </div>
    ${selectedProducts.length?`<div class="movement-selected-products"><span class="movement-selected-label">สินค้าที่เลือก ${selectedProducts.length} รายการ</span><div class="movement-selected-list">${selectedProducts.map(product=>`<span class="movement-product-chip">${escapeHtml(product.name)}<button type="button" data-movement-remove="${product.id}" aria-label="ลบ ${escapeHtml(product.name)}">×</button></span>`).join('')}</div><button type="button" class="movement-clear-products" id="movementClearProducts">ล้างทั้งหมด</button></div>`:'<div class="movement-selected-products"><span class="movement-selected-label">สินค้า: ทั้งหมด</span></div>'}
    <div class="doc-list-wrap"><table class="grid-table doc-head-blue movement-report-table"><colgroup><col style="width:120px"><col style="width:135px"><col style="width:180px"><col style="width:85px"><col><col style="width:150px"><col style="width:250px"></colgroup><thead><tr><th>วันที่</th><th>รายการ</th><th>บิล</th><th>เวลา</th><th>สินค้า</th><th>เข้า-ออก</th><th>คลังสินค้า</th></tr></thead><tbody>${pageGroups.map(inventoryMovementGroupRowHtml).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px;">ไม่มีรายการเคลื่อนไหวในช่วงเวลาหรือสินค้าที่เลือก</td></tr>'}</tbody></table></div>
    ${pagerHtml(filter.page,totalPages,'movement-page')}
  </div>`;
}

function buildGroupTree(){
  const tree = {}; // cat -> Set(brand)
  const catCounts = {}; // cat -> count
  const brCounts = {}; // "cat|||brand" -> count
  products.forEach(p=>{
    const cat = String(p.category||'').trim() || 'ไม่ทราบหมวดหมู่';
    const brand = p.brand || 'ทั่วไป';
    if(!tree[cat]) tree[cat] = new Set();
    tree[cat].add(brand);
    catCounts[cat] = (catCounts[cat]||0)+1;
    const brKey = cat+'|||'+brand;
    brCounts[brKey] = (brCounts[brKey]||0)+1;
  });
  if(!tree['ไม่ทราบหมวดหมู่']) tree['ไม่ทราบหมวดหมู่'] = new Set(['ทั่วไป']);
  return {tree, catCounts, brCounts};
}

function lotQuantityText(product,lot){
  if(!product) return `${inventoryMovementRound(lot?.quantity_base)} หน่วย`;
  return stockInLargestUnit({...product,stock:Number(lot?.quantity_base)||0});
}
function inventoryLotDisplayGroupKey(row){
  const manufacturerLot=String(row?.manufacturer_lot||'').trim().toLocaleLowerCase('th');
  if(!manufacturerLot) return `single:${row?.id}`;
  const expiryDate=String(row?.expiry_date||'').trim();
  const stockState=Number(row?.quantity_base)<=0||row?.status==='exhausted'?'exhausted':String(row?.status||'active');
  return `lot:${manufacturerLot}::${expiryDate}::${stockState}`;
}
function groupInventoryLotDetailRows(rows){
  const groups=[];
  const groupsByKey=new Map();
  (rows||[]).forEach(row=>{
    const key=inventoryLotDisplayGroupKey(row);
    let group=groupsByKey.get(key);
    if(!group){
      group={key,rows:[],manufacturerLot:String(row?.manufacturer_lot||'').trim(),expiryDate:String(row?.expiry_date||'').trim(),quantityBase:0};
      groupsByKey.set(key,group);
      groups.push(group);
    }
    group.rows.push(row);
    group.quantityBase+=Number(row?.quantity_base)||0;
  });
  return groups;
}
function inventoryLotDetailRowSets(rows){
  const stocked=[],exhausted=[];
  (rows||[]).forEach(row=>{
    if(Number(row?.quantity_base)>0&&row?.status!=='exhausted') stocked.push(row);
    else exhausted.push(row);
  });
  return {stocked,exhausted};
}
function inventoryLotDetailRowHtml(product,row,{childGroupIndex=null,readOnly=false}={}){
  const status=inventoryLotStatus(row);
  const classes=[childGroupIndex===null?'':'lot-group-child',readOnly?'lot-history-row':''].filter(Boolean).join(' ');
  const attributes=`${classes?` class="${classes}"`:''}${childGroupIndex===null?'':` data-lot-group-child="${childGroupIndex}" hidden`}${readOnly?` data-lot-history-row="${row.id}"`:` data-lot-row="${row.id}"`}`;
  const canEdit=currentProfile?.owner&&!readOnly;
  return `<tr${attributes}><td class="mono lot-internal-column">${escapeHtml(row.internal_code||'-')}</td><td>${canEdit?`<input class="lot-edit-number" value="${escapeHtml(row.manufacturer_lot||'')}" placeholder="ไม่ระบุ">`:escapeHtml(row.manufacturer_lot||'-')}</td><td class="mono">${escapeHtml(lotQuantityText(product,row))}</td><td>${canEdit?`<input class="lot-edit-expiry dmy-input" inputmode="numeric" maxlength="10" autocomplete="off" value="${escapeHtml(isoToDMY(row.expiry_date))}" placeholder="วว/ดด/ปปปป">`:escapeHtml(row.expiry_date?fmtDateShort(row.expiry_date):'-')}</td><td>${escapeHtml(row.received_at?fmtDateShort(String(row.received_at).slice(0,10)):'-')}</td><td><span class="lot-status ${status.key}">${status.label}</span></td></tr>`;
}
function inventoryLotDetailGroupsHtml(product,rows,{groupPrefix='stocked',readOnly=false}={}){
  return groupInventoryLotDetailRows(rows).map((group,groupIndex)=>{
    const groupKey=`${groupPrefix}-${groupIndex}`;
    if(group.rows.length===1) return inventoryLotDetailRowHtml(product,group.rows[0],{readOnly});
    const status=inventoryLotStatus(group.rows[0]);
    const latestReceived=group.rows.map(row=>String(row.received_at||'').slice(0,10)).filter(Boolean).sort().at(-1)||'';
    const summary=`<tr class="lot-group-summary ${readOnly?'lot-history-row':''}"><td class="lot-internal-column"><button type="button" class="lot-group-toggle" data-lot-group-toggle="${groupKey}" aria-expanded="false"><span class="lot-group-chevron">▸</span>${group.rows.length} รายการรับเข้า</button><small class="lot-group-note">กดเพื่อดูรหัส LOT ภายใน</small></td><td>${escapeHtml(group.manufacturerLot||'-')}</td><td class="mono">${escapeHtml(lotQuantityText(product,{quantity_base:group.quantityBase}))}</td><td>${escapeHtml(group.expiryDate?fmtDateShort(group.expiryDate):'-')}</td><td>${escapeHtml(latestReceived?`ล่าสุด ${fmtDateShort(latestReceived)}`:'-')}</td><td><span class="lot-status ${status.key}">${status.label}</span></td></tr>`;
    return summary+group.rows.map(row=>inventoryLotDetailRowHtml(product,row,{childGroupIndex:groupKey,readOnly})).join('');
  }).join('');
}
const INVENTORY_LOT_HISTORY_PAGE_SIZE=10;
const INVENTORY_LOT_DETAIL_COLUMNS='id,product_id,warehouse_id,internal_code,manufacturer_lot,expiry_date,quantity_base,unit_cost_base,received_at,source_type,source_id,status,updated_at';
async function openProductLotDetails(productId,warehouseId=activeWarehouseId){
  const product=products.find(item=>Number(item.id)===Number(productId));
  if(!product) return;
  const targetWarehouseId=Number(warehouseId)||Number(activeWarehouseId);
  const targetWarehouse=warehouses.find(item=>Number(item.id)===targetWarehouseId);
  const canManageWarehouse=currentProfile?.owner&&targetWarehouseId===Number(activeWarehouseId)&&!isAllWarehousesMode();
  let rows=inventoryLotsForProduct(product.id,targetWarehouseId);
  let historyCount=inventoryLotDetailRowSets(rows).exhausted.length;
  try{
    const [stockedResult,historyCountResult]=await Promise.all([
      sb.from('inventory_lots').select(INVENTORY_LOT_DETAIL_COLUMNS).eq('product_id',product.id).eq('warehouse_id',targetWarehouseId).gt('quantity_base',0).neq('status','exhausted').order('expiry_date',{ascending:true,nullsFirst:false}).order('received_at',{ascending:true}).order('id',{ascending:true}),
      sb.from('inventory_lots').select('id',{count:'exact',head:true}).eq('product_id',product.id).eq('warehouse_id',targetWarehouseId).or('quantity_base.lte.0,status.eq.exhausted')
    ]);
    if(stockedResult.error) throw stockedResult.error;
    rows=(stockedResult.data||[]).map(normalizeInventoryLotRow);
    if(historyCountResult.error) console.warn('count exhausted product lots',historyCountResult.error);
    else historyCount=Number(historyCountResult.count)||0;
  }catch(error){ console.warn('load product lot details',error); }
  rows.sort((a,b)=>{
    return String(a.expiry_date||'9999-12-31').localeCompare(String(b.expiry_date||'9999-12-31'))||Number(a.id)-Number(b.id);
  });
  const {stocked:stockedRows}=inventoryLotDetailRowSets(rows);
  const activeRows=stockedRows.filter(row=>row.status!=='blocked');
  const activeDisplayGroupCount=groupInventoryLotDetailRows(activeRows).length;
  const total=activeRows.reduce((sum,row)=>sum+Number(row.quantity_base||0),0);
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  const stockedRowsHtml=inventoryLotDetailGroupsHtml(product,stockedRows,{groupPrefix:'stocked',readOnly:!canManageWarehouse});
  const emptyStockedText=historyCount?'ไม่มี LOT ที่มีสินค้า':'ยังไม่มี LOT สำหรับสินค้านี้';
  const systemToggle=currentProfile?.owner&&(stockedRows.length||historyCount)?`<button type="button" class="lot-history-toggle" id="lotSystemDetailsToggle" aria-expanded="false"><span class="lot-history-toggle-chevron">▸</span><span>ดูรายละเอียดทางระบบ</span></button>`:'';
  const historyToggle=historyCount?`<button type="button" class="lot-history-toggle" id="lotHistoryToggle" aria-expanded="false"><span class="lot-history-toggle-chevron">▸</span><span>แสดง LOT ที่หมดแล้ว (${historyCount})</span></button>`:'';
  const detailToggles=systemToggle||historyToggle?`<div class="lot-history-toggle-wrap">${systemToggle}${historyToggle}</div>`:'';
  const historyLoadMore=historyCount?`<div class="lot-history-load-more" id="lotHistoryLoadMoreWrap" hidden><button type="button" class="btn ghost small" id="lotHistoryLoadMoreBtn">โหลดเพิ่มเติม</button><span class="lot-history-progress" id="lotHistoryProgress"></span></div>`:'';
  const lotDetailActions=canManageWarehouse&&stockedRows.length?`<div class="form-bottom-actions" style="justify-content:flex-end;gap:10px;">${activeDisplayGroupCount>=2?'<button class="btn ghost" type="button" id="openLotReallocationBtn">ปรับจำนวนแยกตาม LOT</button>':''}<button class="btn primary" id="saveLotDetailsBtn">บันทึกข้อมูล Lot</button></div>`:'';
  overlay.innerHTML=`<div class="modal lot-detail-modal"><div class="modal-head"><div><h3>รายละเอียด Lot</h3><div class="sub">${escapeHtml(product.name)} · ${escapeHtml(targetWarehouse?.name||'-')}</div></div><button class="modal-close" aria-label="ปิด">×</button></div><div class="lot-detail-body"><div class="lot-detail-summary"><span>คงเหลือรวม ${escapeHtml(stockInLargestUnit({...product,stock:total}))}</span><span>${activeDisplayGroupCount} Lot ที่มีสินค้า</span><span>หมดอายุใกล้สุด ${escapeHtml(activeRows.map(row=>row.expiry_date).filter(Boolean).sort()[0]?fmtDateShort(activeRows.map(row=>row.expiry_date).filter(Boolean).sort()[0]):'-')}</span></div>${canManageWarehouse?'':'<div class="info-box" style="margin-bottom:12px;">เปิดดูจากรายงานต่างคลัง จึงแสดงข้อมูลแบบอ่านอย่างเดียว หากต้องการแก้ไขให้เปลี่ยนคลังที่ TOPBAR ก่อน</div>'}<div class="seamless-table-wrap"><table class="grid-table doc-head-blue lot-detail-table"><thead><tr><th class="lot-internal-column">รหัส LOT ภายใน</th><th>เลข LOT ผู้ผลิต</th><th>คงเหลือ</th><th>วันหมดอายุ</th><th>รับเข้าเมื่อ</th><th>สถานะ</th></tr></thead><tbody>${stockedRowsHtml||`<tr><td colspan="6" style="padding:28px;color:var(--text-muted);">${emptyStockedText}</td></tr>`}</tbody>${historyCount?'<tbody id="lotHistoryBody" hidden></tbody>':''}</table></div>${detailToggles}${historyLoadMore}${lotDetailActions}</div></div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.addEventListener('click',event=>{ if(event.target===overlay) close(); });
  overlay.querySelector('#openLotReallocationBtn')?.addEventListener('click',()=>{ close(); openStockLotReallocation(product.id); });
  const systemDetailsButton=overlay.querySelector('#lotSystemDetailsToggle');
  if(systemDetailsButton) systemDetailsButton.addEventListener('click',()=>{
    const modal=overlay.querySelector('.lot-detail-modal');
    const showing=modal?.classList.toggle('show-internal-lots')||false;
    systemDetailsButton.setAttribute('aria-expanded',String(showing));
    const chevron=systemDetailsButton.querySelector('.lot-history-toggle-chevron');
    const label=systemDetailsButton.querySelector('span:last-child');
    if(chevron) chevron.textContent=showing?'▾':'▸';
    if(label) label.textContent=showing?'ซ่อนรายละเอียดทางระบบ':'ดูรายละเอียดทางระบบ';
    if(!showing){
      overlay.querySelectorAll('[data-lot-group-toggle]').forEach(button=>{
        button.setAttribute('aria-expanded','false');
        const groupChevron=button.querySelector('.lot-group-chevron');
        if(groupChevron) groupChevron.textContent='▸';
      });
      overlay.querySelectorAll('[data-lot-group-child]').forEach(row=>{ row.hidden=true; });
    }
  });
  const historyButton=overlay.querySelector('#lotHistoryToggle');
  const historyBody=overlay.querySelector('#lotHistoryBody');
  const historyLoadMoreButton=overlay.querySelector('#lotHistoryLoadMoreBtn');
  const historyLoadMoreWrap=overlay.querySelector('#lotHistoryLoadMoreWrap');
  const historyProgress=overlay.querySelector('#lotHistoryProgress');
  let historyLoaded=0,historyLoading=false;
  const updateHistoryControls=()=>{
    if(!historyButton) return;
    const expanded=historyButton.getAttribute('aria-expanded')==='true';
    const chevron=historyButton.querySelector('.lot-history-toggle-chevron');
    const label=historyButton.querySelector('span:last-child');
    if(chevron) chevron.textContent=expanded?'▾':'▸';
    if(label) label.textContent=`${expanded?'ซ่อน':'แสดง'} LOT ที่หมดแล้ว (${historyCount})`;
    if(historyProgress) historyProgress.textContent=`แสดงแล้ว ${historyLoaded} จาก ${historyCount} รายการ`;
    if(historyLoadMoreWrap) historyLoadMoreWrap.hidden=!expanded||historyLoaded>=historyCount;
  };
  const loadHistoryPage=async()=>{
    if(historyLoading||historyLoaded>=historyCount) return true;
    historyLoading=true;
    if(historyButton) historyButton.disabled=true;
    if(historyLoadMoreButton){ historyLoadMoreButton.disabled=true; historyLoadMoreButton.textContent='กำลังโหลด...'; }
    const label=historyButton?.querySelector('span:last-child');
    if(label&&historyLoaded===0) label.textContent='กำลังโหลด LOT ที่หมดแล้ว...';
    try{
      const {data,error}=await sb.from('inventory_lots').select(INVENTORY_LOT_DETAIL_COLUMNS).eq('product_id',product.id).eq('warehouse_id',targetWarehouseId).or('quantity_base.lte.0,status.eq.exhausted').order('received_at',{ascending:false}).order('id',{ascending:false}).range(historyLoaded,historyLoaded+INVENTORY_LOT_HISTORY_PAGE_SIZE-1);
      if(error) throw error;
      const pageRows=(data||[]).map(normalizeInventoryLotRow);
      if(historyBody&&pageRows.length) historyBody.insertAdjacentHTML('beforeend',inventoryLotDetailGroupsHtml(product,pageRows,{groupPrefix:`exhausted-${historyLoaded}`,readOnly:true}));
      historyLoaded+=pageRows.length;
      if(pageRows.length<INVENTORY_LOT_HISTORY_PAGE_SIZE) historyCount=historyLoaded;
      return true;
    }catch(error){
      console.warn('load exhausted product lots',error);
      showToast('โหลดประวัติ LOT ไม่สำเร็จ กรุณาลองใหม่','danger-top');
      return false;
    }finally{
      historyLoading=false;
      if(historyButton) historyButton.disabled=false;
      if(historyLoadMoreButton){ historyLoadMoreButton.disabled=false; historyLoadMoreButton.textContent='โหลดเพิ่มเติม'; }
      updateHistoryControls();
    }
  };
  if(historyButton) historyButton.addEventListener('click',async()=>{
    const expanded=historyButton.getAttribute('aria-expanded')==='true';
    if(expanded){
      historyButton.setAttribute('aria-expanded','false');
      if(historyBody) historyBody.hidden=true;
      updateHistoryControls();
      return;
    }
    if(historyLoaded===0&&!await loadHistoryPage()) return;
    historyButton.setAttribute('aria-expanded','true');
    if(historyBody) historyBody.hidden=false;
    updateHistoryControls();
  });
  if(historyLoadMoreButton) historyLoadMoreButton.addEventListener('click',loadHistoryPage);
  overlay.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-lot-group-toggle]');
    if(!button||!overlay.contains(button)) return;
    const expanded=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!expanded));
    const chevron=button.querySelector('.lot-group-chevron');
    if(chevron) chevron.textContent=expanded?'▸':'▾';
    overlay.querySelectorAll(`[data-lot-group-child="${button.dataset.lotGroupToggle}"]`).forEach(row=>{ row.hidden=expanded; });
  });
  const saveButton=overlay.querySelector('#saveLotDetailsBtn');
  if(saveButton) saveButton.onclick=async()=>{
    const changes=[];
    for(const rowElement of overlay.querySelectorAll('[data-lot-row]')){
      const lot=rows.find(item=>Number(item.id)===Number(rowElement.dataset.lotRow)); if(!lot) continue;
      const lotNumber=rowElement.querySelector('.lot-edit-number')?.value.trim()||'';
      const expiryText=rowElement.querySelector('.lot-edit-expiry')?.value.trim()||'';
      const expiry=expiryText?dmyToISO(expiryText):'';
      if(expiryText&&!expiry){ showToast(`วันหมดอายุของ Lot ${lot.internal_code} ไม่ถูกต้อง`,'danger-top'); return; }
      if(lotNumber!==String(lot.manufacturer_lot||'')||expiry!==String(lot.expiry_date||'')) changes.push({lot,lotNumber,expiry});
    }
    if(!changes.length){ close(); return; }
    saveButton.disabled=true;
    try{
      for(const change of changes){
        await runStockOperation('update_inventory_lot_details',{lotId:change.lot.id,manufacturerLot:change.lotNumber||null,expiry:change.expiry||null});
      }
      await Promise.all([loadInventoryBalancesFromSupabase(),loadInventoryLotsFromSupabase()]);
      close(); showToast(`บันทึกข้อมูล Lot แล้ว ${changes.length} รายการ`); render();
    }catch(error){ console.warn('save lot details',error); saveButton.disabled=false; showToast('บันทึกข้อมูล Lot ไม่สำเร็จ','danger-top'); }
  };
}
