function effectiveThreshold(p){ return (p.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD); }
function isLowStock(p){ if(p.lowAlert===false) return false; return p.stock <= effectiveThreshold(p); }
function reportInventoryProductRows(){
  if(!isAllWarehousesMode()) return products.map(product=>({...product,_reportWarehouseId:Number(activeWarehouseId),_reportWarehouseName:activeWarehouse()?.name||'-'}));
  const allowedIds=new Set(reportWarehouseIds());
  const productById=new Map(products.map(product=>[Number(product.id),product]));
  return inventoryBalanceRows.filter(balance=>allowedIds.has(Number(balance.warehouse_id))).map(balance=>{
    const product=productById.get(Number(balance.product_id));
    if(!product) return null;
    const warehouse=warehouses.find(item=>Number(item.id)===Number(balance.warehouse_id));
    return {...product,stock:Number(balance.stock)||0,expiry:balance.expiry||'',_reportWarehouseId:Number(balance.warehouse_id),_reportWarehouseName:warehouse?.name||'-'};
  }).filter(Boolean);
}
function inventoryReportDefaultWarehouseValue(user=loggedInUser()){
  const allowed=reportWarehouseIds();
  if(Number(user?.level)===1) return 'all';
  const activeId=Number(activeWarehouseId);
  return allowed.includes(activeId)?String(activeId):(allowed.length?String(allowed[0]):'all');
}
function normalizeInventoryReportWarehouseValue(value,user=loggedInUser()){
  const allowed=reportWarehouseIds();
  const selected=String(value||'context');
  if(selected==='context') return inventoryReportDefaultWarehouseValue(user);
  if(selected==='all') return 'all';
  return allowed.includes(Number(selected))?selected:inventoryReportDefaultWarehouseValue(user);
}
function lowStockReportWarehouseIds(){
  const allowed=reportWarehouseIds();
  const selected=normalizeInventoryReportWarehouseValue(lowStockPageFilter.stockWarehouse);
  if(selected==='all') return allowed;
  const warehouseId=Number(selected);
  return allowed.includes(warehouseId)?[warehouseId]:allowed.slice(0,1);
}
function lowStockReportUnitOptions(product){
  const seen=new Set();
  return productUnitOptions(product).filter(option=>{
    const name=String(option.name||'').trim();
    if(!name||seen.has(name)) return false;
    seen.add(name); return true;
  }).map(option=>({...option,factor:Math.max(1,Number(option.factor)||1)})).sort((a,b)=>b.factor-a.factor);
}
function lowStockReportSelectedUnit(product){
  const options=lowStockReportUnitOptions(product);
  const requested=String(lowStockUnitSelection[product.id]||'');
  const selected=options.find(option=>option.name===requested)||options[0]||{name:product.unit||'-',factor:1};
  lowStockUnitSelection[product.id]=selected.name;
  return {options,selected};
}
function lowStockReportRows(){
  const warehouseIds=lowStockReportWarehouseIds();
  const warehouseById=new Map(warehouses.map(warehouse=>[Number(warehouse.id),warehouse]));
  const activeId=Number(activeWarehouseId);
  const rows=[];
  products.filter(product=>product.type!=='service').forEach(product=>{
    const unitData=lowStockReportSelectedUnit(product);
    warehouseIds.forEach(warehouseId=>{
      const balance=inventoryBalanceMap.get(inventoryBalanceKey(product.id,warehouseId));
      const stock=balance?Number(balance.stock)||0:(Number(warehouseId)===activeId?Number(product.stock)||0:0);
      rows.push({
        key:`${Number(warehouseId)}:${Number(product.id)}`,
        productId:Number(product.id),sku:product.sku||'',name:product.name,product,
        stock,displayStock:stockUnitAmountFromBase(stock,unitData.selected.factor),displayUnit:unitData.selected.name,
        displayFactor:unitData.selected.factor,unitOptions:unitData.options,
        warehouseId:Number(warehouseId),warehouseName:warehouseById.get(Number(warehouseId))?.name||'-'
      });
    });
  });
  return rows;
}
function lowStockReportConditionLabel(){
  if(lowStockPageFilter.stockMode==='out') return 'สินค้าที่คงเหลือเป็นศูนย์';
  if(lowStockPageFilter.stockMode==='negative') return 'สินค้าที่มีสต๊อกติดลบ';
  return `สินค้าที่คงเหลือมากกว่า 0 และต่ำกว่า ${lowStockPageFilter.stockThreshold} หน่วยหลัก`;
}
function lowStockReportRowMatches(row,mode=lowStockPageFilter.stockMode){
  const stock=Number(row?.stock)||0;
  if(mode==='out') return stock===0;
  if(mode==='negative') return stock<0;
  return stock>0&&stock<Number(lowStockPageFilter.stockThreshold);
}
function lowStockRowStatus(row){
  if(Number(row.stock)<0) return {label:'ติดลบ',cls:'danger',rowClass:'negative'};
  if(Number(row.stock)===0) return {label:'หมดแล้ว',cls:'warn',rowClass:'out'};
  return {label:'ใกล้หมด',cls:'info',rowClass:'low'};
}
function expiryReportWarehouseIds(){
  const allowed=reportWarehouseIds();
  const selected=normalizeInventoryReportWarehouseValue(lowStockPageFilter.expiryWarehouse);
  if(selected==='all') return allowed;
  const warehouseId=Number(selected);
  return allowed.includes(warehouseId)?[warehouseId]:allowed.slice(0,1);
}
function expiryReportLotRows(){
  const warehouseIds=new Set(expiryReportWarehouseIds());
  const productById=new Map(products.map(product=>[Number(product.id),product]));
  const warehouseById=new Map(warehouses.map(warehouse=>[Number(warehouse.id),warehouse]));
  const lotsByProductWarehouse=new Map();
  (inventoryLotRows||[]).forEach(lot=>{
    const warehouseId=Number(lot.warehouse_id),productId=Number(lot.product_id);
    if(!warehouseIds.has(warehouseId)||Number(lot.quantity_base)<=0) return;
    const key=inventoryBalanceKey(productId,warehouseId);
    if(!lotsByProductWarehouse.has(key)) lotsByProductWarehouse.set(key,[]);
    lotsByProductWarehouse.get(key).push(lot);
  });
  const rows=[];
  lotsByProductWarehouse.forEach((lotRows,key)=>{
    const first=lotRows[0],product=productById.get(Number(first?.product_id));
    if(!product) return;
    const warehouseId=Number(first.warehouse_id),warehouseName=warehouseById.get(warehouseId)?.name||'-';
    groupInventoryLotDetailRows(lotRows).forEach(group=>{
      const firstRow=group.rows[0]||{};
      rows.push({
        productId:Number(product.id),sku:product.sku||'',name:product.name,product,
        lotNumber:group.manufacturerLot||(group.rows.length===1?firstRow.internal_code:'')||'ไม่ระบุ LOT',
        expiry:group.expiryDate||'',quantityBase:Number(group.quantityBase)||0,
        quantityText:lotQuantityText(product,{quantity_base:group.quantityBase}),
        warehouseId,warehouseName,blocked:group.rows.every(row=>row.status==='blocked')
      });
    });
  });
  const balanceKeys=new Set();
  (inventoryBalanceRows||[]).forEach(balance=>{
    const warehouseId=Number(balance.warehouse_id),productId=Number(balance.product_id);
    if(!warehouseIds.has(warehouseId)) return;
    const key=inventoryBalanceKey(productId,warehouseId); balanceKeys.add(key);
    if(lotsByProductWarehouse.has(key)||Number(balance.stock)<=0||!balance.expiry) return;
    const product=productById.get(productId); if(!product) return;
    rows.push({productId,sku:product.sku||'',name:product.name,product,lotNumber:'ข้อมูลเดิม (ไม่มี LOT)',expiry:balance.expiry,quantityBase:Number(balance.stock)||0,quantityText:lotQuantityText(product,{quantity_base:balance.stock}),warehouseId,warehouseName:warehouseById.get(warehouseId)?.name||'-',blocked:false,legacy:true});
  });
  if(warehouseIds.size===1){
    const warehouseId=[...warehouseIds][0];
    products.forEach(product=>{
      const key=inventoryBalanceKey(product.id,warehouseId);
      if(lotsByProductWarehouse.has(key)||balanceKeys.has(key)||Number(product.stock)<=0||!product.expiry) return;
      rows.push({productId:Number(product.id),sku:product.sku||'',name:product.name,product,lotNumber:'ข้อมูลเดิม (ไม่มี LOT)',expiry:product.expiry,quantityBase:Number(product.stock)||0,quantityText:lotQuantityText(product,{quantity_base:product.stock}),warehouseId,warehouseName:warehouseById.get(warehouseId)?.name||'-',blocked:false,legacy:true});
    });
  }
  return rows.filter(row=>row.expiry&&Number.isFinite(daysUntil(row.expiry)));
}
function expiryReportRowMatches(row,mode=lowStockPageFilter.expiryMode,withinDays=lowStockPageFilter.expiryDays){
  const remaining=daysUntil(row?.expiry),limit=Math.max(0,Number(withinDays)||0);
  if(!Number.isFinite(remaining)) return false;
  if(mode==='expired') return remaining<0;
  if(mode==='near') return remaining>=0&&remaining<=limit;
  return remaining<=limit;
}
function expiryReportConditionLabel(){
  if(lowStockPageFilter.expiryMode==='expired') return 'เฉพาะสินค้าที่หมดอายุแล้ว';
  if(lowStockPageFilter.expiryMode==='near') return `สินค้าใกล้หมดอายุภายใน ${lowStockPageFilter.expiryDays} วัน`;
  return `สินค้าหมดอายุแล้วและใกล้หมดอายุภายใน ${lowStockPageFilter.expiryDays} วัน`;
}
function lowSortedList(list, sortState, keyFn){
  const dir=sortState.dir;
  return [...list].sort((a,b)=>{
    const av=keyFn(a,sortState.key), bv=keyFn(b,sortState.key);
    if(typeof av==='number' && typeof bv==='number') return (av-bv)*dir;
    return String(av).localeCompare(String(bv),'th')*dir;
  });
}
function lowTh(table, key, label, alignRight){
  const s = lowStockSort[table];
  const arrow = s.key===key ? (s.dir===1?' ▲':' ▼') : '';
  return `<th class="sortable ${alignRight?'num':''}" data-lowsort="${table}:${key}">${label}<span class="sortarrow">${arrow}</span></th>`;
}
const LOWSTOCK_PAGE_SIZE = 10;
function renderLowStock(){
  lowStockPageFilter.stockWarehouse=normalizeInventoryReportWarehouseValue(lowStockPageFilter.stockWarehouse);
  const allRows=lowStockReportRows();
  const filteredRows=allRows.filter(row=>lowStockReportRowMatches(row));
  const lowCount=allRows.filter(row=>lowStockReportRowMatches(row,'low')).length;
  const outCount=allRows.filter(row=>lowStockReportRowMatches(row,'out')).length;
  const negativeCount=allRows.filter(row=>lowStockReportRowMatches(row,'negative')).length;
  const lowSorted=lowSortedList(filteredRows,lowStockSort.stock,(row,key)=>key==='stock'?row.stock:key==='sku'?(row.sku||''):key==='unit'?row.displayFactor:key==='wh'?row.warehouseName:row.name);

  const stockTotalPages=Math.max(1, Math.ceil(lowSorted.length/LOWSTOCK_PAGE_SIZE));
  if(lowStockPageFilter.stockPage>stockTotalPages) lowStockPageFilter.stockPage=stockTotalPages;
  if(lowStockPageFilter.stockPage<1) lowStockPageFilter.stockPage=1;
  const stockStart=(lowStockPageFilter.stockPage-1)*LOWSTOCK_PAGE_SIZE;
  const lowPageRows=lowSorted.slice(stockStart, stockStart+LOWSTOCK_PAGE_SIZE);
  const warehouseOptions=accessibleWarehouses().map(warehouse=>`<option value="${warehouse.id}" ${String(lowStockPageFilter.stockWarehouse)===String(warehouse.id)?'selected':''}>${escapeHtml(warehouse.name)}</option>`).join('');

  return `<div class="lowstock-section low-stock-report-page">
    <div class="pagehead topbar-action-source"><div></div><button class="btn primary" id="printLowStockBtn">พิมพ์รายงาน</button></div>
    <div class="low-stock-report-summary">
      <div class="low-stock-summary-card ${lowStockPageFilter.stockMode==='low'?'active':''}"><button type="button" class="low-stock-summary-card-select" data-lowstock-mode="low"><span>สินค้าต่ำกว่าเกณฑ์</span><b>${lowCount}</b></button><label class="low-stock-threshold-field"><span>ต่ำกว่า</span><input id="lowStockThresholdInput" class="no-spin" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(lowStockPageFilter.stockThreshold)}" aria-label="จำนวนคงเหลือที่ถือว่าใกล้หมด"><span>ชิ้น</span></label></div>
      <div class="low-stock-summary-card out ${lowStockPageFilter.stockMode==='out'?'active':''}"><button type="button" class="low-stock-summary-card-select" data-lowstock-mode="out"><span>สินค้าเป็นศูนย์</span><b>${outCount}</b></button></div>
      <div class="low-stock-summary-card negative ${lowStockPageFilter.stockMode==='negative'?'active':''}"><button type="button" class="low-stock-summary-card-select" data-lowstock-mode="negative"><span>สินค้าติดลบ</span><b>${negativeCount}</b></button></div>
      <label class="low-stock-filter-field"><span class="low-stock-filter-label">คลังสินค้าที่แสดง</span><select id="lowStockWarehouseFilter" aria-label="เลือกคลังสินค้า"><option value="all" ${lowStockPageFilter.stockWarehouse==='all'?'selected':''}>ทุกคลัง</option>${warehouseOptions}</select></label>
    </div>
    <div class="doc-list-wrap seamless-table-wrap lowstock-table-scroll">
    <table class="low-table doc-head-blue low-stock-report-table"><thead><tr>${lowTh('stock','sku','รหัสสินค้า')}${lowTh('stock','name','สินค้า')}${lowTh('stock','stock','คงเหลือ',true)}${lowTh('stock','unit','หน่วย')}${lowTh('stock','wh','คลัง')}<th>สถานะ</th></tr></thead>
    <tbody>${lowPageRows.map(row=>{const status=lowStockRowStatus(row);return `<tr class="${status.rowClass}"><td class="mono">${escapeHtml(row.sku||'-')}</td><td class="low-stock-product"><b>${escapeHtml(row.name)}</b></td><td class="mono num ${row.stock<0?'stock-negative':''}">${escapeHtml(row.displayStock)}</td><td><select class="low-stock-unit-select" data-lowstock-unit="${row.productId}" aria-label="หน่วยที่แสดงของ ${escapeHtml(row.name)}">${row.unitOptions.map(option=>`<option value="${escapeHtml(option.name)}" ${option.name===row.displayUnit?'selected':''}>${escapeHtml(option.name)}</option>`).join('')}</select></td><td>${escapeHtml(row.warehouseName)}</td><td><span class="badge ${status.cls}">${status.label}</span></td></tr>`;}).join('')||`<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px;">ไม่พบ${escapeHtml(lowStockReportConditionLabel())}</td></tr>`}</tbody></table>
    </div>
    <div style="padding-top:12px;">${pagerHtml(lowStockPageFilter.stockPage, stockTotalPages, 'lowpage-stock')}</div>
  </div>
  `;
}

function renderExpiry(){
  lowStockPageFilter.expiryWarehouse=normalizeInventoryReportWarehouseValue(lowStockPageFilter.expiryWarehouse);
  const expDays=lowStockPageFilter.expiryDays;
  const allRows=expiryReportLotRows();
  const filteredRows=allRows.filter(row=>expiryReportRowMatches(row));
  const expSorted=lowSortedList(filteredRows,lowStockSort.expiry,(row,key)=>key==='expiry'?(row.expiry||''):key==='status'?daysUntil(row.expiry):key==='lot'?(row.lotNumber||''):key==='quantity'?row.quantityBase:key==='wh'?(row.warehouseName||''):row.name);
  const expiredCount=allRows.filter(row=>daysUntil(row.expiry)<0).length;
  const nearCount=allRows.filter(row=>daysUntil(row.expiry)>=0&&daysUntil(row.expiry)<=expDays).length;
  const expTotalPages=Math.max(1, Math.ceil(expSorted.length/LOWSTOCK_PAGE_SIZE));
  if(lowStockPageFilter.expiryPage>expTotalPages) lowStockPageFilter.expiryPage=expTotalPages;
  if(lowStockPageFilter.expiryPage<1) lowStockPageFilter.expiryPage=1;
  const expStart=(lowStockPageFilter.expiryPage-1)*LOWSTOCK_PAGE_SIZE;
  const expPageRows=expSorted.slice(expStart, expStart+LOWSTOCK_PAGE_SIZE);
  const warehouseOptions=accessibleWarehouses().map(warehouse=>`<option value="${warehouse.id}" ${String(lowStockPageFilter.expiryWarehouse)===String(warehouse.id)?'selected':''}>${escapeHtml(warehouse.name)}</option>`).join('');

  return `<div class="lowstock-section expiry-report-page">
    <div class="pagehead topbar-action-source"><div></div><button class="btn primary" id="printExpiryBtn">พิมพ์รายงาน</button></div>
    <div class="expiry-report-summary"><div class="expiry-near-card ${lowStockPageFilter.expiryMode==='near'?'active':''}"><button type="button" class="expiry-summary-card urgent" data-expiry-summary-mode="near" aria-label="แสดงสินค้าใกล้วันหมดอายุ"><span>ใกล้วันหมดอายุ</span><b>${nearCount}</b></button><label class="expiry-days-field"><span>ภายใน</span><input id="expiryDaysInput" class="no-spin" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(expDays)}" aria-label="จำนวนวันก่อนหมดอายุ"><span>วัน</span></label></div><button type="button" class="expiry-summary-card expired ${lowStockPageFilter.expiryMode==='expired'?'active':''}" data-expiry-summary-mode="expired" aria-label="แสดงสินค้าที่หมดอายุแล้ว"><span>หมดอายุแล้ว</span><b>${expiredCount}</b></button><label class="expiry-warehouse-card"><span>คลังสินค้าที่แสดง</span><select id="expiryWarehouseFilter" aria-label="เลือกคลังสินค้า"><option value="all" ${lowStockPageFilter.expiryWarehouse==='all'?'selected':''}>ทุกคลัง</option>${warehouseOptions}</select></label></div>
    <div class="doc-list-wrap seamless-table-wrap lowstock-table-scroll">
    <table class="low-table doc-head-blue expiry-report-table"><thead><tr>${lowTh('expiry','name','สินค้า')}${lowTh('expiry','lot','เลข LOT')}${lowTh('expiry','quantity','คงเหลือ',true)}${lowTh('expiry','expiry','วันหมดอายุ')}${lowTh('expiry','status','สถานะ')}${lowTh('expiry','wh','คลัง')}<th>รายละเอียด</th></tr></thead>
    <tbody>${expPageRows.map(row=>{const remaining=daysUntil(row.expiry),badge=expiryBadge(row.expiry),rowClass=remaining<0?'expired':remaining<=30?'urgent':'';return `<tr class="${rowClass}"><td><span class="expiry-product-name">${escapeHtml(row.name)}</span><span class="expiry-product-sku">รหัส ${escapeHtml(row.sku||'-')}</span></td><td><span class="expiry-lot-code">${escapeHtml(row.lotNumber)}</span>${row.blocked?'<span class="badge danger" style="margin:5px auto 0;">ระงับแล้ว</span>':''}</td><td class="mono num">${escapeHtml(row.quantityText)}</td><td class="mono ${remaining<0?'expiry-past':''}">${escapeHtml(fmtDate(row.expiry))}</td><td><span class="badge ${badge.cls}">${escapeHtml(badge.label)}</span></td><td>${escapeHtml(row.warehouseName)}</td><td><button class="btn ghost small expiry-detail-btn" data-product-lots="${row.productId}" data-lot-warehouse="${row.warehouseId}">ดู LOT</button></td></tr>`;}).join('')||`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:28px;">ไม่พบ${escapeHtml(expiryReportConditionLabel())}</td></tr>`}</tbody></table>
    </div>
    <div style="padding-top:12px;">${pagerHtml(lowStockPageFilter.expiryPage, expTotalPages, 'lowpage-expiry')}</div>
  </div>
  `;
}
