function renderWarehouse(){
  if(addingWarehouse) return renderWarehouseForm();
  return `<div class="rpt"><div class="pagehead topbar-action-source"><div></div><button class="btn primary" id="newWarehouseBtn">+ เพิ่มคลังสินค้า</button></div>
    <div class="warehouse-name-table"><table><thead><tr><th>ชื่อคลังสินค้า</th><th style="width:112px;"></th></tr></thead><tbody>
      ${warehouses.map(w=>`<tr><td class="warehouse-name-cell">${escapeHtml(w.name)}</td><td class="warehouse-action-cell"><button class="warehouse-edit-btn" type="button" data-edit-warehouse="${w.id}" title="แก้ไขข้อมูลคลังสินค้า" aria-label="แก้ไขคลังสินค้า ${escapeHtml(w.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="warehouse-delete-btn" type="button" data-delete-warehouse="${w.id}" title="ลบคลังสินค้า" aria-label="ลบคลังสินค้า ${escapeHtml(w.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></td></tr>`).join('')||'<tr><td colspan="2" style="padding:30px;text-align:center;color:var(--text-muted);">ยังไม่มีคลังสินค้า</td></tr>'}
    </tbody></table></div></div>`;
}

function renderWarehouseForm(){
  const warehouse=editingWarehouseId!==null?warehouses.find(w=>w.id===editingWarehouseId):null;
  const data=warehouse||{name:'',code:'',address:'',postcode:'',purpose:'',contactName:'',email:'',phone:''};
  const editing=!!warehouse;
  return `<div class="warehouse-form">
    <div class="pagehead"><div><div class="breadcrumb">คลัง & สินค้า › คลังสินค้า / สาขา › ${editing?'แก้ไขข้อมูลคลังสินค้า':'เพิ่มคลังสินค้า'}</div><h1>${editing?'แก้ไขข้อมูลคลังสินค้า':'สร้างคลังสินค้า'}</h1></div></div>
    <div class="panel warehouse-form-card">
      <div class="warehouse-field-row"><label for="wh_name">ชื่อคลังสินค้า *</label><input id="wh_name" value="${escapeHtml(data.name)}" placeholder="เช่น คลังสำนักงานใหญ่"></div>
      <div class="warehouse-field-row"><label for="wh_code">รหัสคลังสินค้า</label><input id="wh_code" value="${escapeHtml(data.code||'')}" placeholder="เช่น ${escapeHtml(documentPrefixes.warehouse)}-003"></div>
      <div class="warehouse-field-row"><label for="wh_address">ที่อยู่</label><textarea id="wh_address" rows="4" placeholder="ที่อยู่คลังสินค้า">${escapeHtml(data.address||'')}</textarea></div>
      <div class="warehouse-field-row"><label for="wh_postcode">รหัสไปรษณีย์</label><input id="wh_postcode" value="${escapeHtml(data.postcode||'')}" inputmode="numeric" maxlength="5"></div>
      <div class="warehouse-field-row"><label for="wh_purpose">จุดประสงค์การใช้งาน *</label><select id="wh_purpose"><option value="">เลือกจุดประสงค์การใช้งาน</option>${['ขายสินค้า','เก็บสินค้า','กระจายสินค้า','สินค้ารอจำหน่าย'].map(option=>`<option ${data.purpose===option?'selected':''}>${option}</option>`).join('')}</select></div>
      <div class="warehouse-contact-title">ชื่อผู้ติดต่อ/ผู้ดูแลคลัง</div>
      <div class="warehouse-field-row"><label for="wh_contact">ชื่อผู้ติดต่อ/ผู้ดูแล</label><input id="wh_contact" value="${escapeHtml(data.contactName||'')}"></div>
      <div class="warehouse-field-row"><label for="wh_email">อีเมล</label><input id="wh_email" type="email" value="${escapeHtml(data.email||'')}"></div>
      <div class="warehouse-field-row"><label for="wh_phone">เบอร์โทรศัพท์</label><input id="wh_phone" class="phone-input" value="${escapeHtml(data.phone||'')}" inputmode="tel"></div>
      <div class="form-bottom-actions form-final-actions"><button class="btn ghost" id="cancelWarehouseBottomBtn">ยกเลิก</button><button class="btn primary" id="saveWarehouseBottomBtn">บันทึก</button></div>
    </div>
  </div>`;
}

function blankTransferItem(){ return {lineId:transferLineCounter++,productId:'',name:'',qty:1,unit:'',cost:0}; }
function transferDocumentNumber(){ return documentPrefixes.transfer+TODAY_STR.replace(/-/g,'')+String(transferCounter).padStart(4,'0'); }
function transferUnitOptions(product){
  if(!product) return [];
  return [{name:product.unit,cost:Number(product.cost)||0,factor:1},...(product.units||[]).filter(u=>u.sub).map(u=>({name:u.sub,cost:Number(u.cost)||((Number(product.cost)||0)*(Number(u.factor)||1)),factor:Number(u.factor)||1}))];
}
function activeTransferDraft(){
  if(transferDraft) return transferDraft;
  if(editingTransferId==='new'){
    transferDraft={id:transferDocumentNumber(),date:TODAY_STR,transferor:`${currentUserProfile.firstName} ${currentUserProfile.lastName}`.trim(),fromId:Number(activeWarehouseId)||'',toId:'',items:[blankTransferItem()],note:'',internalNote:''};
  }else{
    const old=transfers.find(t=>t.id===editingTransferId);
    if(old){ transferDraft=JSON.parse(JSON.stringify(old)); transferDraft.fromId=transferDraft.fromId||warehouses.find(w=>w.name===old.from)?.id||''; transferDraft.toId=transferDraft.toId||warehouses.find(w=>w.name===old.to)?.id||''; transferDraft.transferor=transferDraft.transferor||`${currentUserProfile.firstName} ${currentUserProfile.lastName}`.trim(); transferDraft.items=(transferDraft.items||[]).map(item=>({...item,lineId:item.lineId||transferLineCounter++,productId:item.productId||products.find(p=>p.name===item.name)?.id||'',unit:item.unit||products.find(p=>p.name===item.name)?.unit||'',cost:Number(item.cost)||0})); }
  }
  return transferDraft;
}
function transferItemRowHtml(item,index){
  const product=products.find(p=>p.id===Number(item.productId))||products.find(p=>p.name===item.name);
  const unitOptions=transferUnitOptions(product);
  const unit=item.unit||product?.unit||'';
  return `<tr data-transfer-line="${item.lineId}">
    <td class="mono" style="text-align:center;">${index+1}</td>
    <td><input class="transfer-product" value="${escapeHtml(item.name||'')}" placeholder="พิมพ์แก้ไขชื่อสินค้า" autocomplete="off"></td>
    <td><input class="transfer-number transfer-qty" type="number" min="0.01" step="any" value="${Number(item.qty)||1}" style="width:90px;"></td>
    <td><select class="transfer-unit"><option value="">เลือกหน่วย</option>${unitOptions.map(u=>`<option value="${escapeHtml(u.name)}" ${unit===u.name?'selected':''}>${escapeHtml(u.name)}</option>`).join('')}${!unitOptions.length&&unit?`<option selected>${escapeHtml(unit)}</option>`:''}</select></td>
    <td style="text-align:center;"><button class="transfer-remove" type="button" title="ลบรายการ">×</button></td>
  </tr>`;
}

function renderTransfer(){
  if(editingTransferId!==null) return renderTransferForm();
  return `<div class="rpt"><div class="pagehead"><div><h1>โอนสินค้าระหว่างคลัง</h1></div><div class="transfer-list-actions"><button class="btn primary" id="newTransferBtn">+ สร้างรายการโอน</button></div></div>
  <div class="doc-list-wrap seamless-table-wrap"><table class="grid-table doc-head-blue transfer-summary-table"><thead><tr><th>เลขที่</th><th>วันที่</th><th>จากคลัง</th><th>ไปคลัง</th><th>รายการ</th><th>สถานะ</th><th></th></tr></thead>
  <tbody>${transfers.map(t=>{
    const cancelled=t.status==='ยกเลิก';
    const stockAction=documentHasPostedStock('transfer',t)?'':(cancelled?`<button class="history-icon-btn danger" data-delete-transfer="${escapeHtml(t.id)}" title="ลบออกจากระบบถาวร" aria-label="ลบรายการโอน ${escapeHtml(t.id)} ออกจากระบบถาวร"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`:`<button class="history-icon-btn danger" data-cancel-transfer="${escapeHtml(t.id)}" title="ยกเลิกรายการ" aria-label="ยกเลิกรายการ ${escapeHtml(t.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`);
    return `<tr><td class="mono">${escapeHtml(t.id)}</td><td>${escapeHtml(fmtDate(t.date))}</td><td>${escapeHtml(t.from)}</td><td>${escapeHtml(t.to)}</td><td>${expandableDocumentItemsPreview('transfer',t.id,t.items)}</td><td><span class="badge ${cancelled?'danger':'ok'}">${cancelled?'ยกเลิก':'บันทึกแล้ว'}</span></td><td class="num"><div class="transfer-list-actions"><button class="history-icon-btn" data-edit-transfer="${escapeHtml(t.id)}" title="แก้ไข" aria-label="แก้ไข ${escapeHtml(t.id)}" ${cancelled?'disabled':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="history-icon-btn" data-print-transfer="${escapeHtml(t.id)}" title="พิมพ์เอกสาร" aria-label="พิมพ์ใบโอน ${escapeHtml(t.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg></button>${stockAction}</div></td></tr>${expandableDocumentItemsDetailRow('transfer',t.id,t.items,7)}`;
  }).join('')||'<tr><td colspan="7" style="padding:30px;text-align:center;color:var(--text-muted);">ยังไม่มีรายการโอนสินค้า</td></tr>'}</tbody></table></div></div>`;
}
function stockControlAnomalyRows(productList=products,lotRows=inventoryLotRows,warehouseId=activeWarehouseId){
  const targetWarehouse=Number(warehouseId);
  const lotTotals=new Map();
  const expiredByProduct=new Map();
  const today=currentDateStr();
  (lotRows||[]).forEach(lot=>{
    if(Number(lot.warehouse_id)!==targetWarehouse||Number(lot.quantity_base)<=0||lot.status==='blocked') return;
    const productId=Number(lot.product_id);
    lotTotals.set(productId,(lotTotals.get(productId)||0)+Number(lot.quantity_base));
    if(lot.expiry_date&&String(lot.expiry_date)<today){
      const rows=expiredByProduct.get(productId)||[];
      rows.push(lot); expiredByProduct.set(productId,rows);
    }
  });
  const anomalies=[];
  (productList||[]).forEach(product=>{
    const balance=Number(warehouseStock(product.id,targetWarehouse))||0;
    const lotStock=Number(lotTotals.get(Number(product.id))||0);
    if(balance<0){
      anomalies.push({product,type:'ยอดติดลบ',balance,lotStock,detail:'ยอดคงเหลือในระบบต่ำกว่า 0 ต้องตรวจนับจำนวนจริง'});
    }else if(Math.abs(balance-lotStock)>0.000001){
      anomalies.push({product,type:'ยอดไม่ตรงกับ LOT',balance,lotStock,detail:`ยอดรวม LOT ${inspectionListAmount(lotStock)} ${product.unit||''} ไม่ตรงกับยอดคงเหลือ`});
    }
    const expiredLots=expiredByProduct.get(Number(product.id))||[];
    if(expiredLots.length){
      const expiredQty=expiredLots.reduce((sum,lot)=>sum+Number(lot.quantity_base||0),0);
      anomalies.push({product,type:'LOT หมดอายุยังมีสินค้า',balance,lotStock,detail:`${expiredLots.length} LOT · รวม ${inspectionListAmount(expiredQty)} ${product.unit||''}`});
    }
  });
  return anomalies;
}

function stockControlOpenAdjustmentForProduct(id){
  const product=products.find(entry=>entry.id===Number(id));
  if(!product) return false;
  if(!stockEditItems.includes(product.id)) stockEditItems.unshift(product.id);
  if(stockEditRequiresReconciliation(product)) stockEditDraftStocks[product.id]=Number(product.stock)||0;
  stockEditPage=1;
  stockControlMode='adjust';
  render();
  setTimeout(()=>document.querySelector(`[data-stock-edit-amount="${product.id}"]`)?.focus(),30);
  return true;
}

function renderStockControlAnomalies(){
  const anomalies=stockControlAnomalyRows();
  const negativeCount=anomalies.filter(row=>row.type==='ยอดติดลบ').length;
  const mismatchCount=anomalies.filter(row=>row.type==='ยอดไม่ตรงกับ LOT').length;
  const expiredCount=anomalies.filter(row=>row.type==='LOT หมดอายุยังมีสินค้า').length;
  return `<div class="rpt"><div class="stock-control-anomaly-summary"><div class="stock-control-anomaly-card"><span>ยอดติดลบ</span><b>${negativeCount}</b></div><div class="stock-control-anomaly-card"><span>ยอดไม่ตรงกับ LOT</span><b>${mismatchCount}</b></div><div class="stock-control-anomaly-card"><span>LOT หมดอายุยังมีสินค้า</span><b>${expiredCount}</b></div></div>
    <div class="doc-list-wrap seamless-table-wrap"><table class="grid-table doc-head-blue"><thead><tr><th>รหัสสินค้า</th><th>สินค้า</th><th>ประเภท</th><th>รายละเอียด</th><th>คงเหลือ</th><th></th></tr></thead><tbody>${anomalies.map(row=>`<tr><td class="mono" style="text-align:center;">${escapeHtml(row.product.sku||'-')}</td><td>${escapeHtml(row.product.name)}</td><td style="text-align:center;"><span class="stock-control-anomaly-type">${escapeHtml(row.type)}</span></td><td>${escapeHtml(row.detail)}</td><td class="mono" style="text-align:center;">${inspectionListAmount(row.balance)} ${escapeHtml(row.product.unit||'')}</td><td style="text-align:center;"><button class="btn ghost small" data-stock-control-review="${row.product.id}">เปิดตรวจนับ</button></td></tr>`).join('')||'<tr><td colspan="6" style="padding:34px;text-align:center;color:var(--text-muted);">ไม่พบความผิดปกติของสต๊อกในคลังนี้</td></tr>'}</tbody></table></div>
  </div>`;
}

function stockLotReallocationPayload(groups,targets={},factor=1){
  factor=Number(factor)>0?Number(factor):1;
  const payload=[];
  (groups||[]).forEach((group,groupIndex)=>{
    const rows=(group.rows||[]).slice().sort((a,b)=>Number(a.id)-Number(b.id));
    const rawTarget=targets[group.key]??targets[groupIndex]??stockLotReallocationDisplayQuantity(group.quantityBase,factor);
    const displayTarget=Number(rawTarget);
    const target=inventoryMovementRound(displayTarget*factor);
    if(!Number.isFinite(displayTarget)||displayTarget<0||!Number.isFinite(target)||target<0){
      rows.forEach(row=>payload.push({lotId:Number(row.id),expectedQuantity:Number(row.quantity_base)||0,newQuantity:NaN}));
      return;
    }
    const values=rows.map(row=>Number(row.quantity_base)||0);
    let delta=inventoryMovementRound(target-values.reduce((sum,value)=>sum+value,0));
    if(delta>0&&values.length){
      values[0]=inventoryMovementRound(values[0]+delta);
    }else if(delta<0){
      let remove=Math.abs(delta);
      for(let index=values.length-1;index>=0&&remove>0.000001;index--){
        const taken=Math.min(remove,values[index]);
        values[index]=inventoryMovementRound(values[index]-taken);
        remove=inventoryMovementRound(remove-taken);
      }
      if(remove>0.000001) values[0]=NaN;
    }
    rows.forEach((row,index)=>payload.push({
      lotId:Number(row.id),
      expectedQuantity:Number(row.quantity_base)||0,
      newQuantity:values[index]
    }));
  });
  return payload;
}

function stockLotReallocationSummary(groups,targets={},factor=1){
  const payload=stockLotReallocationPayload(groups,targets,factor);
  const oldTotal=inventoryMovementRound(payload.reduce((sum,row)=>sum+(Number(row.expectedQuantity)||0),0));
  const valid=payload.length>0&&payload.every(row=>Number.isFinite(row.newQuantity)&&row.newQuantity>=0);
  const newTotal=valid?inventoryMovementRound(payload.reduce((sum,row)=>sum+row.newQuantity,0)):NaN;
  const changes=valid?payload.filter(row=>Math.abs(row.newQuantity-row.expectedQuantity)>0.000001):[];
  return {payload,oldTotal,newTotal,valid,changes,changedCount:changes.length,balanced:valid&&Math.abs(newTotal-oldTotal)<=0.000001};
}

function stockLotReallocationDisplayQuantity(baseQuantity,factor=1){
  const safeFactor=Number(factor)>0?Number(factor):1;
  return inventoryMovementRound((Number(baseQuantity)||0)/safeFactor);
}

function stockLotReallocationUnitOptions(product){
  const seen=new Set();
  return productUnitOptions(product).filter(option=>{
    const name=String(option?.name||'').trim();
    const factor=Number(option?.factor);
    if(!name||!Number.isFinite(factor)||factor<=0||seen.has(name)) return false;
    seen.add(name);
    return true;
  }).map(option=>({name:String(option.name),factor:Number(option.factor)}));
}

function stockLotReallocationDifferenceHtml(value){
  const difference=inventoryMovementRound(value);
  const className=difference>0?'in':difference<0?'out':'same';
  const prefix=difference>0?'+':'';
  return `<span class="stock-lot-reallocation-diff ${className}">${prefix}${inspectionListAmount(difference)}</span>`;
}

function stockLotReallocationRows(){
  const needle=stockLotReallocationSearch.trim().toLowerCase();
  return products.map(product=>{
    const lots=activeInventoryLotsForProduct(product.id,activeWarehouseId);
    const groups=groupInventoryLotDetailRows(lots);
    return {product,lots,groups,total:groups.reduce((sum,group)=>sum+Number(group.quantityBase||0),0)};
  }).filter(row=>row.groups.length>=2&&(!needle||String(row.product.name||'').toLowerCase().includes(needle)||String(row.product.sku||'').toLowerCase().includes(needle)||matchesBarcode(row.product,needle)))
    .sort((a,b)=>String(a.product.name||'').localeCompare(String(b.product.name||''),'th'));
}

function renderStockLotReallocation(){
  if(currentProfile?.owner!==true) return '<div class="rpt"><div style="padding:40px;text-align:center;color:var(--text-muted);">เฉพาะเจ้าของร้าน Level 1 เท่านั้นที่ปรับจำนวนแยกตาม LOT ได้</div></div>';
  const rows=stockLotReallocationRows();
  const totalPages=Math.max(1,Math.ceil(rows.length/STOCK_LOT_REALLOCATION_PAGE_SIZE));
  stockLotReallocationPage=Math.min(totalPages,Math.max(1,Number(stockLotReallocationPage)||1));
  const start=(stockLotReallocationPage-1)*STOCK_LOT_REALLOCATION_PAGE_SIZE;
  const pageRows=rows.slice(start,start+STOCK_LOT_REALLOCATION_PAGE_SIZE);
  return `<div class="rpt"><div class="stock-lot-reallocation-search"><input id="stockLotReallocationSearch" value="${escapeHtml(stockLotReallocationSearch)}" placeholder="ค้นหาจากชื่อ / รหัส / บาร์โค้ด..." autocomplete="off"></div>
    <div class="doc-list-wrap seamless-table-wrap"><table class="grid-table doc-head-blue"><thead><tr><th>รหัสสินค้า</th><th>สินค้า</th><th>คงเหลือรวม</th><th>จำนวน LOT</th><th>หมดอายุใกล้สุด</th><th></th></tr></thead><tbody>${pageRows.map(row=>{
      const nearest=row.groups.map(group=>group.expiryDate).filter(Boolean).sort()[0]||'';
      return `<tr><td class="mono" style="text-align:center;">${escapeHtml(row.product.sku||'-')}</td><td>${escapeHtml(row.product.name)}</td><td style="text-align:center;">${escapeHtml(stockInLargestUnit({...row.product,stock:row.total}))}</td><td style="text-align:center;">${row.groups.length} LOT</td><td style="text-align:center;">${escapeHtml(nearest?fmtDateShort(nearest):'-')}</td><td style="text-align:center;"><button type="button" class="btn primary small" data-stock-lot-reallocation="${row.product.id}">ปรับจำนวน LOT</button></td></tr>`;
    }).join('')||'<tr><td colspan="6" style="padding:38px;text-align:center;color:var(--text-muted);">ไม่พบสินค้าที่มีอย่างน้อย 2 LOT ในคลังนี้</td></tr>'}</tbody></table></div>
    ${pagerHtml(stockLotReallocationPage,totalPages,'stock-lot-page')}
  </div>`;
}

async function openStockLotReallocation(productId){
  if(currentProfile?.owner!==true){ showToast('เฉพาะเจ้าของร้าน Level 1 เท่านั้น','danger-top'); return; }
  if(isAllWarehousesMode()){ showToast('กรุณาเลือกคลังที่ต้องการปรับจาก TOPBAR ก่อน','danger-top'); return; }
  const product=products.find(item=>Number(item.id)===Number(productId));
  if(!product) return;
  let lots=[],balance=warehouseStock(product.id,activeWarehouseId);
  try{
    const [lotsResult,balanceResult]=await Promise.all([
      sb.from('inventory_lots').select(INVENTORY_LOT_DETAIL_COLUMNS).eq('product_id',product.id).eq('warehouse_id',Number(activeWarehouseId)).gt('quantity_base',0).neq('status','blocked').order('expiry_date',{ascending:true,nullsFirst:false}).order('received_at').order('id'),
      sb.from('inventory_balances').select('stock').eq('product_id',product.id).eq('warehouse_id',Number(activeWarehouseId)).maybeSingle()
    ]);
    if(lotsResult.error) throw lotsResult.error;
    if(balanceResult.error) throw balanceResult.error;
    lots=(lotsResult.data||[]).map(normalizeInventoryLotRow);
    balance=Number(balanceResult.data?.stock)||0;
  }catch(error){ console.warn('load Lots for reallocation',error); showToast('โหลดข้อมูล LOT ไม่สำเร็จ','danger-top'); return; }
  const groups=groupInventoryLotDetailRows(lots);
  if(groups.length<2){ showToast('สินค้านี้ต้องมีอย่างน้อย 2 LOT ที่มีสินค้า','danger-top'); return; }
  const oldTotal=inventoryMovementRound(lots.reduce((sum,lot)=>sum+Number(lot.quantity_base||0),0));
  if(Math.abs(oldTotal-balance)>0.000001){ showToast('ยอดรวม LOT ไม่ตรงกับสต๊อก กรุณาแก้จากรายการผิดปกติก่อน','danger-top'); return; }
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  const unitOptions=stockLotReallocationUnitOptions(product);
  let selectedUnit=unitOptions[0]||{name:product.unit||'หน่วย',factor:1};
  overlay.innerHTML=`<div class="modal stock-lot-reallocation-modal"><div class="modal-head"><div><h3>ปรับจำนวนแยกตาม LOT</h3><div class="sub">${escapeHtml(product.name)} · ${escapeHtml(activeWarehouse()?.name||'-')}</div></div><button class="modal-close" type="button" aria-label="ปิด">×</button></div><div class="stock-lot-reallocation-body">
    <div class="stock-lot-reallocation-notice" id="stockLotReallocationNotice">กรอกจำนวนที่ตรวจพบจริงของแต่ละ LOT ผลรวมใหม่ต้องเท่ากับ <b>${inspectionListAmount(oldTotal)} ${escapeHtml(selectedUnit.name)}</b> ระบบจึงจะยืนยันได้</div>
    <div class="stock-lot-reallocation-unit-control"><label for="stockLotReallocationUnit">หน่วยที่ใช้ปรับ</label><select id="stockLotReallocationUnit">${unitOptions.map(option=>`<option value="${escapeHtml(option.name)}">${escapeHtml(option.name)}${option.factor===1?'':` (1 ${escapeHtml(option.name)} = ${inspectionListAmount(option.factor)} ${escapeHtml(product.unit||'หน่วย')})`}</option>`).join('')}</select></div>
    <div class="seamless-table-wrap"><table class="grid-table doc-head-blue stock-lot-reallocation-table"><thead><tr><th>เลข LOT ผู้ผลิต</th><th>วันหมดอายุ</th><th id="stockLotOldQuantityHead">จำนวนเดิม (${escapeHtml(selectedUnit.name)})</th><th id="stockLotNewQuantityHead">จำนวนใหม่ (${escapeHtml(selectedUnit.name)})</th><th>ส่วนต่าง</th></tr></thead><tbody>${groups.map((group,index)=>`<tr><td>${escapeHtml(group.manufacturerLot||'ไม่ระบุ')}</td><td>${escapeHtml(group.expiryDate?fmtDateShort(group.expiryDate):'-')}</td><td class="mono" data-stock-lot-old="${index}">${inspectionListAmount(group.quantityBase)}</td><td><input class="stock-lot-reallocation-input" data-stock-lot-group="${index}" type="number" min="0" step="any" value="${group.quantityBase}"></td><td data-stock-lot-difference="${index}">${stockLotReallocationDifferenceHtml(0)}</td></tr>`).join('')}</tbody></table></div>
    <div class="stock-lot-reallocation-summary"><div><span>ยอดรวมเดิม</span><b id="stockLotOldTotal">${inspectionListAmount(oldTotal)} ${escapeHtml(selectedUnit.name)}</b></div><div><span>ยอดรวมใหม่</span><b id="stockLotNewTotal">${inspectionListAmount(oldTotal)} ${escapeHtml(selectedUnit.name)}</b></div><div><span>ผลต่างรวม</span><b id="stockLotTotalDifference">0 ${escapeHtml(selectedUnit.name)}</b></div></div>
    <div class="stock-lot-reallocation-actions"><button type="button" class="btn ghost" id="cancelStockLotReallocation">ยกเลิก</button><button type="button" class="btn primary" id="confirmStockLotReallocation" disabled>ยืนยันปรับจำนวน LOT</button></div>
  </div></div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#cancelStockLotReallocation').onclick=close;
  overlay.addEventListener('click',event=>{ if(event.target===overlay) close(); });
  const confirmButton=overlay.querySelector('#confirmStockLotReallocation');
  const unitSelect=overlay.querySelector('#stockLotReallocationUnit');
  const readTargets=()=>{
    const targets={};
    overlay.querySelectorAll('[data-stock-lot-group]').forEach(input=>{ targets[groups[Number(input.dataset.stockLotGroup)]?.key]=input.value; });
    return targets;
  };
  const refresh=()=>{
    const targets=readTargets();
    const factor=selectedUnit.factor;
    groups.forEach((group,index)=>{
      const value=Number(targets[group.key]);
      const cell=overlay.querySelector(`[data-stock-lot-difference="${index}"]`);
      const oldDisplay=stockLotReallocationDisplayQuantity(group.quantityBase,factor);
      if(cell) cell.innerHTML=Number.isFinite(value)?stockLotReallocationDifferenceHtml(value-oldDisplay):stockLotReallocationDifferenceHtml(0);
    });
    const summary=stockLotReallocationSummary(groups,targets,factor);
    const totalNode=overlay.querySelector('#stockLotNewTotal');
    const differenceNode=overlay.querySelector('#stockLotTotalDifference');
    const displayNewTotal=stockLotReallocationDisplayQuantity(summary.newTotal,factor);
    const displayDifference=stockLotReallocationDisplayQuantity(summary.newTotal-summary.oldTotal,factor);
    if(totalNode) totalNode.textContent=summary.valid?`${inspectionListAmount(displayNewTotal)} ${selectedUnit.name}`:'กรอกจำนวนให้ถูกต้อง';
    if(differenceNode) differenceNode.textContent=summary.valid?`${displayDifference>0?'+':''}${inspectionListAmount(displayDifference)} ${selectedUnit.name}`:'-';
    confirmButton.disabled=!(summary.balanced&&summary.changedCount>=2);
  };
  unitSelect.addEventListener('change',()=>{
    const currentTargets=readTargets();
    const currentSummary=stockLotReallocationSummary(groups,currentTargets,selectedUnit.factor);
    if(!currentSummary.valid){ unitSelect.value=selectedUnit.name; showToast('กรุณากรอกจำนวน LOT ให้ถูกต้องก่อนเปลี่ยนหน่วย','danger-top'); return; }
    const baseTargets={};
    groups.forEach((group,index)=>{ baseTargets[group.key]=inventoryMovementRound(Number(currentTargets[group.key]??currentTargets[index])*selectedUnit.factor); });
    selectedUnit=unitOptions.find(option=>option.name===unitSelect.value)||unitOptions[0]||selectedUnit;
    groups.forEach((group,index)=>{
      const oldNode=overlay.querySelector(`[data-stock-lot-old="${index}"]`);
      const input=overlay.querySelector(`[data-stock-lot-group="${index}"]`);
      if(oldNode) oldNode.textContent=inspectionListAmount(stockLotReallocationDisplayQuantity(group.quantityBase,selectedUnit.factor));
      if(input) input.value=String(stockLotReallocationDisplayQuantity(baseTargets[group.key],selectedUnit.factor));
    });
    overlay.querySelector('#stockLotOldQuantityHead').textContent=`จำนวนเดิม (${selectedUnit.name})`;
    overlay.querySelector('#stockLotNewQuantityHead').textContent=`จำนวนใหม่ (${selectedUnit.name})`;
    overlay.querySelector('#stockLotOldTotal').textContent=`${inspectionListAmount(stockLotReallocationDisplayQuantity(oldTotal,selectedUnit.factor))} ${selectedUnit.name}`;
    overlay.querySelector('#stockLotReallocationNotice').innerHTML=`กรอกจำนวนที่ตรวจพบจริงของแต่ละ LOT ผลรวมใหม่ต้องเท่ากับ <b>${inspectionListAmount(stockLotReallocationDisplayQuantity(oldTotal,selectedUnit.factor))} ${escapeHtml(selectedUnit.name)}</b> ระบบจึงจะยืนยันได้`;
    refresh();
  });
  overlay.querySelectorAll('[data-stock-lot-group]').forEach(input=>input.addEventListener('input',refresh));
  confirmButton.onclick=async()=>{
    const summary=stockLotReallocationSummary(groups,readTargets(),selectedUnit.factor);
    if(!summary.balanced||summary.changedCount<2){ showToast('ยอดรวมใหม่ต้องเท่ากับยอดเดิม และต้องมีอย่างน้อย 2 LOT ที่เปลี่ยน','danger-top'); return; }
    confirmButton.disabled=true; confirmButton.textContent='กำลังบันทึก...';
    try{
      const data=await runStockOperation('reallocate_inventory_lots',{productId:product.id,warehouseId:Number(activeWarehouseId),reason:AUTOMATIC_LOT_REALLOCATION_REASON,lots:summary.payload});
      await Promise.all([loadInventoryBalancesFromSupabase(),loadInventoryLotsFromSupabase()]);
      close(); render(); showToast(`ปรับจำนวนแยกตาม LOT เรียบร้อย · ${data?.referenceId||''}`);
    }catch(error){ console.warn('reallocate inventory Lots',error); confirmButton.disabled=false; confirmButton.textContent='ยืนยันปรับจำนวน LOT'; showToast(error?.message||'ปรับจำนวน LOT ไม่สำเร็จ กรุณาโหลดข้อมูลใหม่','danger-top'); }
  };
}

