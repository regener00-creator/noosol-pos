function clearBill(){
  const pendingRequest=readPendingCheckoutRequest();
  if(pendingRequest){
    restorePendingCheckoutUi(pendingRequest);
    showToast('ยังล้างบิลไม่ได้ เพราะมีรายการชำระที่รอยืนยัน กรุณากดชำระซ้ำก่อน','danger-top');
    render();
    return;
  }
  if(cart.length===0){ showToast('บิลว่างอยู่แล้ว'); return; }
  if(!confirm('ต้องการยกเลิกออเดอร์นี้ใช่หรือไม่? รายการที่สแกนไว้จะถูกล้างทั้งหมด')) return;
  cart=[]; saleDiscount=0; saleMember=null; saleSourceQuotationId=null; pendingQty=1;
  saleRef = nextSaleRef();
  showToast('ยกเลิกออเดอร์แล้ว — ไม่มีการสร้างหรือบันทึกบิล');
  render();
}

let holdOrderInFlight=false;
async function holdOrder(){
  if(cart.length===0){ showToast('ยังไม่มีสินค้าในบิล'); return; }
  if(holdOrderInFlight){ showToast('กำลังพักออเดอร์ กรุณารอสักครู่'); return; }
  const enteredName=prompt('ตั้งชื่อออเดอร์ที่พักไว้ (เช่น "ลูกค้าเสื้อแดง"):');
  if(enteredName===null) return;
  const name=enteredName.trim();
  const items = cart.map(l=>{const p=products.find(x=>x.id===l.pid);const savedCost=l.custom?(Number(l.price)||0):(Number(l.cost)||0);return {productId:l.pid||null,warehouseId:Number(activeWarehouseId)||null,name:l.name,qty:l.qty,price:l.price,cost:savedCost,costTotal:savedCost*Number(l.qty||0),unit:l.unit,factor:l.factor||0,custom:!!l.custom};});
  const subtotal = items.reduce((a,it)=>a+it.price*it.qty,0);
  const heldSale={id:'',ref:saleRef,name:name||'(ไม่มีชื่อ)',date:TODAY_STR,time:TODAY_STR+' '+nowTimeStr(),warehouseId:Number(activeWarehouseId)||null,warehouseName:activeWarehouse()?.name||'',cashier:loggedInUser()?.firstName||employees[0],member:saleMember,sourceQuotationId:saleSourceQuotationId||null,status:'hold',items,discount:saleDiscount,vat:0,total:subtotal,cartSnapshot:JSON.parse(JSON.stringify(cart))};
  holdOrderInFlight=true;
  try{
    const {data,error}=await sb.rpc('save_held_sale',{p_sale:heldSale});
    if(error) throw error;
    const saved={...heldSale,...(data?.sale||data||{})};
    if(!saved.id) throw new Error('ระบบไม่ได้ส่งรหัสบิลพักกลับมา');
    salesHistory.unshift(saved);
    cart=[]; saleDiscount=0; saleMember=null; saleSourceQuotationId=null; pendingQty=1;
    saleRef=nextSaleRef();
    showToast(`พักออเดอร์ "${name||'ไม่มีชื่อ'}" แล้ว`);
    render();
  }catch(error){
    console.warn('save held sale',error);
    showToast('พักออเดอร์ไม่สำเร็จ รายการยังอยู่ในบิล กรุณาลองใหม่','danger-top');
  }finally{
    holdOrderInFlight=false;
  }
}

async function resumeHold(billId){
  const bill = salesHistory.find(s=>s.id===billId);
  if(!bill || bill.status!=='hold') return;
  if(cart.length>0 && !confirm('มีบิลค้างอยู่ — ดึงออเดอร์ที่พักไว้จะแทนที่บิลปัจจุบัน ดำเนินการต่อ?')) return;
  try{
    const {error}=await sb.rpc('delete_held_sale',{p_sale_id:String(bill.id)});
    if(error) throw error;
    cart=JSON.parse(JSON.stringify(bill.cartSnapshot||[]));
    saleDiscount=bill.discount||0;
    saleMember=bill.member||null;
    saleLoyaltySelection=null;customerLoyaltyState=null;
    saleSourceQuotationId=bill.sourceQuotationId||null;
    saleRef=bill.ref;
    const idx=salesHistory.indexOf(bill);
    if(idx>-1) salesHistory.splice(idx,1);
    posSalesHistoryModalOpen=false;
    currentTab='checkout';
    showToast(`ดึงออเดอร์ "${bill.name||''}" กลับมาทำต่อ`);
    render();
  }catch(error){
    console.warn('resume held sale',error);
    showToast('ดึงออเดอร์กลับมาไม่สำเร็จ บิลพักยังไม่ถูกลบ','danger-top');
  }
}

async function deleteSaleHistory(id,onDeleted){
  if(isLevel2User()){ showToast('Level 2 ไม่สามารถลบข้อมูลประวัติการขายได้'); return; }
  const sale=salesHistory.find(item=>item.id===id); if(!sale) return;
  if(sale.status!=='hold'){ showToast('บิลที่ชำระแล้วห้ามลบ กรุณาใช้ “ยกเลิกบิล” เพื่อคืนสต๊อก'); return; }
  if(!confirm(`ยืนยันลบบิลพัก ${sale.ref||sale.id} หรือไม่?`)) return;
  try{
    const {error}=await sb.rpc('delete_held_sale',{p_sale_id:String(sale.id)});
    if(error) throw error;
    const index=salesHistory.indexOf(sale); if(index>-1) salesHistory.splice(index,1);
    if(onDeleted) onDeleted();
    showToast(`ลบบิลพัก ${sale.ref||sale.id} แล้ว`);
    render();
  }catch(error){
    console.warn('delete held sale',error);
    showToast('ลบบิลพักไม่สำเร็จ ข้อมูลเดิมยังอยู่','danger-top');
  }
}

