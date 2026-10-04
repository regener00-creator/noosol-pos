function paymentQrMarkup(seed){
  const size=29,chars=String(seed); let html='';
  const finder=(x,y,ox,oy)=>{ const dx=x-ox,dy=y-oy; if(dx<0||dy<0||dx>6||dy>6) return null; return dx===0||dy===0||dx===6||dy===6||(dx>=2&&dx<=4&&dy>=2&&dy<=4); };
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    let on=finder(x,y,0,0); if(on===null) on=finder(x,y,size-7,0); if(on===null) on=finder(x,y,0,size-7);
    if(on===null){ const code=chars.charCodeAt((x+y*3)%chars.length)||31; on=((x*11+y*7+code+x*y)%13)<6; }
    html+=`<span class="${on?'on':''}"></span>`;
  }
  return `<div class="qr-grid" aria-label="QR Code">${html}</div>`;
}

function openPaymentModal(){
  if(cart.length===0) return;
  if(checkoutInFlight){ showToast('กำลังบันทึกการชำระเงิน กรุณารอสักครู่','warning-top'); return; }
  if(!currentCashShift){ showToast('กรุณาเปิดระบบชำระก่อนรับชำระเงิน','danger-top'); currentTab='cashshift'; render(); return; }
  const inactiveLine=cart.find(line=>line.pid&&!isProductActive(products.find(product=>Number(product.id)===Number(line.pid))));
  if(inactiveLine){ showToast(`สินค้า “${inactiveLine.name}” ถูกปิดใช้งานแล้ว กรุณาลบออกจากบิล`,'danger-top'); return; }
  const invalidMedicineLabel=cart.find(line=>line.dispensingLabel&&!normalizeDispensingLabel(line.dispensingLabel));
  if(invalidMedicineLabel){ showToast(`ฉลากยา “${invalidMedicineLabel.name}” มีข้อมูลไม่ครบ กรุณาเปิดแก้ไขอีกครั้ง`,'danger-top'); openMedicineLabelEditor(invalidMedicineLabel.lineId); return; }
  const invalid=cart.find(line=>line.custom&&(!String(line.name||'').trim()||line.price===''||Number(line.price)<0||!String(line.unit||'').trim()||Number(line.qty)<=0));
  if(invalid){
    showToast('กรุณากรอกชื่อ ราคา หน่วย และจำนวนของรายการกรอกเองให้ครบ');
    const field=!String(invalid.name||'').trim()?'.custom-line-name':invalid.price===''?'.custom-line-price':!String(invalid.unit||'').trim()?'.custom-line-unit':'.line-qty';
    document.querySelector(`${field}[data-line="${invalid.lineId}"]`)?.focus();
    return;
  }
  const grand=cartTaxSummary().total;
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal checkout-pay-modal"><div class="modal-head"><h3 id="checkoutPayTitle">เลือกวิธีชำระเงิน</h3><button class="modal-close">×</button></div><div id="checkoutPayContent"></div></div>`;
  document.body.appendChild(overlay);
  const content=overlay.querySelector('#checkoutPayContent'),title=overlay.querySelector('#checkoutPayTitle');
  // ตัวจับคีย์บอร์ดของหน้าจอชำระเงินปัจจุบัน (เปลี่ยนหน้าจอทีก็เปลี่ยนตัวจับ) — ใช้ร่วมกันทั้งเงินสด/โอน/บัตร/ออนไลน์
  // เพื่อให้กด Enter = คลิกปุ่ม "เสร็จสิ้น" ที่กำลังโชว์อยู่ ได้ทุกหน้าจอเหมือนกันหมด
  let activeKeyHandler=null;
  const stopKeyHandler=()=>{ if(activeKeyHandler){ document.removeEventListener('keydown',activeKeyHandler); activeKeyHandler=null; } };
  const close=()=>{ stopKeyHandler(); overlay.remove(); };
  overlay.querySelector('.modal-close').onclick=close;

  const renderChoice=()=>{
    stopKeyHandler();
    title.hidden=true;
    content.innerHTML=`<div class="payment-choice-total"><span>ยอดชำระ</span><b>${fmtMoney(grand)}</b><span>บาท</span></div><div style="padding:8px 16px 18px;display:flex;flex-direction:column;gap:10px;"><button class="paymethod" data-method="cash"><span style="font-size:20px;">💵</span> [F4] เงินสด</button><button class="paymethod" data-method="bank"><span style="font-size:20px;">🏦</span> [F9] โอนธนาคาร</button><button class="paymethod" data-method="card"><span style="font-size:20px;">💳</span> บัตรเครดิต</button><button class="paymethod" data-method="online"><span style="font-size:20px;">🌐</span> ออนไลน์</button></div>`;
    content.querySelector('[data-method="cash"]').onclick=renderCash;
    content.querySelector('[data-method="bank"]').onclick=renderBank;
    content.querySelector('[data-method="card"]').onclick=renderCard;
    content.querySelector('[data-method="online"]').onclick=renderOnline;
    activeKeyHandler=e=>{
      const method=e.key==='F4'?'cash':e.key==='F9'?'bank':'';
      if(!method) return;
      e.preventDefault();
      if(!e.repeat) content.querySelector(`[data-method="${method}"]`)?.click();
    };
    document.addEventListener('keydown',activeKeyHandler);
  };

  const renderCash=()=>{
    stopKeyHandler();
    title.hidden=false; title.textContent='รับชำระเงินสด'; let cashValue='';
    content.innerHTML=`<div class="checkout-pay-body"><div class="checkout-pay-total">ยอดที่ต้องชำระ<b>${fmtMoney(grand)} บาท</b></div><input class="cash-display" id="cashDisplay" value="0" readonly aria-label="จำนวนเงินที่รับ"><div class="cash-keypad">${['7','8','9','4','5','6','1','2','3','00','0','.'].map(k=>`<button class="cash-key" data-cash-key="${k}">${k}</button>`).join('')}<button class="cash-key action" data-cash-key="back">⌫ ลบ</button><button class="cash-key action" data-cash-key="exact">[F2] รับเงินพอดี</button><button class="cash-key action" data-cash-key="clear">ล้าง</button></div><div class="cash-balance short" id="cashBalance">เงินขาดอีก ${fmtMoney(grand)} บาท</div><div class="checkout-payment-nav"><button class="btn ghost" id="paymentBackBtn">← ย้อนกลับ</button><button class="btn finish" id="cashFinishBtn" disabled>เสร็จสิ้น</button></div></div>`;
    const display=content.querySelector('#cashDisplay'),balance=content.querySelector('#cashBalance'),finish=content.querySelector('#cashFinishBtn');
    const update=()=>{ const received=parseFloat(cashValue)||0,diff=received-grand; display.value=cashValue||'0'; if(diff<0){ balance.className='cash-balance short'; balance.textContent=`เงินขาดอีก ${fmtMoney(Math.abs(diff))} บาท`; finish.disabled=true; }else{ balance.className='cash-balance change'; balance.textContent=`เงินทอน ${fmtMoney(diff)} บาท`; finish.disabled=false; } };
    const applyCashKey=key=>{ if(key==='clear') cashValue=''; else if(key==='back') cashValue=cashValue.slice(0,-1); else if(key==='exact') cashValue=grand.toFixed(2); else if(key==='.'&&!cashValue.includes('.')) cashValue=(cashValue||'0')+'.'; else if(/^\d+$/.test(key)&&cashValue.replace('.','').length<10) cashValue+=key; update(); };
    content.querySelectorAll('[data-cash-key]').forEach(btn=>btn.onclick=()=>applyCashKey(btn.dataset.cashKey));
    activeKeyHandler=e=>{
      let key=null;
      if(e.key==='F2'){ e.preventDefault(); if(!e.repeat) applyCashKey('exact'); return; }
      if(/^\d$/.test(e.key)) key=e.key;
      else if(e.key==='.'||e.code==='NumpadDecimal'||e.key==='Decimal') key='.';
      else if(e.key==='Backspace') key='back';
      else if(e.key==='Delete') key='clear';
      else if(e.key==='Enter'){ e.preventDefault(); if(!finish.disabled) finish.click(); return; }
      else if(e.key==='Escape'){ e.preventDefault(); renderChoice(); return; }
      if(key!==null){ e.preventDefault(); applyCashKey(key); }
    };
    document.addEventListener('keydown',activeKeyHandler);
    content.querySelector('#paymentBackBtn').onclick=renderChoice;
    finish.onclick=()=>{ const received=parseFloat(cashValue)||0; if(received<grand) return; close(); doCheckout('เงินสด',{cashReceived:received,cashChange:received-grand}); };
  };

  const renderBank=()=>{
    stopKeyHandler();
    title.hidden=false; title.textContent='ชำระด้วยการโอนธนาคาร';
    content.innerHTML=`<div class="checkout-pay-body qr-payment"><div class="checkout-pay-total">ยอดโอน<b>${fmtMoney(grand)} บาท</b></div><div class="qr-box">${paymentQrMarkup(`${saleRef}|${grand.toFixed(2)}`)}</div><b>สแกน QR Code เพื่อชำระเงิน</b><div style="color:var(--text-muted);font-size:12px;margin-top:5px;">ตรวจสอบยอดเงินก่อนกดเสร็จสิ้น</div><div class="checkout-payment-nav"><button class="btn ghost" id="paymentBackBtn">← ย้อนกลับ</button><button class="btn finish" id="bankFinishBtn">เสร็จสิ้น</button></div></div>`;
    const finish=content.querySelector('#bankFinishBtn');
    content.querySelector('#paymentBackBtn').onclick=renderChoice;
    finish.onclick=()=>{ close(); doCheckout('โอนธนาคาร'); };
    activeKeyHandler=e=>{
      if(e.key==='Enter'){ e.preventDefault(); finish.click(); }
      else if(e.key==='Escape'){ e.preventDefault(); renderChoice(); }
    };
    document.addEventListener('keydown',activeKeyHandler);
  };

  const renderCard=()=>{
    stopKeyHandler();
    title.hidden=false; title.textContent='ชำระด้วยบัตรเครดิต';
    const fee=Math.round(grand*.03*100)/100,total=Math.round((grand+fee)*100)/100;
    content.innerHTML=`<div class="checkout-pay-body"><div class="card-charge"><div><span>ยอดสินค้า</span><b>${fmtMoney(grand)} บาท</b></div><div><span>ค่าธรรมเนียมบัตรเครดิต 3%</span><b>${fmtMoney(fee)} บาท</b></div><div><span>ยอดชำระทั้งหมด</span><b>${fmtMoney(total)} บาท</b></div></div><div class="checkout-payment-nav"><button class="btn ghost" id="paymentBackBtn">← ย้อนกลับ</button><button class="btn finish" id="cardFinishBtn">เสร็จสิ้น</button></div></div>`;
    const finish=content.querySelector('#cardFinishBtn');
    content.querySelector('#paymentBackBtn').onclick=renderChoice;
    finish.onclick=()=>{ close(); doCheckout('บัตรเครดิต',{fee}); };
    activeKeyHandler=e=>{
      if(e.key==='Enter'){ e.preventDefault(); finish.click(); }
      else if(e.key==='Escape'){ e.preventDefault(); renderChoice(); }
    };
    document.addEventListener('keydown',activeKeyHandler);
  };

  const renderOnline=()=>{
    stopKeyHandler();
    title.hidden=false; title.textContent='ชำระออนไลน์';
    content.innerHTML=`<div class="checkout-pay-body"><div class="payment-choice-total" style="padding:26px 8px 34px;"><span>ยืนยันยอดชำระ</span><b>${fmtMoney(grand)}</b><span>บาท</span></div><div class="checkout-payment-nav"><button class="btn ghost" id="paymentBackBtn">← ย้อนกลับ</button><button class="btn finish" id="onlineFinishBtn">เสร็จสิ้น</button></div></div>`;
    const finish=content.querySelector('#onlineFinishBtn');
    content.querySelector('#paymentBackBtn').onclick=renderChoice;
    finish.onclick=()=>{ close(); doCheckout('ออนไลน์'); };
    activeKeyHandler=e=>{
      if(e.key==='Enter'){ e.preventDefault(); finish.click(); }
      else if(e.key==='Escape'){ e.preventDefault(); renderChoice(); }
    };
    document.addEventListener('keydown',activeKeyHandler);
  };

  renderChoice();
}

