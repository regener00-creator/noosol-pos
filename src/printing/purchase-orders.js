function setupA4DocumentPreview(win,{number,label,pageSelector}){
  const doc=win.document;
  const originalPages=[...doc.querySelectorAll(pageSelector)].map(page=>page.cloneNode(true));
  if(!originalPages.length) return;
  const style=doc.createElement('style');
  style.textContent=`
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    body{padding-top:66px!important;padding-right:285px!important;background:#F0F0F0!important}
    .toolbar{position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:30!important;height:66px!important;margin:0!important;padding:10px 18px!important;background:#fff!important;border-bottom:1px solid #dce3e8!important;box-shadow:none!important;display:flex!important;align-items:center!important;gap:14px!important}
    .preview-actions{display:flex;align-items:center;gap:10px;margin-left:auto}
    .preview-actions button{height:42px;min-width:142px;border-radius:6px;font:600 15px Sarabun;cursor:pointer}
    .preview-actions .close-preview{background:#fff!important;color:#6d7882!important;border:1px solid #bfc9d2!important}
    .preview-actions .confirm-preview-print{background:#4F4038!important;color:#fff!important;border:1px solid #4F4038!important}
    .document-print-sidebar{position:fixed;top:66px;right:0;bottom:0;z-index:25;width:285px;padding:20px 22px;background:#fff;border-left:1px solid #dce3e8;color:#1f2933}
    .document-print-sidebar h3{margin:0 0 14px;font-size:17px}
    .document-print-options{display:flex;align-items:center;gap:18px}
    .document-print-options label{display:flex;align-items:center;gap:7px;font-weight:600;white-space:nowrap}
    .document-print-options input[type=checkbox]{width:18px;height:18px;accent-color:#4F4038}
    .document-print-options input[type=number]{width:62px;height:38px;padding:6px 8px;border:1px solid #ccd5dd;border-radius:7px;font:600 14px Sarabun}
    ${pageSelector}{width:210mm!important;min-height:297mm!important;height:auto!important;margin:12px auto!important;padding:16mm 18mm!important;background:#fff!important;box-shadow:0 4px 20px #0002!important;page-break-after:always!important}
    ${pageSelector}:last-child{page-break-after:auto!important}
    .business{padding-top:50px!important}.business b{color:#4F4038!important;font-weight:700!important}
    .title-block{text-align:center!important}.title{margin-bottom:2px!important}.subtitle{color:#4F4038;font-size:12px;margin-bottom:8px}
    .docmeta{display:grid!important;width:100%!important;text-align:left!important;border-top:2px solid #d5d5d5;border-bottom:2px solid #d5d5d5;padding:12px 8px!important;margin-top:8px!important}
    .customer>div:nth-child(2){color:#4F4038;font-weight:700}.items th{background:#4F4038!important;color:#fff!important}
    .totals .lbl{color:#151515!important}.totals .grand span{color:#4F4038!important}.words{display:none!important}
    @media print{body{padding:0!important;background:#fff!important}.toolbar,.document-print-sidebar{display:none!important}${pageSelector}{margin:0 auto!important;box-shadow:none!important}}
  `;
  doc.head.appendChild(style);
  const setPageLabel=(page,text)=>{
    const titleBlock=page.querySelector('.title-block'); if(!titleBlock) return;
    let subtitle=titleBlock.querySelector('.subtitle');
    if(!subtitle){ subtitle=doc.createElement('div'); subtitle.className='subtitle'; const title=titleBlock.querySelector('.title'); title?.insertAdjacentElement('afterend',subtitle); }
    subtitle.textContent=text;
  };
  doc.querySelectorAll(pageSelector).forEach(page=>setPageLabel(page,'ต้นฉบับ'));
  const toolbar=doc.querySelector('.toolbar,.screenbar');
  if(toolbar){
    toolbar.className='toolbar';
    toolbar.innerHTML=`<div class="preview-actions"><button type="button" class="close-preview" id="closeDocumentPreview">ย้อนกลับ</button><button type="button" class="confirm-preview-print" id="confirmDocumentPrint">พิมพ์</button></div>`;
  }
  const sidebar=doc.createElement('aside');
  sidebar.className='document-print-sidebar';
  sidebar.innerHTML=`<h3>${escapeHtml(label)}</h3><div class="document-print-options"><label><input id="documentOriginalOption" type="checkbox" checked> ต้นฉบับ</label><label><input id="documentCopyOption" type="checkbox" checked> สำเนา</label><input id="documentCopyCount" type="number" min="1" max="20" value="1" aria-label="จำนวนสำเนา"></div>`;
  doc.body.appendChild(sidebar);
  const rebuildPages=()=>{
    const includeOriginal=doc.getElementById('documentOriginalOption').checked;
    const includeCopy=doc.getElementById('documentCopyOption').checked;
    const copyCount=Math.max(1,Math.min(20,Number(doc.getElementById('documentCopyCount').value)||1));
    if(!includeOriginal&&!includeCopy){ win.alert('กรุณาเลือกต้นฉบับหรือสำเนาอย่างน้อย 1 รายการ'); return false; }
    doc.querySelectorAll(pageSelector).forEach(page=>page.remove());
    const appendPages=text=>originalPages.forEach(template=>{ const page=template.cloneNode(true); setPageLabel(page,text); doc.body.appendChild(page); });
    if(includeOriginal) appendPages('ต้นฉบับ');
    if(includeCopy) for(let i=0;i<copyCount;i++) appendPages('สำเนา');
    return true;
  };
  doc.getElementById('closeDocumentPreview').onclick=()=>win.close();
  doc.getElementById('confirmDocumentPrint').onclick=()=>{ if(rebuildPages()) win.print(); };
}