function openVoidSaleReasonModal(sale,onVoided){
  document.querySelector('.void-sale-overlay')?.remove();
  const receiptMeta=sale.shortReceiptMeta;
  const overlay=document.createElement('div');
  overlay.className='modal-overlay void-sale-overlay';
  overlay.innerHTML=`<div class="modal void-sale-modal" role="dialog" aria-modal="true" aria-labelledby="voidSaleTitle">
    <div class="modal-head"><div><h3 id="voidSaleTitle">ยกเลิกบิลและคืนสต๊อก</h3><div class="sub">เลขที่บิล ${escapeHtml(sale.ref||sale.id)}</div></div><button class="modal-close" type="button" aria-label="ปิด">×</button></div>
    <form id="voidSaleForm">
      <div class="void-sale-body">
        <div class="void-sale-summary"><span>ยอดที่ยกเลิก</span><strong>${fmtMoney(sale.total)} บาท</strong><span>วิธีชำระ</span><b>${escapeHtml(sale.payMethod||'-')}</b></div>
        ${receiptMeta?`<div class="void-sale-receipt-note"><b>ออกใบเสร็จอย่างย่อแล้ว</b><span>${escapeHtml(shortReceiptNumber(sale))} · พิมพ์ ${receiptMeta.printLog?.length||0} ครั้ง</span><small>ระบบจะเก็บใบเสร็จเดิมไว้เป็นประวัติ และเปลี่ยนบิลนี้เป็นสถานะยกเลิก</small></div>`:''}
        <label class="void-sale-reason" for="voidSaleReason"><span>เหตุผลการยกเลิกบิล <b>*</b></span><textarea id="voidSaleReason" rows="4" maxlength="500" placeholder="เช่น ขายผิดรายการ หรือลูกค้าคืนสินค้า" required></textarea></label>
        <div class="void-sale-warning">เมื่อยืนยัน ระบบจะคืนสินค้าเข้า LOT เดิม บันทึกยอดคืนในกะปัจจุบัน และเก็บผู้ดำเนินการพร้อมเหตุผลไว้ตรวจสอบ</div>
      </div>
      <div class="payment-actions"><button class="btn ghost" type="button" id="cancelVoidSaleBtn">ยกเลิก</button><button class="btn" type="submit" id="confirmVoidSaleBtn" style="background:var(--danger);color:#fff;">ยืนยันยกเลิกบิล</button></div>
    </form>
  </div>`;
  document.body.appendChild(overlay);
  const form=overlay.querySelector('#voidSaleForm');
  const reasonInput=overlay.querySelector('#voidSaleReason');
  const submit=overlay.querySelector('#confirmVoidSaleBtn');
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#cancelVoidSaleBtn').onclick=close;
  overlay.addEventListener('click',event=>{ if(event.target===overlay) close(); });
  form.onsubmit=async event=>{
    event.preventDefault();
    const reason=reasonInput.value.trim();
    if(!reason){ showToast('กรุณาระบุเหตุผลที่ยกเลิกบิล','danger-top'); reasonInput.focus(); return; }
    submit.disabled=true; submit.textContent='กำลังยกเลิกบิล...';
    try{
      const data=await runStockOperation('void_sale',{saleId:sale.id,reason});
      const index=salesHistory.findIndex(item=>item.id===sale.id);
      if(index>=0) salesHistory[index]={...salesHistory[index],...(data?.sale||{}),id:sale.id,status:'void',voidShiftId:currentCashShift.id};
      await refreshDocumentInventory(data?.sale||sale);
      close();
      if(onVoided) onVoided();
      showToast(`ยกเลิกบิล ${sale.ref||sale.id} และคืนสต๊อกแล้ว`);
      render();
    }catch(error){
      console.warn('void sale',error);
      const message=String(error?.message||'');
      if(message.includes('cash shift required')){ currentCashShift=null; currentTab='cashshift'; await loadCashShiftsFromSupabase(); close(); }
      const friendly=message.includes('cash shift required')?'ระบบชำระถูกปิดไปแล้ว กรุณาเปิดระบบใหม่':message.includes('no reversible Lot')||message.includes('no reversible')?'บิลเก่านี้ไม่มีข้อมูล LOT ที่เพียงพอสำหรับคืนอัตโนมัติ':message.includes('full tax invoice')||message.includes('issued sales documents')?'บิลนี้มีใบกำกับภาษีเต็มรูปแบบ กรุณาจัดการเอกสารภาษีก่อน':'ยกเลิกบิลไม่สำเร็จ สต๊อกยังไม่ถูกเปลี่ยน กรุณาลองใหม่';
      showToast(friendly,'danger-top');
      submit.disabled=false; submit.textContent='ยืนยันยกเลิกบิล';
    }
  };
  setTimeout(()=>reasonInput.focus(),0);
}

async function voidSaleHistory(id,onVoided){
  if(currentProfile?.owner!==true){ showToast('เฉพาะเจ้าของร้านเท่านั้นที่ยกเลิกบิลได้','danger-top'); return; }
  if(!currentCashShift){ showToast('กรุณาเปิดระบบชำระก่อนยกเลิกบิลและคืนเงิน','danger-top'); currentTab='cashshift'; render(); return; }
  const sale=salesHistory.find(item=>item.id===id); if(!sale||sale.status!=='done') return;
  if(sale.fullTaxInvoice){ showToast('บิลนี้มีใบกำกับภาษีเต็มรูปแบบ กรุณาจัดการเอกสารภาษีก่อนยกเลิกบิล','danger-top'); return; }
  openVoidSaleReasonModal(sale,onVoided);
}

