function auditNow(){ return new Date().toISOString(); }
function auditDisplay(value){
  if(!value) return '-';
  const text=String(value).trim();
  if(!/^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/.test(text)) return '-';
  const d=new Date(text);
  return Number.isNaN(d.getTime())?'-':d.toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'});
}
function shortReceiptNumber(sale){
  const prefix=documentPrefixes.sale;
  return sale.shortReceiptMeta?.number || sale.ref || buildDocNumber(prefix, nextDailySeq(prefix, salesHistory.map(s=>s.ref).filter(Boolean)));
}
function nextA4CashReceiptNumber(){
  const prefix=documentPrefixes.cashBill;
  const numbers=salesHistory.map(sale=>sale.cashReceiptA4Meta?.number).filter(Boolean);
  return buildDocNumber(prefix,nextDailySeq(prefix,numbers));
}
function nextFullTaxInvoiceNumber(){
  const pool=[...salesHistory.map(s=>s.fullTaxInvoice?.number).filter(Boolean), ...standaloneTaxInvoices.map(d=>d.number).filter(Boolean)];
  const prefix=documentPrefixes.taxInvoice;
  return buildDocNumber(prefix, nextYearlySeq(prefix, pool));
}
function fullTaxInvoiceNumber(sale){
  return sale.fullTaxInvoice?.number || nextFullTaxInvoiceNumber();
}

function openHistoricalReceiptActions(saleId){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale||sale.status!=='done') return;
  const meta=sale.shortReceiptMeta;
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:500px;"><div class="modal-head"><h3>ใบเสร็จอย่างย่อย้อนหลัง</h3><button class="modal-close">×</button></div>
    <div class="issued-doc-card"><strong>${escapeHtml(shortReceiptNumber(sale))}</strong><div>วันที่ขาย: ${fmtDateShort(sale.date)} ${saleHistoryTimeDisplay(sale.time)}</div><div>ยอดสุทธิ: ${fmtMoney(sale.total)} บาท</div><div>พิมพ์แล้ว: ${meta?.printLog?.length||0} ครั้ง</div></div>
    <div class="modal-sub" style="padding-top:0;">วันที่ขายถูกล็อกไว้ตามรายการเดิม การพิมพ์ย้อนหลังไม่ตัดสต็อกและไม่เพิ่มยอดขาย</div>
    <div class="payment-actions"><button class="btn ghost" id="closeHistoricalReceiptBtn">ปิด</button><button class="btn primary" id="printHistoricalReceiptBtn">พิมพ์</button></div></div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#closeHistoricalReceiptBtn').onclick=close;
  overlay.querySelector('#printHistoricalReceiptBtn').onclick=()=>printShortReceipt(saleId,true);
}

function a4CashReceiptCustomer(sale){
  const saved=sale?.cashReceiptA4Meta?.customer||{};
  const member=sale?.member&&typeof sale.member==='object'?sale.member:{};
  const memberName=typeof sale?.member==='string'?sale.member:member.name;
  const savedBranch=['head','branch','none'].includes(saved.branch)?saved.branch:null;
  const memberBranch=['head','branch'].includes(member.branch)?member.branch:'none';
  return {
    name:String(saved.name||memberName||sale?.name||'ลูกค้าทั่วไป'),
    taxId:String(saved.taxId||member.taxId||''),address:String(saved.address||member.address||''),
    branch:savedBranch||memberBranch,branchNo:String(saved.branchNo||member.branchNo||''),
    phone:String(saved.phone||member.phone||'')
  };
}

