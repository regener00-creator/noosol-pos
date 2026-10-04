async function saveWarehouse(){
  const get=id=>(document.getElementById(id)?.value||'').trim();
  const name=get('wh_name'),purpose=get('wh_purpose');
  if(!name){ showToast('กรุณากรอกชื่อคลังสินค้า'); document.getElementById('wh_name')?.focus(); return; }
  if(!purpose){ showToast('กรุณาเลือกจุดประสงค์การใช้งาน'); document.getElementById('wh_purpose')?.focus(); return; }
  if(warehouses.some(w=>w.id!==editingWarehouseId&&w.name.toLowerCase()===name.toLowerCase())){ showToast('มีชื่อคลังสินค้านี้อยู่แล้ว'); return; }
  const data={name,code:get('wh_code'),address:get('wh_address'),postcode:get('wh_postcode'),purpose,contactName:get('wh_contact'),email:get('wh_email'),phone:get('wh_phone')};
  const existing=editingWarehouseId!==null?warehouses.find(w=>w.id===editingWarehouseId):null;
  if(editingWarehouseId!==null&&!existing) return;
  const requestedId=existing?.id??null;
  const nextData={
    ...data,
    code:data.code||existing?.code||(requestedId?`${documentPrefixes.warehouse}-${String(requestedId).padStart(3,'0')}`:''),
  };
  const buttons=['saveWarehouseBtn','saveWarehouseBottomBtn'].map(id=>document.getElementById(id)).filter(Boolean);
  buttons.forEach(button=>{ button.disabled=true; });
  try{
    const {data:savedRow,error}=await sb.rpc('owner_upsert_warehouse',{
      p_id:requestedId,
      p_name:name,
      p_data:nextData,
    });
    if(error) throw error;
    const saved=rowToWarehouse(savedRow||{});
    if(!Number(saved.id)) throw new Error('ระบบไม่ได้ส่งรหัสคลังสินค้ากลับมา');
    if(!saved.code) saved.code=`${documentPrefixes.warehouse}-${String(saved.id).padStart(3,'0')}`;
    if(existing){
      const oldName=existing.name;
      Object.assign(existing,saved);
      transfers.forEach(doc=>{ if(Number(doc.fromId)===existing.id||doc.from===oldName) doc.from=name; if(Number(doc.toId)===existing.id||doc.to===oldName) doc.to=name; });
      persistTransfers();
      showToast(`บันทึกข้อมูลคลังสินค้า “${name}” แล้ว`);
    }else{
      warehouses.push(saved);
      showToast(`เพิ่มคลังสินค้า “${name}” แล้ว`);
    }
    nextWarehouseId=maxArrayValue(warehouses,w=>(Number(w.id)||0)+1,1);
    seedTableSnapshot('warehouses',warehouses,warehouseToRow);
    persistWarehouses(); addingWarehouse=false; editingWarehouseId=null; render();
  }catch(error){
    console.warn('save warehouse',error);
    showToast(error?.message||'บันทึกคลังสินค้าไม่สำเร็จ กรุณาลองใหม่','danger-top');
    buttons.forEach(button=>{ button.disabled=false; });
  }
}

async function deleteWarehouse(id){
  const warehouse=warehouses.find(w=>w.id===id); if(!warehouse) return;
  const productCount=inventoryBalanceRows.filter(row=>Number(row.warehouse_id)===Number(id)&&Number(row.stock)!==0).length;
  const transferCount=transfers.filter(doc=>doc.status!=='ยกเลิก'&&(Number(doc.fromId)===id||Number(doc.toId)===id||doc.from===warehouse.name||doc.to===warehouse.name)).length;
  if(productCount>0){ showToast(`ลบไม่ได้: มีสินค้าคงเหลือในคลังนี้ ${productCount} รายการ`); return; }
  if(transferCount>0){ showToast(`ลบไม่ได้: คลังนี้มีรายการโอนที่ยังใช้งานอยู่ ${transferCount} รายการ`); return; }
  if(!confirm(`ยืนยันลบคลังสินค้า “${warehouse.name}” ?`)) return;
  try{
    const {data,error}=await sb.rpc('owner_delete_warehouse',{p_id:Number(id)});
    if(error) throw error;
    if(data?.deleted===false){ showToast('ไม่พบคลังสินค้านี้ในระบบ','danger-top'); return; }
    warehouses=warehouses.filter(w=>w.id!==id);
    seedTableSnapshot('warehouses',warehouses,warehouseToRow);
    persistWarehouses(); showToast(`ลบคลังสินค้า “${warehouse.name}” แล้ว`); render();
  }catch(error){
    console.warn('delete warehouse',error);
    showToast(error?.message||'ลบคลังสินค้าไม่สำเร็จ กรุณาลองใหม่','danger-top');
  }
}

function cancelTransfer(id){
  const doc=transfers.find(t=>t.id===id); if(!doc||doc.status==='ยกเลิก') return;
  if(refusePostedDocumentDeletion('transfer',doc)) return;
  if(!confirm(`ยืนยันยกเลิกรายการโอน ${doc.id} ?`)) return;
  doc.status='ยกเลิก'; doc.cancelledAt=new Date().toISOString(); persistTransfers(); showToast(`ยกเลิกรายการโอน ${doc.id} แล้ว`); render();
}