function saleLotCorrectionAllocations(item){
  const grouped=[],byId=new Map();
  (item?.lotAllocations||[]).forEach(allocation=>{
    if(allocation?.pendingLot) return;
    const lotId=Number(allocation?.lotId)||0,baseQty=Number(allocation?.baseQty)||0;
    if(!lotId||baseQty<=0) return;
    const existing=byId.get(lotId);
    if(existing) existing.baseQty=Math.round((existing.baseQty+baseQty)*1000000)/1000000;
    else{
      const copy={...allocation,lotId,baseQty};
      byId.set(lotId,copy); grouped.push(copy);
    }
  });
  return grouped;
}
function saleLotCorrectionValidation(item,warehouseId,fromLotId,toLotId,quantity,lots){
  const round=value=>Math.round((Number(value)||0)*1000000)/1000000;
  const factor=Number(item?.factor)>0?Number(item.factor):1;
  const allocations=saleLotCorrectionAllocations(item);
  const sourceAllocation=allocations.find(allocation=>Number(allocation.lotId)===Number(fromLotId));
  const targetLot=(lots||[]).find(lot=>Number(lot.id)===Number(toLotId));
  const quantityUnit=Number(quantity)||0,quantityBase=round(quantityUnit*factor);
  const sourceLimit=sourceAllocation?round(Number(sourceAllocation.baseQty)/factor):0;
  const targetLimit=targetLot?round(Number(targetLot.quantity_base)/factor):0;
  const maxQuantity=round(Math.min(sourceLimit,targetLimit));
  let error='';
  if(!sourceAllocation) error='กรุณาเลือก LOT ที่ระบบตัด';
  else if(!targetLot) error='กรุณาเลือก LOT ที่ขายจริง';
  else if(Number(fromLotId)===Number(toLotId)) error='LOT ที่ระบบตัดและ LOT ที่ขายจริงต้องเป็นคนละรายการ';
  else if(Number(targetLot.product_id)!==Number(item?.productId)||Number(targetLot.warehouse_id)!==Number(warehouseId)) error='LOT ที่ขายจริงไม่ตรงกับสินค้าและคลังของบิล';
  else if(targetLot.status==='blocked') error='LOT ที่ขายจริงถูกระงับการใช้งาน';
  else if(quantityUnit<=0) error='กรุณาระบุจำนวนที่ต้องการแก้ไข';
  else if(quantityBase>Number(sourceAllocation.baseQty)+0.000001) error='จำนวนเกินกว่าที่บิลนี้ตัดจาก LOT เดิม';
  else if(quantityBase>Number(targetLot.quantity_base)+0.000001) error='LOT ที่ขายจริงมีจำนวนคงเหลือในระบบไม่เพียงพอ';
  return {error,factor,quantityUnit,quantityBase,maxQuantity,sourceAllocation,targetLot};
}
function saleLotCorrectionLabel(lot){
  const expiry=lot?.expiry_date||lot?.expiry;
  return `${lot?.manufacturer_lot||lot?.lotNumber||'ไม่ระบุเลข LOT'} · หมดอายุ ${expiry?fmtDateShort(expiry):'ไม่ระบุ'}`;
}
async function openSaleLotCorrection(id){
  if(!currentProfile?.owner){ showToast('เฉพาะเจ้าของร้านเท่านั้นที่แก้ไข LOT ที่ขายได้','danger-top'); return; }
  const sale=salesHistory.find(item=>item.id===id); if(!sale||sale.status!=='done') return;
  const eligible=(sale.items||[]).map((item,index)=>({item,index})).filter(entry=>Number(entry.item?.productId)&&saleLotCorrectionAllocations(entry.item).length);
  if(!eligible.length){ showToast('บิลนี้ไม่มีข้อมูล LOT ที่สามารถแก้ไขได้','danger-top'); return; }
  await loadInventoryLotsFromSupabase();
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:680px;max-height:92vh;"><div class="modal-head"><div><h3>แก้ไข LOT ที่ขาย</h3><div class="sub">${escapeHtml(sale.ref||sale.id)}</div></div><button class="modal-close" aria-label="ปิด">×</button></div><form id="saleLotCorrectionForm" class="sale-lot-correction-form"></form></div>`;
  document.body.appendChild(overlay);
  const form=overlay.querySelector('#saleLotCorrectionForm');
  const state={itemIndex:eligible[0].index,fromLotId:0,toLotId:0,quantity:1,reason:''};
  const close=()=>overlay.remove(); overlay.querySelector('.modal-close').onclick=close; overlay.addEventListener('click',event=>{ if(event.target===overlay) close(); });
  const renderForm=()=>{
    let item=sale.items[state.itemIndex];
    if(!item||!saleLotCorrectionAllocations(item).length){ state.itemIndex=eligible[0].index; item=sale.items[state.itemIndex]; }
    const allocations=saleLotCorrectionAllocations(item),warehouseId=Number(sale.warehouseId||item.warehouseId)||0;
    if(!allocations.some(allocation=>Number(allocation.lotId)===Number(state.fromLotId))) state.fromLotId=Number(allocations[0]?.lotId)||0;
    const targets=inventoryLotRows.filter(lot=>Number(lot.product_id)===Number(item.productId)&&Number(lot.warehouse_id)===warehouseId&&Number(lot.quantity_base)>0&&lot.status!=='blocked'&&Number(lot.id)!==Number(state.fromLotId));
    if(!targets.some(lot=>Number(lot.id)===Number(state.toLotId))) state.toLotId=Number(targets[0]?.id)||0;
    let validation=saleLotCorrectionValidation(item,warehouseId,state.fromLotId,state.toLotId,state.quantity,inventoryLotRows);
    if(validation.maxQuantity>0&&Number(state.quantity)>validation.maxQuantity){ state.quantity=validation.maxQuantity; validation=saleLotCorrectionValidation(item,warehouseId,state.fromLotId,state.toLotId,state.quantity,inventoryLotRows); }
    const unit=item.unit||'หน่วย',factor=validation.factor;
    const sourceOptions=allocations.map(allocation=>`<option value="${allocation.lotId}" ${Number(allocation.lotId)===Number(state.fromLotId)?'selected':''}>${escapeHtml(saleLotCorrectionLabel(allocation))} · ตัดไว้ ${escapeHtml(inventoryMovementRound(allocation.baseQty/factor))} ${escapeHtml(unit)}</option>`).join('');
    const targetOptions=targets.map(lot=>`<option value="${lot.id}" ${Number(lot.id)===Number(state.toLotId)?'selected':''}>${escapeHtml(saleLotCorrectionLabel(lot))} · คงเหลือ ${escapeHtml(inventoryMovementRound(lot.quantity_base/factor))} ${escapeHtml(unit)}</option>`).join('');
    form.innerHTML=`<div class="sale-lot-correction-warning">การแก้ไขนี้จะคืนจำนวนให้ LOT ที่ระบบตัดผิด แล้วลดจาก LOT ที่ขายจริงพร้อมกัน ยอดสต๊อกรวมและยอดขายจะไม่เปลี่ยน</div><div class="sale-lot-correction-grid"><div class="field wide"><label>สินค้าในบิล</label><select id="saleLotCorrectionItem">${eligible.map(entry=>`<option value="${entry.index}" ${entry.index===state.itemIndex?'selected':''}>${escapeHtml(entry.item.name)} ×${escapeHtml(entry.item.qty)} ${escapeHtml(entry.item.unit||'')}</option>`).join('')}</select></div><div class="field wide"><label>LOT ที่ระบบตัดผิด</label><select id="saleLotCorrectionFrom">${sourceOptions}</select></div><div class="field wide"><label>LOT ที่ขายจริง</label><select id="saleLotCorrectionTo"><option value="">เลือก LOT ที่ขายจริง</option>${targetOptions}</select>${targets.length?'':'<small style="color:var(--danger);">ไม่พบ LOT อื่นที่ยังมีสินค้าในคลังของบิลนี้</small>'}</div><div class="field"><label>จำนวนที่ต้องการแก้ไข (${escapeHtml(unit)})</label><input id="saleLotCorrectionQty" type="number" min="0.000001" step="any" max="${validation.maxQuantity||''}" value="${escapeHtml(state.quantity)}"></div><div class="field"><label>จำนวนสูงสุด</label><input value="${escapeHtml(validation.maxQuantity)} ${escapeHtml(unit)}" disabled></div><div class="field wide"><label>เหตุผล / หมายเหตุ</label><textarea id="saleLotCorrectionReason" rows="2" maxlength="250" placeholder="เช่น หยิบ LOT ใหม่ให้ลูกค้า">${escapeHtml(state.reason)}</textarea></div></div><div class="sale-lot-correction-preview" id="saleLotCorrectionPreview"></div><div class="payment-actions" style="padding:14px 0 0;margin-top:14px;"><button class="btn ghost" type="button" id="cancelSaleLotCorrection">ยกเลิก</button><button class="btn primary" type="submit" id="confirmSaleLotCorrection">ยืนยันแก้ไข LOT</button></div>`;
    const updatePreview=()=>{
      state.quantity=Number(form.querySelector('#saleLotCorrectionQty')?.value)||0;
      state.reason=form.querySelector('#saleLotCorrectionReason')?.value||'';
      validation=saleLotCorrectionValidation(item,warehouseId,state.fromLotId,state.toLotId,state.quantity,inventoryLotRows);
      const preview=form.querySelector('#saleLotCorrectionPreview'),submit=form.querySelector('#confirmSaleLotCorrection');
      if(preview) preview.innerHTML=validation.error?`<span style="color:var(--danger);">${escapeHtml(validation.error)}</span>`:`คืน ${escapeHtml(state.quantity)} ${escapeHtml(unit)} ให้ <b>${escapeHtml(saleLotCorrectionLabel(validation.sourceAllocation))}</b><br>ตัด ${escapeHtml(state.quantity)} ${escapeHtml(unit)} จาก <b>${escapeHtml(saleLotCorrectionLabel(validation.targetLot))}</b>`;
      if(submit) submit.disabled=!!validation.error;
    };
    form.querySelector('#saleLotCorrectionItem').onchange=event=>{ state.itemIndex=Number(event.target.value); state.fromLotId=0; state.toLotId=0; state.quantity=1; renderForm(); };
    form.querySelector('#saleLotCorrectionFrom').onchange=event=>{ state.fromLotId=Number(event.target.value); state.toLotId=0; state.quantity=1; renderForm(); };
    form.querySelector('#saleLotCorrectionTo').onchange=event=>{ state.toLotId=Number(event.target.value); updatePreview(); };
    form.querySelector('#saleLotCorrectionQty').oninput=updatePreview;
    form.querySelector('#saleLotCorrectionReason').oninput=updatePreview;
    form.querySelector('#cancelSaleLotCorrection').onclick=close;
    form.onsubmit=async event=>{
      event.preventDefault(); updatePreview();
      if(validation.error){ showToast(validation.error,'danger-top'); return; }
      if(!confirm(`ยืนยันแก้ LOT ของ ${item.name} จำนวน ${state.quantity} ${unit} หรือไม่?\nยอดสต๊อกรวมและยอดขายจะไม่เปลี่ยน`)) return;
      const submit=form.querySelector('#confirmSaleLotCorrection'); submit.disabled=true; submit.textContent='กำลังบันทึก...';
      try{
        const data=await runStockOperation('correct_sale_lot_allocation',{saleId:sale.id,itemIndex:state.itemIndex,fromLotId:state.fromLotId,toLotId:state.toLotId,quantityBase:validation.quantityBase,reason:state.reason.trim()||null});
        const saleIndex=salesHistory.findIndex(entry=>entry.id===sale.id);
        if(saleIndex>=0) salesHistory[saleIndex]={...salesHistory[saleIndex],...(data?.sale||{}),id:sale.id};
        await Promise.all([loadInventoryBalancesFromSupabase(),loadInventoryLotsFromSupabase()]);
        close(); showToast('แก้ไข LOT ที่ขายเรียบร้อยแล้ว'); openSaleHistoryDetail(sale.id);
      }catch(error){
        console.warn('correct sale lot allocation',error);
        const message=String(error?.message||'');
        const friendly=message.includes('insufficient')?'LOT ที่ขายจริงมีจำนวนคงเหลือไม่เพียงพอ':message.includes('exceeds')?'จำนวนเกินกว่าที่บิลตัดจาก LOT เดิม':'แก้ไข LOT ที่ขายไม่สำเร็จ กรุณาลองใหม่';
        showToast(friendly,'danger-top'); submit.disabled=false; submit.textContent='ยืนยันแก้ไข LOT';
      }
    };
    updatePreview();
  };
  renderForm();
}