function openA4CashReceiptModal(saleId){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale||sale.status!=='done') return;
  const customer=a4CashReceiptCustomer(sale),meta=sale.cashReceiptA4Meta||{};
  const documentNumber=meta.number||nextA4CashReceiptNumber();
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:650px;max-height:92vh;"><div class="modal-head"><div><h3>บิลเงินสด</h3><div class="sub">เลขที่ ${escapeHtml(documentNumber)} · วันที่ขาย ${fmtDateShort(sale.date)}</div></div><button class="modal-close" aria-label="ปิด">×</button></div>
    <div class="tax-lock-note" style="margin:0 20px 16px;">เอกสารนี้เป็นหลักฐานรับเงิน ไม่ใช่ใบกำกับภาษี และการพิมพ์จะไม่เพิ่มยอดขายหรือตัดสต๊อกซ้ำ</div>
    <form id="a4CashReceiptForm"><div class="tax-customer-form">
      <div class="wide"><label>ชื่อผู้ซื้อ / ลูกค้า</label><input id="a4_receipt_customer_name" value="${escapeHtml(customer.name)}" placeholder="ลูกค้าทั่วไป หรือชื่อกิจการ"></div>
      <div><label>เลขประจำตัวผู้เสียภาษี (ถ้ามี)</label><input id="a4_receipt_customer_tax_id" value="${escapeHtml(customer.taxId)}" inputmode="numeric" maxlength="13" placeholder="13 หลัก"></div>
      <div><label>เบอร์โทรศัพท์ (ถ้ามี)</label><input id="a4_receipt_customer_phone" value="${escapeHtml(customer.phone)}" placeholder="เบอร์โทรศัพท์"></div>
      <div><label>สถานประกอบการ (ถ้ามี)</label><select id="a4_receipt_customer_branch"><option value="none" ${customer.branch==='none'?'selected':''}>ไม่ระบุ</option><option value="head" ${customer.branch==='head'?'selected':''}>สำนักงานใหญ่</option><option value="branch" ${customer.branch==='branch'?'selected':''}>สาขา</option></select></div>
      <div><label>เลขที่สาขา (ถ้ามี)</label><input id="a4_receipt_customer_branch_no" value="${escapeHtml(customer.branchNo)}" inputmode="numeric" maxlength="5" placeholder="00000" ${customer.branch==='branch'?'':'disabled'}></div>
      <div class="wide"><label>ที่อยู่ (ถ้ามี)</label><textarea id="a4_receipt_customer_address" rows="3" placeholder="ที่อยู่สำหรับแสดงในเอกสาร">${escapeHtml(customer.address)}</textarea></div>
    </div><div class="payment-actions"><button class="btn ghost" type="button" id="closeA4CashReceiptBtn">ปิด</button><button class="btn primary" type="submit">พิมพ์ A4</button></div></form></div>`;
  document.body.appendChild(overlay);
  const close=()=>{ overlay.remove(); if(currentTab==='cashbill') render(); };
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#closeA4CashReceiptBtn').onclick=close;
  const branchSelect=overlay.querySelector('#a4_receipt_customer_branch'),branchNoInput=overlay.querySelector('#a4_receipt_customer_branch_no');
  branchSelect.onchange=()=>{ const isBranch=branchSelect.value==='branch'; branchNoInput.disabled=!isBranch; if(!isBranch) branchNoInput.value=''; };
  const collect=()=>{
    const get=id=>String(overlay.querySelector(`#${id}`)?.value||'').trim();
    const branchValue=get('a4_receipt_customer_branch');
    const data={name:get('a4_receipt_customer_name')||'ลูกค้าทั่วไป',taxId:get('a4_receipt_customer_tax_id').replace(/\D/g,''),phone:get('a4_receipt_customer_phone'),branch:branchValue==='branch'?'branch':branchValue==='head'?'head':'none',branchNo:branchValue==='branch'?get('a4_receipt_customer_branch_no').replace(/\D/g,''):'',address:get('a4_receipt_customer_address')};
    if(data.taxId&&!/^\d{13}$/.test(data.taxId)){ showToast('เลขประจำตัวผู้เสียภาษีลูกค้าต้องมี 13 หลัก','danger-top'); overlay.querySelector('#a4_receipt_customer_tax_id')?.focus(); return null; }
    if(data.branch==='branch'&&!/^\d{5}$/.test(data.branchNo)){ showToast('เลขที่สาขาลูกค้าต้องมี 5 หลัก','danger-top'); overlay.querySelector('#a4_receipt_customer_branch_no')?.focus(); return null; }
    return data;
  };
  const issue=async()=>{
    const data=collect(); if(!data) return;
    const old=sale.cashReceiptA4Meta||{};
    const cashReceiptA4Meta={number:old.number||documentNumber,saleDate:sale.date,issuedAt:old.issuedAt||auditNow(),customer:data,printLog:Array.isArray(old.printLog)?old.printLog:[]};
    const previewWindow=window.open('','_blank');
    if(!previewWindow){ showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร','danger-top'); return; }
    previewWindow.document.write('<!doctype html><html lang="th"><body style="font-family:sans-serif;padding:24px">กำลังเตรียมเอกสาร...</body></html>');
    try{
      await updateSaleDocumentMetadata(sale.id,{cashReceiptA4Meta});
      printA4CashReceipt(saleId,previewWindow);
    }catch(error){
      console.warn('issue cash bill',error);
      previewWindow.close();
      showToast('บันทึกบิลเงินสดไม่สำเร็จ กรุณาลองใหม่','danger-top');
    }
  };
  overlay.querySelector('#a4CashReceiptForm').onsubmit=event=>{ event.preventDefault(); issue(); };
}