function deleteCancelledTransfer(id){
  const doc=transfers.find(t=>t.id===id); if(!doc||doc.status!=='ยกเลิก') return;
  if(refusePostedDocumentDeletion('transfer',doc)) return;
  if(!confirm(`ยืนยันลบรายการโอน ${doc.id} ออกจากระบบถาวร ?`)) return;
  transfers=transfers.filter(t=>t.id!==id); persistTransfers(); showToast(`ลบรายการโอน ${doc.id} ออกจากระบบแล้ว`); render();
}

function syncTransferFromDOM(){
  if(editingTransferId===null) return;
  const draft=activeTransferDraft();
  const get=id=>document.getElementById(id);
  if(get('transfer_date')){ const iso=dmyToISO(get('transfer_date').value); draft.date=iso||TODAY_STR; }
  if(get('transfer_by')) draft.transferor=get('transfer_by').value.trim();
  if(get('transfer_from')) draft.fromId=Number(get('transfer_from').value)||'';
  if(get('transfer_to')) draft.toId=Number(get('transfer_to').value)||'';
  if(get('transfer_note')) draft.note=get('transfer_note').value;
  if(get('transfer_internal_note')) draft.internalNote=get('transfer_internal_note').value;
  const rows=[...document.querySelectorAll('#transferItemRows tr')];
  if(rows.length){
    draft.items=rows.map(row=>{
      const rawName=row.querySelector('.transfer-product')?.value.trim()||'';
      const product=rawName?(products.find(p=>p.name===rawName)||products.find(p=>p.barcode===rawName||(p.units||[]).some(u=>u.barcode===rawName))):null;
      const scannedUnit=product?(product.barcode===rawName?product.unit:(product.units||[]).find(u=>u.barcode===rawName)?.sub):'';
      const selectedUnit=row.querySelector('.transfer-unit')?.value||scannedUnit||product?.unit||'';
      const unitInfo=transferUnitOptions(product).find(u=>u.name===selectedUnit);
      return {lineId:Number(row.dataset.transferLine)||transferLineCounter++,productId:product?.id||'',name:product?.name||rawName,qty:Number(row.querySelector('.transfer-qty')?.value)||0,unit:selectedUnit,cost:unitInfo?.cost||0};
    });
  }
}

function recalculateTransferDom(){
  let totalQty=0;
  document.querySelectorAll('#transferItemRows tr').forEach(row=>{
    const qty=Number(row.querySelector('.transfer-qty')?.value)||0;
    totalQty+=qty;
  });
  const qtyEl=document.getElementById('transferTotalQty'); if(qtyEl) qtyEl.textContent=totalQty.toLocaleString('th-TH');
}

function bindTransferItemEvents(){
  document.querySelectorAll('#transferItemRows tr').forEach(row=>{
    row.querySelectorAll('.transfer-qty').forEach(input=>input.addEventListener('input',recalculateTransferDom));
    const productInput=row.querySelector('.transfer-product');
    if(productInput) productInput.addEventListener('change',()=>{ syncTransferFromDOM(); render(); });
    const unitSelect=row.querySelector('.transfer-unit');
    if(unitSelect) unitSelect.addEventListener('change',()=>{ syncTransferFromDOM(); const draft=activeTransferDraft(); const item=draft.items.find(x=>x.lineId===Number(row.dataset.transferLine)); const product=products.find(p=>p.id===Number(item?.productId)); if(item&&product) item.cost=transferUnitOptions(product).find(u=>u.name===item.unit)?.cost||0; render(); });
    const remove=row.querySelector('.transfer-remove');
    if(remove) remove.addEventListener('click',()=>{ syncTransferFromDOM(); const draft=activeTransferDraft(); draft.items=draft.items.filter(x=>x.lineId!==Number(row.dataset.transferLine)); if(!draft.items.length) draft.items.push(blankTransferItem()); render(); });
  });
}