function printPO(poId,kind='po'){
  const styled=isSupplierStyleDoc(kind);
  const titleText=docLabelText(kind);
  const ids=Array.isArray(poId)?poId:[poId];
  const list=docList(kind);
  const docs=ids.map(id=>list.find(x=>x.id===id)).filter(Boolean); if(!docs.length) return;
  const pages=docs.map(po=>{
    const tax=po.taxSummary||calculatePurchaseTaxSummary(po.items,po.discount||0,po.taxMode||'incl');
    const business=po.businessSnapshot||businessSettings;
    const supplier=styled?suppliersList().find(s=>s.name===po.supplier):salesRepresentatives.find(rep=>rep.name===po.supplier);
    const rows=po.items.map((it,i)=>styled?`<tr><td class="c">${i+1}</td><td>${escapeHtml(it.name)}</td><td class="r">${escapeHtml(it.qty)}</td><td>${escapeHtml(it.unit||'')}</td><td class="r">${fmtMoney(it.price)}</td><td class="r">${fmtMoney(it.qty*it.price)}</td></tr>`:`<tr><td class="c">${i+1}</td><td>${escapeHtml(it.name)}</td><td class="r">${escapeHtml(it.qty)}</td><td>${escapeHtml(it.unit||'')}</td></tr>`).join('');
    return `<section class="a4-page">
      <section class="header">
        <div class="business"><b style="font-size:13px;">${escapeHtml(businessDocumentName(business,STORE_INFO.name))}</b><br>${escapeHtml(business.address||STORE_INFO.address)}${(business.taxId||STORE_INFO.taxId)?`<br>เลขประจำตัวผู้เสียภาษี ${escapeHtml(business.taxId||STORE_INFO.taxId)}`:''}${businessPrimaryPhone(business)?`<br>เบอร์ติดต่อ ${escapeHtml(businessPrimaryPhone(business))}`:''}${(business.website||STORE_INFO.website)?`<br>${escapeHtml(business.website||STORE_INFO.website)}`:''}</div>
        <div class="title-block"><div class="title">${escapeHtml(titleText)}</div><div class="docmeta"><span>เลขที่</span><span>${escapeHtml(po.id)}</span><span>${styled?'วันที่':'วันที่สั่ง'}</span><span>${escapeHtml(fmtDateShort(po.date))}</span>${styled?`<span>ครบกำหนด</span><span>${escapeHtml(fmtDateShort(documentDueDate(po)))}</span>`:''}<span>ผู้สั่งซื้อ</span><span>${escapeHtml(loggedInUser()?.firstName||employees[0])}</span></div></div>
      </section>
      <section class="customer"><div class="lbl">${styled?'ผู้จำหน่าย':'ข้อมูลผู้แทน'}</div><div>${styled?`<b>${escapeHtml(po.supplier)}</b>`:`ชื่อ <b>${escapeHtml(po.supplier)}</b>`}</div><div>${styled?`${escapeHtml(supplier?.address||'-')}${supplier?.taxId?`<br>เลขประจำตัวผู้เสียภาษี ${escapeHtml(supplier.taxId)}`:''}`:`บริษัท <b>${escapeHtml(supplier?.company||'-')}</b>`}</div></section>
      <table class="items"><thead><tr><th class="c">#</th><th>รายละเอียด</th><th class="r">จำนวน</th><th>หน่วย</th>${styled?'<th class="r">ราคาต่อหน่วย</th><th class="r">ยอดรวม</th>':''}</tr></thead><tbody>${rows}</tbody></table>
      ${styled?`<section class="totals"><div><span class="lbl">รวมเป็นเงิน</span><b>${fmtMoney(tax.subtotal)} บาท</b></div>${po.discount?`<div><span class="lbl">ส่วนลด</span><b>${fmtMoney(po.discount)} บาท</b></div>`:''}${tax.registered?`<div><span class="lbl">ภาษีมูลค่าเพิ่ม 7%</span><b>${fmtMoney(tax.vat)} บาท</b></div><div class="last-sub"><span class="lbl">มูลค่าก่อนภาษีมูลค่าเพิ่ม</span><b>${fmtMoney(tax.beforeVat)} บาท</b></div>`:`<div class="last-sub"><span class="lbl">ไม่มี VAT</span><b>0.00 บาท</b></div>`}<div class="grand"><span>จำนวนเงินรวมทั้งสิ้น</span><b>${fmtMoney(tax.total)} บาท</b></div></section><div class="words">(${bahtText(tax.total)})</div><div class="signheads"><span>ในนาม ${escapeHtml(po.supplier)}</span><span>ในนาม ${escapeHtml(business.name||STORE_INFO.name)}</span></div><div class="signlines"><div>ผู้ขาย · วันที่</div><div>ผู้รับสินค้า · วันที่</div></div>`:''}
    </section>`;
  }).join('');
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>${docs.map(d=>escapeHtml(d.id)).join(', ')}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>
    @page{size:A4 portrait;margin:0;}*{box-sizing:border-box;}html,body{margin:0;padding:0;}body{font-family:'Sarabun',sans-serif;background:#F0F0F0;color:#151515;font-size:10.5pt;}
    .screenbar{position:sticky;top:0;z-index:99;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#fff;box-shadow:0 2px 8px #0002}.screenbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:9px 18px;font:600 14px Sarabun;cursor:pointer}
    .a4-page{width:210mm;height:297mm;margin:10mm auto;background:#fff;position:relative;padding:16mm 18mm;overflow:hidden;page-break-after:always;box-shadow:0 4px 20px #0002}.a4-page:last-child{page-break-after:auto}
    .header{display:grid;grid-template-columns:1.15fr 1fr;gap:14mm;margin-top:2mm}.business{font-size:11.5px;line-height:1.6}.title-block{text-align:right}.title{color:#4F4038;font-size:22px;font-weight:700;margin-bottom:8px}.docmeta{display:inline-grid;grid-template-columns:auto auto;gap:4px 14px;text-align:left;font-size:12px}.docmeta span:nth-child(odd){color:#4F4038;font-weight:600}
    .customer{margin:9mm 0 5mm}.customer .lbl{color:#4F4038;font-weight:600;font-size:12px;margin-bottom:2px}.customer div{font-size:12px;line-height:1.5}
    table.items{width:100%;border-collapse:collapse;font-size:12px;margin-top:2mm}table.items th{background:#4F4038;color:#fff;padding:7px 8px;text-align:left;font-weight:600}table.items th.r,table.items td.r{text-align:right}table.items th.c,table.items td.c{text-align:center;width:9mm}table.items td{padding:7px 8px;border-bottom:1px solid #e4e8ec}
    .totals{width:82mm;margin:6mm 0 0 auto;font-size:12.5px}.totals div{display:flex;justify-content:space-between;padding:4px 0}.totals .lbl{color:#4F4038}.totals .last-sub{border-bottom:1px solid #4F4038;padding-bottom:6px}.totals .grand{font-weight:700;margin-top:2px;padding-top:6px}
    .words{font-size:12px;margin-top:8mm;text-align:right}
    .signheads{position:absolute;left:18mm;right:18mm;bottom:30mm;display:flex;justify-content:space-between;font-size:12px}.signheads span{width:60mm;text-align:center}
    .signlines{position:absolute;left:18mm;right:18mm;bottom:14mm;display:flex;justify-content:space-between;text-align:center;font-size:11px}.signlines div{width:60mm;border-top:1px solid #888;padding-top:4px}
    @media print{body{background:#fff}.screenbar{display:none}.a4-page{margin:0;box-shadow:none}}
  </style></head><body><div class="screenbar"><span>ตัวอย่างเอกสาร A4</span><button onclick="window.print()">พิมพ์เอกสาร</button></div>${pages}</body></html>`);
  win.document.close();
  standardizePrintPreview(win);
  if(kind==='gr') setupA4DocumentPreview(win,{number:docs.map(doc=>doc.id).join(', '),label:titleText,pageSelector:'.a4-page'});
}
// แปลงตัวเลขเป็นข้อความภาษาไทย (บาท/สตางค์)
function bahtText(num){
  num=Math.round(num*100)/100;
  const txt=['ศูนย์','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  const pos=['','สิบ','ร้อย','พัน','หมื่น','แสน','ล้าน'];
  function conv(n){
    n=String(parseInt(n)); let s='';
    for(let i=0;i<n.length;i++){
      const d=+n[i], p=n.length-i-1;
      if(d===0) continue;
      if(p===1 && d===1) s+='สิบ';
      else if(p===1 && d===2) s+='ยี่สิบ';
      else if(p===0 && d===1 && n.length>1) s+='เอ็ด';
      else s+=txt[d]+pos[p%6];
      if(p===6) s+='ล้าน';
    }
    return s||'ศูนย์';
  }
  const baht=Math.floor(num); const satang=Math.round((num-baht)*100);
  let r=conv(baht)+'บาท';
  r+= satang===0 ? 'ถ้วน' : conv(satang)+'สตางค์';
  return r;
}