function renderStockControl(){
  if(!['count','adjust','anomalies','lots'].includes(stockControlMode)) stockControlMode='count';
  const pendingCount=inspectionLists.filter(inspectionListAvailableForStockEdit).length;
  const anomalyCount=stockControlAnomalyRows().length;
  const content=stockControlMode==='count'?renderInspectionLists():stockControlMode==='adjust'?renderStockEdit():stockControlMode==='lots'?renderStockLotReallocation():renderStockControlAnomalies();
  return `<div class="stock-control-page"><div class="stock-control-tabs" role="tablist" aria-label="งานตรวจนับและปรับสต๊อก">
      <button type="button" class="stock-control-tab ${stockControlMode==='count'?'active':''}" data-stock-control-mode="count" role="tab" aria-selected="${stockControlMode==='count'}">ตรวจนับสินค้า</button>
      <button type="button" class="stock-control-tab ${stockControlMode==='adjust'?'active':''}" data-stock-control-mode="adjust" role="tab" aria-selected="${stockControlMode==='adjust'}">รอยืนยันปรับสต๊อก <span class="stock-control-tab-count">${pendingCount}</span></button>
      <button type="button" class="stock-control-tab ${stockControlMode==='anomalies'?'active':''}" data-stock-control-mode="anomalies" role="tab" aria-selected="${stockControlMode==='anomalies'}">รายการผิดปกติ <span class="stock-control-tab-count">${anomalyCount}</span></button>
      ${currentProfile?.owner?`<button type="button" class="stock-control-tab ${stockControlMode==='lots'?'active':''}" data-stock-control-mode="lots" role="tab" aria-selected="${stockControlMode==='lots'}">ปรับจำนวนแยกตาม LOT</button>`:''}
    </div><div class="stock-control-content">${content}</div></div>`;
}