function printA4CashReceipt(saleId,previewWindow=null){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale||sale.status!=='done') return;
  const old=sale.cashReceiptA4Meta||{},customer=old.customer||a4CashReceiptCustomer(sale);
  const meta={number:old.number||nextA4CashReceiptNumber(),saleDate:old.saleDate||sale.date,issuedAt:old.issuedAt||auditNow(),customer,printLog:Array.isArray(old.printLog)?old.printLog:[]};
  const isCopy=meta.printLog.length>0,business={...(sale.businessSnapshot||businessSettings),line:sale.businessSnapshot?.line||businessSettings.line||''},tax=saleTaxSummary(sale),registered=tax.registered;
  const lineAmount=item=>item.lineTotalGross!==undefined?Number(item.lineTotalGross)||0:item.lineTotal!==undefined?Number(item.lineTotal)||0:(Number(item.qty)||0)*(Number(item.price)||0);
  const itemsTotal=(sale.items||[]).reduce((sum,item)=>sum+lineAmount(item),0);
  const rows=(sale.items||[]).map((item,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(item.name)}${item.promoName?`<br><small class="promo">🏷 ${escapeHtml(item.promoName)}</small>`:''}${item.promoFreeQty?`<br><small class="promo">🎁 แถมฟรี ${escapeHtml(item.promoFreeQty)} ${escapeHtml(item.unit||'')}</small>`:''}</td><td class="num">${escapeHtml(item.qty)}</td><td>${escapeHtml(item.unit||'-')}</td><td class="num">${fmtMoney(grossAmountForVatMode(item.price,item.vatMode,registered))}</td><td class="num">${fmtMoney(lineAmount(item))}</td></tr>`).join('');
  const businessName=businessDocumentName(business,STORE_INFO.name,{registered});
  const customerBranch=customer.branch==='branch'?`สาขา ${escapeHtml(customer.branchNo||'-')}`:customer.branch==='head'?'สำนักงานใหญ่':'';
  const win=previewWindow||window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร','danger-top'); return; }
  if(previewWindow) win.document.open();
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>พิมพ์ - ${escapeHtml(meta.number)}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#f0f0f0;color:#151515;font-family:'Sarabun',sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#fff;box-shadow:0 2px 8px #0002}.toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:9px 18px;font:600 14px Sarabun}.page{position:relative;width:210mm;min-height:297mm;margin:12px auto;padding:16mm 18mm;background:#fff;box-shadow:0 4px 20px #0002;overflow:hidden}.header{display:grid;grid-template-columns:1.15fr 1fr;gap:14mm;margin-top:2mm}.business{font-size:11.5px;line-height:1.6}.business-name,.customer-name{color:#4F4038;font-weight:700}.business-name{font-size:13px}.title-block{text-align:right}.title{color:#4F4038;font-size:21px;font-weight:700;margin-bottom:2px}.subtitle{color:#667085;font-size:12px;margin-bottom:8px}.not-tax{display:inline-block;margin-top:3px;padding:3px 8px;border:1px solid #efb5ae;border-radius:12px;color:#b42318;font-size:10.5px;font-weight:600}.docmeta{display:inline-grid;grid-template-columns:auto auto;gap:4px 14px;text-align:left;font-size:12px;margin-top:8px}.docmeta span:nth-child(odd){color:#4F4038;font-weight:600}.customer{margin:9mm 0 5mm;padding:4mm 5mm;border:1px solid #E8DEDA;border-radius:6px}.customer div{font-size:12px;line-height:1.5}.items{width:100%;border-collapse:collapse;font-size:12px;margin-top:2mm}.items th{background:#4F4038;color:#fff;padding:7px 8px;text-align:left;font-weight:600}.items th.num,.items td.num{text-align:right}.items td{padding:7px 8px;border-bottom:1px solid #e4e8ec}.promo{color:#4F4038;font-weight:600}.summary-row{display:grid;grid-template-columns:1fr 82mm;gap:10mm;margin-top:6mm}.words{align-self:end;padding:5px 8px;border-bottom:1px solid #E8DEDA;font-size:12px}.totals{font-size:12.5px}.totals div{display:flex;justify-content:space-between;padding:4px 0}.totals .grand{font-weight:700;border-top:1px solid #4F4038;margin-top:2px;padding-top:7px}.totals .grand span{color:#4F4038}.notice{margin-top:8mm;padding:7px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:5px;color:#9a3412;font-size:11px;text-align:center}.signheads{position:absolute;left:18mm;right:18mm;bottom:30mm;display:flex;justify-content:space-between;font-size:12px}.signheads span{width:60mm;text-align:center}.signlines{position:absolute;left:18mm;right:18mm;bottom:14mm;display:flex;justify-content:space-between;text-align:center;font-size:11px}.signlines div{width:60mm;border-top:1px solid #888;padding-top:4px}@media print{body{background:#fff}.toolbar{display:none}.page{margin:0;box-shadow:none}}</style></head><body><div class="toolbar"><span>ตัวอย่างบิลเงินสด A4</span><button onclick="window.print()">พิมพ์</button></div><main class="page"><section class="header"><div class="business"><span class="business-name">${escapeHtml(businessName)}</span><br>${escapeHtml(business.address||STORE_INFO.address)}${(business.taxId||STORE_INFO.taxId)?`<br>เลขประจำตัวผู้เสียภาษี ${escapeHtml(business.taxId||STORE_INFO.taxId)}`:''}${businessPrimaryPhone(business)?`<br>เบอร์ติดต่อ ${escapeHtml(businessPrimaryPhone(business))}`:''}${business.line?`<br>LINE ${escapeHtml(business.line)}`:''}${(business.website||STORE_INFO.website)?`<br>${escapeHtml(business.website||STORE_INFO.website)}`:''}</div><div class="title-block"><div class="title">บิลเงินสด</div><div class="subtitle">${isCopy?'สำเนา':'ต้นฉบับ'}</div><div class="not-tax">เอกสารนี้ไม่ใช่ใบกำกับภาษี</div><div class="docmeta"><span>เลขที่</span><span>${escapeHtml(meta.number)}</span><span>วันที่</span><span>${fmtDateShort(meta.saleDate)}</span><span>เวลา</span><span>${escapeHtml((sale.time||'').slice(11)||'-')}</span><span>ผู้ขาย</span><span>${escapeHtml(sale.cashier||'-')}</span><span>ชำระโดย</span><span>${escapeHtml(sale.payMethod||'-')}</span></div></div></section><section class="customer"><div class="customer-name">ผู้ซื้อ: ${escapeHtml(customer.name||'ลูกค้าทั่วไป')}${customerBranch?` (${customerBranch})`:''}</div><div>${escapeHtml(customer.address||'-')}</div><div>เลขประจำตัวผู้เสียภาษี ${escapeHtml(customer.taxId||'-')}${customer.phone?` · โทร ${escapeHtml(customer.phone)}`:''}</div></section><table class="items"><thead><tr><th>#</th><th>รายละเอียด</th><th class="num">จำนวน</th><th>หน่วย</th><th class="num">ราคาต่อหน่วย</th><th class="num">จำนวนเงิน</th></tr></thead><tbody>${rows}</tbody></table><section class="summary-row"><div class="words">(${bahtText(Number(sale.total)||0)})</div><div class="totals"><div><span>รวมรายการ</span><b>${fmtMoney(itemsTotal)} บาท</b></div>${sale.discount?`<div><span>ส่วนลด</span><b>- ${fmtMoney(sale.discount)} บาท</b></div>`:''}${sale.fee?`<div><span>ค่าธรรมเนียม</span><b>${fmtMoney(sale.fee)} บาท</b></div>`:''}<div class="grand"><span>จำนวนเงินรวมทั้งสิ้น</span><b>${fmtMoney(sale.total)} บาท</b></div></div></section><div class="notice">เอกสารนี้เป็นหลักฐานการรับชำระเงิน ไม่ใช่ใบกำกับภาษี และใช้เป็นหลักฐานภาษีซื้อไม่ได้</div><div class="signheads"><span>ในนาม ${escapeHtml(customer.name||'ลูกค้าทั่วไป')}</span><span>ในนาม ${escapeHtml(business.name||STORE_INFO.name)}</span></div><div class="signlines"><div>ผู้รับสินค้า / บริการ · วันที่</div><div>ผู้รับเงิน · วันที่</div></div></main></body></html>`);
  win.document.close();
  standardizePrintPreview(win);
  meta.printLog.push({at:auditNow(),mode:'print'});
  sale.cashReceiptA4Meta=meta;
  updateSaleDocumentMetadata(sale.id,{cashReceiptA4Meta:meta}).catch(error=>{
    console.warn('log cash bill print',error);
    showToast('พิมพ์เอกสารได้ แต่บันทึกประวัติการพิมพ์ไม่สำเร็จ','danger-top');
  });
  setTimeout(()=>win.print(),350);
}

