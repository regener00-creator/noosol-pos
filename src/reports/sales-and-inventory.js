function rproductPeriodRange(){
  const today = new Date(TODAY_STR); // อ้างอิงวันปัจจุบันของระบบ
  const y=today.getFullYear(), m=today.getMonth();
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const f=rproductFilter;
  if(f.period==='today'){ const t=iso(today); return {from:t, to:t, label:'วันนี้'}; }
  if(f.period==='selectmonth'){ const mm=f.month||`${y}-${String(m+1).padStart(2,'0')}`; const [yy,mo]=mm.split('-').map(Number); return {from:iso(new Date(yy,mo-1,1)), to:iso(new Date(yy,mo,0)), label:'เลือกเดือน'}; }
  if(f.period==='selectyear'){ const yy=f.year||y; return {from:iso(new Date(yy,0,1)), to:iso(new Date(yy,11,31)), label:'เลือกปี'}; }
  // ค่าเริ่มต้น = เลือกช่วงวันที่ (ยังไม่เลือก = เดือนปัจจุบัน)
  return {from:f.from||iso(new Date(y,m,1)), to:f.to||iso(new Date(y,m+1,0)), label:'เลือกช่วงวันที่'};
}

function saleWarehouseForReport(sale,item,product){
  return Number(sale?.warehouseId??item?.warehouseId??product?.wh)||0;
}