function stockEditCurrentProducts(){
  return stockEditItems.map(id=>products.find(p=>p.id===id)).filter(Boolean);
}

function stockEditInspectionSourceList(){
  return inspectionLists.find(list=>String(list.id)===String(stockEditSourceInspectionListId))||null;
}

function inspectionListAvailableForStockEdit(list){
  return Boolean(list)&&!String(list.stockAdjustedAt||'').trim()&&Number(list.warehouseId||activeWarehouseId)===Number(activeWarehouseId);
}

function stockEditImportInspectionList(listId,askBeforeReplace=true){
  const list=inspectionLists.find(entry=>String(entry.id)===String(listId));
  if(!list){ showToast('ไม่พบรายการตรวจสินค้า','danger'); return false; }
  if(Number(list.warehouseId||activeWarehouseId)!==Number(activeWarehouseId)){ showToast(`รายการนี้เป็นของคลัง ${whName(Number(list.warehouseId))} กรุณาเปลี่ยนคลังที่ TOPBAR ก่อน`,'danger'); return false; }
  if(!inspectionListAvailableForStockEdit(list)){ showToast('รายการนี้แก้ไขจำนวนเรียบร้อยแล้ว ไม่สามารถดึงซ้ำได้','danger'); return false; }
  const entries=(list.items||[]).map(item=>({item,product:products.find(product=>product.id===Number(item.pid))})).filter(entry=>entry.product);
  if(!entries.length){ showToast('รายการตรวจสินค้านี้ไม่มีสินค้าที่ใช้งานได้','danger'); return false; }
  if(askBeforeReplace&&(stockEditItems.length||Object.keys(stockEditDraftStocks).length)&&!confirm('ข้อมูลในหน้าแก้ไขสต๊อกปัจจุบันจะถูกแทนที่ด้วยรายการตรวจสินค้าที่เลือก ต้องการดำเนินการต่อหรือไม่?')) return false;
  stockEditItems=entries.map(entry=>entry.product.id);
  stockEditRowUnitSel={};
  entries.forEach(({item,product})=>{
    const unitNames=[product.unit,...(product.units||[]).map(unit=>unit.sub).filter(Boolean)];
    stockEditRowUnitSel[product.id]=unitNames.includes(item.unit)?item.unit:product.unit;
  });
  stockEditDraftStocks={};
  stockEditSearchQuery='';
  stockEditCatFilter={category:'',brand:''};
  stockEditPage=1;
  stockEditSourceInspectionListId=list.id;
  stockEditSourcePending=true;
  stockControlMode='adjust';
  showToast(`ดึงข้อมูลจาก “${list.name}” แล้ว ${entries.length} รายการ`);
  render();
  return true;
}

