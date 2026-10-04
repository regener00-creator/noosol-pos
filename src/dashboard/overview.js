function renderDashboard(){
  const completedSales = salesHistory.filter(s=>s.status==='done').filter(s=>isAllWarehousesMode()||(s.items||[]).some(item=>String(saleWarehouseForReport(s,item,products.find(product=>Number(product.id)===Number(item.productId))||products.find(product=>product.name===item.name)||{}))===String(activeWarehouseId)));
  const todaySales = completedSales.filter(s=>(s.date||'').slice(0,10)===TODAY_STR);
  const monthKey = TODAY_STR.slice(0,7);
  const monthSales = completedSales.filter(s=>(s.date||'').slice(0,7)===monthKey);
  const todayTotal = todaySales.reduce((sum,s)=>sum+(Number(s.total)||0),0);
  const monthTotal = monthSales.reduce((sum,s)=>sum+(Number(s.total)||0),0);
  const hasProfitData = s=>Object.prototype.hasOwnProperty.call(s,'grossProfit') && Object.prototype.hasOwnProperty.call(s,'costTotal');
  const todayProfit = todaySales.filter(hasProfitData).reduce((sum,s)=>sum+(Number(s.grossProfit)||0),0);
  const monthProfit = monthSales.filter(hasProfitData).reduce((sum,s)=>sum+(Number(s.grossProfit)||0),0);
  const canViewProfit = !isLevel2User();
  const maxV = Math.max(...weekSales.map(x=>x.v));
  const itemCounts = {};
  monthSales.forEach(s=>(s.items||[]).filter(it=>!it.custom).forEach(it=>{ itemCounts[it.name]=(itemCounts[it.name]||0)+(Number(it.qty)||0); }));
  const topItems = Object.entries(itemCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const colors=['var(--primary)','var(--accent)','var(--info)','var(--danger)'];
  return `
    <div class="statrow" style="grid-template-columns:repeat(${canViewProfit?4:2},minmax(0,1fr));${canViewProfit?'':'max-width:520px;'}">
      <div class="stat"><div class="stat-heading"><div class="sicon teal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg></div><div class="slabel">ยอดขายวันนี้</div></div><div class="sval">${fmtMoney(todayTotal)}</div></div>
      ${canViewProfit?`
      <div class="stat"><div class="stat-heading"><div class="sicon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18V9m6 9V5m6 13v-7m4 7H2"/></svg></div><div class="slabel">กำไรวันนี้</div></div><div class="sval" style="color:${todayProfit>=0?'#2D7D3D':'var(--danger)'};">${todayProfit<0?'-':''}${fmtMoney(Math.abs(todayProfit))}</div></div>`:''}
      <div class="stat"><div class="stat-heading"><div class="sicon amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/></svg></div><div class="slabel">ยอดขายเดือนนี้</div></div><div class="sval">${fmtMoney(monthTotal)}</div></div>
      ${canViewProfit?`
      <div class="stat"><div class="stat-heading"><div class="sicon teal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="slabel">กำไรเดือนนี้</div></div><div class="sval" style="color:${monthProfit>=0?'#2D7D3D':'var(--danger)'};">${monthProfit<0?'-':''}${fmtMoney(Math.abs(monthProfit))}</div></div>`:''}
    </div>
    <div class="grid2col dashboard-grid2col">
      <div class="panel"><h3>ยอดขาย 7 วันล่าสุด</h3>
        <div class="barchart">${weekSales.map((w,i)=>`<div class="barcol"><span class="bval">${w.v}</span><div class="bar ${i===weekSales.length-1?'today':''}" style="height:${Math.max(8,w.v/maxV*120)}px"></div><span class="blabel">${w.d}</span></div>`).join('')}</div>
      </div>
      <div class="panel"><h3>สินค้าขายดี เดือนนี้</h3>
        <div class="dashboard-top-products"><div>${topItems.slice(0,5).map(([name,val],i)=>`<div class="legenditem"><span class="swatch" style="background:${colors[i%colors.length]}"></span><span class="lname">${escapeHtml(name)}</span><span class="lval">${val.toLocaleString('th-TH',{maximumFractionDigits:2})}</span></div>`).join('')}</div><div>${topItems.slice(5,10).map(([name,val],i)=>`<div class="legenditem"><span class="swatch" style="background:${colors[(i+5)%colors.length]}"></span><span class="lname">${escapeHtml(name)}</span><span class="lval">${val.toLocaleString('th-TH',{maximumFractionDigits:2})}</span></div>`).join('')}</div></div>
      </div>
    </div>
    <div class="panel">
      <div class="seamless-table-wrap"><table class="grid-table history-table"><colgroup><col class="ht-date"><col class="ht-bill"><col class="ht-time"><col class="ht-items"><col class="ht-total"><col class="ht-pay"></colgroup><thead><tr><th>วันที่</th><th>เลขที่บิล</th><th>เวลา</th><th>รายการ</th><th class="mono">ยอด</th><th>ชำระ</th></tr></thead>
      <tbody>${completedSales.length?completedSales.slice(0,8).map(s=>`<tr><td>${escapeHtml(fmtDate(s.date))}</td><td class="mono">${escapeHtml(s.ref||s.id)}</td><td>${escapeHtml(saleHistoryTimeDisplay(s.time))}</td><td class="history-items-cell">${salesHistoryItemsPreview(s.items)}</td><td class="mono num">${fmtMoney(s.total)}</td><td>${escapeHtml(s.payMethod||'-')}</td></tr>`).join(''):`<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px;">ยังไม่มีรายการขาย</td></tr>`}</tbody></table></div>
    </div>`;
}

function matchesBarcode(p, q){
  if(!q) return false;
  if((p.barcode||'').includes(q)) return true;
  if((p.extraBarcodes||[]).some(bc=>bc.includes(q))) return true;
  if((p.vendorBarcodes||[]).some(vb=>(vb.code||'').includes(q))) return true;
  if((p.units||[]).some(u=>(u.barcode||'').includes(q))) return true;
  return false;
}
// Exact-code lookup for barcode-scan flows (scanner + Enter key). Unlike
// matchesBarcode() (substring match, for live search-as-you-type), this
// requires an exact match and also reports WHICH unit the code belongs to
// -- scanning a box's own barcode always adds one box (its own price/factor).
function findProductByExactCode(q){
  const code=String(q||'').trim();
  if(!code) return null;
  if(typeof exactProductCodeMap!=='undefined') return exactProductCodeMap.get(code)||null;
  for(const product of products.filter(item=>item.active!==false)){
    if(product.barcode===code||product.sku===code||(product.vendorBarcodes||[]).some(entry=>entry.code===code)) return {product,unitName:product.unit};
    const extraUnit=extraBarcodeUnitForCode(product,code);
    if(extraUnit) return {product,unitName:extraUnit};
    const unit=(product.units||[]).find(item=>item.barcode===code);
    if(unit) return {product,unitName:unit.sub};
  }
  return null;
}

function selectProductListUnitByExactCode(code){
  const match=findProductByExactCode(code);
  if(!match?.product||!match.unitName) return null;
  const validUnit=productUnitOptions(match.product).some(option=>option.name===match.unitName);
  if(validUnit) prodRowUnitSel[match.product.id]=match.unitName;
  return match;
}

function cashShiftSummary(shift,sales=salesHistory){
  const payments={};
  const payment=name=>payments[name]||(payments[name]={sales:0,refunds:0,net:0,saleCount:0,refundCount:0});
  let grossSales=0,refunds=0,saleCount=0,refundCount=0;
  (sales||[]).forEach(sale=>{
    const amount=Math.abs(Number(sale.total)||0),method=sale.payMethod||'ไม่ระบุ';
    if(sale.customerReturn){if(String(sale.cashShiftId||'')===String(shift?.id||'')&&shift?.id){const row=payment(method);row.refunds+=amount;row.refundCount++;refunds+=amount;refundCount++;}return;}
    if(String(sale.cashShiftId||'')===String(shift?.id||'')){ const row=payment(method); row.sales+=amount; row.saleCount++; grossSales+=amount; saleCount++; }
    if(String(sale.voidShiftId||'')===String(shift?.id||'')){ const row=payment(method); row.refunds+=amount; row.refundCount++; refunds+=amount; refundCount++; }
  });
  Object.values(payments).forEach(row=>{ row.net=Math.round((row.sales-row.refunds)*100)/100; });
  const cash=payments['เงินสด']||{sales:0,refunds:0},openingCash=Number(shift?.openingCash)||0;
  return {grossSales:Math.round(grossSales*100)/100,refunds:Math.round(refunds*100)/100,netSales:Math.round((grossSales-refunds)*100)/100,cashSales:Math.round(cash.sales*100)/100,cashRefunds:Math.round(cash.refunds*100)/100,expectedCash:Math.round((openingCash+cash.sales-cash.refunds)*100)/100,saleCount,refundCount,payments};
}
function cashShiftEffectiveSummary(shift){
  if(shift?.status==='closed') return {grossSales:shift.grossSales,refunds:shift.refunds,netSales:shift.netSales,cashSales:shift.cashSales,cashRefunds:shift.cashRefunds,expectedCash:shift.expectedCash,saleCount:shift.saleCount,refundCount:shift.refundCount,payments:shift.paymentSummary||{}};
  return cashShiftSummary(shift);
}
function cashShiftDateTime(value){
  const date=new Date(value); if(Number.isNaN(date.getTime())) return '-';
  const pad=number=>String(number).padStart(2,'0');
  return `${pad(date.getDate())}-${pad(date.getMonth()+1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function cashShiftOverdueInfo(shift,now=new Date()){
  const opened=new Date(shift?.openedAt||'');
  if(Number.isNaN(opened.getTime())||shift?.status!=='open') return null;
  const ageHours=Math.max(0,(now.getTime()-opened.getTime())/3600000);
  const crossedDay=opened.getFullYear()!==now.getFullYear()||opened.getMonth()!==now.getMonth()||opened.getDate()!==now.getDate();
  if(!crossedDay&&ageHours<16) return null;
  return {ageHours,crossedDay,label:ageHours>=24?`${Math.floor(ageHours/24)} วัน ${Math.floor(ageHours%24)} ชม.`:`${Math.floor(ageHours)} ชม.`};
}
function cashShiftOverdueNotice(shift){
  const overdue=cashShiftOverdueInfo(shift);
  return overdue?`<div class="notice danger cash-shift-overdue"><b>ระบบชำระเปิดค้าง ${escapeHtml(overdue.label)}</b> · กรุณาตรวจเงินและปิดระบบก่อนเริ่มรอบขายใหม่ ระบบจะไม่ปิดให้อัตโนมัติเพื่อป้องกันยอดคลาดเคลื่อน</div>`:'';
}
function applyCashShiftOverdueUi(mainElement){
  const overdue=cashShiftOverdueInfo(currentCashShift);
  if(!mainElement||!overdue) return;
  const action=mainElement.querySelector('.cash-shift-topbar-action.open');
  if(action){
    action.classList.add('overdue');
    const strong=action.querySelector('strong');
    if(strong) strong.textContent=`${currentCashShift.shiftNo} เปิดอยู่ · ค้าง ${overdue.label}`;
    const button=action.querySelector('[data-open-cash-shift]');
    if(button) button.textContent='ตรวจและปิดระบบ';
  }
  if(currentTab==='cashshift'){
    const notice=document.createElement('div');
    notice.innerHTML=cashShiftOverdueNotice(currentCashShift);
    if(notice.firstElementChild) mainElement.prepend(notice.firstElementChild);
  }
}
function cashShiftPaymentRows(summary){
  const preferred=['เงินสด','โอนธนาคาร','บัตรเครดิต','ออนไลน์','ไม่ระบุ'];
  const names=Object.keys(summary.payments||{}).sort((a,b)=>{ const ai=preferred.indexOf(a),bi=preferred.indexOf(b); return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b,'th'); });
  if(!names.length) return '<div class="cash-shift-payment-row"><span>ยังไม่มีรายการขาย</span><b>0.00 บาท</b></div>';
  return names.map(name=>{ const row=summary.payments[name]||{},sales=Number(row.sales)||0,refunds=Number(row.refunds)||0; return `<div class="cash-shift-payment-row"><span>${escapeHtml(name)} <small>ขาย ${Number(row.saleCount)||0}${refunds?` · คืน ${Number(row.refundCount)||0}`:''}</small></span><b>${fmtMoney(sales-refunds)} บาท</b></div>`; }).join('');
}
function renderCashShiftHistory(){
  if(!cashShifts.length) return '<div class="cash-shift-history"><div class="panel" style="text-align:center;color:var(--text-muted);">ยังไม่มีประวัติกะในคลังนี้</div></div>';
  const rows=cashShifts.slice(0,100).map(shift=>{
    const summary=cashShiftEffectiveSummary(shift),variance=shift.variance,varianceClass=Number(variance)>0?'positive':Number(variance)<0?'negative':'';
    return `<tr><td class="mono">${escapeHtml(shift.shiftNo)}</td><td>${escapeHtml(shift.openedByName||'-')}</td><td>${cashShiftDateTime(shift.openedAt)}</td><td>${shift.status==='closed'?cashShiftDateTime(shift.closedAt):'<span class="cash-shift-status open">เปิดอยู่</span>'}</td><td class="num">${fmtMoney(shift.openingCash)}</td><td class="num">${fmtMoney(summary.netSales)}</td><td class="num">${fmtMoney(summary.expectedCash)}</td><td class="num cash-shift-variance-text ${varianceClass}">${shift.status==='closed'?fmtMoney(variance):'-'}</td><td>${shift.status==='closed'?`<button class="btn ghost small cash-shift-print" data-print-cash-shift="${escapeHtml(shift.id)}">พิมพ์สรุป</button>`:'-'}</td></tr>`;
  }).join('');
  return `<section class="cash-shift-history"><div class="cash-shift-table-wrap"><table class="cash-shift-table"><thead><tr><th>เลขกะ</th><th>พนักงาน</th><th>เปิดเมื่อ</th><th>ปิดเมื่อ</th><th>เงินตั้งต้น</th><th>ยอดสุทธิ</th><th>เงินสดตามระบบ</th><th>ขาด/เกิน</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function renderCashShift(){
  if(isAllWarehousesMode()) return '<div class="panel">กรุณาเลือกคลังสินค้าแห่งเดียวก่อนเปิดหรือปิดระบบชำระ</div>';
  if(!currentCashShift) return `<main class="cash-shift-page"><div class="cash-shift-topbar-action"><button class="btn primary small" type="submit" form="cashShiftOpenForm" ${cashShiftBusy?'disabled':''}>${cashShiftBusy?'กำลังเปิดระบบ…':'เปิดระบบชำระ'}</button></div><form class="cash-shift-open-card" id="cashShiftOpenForm"><h3>เริ่มต้นระบบชำระ</h3><p>นับเงินสดที่มีอยู่ในลิ้นชักก่อนเริ่มขาย แล้วกรอกเป็นเงินทอนตั้งต้น</p><label class="cash-shift-money-field"><span>เงินทอนตั้งต้น</span><input id="cashShiftOpeningCash" type="number" min="0" max="999999999.99" step="0.01" value="0" inputmode="decimal" required></label></form>${renderCashShiftHistory()}</main>`;
  const shift=currentCashShift,summary=cashShiftSummary(shift),counted=String(cashShiftCloseDraft.countedCash||'').trim();
  const countedNumber=counted===''?null:Number(counted),variance=countedNumber===null?null:Math.round((countedNumber-summary.expectedCash)*100)/100,varianceClass=variance===null?'':Math.abs(variance)<.01?'ok':'danger';
  return `<main class="cash-shift-page"><div class="cash-shift-layout"><div class="cash-shift-overview"><div class="cash-shift-meta"><div><span>เลขกะ</span><b class="mono">${escapeHtml(shift.shiftNo)}</b></div><div><span>พนักงาน</span><b>${escapeHtml(shift.openedByName||'-')}</b></div><div><span>เปิดเมื่อ</span><b>${cashShiftDateTime(shift.openedAt)}</b></div><div><span>เงินทอนตั้งต้น</span><b>${fmtMoney(shift.openingCash)} บาท</b></div></div><div class="cash-shift-summary-grid"><div class="cash-shift-stat primary"><span>ยอดขายรวม (${summary.saleCount} บิล)</span><b>${fmtMoney(summary.grossSales)}</b></div><div class="cash-shift-stat warn"><span>ยอดคืนจากยกเลิก (${summary.refundCount} บิล)</span><b>${fmtMoney(summary.refunds)}</b></div><div class="cash-shift-stat"><span>ยอดขายสุทธิ</span><b>${fmtMoney(summary.netSales)}</b></div><div class="cash-shift-stat primary"><span>เงินสดตามระบบ</span><b>${fmtMoney(summary.expectedCash)}</b></div></div><section class="cash-shift-panel"><h3>สรุปตามวิธีชำระเงิน</h3>${cashShiftPaymentRows(summary)}<div class="cash-shift-total-row"><span>เงินทอนตั้งต้น + เงินสดขาย − เงินสดคืน</span><b>${fmtMoney(summary.expectedCash)} บาท</b></div></section></div><form class="cash-shift-panel cash-shift-close-form" id="cashShiftCloseForm"><h3>ปิดระบบ</h3><label><span>เงินสดที่นับจริง (บาท)</span><input id="cashShiftCountedCash" type="number" min="0" max="999999999.99" step="0.01" inputmode="decimal" value="${escapeHtml(counted)}" required></label><div class="cash-shift-variance ${varianceClass}" id="cashShiftVariance"><span>ยอดขาด/เกิน</span><b>${variance===null?'กรอกเงินที่นับจริง':`${variance>0?'+':''}${fmtMoney(variance)} บาท`}</b></div><label><span>เหตุผลกรณีเงินขาด/เกิน</span><textarea id="cashShiftCloseReason" placeholder="จำเป็นเมื่อยอดขาดหรือเกิน">${escapeHtml(cashShiftCloseDraft.reason)}</textarea></label><button class="btn danger" type="submit" ${cashShiftBusy?'disabled':''}>${cashShiftBusy?'กำลังปิดระบบ…':'ยืนยันการปิดระบบ'}</button></form></div>${renderCashShiftHistory()}</main>`;
}

async function openCashShift(event){
  event?.preventDefault(); if(cashShiftBusy||currentCashShift) return;
  const openingCash=Number(document.getElementById('cashShiftOpeningCash')?.value);
  if(!Number.isFinite(openingCash)||openingCash<0){ showToast('กรุณาระบุเงินทอนตั้งต้นให้ถูกต้อง','danger-top'); return; }
  cashShiftBusy=true; render();
  try{
    const {data,error}=await sb.rpc('open_cash_shift',{p_warehouse_id:Number(activeWarehouseId),p_opening_cash:openingCash});
    if(error) throw error;
    currentCashShift=normalizeCashShiftRow(data); cashShifts=[currentCashShift,...cashShifts.filter(shift=>shift.id!==currentCashShift.id)];
    cashShiftCloseDraft={countedCash:'',reason:''}; showToast(`เปิดระบบชำระ ${currentCashShift.shiftNo} แล้ว`); currentTab='checkout';
  }catch(error){
    const message=String(error?.message||'');
    showToast(message.includes('already open')?'ระบบชำระเปิดอยู่แล้ว กรุณารีเฟรชข้อมูล':message.includes('access denied')?'ไม่มีสิทธิ์ขายในคลังนี้':'เปิดระบบชำระไม่สำเร็จ กรุณาลองใหม่','danger-top');
    await loadCashShiftsFromSupabase();
  }finally{ cashShiftBusy=false; render(); }
}
async function closeCashShift(event){
  event?.preventDefault(); if(cashShiftBusy||!currentCashShift) return;
  const countedCash=Number(cashShiftCloseDraft.countedCash),reason=String(cashShiftCloseDraft.reason||'').trim(),summary=cashShiftSummary(currentCashShift);
  if(!Number.isFinite(countedCash)||countedCash<0){ showToast('กรุณาระบุเงินสดที่นับจริงให้ถูกต้อง','danger-top'); return; }
  const variance=Math.round((countedCash-summary.expectedCash)*100)/100;
  if(Math.abs(variance)>=.01&&reason.length<3){ showToast('ยอดเงินขาดหรือเกิน กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร','danger-top'); document.getElementById('cashShiftCloseReason')?.focus(); return; }
  if(!confirm(`ยืนยันการปิดระบบ ${currentCashShift.shiftNo} หรือไม่?\n\nเงินสดตามระบบ ${fmtMoney(summary.expectedCash)} บาท\nนับจริง ${fmtMoney(countedCash)} บาท\nขาด/เกิน ${variance>0?'+':''}${fmtMoney(variance)} บาท`)) return;
  cashShiftBusy=true; render();
  try{
    const closingId=currentCashShift.id;
    const {data,error}=await sb.rpc('close_cash_shift',{p_shift_id:closingId,p_counted_cash:countedCash,p_close_reason:reason||null});
    if(error) throw error;
    const closed=normalizeCashShiftRow(data); cashShifts=[closed,...cashShifts.filter(shift=>shift.id!==closingId)]; currentCashShift=null;
    cashShiftCloseDraft={countedCash:'',reason:''}; showToast(`ปิดระบบ ${closed.shiftNo} เรียบร้อยแล้ว สามารถพิมพ์สรุปได้จากประวัติกะ`);
  }catch(error){
    const message=String(error?.message||'');
    showToast(message.includes('variance reason')?'กรุณาระบุเหตุผลของยอดขาดหรือเกิน':message.includes('already closed')?'ระบบชำระนี้ถูกปิดไปแล้ว กรุณารีเฟรชข้อมูล':'ปิดระบบไม่สำเร็จ กรุณาลองใหม่','danger-top');
    await loadCashShiftsFromSupabase();
  }finally{ cashShiftBusy=false; render(); }
}
function printCashShiftSummary(shiftId){
  const shift=cashShifts.find(item=>item.id===shiftId); if(!shift||shift.status!=='closed') return;
  const summary=cashShiftEffectiveSummary(shift),payments=Object.entries(summary.payments||{}).map(([name,row])=>`<div><span>${escapeHtml(name)}</span><b>${fmtMoney((Number(row.sales)||0)-(Number(row.refunds)||0))}</b></div>`).join('');
  const win=window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างสรุปกะ','danger-top'); return; }
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>สรุปกะ ${escapeHtml(shift.shiftNo)}</title><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}body{font:12px Tahoma,sans-serif;margin:0;background:#eee}.tools{padding:10px;background:#fff;text-align:center}.tools button{padding:8px 18px}.paper{width:80mm;margin:10px auto;background:#fff;padding:9mm 7mm}.center{text-align:center}.line{border-top:1px dashed #555;margin:10px 0}.row,.payments div{display:flex;justify-content:space-between;gap:10px;padding:4px 0}.big{font-size:16px;font-weight:bold}.variance{font-size:16px;font-weight:bold;color:${Number(shift.variance)<0?'#b42318':'#187a36'}}.note{white-space:pre-wrap}@media print{body{background:#fff}.tools{display:none}.paper{margin:0}}</style></head><body><div class="tools"><button onclick="window.print()">พิมพ์</button></div><main class="paper"><div class="center"><h2>${escapeHtml(businessSettings.name||'PEPOS')}</h2><b>สรุปเปิดกะ–ปิดกะ</b><p>${escapeHtml(activeWarehouse()?.name||'')}</p></div><div class="line"></div><div class="row"><span>เลขกะ</span><b>${escapeHtml(shift.shiftNo)}</b></div><div class="row"><span>พนักงาน</span><b>${escapeHtml(shift.openedByName)}</b></div><div class="row"><span>เปิด</span><b>${cashShiftDateTime(shift.openedAt)}</b></div><div class="row"><span>ปิด</span><b>${cashShiftDateTime(shift.closedAt)}</b></div><div class="line"></div><div class="row"><span>เงินทอนตั้งต้น</span><b>${fmtMoney(shift.openingCash)}</b></div><div class="payments">${payments||'<div><span>ไม่มีรายการขาย</span><b>0.00</b></div>'}</div><div class="row"><span>ยอดขายสุทธิ</span><b>${fmtMoney(summary.netSales)}</b></div><div class="line"></div><div class="row big"><span>เงินสดตามระบบ</span><b>${fmtMoney(summary.expectedCash)}</b></div><div class="row"><span>เงินสดที่นับจริง</span><b>${fmtMoney(shift.countedCash)}</b></div><div class="row variance"><span>ขาด/เกิน</span><b>${Number(shift.variance)>0?'+':''}${fmtMoney(shift.variance)}</b></div>${shift.closeReason?`<div class="line"></div><div>เหตุผล</div><p class="note">${escapeHtml(shift.closeReason)}</p>`:''}<div class="line"></div><div class="center">ผู้ปิดกะ ${escapeHtml(shift.closedByName||'-')}</div></main></body></html>`);
  win.document.close(); standardizePrintPreview(win); setTimeout(()=>win.print(),300);
}
