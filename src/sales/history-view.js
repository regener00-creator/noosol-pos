function renderHistory(){
  const f=historyFilter;
  const canDeleteHeld=!isLevel2User();
  const canVoidCompleted=currentProfile?.owner===true;
  const range=historyDateRange();
  const filtered=filterSalesHistory(salesHistory,f,range);
  const statusBadge = st => st==='done' ? '<span class="st-badge done">DONE</span>' : st==='hold' ? '<span class="st-badge hold">HOLD</span>' : '<span class="st-badge cancel">CANCELED</span>';
  const totalPages=Math.max(1, Math.ceil(filtered.length/HISTORY_PAGE_SIZE));
  if(f.page>totalPages) f.page=totalPages;
  if(f.page<1) f.page=1;
  const start=(f.page-1)*HISTORY_PAGE_SIZE;
  const pageRows=filtered.slice(start,start+HISTORY_PAGE_SIZE);
  const periodOpts=[['range','วันที่'],['month','เดือน'],['year','ปี']];

  let pager=pagerHtml(f.page, totalPages, 'hpage');

  return `<div class="rpt sales-history-page">
    <div class="rpt-filters">
      <div class="rpf-item"><select id="hf_period" class="rpt-select">${periodOpts.map(([v,l])=>`<option value="${v}" ${f.period===v?'selected':''}>${l}</option>`).join('')}</select></div>
      ${f.period==='range'?`<div class="rpf-item rpf-range">${dmyDateFieldHtml('hf_from', range.from)}<span style="color:var(--text-muted);">ถึง</span>${dmyDateFieldHtml('hf_to', range.to)}</div>`:''}
      ${f.period==='month'?`<div class="rpf-item"><input type="month" id="hf_month" value="${f.month||TODAY_STR.slice(0,7)}" class="rpt-select"></div>`:''}
      ${f.period==='year'?`<div class="rpf-item"><select id="hf_year" class="rpt-select">${(()=>{const cy=Number(TODAY_STR.slice(0,4));let o='';for(let yy=cy;yy>=cy-6;yy--){o+=`<option value="${yy}" ${String(f.year||cy)===String(yy)?'selected':''}>${yy}</option>`;}return o;})()}</select></div>`:''}
      <div class="rpf-item"><input id="hf_bill" class="rpt-select" value="${escapeHtml(f.bill||'')}" placeholder="ค้นหาเลขบิล" autocomplete="off" style="min-width:190px;"></div>
      <button class="btn ghost rpf-apply" id="hfApplyBtn">แสดงผล</button><span class="sales-history-result-count">${filtered.length} รายการ</span>
    </div>
    <div class="sales-history-table-wrap">
    <table class="grid-table history-table"><colgroup><col class="ht-date"><col class="ht-bill"><col class="ht-customer"><col class="ht-time"><col class="ht-items"><col class="ht-total"><col class="ht-pay"><col class="ht-status"><col class="ht-actions"></colgroup><thead><tr><th>วันที่</th><th>เลขที่บิล</th><th>ลูกค้า</th><th>เวลา</th><th>รายการ</th><th class="mono">ยอด</th><th>ชำระ</th><th>สถานะ</th><th></th></tr></thead>
    <tbody>${pageRows.length? pageRows.map(s=>`<tr>
      <td>${fmtDate(s.date)}</td><td class="mono">${escapeHtml(s.ref||s.id)}${currentTab==='cashbill'?` <button class="history-icon-btn" type="button" data-copy-bill="${escapeHtml(s.ref||s.id)}" title="คัดลอกเลขบิล" aria-label="คัดลอกเลขบิล ${escapeHtml(s.ref||s.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></svg></button>`:''}</td>
      <td>${escapeHtml(saleHistoryCustomerDisplay(s))}</td>
      <td>${saleHistoryTimeDisplay(s.time)}</td>
      <td class="history-items-cell">${salesHistoryItemsPreview(s.items)}</td>
      <td class="mono num">${fmtMoney(s.total)}</td>
      <td>${escapeHtml(s.payMethod||'-')}</td>
      <td>${s.customerReturn?'<span class="st-badge cancel">คืนสินค้า</span>':statusBadge(s.status)}</td>
      <td class="num"><div class="history-actions"><button class="history-icon-btn" data-sale-view="${escapeHtml(s.id)}" title="ดูรายละเอียด" aria-label="ดูรายละเอียด ${escapeHtml(s.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>${s.status==='hold'?`<button class="btn primary small" data-act="resumehold" data-id="${escapeHtml(s.id)}">ทำต่อ</button>`:''}${s.status==='hold'&&canDeleteHeld?`<button class="history-icon-btn danger" data-delete-sale="${escapeHtml(s.id)}" title="ลบบิลพัก" aria-label="ลบบิลพัก ${escapeHtml(s.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`:s.status==='done'&&canVoidCompleted&&!s.customerReturn&&!s.customerExchange&&!(s.customerReturnLog||[]).length?`<button class="history-icon-btn danger" data-void-sale="${escapeHtml(s.id)}" title="ยกเลิกบิลและคืนสต๊อก" aria-label="ยกเลิกบิล ${escapeHtml(s.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l16 16M20 4L4 20"/></svg></button>`:''}</div></td>
    </tr>`).join('') : `<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:30px;">ไม่มีรายการขายในช่วงเวลาที่เลือก</td></tr>`}</tbody></table>
    </div>
    ${pager}
  </div>`;
}
function renderPOSSalesHistoryModal(){
  const state=ensureOnDemandDataForTab('history');
  posSalesHistoryOnDemandState=state;
  const unavailable=state.status==='loading'||state.status==='error'||(state.status==='truncated'&&state.blocking);
  const content=unavailable?onDemandStateHtml(state):`${state.status==='truncated'?onDemandStateHtml(state):''}${renderHistory()}`;
  return `<div class="modal-overlay pos-sales-history-overlay"><section class="modal pos-sales-history-modal" role="dialog" aria-modal="true" aria-labelledby="posSalesHistoryTitle"><div class="modal-head"><div><h3 id="posSalesHistoryTitle">ประวัติการขาย</h3><div class="sub">${currentTab==='cashbill'?'คัดลอกเลขบิล แล้วปิดหน้าต่างเพื่อกลับไปสร้างบิลเงินสด':'ดูรายการขายโดยไม่ออกจากหน้า POS'}</div></div><button class="modal-close" id="closePOSSalesHistoryBtn" type="button" aria-label="ปิด">×</button></div><div class="pos-sales-history-body">${content}</div><div class="pos-sales-history-actions"><button class="btn primary" id="closePOSSalesHistoryBottomBtn" type="button">ปิด</button></div></section></div>`;
}