async function saveTransfer(silent=false){
  syncTransferFromDOM();
  const draft=activeTransferDraft();
  const previous=transfers.find(item=>item.id===editingTransferId);
  if(previous?.stockApplied){
    if(silent) return previous.id;
    showToast('รายการโอนนี้ลงสต๊อกแล้ว จึงไม่สามารถแก้ไขซ้ำได้');
    return false;
  }
  if(!draft.fromId){ showToast('กรุณาเลือกคลังต้นทาง'); return false; }
  if(!draft.toId){ showToast('กรุณาเลือกคลังปลายทาง'); return false; }
  if(Number(draft.fromId)===Number(draft.toId)){ showToast('คลังต้นทางและปลายทางต้องไม่เหมือนกัน'); return false; }
  const items=(draft.items||[]).filter(item=>item.name&&Number(item.qty)>0);
  if(!items.length){ showToast('กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ'); return false; }
  if(items.some(item=>!products.some(p=>p.id===Number(item.productId)))){ showToast('กรุณาเลือกสินค้าจากรายการสินค้า'); return false; }
  const required=new Map();
  items.forEach(item=>{
    const product=products.find(p=>p.id===Number(item.productId));
    const factor=transferUnitOptions(product).find(option=>option.name===item.unit)?.factor||1;
    required.set(Number(item.productId),(required.get(Number(item.productId))||0)+(Number(item.qty)||0)*factor);
  });
  for(const [productId,quantity] of required){
    if(warehouseStock(productId,draft.fromId)<quantity){
      showToast(`สต๊อกคลังต้นทางไม่พอสำหรับ ${products.find(product=>product.id===productId)?.name||'สินค้าที่เลือก'}`,'danger');
      return false;
    }
  }
  const fromWarehouse=warehouses.find(w=>w.id===Number(draft.fromId));
  const toWarehouse=warehouses.find(w=>w.id===Number(draft.toId));
  const record={id:draft.id,date:draft.date,transferor:draft.transferor,fromId:Number(draft.fromId),toId:Number(draft.toId),from:fromWarehouse?.name||'-',to:toWarehouse?.name||'-',items:items.map(item=>({...item,qty:Number(item.qty),cost:Number(item.cost)||0})),note:draft.note||'',internalNote:draft.internalNote||'',totalQty:items.reduce((s,i)=>s+Number(i.qty),0),totalCost:items.reduce((s,i)=>s+Number(i.qty)*(Number(i.cost)||0),0),status:'บันทึกแล้ว',stockApplied:false};
  if(editingTransferId==='new'){
    transfers.unshift(record); transferCounter++; editingTransferId=record.id;
  }else{
    const index=transfers.findIndex(t=>t.id===editingTransferId); if(index>-1) transfers[index]=record;
  }
  transferDraft=JSON.parse(JSON.stringify(record)); persistTransfers();
  try{
    const {error:upsertError}=await sb.from('transfers').upsert({id:record.id,data:record});
    if(upsertError) throw upsertError;
    const {data,error}=await sb.rpc('apply_inventory_transfer',{p_transfer_id:record.id});
    if(error) throw error;
    const posted=data||{...record,stockApplied:true};
    const postedIndex=transfers.findIndex(item=>item.id===record.id);
    if(postedIndex>=0) transfers[postedIndex]=posted;
    transferDraft=JSON.parse(JSON.stringify(posted));
    seedTableSnapshot('transfers',transfers,docToRow);
    await loadInventoryBalancesFromSupabase();
    persistTransfers();
  }catch(error){
    console.error('ลงสต๊อกรายการโอนไม่สำเร็จ',error);
    showToast('บันทึกเอกสารแล้ว แต่ลงสต๊อกไม่สำเร็จ กรุณาเปิดรายการแล้วบันทึกอีกครั้ง','danger');
    return false;
  }
  if(!silent){ editingTransferId=null; transferDraft=null; showToast(`บันทึกใบโอนสินค้า ${record.id} แล้ว`); render(); }
  return record.id;
}

function printTransfer(id){
  const doc=transfers.find(t=>t.id===id); if(!doc) return;
  const rows=doc.items.map((item,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(item.name)}</td><td class="r">${escapeHtml(item.qty)}</td><td>${escapeHtml(item.unit||'')}</td><td class="r">${fmtMoney(Number(item.cost)||0)}</td><td class="r">${fmtMoney(Number(item.qty)*(Number(item.cost)||0))}</td></tr>`).join('');
  const win=window.open('','_blank');
  if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร','danger-top'); return; }
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(doc.id)}</title><style>@page{size:A4;margin:14mm}body{font-family:Tahoma,sans-serif;color:#17212b;font-size:12px}h1{color:#4F4038;margin-bottom:4px}.meta{display:grid;grid-template-columns:120px 1fr;gap:7px;max-width:520px;margin:24px 0}table{width:100%;border-collapse:collapse}th{background:#4F4038;color:#fff;text-align:left}th,td{padding:8px;border-bottom:1px solid #d9e0e6}.r{text-align:right}.tools{margin-bottom:16px}.tools button{padding:8px 16px}@media print{.tools{display:none}}</style></head><body><div class="tools"><button onclick="window.print()">พิมพ์เอกสาร</button></div><h1>ใบโอนสินค้า</h1><b>${escapeHtml(doc.id)}</b><div class="meta"><span>วันที่</span><b>${escapeHtml(fmtDate(doc.date))}</b><span>ผู้ขอโอน</span><b>${escapeHtml(doc.transferor||'-')}</b><span>คลังต้นทาง</span><b>${escapeHtml(doc.from)}</b><span>คลังปลายทาง</span><b>${escapeHtml(doc.to)}</b></div><table><thead><tr><th>#</th><th>ชื่อสินค้า / รายละเอียด</th><th class="r">จำนวน</th><th>หน่วย</th><th class="r">ต้นทุนต่อหน่วย</th><th class="r">ราคารวม</th></tr></thead><tbody>${rows}</tbody></table><p><b>จำนวนสินค้ารวม:</b> ${escapeHtml(doc.totalQty)}</p><p><b>หมายเหตุ:</b> ${escapeHtml(doc.note||'-')}</p></body></html>`);
  win.document.close();
  standardizePrintPreview(win);
}
