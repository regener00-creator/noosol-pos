function printStockAlertReport(kind){
  const isExpiry=kind==='expiry';
  const filtered=isExpiry?expiryReportLotRows().filter(row=>expiryReportRowMatches(row)):lowStockReportRows().filter(row=>lowStockReportRowMatches(row));
  const rows=isExpiry
    ?lowSortedList(filtered,lowStockSort.expiry,(row,key)=>key==='expiry'?(row.expiry||''):key==='status'?daysUntil(row.expiry):key==='lot'?(row.lotNumber||''):key==='quantity'?row.quantityBase:key==='wh'?(row.warehouseName||''):row.name)
    :lowSortedList(filtered,lowStockSort.stock,(row,key)=>key==='stock'?row.stock:key==='sku'?(row.sku||''):key==='unit'?row.displayFactor:key==='wh'?row.warehouseName:row.name);
  if(!rows.length){ showToast(isExpiry?'ไม่มีสินค้าในช่วงวันหมดอายุที่เลือก':'ไม่มีสินค้าต่ำกว่าเกณฑ์ที่เลือก'); return; }

  const title=isExpiry?'รายงานสินค้าใกล้หมดอายุ':'รายงานสินค้าใกล้หมด';
  const condition=isExpiry?expiryReportConditionLabel():lowStockReportConditionLabel();
  const dateText=fmtDashboardDate(TODAY_STR);
  const rowsHtml=rows.map((product,index)=>{
    if(isExpiry){
      const badge=expiryBadge(product.expiry);
      const statusClass=daysUntil(product.expiry)<0?'danger':daysUntil(product.expiry)<=30?'warn':'ok';
      return `<tr><td class="c">${index+1}</td><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.lotNumber)}</td><td class="c">${escapeHtml(product.quantityText)}</td><td class="c">${fmtDateShort(product.expiry)}</td><td class="c ${statusClass}">${escapeHtml(badge.label)}</td><td>${escapeHtml(product.warehouseName||'-')}</td></tr>`;
    }
    const status=lowStockRowStatus(product);
    return `<tr><td class="c">${index+1}</td><td class="c">${escapeHtml(product.sku||'-')}</td><td>${escapeHtml(product.name)}</td><td class="c ${product.stock<0?'danger':''}">${escapeHtml(product.displayStock)}</td><td class="c">${escapeHtml(product.displayUnit)}</td><td>${escapeHtml(product.warehouseName||'-')}</td><td class="c ${status.cls==='danger'?'danger':status.cls==='warn'?'warn':'ok'}">${escapeHtml(status.label)}</td></tr>`;
  }).join('');
  const columns=isExpiry
    ?'<th class="c" style="width:5%;">#</th><th>สินค้า</th><th>เลข LOT</th><th class="c">คงเหลือ</th><th class="c">วันหมดอายุ</th><th class="c">สถานะ</th><th>คลัง</th>'
    :'<th class="c">#</th><th class="c">รหัส</th><th>สินค้า</th><th class="c">คงเหลือ</th><th class="c">หน่วย</th><th>คลัง</th><th class="c">สถานะ</th>';
  const win=window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร'); return; }
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @page{size:A4;margin:14mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
    body{margin:0;background:#f0f0f0;color:#24282f;font-family:'Sarabun',sans-serif;font-size:13px}
    .toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#fff;box-shadow:0 2px 8px #0002}
    .toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:9px 18px;font:600 14px Sarabun;cursor:pointer}
    .page{width:210mm;min-height:297mm;margin:12px auto;padding:16mm 14mm;background:#fff;box-shadow:0 4px 20px #0002}
    h1{text-align:center;font-size:22px;font-weight:700;margin:0 0 8px;color:#4F4038}
    .date,.condition{text-align:center}.date{font-size:14px}.condition{margin:4px 0 20px;color:#687280}
    table{width:100%;border-collapse:collapse}thead th{text-align:left;padding:9px 8px;font-size:12px;font-weight:600;color:#fff;background:#4F4038;border:0}
    tbody td{padding:9px 8px;border-bottom:1px solid #e2e6ea;font-size:12.5px}.c{text-align:center}.danger{color:#c93c36;font-weight:600}.warn{color:#c77900}.ok{color:#31873f}
    @media print{body{background:#fff}.toolbar{display:none}.page{margin:0;box-shadow:none;width:auto;min-height:0;padding:0}thead{display:table-header-group}thead th{background:#4F4038!important;color:#fff!important;-webkit-box-shadow:inset 0 0 0 1000px #4F4038!important;box-shadow:inset 0 0 0 1000px #4F4038!important}}
  </style></head><body>
  <div class="toolbar"><span>ตัวอย่างรายงาน A4</span><button onclick="window.print()">พิมพ์</button></div>
  <div class="page"><h1>${escapeHtml(title)}</h1><div class="date">${escapeHtml(dateText)}</div><div class="condition">${escapeHtml(condition)}</div>
  <table><thead><tr>${columns}</tr></thead><tbody>${rowsHtml}</tbody></table></div>
  </body></html>`);
  win.document.close();
  standardizePrintPreview(win);
}

function printStockReport(){
  if(!stockReportItems.length){ showToast('ยังไม่มีรายการในรายงาน'); return; }
  const thDate=d=>{ const dt=new Date(d); return dt.getDate()+' '+['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][dt.getMonth()]+' '+dt.getFullYear(); };
  const today=new Date(TODAY_STR);
  const selectedWarehouseValue=String(stockReportCatFilter.wh||(isAllWarehousesMode()?'all':activeWarehouseId));
  const selectedWarehouseName=selectedWarehouseValue==='all'?'ทุกคลัง':warehouses.find(warehouse=>Number(warehouse.id)===Number(selectedWarehouseValue))?.name||activeWarehouse()?.name||'-';
  const reportWarehouses=selectedWarehouseValue==='all'?accessibleWarehouses():[];
  const warehouseSummary=selectedWarehouseValue==='all'
    ? reportWarehouses.map((warehouse,index)=>`<div>คลัง ${index+1} : ${escapeHtml(warehouse.name)}</div>`).join('')
    : `<div>คลัง : ${escapeHtml(selectedWarehouseName)}</div>`;
  const rowsHtml=stockReportRowsHtml(true);
  const win=window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร'); return; }
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>รายงานสินค้าคงเหลือ</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @page{size:A4;margin:14mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
    body{margin:0;background:#F0F0F0;color:#2b2b2b;font-family:'Sarabun',sans-serif;font-size:13px}
    .toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#fff;box-shadow:0 2px 8px #0002}
    .toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:9px 18px;font:600 14px Sarabun;cursor:pointer}
    .page{width:210mm;min-height:297mm;margin:12px auto;padding:16mm 14mm;background:#fff;box-shadow:0 4px 20px #0002}
    h1{text-align:center;font-size:20px;font-weight:700;margin:0 0 4px;color:#4F4038}
    .warehouse{text-align:center;font-size:14px;font-weight:600;margin-bottom:8px;color:#2b2b2b}
    .meta{text-align:center;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #ddd;font-size:13px;}
    table{width:100%;border-collapse:collapse}
    thead th{text-align:left;padding:9px 8px;font-size:12px;font-weight:600;color:#fff;background:#4F4038;border:0}
    tbody td{padding:9px 8px;border-bottom:1px solid #e2e6ea;font-size:12.5px}
    .r{text-align:right}
    .c{text-align:center}
    .pd-name{color:#2b2b2b}
    @media print{
      body{background:#fff}
      .toolbar{display:none}
      .page{margin:0;box-shadow:none;width:auto;min-height:0;padding:0}
      thead{display:table-header-group}
      thead th{background:#4F4038!important;color:#fff!important;-webkit-box-shadow:inset 0 0 0 1000px #4F4038!important;box-shadow:inset 0 0 0 1000px #4F4038!important}
    }
  </style></head><body>
  <div class="toolbar"><span>ตัวอย่างรายงาน A4</span><button onclick="window.print()">พิมพ์</button></div>
  <div class="page">
    <h1>รายงานสินค้าคงเหลือ</h1>
    <div class="warehouse">${warehouseSummary}</div>
    <div class="meta">ณ วันที่ ${thDate(today)}</div>
    <style>.stock-report-price,.stock-report-stock{text-align:center}.stock-report-warehouse small{display:block;font-size:10px;font-weight:400}.stock-report-code{overflow-wrap:anywhere}.stock-report-name{min-width:90px}.stock-negative{color:#b42318}tr{break-inside:avoid}</style>
    <table><thead>${stockReportHeadersHtml(true)}</thead><tbody>${rowsHtml}</tbody></table>
  </div>
  </body></html>`);
  win.document.close();
  standardizePrintPreview(win);
}
