let dashboardCalendarMonth='';
let dashboardCalendarLoad=null;
function dashboardCalendarBounds(){
  const current=TODAY_STR.slice(0,7),[year,month]=current.split('-').map(Number),first=new Date(year,month-12,1);
  return {first:`${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,'0')}`,current};
}
function dashboardSelectedMonth(){
  const {first,current}=dashboardCalendarBounds(),selected=dashboardCalendarMonth||current;
  return selected<first?first:selected>current?current:selected;
}
function dashboardCalendarScope(){return `${isAllWarehousesMode()?'all':activeWarehouseId}`;}
function dashboardSaleInWarehouse(sale){
  if(isAllWarehousesMode())return true;
  if(sale.warehouseId!=null)return String(sale.warehouseId)===String(activeWarehouseId);
  return (sale.items||[]).some(item=>String(saleWarehouseForReport(sale,item,products.find(product=>Number(product.id)===Number(item.productId))||products.find(product=>product.name===item.name)||{}))===String(activeWarehouseId));
}
function dashboardSalesSummary(sales,summary={total:0,profit:0,orders:0,profitComplete:true}){
  return sales.reduce((summary,sale)=>{
    summary.total+=Number(sale.total)||0;
    if(!sale.customerReturn)summary.orders++;
    if(sale.grossProfit!=null&&sale.costTotal!=null){summary.profit+=Number(sale.grossProfit)||0;}
    else summary.profitComplete=false;
    return summary;
  },summary);
}
async function loadDashboardCalendar(state){
  if(dashboardCalendarLoad!==state||!isWorkspaceReadCurrent(state.context)||state.scope!==dashboardCalendarScope())return;
  try{
    if(offlinePosMode())throw new Error('กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อดูยอดย้อนหลัง');
    const range=monthServerRange(state.month),daily=new Map();let cursor=null;
    // Stream one month in stable ID pages, retaining only daily summaries.
    while(true){
      let query=sb.from('sales').select('id,sale_date,total,gross_profit,cost_total,warehouseId:data->>warehouseId,customerReturn:data->customerReturn,items:data->items,storedTotal:data->total,storedProfit:data->grossProfit,storedCost:data->costTotal')
        .eq('status','done').gte('sale_date',range.from).lte('sale_date',range.to).order('id',{ascending:true}).limit(500);
      if(cursor!==null)query=query.gt('id',cursor);
      const {data,error}=await query;
      if(dashboardCalendarLoad!==state||!isWorkspaceReadCurrent(state.context)||state.scope!==dashboardCalendarScope())return;
      if(error)throw error;
      const rows=data||[];
      for(const row of rows){
        const sale={warehouseId:row.warehouseId,items:row.items,customerReturn:row.customerReturn,total:row.storedTotal??row.total,grossProfit:row.storedProfit??row.gross_profit,costTotal:row.storedCost??row.cost_total};
        if(!dashboardSaleInWarehouse(sale))continue;
        const date=String(row.sale_date||'').slice(0,10);
        daily.set(date,dashboardSalesSummary([sale],daily.get(date)));
      }
      if(rows.length<500)break;
      const next=String(rows.at(-1).id);if(next===cursor)throw new Error('โหลดข้อมูลเดือนนี้ไม่ครบ กรุณาลองใหม่');cursor=next;
    }
    state.daily=daily;state.loaded=true;
  }catch(error){state.error=error?.message||'โหลดข้อมูลเดือนนี้ไม่สำเร็จ';}
  finally{
    state.loading=false;
    if(dashboardCalendarLoad===state&&isWorkspaceReadCurrent(state.context)&&state.scope===dashboardCalendarScope()&&currentTab==='dashboard')render();
  }
}
function attachDashboardCalendarEvents(){
  if(currentTab!=='dashboard')return;
  document.querySelectorAll('[data-dashboard-month-step]').forEach(button=>button.onclick=()=>{
    const [year,month]=dashboardSelectedMonth().split('-').map(Number),next=new Date(year,month-1+Number(button.dataset.dashboardMonthStep),1);
    const nextMonth=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`,{first,current}=dashboardCalendarBounds();
    if(nextMonth<first||nextMonth>current)return;
    dashboardCalendarMonth=nextMonth;dashboardCalendarLoad=null;render();
  });
  document.getElementById('dashboardCalendarToday')?.addEventListener('click',()=>{
    dashboardCalendarMonth='';dashboardCalendarLoad=null;render();
    requestAnimationFrame(()=>document.querySelector('.dashboard-calendar-day.is-today')?.scrollIntoView({block:'nearest',inline:'center'}));
  });
  document.getElementById('retryDashboardCalendar')?.addEventListener('click',()=>{dashboardCalendarLoad=null;render();});
}
function dashboardProfitHtml(summary){
  if(!summary.profitComplete)return '<span class="dashboard-profit-unknown" title="บางบิลยังไม่มีข้อมูลต้นทุนครบ">—</span>';
  return `<span class="${summary.profit<0?'dashboard-loss':'dashboard-profit'}">${summary.profit<0?'-':''}${fmtMoney(Math.abs(summary.profit))}</span>`;
}
function renderDashboardCalendar(monthSales,canViewProfit){
  const monthKey=dashboardSelectedMonth(),[year,month]=monthKey.split('-').map(Number),bounds=dashboardCalendarBounds();
  const firstDay=new Date(year,month-1,1),days=new Date(year,month,0).getDate();
  const monthLabel=firstDay.toLocaleDateString('th-TH-u-ca-gregory',{month:'long',year:'numeric'});
  const byDay=new Map();
  monthSales.forEach(sale=>{const date=String(sale.date||'').slice(0,10);if(!byDay.has(date))byDay.set(date,[]);byDay.get(date).push(sale);});
  let historical=null;
  if(monthKey!==TODAY_STR.slice(0,7)){
    const state=dashboardCalendarLoad;
    if(!state||state.month!==monthKey||state.scope!==dashboardCalendarScope()||!isWorkspaceReadCurrent(state.context)){
      historical=dashboardCalendarLoad={month:monthKey,scope:dashboardCalendarScope(),context:captureWorkspaceRead(),loading:true,loaded:false,error:'',daily:new Map()};
      setTimeout(()=>loadDashboardCalendar(historical),0);
    }else historical=state;
  }
  const cells=Array.from({length:Math.ceil((firstDay.getDay()+days)/7)*7},(_,index)=>{
    const day=index-firstDay.getDay()+1;
    if(day<1||day>days)return '<div class="dashboard-calendar-blank" aria-hidden="true"></div>';
    const date=`${monthKey}-${String(day).padStart(2,'0')}`;
    const summary=historical?historical.daily.get(date)||dashboardSalesSummary([]):dashboardSalesSummary(byDay.get(date)||[]);
    return `<div class="dashboard-calendar-day ${date===TODAY_STR?'is-today':''} ${date>TODAY_STR?'is-future':''}" data-dashboard-date="${date}"><time datetime="${date}" ${date===TODAY_STR?'aria-current="date"':''}>${day}</time><div class="dashboard-day-summary"><span class="dashboard-day-piece">บิล: <span data-day-orders>${summary.orders.toLocaleString('th-TH')}</span></span><span class="dashboard-day-separator" aria-hidden="true">|</span><span class="dashboard-day-piece dashboard-day-sales">ขาย <span data-day-sales aria-label="ยอดขาย">${summary.total<0?'-':''}${fmtMoney(Math.abs(summary.total))}</span></span>${canViewProfit?`<span class="dashboard-day-separator" aria-hidden="true">|</span><span data-day-profit aria-label="กำไร">${dashboardProfitHtml(summary)}</span>`:''}</div></div>`;
  }).join('');
  const content=historical?.loading?'<p class="dashboard-calendar-feedback" role="status">กำลังโหลดข้อมูลเดือนนี้...</p>':historical?.error?`<div class="dashboard-calendar-feedback" role="alert">${escapeHtml(historical.error)} <button class="btn ghost" id="retryDashboardCalendar">ลองใหม่</button></div>`:`<div class="dashboard-calendar-scroll" tabindex="0" role="region" aria-label="ปฏิทินยอดขายรายวัน เลื่อนแนวนอนเพื่อดูทุกวัน"><div class="dashboard-calendar-grid">${['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'].map(day=>`<div class="dashboard-weekday">${day}</div>`).join('')}${cells}</div></div>`;
  return `<section class="panel dashboard-calendar"><header><h3>ปฏิทินยอดขาย</h3><div class="dashboard-calendar-navigation"><button type="button" class="btn ghost" id="dashboardCalendarToday">ปัจจุบัน</button><button type="button" class="btn ghost" data-dashboard-month-step="-1" aria-label="เดือนก่อนหน้า" title="เดือนก่อนหน้า" ${monthKey===bounds.first?'disabled':''}>‹</button><span aria-live="polite">${escapeHtml(monthLabel)}</span><button type="button" class="btn ghost" data-dashboard-month-step="1" aria-label="เดือนถัดไป" title="เดือนถัดไป" ${monthKey===bounds.current?'disabled':''}>›</button></div></header>${content}</section>`;
}
function dashboardBestSellers(sales){
  const catalog=new Map(products.map(product=>[String(product.id),product])),totals=new Map();
  sales.forEach(sale=>(sale.items||[]).forEach(item=>{
    if(item.custom||item.productId==null)return;
    const product=catalog.get(String(item.productId));
    if(!isAllWarehousesMode()&&String(saleWarehouseForReport(sale,item,product))!==String(activeWarehouseId))return;
    const currentUnit=product?productUnitOptions(product).find(unit=>unit.name===item.unit):null;
    const quantity=currentUnit?Number(item.qty)*currentUnit.factor:Number(item.baseQty??(Number(item.qty)*(Number(item.factor)||1)));
    if(!Number.isFinite(quantity))return;
    const key=String(item.productId),entry=totals.get(key)||{id:key,name:product?.name||item.name||'-',unit:product?.unit||((Number(item.factor)||1)===1?item.unit:'')||'หน่วยหลัก',quantity:0};
    entry.quantity+=sale.customerReturn?-Math.abs(quantity):quantity;
    totals.set(key,entry);
  }));
  return [...totals.values()].filter(item=>item.quantity>0).sort((a,b)=>b.quantity-a.quantity||a.name.localeCompare(b.name,'th')).slice(0,9);
}
function renderDashboard(){
  const completedSales = salesHistory.filter(s=>s.status==='done').filter(dashboardSaleInWarehouse);
  const monthKey = TODAY_STR.slice(0,7);
  const monthSales = completedSales.filter(s=>(s.date||'').slice(0,7)===monthKey);
  const monthSummary=dashboardSalesSummary(monthSales),bestSellers=dashboardBestSellers(monthSales);
  const canViewProfit = !isLevel2User();
  return `
    <div class="statrow dashboard-summary-row"><section class="stat dashboard-summary-card" data-dashboard-period="month"><div><div class="slabel">ยอดขายเดือนนี้</div><div class="sval" data-summary-sales>${monthSummary.total<0?'-':''}${fmtMoney(Math.abs(monthSummary.total))}</div></div>${canViewProfit?`<div><div class="slabel">กำไรเดือนนี้</div><div class="sval" data-summary-profit>${dashboardProfitHtml(monthSummary)}</div></div>`:''}</section><section class="stat dashboard-top-products"><header><h3>สินค้าขายดี</h3><span>เดือนนี้ · จำนวนขายสุทธิ</span></header><div class="dashboard-best-sellers">${bestSellers.map((item,index)=>`<div class="dashboard-best-seller"><span class="dashboard-best-rank">${index+1}</span><div><b title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</b><span>${item.quantity.toLocaleString('th-TH',{maximumFractionDigits:3})} ${escapeHtml(item.unit)}</span></div></div>`).join('')||'<p class="dashboard-best-empty">ยังไม่มีรายการขายสินค้าเดือนนี้</p>'}</div></section></div>
    ${renderDashboardCalendar(monthSales,canViewProfit)}
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
    if(String(sale.voidShiftId||'')===String(shift?.id||'')){ const row=payment(sale.voidRefundMethod||method); row.refunds+=amount; row.refundCount++; refunds+=amount; refundCount++; }
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
    if(offlinePosMode()){
      await openOfflineCashShift(openingCash);
      currentTab='checkout';showToast('เปิดระบบชำระออฟไลน์แล้ว');return;
    }
    const {data,error}=await sb.rpc('open_cash_shift',{p_warehouse_id:Number(activeWarehouseId),p_opening_cash:openingCash});
    if(error) throw error;
    currentCashShift=normalizeCashShiftRow(data); cashShifts=[currentCashShift,...cashShifts.filter(shift=>shift.id!==currentCashShift.id)];
    void saveOfflinePosSnapshot().catch(()=>{});
    cashShiftCloseDraft={countedCash:'',reason:''}; showToast(`เปิดระบบชำระ ${currentCashShift.shiftNo} แล้ว`); currentTab='checkout';
  }catch(error){
    const message=String(error?.message||'');
    showToast(message.includes('already open')?'ระบบชำระเปิดอยู่แล้ว กรุณารีเฟรชข้อมูล':message.includes('access denied')?'ไม่มีสิทธิ์ขายในคลังนี้':'เปิดระบบชำระไม่สำเร็จ กรุณาลองใหม่','danger-top');
    await loadCashShiftsFromSupabase();
  }finally{ cashShiftBusy=false; render(); }
}
async function closeCashShift(event){
  event?.preventDefault(); if(cashShiftBusy||!currentCashShift) return;
  if(offlinePosMode()||offlinePendingSales().length||offlineSyncRunning){
    showToast('กรุณาต่ออินเทอร์เน็ตและรอส่งบิลให้ครบก่อนปิดระบบชำระ','warning-top');return;
  }
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
    void saveOfflinePosSnapshot().catch(()=>{});
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