function openFullTaxInvoiceModal(saleId){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale||sale.status!=='done') return;
  if(!sale.fullTaxInvoice&&!canIssueTaxInvoiceForSale(sale)){ showToast('รายการขายนี้ออกใบกำกับภาษีไม่ได้','danger'); return; }
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  const shell=document.createElement('div'); shell.className='modal'; shell.style.cssText='width:700px;max-height:92vh;'; overlay.appendChild(shell); document.body.appendChild(overlay);
  const close=()=>{ overlay.remove(); render(); };
  const paint=()=>{
    const invoice=sale.fullTaxInvoice;
    if(invoice){
      const customer=invoice.customer||{};
      shell.innerHTML=`<div class="modal-head"><h3>ใบกำกับภาษีเต็มรูปแบบ</h3><button class="modal-close">×</button></div>
        <div class="issued-doc-card"><strong>${escapeHtml(invoice.number)}</strong><div>วันที่ขาย/วันที่เอกสาร: ${fmtDateShort(invoice.saleDate)}</div><div>ผู้ซื้อ: ${escapeHtml(customer.name||'-')}</div><div>เลขประจำตัวผู้เสียภาษี: ${escapeHtml(customer.taxId||'-')}</div><div>สถานประกอบการ: ${customer.branch==='branch'?`สาขา ${escapeHtml(customer.branchNo||'-')}`:'สำนักงานใหญ่'}</div><div>ออกเอกสารเมื่อ: ${auditDisplay(invoice.issuedAt)}</div><div>พิมพ์แล้ว: ${invoice.printLog?.length||0} ครั้ง</div></div>
        <div class="modal-sub" style="padding-top:0;">ข้อมูลเอกสารถูกล็อกแล้ว การพิมพ์ครั้งถัดไปจะใช้เลขที่และวันที่เดิม พร้อมระบุว่าเป็นสำเนา</div>
        <div class="payment-actions"><button class="btn ghost" id="closeTaxInvoiceBtn">ปิด</button><button class="btn primary" id="printTaxInvoiceBtn">พิมพ์</button></div>`;
      shell.querySelector('.modal-close').onclick=close;
      shell.querySelector('#closeTaxInvoiceBtn').onclick=close;
      shell.querySelector('#printTaxInvoiceBtn').onclick=()=>{ printFullTaxInvoice(saleId); paint(); };
      return;
    }
    shell.innerHTML=`<div class="modal-head"><h3>ออกใบกำกับภาษีเต็มรูปแบบ</h3><button class="modal-close">×</button></div>
      <div class="modal-sub">กรอกข้อมูลผู้ซื้อครั้งแรก เมื่อตกลงออกเอกสารแล้วข้อมูลและวันที่ขายจะถูกล็อก</div>
      <form id="fullTaxInvoiceForm"><div class="tax-customer-form">
        <div><label>วันที่ขาย/วันที่เอกสาร</label><input value="${fmtDateShort(sale.date)}" readonly></div><div><label>อ้างอิงใบเสร็จอย่างย่อ</label><input value="${escapeHtml(shortReceiptNumber(sale))}" readonly></div>
        <div class="wide"><label>ชื่อผู้ซื้อ/ชื่อบริษัท *</label><input id="tax_customer_name" required autocomplete="off"></div>
        <div><label>เลขประจำตัวผู้เสียภาษี *</label><input id="tax_customer_id" required maxlength="13" inputmode="numeric" autocomplete="off"></div>
        <div><label>สถานประกอบการ *</label><select id="tax_customer_branch"><option value="head">สำนักงานใหญ่</option><option value="branch">สาขา</option></select></div>
        <div><label>เลขที่สาขา</label><input id="tax_customer_branch_no" placeholder="เช่น 00001" maxlength="5"></div>
        <div><label>เบอร์โทร</label><input id="tax_customer_phone" class="phone-input" autocomplete="off"></div>
        <div><label>อีเมล</label><input id="tax_customer_email" type="email" autocomplete="off"></div>
        <div class="wide"><label>ที่อยู่ *</label><textarea id="tax_customer_address" rows="3" required></textarea></div>
        <div class="tax-lock-note">🔒 ระบบไม่อนุญาตให้เปลี่ยนวันที่ขายหรือยอดเงิน และการออกเอกสารนี้จะไม่ตัดสต็อกหรือเพิ่มยอดขายซ้ำ</div>
      </div><div class="payment-actions"><button class="btn ghost" type="button" id="cancelTaxInvoiceBtn">ยกเลิก</button><button class="btn primary" type="submit">ออกเอกสารและล็อกข้อมูล</button></div></form>`;
    shell.querySelector('.modal-close').onclick=close;
    shell.querySelector('#cancelTaxInvoiceBtn').onclick=close;
    shell.querySelector('#fullTaxInvoiceForm').onsubmit=async e=>{
      e.preventDefault();
      const get=id=>shell.querySelector('#'+id).value.trim();
      const branch=get('tax_customer_branch'),branchNo=get('tax_customer_branch_no').replace(/\D/g,''),taxId=get('tax_customer_id').replace(/\D/g,'');
      if(!/^\d{13}$/.test(taxId)){ showToast('เลขประจำตัวผู้เสียภาษีลูกค้าต้องมี 13 หลัก','danger'); shell.querySelector('#tax_customer_id').focus(); return; }
      if(branch==='branch'&&!/^\d{5}$/.test(branchNo)){ showToast('เลขที่สาขาลูกค้าต้องมี 5 หลัก','danger'); shell.querySelector('#tax_customer_branch_no').focus(); return; }
      const fullTaxInvoice={number:fullTaxInvoiceNumber(sale),saleDate:sale.date,issuedAt:auditNow(),customer:{name:get('tax_customer_name'),taxId,branch,branchNo,phone:get('tax_customer_phone'),email:get('tax_customer_email'),address:get('tax_customer_address')},printLog:[]};
      try{
        const updated=await updateSaleDocumentMetadata(sale.id,{fullTaxInvoice});
        Object.assign(sale,updated);
        showToast(`ออกใบกำกับภาษี ${sale.fullTaxInvoice?.number||fullTaxInvoice.number} แล้ว`);
        paint();
      }catch(error){
        console.warn('issue full tax invoice',error);
        showToast('ออกใบกำกับภาษีไม่สำเร็จ กรุณาลองใหม่','danger-top');
      }
    };
  };

  paint();
}