function stockEditMarkInspectionComplete(posted={}){
  const list=stockEditInspectionSourceList();
  if(!list||!stockEditSourcePending) return false;
  const now=posted.postedAt||new Date().toISOString();
  list.stockAdjustedAt=now;
  list.stockAdjustedBy=posted.operatorName||currentProfile?.firstName||currentProfile?.username||'';
  if(posted.documentNo) list.stockAdjustmentDocumentNo=posted.documentNo;
  list.updatedAt=now;
  stockEditSourcePending=false;
  return true;
}

function stockEditAvailableLots(productId,warehouseId=activeWarehouseId){
  return (inventoryLotRows||[]).filter(lot=>Number(lot.product_id)===Number(productId)&&Number(lot.warehouse_id)===Number(warehouseId)&&Number(lot.quantity_base)>0&&lot.status!=='blocked');
}

function stockEditLotTotal(productId,warehouseId=activeWarehouseId){
  return stockEditAvailableLots(productId,warehouseId).reduce((sum,lot)=>sum+Number(lot.quantity_base||0),0);
}

function stockEditRequiresReconciliation(product,warehouseId=activeWarehouseId){
  return !!product&&Math.abs((Number(product.stock)||0)-stockEditLotTotal(product.id,warehouseId))>0.000001;
}

