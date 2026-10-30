// Cancellation reports read existing sales only; they never post stock or money.
function saleVoidDateTime(sale){
  let raw=String(sale?.voidedAt||'').trim().replace(' ','T');
  if(!raw) return {date:'',time:'',stamp:0};
  raw=raw.replace(/([+-]\d{2})$/,'$1:00');
  if(!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw+='+07:00';
  const date=new Date(raw);
  if(!Number.isFinite(date.getTime())) return {date:'',time:'',stamp:0};
  const formatter=saleVoidDateTime.formatter||(saleVoidDateTime.formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
  const parts=formatter.formatToParts(date);
  const part=type=>parts.find(p=>p.type===type)?.value||'';
  return {date:`${part('year')}-${part('month')}-${part('day')}`,time:`${part('hour')}:${part('minute')}`,stamp:date.getTime()};
}
function saleVoidActor(sale){
  if(sale.voidedByName) return sale.voidedByName;
  if(sale.voidedBy&&sale.voidedBy===currentProfile?.id) return [currentProfile.firstName,currentProfile.lastName].filter(Boolean).join(' ')||currentProfile.username||sale.voidedBy;
  return sale.voidedBy?`รหัสผู้ใช้ ${sale.voidedBy}`:'ไม่ระบุ';
}
function voidReportRange(){ return serverDateRange(voidReportFilter.from,voidReportFilter.to); }
function voidReportRows(){
  const f=voidReportFilter,range=voidReportRange(),allowed=new Set(reportWarehouseIds()),search=f.search.trim().toLowerCase();
  return salesHistory.filter(sale=>sale.status==='void'&&allowed.has(Number(sale.warehouseId))).map(sale=>({sale,at:saleVoidDateTime(sale)})).filter(({sale,at})=>{
    if(sale.status!=='void'||!allowed.has(Number(sale.warehouseId))) return false;
    const date=at.date;
    return !!date&&date>=range.from&&date<=range.to&&(f.warehouse==='all'||String(sale.warehouseId)===f.warehouse)&&
      (f.method==='all'||(sale.voidRefundMethod||sale.payMethod)===f.method)&&
      (!search||[sale.ref,sale.id,sale.voidReason,saleVoidActor(sale),...(sale.items||[]).map(item=>item.name)].some(value=>String(value||'').toLowerCase().includes(search)));
  }).sort((a,b)=>b.at.stamp-a.at.stamp||String(a.sale.id).localeCompare(String(b.sale.id))).map(row=>row.sale);
}
function renderVoidReport(){
  const f=voidReportFilter,rows=voidReportRows(),pages=Math.max(1,Math.ceil(rows.length/50));
  f.page=Math.min(pages,Math.max(1,f.page));
  const visible=rows.slice((f.page-1)*50,f.page*50),range=voidReportRange();
  return `<div class="rpt void-report-page"><div class="pagehead"><h1>รายงานบิลยกเลิก</h1></div>
    <form id="voidReportFilters" class="rpt-filters"><label class="rpf-item">วันที่ยกเลิก${dmyDateFieldHtml('voidReportFrom',range.from)}</label><label class="rpf-item">ถึง${dmyDateFieldHtml('voidReportTo',range.to)}</label>
    <label class="rpf-item">คลังสินค้า<select id="voidReportWarehouse" class="rpt-select"><option value="all">ทุกคลังที่มีสิทธิ์</option>${accessibleWarehouses().map(w=>`<option value="${w.id}" ${String(w.id)===f.warehouse?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}</select></label>
    <label class="rpf-item">ช่องทางคืนเงิน<select id="voidReportMethod" class="rpt-select"><option value="all">ทุกช่องทาง</option>${['เงินสด','โอนธนาคาร','บัตรเครดิต','ออนไลน์'].map(m=>`<option ${m===f.method?'selected':''}>${m}</option>`).join('')}</select></label>
    <label class="rpf-item void-report-search">ค้นหา<input id="voidReportSearch" class="rpt-select" value="${escapeHtml(f.search)}" placeholder="เลขบิล สินค้า ผู้ยกเลิก หรือเหตุผล"></label><button class="btn primary" type="submit">แสดงผล</button></form>
    <div class="void-report-summary"><div>บิลยกเลิก <b>${rows.length} บิล</b></div><div>ยอดคืนรวม <b>${fmtMoney(rows.reduce((sum,sale)=>sum+(Number(sale.total)||0),0))} บาท</b></div></div>
    <div class="table-wrap"><table class="void-report-table"><thead><tr><th>วันที่ / เวลายกเลิก</th><th>เลขบิล</th><th>วันที่ขาย</th><th>คลังสินค้า</th><th>ผู้ยกเลิก</th><th>เหตุผล</th><th>ยอดคืน</th><th>ช่องทางคืนเงิน</th><th></th></tr></thead><tbody>${visible.map(sale=>{const at=saleVoidDateTime(sale);return `<tr><td>${fmtDate(at.date)}<br>${at.time}</td><td class="mono">${escapeHtml(sale.ref||sale.id)}</td><td>${fmtDate(sale.date)}</td><td>${escapeHtml(whName(Number(sale.warehouseId)))}</td><td>${escapeHtml(saleVoidActor(sale))}</td><td class="void-report-reason">${escapeHtml(sale.voidReason||'ไม่ระบุ')}</td><td class="num">${fmtMoney(sale.total)}</td><td>${escapeHtml(sale.voidRefundMethod||sale.payMethod||'ไม่ระบุ')}${!sale.voidRefundMethod?'<small class="void-report-legacy">อ้างอิงช่องทางชำระเดิม</small>':''}</td><td><button class="btn ghost small" data-void-report-detail="${escapeHtml(sale.id)}">ดูรายละเอียด</button></td></tr>`;}).join('')||'<tr><td colspan="9" class="empty">ไม่พบบิลยกเลิกในช่วงวันที่เลือก</td></tr>'}</tbody></table></div>
    <div class="void-report-pagination"><button class="btn ghost" id="voidReportPrev" ${f.page<=1?'disabled':''}>ก่อนหน้า</button><span>หน้า ${f.page} / ${pages}</span><button class="btn ghost" id="voidReportNext" ${f.page>=pages?'disabled':''}>ถัดไป</button></div></div>`;
}
function attachVoidReportEvents(){
  document.getElementById('voidReportFilters')?.addEventListener('submit',event=>{
    event.preventDefault();
    const from=dmyToISO(document.getElementById('voidReportFrom').value),to=dmyToISO(document.getElementById('voidReportTo').value);
    if(!from||!to||from>to){showToast('กรุณาระบุช่วงวันที่ให้ถูกต้อง','danger-top');return;}
    Object.assign(voidReportFilter,{from,to,warehouse:document.getElementById('voidReportWarehouse').value,method:document.getElementById('voidReportMethod').value,search:document.getElementById('voidReportSearch').value,page:1});render();
  });
  for(const [id,step] of [['voidReportPrev',-1],['voidReportNext',1]]) document.getElementById(id)?.addEventListener('click',()=>{voidReportFilter.page+=step;render();});
  document.querySelectorAll('[data-void-report-detail]').forEach(button=>button.addEventListener('click',()=>openSaleHistoryDetail(button.dataset.voidReportDetail)));
}
