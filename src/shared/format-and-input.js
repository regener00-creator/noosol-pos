// ===== end Supabase Auth wiring =====

function currentLocalDate(){ const now=new Date(); return new Date(now.getFullYear(),now.getMonth(),now.getDate()); }
function currentDateStr(){ const d=currentLocalDate(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function daysUntil(d){
  if(!d) return Number.POSITIVE_INFINITY;
  const expiry=new Date(`${String(d).slice(0,10)}T00:00:00`);
  return Math.ceil((expiry-currentLocalDate())/(1000*60*60*24));
}
function fmtDateShort(d){
  if(!d) return '-';
  const match=String(d).slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match?`${match[3]}-${match[2]}-${match[1]}`:'-';
}
function fmtDate(d){ return fmtDateShort(d); }
function fmtDashboardDate(d){
  const [year,month,day]=String(d||'').slice(0,10).split('-').map(Number);
  if(!year||!month||!day) return '';
  const date=new Date(year,month-1,day);
  const weekdays=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `วัน${weekdays[date.getDay()]} : ${day} ${months[month-1]} ${year}`;
}
function fmtTopbarDate(d){
  const [year,month,day]=String(d||'').slice(0,10).split('-').map(Number);
  if(!year||!month||!day) return '';
  const date=new Date(year,month-1,day);
  const weekdays=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  return `${weekdays[date.getDay()]} : ${day}-${month}-${year}`;
}
function fmtMoney(n){
  const amount=Number(n);
  return (Number.isFinite(amount)?amount:0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtFavoritePrice(n){
  const amount=Number(n);
  return (Number.isFinite(amount)?amount:0).toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2});
}
function escapeHtml(value){ return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function maxArrayValue(items,mapper,fallback=0){
  return (Array.isArray(items)?items:[]).reduce((maximum,item,index)=>{
    const value=Number(mapper(item,index));
    return Number.isFinite(value)&&value>maximum?value:maximum;
  },Number(fallback)||0);
}
// Product ids are stored in Postgres bigint but must remain exact JavaScript
// numbers because the client compares and serializes them frequently. Keep the
// high safe-integer bit set (so ids never overlap the old small sequences) and
// fill the remaining 52 bits from Web Crypto. The fallback is only for older
// browsers without getRandomValues and still combines 52 random/time bits.
const PRODUCT_ID_RANDOM_BASE=0x10000000000000; // 2^52
let productIdFallbackSequence=0;
function randomProductIdCandidate(){
  let high,low;
  if(globalThis.crypto?.getRandomValues){
    const words=new Uint32Array(2);
    globalThis.crypto.getRandomValues(words);
    high=words[0]&0x000fffff;
    low=words[1];
  }else{
    high=Math.floor(Math.random()*0x100000);
    productIdFallbackSequence=(productIdFallbackSequence+1)>>>0;
    low=(Math.floor(Math.random()*0x100000000)+(Date.now()>>>0)+productIdFallbackSequence)>>>0;
  }
  return PRODUCT_ID_RANDOM_BASE+(high*0x100000000)+low;
}
function generateClientProductId(reservedIds=[]){
  const currentProducts=typeof products!=='undefined'&&Array.isArray(products)?products:[];
  const used=new Set(currentProducts.map(product=>String(product.id)));
  if(reservedIds&&typeof reservedIds[Symbol.iterator]==='function'){
    for(const id of reservedIds) used.add(String(id));
  }
  for(let attempt=0;attempt<64;attempt++){
    const candidate=randomProductIdCandidate();
    if(Number.isSafeInteger(candidate)&&candidate>0&&!used.has(String(candidate))) return candidate;
  }
  throw new Error('ไม่สามารถสร้างรหัสอ้างอิงสินค้าใหม่ได้ กรุณาลองอีกครั้ง');
}
function generateProductCreateToken(){
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pc-${Date.now().toString(36)}-${randomProductIdCandidate().toString(36)}-${randomProductIdCandidate().toString(36)}`;
}
function productSkuSequenceNumber(value){
  const matched=String(value||'').trim().match(/^P(\d+)$/i);
  if(!matched) return 0;
  const sequence=Number(matched[1]);
  return Number.isSafeInteger(sequence)&&sequence>0?sequence:0;
}
function allocateReadableProductSku(reservedSkus=[],startAt=1){
  const used=new Set();
  if(reservedSkus&&typeof reservedSkus[Symbol.iterator]==='function'){
    for(const sku of reservedSkus){ const normalized=String(sku||'').trim().toLowerCase(); if(normalized) used.add(normalized); }
  }
  let sequence=Math.max(1,Math.floor(Number(startAt))||1),sku='';
  do{ sku='P'+String(sequence++).padStart(4,'0'); }while(used.has(sku.toLowerCase()));
  return {sku,nextSequence:sequence};
}
function standardizePrintPreview(win,{trackPrint=true}={}){
  const doc=win?.document; if(!doc) return;
  if(trackPrint&&!win.__peposPrintTracked){
    const nativePrint=win.print.bind(win);
    win.print=()=>{ void recordPrintEvent(currentTab,doc.title||'',{title:doc.title||'',source:'print-preview'}); return nativePrint(); };
    win.__peposPrintTracked=true;
  }
  const printButton=[...doc.querySelectorAll('button')].find(button=>String(button.getAttribute('onclick')||'').includes('window.print'));
  const topbar=printButton?.closest('.toolbar,.screenbar,.bar,.tools'); if(!topbar) return;
  topbar.classList.add('print-preview-topbar');
  Object.assign(topbar.style,{position:'sticky',top:'0',zIndex:'99',width:'100%',minHeight:'58px',boxSizing:'border-box',display:'flex',justifyContent:'flex-end',alignItems:'center',gap:'8px',padding:'10px 18px',background:'#fff',boxShadow:'0 2px 8px #0002',textAlign:'right'});
  topbar.replaceChildren();
  const backButton=doc.createElement('button');
  backButton.type='button'; backButton.textContent='ย้อนกลับ'; backButton.onclick=()=>win.close();
  Object.assign(backButton.style,{border:'1px solid #d7dee5',borderRadius:'7px',background:'#fff',color:'#667085',padding:'9px 18px',font:'600 14px Sarabun, Tahoma, sans-serif',cursor:'pointer'});
  const newPrintButton=doc.createElement('button');
  newPrintButton.type='button'; newPrintButton.textContent='พิมพ์'; newPrintButton.onclick=()=>win.print();
  Object.assign(newPrintButton.style,{border:'1px solid #4F4038',borderRadius:'7px',background:'#4F4038',color:'#fff',padding:'9px 18px',font:'600 14px Sarabun, Tahoma, sans-serif',cursor:'pointer'});
  topbar.append(backButton,newPrintButton);
  const printStyle=doc.createElement('style');
  printStyle.textContent='@media print{.print-preview-topbar{display:none!important}}';
  doc.head.appendChild(printStyle);
}
// ---------- ช่องเลือกวันที่แบบ วัน/เดือน/ปี (dd/mm/yyyy) พร้อมปฏิทินช่วยเลือก ----------
function isoToDMY(iso){ if(!iso) return ''; const parts=String(iso).split('-'); if(parts.length!==3) return ''; const [y,m,d]=parts; return `${d}/${m}/${y}`; }
function dmyToISO(dmy){
  const matched=String(dmy||'').trim().match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if(!matched) return null;
  const day=Number(matched[1]), month=Number(matched[2]), year=Number(matched[3]);
  const date=new Date(year,month-1,day);
  if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day) return null;
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function formatDMYInput(value){
  const digits=String(value||'').replace(/\D/g,'').slice(0,8);
  if(digits.length>4) return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
  if(digits.length>2) return `${digits.slice(0,2)}/${digits.slice(2)}`;
  return digits;
}
function dmyDateFieldHtml(id, isoValue, opts){
  opts = opts || {};
  const readonly = opts.readonly ? 'readonly' : '';
  const extraClass = opts.extraClass || '';
  const reqAttr = opts.required ? '' : '';
  return `<span class="dmy-field ${extraClass}">
    <input type="text" class="rpt-select dmy-input ${extraClass}" id="${id}" value="${isoToDMY(isoValue)}" placeholder="วว/ดด/ปปปป" inputmode="numeric" maxlength="10" autocomplete="off" ${readonly}>
    ${readonly?'':`<button type="button" class="dmy-cal-trigger" aria-label="เลือกวันที่จากปฏิทิน"><svg class="dmy-cal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></button>
    <input type="date" class="dmy-native" data-target="${id}" value="${isoValue||''}" tabindex="-1" aria-hidden="true">`}
  </span>`;
}
function bindDmyDateFields(){
  if(document.documentElement.dataset.dmyDateFieldsBound==='1') return;
  document.documentElement.dataset.dmyDateFieldsBound='1';
  document.addEventListener('input',event=>{
    const txt=event.target.closest?.('.dmy-input');
    if(!txt||txt.readOnly||txt.disabled) return;
    const value=formatDMYInput(txt.value);
    if(txt.value!==value) txt.value=value;
    const nativeInput=txt.parentElement?.querySelector?.('.dmy-native');
    const iso=dmyToISO(value);
    if(nativeInput&&iso) nativeInput.value=iso;
  });
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.('.dmy-cal-trigger');
    if(!trigger) return;
    event.preventDefault();
    const nativeInput=trigger.parentElement?.querySelector?.('.dmy-native');
    if(!nativeInput) return;
    try{
      if(typeof nativeInput.showPicker==='function') nativeInput.showPicker();
      else nativeInput.click();
    }catch(error){}
  });
  document.addEventListener('change',event=>{
    const nativeInput=event.target.closest?.('.dmy-native');
    if(!nativeInput) return;
    const txt=document.getElementById(nativeInput.dataset.target);
    if(txt){ txt.value=isoToDMY(nativeInput.value); txt.dispatchEvent(new Event('change')); }
  });
}
// จัดรูปแบบเบอร์โทรเป็น xxx-xxx-xxxx ขณะพิมพ์
function formatPhoneValue(raw){
  const digits=String(raw||'').replace(/\D/g,'').slice(0,10);
  if(digits.length>6) return digits.slice(0,3)+'-'+digits.slice(3,6)+'-'+digits.slice(6);
  if(digits.length>3) return digits.slice(0,3)+'-'+digits.slice(3);
  return digits;
}
function normalizedPhoneDigits(raw){ return String(raw||'').replace(/\D/g,''); }
function contactIncludesCustomer(contact){ return Array.isArray(contact?.types)&&contact.types.includes('customer'); }
function duplicateCustomerPhone(phone,excludedId=null){
  const digits=normalizedPhoneDigits(phone);
  if(!digits) return null;
  return contacts.find(contact=>contactIncludesCustomer(contact)&&String(contact.id)!==String(excludedId)&&normalizedPhoneDigits(contact.phone)===digits)||null;
}
function isDuplicateCustomerPhoneError(error){
  const detail=[error?.message,error?.details,error?.hint,error?.constraint].filter(Boolean).join(' ');
  return String(error?.code||'')==='23505'&&/contacts_customer_phone_unique|phone/i.test(detail);
}
function showToast(msg, variant){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (variant?` ${variant}`:'') + ' show';
  clearTimeout(showToast._h);
  showToast._h = setTimeout(()=>{ t.classList.remove('show'); }, 1800);
}
let storageWarningShown=false;
function safeLocalStorageSet(key,value,label){
  try{ localStorage.setItem(key,value); return true; }
  catch(error){
    console.warn(`ไม่สามารถบันทึก${label||'ข้อมูล'}ได้`,error);
    if(!storageWarningShown){
      storageWarningShown=true;
      setTimeout(()=>showToast('พื้นที่บันทึกข้อมูลในเครื่องไม่เพียงพอ กรุณารีเฟรชและตรวจการเชื่อมต่อ','error'),0);
    }
    return false;
  }
}
