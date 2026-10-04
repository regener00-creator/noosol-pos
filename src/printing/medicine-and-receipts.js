function medicineLabelContentLength(label){
  const normalized=normalizeDispensingLabel(label); if(!normalized) return 0;
  return [normalized.drugName,normalized.patientName,normalized.indication,normalized.directions,normalized.warning,normalized.pharmacistName].join('').length;
}
function medicineLabelFitsSize(label,sizeKey){
  return medicineLabelContentLength(label)<=(sizeKey==='60x40'?240:420);
}
function medicineLabelExpiryText(item){
  const dates=(item?.lotAllocations||[])
    .map(allocation=>String(allocation?.expiry||'').slice(0,10))
    .filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  return dates.length?fmtDateShort(dates[0]):'ไม่ระบุ';
}
function medicineLabelIconSvg(name){
  const paths={
    patient:'<circle cx="12" cy="6.2" r="3.6"/><path d="M4.5 21v-2.6a7.5 7.5 0 0 1 15 0V21z"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="1.8"/><path d="M8 3v4M16 3v4M3 10h18M7 14h2M11 14h2M15 14h2M7 18h2M11 18h2M15 18h2"/>',
    pill:'<path d="M8.4 18.6a4.25 4.25 0 0 1-6-6l10-10a4.25 4.25 0 0 1 6 6z"/><path d="m7.5 7.5 9 9"/>',
    clipboard:'<rect x="4.5" y="4.5" width="15" height="17" rx="1.8"/><path d="M9 4.5V3h6v1.5M8 10h8M8 14h8M8 18h5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    warning:'<path d="M10.2 3.8 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.8 3.8a2 2 0 0 0-3.6 0zM12 9v5M12 18h.01"/>',
    pharmacist:'<circle cx="9" cy="6" r="3.2"/><path d="M3.5 20v-2.4a5.5 5.5 0 0 1 11 0V20z"/><rect x="14" y="12" width="7" height="7" rx="1"/><path d="M17.5 14v3M16 15.5h3"/>',
  };
  return `<svg class="medicine-label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||''}</svg>`;
}
function medicineLabelScheduleHtml(label){
  const times=new Set(medicineLabelDoseTimes(label?.doseTimes,label?.directions)),meal=medicineLabelMealTiming(label?.mealTiming,label?.directions),interval=medicineLabelInterval(label?.intervalValue??label?.intervalHours,label?.intervalUnit||(label?.intervalHours?'hours':''),label?.directions);
  const choice=(checked,text)=>`<span class="medicine-label-choice"><i class="${checked?'is-checked':''}"></i>${text}</span>`;
  const intervalLabel=interval.value?`ทุก ${interval.value} ${interval.unit==='minutes'?'นาที':'ชม.'}`:'ทุก __';
  return `<div class="medicine-label-row medicine-label-schedule"><div class="medicine-label-cell medicine-label-checks medicine-label-meal-checks">${medicineLabelIconSvg('clock')}<span class="medicine-label-meal-choice-grid">${MEDICINE_LABEL_MEAL_OPTIONS.map(option=>choice(meal===option.value,option.label)).join('')}${choice(Boolean(interval.value),intervalLabel)}</span></div><div class="medicine-label-cell medicine-label-checks">${MEDICINE_LABEL_TIME_OPTIONS.map(option=>choice(times.has(option.value),option.label)).join('')}</div></div>`;
}
function medicineLabelPharmacistDisplay(value){
  return String(value||'').trim().replace(/^(?:เภสัชกร|ภก\.?|ภญ\.?)\s*/i,'').trim()||'-';
}
function printMedicineLabels(saleId){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale) return false;
  const items=medicineLabelsForSale(sale); if(!items.length){ showToast('บิลนี้ไม่มีรายการฉลากยา','danger-top'); return false; }
  const sizeKey=MEDICINE_LABEL_SIZES[sale.medicineLabelSize]?sale.medicineLabelSize:'80x50';
  const size=MEDICINE_LABEL_SIZES[sizeKey],compact=sizeKey==='60x40';
  const oversized=items.find(item=>!medicineLabelFitsSize(item.dispensingLabel,sizeKey));
  if(oversized){ showToast(`ข้อความฉลาก “${oversized.name}” ยาวเกินขนาด ${size.label} กรุณาใช้ฉลาก 80 × 50 มม. หรือย่อข้อความ`,'danger-top'); return false; }
  const business=sale.businessSnapshot||businessSettings;
  const businessName=businessDocumentName(business,STORE_INFO.name),phone=businessPrimaryPhone(business),line=String(business?.line||'').trim();
  const logoUrl=typeof location!=='undefined'?new URL(MEDICINE_LABEL_LOGO_PATH,location.href).href:MEDICINE_LABEL_LOGO_PATH;
  const labels=items.map(item=>{
    const label=normalizeDispensingLabel(item.dispensingLabel),length=medicineLabelContentLength(label),density=length>(compact?170:300)?' dense':'';
    const saleRef=escapeHtml(sale.ref||sale.id),saleDate=escapeHtml(fmtDateShort(sale.date)),expiry=escapeHtml(medicineLabelExpiryText(item));
    const durationText=escapeHtml(medicineLabelDurationText(label)),structured=Boolean(label.doseAmount&&label.doseUnit&&durationText&&(label.doseTimes.length||label.intervalValue));
    const doseAmount=escapeHtml(label.doseAmount||'-'),doseUnit=escapeHtml(label.doseUnit||''),durationDays=escapeHtml(label.durationDays||'-'),pharmacistName=escapeHtml(medicineLabelPharmacistDisplay(label.pharmacistName));
    const durationMarkup=label.durationMode==='days'?`<b class="medicine-label-value">${durationDays}</b><span>วัน</span>`:`<b class="medicine-label-value medicine-label-duration-value">${durationText}</b>`;
    const legacyDirections=!structured&&label.directions?`<div class="medicine-label-row medicine-label-legacy"><div class="medicine-label-cell"><b class="medicine-label-value">${escapeHtml(label.directions)}</b></div></div>`:'';
    const contactMarkup=[phone?`<span>โทร : ${escapeHtml(phone)}</span>`:'',line?`<span>LINE : ${escapeHtml(line)}</span>`:''].filter(Boolean).join('');
    return `<section class="medicine-label${density}"><header><div class="medicine-label-brand"><span class="medicine-label-logo-frame"><img class="medicine-label-brand-logo" src="${escapeHtml(logoUrl)}" alt="โลโก้ SAPURI Pharmacy"></span><b>${escapeHtml(businessName)}</b></div><small class="medicine-label-contact">${contactMarkup}</small><span class="medicine-label-bill">${saleRef}</span></header><div class="medicine-label-info"><div class="medicine-label-row medicine-label-meta"><div class="medicine-label-cell">${medicineLabelIconSvg('patient')}<span class="medicine-label-key">ชื่อผู้ป่วย :</span><b class="medicine-label-value">${escapeHtml(label.patientName)}</b></div><div class="medicine-label-cell">${medicineLabelIconSvg('calendar')}<span class="medicine-label-key">วันที่จ่ายยา :</span><b class="medicine-label-value">${saleDate}</b></div></div><div class="medicine-label-row medicine-label-drug"><div class="medicine-label-cell">${medicineLabelIconSvg('pill')}<span class="medicine-label-key">ชื่อยา :</span><b class="medicine-label-value">${escapeHtml(label.drugName)}</b></div></div><div class="medicine-label-row medicine-label-dose"><div class="medicine-label-cell medicine-label-indication"><div class="medicine-label-indication-head">${medicineLabelIconSvg('clipboard')}<span class="medicine-label-section-label">ข้อบ่งใช้ :</span></div><b class="medicine-label-value">${escapeHtml(label.indication)}</b></div><div class="medicine-label-cell medicine-label-dose-stack"><div class="medicine-label-dose-line"><span class="medicine-label-section-label">รับประทานครั้งละ :</span><b class="medicine-label-value">${doseAmount}</b><span>${doseUnit}</span></div><div class="medicine-label-dose-line medicine-label-duration-line"><span class="medicine-label-section-label">ระยะเวลา :</span>${durationMarkup}</div></div></div>${medicineLabelScheduleHtml(label)}${legacyDirections}${label.warning?`<div class="medicine-label-row medicine-label-warning"><div class="medicine-label-cell">${medicineLabelIconSvg('warning')}<span class="medicine-label-key">ข้อควรระวัง :</span><b class="medicine-label-value">${escapeHtml(label.warning).replace(/\n/g,' · ')}</b></div></div>`:''}<div class="medicine-label-row medicine-label-footer"><div class="medicine-label-cell">${medicineLabelIconSvg('calendar')}<span class="medicine-label-key">วันหมดอายุ :</span><b class="medicine-label-value">${expiry}</b></div><div class="medicine-label-cell">${medicineLabelIconSvg('pharmacist')}<span class="medicine-label-key">เภสัชกร :</span><b class="medicine-label-value">${pharmacistName}</b></div></div></div></section>`;
  }).join('');
  const win=window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างฉลากยา','danger-top'); return false; }
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>ฉลากยา ${escapeHtml(sale.ref||sale.id)}</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet"><style>
@page{size:${size.width}mm ${size.height}mm;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{margin:0;background:#e6e6e6;color:#111;font-family:'Noto Sans Thai',Tahoma,sans-serif}
.toolbar{position:sticky;top:0;z-index:5;background:#fff;padding:10px 18px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 8px #0002}
.toolbar button{border:0;border-radius:7px;background:#111;color:#fff;padding:9px 18px;font:600 14px 'Noto Sans Thai',sans-serif}
.medicine-label{--medicine-label-text-nudge:${compact?'.14':'.22'}mm;--medicine-label-dose-nudge:${compact?'.18':'.28'}mm;--medicine-label-dose-value-nudge:${compact?'.22':'.34'}mm;width:${size.width}mm;height:${size.height}mm;margin:10px auto;background:#fff;padding:${compact?'1.8':'2.5'}mm;display:flex;flex-direction:column;gap:${compact?'.55':'.75'}mm;overflow:hidden;page-break-after:always;box-shadow:0 3px 14px #0002}
.medicine-label:last-child{page-break-after:auto}
header{display:grid;grid-template-columns:${compact?'6.5':'7.5'}mm minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:${compact?'.8':'1'}mm;row-gap:${compact?'.15':'.25'}mm;align-items:center;padding-bottom:${compact?'.45':'.6'}mm;line-height:1.15}
.medicine-label-brand{display:contents}
.medicine-label-logo-frame{position:relative;width:${compact?'6.5':'7.5'}mm;height:${compact?'6.5':'7.5'}mm;overflow:hidden;grid-column:1;grid-row:1/3;align-self:center;border:.1mm solid #222;border-radius:${compact?'1':'1.2'}mm;background:#fff}
.medicine-label-brand-logo{position:absolute;width:${compact?'10':'11.6'}mm;height:${compact?'10':'11.6'}mm;left:${compact?'-1.94':'-2.25'}mm;top:${compact?'-1.88':'-2.15'}mm;object-fit:cover;filter:grayscale(1) contrast(1.15)}
.medicine-label-brand b{grid-column:2;grid-row:1;align-self:end;font-size:${compact?'8':'9'}pt;line-height:1;color:#111}
.medicine-label-contact{grid-column:2;grid-row:2;align-self:end;display:flex;align-items:center;gap:${compact?'.8':'1.25'}mm;font-size:${compact?'4.8':'5.8'}pt;font-weight:700;line-height:1.1;white-space:nowrap;overflow:hidden}
.medicine-label-contact span{flex:0 0 auto}
.medicine-label-bill{grid-column:3;grid-row:1/3;align-self:start;padding-top:.2mm;font-size:${compact?'3.3':'4'}pt;font-weight:600;white-space:nowrap}
.medicine-label-info{flex:1;min-height:0;display:flex;flex-direction:column;border:.1mm solid #111;border-radius:${compact?'1.2':'1.6'}mm;overflow:hidden;background:#fff}
.medicine-label-row{display:grid;border-bottom:.1mm solid #111;min-height:0}
.medicine-label-row:last-child{border-bottom:0}
.medicine-label-meta{grid-template-columns:1.12fr .88fr}
.medicine-label-dose{grid-template-columns:1.12fr .88fr;flex:1;min-height:${compact?'4.5':'6'}mm}
.medicine-label-schedule{grid-template-columns:1.12fr .88fr}
.medicine-label-footer{grid-template-columns:1.12fr .88fr}
.medicine-label-cell{display:flex;align-items:center;gap:${compact?'.45':'.65'}mm;min-width:0;padding:${compact?'.45mm .55mm':'.6mm .75mm'};line-height:1.08}
.medicine-label-cell+.medicine-label-cell{border-left:.1mm solid #111}
.medicine-label-icon{flex:0 0 ${compact?'2.7':'3.4'}mm;width:${compact?'2.7':'3.4'}mm;height:${compact?'2.7':'3.4'}mm}
.medicine-label-key{flex:0 0 auto;font-size:${compact?'4.2':'5'}pt;font-weight:700;white-space:nowrap}
.medicine-label-value{min-width:0;font-size:${compact?'4.8':'5.7'}pt;font-weight:400;line-height:1.12;overflow-wrap:anywhere}
.medicine-label-meta .medicine-label-key,.medicine-label-meta .medicine-label-value,.medicine-label-drug .medicine-label-key,.medicine-label-drug .medicine-label-value,.medicine-label-warning .medicine-label-key,.medicine-label-warning .medicine-label-value,.medicine-label-footer .medicine-label-key,.medicine-label-footer .medicine-label-value{position:relative;top:var(--medicine-label-text-nudge)}
.medicine-label-meta .medicine-label-value{white-space:nowrap}
.medicine-label-drug .medicine-label-value{font-size:${compact?'6.2':'7.3'}pt;font-weight:700}
.medicine-label-section-label{flex:0 0 auto;color:#111;font-size:${compact?'4.2':'5'}pt;font-weight:700;line-height:1.08;white-space:nowrap}
.medicine-label-dose .medicine-label-cell{font-size:${compact?'4.2':'5.1'}pt;justify-content:flex-start}
.medicine-label-indication{flex-direction:column;align-items:flex-start!important;justify-content:flex-start!important;gap:${compact?'.2':'.3'}mm}
.medicine-label-indication-head{display:flex;align-items:center;gap:${compact?'.45':'.65'}mm;flex:0 0 auto}
.medicine-label-indication .medicine-label-value{width:100%;font-size:${compact?'4.3':'5.2'}pt;text-align:left}
.medicine-label-dose-stack{display:grid;grid-template-rows:1fr 1fr;align-items:stretch!important;justify-content:stretch!important;padding:0}
.medicine-label-dose-line{display:flex;align-items:center;justify-content:flex-start;gap:${compact?'.4':'.55'}mm;min-width:0;min-height:0;padding:${compact?'.35mm .55mm':'.45mm .75mm'};font-weight:700}
.medicine-label-dose-line+.medicine-label-dose-line{border-top:.1mm solid #111}
.medicine-label-dose-line>*{position:relative;top:var(--medicine-label-dose-nudge)}
.medicine-label-dose-line>.medicine-label-value,.medicine-label-dose-line>.medicine-label-value+span{top:var(--medicine-label-dose-value-nudge);font-weight:700}
.medicine-label-dose-line:not(.medicine-label-duration-line)>.medicine-label-section-label{top:calc(var(--medicine-label-dose-nudge) + ${compact?'.12':'.18'}mm)}
.medicine-label-duration-line{align-items:center}
.medicine-label-duration-line>*{top:calc(var(--medicine-label-dose-nudge) + ${compact?'.16':'.22'}mm)}
.medicine-label-duration-line>.medicine-label-value+span{top:calc(var(--medicine-label-dose-value-nudge) + ${compact?'.1':'.14'}mm)}
.medicine-label-dose .medicine-label-value{font-size:${compact?'5.6':'6.7'}pt;white-space:nowrap}
.medicine-label-dose .medicine-label-duration-value{font-size:${compact?'3.8':'5.2'}pt;line-height:1.05;white-space:${compact?'nowrap':'normal'}}
.medicine-label-checks{justify-content:center;gap:${compact?'.25':'.5'}mm;padding-top:${compact?'.35':'.45'}mm;padding-bottom:${compact?'.35':'.45'}mm}
.medicine-label-schedule .medicine-label-cell:first-child{justify-content:flex-start}
.medicine-label-meal-choice-grid{flex:1;min-width:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:center;gap:${compact?'.18mm .3mm':'.3mm .55mm'}}
.medicine-label-schedule .medicine-label-cell:last-child{justify-content:space-evenly;gap:${compact?'.3':'.55'}mm}
.medicine-label-choice{display:inline-flex;align-items:center;gap:${compact?'.18':'.3'}mm;font-size:${compact?'3.05':'3.9'}pt;white-space:nowrap}
.medicine-label-choice i{display:inline-flex;align-items:center;justify-content:center;width:${compact?'1.8':'2.2'}mm;height:${compact?'1.8':'2.2'}mm;border:.12mm solid #111;border-radius:.25mm;font:700 ${compact?'3.4':'4'}pt Arial,sans-serif;font-style:normal}
.medicine-label-choice i.is-checked{background:#111}
.medicine-label-choice i.is-checked::after{content:'✓';color:#fff;font-weight:700;line-height:1}
.medicine-label-legacy .medicine-label-cell{padding-top:.35mm;padding-bottom:.35mm}
.medicine-label-legacy .medicine-label-value{font-size:${compact?'3.7':'4.4'}pt;font-weight:400}
.medicine-label-warning .medicine-label-key,.medicine-label-warning .medicine-label-value{display:inline-flex;align-items:center;min-height:${compact?'2.7':'3.4'}mm;line-height:1.08}
.medicine-label-warning .medicine-label-value{font-size:${compact?'4':'4.8'}pt}
.medicine-label-footer .medicine-label-value{font-size:${compact?'4.1':'4.9'}pt;font-weight:700}
.dense .medicine-label-value{font-size:${compact?'4.2':'5'}pt}
.dense .medicine-label-drug .medicine-label-value{font-size:${compact?'5.4':'6.4'}pt}
.dense .medicine-label-dose .medicine-label-value{font-size:${compact?'5':'5.8'}pt}
@media print{body{background:#fff}.toolbar{display:none}.medicine-label{margin:0;box-shadow:none}}
</style></head><body><div class="toolbar"><span>ตัวอย่างฉลากยา ${escapeHtml(size.label)} · ${items.length} ใบ</span><button onclick="window.print()">พิมพ์</button></div>${labels}</body></html>`);
  win.document.close(); standardizePrintPreview(win);
  let printStarted=false;
  const startPrint=()=>{ if(printStarted) return; printStarted=true; win.print(); };
  const logo=win.document.querySelector?.('.medicine-label-brand-logo');
  if(logo&&!logo.complete){ logo.addEventListener('load',()=>setTimeout(startPrint,100),{once:true}); logo.addEventListener('error',()=>setTimeout(startPrint,100),{once:true}); setTimeout(startPrint,1500); }
  else setTimeout(startPrint,350);
  return true;
}

function openPostPaymentModal(saleId){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale) return;
  const documentLabel='ใบเสร็จอย่างย่อ';
  const medicineLabelCount=medicineLabelsForSale(sale).length;
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:430px;"><div class="modal-head"><h3>ชำระเงินสำเร็จ</h3><button class="modal-close">×</button></div><div id="afterPayContent"></div></div>`;
  document.body.appendChild(overlay);
  const content=overlay.querySelector('#afterPayContent');
  let activeKeyHandler=null;
  const stopKeyHandler=()=>{ if(activeKeyHandler){ document.removeEventListener('keydown',activeKeyHandler); activeKeyHandler=null; } };
  const close=()=>{ stopKeyHandler(); overlay.remove(); setTimeout(()=>document.getElementById('search')?.focus(),0); };
  overlay.querySelector('.modal-close').onclick=close;
  const renderPaymentActions=()=>{
    stopKeyHandler();
    content.innerHTML=`<div style="padding:5px 18px 8px;"><div class="after-pay-icon">✓</div><div class="after-pay-heading">รับชำระ ${fmtMoney(sale.total)} บาทแล้ว</div><div class="after-pay-sub">${escapeHtml(sale.payMethod||'เงินสด')} · ${escapeHtml(sale.ref||sale.id)}</div></div><div class="after-pay-options">${medicineLabelCount?`<button class="after-pay-choice" id="printMedicineLabelsBtn"><span>Rx</span> พิมพ์ฉลากยา ${medicineLabelCount} ใบ</button>`:''}<div class="after-pay-actions"><button type="button" class="after-pay-choice" id="closePostPaymentBtn">ปิด</button><button type="button" class="after-pay-choice new-order" id="finishAndPrintReceiptBtn"><span>🖨</span> ${escapeHtml(documentLabel)}</button></div></div>`;
    const printMedicineButton=content.querySelector('#printMedicineLabelsBtn'); if(printMedicineButton) printMedicineButton.onclick=()=>printMedicineLabels(saleId);
    content.querySelector('#closePostPaymentBtn').onclick=close;
    const finishAndPrintButton=content.querySelector('#finishAndPrintReceiptBtn');
    finishAndPrintButton.onclick=()=>{
      if(!printShortReceipt(saleId)) return;
      close();
    };
    activeKeyHandler=e=>{ if(e.key==='Escape'){ e.preventDefault(); close(); }else if(e.key==='Enter'&&!e.target?.closest?.('button')){ e.preventDefault(); finishAndPrintButton.click(); } };
    document.addEventListener('keydown',activeKeyHandler);
  };
  renderPaymentActions();
}

function printShortReceipt(saleId,historical=false){
  const sale=salesHistory.find(item=>item.id===saleId); if(!sale) return false;
  const tax=saleTaxSummary(sale),registered=tax.registered;
  const lineAmount=item=>item.lineTotalGross!==undefined?Number(item.lineTotalGross)||0:item.lineTotal!==undefined?Number(item.lineTotal)||0:(Number(item.qty)||0)*(Number(item.price)||0);
  const afterDiscount=Math.max(0,tax.total-(Number(sale.fee)||0)),beforeVat=tax.beforeVat,vat=tax.vat;
  const receiptBusiness={...(sale.businessSnapshot||businessSettings),line:sale.businessSnapshot?.line||businessSettings.line||''};
  const itemCount=(sale.items||[]).reduce((sum,item)=>sum+(Number(item.qty)||0),0);
  const receiptNo=shortReceiptNumber(sale);
  const rows=(sale.items||[]).map(item=>`<div class="item"><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.qty)} ${escapeHtml(item.unit||'')} × ${fmtMoney(grossAmountForVatMode(item.price,item.vatMode,registered))}</small>${item.promoName?`<small class="receipt-promo-tag">🏷 ${escapeHtml(item.promoName)}</small>`:''}${item.promoFreeQty?`<small class="receipt-promo-tag">🎁 แถมฟรี ${escapeHtml(item.promoFreeQty)} ${escapeHtml(item.unit||'')}</small>`:''}</div><strong>${fmtMoney(lineAmount(item))}</strong></div>`).join('');
  const win=window.open('','_blank'); if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างใบเสร็จ'); return false; }
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>พิมพ์ - ${escapeHtml(receiptNo)}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>@page{size:80mm auto;margin:0}*{box-sizing:border-box}body{margin:0;background:#F0F0F0;color:#111;font-family:'Sarabun',sans-serif}.bar{position:sticky;top:0;z-index:5;background:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 8px #0002}.bar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:8px 15px;font-family:inherit;font-weight:600}.receipt{position:relative;width:80mm;min-height:250mm;margin:12px auto;background:#fff;padding:24mm 8mm 15mm;box-shadow:0 4px 20px #0002}.copy-label{text-align:center;color:#4F4038;font-weight:700;font-size:10pt;margin-bottom:2mm}.center{text-align:center}.store{font-size:11pt;line-height:1.35}.store h2{font-size:14pt;margin:0 0 2px}.rule{border-top:1px solid #111;margin:7mm 0 4mm}.dash{border-top:1px dashed #111;margin:4mm 0}.title{font-weight:700;font-size:12pt}.meta{display:grid;grid-template-columns:25mm 1fr;gap:1mm;font-size:10pt;margin-top:4mm}.meta b{font-weight:600}.item{display:grid;grid-template-columns:minmax(0,1fr) 19mm;gap:2mm;align-items:start;padding:2mm 0;font-size:9.5pt}.item b{display:block;font-weight:500}.item small{display:block}.receipt-promo-tag{color:#4F4038;font-weight:600;}.item strong{text-align:right;font-weight:500}.summary{font-size:10pt}.summary>div{display:flex;justify-content:space-between;padding:1mm 0}.summary .total{font-size:12pt;font-weight:700;border-top:1px solid #111;border-bottom:3px double #111;padding:2mm 0}.vat{font-size:14pt;font-weight:700;margin:5mm 0}.footer{font-size:9pt}@media print{body{background:#fff}.bar{display:none}.receipt{margin:0;box-shadow:none;width:80mm;min-height:0}}</style></head><body><div class="bar"><span>ตัวอย่างใบเสร็จ 80 มม.</span><button onclick="window.print()">พิมพ์</button></div><div class="receipt"><div class="center store"><h2>${escapeHtml(businessDocumentName(receiptBusiness,STORE_INFO.name,{registered}))}</h2><div>${escapeHtml(receiptBusiness.address||STORE_INFO.address)}</div>${(receiptBusiness.taxId||STORE_INFO.taxId)?`<br><div><b>เลขผู้เสียภาษี</b> ${escapeHtml(receiptBusiness.taxId||STORE_INFO.taxId)}</div>`:''}${(receiptBusiness.website||STORE_INFO.website)?`<div><b>เว็บไซต์</b> ${escapeHtml(receiptBusiness.website||STORE_INFO.website)}</div>`:''}</div><div class="rule"></div><div class="title">${registered?'ใบกำกับภาษีอย่างย่อ/ใบเสร็จรับเงิน':'ใบเสร็จรับเงิน'}</div><div>${escapeHtml(receiptNo)}</div><div class="dash"></div><div class="meta"><b>พนักงานขาย</b><span>${escapeHtml(sale.cashier||loggedInUser()?.firstName||'')}</span><b>วันที่</b><span>${fmtDateShort(sale.date)} ${escapeHtml((sale.time||'').slice(11))}</span><b>ชำระโดย</b><span>${escapeHtml(sale.payMethod||'-')}</span></div><div class="rule"></div>${rows}<div class="dash"></div><div class="summary"><div><b>จำนวนรวม</b><b>${itemCount}</b></div><div><span>จำนวนเงินหลังหักส่วนลด</span><b>${fmtMoney(afterDiscount)}</b></div>${registered?`<div><span>ราคาไม่รวมภาษีมูลค่าเพิ่ม</span><b>${fmtMoney(beforeVat)}</b></div><div><span>ภาษีมูลค่าเพิ่ม 7%</span><b>${fmtMoney(vat)}</b></div>`:''}${sale.fee?`<div><span>ค่าธรรมเนียมบัตร</span><b>${fmtMoney(sale.fee)}</b></div>`:''}<div class="total"><span>รวมทั้งสิ้น</span><b>${fmtMoney(sale.total)}</b></div></div>${registered?'<div class="center vat">VAT INCLUDED</div>':''}<div class="dash"></div><div class="center footer">ขอบคุณที่ใช้บริการ${businessPrimaryPhone(receiptBusiness)?`<br>${escapeHtml(businessPrimaryPhone(receiptBusiness))}`:''}</div></div></body></html>`);
  win.document.close();
  const receiptFooter=win.document.querySelector('.footer');
  applyReceiptPrinterLayout(win);
  if(receiptFooter&&sale.loyalty){
    const loyalty=win.document.createElement('div');
    loyalty.style.cssText='font-size:9pt;text-align:center;margin:3mm 0';
    loyalty.innerHTML=saleLoyaltySummaryHtml(sale);
    receiptFooter.before(loyalty);
  }
  if(receiptFooter&&receiptBusiness.line){
    const line=win.document.createElement('div');
    line.textContent=`LINE ${receiptBusiness.line}`;
    receiptFooter.appendChild(line);
  }
  standardizePrintPreview(win);
  const receiptTitleEl=win.document.querySelector('.title');
  if(receiptTitleEl) receiptTitleEl.style.textAlign='center';
  const receiptNumberEl=win.document.querySelector('.title + div');
  if(receiptNumberEl) receiptNumberEl.style.textAlign='center';
  sale.shortReceiptMeta=sale.shortReceiptMeta||{number:receiptNo,saleDate:sale.date,issuedAt:auditNow(),printLog:[]};
  sale.shortReceiptMeta.printLog=sale.shortReceiptMeta.printLog||[];
  sale.shortReceiptMeta.printLog.push({at:auditNow(),mode:'print'});
  updateSaleDocumentMetadata(sale.id,{shortReceiptMeta:sale.shortReceiptMeta}).catch(error=>{
    console.warn('log short receipt print',error);
    showToast('พิมพ์ใบเสร็จได้ แต่บันทึกประวัติการพิมพ์ไม่สำเร็จ','danger-top');
  });
  setTimeout(()=>win.print(),350);
  return true;
}