function printFullTaxInvoice(saleId){
  const standaloneDoc=standaloneTaxInvoices.find(item=>item.number===saleId);
  const sale=salesHistory.find(item=>item.id===saleId)||(standaloneDoc?{id:standaloneDoc.number,ref:'สร้างเอกสารใหม่',date:standaloneDoc.saleDate||standaloneDoc.date,time:(standaloneDoc.saleDate||standaloneDoc.date)+' 00:00',cashier:currentUserProfile.firstName+' '+currentUserProfile.lastName,payMethod:'-',items:standaloneDoc.items||[],discount:standaloneDoc.discount||0,total:standaloneDoc.total||0,businessSnapshot:standaloneDoc.businessSnapshot||null,fullTaxInvoice:standaloneDoc}:null);
  const invoice=sale?.fullTaxInvoice; if(!sale||!invoice) return;
  invoice.printLog=invoice.printLog||[];
  const isCopy=invoice.printLog.length>0,customer=invoice.customer||{};
  const tax=standaloneDoc?(standaloneDoc.taxSummary||calculateDocumentTaxSummary(sale.items||[],sale.discount||0,true,standaloneDoc.businessSnapshot||businessSettings)):saleTaxSummary(sale);
  const total=tax.total,beforeVat=tax.beforeVat,vat=tax.vat,business=sale.businessSnapshot||businessSettings;
  const lineAmount=item=>item.lineTotalGross!==undefined?Number(item.lineTotalGross)||0:item.lineTotal!==undefined?Number(item.lineTotal)||0:(Number(item.qty)||0)*(Number(item.price)||0);
  const rows=(sale.items||[]).map((item,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(item.name)}${item.promoName?`<br><small class="tax-promo-tag">🏷 ${escapeHtml(item.promoName)}</small>`:''}${item.promoFreeQty?`<br><small class="tax-promo-tag">🎁 แถมฟรี ${item.promoFreeQty} ${escapeHtml(item.unit||'')}</small>`:''}</td><td class="num">${item.qty}</td><td>${escapeHtml(item.unit||'-')}</td><td class="num">${fmtMoney(grossAmountForVatMode(item.price,item.vatMode,true))}</td><td class="num">${fmtMoney(lineAmount(item))}</td></tr>`).join('')+(sale.fee?`<tr><td>${(sale.items||[]).length+1}</td><td>ค่าธรรมเนียมบัตร</td><td class="num">1</td><td>รายการ</td><td class="num">${fmtMoney(sale.fee)}</td><td class="num">${fmtMoney(sale.fee)}</td></tr>`:'');
  const win=window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร'); return; }
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>พิมพ์ - ${escapeHtml(invoice.number)}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#F0F0F0;color:#151515;font-family:'Sarabun',sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#fff;box-shadow:0 2px 8px #0002}.toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:9px 18px;font:600 14px Sarabun}.page{position:relative;width:210mm;min-height:297mm;margin:12px auto;padding:16mm 18mm;background:#fff;box-shadow:0 4px 20px #0002;overflow:hidden}.header{display:grid;grid-template-columns:1.15fr 1fr;gap:14mm;margin-top:2mm}.business{font-size:11.5px;line-height:1.6}.business-name,.customer-name{color:#4F4038;font-weight:700}.business-name{font-size:13px}.title-block{text-align:right}.title{color:#4F4038;font-size:22px;font-weight:700;margin-bottom:2px}.subtitle{color:#4F4038;font-size:12px;margin-bottom:8px}.docmeta{display:inline-grid;grid-template-columns:auto auto;gap:4px 14px;text-align:left;font-size:12px;margin-top:4px}.docmeta span:nth-child(odd){color:#4F4038;font-weight:600}.customer{margin:9mm 0 5mm}.customer div{font-size:12px;line-height:1.5}.items{width:100%;border-collapse:collapse;font-size:12px;margin-top:2mm}.items th{background:#4F4038;color:#fff;padding:7px 8px;text-align:left;font-weight:600}.items th.num,.items td.num{text-align:right}.items td{padding:7px 8px;border-bottom:1px solid #e4e8ec}.tax-promo-tag{color:#4F4038;font-weight:600;}.totals{width:82mm;margin:6mm 0 0 auto;font-size:12.5px}.totals div{display:flex;justify-content:space-between;padding:4px 0}.totals .lbl{color:#151515}.totals .grand{font-weight:700;border-top:1px solid #4F4038;margin-top:2px;padding-top:6px}.totals .grand span{color:#4F4038}.signheads{position:absolute;left:18mm;right:18mm;bottom:30mm;display:flex;justify-content:space-between;font-size:12px}.signheads span{width:60mm;text-align:center}.signheads span:last-child{text-align:center}.signlines{position:absolute;left:18mm;right:18mm;bottom:14mm;display:flex;justify-content:space-between;text-align:center;font-size:11px}.signlines div{width:60mm;border-top:1px solid #888;padding-top:4px}@media print{body{background:#fff}.toolbar{display:none}.page{margin:0;box-shadow:none}}</style></head><body><div class="toolbar"><span>ตัวอย่างเอกสาร A4</span><button onclick="window.print()">พิมพ์</button></div><main class="page"><section class="header"><div class="business"><span class="business-name">${escapeHtml(businessDocumentName(business,STORE_INFO.name,{registered:true}))}</span><br>${escapeHtml(business.address||STORE_INFO.address)}<br>เลขประจำตัวผู้เสียภาษี ${escapeHtml(business.taxId||STORE_INFO.taxId)}${businessPrimaryPhone(business)?`<br>เบอร์ติดต่อ ${escapeHtml(businessPrimaryPhone(business))}`:''}${(business.website||STORE_INFO.website)?`<br>${escapeHtml(business.website||STORE_INFO.website)}`:''}</div><div class="title-block"><div class="title">ใบกำกับภาษี</div><div class="subtitle">${isCopy?'สำเนา':'ต้นฉบับ'}</div><div class="docmeta"><span>เลขที่</span><span>${escapeHtml(invoice.number)}</span><span>วันที่</span><span>${fmtDateShort(invoice.saleDate)}</span><span>ครบกำหนด</span><span>${fmtDateShort(invoice.saleDate)}</span><span>ผู้ขาย</span><span>${escapeHtml((currentUserProfile.firstName+' '+currentUserProfile.lastName).trim()||sale.cashier||'-')}</span></div></div></section><section class="customer"><div class="customer-name">${escapeHtml(customer.name||'-')} (${customer.branch==='branch'?`สาขา ${escapeHtml(customer.branchNo||'-')}`:'สำนักงานใหญ่'})</div><div>${escapeHtml(customer.address||'-')}</div><div>เลขประจำตัวผู้เสียภาษี ${escapeHtml(customer.taxId||'-')}${customer.phone?` · โทร ${escapeHtml(customer.phone)}`:''}</div></section><table class="items"><thead><tr><th>#</th><th>รายละเอียด</th><th class="num">จำนวน</th><th>หน่วย</th><th class="num">ราคาต่อหน่วย</th><th class="num">ยอดรวม</th></tr></thead><tbody>${rows}</tbody></table><section class="totals"><div><span class="lbl">รวมเป็นเงิน</span><b>${fmtMoney(beforeVat+vat)} บาท</b></div><div><span class="lbl">ภาษีมูลค่าเพิ่ม 7%</span><b>${fmtMoney(vat)} บาท</b></div><div><span class="lbl">ราคาไม่รวมภาษีมูลค่าเพิ่ม</span><b>${fmtMoney(beforeVat)} บาท</b></div><div class="grand"><span>จำนวนเงินรวมทั้งสิ้น</span><b>${fmtMoney(total)} บาท</b></div></section><div class="signheads"><span>ในนาม ${escapeHtml(customer.name||'-')}</span><span>ในนาม ${escapeHtml(business.name||STORE_INFO.name)}</span></div><div class="signlines"><div>ผู้รับสินค้า / บริการ · วันที่</div><div>ผู้อนุมัติ · วันที่</div></div></main></body></html>`);
  win.document.close();
  const printColorStyle=win.document.createElement('style');
  printColorStyle.textContent='*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{padding-top:66px!important;padding-right:285px!important}.items th{background:#4F4038!important;color:#fff!important}.business{padding-top:50px!important}.title-block{text-align:center!important}.docmeta{display:grid!important;width:100%!important;text-align:left!important;border-top:2px solid #d5d5d5;border-bottom:2px solid #d5d5d5;padding:12px 8px!important;margin-top:8px!important}.page{page-break-after:always}.page:last-child{page-break-after:auto}.toolbar{position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:30!important;height:66px!important;margin:0!important;padding:10px 18px!important;background:#fff!important;border-bottom:1px solid #dce3e8!important;display:flex!important;align-items:center!important;gap:14px!important}.preview-doc-number{color:#4F4038;font-size:20px;font-weight:500;letter-spacing:.2px}.preview-actions{display:flex;align-items:center;gap:10px;margin-left:auto}.preview-actions button{height:42px;min-width:142px;border-radius:6px;font:600 15px Sarabun;cursor:pointer}.preview-actions .close-preview{background:#fff;color:#6d7882;border:1px solid #bfc9d2}.preview-actions #confirmTaxPrint{background:#4F4038;color:#fff;border:1px solid #4F4038}.tax-print-sidebar{position:fixed;top:66px;right:0;bottom:0;z-index:25;width:285px;padding:20px 22px;background:#fff;border-left:1px solid #dce3e8;color:#1f2933}.tax-print-sidebar h3{margin:0 0 14px;font-size:17px}.tax-print-options{display:flex;align-items:center;gap:18px}.tax-print-options label{display:flex;align-items:center;gap:7px;font-weight:600;white-space:nowrap}.tax-print-options input[type=checkbox]{width:18px;height:18px;accent-color:#4F4038}.tax-print-options input[type=number]{width:62px;height:38px;padding:6px 8px;border:1px solid #ccd5dd;border-radius:7px;font:600 14px Sarabun}@media print{body{padding:0!important}.toolbar,.tax-print-sidebar{display:none!important}.page{margin:0 auto!important}}';
  win.document.head.appendChild(printColorStyle);
  const printTemplate=win.document.querySelector('.page').cloneNode(true);
  const toolbar=win.document.querySelector('.toolbar');
  toolbar.innerHTML='<div class="preview-actions"><button type="button" class="close-preview" id="closeTaxPreview">ย้อนกลับ</button><button type="button" id="confirmTaxPrint">พิมพ์</button></div>';
  const printSidebar=win.document.createElement('aside');
  printSidebar.className='tax-print-sidebar';
  printSidebar.innerHTML='<h3>ใบกำกับภาษี</h3><div class="tax-print-options"><label><input id="printOriginalOption" type="checkbox" checked> ต้นฉบับ</label><label><input id="printCopyOption" type="checkbox" checked> สำเนา</label><input id="printCopyCount" type="number" min="1" max="20" value="1" aria-label="จำนวนสำเนา"></div>';
  win.document.body.appendChild(printSidebar);
  const rebuildTaxPrintPages=()=>{
    const includeOriginal=win.document.getElementById('printOriginalOption').checked;
    const includeCopy=win.document.getElementById('printCopyOption').checked;
    const copyCount=Math.max(1,Math.min(20,Number(win.document.getElementById('printCopyCount').value)||1));
    if(!includeOriginal&&!includeCopy){ win.alert('กรุณาเลือกต้นฉบับหรือสำเนาอย่างน้อย 1 รายการ'); return false; }
    win.document.querySelectorAll('.page').forEach(page=>page.remove());
    const appendPage=label=>{ const page=printTemplate.cloneNode(true); const subtitle=page.querySelector('.subtitle'); if(subtitle) subtitle.textContent=label; win.document.body.appendChild(page); };
    if(includeOriginal) appendPage('ต้นฉบับ');
    if(includeCopy) for(let i=0;i<copyCount;i++) appendPage('สำเนา');
    return true;
  };
  win.document.getElementById('closeTaxPreview').onclick=()=>win.close();
  win.document.getElementById('confirmTaxPrint').onclick=()=>{ if(rebuildTaxPrintPages()) win.print(); };
  const initialSubtitle=win.document.querySelector('.subtitle'); if(initialSubtitle) initialSubtitle.textContent='ต้นฉบับ';
  invoice.printLog.push({at:auditNow(),mode:'print'});
  if(standaloneDoc) persistStandaloneTaxInvoices();
  else{
    updateSaleDocumentMetadata(sale.id,{fullTaxInvoice:invoice}).catch(error=>{
      console.warn('log tax invoice print',error);
      showToast('พิมพ์เอกสารได้ แต่บันทึกประวัติการพิมพ์ไม่สำเร็จ','danger-top');
    });
  }
}