function csvSpreadsheetText(value){
  let text=String(value??'');
  if(/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text="'"+text;
  return `"${text.replace(/"/g,'""')}"`;
}

function exportRProductExcel(){
  const f=rproductFilter, range=rproductPeriodRange();
  const inRange=s=>{ const d=(s.date||'').slice(0,10); return d>=range.from && d<=range.to; };
  const prodByName={}; products.forEach(p=>{ prodByName[p.name]=p; });
  const byDate={};
  salesHistory.filter(s=>s.status!=='void').filter(inRange).forEach(s=>{
    const d=(s.date||'').slice(0,10);
    s.items.forEach(it=>{
      const p=prodByName[it.name]||{};
      if(f.wh!=='all' && String(saleWarehouseForReport(s,it,p))!==String(f.wh)) return;
      if(f.scope==='category' && f.category && (p.category||'')!==f.category) return;
      if(f.scope==='brand' && f.brand && (p.brand||'')!==f.brand) return;
      if(f.scope==='product' && f.products && f.products.length && !f.products.includes(it.name)) return;
      if(!byDate[d]) byDate[d]={};
      const itUnit=it.unit||p.unit||'';
      const rowKey=it.name+'|'+itUnit;
      if(!byDate[d][rowKey]) byDate[d][rowKey]={name:it.name, unit:itUnit, qty:0, val:0};
      byDate[d][rowKey].qty+=it.qty; byDate[d][rowKey].val+=(it.reportLineTotal??(it.lineTotal!==undefined?it.lineTotal:it.qty*it.price));
    });
  });
  const dateKeys=Object.keys(byDate).filter(d=>Object.keys(byDate[d]).length).sort();
  let csv='\uFEFF'; // BOM ให้ Excel อ่านภาษาไทยถูก
  csv+='วันที่,ชื่อสินค้า,จำนวน,หน่วย,ราคา\n';
  dateKeys.forEach(d=>{
    const dayRows=Object.values(byDate[d]).sort((a,b)=>a.name.localeCompare(b.name,'th'));
    dayRows.forEach(r=>{ csv+=`${csvSpreadsheetText(d)},${csvSpreadsheetText(r.name)},${Number(r.qty)||0},${csvSpreadsheetText(r.unit)},${r.val.toFixed(2)}\n`; });
  });
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`รายงานยอดขายตามสินค้า_${range.from}_${range.to}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('ดาวน์โหลดไฟล์ Excel (CSV) แล้ว');
}

function printRProduct(){
  const f=rproductFilter, range=rproductPeriodRange();
  const bizName=businessSettings.name||STORE_INFO.name;
  const inRange=s=>{ const d=(s.date||'').slice(0,10); return d>=range.from && d<=range.to; };
  const prodByName={}; products.forEach(p=>{ prodByName[p.name]=p; });
  const bills=salesHistory.filter(s=>s.status!=='void').filter(inRange);
  const byDate={};
  bills.forEach(s=>{
    const d=(s.date||'').slice(0,10);
    s.items.forEach(it=>{
      const p=prodByName[it.name]||{};
      if(f.wh!=='all' && String(saleWarehouseForReport(s,it,p))!==String(f.wh)) return;
      if(f.scope==='category' && f.category && (p.category||'')!==f.category) return;
      if(f.scope==='brand' && f.brand && (p.brand||'')!==f.brand) return;
      if(f.scope==='product' && f.products && f.products.length && !f.products.includes(it.name)) return;
      if(!byDate[d]) byDate[d]={};
      const itUnit=it.unit||p.unit||'';
      const rowKey=it.name+'|'+itUnit;
      if(!byDate[d][rowKey]) byDate[d][rowKey]={name:it.name, unit:itUnit, qty:0, val:0};
      byDate[d][rowKey].qty+=it.qty; byDate[d][rowKey].val+=(it.reportLineTotal??(it.lineTotal!==undefined?it.lineTotal:it.qty*it.price));
    });
  });
  const dateKeys=Object.keys(byDate).filter(d=>Object.keys(byDate[d]).length).sort((a,b)=>a.localeCompare(b));
  const allRows=dateKeys.flatMap(d=>Object.values(byDate[d]));
  const grandVal=allRows.reduce((a,r)=>a+r.val,0);
  const docCount=bills.length;
  const thDate=d=>{ const dt=new Date(d); return dt.getDate()+' '+['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][dt.getMonth()]+' '+dt.getFullYear(); };
  const today=new Date(TODAY_STR);
  const dayBlocksHtml = dateKeys.length ? dateKeys.map(d=>{
    const dayRows=Object.values(byDate[d]).sort((a,b)=>a.name.localeCompare(b.name,'th'));
    const dayTotal=dayRows.reduce((a,r)=>a+r.val,0);
    return `<div class="day-block">
      <div class="day-head"><span>${thDate(d)}</span><span>${fmtMoney(dayTotal)}</span></div>
      <table>
        <colgroup><col style="width:44%"><col style="width:18%"><col style="width:18%"><col style="width:20%"></colgroup>
        <tbody>${dayRows.map(r=>`<tr><td class="pd-name">${escapeHtml(r.name)}</td><td class="r">${r.qty.toFixed(2)}</td><td>${escapeHtml(r.unit||'-')}</td><td class="r">${fmtMoney(r.val)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  }).join('') : `<div style="text-align:center;color:#888;padding:24px;">ไม่มีข้อมูล</div>`;

  const win=window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร'); return; }
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>รายงานยอดขายตามสินค้า</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @page{size:A4;margin:14mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    body{margin:0;background:#F0F0F0;color:#2b2b2b;font-family:'Sarabun',sans-serif;font-size:13px}
    .toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#fff;box-shadow:0 2px 8px #0002}
    .toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:9px 18px;font:600 14px Sarabun;cursor:pointer}
    .page{width:210mm;min-height:297mm;margin:12px auto;padding:16mm 14mm;background:#fff;box-shadow:0 4px 20px #0002}
    h1{text-align:center;font-size:20px;font-weight:700;margin:0 0 22px;color:#4F4038}
    .biz{font-size:18px;font-weight:600;margin-bottom:12px;color:#4F4038}
    .meta{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:6px;padding-bottom:14px;border-bottom:1px solid #ddd;}
    .meta-left div{display:flex;gap:12px;margin-bottom:3px}
    .meta-left .k{min-width:92px}
    .meta-right{text-align:right}
    .meta-right .tot{display:flex;justify-content:flex-end;gap:24px;align-items:baseline;}
    .meta-right .tot .k{color:#2b2b2b}
    .meta-right .tot .v{font-weight:700;font-size:18px;min-width:90px;color:#4F4038}
    .day-block{margin-top:18px;}
    .day-head{display:flex;justify-content:space-between;padding:7px 8px;background:#F1E8E5;border-radius:6px 6px 0 0;font-weight:600;font-size:12.5px;color:#4F4038;}
    table{width:100%;border-collapse:collapse;table-layout:fixed;}
    thead th{text-align:left;padding:9px 8px;font-size:12px;font-weight:600;color:#444;border-bottom:1px solid #333}
    tbody td{padding:9px 8px;border-bottom:1px solid #e2e6ea;font-size:12.5px}
    .r{text-align:right}
    .pd-name{color:#2b2b2b}
    .foot{display:flex;justify-content:space-between;margin-top:14px;font-size:12px;color:#444}
    @media print{
      body{background:#fff}
      .toolbar{display:none}
      .page{margin:0;box-shadow:none;width:auto;min-height:0;padding:0}
      thead{display:table-header-group}
      .day-head{background:#F1E8E5!important;-webkit-box-shadow:inset 0 0 0 1000px #F1E8E5!important;box-shadow:inset 0 0 0 1000px #F1E8E5!important}
    }
  </style></head><body>
  <div class="toolbar"><span>ตัวอย่างรายงาน A4</span><button onclick="window.print()">พิมพ์</button></div>
  <div class="page">
    <h1>รายงานยอดขายตามสินค้า</h1>
    <div class="biz">${escapeHtml(bizName)}</div>
    <div class="meta">
      <div class="meta-left">
        <div><span class="k">ณ วันที่</span><span>${thDate(today)}</span></div>
        <div><span class="k">ช่วงเวลา</span><span>${thDate(range.from)} - ${thDate(range.to)}</span></div>
        <div><span class="k">จำนวนทั้งหมด</span><span>${docCount} เอกสาร</span></div>
      </div>
      <div class="meta-right">
        <div class="tot"><span class="k">ยอดรวม</span><span class="v">${fmtMoney(grandVal)}</span></div>
      </div>
    </div>
    ${dayBlocksHtml}
  </div>
  </body></html>`);
  win.document.close();
  standardizePrintPreview(win);
}

function renderRProduct(){
  const f=rproductFilter;
  const range=rproductPeriodRange();
  // ตัวเลือกช่วงเวลา
  const periodOpts=[['today','วันนี้'],['range','เลือกช่วงวันที่'],['selectmonth','เลือกเดือน'],['selectyear','เลือกปี']];
  // กรองบิลตามช่วงเวลา + คลัง
  const inRange=s=>{ const d=(s.date||'').slice(0,10); return d>=range.from && d<=range.to; };
  // ยังไม่กด "แสดงผล" = เอกสารว่าง ไม่แสดงข้อมูลใด ๆ
  let bills = f.applied ? salesHistory.filter(s=>s.status!=='void').filter(inRange) : [];
  // จัดกลุ่มยอดขายตามวันที่ (join กับ products เพื่อดึงหมวด/หน่วย)
  const prodByName={}; products.forEach(p=>{ prodByName[p.name]=p; });
  const byDate={};
  bills.forEach(s=>{
    const d=(s.date||'').slice(0,10);
    s.items.forEach(it=>{
      const p=prodByName[it.name]||{};
      if(f.wh!=='all' && String(saleWarehouseForReport(s,it,p))!==String(f.wh)) return;
      if(f.scope==='category' && f.category && (p.category||'')!==f.category) return;
      if(f.scope==='brand' && f.brand && (p.brand||'')!==f.brand) return;
      if(f.scope==='product' && f.products && f.products.length && !f.products.includes(it.name)) return;
      if(!byDate[d]) byDate[d]={};
      const itUnit=it.unit||p.unit||'';
      const rowKey=it.name+'|'+itUnit;
      if(!byDate[d][rowKey]) byDate[d][rowKey]={name:it.name, unit:itUnit, qty:0, val:0};
      byDate[d][rowKey].qty+=it.qty; byDate[d][rowKey].val+=(it.reportLineTotal??(it.lineTotal!==undefined?it.lineTotal:it.qty*it.price));
    });
  });
  const dateKeys=Object.keys(byDate).filter(d=>Object.keys(byDate[d]).length).sort((a,b)=>a.localeCompare(b));
  const allRows=dateKeys.flatMap(d=>Object.values(byDate[d]));
  const grandVal=allRows.reduce((a,r)=>a+r.val,0);
  const docCount=bills.length;
  const thDate=d=>{ const dt=new Date(d); return dt.getDate()+' '+['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][dt.getMonth()]+' '+dt.getFullYear(); };
  const today=new Date(TODAY_STR);
  // ตัวเลือกสินค้าตาม scope
  const catList=categories.slice();
  const brandList=brands.slice();
  const productNames=products.map(p=>p.name);

  return `<div class="rpt rpt-page-scroll">
    <div class="rpt-head">
      <h1>รายงานยอดขายตามสินค้า</h1>
      <div class="rpt-head-actions">
        <button class="btn primary" id="rpPrintBtn">พิมพ์รายงาน</button>
      </div>
    </div>

    <div class="rpt-filters">
      <div class="rpf-item">
        <select id="rpf_period" class="rpt-select">
          ${periodOpts.map(([v,l])=>`<option value="${v}" ${f.period===v?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      ${f.period==='range'?`
      <div class="rpf-item rpf-range">
        ${dmyDateFieldHtml('rpf_from', range.from)}
        <span style="color:var(--text-muted);">ถึง</span>
        ${dmyDateFieldHtml('rpf_to', range.to)}
      </div>`:''}
      ${f.period==='selectmonth'?`<div class="rpf-item"><input type="month" id="rpf_month" value="${f.month||range.from.slice(0,7)}" class="rpt-select"></div>`:''}
      ${f.period==='selectyear'?`<div class="rpf-item"><select id="rpf_year" class="rpt-select">${(()=>{const cy=2026;let o='';for(let yy=cy;yy>=cy-6;yy--){o+=`<option value="${yy}" ${String(f.year||cy)===String(yy)?'selected':''}>${yy}</option>`;}return o;})()}</select></div>`:''}
      <div class="rpf-item">
        <select id="rpf_wh" class="rpt-select">
          <option value="all" ${f.wh==='all'?'selected':''}>ทุกคลัง</option>
          ${accessibleWarehouses().map(w=>`<option value="${escapeHtml(w.id)}" ${String(f.wh)===String(w.id)?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}
        </select>
      </div>
      <div class="rpf-item">
        <select id="rpf_scope" class="rpt-select">
          <option value="all" ${f.scope==='all'?'selected':''}>สินค้าทั้งหมด</option>
          <option value="category" ${f.scope==='category'?'selected':''}>หมวดสินค้าหลัก</option>
          <option value="brand" ${f.scope==='brand'?'selected':''}>หมวดสินค้าย่อย</option>
          <option value="product" ${f.scope==='product'?'selected':''}>ชื่อสินค้า</option>
        </select>
      </div>
      ${f.scope==='category'?`<div class="rpf-item"><select id="rpf_category" class="rpt-select"><option value="">— เลือกหมวดหลัก —</option>${catList.map(c=>`<option value="${escapeHtml(c)}" ${f.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select></div>`:''}
      ${f.scope==='brand'?`<div class="rpf-item"><select id="rpf_brand" class="rpt-select"><option value="">— เลือกหมวดย่อย —</option>${brandList.map(b=>`<option value="${escapeHtml(b)}" ${f.brand===b?'selected':''}>${escapeHtml(b)}</option>`).join('')}</select></div>`:''}
      ${f.scope==='product'?`<div class="rpf-item rpf-prodsearch">
        <input type="text" id="rpf_product_search" class="rpt-select" placeholder="พิมพ์ชื่อ / สแกนบาร์โค้ด / รหัสสินค้า (เลือกได้หลายตัว)" autocomplete="off">
        <div id="rpf_product_results" class="rpf-results"></div>
      </div>${(f.products&&f.products.length)?`<button class="btn ghost rpf-clear" id="rpClearProductsBtn">ล้างที่เลือก (${f.products.length})</button>`:''}`:''}
      <button class="btn ghost rpf-apply" id="rpApplyBtn">แสดงผล</button>
    </div>

    <div class="rpt-body">
      <div class="rpt-meta">
        <div class="rpt-biz">${escapeHtml(businessSettings.name||STORE_INFO.name)}</div>
        <div class="rpt-meta-grid">
          <div class="rpt-meta-left">
            <div><span class="rpt-meta-k">ณ วันที่</span><span class="rpt-meta-v">${thDate(today)}</span></div>
            <div><span class="rpt-meta-k">ช่วงเวลา</span><span class="rpt-meta-v">${thDate(range.from)} - ${thDate(range.to)}</span></div>
            <div><span class="rpt-meta-k">จำนวนทั้งหมด</span><span class="rpt-meta-v">${docCount} เอกสาร</span></div>
          </div>
          <div class="rpt-meta-right">
            <span class="rpt-meta-total-k">ยอดรวม</span>
            <span class="rpt-meta-total-v">${fmtMoney(grandVal)}</span>
          </div>
        </div>
      </div>

      ${dateKeys.length?dateKeys.map(d=>{
        const dayRows=Object.values(byDate[d]).sort((a,b)=>a.name.localeCompare(b.name,'th'));
        const dayTotal=dayRows.reduce((a,r)=>a+r.val,0);
        return `<div class="rpt-day-group">
          <div class="rpt-day-head"><span class="rpt-day-date">${thDate(d)}</span><span class="rpt-day-total">${fmtMoney(dayTotal)}</span></div>
          <table class="rpt-table">
            <colgroup><col class="col-name"><col class="col-qty"><col class="col-unit"><col class="col-price"></colgroup>
            <tbody>
              ${dayRows.map(r=>`<tr>
                <td class="rpt-pname">${(f.scope==='product'&&f.products&&f.products.length)?`<button class="rpt-row-x" data-name="${escapeHtml(r.name)}" title="เอาออก">×</button> `:''}${escapeHtml(r.name)}</td>
                <td class="mono" style="text-align:right;">${r.qty.toFixed(2)}</td>
                <td>${escapeHtml(r.unit||'-')}</td>
                <td class="mono" style="text-align:right;">${fmtMoney(r.val)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      }).join(''):`<div class="rpt-empty">${f.applied?'ไม่มีข้อมูลการขายในช่วงเวลาที่เลือก':'เลือกเงื่อนไขแล้วกด “แสดงผล” เพื่อดูรายงาน'}</div>`}
    </div>
  </div>`;
}

function rbillPeriodRange(filter=rbillFilter){
  const today = new Date(TODAY_STR); // อ้างอิงวันปัจจุบันของระบบ
  const y=today.getFullYear(), m=today.getMonth();
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const f=filter;
  if(f.period==='today'){ const t=iso(today); return {from:t, to:t, label:'วันนี้'}; }
  if(f.period==='selectmonth'){ const mm=f.month||`${y}-${String(m+1).padStart(2,'0')}`; const [yy,mo]=mm.split('-').map(Number); return {from:iso(new Date(yy,mo-1,1)), to:iso(new Date(yy,mo,0)), label:'เลือกเดือน'}; }
  if(f.period==='selectyear'){ const yy=f.year||y; return {from:iso(new Date(yy,0,1)), to:iso(new Date(yy,11,31)), label:'เลือกปี'}; }
  return {from:f.from||iso(new Date(y,m,1)), to:f.to||iso(new Date(y,m+1,0)), label:'เลือกช่วงวันที่'};
}

// รวมยอดขายเป็นรายบิล (ไม่แยกตามสินค้า) ตามตัวกรองที่ตั้งไว้
function rbillCollect(filter=rbillFilter){
  const f=filter, range=rbillPeriodRange(filter);
  const inRange=s=>{ const d=(s.date||'').slice(0,10); return d>=range.from && d<=range.to; };
  const prodByName={}; products.forEach(p=>{ prodByName[p.name]=p; });
  let bills = f.applied ? salesHistory.filter(s=>s.status!=='void').filter(inRange) : [];
  if(f.pay && f.pay!=='all') bills = bills.filter(s=>(s.payMethod||'เงินสด')===f.pay);
  // กรองบิลตามคลัง/หมวด/สินค้า: บิลจะรวมอยู่ในผลลัพธ์ถ้ามีอย่างน้อย 1 รายการที่ตรงเงื่อนไข
  bills = bills.filter(s=>s.items.some(it=>{
    const p=prodByName[it.name]||{};
    if(f.wh!=='all' && String(saleWarehouseForReport(s,it,p))!==String(f.wh)) return false;
    if(f.scope==='category' && f.category && (p.category||'')!==f.category) return false;
    if(f.scope==='brand' && f.brand && (p.brand||'')!==f.brand) return false;
    if(f.scope==='product' && f.products && f.products.length && !f.products.includes(it.name)) return false;
    return true;
  }));
  // รวมเป็นหนึ่งแถวต่อหนึ่งบิล และเก็บรายการสินค้าทั้งหมดไว้ภายในแถวนั้น
  const byDate={};
  bills.forEach(s=>{
    const d=(s.date||'').slice(0,10);
    if(!byDate[d]) byDate[d]=[];
    const items=(s.items||[]).map(it=>{
      const p=prodByName[it.name]||{};
      return {name:it.name,qty:it.qty,unit:it.unit||p.unit||'-'};
    });
    byDate[d].push({billId:s.ref||s.id,payMethod:s.payMethod||'-',items,val:Number(s.total)||0});
  });
  const dateKeys=Object.keys(byDate).filter(d=>byDate[d].length).sort((a,b)=>a.localeCompare(b));
  const allRows=dateKeys.flatMap(d=>byDate[d]);
  const grandVal=bills.reduce((a,s)=>a+s.total,0);
  return {f, range, byDate, dateKeys, allRows, grandVal, docCount:bills.length};
}

function billItemsPlainText(items){
  return (items||[]).map(it=>`${it.name} x${it.qty}${it.unit?' '+it.unit:''}`).join('; ');
}

function billItemsReportHtml(items){
  return `<div style="display:flex;flex-direction:column;gap:3px;">${(items||[]).map(it=>`<div>${escapeHtml(it.name)} <span style="white-space:nowrap;">×${escapeHtml(it.qty)} ${escapeHtml(it.unit||'')}</span></div>`).join('')||'-'}</div>`;
}

function exportRBillExcel(filter=rbillFilter,reportTitle='รายงานยอดขายตามบิล'){
  const {range, byDate, dateKeys} = rbillCollect(filter);
  let csv='\uFEFF';
  csv+='วันที่,เลขที่บิล,รายการทั้งหมด,วิธีชำระเงิน,ยอดรวม\n';
  dateKeys.forEach(d=>{
    byDate[d].forEach(r=>{ csv+=`${csvSpreadsheetText(d)},${csvSpreadsheetText(r.billId)},${csvSpreadsheetText(billItemsPlainText(r.items))},${csvSpreadsheetText(r.payMethod)},${r.val.toFixed(2)}\n`; });
  });
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`${reportTitle}_${range.from}_${range.to}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('ดาวน์โหลดไฟล์ Excel (CSV) แล้ว');
}

function printRBill(filter=rbillFilter,reportTitle='รายงานยอดขายตามบิล'){
  const {range, byDate, dateKeys, allRows, grandVal, docCount} = rbillCollect(filter);
  const bizName=businessSettings.name||STORE_INFO.name;
  const thDate=d=>{ const dt=new Date(d); return dt.getDate()+' '+['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][dt.getMonth()]+' '+dt.getFullYear(); };
  const today=new Date(TODAY_STR);
  const dayBlocksHtml = dateKeys.length ? dateKeys.map(d=>{
    const dayRows=byDate[d];
    const dayTotal=dayRows.reduce((a,r)=>a+r.val,0);
    return `<div class="day-block">
      <table>
        <colgroup><col style="width:20%"><col style="width:48%"><col style="width:15%"><col style="width:17%"></colgroup>
        <tbody><tr class="day-head-row"><td>${thDate(d)}</td><td colspan="2"></td><td class="r">${fmtMoney(dayTotal)}</td></tr>
        ${dayRows.map(r=>`<tr><td class="pd-name">${escapeHtml(r.billId)}</td><td>${billItemsReportHtml(r.items)}</td><td>${escapeHtml(r.payMethod)}</td><td class="r">${fmtMoney(r.val)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  }).join('') : `<div style="text-align:center;color:#888;padding:24px;">ไม่มีข้อมูล</div>`;

  const win=window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร'); return; }
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${escapeHtml(reportTitle)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @page{size:A4;margin:14mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
    body{margin:0;background:#F0F0F0;color:#2b2b2b;font-family:'Sarabun',sans-serif;font-size:13px}
    .toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#fff;box-shadow:0 2px 8px #0002}
    .toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:9px 18px;font:600 14px Sarabun;cursor:pointer}
    .page{width:210mm;min-height:297mm;margin:12px auto;padding:16mm 14mm;background:#fff;box-shadow:0 4px 20px #0002}
    h1{text-align:center;font-size:20px;font-weight:700;margin:0 0 22px;color:#4F4038}
    .biz{font-size:18px;font-weight:600;margin-bottom:12px;color:#4F4038}
    .meta{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:6px;padding-bottom:14px;border-bottom:1px solid #ddd;}
    .meta-left div{display:flex;gap:12px;margin-bottom:3px}
    .meta-left .k{min-width:92px}
    .meta-right{text-align:right}
    .meta-right .tot{display:flex;justify-content:flex-end;gap:24px;align-items:baseline;}
    .meta-right .tot .k{color:#2b2b2b}
    .meta-right .tot .v{font-weight:700;font-size:18px;min-width:90px;color:#4F4038}
    .day-block{margin-top:18px;}
    .day-head-row td{background:#F1E8E5;font-weight:600;font-size:12.5px;color:#4F4038;padding:7px 8px;border-bottom:none;}
    table{width:100%;border-collapse:collapse;table-layout:fixed;}
    thead th{text-align:left;padding:9px 8px;font-size:12px;font-weight:600;color:#444;border-bottom:1px solid #333}
    tbody td{padding:9px 8px;border-bottom:1px solid #e2e6ea;font-size:12.5px}
    .r{text-align:right}
    .pd-name{color:#2b2b2b}
    .foot{display:flex;justify-content:space-between;margin-top:14px;font-size:12px;color:#444}
    @media print{body{background:#fff}.toolbar{display:none}.page{margin:0;box-shadow:none;width:auto;min-height:0;padding:0}.day-head-row td{background:#F1E8E5!important;-webkit-box-shadow:inset 0 0 0 1000px #F1E8E5!important;box-shadow:inset 0 0 0 1000px #F1E8E5!important}}
  </style></head><body>
  <div class="toolbar"><span>ตัวอย่างรายงาน A4</span><button onclick="window.print()">พิมพ์</button></div>
  <div class="page">
    <h1>${escapeHtml(reportTitle)}</h1>
    <div class="biz">${escapeHtml(bizName)}</div>
    <div class="meta">
      <div class="meta-left">
        <div><span class="k">ณ วันที่</span><span>${thDate(today)}</span></div>
        <div><span class="k">ช่วงเวลา</span><span>${thDate(range.from)} - ${thDate(range.to)}</span></div>
        <div><span class="k">จำนวนทั้งหมด</span><span>${docCount} เอกสาร</span></div>
      </div>
      <div class="meta-right">
        <div class="tot"><span class="k">ยอดรวม</span><span class="v">${fmtMoney(grandVal)}</span></div>
      </div>
    </div>
    ${dayBlocksHtml}
  </div>
  </body></html>`);
  win.document.close();
  standardizePrintPreview(win);
}

function renderRBill(){
  const f=rbillFilter;
  const range=rbillPeriodRange(f);
  const reportTitle='รายงานยอดขายตามบิล';
  const idPrefix='rb';
  const fieldPrefix='rbf';
  const periodOpts=[['today','วันนี้'],['range','เลือกช่วงวันที่'],['selectmonth','เลือกเดือน'],['selectyear','เลือกปี']];
  const {byDate, dateKeys, grandVal, docCount} = rbillCollect(f);
  const thDate=d=>{ const dt=new Date(d); return dt.getDate()+' '+['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][dt.getMonth()]+' '+dt.getFullYear(); };
  const today=new Date(TODAY_STR);

  return `<div class="rpt rpt-page-scroll">
    <div class="rpt-head">
      <h1>${reportTitle}</h1>
      <div class="rpt-head-actions">
        <button class="btn primary" id="${idPrefix}PrintBtn">พิมพ์รายงาน</button>
      </div>
    </div>

    <div class="rpt-filters">
      <div class="rpf-item">
        <select id="${fieldPrefix}_period" class="rpt-select">
          ${periodOpts.map(([v,l])=>`<option value="${v}" ${f.period===v?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      ${f.period==='range'?`
      <div class="rpf-item rpf-range">
        ${dmyDateFieldHtml(fieldPrefix+'_from', range.from)}
        <span style="color:var(--text-muted);">ถึง</span>
        ${dmyDateFieldHtml(fieldPrefix+'_to', range.to)}
      </div>`:''}
      ${f.period==='selectmonth'?`<div class="rpf-item"><input type="month" id="${fieldPrefix}_month" value="${f.month||range.from.slice(0,7)}" class="rpt-select"></div>`:''}
      ${f.period==='selectyear'?`<div class="rpf-item"><select id="${fieldPrefix}_year" class="rpt-select">${(()=>{const cy=2026;let o='';for(let yy=cy;yy>=cy-6;yy--){o+=`<option value="${yy}" ${String(f.year||cy)===String(yy)?'selected':''}>${yy}</option>`;}return o;})()}</select></div>`:''}
      <div class="rpf-item">
        <select id="${fieldPrefix}_wh" class="rpt-select">
          <option value="all" ${f.wh==='all'?'selected':''}>ทุกคลัง</option>
          ${accessibleWarehouses().map(w=>`<option value="${escapeHtml(w.id)}" ${String(f.wh)===String(w.id)?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}
        </select>
      </div>
      <div class="rpf-item">
        <select id="${fieldPrefix}_pay" class="rpt-select">
          <option value="all" ${(f.pay||'all')==='all'?'selected':''}>วิธีชำระทั้งหมด</option>
          <option value="เงินสด" ${f.pay==='เงินสด'?'selected':''}>เงินสด</option>
          <option value="โอนธนาคาร" ${f.pay==='โอนธนาคาร'?'selected':''}>โอน</option>
          <option value="บัตรเครดิต" ${f.pay==='บัตรเครดิต'?'selected':''}>บัตรเครดิต</option>
          <option value="ออนไลน์" ${f.pay==='ออนไลน์'?'selected':''}>ออนไลน์</option>
        </select>
      </div>
      <button class="btn ghost rpf-apply" id="${idPrefix}ApplyBtn">แสดงผล</button>
    </div>

    <div class="rpt-body">
      <div class="rpt-meta">
        <div class="rpt-biz">${escapeHtml(businessSettings.name||STORE_INFO.name)}</div>
        <div class="rpt-meta-grid">
          <div class="rpt-meta-left">
            <div><span class="rpt-meta-k">ณ วันที่</span><span class="rpt-meta-v">${thDate(today)}</span></div>
            <div><span class="rpt-meta-k">ช่วงเวลา</span><span class="rpt-meta-v">${thDate(range.from)} - ${thDate(range.to)}</span></div>
            <div><span class="rpt-meta-k">จำนวนทั้งหมด</span><span class="rpt-meta-v">${docCount} เอกสาร</span></div>
          </div>
          <div class="rpt-meta-right">
            <span class="rpt-meta-total-k">ยอดรวม</span>
            <span class="rpt-meta-total-v">${fmtMoney(grandVal)}</span>
          </div>
        </div>
      </div>

      ${dateKeys.length?dateKeys.map(d=>{
        const dayRows=byDate[d];
        const dayTotal=dayRows.reduce((a,r)=>a+r.val,0);
        return `<div class="rpt-day-group">
          <table class="rpt-table rpt-day-head-table">
            <colgroup><col style="width:20%"><col style="width:48%"><col style="width:15%"><col style="width:17%"></colgroup>
            <tbody><tr class="rpt-day-head-row">
              <td class="rpt-day-date" style="text-align:center;">${thDate(d)}</td>
              <td colspan="2"></td>
              <td class="rpt-day-total" style="text-align:center;">${fmtMoney(dayTotal)}</td>
            </tr></tbody>
          </table>
          <table class="rpt-table">
            <colgroup><col style="width:20%"><col style="width:48%"><col style="width:15%"><col style="width:17%"></colgroup>
            <tbody>
              ${dayRows.map(r=>`<tr>
                <td class="rpt-pname" style="text-align:center;">${escapeHtml(r.billId)}</td>
                <td>${billItemsReportHtml(r.items)}</td>
                <td style="text-align:center;">${escapeHtml(r.payMethod||'-')}</td>
                <td class="mono" style="text-align:center;">${fmtMoney(r.val)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      }).join(''):`<div class="rpt-empty">${f.applied?'ไม่มีข้อมูลการขายในช่วงเวลาที่เลือก':'เลือกเงื่อนไขแล้วกด “แสดงผล” เพื่อดูรายงาน'}</div>`}
    </div>
  </div>`;
}

function rprofitPeriodRange(){
  const today=new Date(TODAY_STR),y=today.getFullYear(),m=today.getMonth();
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const f=rprofitFilter;
  if(f.period==='today'){const t=iso(today);return {from:t,to:t};}
  if(f.period==='selectmonth'){const mm=f.month||`${y}-${String(m+1).padStart(2,'0')}`,[yy,mo]=mm.split('-').map(Number);return {from:iso(new Date(yy,mo-1,1)),to:iso(new Date(yy,mo,0))};}
  if(f.period==='selectyear'){const yy=Number(f.year)||y;return {from:iso(new Date(yy,0,1)),to:iso(new Date(yy,11,31))};}
  return {from:f.from||iso(new Date(y,m,1)),to:f.to||iso(new Date(y,m+1,0))};
}

function rprofitCollect(){
  const f=rprofitFilter,range=rprofitPeriodRange(),prodById={},prodByName={};
  products.forEach(p=>{prodById[p.id]=p;prodByName[p.name]=p;});
  const inRange=s=>{const d=(s.date||'').slice(0,10);return d>=range.from&&d<=range.to;};
  const allInRange=salesHistory.filter(s=>s.status==='done').filter(inRange);
  const hasCostData=s=>(s.items||[]).length>0&&(s.items||[]).every(item=>Object.prototype.hasOwnProperty.call(item,'costTotal')||Object.prototype.hasOwnProperty.call(item,'cost'));
  let bills=f.applied?allInRange.filter(hasCostData):[];
  if(f.pay!=='all') bills=bills.filter(s=>(s.payMethod||'เงินสด')===f.pay);
  if(f.wh!=='all') bills=bills.filter(s=>(s.items||[]).some(it=>{const p=prodById[it.productId]||prodByName[it.name];return String(saleWarehouseForReport(s,it,p))===String(f.wh);}));
  const byDate={};
  const rows=[];
  bills.forEach(s=>{
    const registered=s.vatRegistered===true;
    const prepared=(s.items||[]).map(it=>{
      const qty=Number(it.qty)||0,price=Number(it.price)||0,cost=Number(it.cost)||0;
      const amount=it.lineTotal!==undefined?Number(it.lineTotal)||0:price*qty;
      const vatMode=registered?normalizeProductVatMode(it.vatMode):'none';
      const gross=it.lineTotalGross!==undefined?Number(it.lineTotalGross)||0:grossAmountForVatMode(amount,vatMode,registered);
      const beforeVat=registered&&vatMode!=='none'?gross/(1+VAT_RATE):gross;
      const costTotal=it.costTotal!==undefined?Number(it.costTotal)||0:cost*qty;
      return {source:it,qty,price,cost,gross,beforeVat,costTotal};
    });
    const subtotal=prepared.reduce((sum,item)=>sum+item.gross,0);
    const discount=Number(s.discount)||0;
    const ratio=s.customerReturn?1:subtotal>0?Math.max(0,subtotal-discount)/subtotal:0;
    const items=prepared.map(item=>{
      const net=item.beforeVat*ratio;
      return {name:item.source.name,qty:item.qty,unit:item.source.unit||'-',price:item.price,cost:item.cost,net,costTotal:item.costTotal,profit:net-item.costTotal};
    });
    const fee=Number(s.fee)||0;
    if(fee>0){
      const feeNet=registered?fee/(1+VAT_RATE):fee;
      items.push({name:'ค่าธรรมเนียมบัตร',qty:1,unit:'รายการ',price:fee,cost:0,net:feeNet,costTotal:0,profit:feeNet});
    }
    const revenue=items.reduce((sum,item)=>sum+item.net,0),cost=items.reduce((sum,item)=>sum+item.costTotal,0);
    const row={saleId:s.id,billId:s.ref||s.id,payMethod:s.payMethod||'-',items,revenue,cost,profit:revenue-cost};
    rows.push(row);
    const d=(s.date||'').slice(0,10);(byDate[d]||(byDate[d]=[])).push(row);
  });
  const dateKeys=Object.keys(byDate).sort((a,b)=>a.localeCompare(b));
  const revenue=rows.reduce((sum,row)=>sum+row.revenue,0);
  const cost=rows.reduce((sum,row)=>sum+row.cost,0);
  const profit=revenue-cost;
  const missingCount=f.applied?allInRange.filter(s=>!hasCostData(s)).length:0;
  return {f,range,bills,byDate,dateKeys,revenue,cost,profit,missingCount};
}

function profitItemsReportHtml(items,bill){
  return `<div class="profit-items"><div class="profit-item profit-item-head"><span class="mono">${escapeHtml(bill.billId)}</span><span>จำนวน</span><span>หน่วย</span><span>ขาย</span><span>ทุน</span><span>กำไร</span></div>${items.map(it=>`<div class="profit-item"><span>${escapeHtml(it.name)}</span><span>${it.qty}</span><span>${escapeHtml(it.unit)}</span><span class="mono">${fmtMoney(it.price)}</span><span class="mono">${fmtMoney(it.cost)}</span><span class="mono" style="color:${it.profit<0?'var(--danger)':'#2D7D3D'};font-weight:400;">${it.profit<0?'-':''}${fmtMoney(Math.abs(it.profit))}</span></div>`).join('')}<div class="profit-item profit-item-total"><span class="total-label"></span><span><b class="mono">${fmtMoney(bill.revenue)}</b></span><span><b class="mono">${fmtMoney(bill.cost)}</b></span><span style="color:${bill.profit>=0?'#2D7D3D':'var(--danger)'};"><b class="mono">${bill.profit<0?'-':''}${fmtMoney(Math.abs(bill.profit))}</b></span></div></div>`;
}

function printRProfit(){
  const {range,bills,byDate,dateKeys,revenue,cost,profit,missingCount}=rprofitCollect();
  const bizName=businessSettings.name||STORE_INFO.name;
  const margin=revenue?profit/revenue*100:0;
  const thDate=d=>{const dt=new Date(d);return dt.getDate()+' '+['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][dt.getMonth()]+' '+dt.getFullYear();};
  const dayBlocksHtml=dateKeys.length?dateKeys.map(d=>{
    const rows=byDate[d],dayProfit=rows.reduce((sum,row)=>sum+row.profit,0);
    return `<section class="day-block">
      <div class="day-head"><span>${thDate(d)}</span><span class="${dayProfit<0?'negative':'positive'}">${dayProfit>0?'+ ':dayProfit<0?'- ':''}${fmtMoney(Math.abs(dayProfit))}</span></div>
      ${rows.map(bill=>`<div class="bill-block">
        <div class="bill-head"><b>${escapeHtml(bill.billId)}</b><span>${escapeHtml(bill.payMethod)}</span></div>
        <table><colgroup><col style="width:37%"><col style="width:9%"><col style="width:10%"><col style="width:14%"><col style="width:14%"><col style="width:16%"></colgroup><thead><tr><th>สินค้า</th><th class="r">จำนวน</th><th>หน่วย</th><th class="r">ยอดขาย</th><th class="r">ต้นทุน</th><th class="r">กำไร/ขาดทุน</th></tr></thead><tbody>
          ${bill.items.map(item=>`<tr><td>${escapeHtml(item.name)}</td><td class="r">${item.qty}</td><td>${escapeHtml(item.unit)}</td><td class="r">${fmtMoney(item.net)}</td><td class="r">${fmtMoney(item.costTotal)}</td><td class="r ${item.profit<0?'negative':'positive'}">${item.profit<0?'-':''}${fmtMoney(Math.abs(item.profit))}</td></tr>`).join('')}
          <tr class="bill-total"><td colspan="3">รวมบิล</td><td class="r">${fmtMoney(bill.revenue)}</td><td class="r">${fmtMoney(bill.cost)}</td><td class="r ${bill.profit<0?'negative':'positive'}">${bill.profit<0?'-':''}${fmtMoney(Math.abs(bill.profit))}</td></tr>
        </tbody></table>
      </div>`).join('')}
    </section>`;
  }).join(''):'<div class="empty">ไม่มีบิลที่มีข้อมูลต้นทุนในช่วงเวลาที่เลือก</div>';
  const win=window.open('','_blank'); if(!win){showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร');return;}
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>รายงานกำไร / ขาดทุน</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    body{margin:0;background:#f0f0f0;color:#2b2b2b;font-family:'Sarabun',sans-serif;font-size:12px}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#fff;box-shadow:0 2px 8px #0002}.toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:9px 18px;font:600 14px Sarabun;cursor:pointer}.page{width:210mm;min-height:297mm;margin:12px auto;padding:14mm 12mm;background:#fff;box-shadow:0 4px 20px #0002}h1{text-align:center;color:#4F4038;font-size:20px;margin:0 0 18px}.biz{color:#4F4038;font-size:17px;font-weight:600;margin-bottom:10px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;padding-bottom:12px;border-bottom:1px solid #d9dee3}.meta span:nth-child(odd){font-weight:600}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.summary div{border:1px solid #dfe4e8;border-radius:8px;padding:9px}.summary span{display:block;color:#756B67;font-size:10.5px}.summary b{display:block;margin-top:3px;font-size:14px}.positive{color:#2D7D3D!important}.negative{color:#C2483E!important}.warning{margin:10px 0;padding:8px 10px;border-radius:6px;background:#fff4df;color:#8a5a10}.day-block{margin-top:16px;break-inside:avoid}.day-head{display:flex;justify-content:space-between;background:#F1E8E5;color:#4F4038;font-weight:600;padding:7px 8px;border-radius:6px}.bill-block{margin-top:8px;break-inside:avoid}.bill-head{display:flex;justify-content:space-between;padding:5px 7px;background:#f6f7f9}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:6px 7px;border-bottom:1px solid #e1e5e9;text-align:left}th{font-size:10.5px;color:#5d6670}.r{text-align:right}.bill-total td{font-weight:600;border-top:1px solid #aeb7bf}.empty{text-align:center;color:#888;padding:28px}@media print{body{background:#fff}.toolbar{display:none}.page{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.day-head{background:#F1E8E5!important}}
  </style></head><body><div class="toolbar"><span>ตัวอย่างรายงาน A4</span><button onclick="window.print()">พิมพ์</button></div><main class="page">
    <h1>รายงานกำไร / ขาดทุน</h1><div class="biz">${escapeHtml(bizName)}</div>
    <div class="meta"><span>ณ วันที่</span><span>${thDate(TODAY_STR)}</span><span>ช่วงเวลา</span><span>${thDate(range.from)} - ${thDate(range.to)}</span><span>จำนวนทั้งหมด</span><span>${bills.length} เอกสาร</span></div>
    <div class="summary"><div><span>ยอดขาย</span><b>${fmtMoney(revenue)}</b></div><div><span>ต้นทุน</span><b>${fmtMoney(cost)}</b></div><div><span>กำไร / ขาดทุน</span><b class="${profit<0?'negative':'positive'}">${profit<0?'-':''}${fmtMoney(Math.abs(profit))}</b></div><div><span>อัตรากำไร</span><b class="${margin<0?'negative':'positive'}">${margin.toFixed(2)}%</b></div></div>
    ${missingCount?`<div class="warning">มี ${missingCount} บิลที่ไม่มีข้อมูลต้นทุนและไม่ถูกรวมในรายงาน</div>`:''}${dayBlocksHtml}
  </main></body></html>`);
  win.document.close();
  standardizePrintPreview(win);
}

function renderRProfit(){
  const {f,range,bills,byDate,dateKeys,revenue,cost,profit,missingCount}=rprofitCollect();
  const periodOpts=[['today','วันนี้'],['range','เลือกช่วงวันที่'],['selectmonth','เลือกเดือน'],['selectyear','เลือกปี']];
  const thDate=d=>{const dt=new Date(d);return dt.getDate()+' '+['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][dt.getMonth()]+' '+dt.getFullYear();};
  const margin=revenue?profit/revenue*100:0;
  return `<div class="rpt">
    <div class="rpt-head"><h1>รายงานกำไร / ขาดทุน</h1><div class="rpt-head-actions"><button class="btn primary" id="rprofitPrintBtn">พิมพ์รายงาน</button></div></div>
    <div class="rpt-filters">
      <div class="rpf-item"><select id="rprofit_period" class="rpt-select">${periodOpts.map(([v,l])=>`<option value="${v}" ${f.period===v?'selected':''}>${l}</option>`).join('')}</select></div>
      ${f.period==='range'?`<div class="rpf-item rpf-range">${dmyDateFieldHtml('rprofit_from',range.from)}<span style="color:var(--text-muted);">ถึง</span>${dmyDateFieldHtml('rprofit_to',range.to)}</div>`:''}
      ${f.period==='selectmonth'?`<div class="rpf-item"><input type="month" id="rprofit_month" value="${f.month||range.from.slice(0,7)}" class="rpt-select"></div>`:''}
      ${f.period==='selectyear'?`<div class="rpf-item"><select id="rprofit_year" class="rpt-select">${(()=>{const cy=Number(TODAY_STR.slice(0,4));let o='';for(let yy=cy;yy>=cy-6;yy--)o+=`<option value="${yy}" ${String(f.year||cy)===String(yy)?'selected':''}>${yy}</option>`;return o;})()}</select></div>`:''}
      <div class="rpf-item"><select id="rprofit_wh" class="rpt-select"><option value="all" ${f.wh==='all'?'selected':''}>ทุกคลัง</option>${accessibleWarehouses().map(w=>`<option value="${w.id}" ${String(f.wh)===String(w.id)?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}</select></div>
      <div class="rpf-item"><select id="rprofit_pay" class="rpt-select"><option value="all">วิธีชำระทั้งหมด</option><option value="เงินสด" ${f.pay==='เงินสด'?'selected':''}>เงินสด</option><option value="โอนธนาคาร" ${f.pay==='โอนธนาคาร'?'selected':''}>โอนธนาคาร</option><option value="บัตรเครดิต" ${f.pay==='บัตรเครดิต'?'selected':''}>บัตรเครดิต</option></select></div>
      <button class="btn ghost rpf-apply" id="rprofitApplyBtn">แสดงผล</button>
    </div>
    <div class="rpt-body">
      <div class="rpt-meta"><div class="rpt-biz">${escapeHtml(businessSettings.name||STORE_INFO.name)}</div><div class="rpt-meta-grid"><div class="rpt-meta-left"><div><span class="rpt-meta-k">ณ วันที่</span><span class="rpt-meta-v">${thDate(TODAY_STR)}</span></div><div><span class="rpt-meta-k">ช่วงเวลา</span><span class="rpt-meta-v">${thDate(range.from)} - ${thDate(range.to)}</span></div><div><span class="rpt-meta-k">จำนวนทั้งหมด</span><span class="rpt-meta-v">${bills.length} เอกสาร</span></div></div><div class="rpt-meta-right"><span class="rpt-meta-total-k">กำไร / ขาดทุนรวม</span><span class="rpt-meta-total-v" style="color:${profit>=0?'#2D7D3D':'var(--danger)'};">${profit<0?'-':''}${fmtMoney(Math.abs(profit))}</span></div></div></div>
      ${dateKeys.length?dateKeys.map(d=>{const rows=byDate[d],dayProfit=rows.reduce((sum,r)=>sum+r.profit,0);return `<div class="rpt-day-group"><div class="profit-day-head"><span class="rpt-day-date">${thDate(d)}</span><span class="profit-day-total" style="color:${dayProfit>=0?'#2D7D3D':'var(--danger)'};">${dayProfit>0?'+ ':dayProfit<0?'- ':''}${fmtMoney(Math.abs(dayProfit))}</span></div>${rows.map(r=>`<div class="profit-bill">${profitItemsReportHtml(r.items,r)}</div>`).join('')}</div>`;}).join(''):`<div class="rpt-empty">${f.applied?'ไม่มีบิลที่มีข้อมูลต้นทุนในช่วงเวลาที่เลือก':'เลือกเงื่อนไขแล้วกด “แสดงผล” เพื่อดูรายงาน'}</div>`}
    </div>
  </div>`;
}

function renderRTax(){
  const registered=isBusinessVatRegistered();
  const effectiveDate=businessSettings.vatRegistrationDate||'';
  const saleRows=salesHistory.filter(s=>s.status==='done'&&s.vatRegistered===true&&String(s.date||'').slice(0,7)===rtaxMonth&&(!effectiveDate||String(s.date||'').slice(0,10)>=effectiveDate)).map(s=>({doc:s,tax:saleTaxSummary(s)}));
  const purchaseRows=goodsReceipts.filter(doc=>doc.status!=='รอรับสินค้า'&&String(doc.supplierTaxInvoiceDate||doc.date||'').slice(0,7)===rtaxMonth).map(doc=>{
    const tax=doc.taxSummary||calculatePurchaseTaxSummary(doc.items,doc.discount||0,doc.taxMode||'incl');
    const claimable=registered&&tax.registered&&!!doc.supplierTaxInvoiceNo&&!!doc.supplierTaxInvoiceDate&&(!effectiveDate||doc.supplierTaxInvoiceDate>=effectiveDate);
    return {doc,tax,claimable};
  }).filter(row=>row.tax.registered);
  const outputBefore=saleRows.reduce((sum,row)=>sum+row.tax.beforeVat,0),outputVat=saleRows.reduce((sum,row)=>sum+row.tax.vat,0),outputTotal=saleRows.reduce((sum,row)=>sum+row.tax.total,0);
  const inputBefore=purchaseRows.filter(row=>row.claimable).reduce((sum,row)=>sum+row.tax.beforeVat,0),inputVat=purchaseRows.filter(row=>row.claimable).reduce((sum,row)=>sum+row.tax.vat,0),inputTotal=purchaseRows.filter(row=>row.claimable).reduce((sum,row)=>sum+row.tax.total,0);
  const netVat=outputVat-inputVat;
  return `<div class="rpt">
    ${registered?'':`<div class="panel" style="margin-bottom:14px;color:var(--danger);">กิจการยังไม่ได้ตั้งค่าเป็น “จดภาษีมูลค่าเพิ่มแล้ว” รายงานนี้จะแสดงเพื่อเตรียมข้อมูลเท่านั้น และจะไม่ถือว่ามีภาษีซื้อที่นำไปใช้ได้</div>`}
    <div class="rpt-filters"><div class="rpf-item"><input type="month" id="rtax_month" value="${escapeHtml(rtaxMonth)}" class="rpt-select"></div>${effectiveDate?`<div class="rpf-item" style="color:var(--text-muted);">เริ่มจด VAT ${fmtDateShort(effectiveDate)}</div>`:''}</div>
    <div class="panel" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px;"><div><small>ภาษีขาย</small><h2 class="mono">${fmtMoney(outputVat)}</h2></div><div><small>ภาษีซื้อที่ใช้ได้</small><h2 class="mono">${fmtMoney(inputVat)}</h2></div><div><small>${netVat>=0?'ภาษีที่ต้องชำระ':'ภาษีซื้อคงเหลือ'}</small><h2 class="mono" style="color:${netVat>=0?'var(--danger)':'#2D7D3D'};">${fmtMoney(Math.abs(netVat))}</h2></div><div><small>เอกสารที่ข้อมูลภาษีซื้อไม่ครบ</small><h2 class="mono">${purchaseRows.filter(row=>!row.claimable).length}</h2></div></div>
    <div class="panel"><h2>ภาษีขาย</h2><table class="grid-table doc-head-blue"><thead><tr><th>วันที่</th><th>เลขที่บิล</th><th>คลังสินค้า</th><th class="num">มูลค่าก่อน VAT</th><th class="num">VAT</th><th class="num">ยอดรวม</th></tr></thead><tbody>${saleRows.length?saleRows.map(({doc,tax})=>`<tr><td>${fmtDateShort(doc.date)}</td><td class="mono">${escapeHtml(doc.ref||doc.id)}</td><td>${escapeHtml(doc.warehouseName||warehouses.find(w=>Number(w.id)===Number(doc.warehouseId))?.name||'-')}</td><td class="mono num">${fmtMoney(tax.beforeVat)}</td><td class="mono num">${fmtMoney(tax.vat)}</td><td class="mono num">${fmtMoney(tax.total)}</td></tr>`).join(''):`<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">ไม่มีรายการภาษีขายในเดือนนี้</td></tr>`}</tbody><tfoot><tr><th colspan="3">รวม</th><th class="mono num">${fmtMoney(outputBefore)}</th><th class="mono num">${fmtMoney(outputVat)}</th><th class="mono num">${fmtMoney(outputTotal)}</th></tr></tfoot></table></div>
    <div class="panel" style="margin-top:16px;"><h2>ภาษีซื้อ</h2><table class="grid-table doc-head-blue"><thead><tr><th>วันที่ใบกำกับ</th><th>เลขที่ใบกำกับผู้จำหน่าย</th><th>ผู้จำหน่าย</th><th>เอกสารรับเข้า</th><th>สถานะ</th><th class="num">มูลค่าก่อน VAT</th><th class="num">VAT</th><th class="num">ยอดรวม</th></tr></thead><tbody>${purchaseRows.length?purchaseRows.map(({doc,tax,claimable})=>`<tr><td>${doc.supplierTaxInvoiceDate?fmtDateShort(doc.supplierTaxInvoiceDate):'-'}</td><td class="mono">${escapeHtml(doc.supplierTaxInvoiceNo||'-')}</td><td>${escapeHtml(doc.supplier||'-')}</td><td class="mono">${escapeHtml(doc.id)}</td><td style="color:${claimable?'#2D7D3D':'var(--danger)'};">${claimable?'ข้อมูลครบ':'รอเลขที่/วันที่ใบกำกับ'}</td><td class="mono num">${fmtMoney(tax.beforeVat)}</td><td class="mono num">${fmtMoney(claimable?tax.vat:0)}</td><td class="mono num">${fmtMoney(tax.total)}</td></tr>`).join(''):`<tr><td colspan="8" style="text-align:center;color:var(--text-muted);">ไม่มีรายการภาษีซื้อในเดือนนี้</td></tr>`}</tbody><tfoot><tr><th colspan="5">รวมรายการที่ข้อมูลครบ</th><th class="mono num">${fmtMoney(inputBefore)}</th><th class="mono num">${fmtMoney(inputVat)}</th><th class="mono num">${fmtMoney(inputTotal)}</th></tr></tfoot></table></div>
  </div>`;
}

function stockReportProductMatchesFilter(product,filter=stockReportCatFilter){
  return (!filter.category||product?.category===filter.category)&&(!filter.brand||product?.brand===filter.brand);
}
function stockReportSelectedItemsHtml(){
  if(!stockReportItems.length) return '';
  return `<div class="stock-report-selected-products"><span class="stock-report-selected-label">สินค้าที่เลือก ${stockReportItems.length} รายการ</span><div class="stock-report-selected-list">${stockReportItems.map(row=>`<span class="stock-report-product-chip">${escapeHtml(row.name)}<button type="button" data-sr-chip-remove="${row.pid}" aria-label="ลบ ${escapeHtml(row.name)}">×</button></span>`).join('')}</div><button type="button" class="stock-report-clear-products" id="srClearSelected">ล้างทั้งหมด</button></div>`;
}
function stockReportVisibleColumns(){
  return {sku:stockReportColumns.sku!==false,barcode:stockReportColumns.barcode!==false,price:stockReportColumns.price,cost:stockReportColumns.cost&&!isLevel2User()};
}
function stockReportQuantityText(product,stock){
  const quantity=Number(stock);
  if(!Number.isFinite(quantity)) return '-';
  const units=[{name:product?.unit||'หน่วย',factor:1},...(product?.units||[]).map(unit=>({name:unit.sub,factor:Number(unit.factor)}))]
    .filter(unit=>unit.name&&Number.isFinite(unit.factor)&&unit.factor>0)
    .sort((a,b)=>b.factor-a.factor);
  const round=value=>Math.round(value*1e6)/1e6;
  const format=value=>value.toLocaleString('th-TH',{maximumFractionDigits:6});
  let remaining=round(Math.abs(quantity));
  if(!remaining) return `0 ${product?.unit||'หน่วย'}`;
  const parts=[];
  units.forEach((unit,index)=>{
    const ratio=round(remaining/unit.factor);
    const amount=index===units.length-1?ratio:Math.floor(ratio);
    if(amount>0){
      parts.push(`${quantity<0?'-':''}${format(amount)} ${unit.name}`);
      remaining=round(Math.max(0,remaining-amount*unit.factor));
    }
  });
  return parts.join(' ');
}
function stockReportProductCellsHtml(row){
  const product=products.find(item=>item.id===row.pid),columns=stockReportVisibleColumns();
  const priceCell=key=>`<td class="stock-report-price">${product?fmtFavoritePrice(key==='price'?product.price:productUnitCost(product,product.unit,1)):'-'}</td>`;
  return `${columns.sku?`<td class="mono stock-report-code">${escapeHtml(product?.sku||'-')}</td>`:''}${columns.barcode?`<td class="mono stock-report-code">${escapeHtml(product?.barcode||'-')}</td>`:''}<td class="stock-report-name">${escapeHtml(product?.name||row.name)}</td>${columns.price?priceCell('price'):''}${columns.cost?priceCell('cost'):''}`;
}
function stockReportHeadersHtml(forPrint=false){
  const all=String(stockReportCatFilter.wh||(isAllWarehousesMode()?'all':activeWarehouseId))==='all';
  const columns=stockReportVisibleColumns(),reportWarehouses=all?accessibleWarehouses():[];
  const rowSpan=all?' rowspan="2"':'';
  const center=forPrint?' class="c"':'';
  return `<tr>${columns.sku?`<th${rowSpan}>รหัสสินค้า</th>`:''}${columns.barcode?`<th${rowSpan}>บาร์โค้ด</th>`:''}<th${rowSpan}>${forPrint?'สินค้า':stockReportTh('name','สินค้า')}</th>${columns.price?`<th${rowSpan}${center}>ขาย</th>`:''}${columns.cost?`<th${rowSpan}${center}>ทุน</th>`:''}<th${all?` colspan="${reportWarehouses.length}"`:''}${center}>${forPrint?'คงเหลือ':stockReportTh('stock','คงเหลือ')}</th>${forPrint?'':`<th${rowSpan} class="stock-report-action"></th>`}</tr>${all?`<tr>${reportWarehouses.map((warehouse,index)=>`<th class="stock-report-warehouse${forPrint?' c':''}" title="${escapeHtml(warehouse.name)}">คลังที่ ${index+1}<small>${escapeHtml(warehouse.name)}</small></th>`).join('')}</tr>`:''}`;
}
function renderRInventory(){
  const catf=stockReportCatFilter;
  const selectedWarehouseValue=String(catf.wh||(isAllWarehousesMode()?'all':activeWarehouseId));
  catf.wh=selectedWarehouseValue;
  // หมวดย่อยจะแสดงเฉพาะที่มีสินค้าจริงอยู่ในหมวดหลักที่เลือกไว้ (ถ้ายังไม่เลือกหมวดหลัก จะโชว์หมวดย่อยทั้งหมด)
  const brandOptions = brands.filter(brand=>products.some(product=>(!catf.category||product.category===catf.category)&&product.brand===brand));
  const matchCount = products.filter(product=>stockReportProductMatchesFilter(product,catf)&&(catf.wh||catf.category||catf.brand)).length;
  return `<div class="rpt">
  <div class="pagehead topbar-action-source"><div></div><div style="display:flex;gap:8px;"><button class="btn ghost" id="resetStockReportBtn">รีเซ็ตข้อมูล</button><button class="btn primary" id="printStockReportBtn">พิมพ์รายงาน</button></div></div>
  <div class="inventory-report-section">
    <div class="rpt-filters stock-report-filters" style="margin-bottom:14px;">
      <div class="rpf-item"><select id="srWarehouseSelect" class="rpt-select"><option value="all" ${selectedWarehouseValue==='all'?'selected':''}>ทุกคลัง</option>${accessibleWarehouses().map(warehouse=>`<option value="${warehouse.id}" ${String(warehouse.id)===selectedWarehouseValue?'selected':''}>${escapeHtml(warehouse.name)}</option>`).join('')}</select></div>
      <div class="rpf-item"><select id="srCategorySelect" class="rpt-select"><option value="">หมวดสินค้าหลัก: ทั้งหมด</option>${categories.map(c=>`<option value="${escapeHtml(c)}" ${catf.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select></div>
      <div class="rpf-item"><select id="srBrandSelect" class="rpt-select"><option value="">หมวดสินค้าย่อย: ทั้งหมด</option>${brandOptions.map(b=>`<option value="${escapeHtml(b)}" ${catf.brand===b?'selected':''}>${escapeHtml(b)}</option>`).join('')}</select></div>
      <button class="btn ghost" id="srAddByCategoryBtn" ${(catf.wh||catf.category||catf.brand)?'':'disabled'}>เลือกสินค้าในตัวกรองนี้${(catf.wh||catf.category||catf.brand)?` (${matchCount})`:''}</button>
      <div class="stock-report-column-controls"><span>แสดงคอลัมน์</span><label><input id="srShowSku" type="checkbox" ${stockReportColumns.sku!==false?'checked':''}> รหัสสินค้า</label><label><input id="srShowBarcode" type="checkbox" ${stockReportColumns.barcode!==false?'checked':''}> บาร์โค้ด</label><label><input id="srShowPrice" type="checkbox" ${stockReportColumns.price?'checked':''}> ขาย</label>${!isLevel2User()?`<label><input id="srShowCost" type="checkbox" ${stockReportColumns.cost?'checked':''}> ทุน</label>`:''}</div>
    </div>
    <div id="stockReportSelectedWrap">${stockReportSelectedItemsHtml()}</div>
    <div style="position:relative;margin-bottom:14px;">
      <input id="srInput" placeholder="ค้นหาหรือสแกนบาร์โค้ด..." style="width:100%;padding:11px 13px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;" autocomplete="off">
      <div id="srResults" class="fav-add-results" hidden style="left:0;right:0;top:calc(100% - 6px);"></div>
    </div>
    <div class="stock-report-table-scroll app-table-scroll-region"><table class="grid-table doc-head-blue stock-report-table"><thead>${stockReportHeadersHtml()}</thead>
    <tbody id="srTbody">${stockReportRowsHtml()}</tbody></table></div>
  </div>
  </div>`;
}

function stockReportTh(key, label){
  const s=stockReportSort;
  const arrow = s.key===key ? (s.dir===1?'▲':'▼') : '↕';
  return `<button type="button" class="stock-report-sort" data-srsort="${key}" aria-label="เรียงตาม${label}">${label}<span class="sortarrow" aria-hidden="true">${arrow}</span></button>`;
}

function stockReportSortedItems(){
  const s=stockReportSort;
  const warehouseValue=String(stockReportCatFilter.wh||(isAllWarehousesMode()?'all':activeWarehouseId));
  const productMap=new Map(products.map(product=>[product.id,product]));
  const keyVal=(row,key)=>{
    if(key==='stock') return reportStock(row.pid,warehouseValue);
    return productMap.get(row.pid)?.name||row.name;
  };
  return [...stockReportItems].sort((a,b)=>{
    const av=keyVal(a,s.key), bv=keyVal(b,s.key);
    if(typeof av==='number' && typeof bv==='number') return (av-bv)*s.dir;
    return String(av).localeCompare(String(bv),'th')*s.dir;
  });
}

function stockReportWarehouseBreakdownHtml(product){
  if(!product) return '-';
  return accessibleWarehouses().map(warehouse=>`<div>${escapeHtml(warehouse.name)} · ${escapeHtml(stockInLargestUnit({...product,stock:warehouseStock(product.id,warehouse.id)}))}</div>`).join('');
}
function stockReportExpiryBreakdownHtml(productId){
  return accessibleWarehouses().map(warehouse=>{const expiry=warehouseExpiry(productId,warehouse.id);return `<div>${escapeHtml(warehouse.name)} · ${expiry?fmtDateShort(expiry):'-'}</div>`;}).join('');
}

function stockReportRowsHtml(forPrint=false){
  const sorted=stockReportSortedItems();
  const selectedWarehouseValue=String(stockReportCatFilter.wh||(isAllWarehousesMode()?'all':activeWarehouseId));
  const reportWarehouses=selectedWarehouseValue==='all'?accessibleWarehouses():[];
  const columns=stockReportVisibleColumns();
  const columnCount=1+Number(columns.sku)+Number(columns.barcode)+Number(columns.price)+Number(columns.cost)+(selectedWarehouseValue==='all'?reportWarehouses.length:1)+(forPrint?0:1);
  return sorted.length
    ? sorted.map(row=>{
        const p=products.find(x=>x.id===row.pid);
        const stockCell=stockVal=>`<td class="stock-report-stock ${stockVal<0?'stock-negative':''}">${escapeHtml(stockReportQuantityText(p||{unit:row.unit},stockVal))}</td>`;
        const stockCells=selectedWarehouseValue==='all'?reportWarehouses.map(warehouse=>stockCell(warehouseStock(row.pid,warehouse.id))).join(''):stockCell(reportStock(row.pid,selectedWarehouseValue));
        return `<tr data-sr-row="${escapeHtml(row.pid)}">${stockReportProductCellsHtml(row)}${stockCells}${forPrint?'':`<td class="stock-report-action"><button class="history-icon-btn danger" data-sr-remove="${escapeHtml(row.pid)}" title="ลบ" aria-label="ลบ ${escapeHtml(p?.name||row.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></td>`}</tr>`;
      }).join('')
    : `<tr><td colspan="${columnCount}" style="text-align:center;color:var(--text-muted);padding:20px;">ยังไม่มีรายการ — ค้นหาหรือสแกนบาร์โค้ดด้านบนเพื่อเพิ่ม</td></tr>`;
}