function openCustomItemModal(){
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:500px;"><div class="modal-head"><h3>เพิ่มรายการกรอกเอง</h3><button class="modal-close">×</button></div><div class="modal-sub">รายการนี้จะนำไปคิดเงิน แต่จะไม่ตัดจำนวนสินค้าในสต็อก</div><form id="customItemForm"><div class="custom-item-form"><div class="wide"><label>ชื่อรายการ *</label><input id="custom_item_name" placeholder="เช่น ค่าบริการ หรือสินค้านอกระบบ" autocomplete="off"></div><div><label>ราคา/หน่วย *</label><input id="custom_item_price" type="number" min="0" step="0.01" placeholder="0.00"></div><div><label>หน่วย *</label><input id="custom_item_unit" value="ชิ้น" list="customUnitList" placeholder="ชิ้น"><datalist id="customUnitList">${units.map(unit=>`<option value="${escapeHtml(unit)}">`).join('')}</datalist></div><div><label>จำนวน *</label><input id="custom_item_qty" type="number" min="0.001" step="any" value="1"></div><div class="custom-item-note">ⓘ รายการกรอกเองจะปรากฏในบิล ประวัติการขาย และใบเสร็จตามปกติ</div></div><div class="payment-actions"><button class="btn ghost" type="button" id="cancelCustomItemBtn">ยกเลิก</button><button class="btn primary" type="submit">เพิ่มลงรายการ</button></div></form></div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close; overlay.querySelector('#cancelCustomItemBtn').onclick=close;
  overlay.querySelector('#customItemForm').onsubmit=e=>{
    e.preventDefault();
    const name=overlay.querySelector('#custom_item_name').value.trim(),price=parseFloat(overlay.querySelector('#custom_item_price').value),unit=overlay.querySelector('#custom_item_unit').value.trim(),qty=parseFloat(overlay.querySelector('#custom_item_qty').value);
    if(!name){ showToast('กรุณากรอกชื่อรายการ'); overlay.querySelector('#custom_item_name').focus(); return; }
    if(isNaN(price)||price<0){ showToast('กรุณากรอกราคา'); overlay.querySelector('#custom_item_price').focus(); return; }
    if(!unit){ showToast('กรุณากรอกหน่วย'); overlay.querySelector('#custom_item_unit').focus(); return; }
    if(isNaN(qty)||qty<=0){ showToast('กรุณากรอกจำนวน'); overlay.querySelector('#custom_item_qty').focus(); return; }
    addCustomCartLine(name,price,unit,qty); close(); showToast(`เพิ่มรายการ “${name}” แล้ว`); render();
  };
  setTimeout(()=>overlay.querySelector('#custom_item_name').focus(),30);
}