function stockEditDefaultLotSelection(product,difference){
  const lots=stockEditAvailableLots(product.id);
  if(difference<0) return 'auto';
  return lots.length?`lot:${lots[0].id}`:'new';
}

function stockEditAdjustmentLines(changes=stockEditPendingChanges()){
  return changes.map(({product,newStock})=>{
    const difference=Number(newStock)-Number(product.stock);
    const lotDifference=Number(newStock)-stockEditLotTotal(product.id);
    const selection=Math.abs(lotDifference)>0.000001
      ? (stockEditLotSelections[product.id]||stockEditDefaultLotSelection(product,lotDifference))
      : '';
    const selectedLotId=selection.startsWith('lot:')?Number(selection.slice(4)):null;
    return {
      productId:product.id,
      expectedStock:Number(product.stock),
      targetStock:Number(newStock),
      unitName:stockEditRowUnitSel[product.id]||product.unit||'',
      selectedLotId:Number.isFinite(selectedLotId)?selectedLotId:null,
      lotNumber:selection==='new'?(stockEditNewLotNumbers[product.id]||''):'',
      expiry:selection==='new'?(stockEditNewLotExpiries[product.id]||product.expiry||''):''
    };
  });
}

async function confirmStockEditChanges(){
  if(stockEditPosting) return false;
  const changes=stockEditPendingChanges();
  if(!changes.length&&!stockEditSourcePending) return false;
  if(changes.some(change=>Number(change.newStock)<0)){ showToast('จำนวนหลังตรวจนับต้องไม่ต่ำกว่า 0','danger'); return false; }
  if(typeof document!=='undefined'&&document.querySelector('[data-stock-edit-new-expiry].stock-edit-invalid,[data-mobile-stock-new-expiry].invalid')){ showToast('กรุณากรอกวันหมดอายุเป็น วัน/เดือน/ปี หรือเว้นว่าง','danger'); return false; }
  const linePayload=stockEditAdjustmentLines(changes);
  const sourceList=stockEditInspectionSourceList();
  const summary=changes.length?`${changes.length} รายการ`:'ไม่พบส่วนต่าง (ปิดงานตรวจนับ)';
  if(!confirm(`ยืนยันบันทึกผลตรวจนับ ${summary}\nผู้ดำเนินการ: ${currentProfile?.firstName||currentProfile?.username||'-'}\n\nเมื่อยืนยันแล้ว ระบบจะบันทึกสต๊อกและ LOT พร้อมกัน`)) return false;
  stockEditPosting=true; render();
  try{
    const data=await runStockOperation('post_inventory_count_adjustment_with_shortages',{
      warehouseId:Number(activeWarehouseId),reason:AUTOMATIC_STOCK_ADJUSTMENT_REASON,note:'',
      sourceInspectionId:sourceList?.id||null,lines:linePayload
    });
    (data?.balances||[]).forEach(balance=>updateInventoryBalanceLocal(balance.productId,balance.warehouseId,balance.stock));
    await loadInventoryLotsFromSupabase();
    const completedInspectionList=stockEditMarkInspectionComplete(data||{});
    stockEditDraftStocks={};
    stockEditLotSelections={};
    stockEditNewLotNumbers={};
    stockEditNewLotExpiries={};
    persistWorkspaceData();
    if(completedInspectionList) await syncInspectionListsToSupabase();
    showToast(`บันทึกผลตรวจนับ ${data?.documentNo||''} แล้ว${changes.length?` · ปรับ ${changes.length} รายการ`:' · ยอดตรงกับระบบ'}`);
    return true;
  }catch(error){
    console.warn('post inventory count adjustment failed',error);
    const message=String(error?.message||'');
    if(message.includes('stock changed before confirmation')) showToast('สต๊อกมีการเปลี่ยนแปลงจากอุปกรณ์อื่น กรุณารีเฟรชและตรวจนับใหม่','danger');
    else showToast(`บันทึกผลตรวจนับไม่สำเร็จ${message?`: ${message}`:''}`,'danger');
    return false;
  }finally{
    stockEditPosting=false;
    render();
  }
}