function printQuotation(quotationIds){
  const ids=Array.isArray(quotationIds)?quotationIds:[quotationIds];
  const docs=ids.map(id=>quotations.find(q=>q.id===id)).filter(Boolean); if(!docs.length) return;
  const win=window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร'); return; }
  const pages=docs.map(doc=>{
    const customer=doc.customerInfo||{};
    const business=doc.businessSnapshot||businessSettings;
    const registered=doc.vatRegistered===true;
    const tax=doc.taxSummary||(registered?calculateDocumentTaxSummary(doc.items||[],doc.discount||0,true,business):calculateDocumentTaxSummary(doc.items||[],doc.discount||0,false,business));
    const total=tax.total,beforeVat=tax.beforeVat,vat=tax.vat;
    const rows=(doc.items||[]).map((item,index)=>{ const mode=documentItemVatMode(item,registered,business); const line=(Number(item.qty)||0)*(Number(item.price)||0); return `<tr><td>${index+1}</td><td>${escapeHtml(item.name)}</td><td class="num">${item.qty}</td><td>${escapeHtml(item.unit||'-')}</td><td class="num">${fmtMoney(grossAmountForVatMode(item.price,mode,registered))}</td><td class="num">${fmtMoney(grossAmountForVatMode(line,mode,registered))}</td></tr>`; }).join('');
    const taxRows=registered?`<div><span class="lbl">ภาษีมูลค่าเพิ่ม 7%</span><b>${fmtMoney(vat)} บาท</b></div><div><span class="lbl">มูลค่าก่อนภาษีมูลค่าเพิ่ม</span><b>${fmtMoney(beforeVat)} บาท</b></div>`:`<div><span class="lbl">ไม่คิด VAT (กิจการยังไม่จด VAT)</span><b>0.00 บาท</b></div><div><span class="lbl">มูลค่าสินค้า</span><b>${fmtMoney(beforeVat)} บาท</b></div>`;
    return `<main class="page"><section class="header"><div class="business"><b style="font-size:13px;">${escapeHtml(businessDocumentName(business,STORE_INFO.name,{registered}))}</b><br>${escapeHtml(business.address||STORE_INFO.address)}${(business.taxId||STORE_INFO.taxId)?`<br>เลขประจำตัวผู้เสียภาษี ${escapeHtml(business.taxId||STORE_INFO.taxId)}`:''}${businessPrimaryPhone(business)?`<br>เบอร์ติดต่อ ${escapeHtml(businessPrimaryPhone(business))}`:''}${(business.website||STORE_INFO.website)?`<br>${escapeHtml(business.website||STORE_INFO.website)}`:''}</div><div class="title-block"><div class="title">ใบเสนอราคา</div><div class="docmeta"><span>เลขที่</span><span>${escapeHtml(doc.id)}</span><span>วันที่</span><span>${fmtDateShort(doc.date)}</span><span>ครบกำหนด</span><span>${fmtDateShort(doc.dueDate||doc.date)}</span><span>ผู้ขาย</span><span>${escapeHtml((currentUserProfile.firstName+' '+currentUserProfile.lastName).trim()||'-')}</span></div></div></section><section class="customer"><div class="lbl">ลูกค้า</div><div>${escapeHtml(customer.name||doc.customer||'-')} (${customer.branch==='branch'?`สาขา ${escapeHtml(customer.branchNo||'-')}`:'สำนักงานใหญ่'})</div><div>${escapeHtml(customer.address||'-')}</div><div>เลขประจำตัวผู้เสียภาษี ${escapeHtml(customer.taxId||'-')}${customer.phone?` · โทร ${escapeHtml(customer.phone)}`:''}</div></section><table class="items"><thead><tr><th>#</th><th>รายละเอียด</th><th class="num">จำนวน</th><th>หน่วย</th><th class="num">ราคาต่อหน่วย</th><th class="num">ยอดรวม</th></tr></thead><tbody>${rows}</tbody></table><section class="totals"><div><span class="lbl">รวมเป็นเงิน</span><b>${fmtMoney(tax.subtotal)} บาท</b></div>${taxRows}<div class="grand"><span>จำนวนเงินรวมทั้งสิ้น</span><b>${fmtMoney(total)} บาท</b></div></section><div class="words">(${bahtText(total)})</div><div class="signheads"><span>ในนาม ${escapeHtml(customer.name||doc.customer||'-')}</span><span>ในนาม ${escapeHtml(business.name||STORE_INFO.name)}</span></div><div class="signlines"><div>ผู้รับการเสนอราคา · วันที่</div><div>ผู้เสนอราคา · วันที่</div></div></main>`;
  }).join('');
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>พิมพ์ - ${docs.map(d=>escapeHtml(d.id)).join(', ')}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#F0F0F0;color:#151515;font-family:'Sarabun',sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#fff;box-shadow:0 2px 8px #0002}.toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:9px 18px;font:600 14px Sarabun}.page{position:relative;width:210mm;min-height:297mm;margin:12px auto;padding:16mm 18mm;background:#fff;box-shadow:0 4px 20px #0002;overflow:hidden;page-break-after:always}.page:last-child{page-break-after:auto}.header{display:grid;grid-template-columns:1.15fr 1fr;gap:14mm;margin-top:2mm}.business{font-size:11.5px;line-height:1.6}.title-block{text-align:right}.title{color:#4F4038;font-size:22px;font-weight:700;margin-bottom:8px}.docmeta{display:inline-grid;grid-template-columns:auto auto;gap:4px 14px;text-align:left;font-size:12px}.docmeta span:nth-child(odd){color:#4F4038;font-weight:600}.customer{margin:9mm 0 5mm}.customer .lbl{color:#4F4038;font-weight:600;font-size:12px;margin-bottom:2px}.customer div{font-size:12px;line-height:1.5}.items{width:100%;border-collapse:collapse;font-size:12px;margin-top:2mm}.items th{background:#4F4038;color:#fff;padding:7px 8px;text-align:left;font-weight:600}.items th.num,.items td.num{text-align:right}.items td{padding:7px 8px;border-bottom:1px solid #e4e8ec}.totals{width:82mm;margin:6mm 0 0 auto;font-size:12.5px}.totals div{display:flex;justify-content:space-between;padding:4px 0}.totals .lbl{color:#4F4038}.totals .grand{font-weight:700;border-top:1px solid #4F4038;margin-top:2px;padding-top:6px}.words{font-size:12px;margin-top:8mm}.signheads{position:absolute;left:18mm;right:18mm;bottom:30mm;display:flex;justify-content:space-between;font-size:12px}.signheads span{width:60mm;text-align:center}.signlines{position:absolute;left:18mm;right:18mm;bottom:14mm;display:flex;justify-content:space-between;text-align:center;font-size:11px}.signlines div{width:60mm;border-top:1px solid #888;padding-top:4px}@media print{body{background:#fff}.toolbar{display:none}.page{margin:0;box-shadow:none}}</style></head><body><div class="toolbar"><span>ตัวอย่างเอกสาร A4</span><button onclick="window.print()">พิมพ์</button></div>${pages}</body></html>`);
  win.document.close();
  standardizePrintPreview(win);
  setupA4DocumentPreview(win,{number:docs.map(doc=>doc.id).join(', '),label:'ใบเสนอราคา',pageSelector:'.page'});
}