function customerReturnAvailable(sale){
  return sale?.status==='done'&&!sale.customerReturn&&(sale.items||[]).some((item,index)=>Number(item.qty)>Number(sale.customerReturnQuantities?.[index]||0));
}
function customerReturnRefund(sale,requests){
  const gross=(sale.items||[]).map(item=>Number(item.lineTotalGross??item.lineTotal??(Number(item.price)*Number(item.qty)))||0);
  const subtotal=gross.reduce((sum,value)=>sum+value,0),ratio=subtotal>0?Math.max(0,subtotal-(Number(sale.discount)||0))/subtotal:0;
  const cents=value=>Math.round((value+Number.EPSILON)*100);
  let before=0;
  const entitlements=gross.map(value=>{const amount=cents((before+value)*ratio)-cents(before*ratio);before+=value;return amount;});
  return (requests||[]).reduce((sum,request)=>{
    const item=sale.items?.[request.itemIndex],sold=Number(item?.qty)||0,old=Number(sale.customerReturnQuantities?.[request.itemIndex]||0),qty=Number(request.qty)||0;
    return sum+(sold>0?Math.round(entitlements[request.itemIndex]*(old+qty)/sold)-Math.round(entitlements[request.itemIndex]*old/sold):0);
  },0)/100;
}
function customerExchangePayload(lines,method){
  const registered=isBusinessVatRegistered();
  const items=lines.map((line,index)=>{
    const product=products.find(p=>Number(p.id)===Number(line.productId));
    const option=productUnitOptions(product).find(unit=>unit.name===line.unit)||productUnitOptions(product)[0];
    const qty=Number(line.qty)||0,price=Number(option.price)||0,cost=Number(option.cost)||0,vatMode=effectiveProductVatMode(product),amount=qty*price;
    return {lineKey:String(index+1),productId:product.id,name:product.name,qty,unit:option.name,factor:option.factor,price,cost,costTotal:qty*cost,vatMode,lineTotal:amount,lineTotalGross:grossAmountForVatMode(amount,vatMode,registered)};
  });
  const tax=calculateSaleTaxSummary(items.map(item=>({amount:item.lineTotal,vatMode:item.vatMode})),0,registered);
  const round=value=>Math.round(value*100)/100;
  const total=round(tax.total);
  return {items,sale:{total,discount:0,fee:0,vat:round(tax.vat),costTotal:items.reduce((sum,item)=>sum+item.costTotal,0),payMethod:method,cashReceived:method==='เงินสด'?total:0,cashChange:0}};
}
async function openCustomerReturn(saleId,kind='return'){
  if(currentProfile?.owner!==true){showToast('เฉพาะเจ้าของร้านเท่านั้นที่คืนหรือเปลี่ยนสินค้าได้','danger-top');return;}
  if(!currentCashShift){showToast('กรุณาเปิดระบบชำระก่อนคืนหรือเปลี่ยนสินค้า','danger-top');return;}
  let sale;
  try{
    const {data,error}=await sb.from('sales').select('*').eq('id',saleId).single();
    if(error) throw error;
    sale=rowToSale(data);salesHistory=mergeSalesRows(salesHistory,[sale]);
  }catch(error){showToast('โหลดบิลล่าสุดไม่สำเร็จ กรุณาลองใหม่','danger-top');return;}
  if(!customerReturnAvailable(sale)){showToast('บิลนี้ไม่มีสินค้าที่รับคืนได้แล้ว','danger-top');return;}
  if(sale.fullTaxInvoice){showToast('บิลนี้มีใบกำกับภาษีเต็มรูปแบบ ต้องจัดการเอกสารภาษีก่อนรับคืน','danger-top');return;}
  if(isAllWarehousesMode()||Number(sale.warehouseId)!==Number(activeWarehouseId)){showToast('กรุณาเลือกคลังเดียวกับบิลเดิม','danger-top');return;}
  const title=kind==='exchange'?'เปลี่ยนสินค้า':'คืนสินค้า',lines=[];
  const overlay=document.createElement('div');overlay.className='modal-overlay customer-return-overlay';
  overlay.innerHTML=`<div class="modal customer-return-modal" role="dialog" aria-modal="true" aria-labelledby="customerReturnTitle"><div class="modal-head"><div><h3 id="customerReturnTitle">${title}</h3><div class="sub">บิลเดิม ${escapeHtml(sale.ref||sale.id)} · ${escapeHtml(fmtDate(sale.date))}</div></div><button class="modal-close" type="button" aria-label="ปิด">×</button></div><form id="customerReturnForm"><div class="customer-return-body"><h4>สินค้าที่รับคืน</h4><div class="customer-return-table"><table class="grid-table"><thead><tr><th>สินค้า</th><th>คืนได้</th><th>จำนวนคืน</th><th>การจัดการสินค้า</th></tr></thead><tbody>${sale.items.map((item,index)=>{
    const available=Math.max(0,Number(item.qty)-Number(sale.customerReturnQuantities?.[index]||0));
    return `<tr><td>${escapeHtml(item.name)}<small>${escapeHtml(item.unit)} · ราคาคืนหลังส่วนลด</small></td><td>${escapeHtml(available)}</td><td><input type="number" min="0" max="${available}" step="any" value="0" data-customer-return-qty="${index}" aria-label="จำนวนคืน ${escapeHtml(item.name)}" ${available?'':'disabled'}></td><td><select data-customer-return-stock="${index}" aria-label="การจัดการ ${escapeHtml(item.name)}" ${available?'':'disabled'}><option value="true">นำกลับเข้าสต๊อกขาย</option><option value="false">ไม่นำกลับเข้าสต๊อกขาย / ชำรุด</option></select></td></tr>`;
  }).join('')}</tbody></table></div>${kind==='exchange'?'<section class="customer-exchange-section"><h4>สินค้าใหม่ที่ลูกค้าเลือก</h4><input id="customerExchangeSearch" type="search" placeholder="ค้นหาชื่อ / รหัส / สแกนบาร์โค้ด" autocomplete="off" aria-label="ค้นหาสินค้าใหม่"><div id="customerExchangeResults"></div><div id="customerExchangeLines"></div></section>':''}<div class="customer-return-summary"><div><span>ยอดสินค้ารับคืน</span><b id="customerReturnAmount">0.00</b></div>${kind==='exchange'?'<div><span>ยอดสินค้าใหม่</span><b id="customerExchangeAmount">0.00</b></div>':''}<div class="customer-return-settlement"><span id="customerSettlementLabel">ยอดคืนเงิน</span><b id="customerSettlementAmount">0.00</b></div></div><div class="customer-return-fields"><label class="customer-return-reason">เหตุผล<input id="customerReturnReason" required maxlength="500" placeholder="ระบุเหตุผลการคืนหรือเปลี่ยนสินค้า"></label><label class="customer-return-payment"><span id="customerReturnPaymentLabel">วิธีคืนเงิน</span><select id="customerReturnPayment">${['เงินสด','โอนธนาคาร','บัตรเครดิต','ออนไลน์'].map(method=>`<option ${method===sale.payMethod?'selected':''}>${method}</option>`).join('')}</select></label></div><div id="customerReturnError" role="alert"></div></div><div class="payment-actions"><button type="button" class="btn ghost" id="cancelCustomerReturn">ยกเลิก</button><button type="submit" class="btn primary" id="submitCustomerReturn" disabled>ยืนยัน${title}</button></div></form></div>`;
  document.body.appendChild(overlay);
  let busy=false,committed=false;
  const close=()=>{if(!busy)overlay.remove();};
  overlay.querySelector('.modal-close').onclick=close;overlay.querySelector('#cancelCustomerReturn').onclick=close;
  const form=overlay.querySelector('form'),submit=overlay.querySelector('#submitCustomerReturn'),methodNode=overlay.querySelector('#customerReturnPayment'),errorNode=overlay.querySelector('#customerReturnError');
  const returns=()=>[...overlay.querySelectorAll('[data-customer-return-qty]')].map(input=>({itemIndex:Number(input.dataset.customerReturnQty),qty:Number(input.value),restock:overlay.querySelector(`[data-customer-return-stock="${input.dataset.customerReturnQty}"]`).value==='true'})).filter(item=>item.qty>0);
  const refresh=()=>{
    const refund=customerReturnRefund(sale,returns()),replacement=customerExchangePayload(lines,methodNode.value),difference=Math.round((replacement.sale.total-refund)*100)/100;
    overlay.querySelector('#customerReturnAmount').textContent=fmtMoney(refund);
    const newAmount=overlay.querySelector('#customerExchangeAmount');if(newAmount)newAmount.textContent=fmtMoney(replacement.sale.total);
    overlay.querySelector('#customerSettlementLabel').textContent=difference>0?'รับเงินเพิ่ม':difference<0?'คืนเงินให้ลูกค้า':'ไม่ต้องรับหรือคืนเงิน';
    overlay.querySelector('#customerSettlementAmount').textContent=fmtMoney(Math.abs(difference));
    overlay.querySelector('#customerReturnPaymentLabel').textContent=difference>0?'วิธีรับเงินเพิ่ม':difference<0?'วิธีคืนเงิน':'ช่องทางหักลบยอด';
    submit.disabled=busy||!returns().length||(kind==='exchange'&&!lines.length)||lines.some(line=>!(Number(line.qty)>0));
    return {refund,replacement,difference};
  };
  const renderLines=()=>{
    const host=overlay.querySelector('#customerExchangeLines');if(!host)return;
    host.innerHTML=lines.map((line,index)=>{const product=products.find(p=>Number(p.id)===Number(line.productId));return `<div class="customer-exchange-line"><b>${escapeHtml(product.name)}</b><input type="number" min="0.000001" step="any" value="${line.qty}" data-exchange-qty="${index}" aria-label="จำนวน ${escapeHtml(product.name)}"><select data-exchange-unit="${index}" aria-label="หน่วย ${escapeHtml(product.name)}">${productUnitOptions(product).map(unit=>`<option value="${escapeHtml(unit.name)}" ${unit.name===line.unit?'selected':''}>${escapeHtml(unit.name)} · ${fmtMoney(grossAmountForVatMode(unit.price,effectiveProductVatMode(product),isBusinessVatRegistered()))}</option>`).join('')}</select><button class="btn ghost small" type="button" data-exchange-remove="${index}" aria-label="นำ ${escapeHtml(product.name)} ออก">ลบ</button></div>`;}).join('');
    host.querySelectorAll('[data-exchange-qty]').forEach(input=>input.oninput=()=>{lines[Number(input.dataset.exchangeQty)].qty=input.value;refresh();});
    host.querySelectorAll('[data-exchange-unit]').forEach(select=>select.onchange=()=>{lines[Number(select.dataset.exchangeUnit)].unit=select.value;refresh();});
    host.querySelectorAll('[data-exchange-remove]').forEach(button=>button.onclick=()=>{lines.splice(Number(button.dataset.exchangeRemove),1);renderLines();});
    refresh();
  };
  const search=overlay.querySelector('#customerExchangeSearch'),results=overlay.querySelector('#customerExchangeResults');
  if(search){
    search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();const first=results.querySelector('button');if(first)first.click();}};
    search.oninput=()=>{
      const query=search.value.trim().toLowerCase();
      const matches=query?products.filter(p=>p.active!==false&&(String(p.name).toLowerCase().includes(query)||String(p.sku||'').toLowerCase().includes(query)||matchesBarcode(p,query))).slice(0,20):[];
      results.innerHTML=matches.map(p=>`<button type="button" data-exchange-product="${p.id}">${escapeHtml(p.name)} <small>${escapeHtml(p.sku||'')}</small></button>`).join('');
      results.querySelectorAll('[data-exchange-product]').forEach(button=>button.onclick=()=>{const product=products.find(p=>Number(p.id)===Number(button.dataset.exchangeProduct));const exact=findProductByExactCode(search.value.trim());const unit=exact?.product?.id===product.id&&exact.unitName?exact.unitName:product.unit;const found=lines.find(line=>line.productId===product.id&&line.unit===unit);if(found)found.qty=Number(found.qty)+1;else lines.push({productId:product.id,qty:1,unit});search.value='';results.innerHTML='';renderLines();search.focus();});
    };
  }
  overlay.querySelectorAll('[data-customer-return-qty]').forEach(input=>input.addEventListener('input',refresh));methodNode.onchange=refresh;
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||committed||!form.reportValidity())return;
    const totals=refresh();if(submit.disabled)return;
    const reason=overlay.querySelector('#customerReturnReason').value.trim();if(!reason)return;
    busy=true;submit.disabled=true;submit.textContent='กำลังบันทึก…';errorNode.textContent='';
    const controls=[...form.querySelectorAll('input,select,button')];controls.forEach(control=>control.disabled=true);
    try{
      const result=await runStockOperation('customer_return',{saleId:sale.id,warehouseId:Number(activeWarehouseId),kind,reason,payMethod:methodNode.value,returns:returns(),expectedRefund:totals.refund,replacement:totals.replacement});
      committed=true;salesHistory=mergeSalesRows(salesHistory,[result.sale,result.returnSale,result.replacementSale].filter(Boolean));
      customerLoyaltyState=null;customerPurchaseState=null;
      try{await refreshDocumentInventory({items:[...(result.returnSale.items||[]),...(result.replacementSale?.items||[])],warehouseId:Number(activeWarehouseId)});}catch(error){console.warn('refresh returned inventory',error);}
      busy=false;overlay.remove();render();
      showCustomerReturnResult(result.returnSale,result.replacementSale);
    }catch(error){busy=false;controls.forEach(control=>control.disabled=false);submit.textContent=`ยืนยัน${title}`;errorNode.textContent=error?.message||'บันทึกไม่สำเร็จ กรุณาลองใหม่';refresh();}
  };
  refresh();
}
function showCustomerReturnResult(returnSale,replacementSale=null){
  const difference=Number(returnSale.settlement)||0,label=difference>0?'รับเงินเพิ่ม':difference<0?'คืนเงินให้ลูกค้า':'ไม่ต้องรับหรือคืนเงิน';
  const overlay=document.createElement('div');overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:460px"><div class="modal-head"><h3>บันทึก${returnSale.returnKind==='exchange'?'เปลี่ยน':'คืน'}สินค้าแล้ว</h3><button class="modal-close" aria-label="ปิด">×</button></div><div class="customer-return-body"><p>${escapeHtml(returnSale.ref)} · อ้างอิง ${escapeHtml(returnSale.sourceSaleRef||returnSale.sourceSaleId)}</p><div class="customer-return-settlement"><span>${label}</span><strong>${fmtMoney(Math.abs(difference))} บาท</strong></div><p>${escapeHtml(returnSale.payMethod||'')}</p></div><div class="payment-actions"><button class="btn ghost" id="closeReturnResult">ปิด</button><button class="btn primary" id="printReturnResult">พิมพ์เอกสาร</button></div></div>`;
  document.body.appendChild(overlay);const close=()=>overlay.remove();overlay.querySelector('.modal-close').onclick=close;overlay.querySelector('#closeReturnResult').onclick=close;overlay.querySelector('#printReturnResult').onclick=()=>printCustomerReturn(returnSale,replacementSale);
}
function printCustomerReturn(returnSale,replacementSale=null,existingWindow=null){
  const win=existingWindow||window.open('','_blank');if(!win){showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร');return;}
  const difference=Number(returnSale.settlement)||0,title=returnSale.returnKind==='exchange'?'ใบเปลี่ยนสินค้า':'ใบรับคืนสินค้า';
  const rows=items=>(items||[]).map(item=>`<tr><td>${escapeHtml(item.name)}</td><td>${Math.abs(Number(item.qty)||0)} ${escapeHtml(item.unit||'')}</td><td>${fmtMoney(Math.abs(Number(item.lineTotalGross??item.lineTotal)||0))}</td></tr>`).join('');
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${title} ${escapeHtml(returnSale.ref)}</title><style>@page{size:A4;margin:15mm}body{font-family:Tahoma,sans-serif;color:#302923;font-size:13px;max-width:800px;margin:24px auto}h1{text-align:center}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}td:last-child,th:last-child{text-align:right}.summary{font-size:18px;font-weight:bold;padding:20px 0}.toolbar{text-align:right}@media print{.toolbar{display:none}}</style></head><body><div class="toolbar"><button onclick="window.print()">พิมพ์</button></div><h1>${title}</h1><h3>${escapeHtml(returnSale.businessSnapshot?.name||businessSettings.name||STORE_INFO.name)}</h3><p>เลขที่ ${escapeHtml(returnSale.ref)} · วันที่ ${escapeHtml(fmtDate(returnSale.date))}</p><p>อ้างอิงบิล ${escapeHtml(returnSale.sourceSaleRef||returnSale.sourceSaleId)}</p><p>เหตุผล ${escapeHtml(returnSale.reason||'-')}</p><h3>สินค้าที่รับคืน</h3><table><thead><tr><th>สินค้า</th><th>จำนวน</th><th>ยอดคืนหลังส่วนลด</th></tr></thead><tbody>${rows(returnSale.items)}</tbody></table><p>รวมรับคืน ${fmtMoney(Math.abs(Number(returnSale.total)))} บาท</p>${replacementSale?`<h3>สินค้าใหม่ · ${escapeHtml(replacementSale.ref)}</h3><table><thead><tr><th>สินค้า</th><th>จำนวน</th><th>รวม</th></tr></thead><tbody>${rows(replacementSale.items)}</tbody></table><p>รวมสินค้าใหม่ ${fmtMoney(replacementSale.total)} บาท</p>`:''}<div class="summary">${difference>0?'รับเงินเพิ่ม':difference<0?'คืนเงินให้ลูกค้า':'ไม่ต้องรับหรือคืนเงิน'} ${fmtMoney(Math.abs(difference))} บาท</div><p>ช่องทาง ${escapeHtml(returnSale.payMethod||'-')} · ผู้ดำเนินการ ${escapeHtml(returnSale.cashier||'-')}</p></body></html>`);
  win.document.close();standardizePrintPreview(win);recordPrintEvent('customer_return',returnSale.id);
}

function openSaleHistoryDetail(id){
  const sale=salesHistory.find(item=>item.id===id); if(!sale) return;
  const tax=saleTaxSummary(sale),subtotal=tax.subtotal;
  const canIssue=sale.status==='done'&&!sale.customerReturn;
  const canIssueTax=canIssueTaxInvoiceForSale(sale)||!!sale.fullTaxInvoice;
  const canDeleteHeld=sale.status==='hold'&&!isLevel2User();
  const canVoidCompleted=sale.status==='done'&&currentProfile?.owner===true&&!sale.customerReturn&&!sale.customerExchange&&!(sale.customerReturnLog||[]).length;
  const canCorrectLots=!!currentProfile?.owner&&canIssue&&!(sale.customerReturnLog||[]).length&&(sale.items||[]).some(item=>Number(item?.productId)&&saleLotCorrectionAllocations(item).length);
  const canPrintMedicineLabels=canIssue&&medicineLabelsForSale(sale).length>0;
  const correctionLog=Array.isArray(sale.lotCorrectionLog)?sale.lotCorrectionLog:[];
  const correctionLogHtml=correctionLog.length?`<div class="sale-lot-correction-log"><h4>ประวัติแก้ไข LOT (${correctionLog.length})</h4>${correctionLog.slice().reverse().map(log=>{ const qty=Number(log.quantity)>0?log.quantity:log.quantityBase,unit=log.unit||'หน่วยหลัก'; return `<div class="sale-lot-correction-log-item"><b>${escapeHtml(log.productName||'-')} ×${escapeHtml(inventoryMovementRound(qty))} ${escapeHtml(unit)}</b><br>${escapeHtml(log.fromLot?.lotNumber||'ไม่ระบุเลข LOT')} → ${escapeHtml(log.toLot?.lotNumber||'ไม่ระบุเลข LOT')} · ${escapeHtml(auditDisplay(log.at))}${log.reason?`<br>หมายเหตุ: ${escapeHtml(log.reason)}`:''}</div>`; }).join('')}</div>`:'';
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:760px;max-height:92vh;"><div class="modal-head"><h3>รายละเอียดการขาย ${escapeHtml(sale.ref||sale.id)}</h3><button class="modal-close">×</button></div>
    <div class="sale-detail-meta"><div><small>วันที่ / เวลา</small><b>${fmtDate(sale.date)} · ${escapeHtml(saleHistoryTimeDisplay(sale.time))}</b></div><div><small>พนักงานขาย</small><b>${escapeHtml(sale.cashier||'-')}</b></div><div><small>ลูกค้า / สมาชิก</small><b>${escapeHtml((typeof sale.member==='object'?sale.member?.name:sale.member)||sale.name||'ลูกค้าทั่วไป')}</b></div><div><small>วิธีชำระ</small><b>${escapeHtml(sale.payMethod||'-')}</b></div></div>
    <div class="sale-detail-table"><table class="grid-table"><thead><tr><th>ลำดับ</th><th>สินค้า / Lot</th><th class="mono">จำนวน</th><th>หน่วย</th><th class="mono">ราคา/หน่วย</th><th class="mono">รวม</th></tr></thead><tbody>${(sale.items||[]).map((item,index)=>{ const lots=(item.lotAllocations||[]).map(allocation=>allocation.pendingLot?`<span style="color:var(--danger);font-weight:600;">รอจัด LOT · ${escapeHtml(inventoryMovementRound(allocation.baseQty))} หน่วยหลัก</span>`:`${escapeHtml(allocation.lotNumber||allocation.internalCode||'-')} · ${escapeHtml(allocation.expiry?fmtDateShort(allocation.expiry):'ไม่ระบุวันหมดอายุ')} · ${escapeHtml(inventoryMovementRound(allocation.baseQty))} หน่วยหลัก`).join('<br>'); const label=normalizeDispensingLabel(item.dispensingLabel); return `<tr><td>${index+1}</td><td>${escapeHtml(item.name)}${label?`<small class="sale-medicine-label-summary">Rx ${escapeHtml(label.patientName)} · ${escapeHtml(label.directions)}</small>`:''}${lots?`<small style="display:block;color:var(--text-muted);margin-top:4px;">Lot: ${lots}</small>`:''}</td><td class="mono num">${escapeHtml(item.qty)}</td><td>${escapeHtml(item.unit||'-')}</td><td class="mono num">${fmtMoney(item.price)}</td><td class="mono num">${fmtMoney(item.lineTotalGross!==undefined?item.lineTotalGross:item.qty*item.price)}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="sale-detail-summary"><div><span>รวมสินค้า</span><b>${fmtMoney(subtotal)} บาท</b></div>${sale.discount?`<div><span>ส่วนลด</span><b>- ${fmtMoney(sale.discount)} บาท</b></div>`:''}${sale.fee?`<div><span>ค่าธรรมเนียม</span><b>${fmtMoney(sale.fee)} บาท</b></div>`:''}<div class="grand"><span>ยอดสุทธิ</span><b>${fmtMoney(sale.total)} บาท</b></div>${sale.cashReceived?`<div><span>รับเงิน</span><b>${fmtMoney(sale.cashReceived)} บาท</b></div><div><span>เงินทอน</span><b>${fmtMoney(sale.cashChange||0)} บาท</b></div>`:''}</div>
    ${canCorrectLots?`<div class="sale-lot-correction-panel"><div><h4>LOT ที่ขายไม่ตรงกับระบบ?</h4><p>ย้ายการตัดไปยัง LOT ที่ขายจริง โดยยอดขายและสต๊อกรวมไม่เปลี่ยน</p></div><button class="btn ghost" id="correctSaleLotBtn">แก้ไข LOT ที่ขาย</button></div>`:''}${correctionLogHtml}
    <div class="history-doc-panel"><h4>ออกเอกสารย้อนหลัง</h4><p>${canIssue?'ใช้ข้อมูลและวันที่ขายเดิม การพิมพ์เอกสารจะไม่ตัดสต็อกหรือเพิ่มยอดขายซ้ำ':'ออกเอกสารได้เฉพาะรายการที่ชำระเงินเรียบร้อยแล้ว'}</p><div class="history-doc-buttons">${canPrintMedicineLabels?`<button id="historyMedicineLabelsBtn">Rx พิมพ์ฉลากยา (${medicineLabelsForSale(sale).length})</button>`:''}<button id="historyShortReceiptBtn" ${canIssue?'':'disabled'}>🧾 ใบเสร็จอย่างย่อ</button><button id="historyTaxInvoiceBtn" ${canIssueTax?'':'disabled'}>${sale.fullTaxInvoice?'📄 เปิดใบกำกับภาษี':'📄 ออกใบกำกับภาษีย้อนหลัง'}</button></div></div>
    ${(sale.customerReturnLog||[]).length?`<div class="customer-return-history"><h4>ประวัติคืน / เปลี่ยน</h4>${sale.customerReturnLog.map(log=>`<p>${escapeHtml(log.ref)} · ${log.kind==='exchange'?'เปลี่ยน':'คืน'} · ยอดรับคืน ${fmtMoney(log.refund)} · ${escapeHtml(log.reason||'')}</p>`).join('')}</div>`:''}<div class="payment-actions"><button class="btn ghost" id="closeSaleDetailBtn">ปิด</button>${sale.customerReturn?'<button class="btn primary" id="printCustomerReturnDetail">พิมพ์ใบคืน / เปลี่ยน</button>':''}${currentProfile?.owner&&customerReturnAvailable(sale)?'<button class="btn ghost" id="returnSaleDetailBtn">คืน</button><button class="btn primary" id="exchangeSaleDetailBtn">เปลี่ยน</button>':''}${canDeleteHeld?`<button class="btn" id="deleteSaleDetailBtn" style="background:var(--danger);color:#fff;">ลบบิลพัก</button>`:canVoidCompleted?`<button class="btn" id="voidSaleDetailBtn" style="background:var(--danger);color:#fff;">ยกเลิกบิลและคืนสต๊อก</button>`:''}</div></div>`;
  document.body.appendChild(overlay);
  const close=()=>{ overlay.remove(); render(); };
  overlay.querySelector('.modal-close').onclick=close; overlay.querySelector('#closeSaleDetailBtn').onclick=close;
  const deleteDetailBtn=overlay.querySelector('#deleteSaleDetailBtn'); if(deleteDetailBtn) deleteDetailBtn.onclick=()=>deleteSaleHistory(id,close);
  ['return','exchange'].forEach(kind=>{const button=overlay.querySelector(kind==='return'?'#returnSaleDetailBtn':'#exchangeSaleDetailBtn');if(button)button.onclick=()=>{close();openCustomerReturn(id,kind);};});
  const printReturn=overlay.querySelector('#printCustomerReturnDetail');if(printReturn)printReturn.onclick=async()=>{const printWindow=window.open('','_blank');if(!printWindow){showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร');return;}let replacement=salesHistory.find(row=>row.id===sale.replacementSaleId);if(!replacement&&sale.replacementSaleId){const {data,error}=await sb.from('sales').select('*').eq('id',sale.replacementSaleId).single();if(error){printWindow.close();showToast('โหลดสินค้าใหม่ไม่สำเร็จ กรุณาลองใหม่','danger-top');return;}replacement=rowToSale(data);}printCustomerReturn(sale,replacement,printWindow);};
  const voidDetailBtn=overlay.querySelector('#voidSaleDetailBtn'); if(voidDetailBtn) voidDetailBtn.onclick=()=>voidSaleHistory(id,close);
  const correctLotBtn=overlay.querySelector('#correctSaleLotBtn'); if(correctLotBtn) correctLotBtn.onclick=()=>{ close(); openSaleLotCorrection(id); };
  const historyMedicineLabelsBtn=overlay.querySelector('#historyMedicineLabelsBtn'); if(historyMedicineLabelsBtn) historyMedicineLabelsBtn.onclick=()=>printMedicineLabels(id);
  overlay.querySelector('#historyShortReceiptBtn').onclick=()=>{ if(canIssue){ close(); openHistoricalReceiptActions(id); } };
  overlay.querySelector('#historyTaxInvoiceBtn').onclick=()=>{ if(!canIssueTax) return; close(); sale.fullTaxInvoice?openFullTaxInvoiceModal(id):startTaxInvoiceForm(id); };

}
