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
      (!search||[sale.ref,sale.id,sale.voidReason,saleVoidActor(sale),...(sale.items||[]).map(item=>item.name)].some(value=>String(value||'').toLowerCase().includes(search)));
  }).sort((a,b)=>b.at.stamp-a.at.stamp||String(a.sale.id).localeCompare(String(b.sale.id))).map(row=>row.sale);
}
function renderVoidReport(){
  const f=voidReportFilter,rows=voidReportRows(),pages=Math.max(1,Math.ceil(rows.length/50));
  f.page=Math.min(pages,Math.max(1,f.page));
  const visible=rows.slice((f.page-1)*50,f.page*50),range=voidReportRange();
  return `<div class="rpt void-report-page"><div class="pagehead"><h1>รายงานบิลยกเลิก</h1></div><div class="rpt-head-actions">${canPerformPageAction('print','rvoid')?'<button class="btn ghost" id="voidReportPrint">พิมพ์รายงาน</button>':''}${canPerformPageAction('export','rvoid')?'<button class="btn primary" id="voidReportExcel">ส่งออก Excel</button>':''}</div>
    <form id="voidReportFilters" class="rpt-filters"><div class="rpf-item rpf-range"><label for="voidReportFrom">วันที่ยกเลิก</label>${dmyDateFieldHtml('voidReportFrom',range.from)}<label for="voidReportTo" class="void-report-to">ถึง</label>${dmyDateFieldHtml('voidReportTo',range.to)}</div>
    <div class="rpf-item"><select id="voidReportWarehouse" class="rpt-select" aria-label="คลังสินค้า"><option value="all">ทุกคลังที่มีสิทธิ์</option>${accessibleWarehouses().map(w=>`<option value="${w.id}" ${String(w.id)===f.warehouse?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}</select></div>
    <div class="void-report-summary">บิลยกเลิก <b>${rows.length} บิล</b></div>
    <div class="rpf-item void-report-search"><input id="voidReportSearch" class="rpt-select" aria-label="ค้นหาบิลยกเลิก" value="${escapeHtml(f.search)}" placeholder="เลขบิล สินค้า ผู้ยกเลิก หรือเหตุผล"></div><button class="btn ghost rpf-apply" type="submit">แสดงผล</button></form>
    <div class="table-wrap"><table class="void-report-table"><thead><tr><th>วันที่ / เวลายกเลิก</th><th>เลขบิล</th><th>วันที่ขาย</th><th>คลังสินค้า</th><th>ผู้ยกเลิก</th><th>เหตุผล</th><th>ยอดคืน</th><th>ช่องทางคืนเงิน</th><th></th></tr></thead><tbody>${visible.map(sale=>{const at=saleVoidDateTime(sale);return `<tr><td>${fmtDate(at.date)}<br>${at.time}</td><td class="mono">${escapeHtml(sale.ref||sale.id)}</td><td>${fmtDate(sale.date)}</td><td>${escapeHtml(whName(Number(sale.warehouseId)))}</td><td>${escapeHtml(saleVoidActor(sale))}</td><td class="void-report-reason">${escapeHtml(sale.voidReason||'ไม่ระบุ')}</td><td class="num">${fmtMoney(sale.total)}</td><td>${escapeHtml(sale.voidRefundMethod||sale.payMethod||'ไม่ระบุ')}${!sale.voidRefundMethod?'<small class="void-report-legacy">อ้างอิงช่องทางชำระเดิม</small>':''}</td><td><button class="btn ghost small" data-void-report-detail="${escapeHtml(sale.id)}">ดูรายละเอียด</button></td></tr>`;}).join('')||'<tr><td colspan="9" class="empty">ไม่พบบิลยกเลิกในช่วงวันที่เลือก</td></tr>'}</tbody></table></div>
    <div class="void-report-pagination"><button class="btn ghost" id="voidReportPrev" ${f.page<=1?'disabled':''}>ก่อนหน้า</button><span>หน้า ${f.page} / ${pages}</span><button class="btn ghost" id="voidReportNext" ${f.page>=pages?'disabled':''}>ถัดไป</button></div></div>`;
}
function attachVoidReportEvents(){
  document.getElementById('voidReportPrint')?.addEventListener('click',printVoidReport);
  document.getElementById('voidReportExcel')?.addEventListener('click',async event=>{
    const snapshot=voidReportOutputSnapshot('export');if(!snapshot) return;
    const button=event.currentTarget;button.disabled=true;
    try{await invokeExcelTool('exportVoidReportToExcel',snapshot);}finally{button.disabled=false;}
  });
  document.getElementById('voidReportFilters')?.addEventListener('submit',event=>{
    event.preventDefault();
    const from=dmyToISO(document.getElementById('voidReportFrom').value),to=dmyToISO(document.getElementById('voidReportTo').value);
    if(!from||!to||from>to){showToast('กรุณาระบุช่วงวันที่ให้ถูกต้อง','danger-top');return;}
    Object.assign(voidReportFilter,{from,to,warehouse:document.getElementById('voidReportWarehouse').value,search:document.getElementById('voidReportSearch').value,page:1});render();
  });
  for(const [id,step] of [['voidReportPrev',-1],['voidReportNext',1]]) document.getElementById(id)?.addEventListener('click',()=>{voidReportFilter.page+=step;render();});
  document.querySelectorAll('[data-void-report-detail]').forEach(button=>button.addEventListener('click',()=>openSaleHistoryDetail(button.dataset.voidReportDetail)));
}
function voidReportOutputSnapshot(action){
  if(!canAccessTab('rvoid')||!canPerformPageAction(action,'rvoid')){showToast('ไม่มีสิทธิ์ดำเนินการนี้','danger-top');return null;}
  if(ensureOnDemandDataForTab('rvoid').status!=='ready'){showToast('กรุณาโหลดข้อมูลรายงานให้ครบก่อน','danger-top');return null;}
  const f=voidReportFilter,range=voidReportRange();
  return {context:captureWorkspaceRead(),title:'รายงานบิลยกเลิก',business:businessSettings.name||STORE_INFO.name,range:{...range},
    filters:`คลังสินค้า: ${f.warehouse==='all'?'ทุกคลังที่มีสิทธิ์':whName(Number(f.warehouse))}${f.search?` · ค้นหา: ${f.search}`:''}`,
    headers:['วันที่ / เวลายกเลิก','เลขบิล','วันที่ขาย','คลังสินค้า','ผู้ยกเลิก','เหตุผล','ยอดคืน (บาท)','ช่องทางคืนเงิน'],
    rows:voidReportRows().map(sale=>{const at=saleVoidDateTime(sale);return [`${fmtDate(at.date)} ${at.time}`,String(sale.ref||sale.id),fmtDate(sale.date),whName(Number(sale.warehouseId)),saleVoidActor(sale),String(sale.voidReason||'ไม่ระบุ'),Number(sale.total)||0,`${sale.voidRefundMethod||sale.payMethod||'ไม่ระบุ'}${sale.voidRefundMethod?'':' (อ้างอิงช่องทางชำระเดิม)'}`];})};
}
function printVoidReport(){
  const report=voidReportOutputSnapshot('print');if(!report) return;
  const win=window.open('','_blank');if(!win){showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร');return;}
  const total=report.rows.reduce((sum,row)=>sum+row[6],0);
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${escapeHtml(report.title)}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#eee;font:12px 'Sarabun',sans-serif;text-align:center;color:#292421}.toolbar{padding:12px;background:white}.toolbar button{padding:10px 20px;cursor:pointer}.page{width:297mm;min-height:210mm;background:white;margin:12px auto;padding:12mm}h1{font-size:22px}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:16px}th,td{text-align:center;vertical-align:middle;padding:8px 5px;border:1px solid #ddd;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#eee}thead{display:table-header-group}tr{break-inside:avoid}th:nth-child(6){width:22%}p{overflow-wrap:anywhere}@media print{body{background:white}.toolbar{display:none}.page{width:auto;min-height:0;margin:0;padding:0}}</style></head><body><div class="toolbar"><button onclick="window.print()">พิมพ์รายงาน</button></div><main class="page"><h1>${escapeHtml(report.title)}</h1><h2>${escapeHtml(report.business)}</h2><p>วันที่ยกเลิก ${fmtDate(report.range.from)} ถึง ${fmtDate(report.range.to)}</p><p>${escapeHtml(report.filters)}</p><p>บิลยกเลิก ${report.rows.length} บิล · ยอดคืนรวม ${fmtMoney(total)} บาท</p><table><thead><tr>${report.headers.map(label=>`<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${report.rows.map(row=>`<tr>${row.map((value,index)=>`<td>${index===6?fmtMoney(value):escapeHtml(value)}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="8">ไม่พบบิลยกเลิกในช่วงวันที่เลือก</td></tr>'}</tbody></table></main></body></html>`);
  win.document.close();standardizePrintPreview(win,{trackPrint:false});
}
