// Local paper preferences; never synced with business data.
const A4_PAPER_STORAGE_KEY='pepos_a4_paper_v1';
const A4_PAPER_DEFAULTS=Object.freeze({orientation:'auto',marginTop:15,marginBottom:15,marginLeft:15,marginRight:15});
function normalizeA4PaperSettings(value){
  const source=value&&typeof value==='object'?value:{};
  const result={orientation:['portrait','landscape'].includes(source.orientation)?source.orientation:'auto'};
  for(const key of ['marginTop','marginBottom','marginLeft','marginRight']){
    const raw=source[key],number=Number(raw);
    result[key]=raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(number)?Math.round(Math.max(0,Math.min(40,number))*10)/10:A4_PAPER_DEFAULTS[key];
  }
  return result;
}
function readA4PaperSettings(){
  try{const value=JSON.parse(localStorage.getItem(A4_PAPER_STORAGE_KEY)||'null');return value&&typeof value==='object'&&!Array.isArray(value)?normalizeA4PaperSettings(value):null;}
  catch{return null;}
}
function a4PaperLayoutCss(settings,documentOrientation='portrait'){
  const s=normalizeA4PaperSettings(settings),orientation=s.orientation==='auto'?documentOrientation:s.orientation;
  const landscape=orientation==='landscape',width=landscape?297:210,height=landscape?210:297;
  const margins=`${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm`;
  // flow-root contains heading margins; the half-mm reserve avoids print rounding overflow.
  return `@page{size:A4 ${landscape?'landscape':'portrait'};margin:${margins}}
    .a4-configured-page{box-sizing:border-box!important;width:${width}mm!important;min-height:${height}mm!important;height:auto!important;padding:${margins}!important;overflow:visible!important}
    body.a4-configured-body{box-sizing:border-box!important;width:${width}mm!important;max-width:none!important;min-height:${height}mm!important;padding:${margins}!important;margin:12px auto!important}
    @media print{
      html,body{width:auto!important;max-width:none!important;margin:0!important;padding:0!important;background:#fff!important}
      .a4-configured-page{display:flow-root!important;width:100%!important;max-width:none!important;min-height:${height-s.marginTop-s.marginBottom-0.5}mm!important;padding:0!important;margin:0!important;box-shadow:none!important}
      body.a4-configured-body{width:auto!important;min-height:0!important;margin:0!important;padding:0!important}
      .a4-configured-page .signheads,.a4-configured-page .signlines{left:0!important;right:0!important}
    }`;
}
function applyA4PaperLayout(win,settings=readA4PaperSettings()){
  const doc=win?.document;if(!doc||!settings) return false;
  const source=[...doc.querySelectorAll('style:not(#a4PaperLayout)')].map(style=>style.textContent).join('\n');
  // Receipt rolls and labels have their own independent paper settings.
  if(!/@page\s*\{[^}]*\bsize\s*:\s*A4\b/i.test(source)) return false;
  const orientation=/\bsize\s*:\s*A4\s+landscape\b/i.test(source)?'landscape':'portrait';
  const pages=[...doc.querySelectorAll('.page,.a4-page,.paper,.sheet')].filter(page=>!page.parentElement.closest('.page,.a4-page,.paper,.sheet'));
  if(pages.length) pages.forEach(page=>page.classList.add('a4-configured-page'));
  else doc.body.classList.add('a4-configured-body');
  const style=doc.createElement('style');style.id='a4PaperLayout';style.textContent=a4PaperLayoutCss(settings,orientation);
  doc.getElementById(style.id)?.remove();doc.head.appendChild(style);return true;
}
function a4PaperTestHtml(settings,{toolbar=false}={}){
  const landscape=normalizeA4PaperSettings(settings).orientation==='landscape';
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ทดลองพิมพ์ A4 — ไม่ใช่เอกสารขาย</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eee9e6;font:14px Tahoma,sans-serif;color:#111}.page{margin:12px auto;background:#fff}.sample-border{border:1px dashed #888;padding:12px}h1{font-size:22px}.bar{padding:10px;background:white}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:12px;text-align:left}@media print{.bar{display:none}}
    ${a4PaperLayoutCss(settings)}${toolbar?'':`@media screen{.page{zoom:${landscape ? 0.35 : 0.5}}}@media screen and (max-width:420px){.page{zoom:${landscape ? 0.27 : 0.38}}}`}</style></head><body>${toolbar?'<div class="bar"><button onclick="window.print()">พิมพ์</button></div>':''}<main class="page a4-configured-page"><div class="sample-border"><h1>ตัวอย่างกระดาษ A4</h1><p>ภาษาไทย / English / 0123456789</p><p>กรอบเส้นประแสดงจุดเริ่มต้นของเนื้อหาหลังเว้นระยะขอบ</p><table><thead><tr><th>รายการ</th><th>จำนวน</th><th>รวม</th></tr></thead><tbody><tr><td>สินค้าตัวอย่าง</td><td>2</td><td>250.00</td></tr></tbody></table><p>ทดลองพิมพ์เท่านั้น ไม่บันทึกยอดขายและไม่ตัดสต๊อก</p></div></main></body></html>`;
}
function renderA4PaperSettings(){
  const s=readA4PaperSettings()||A4_PAPER_DEFAULTS;
  const fields=[['marginTop','ขอบบน'],['marginBottom','ขอบล่าง'],['marginLeft','ขอบซ้าย'],['marginRight','ขอบขวา']].map(([key,label])=>`<label class="receipt-printer-field" for="a4_${key}"><span>${label} (มม.)</span><input id="a4_${key}" name="${key}" type="number" min="0" max="40" step="0.1" required value="${s[key]}"></label>`).join('');
  return `<div class="receipt-printer-grid a4-paper-settings"><form class="settings-section" id="a4PaperForm"><h2>กระดาษ A4</h2><p class="hint">ขนาด 210 × 297 มม. สำหรับเอกสารและรายงาน A4</p>
    <label class="receipt-printer-field" for="a4_orientation"><span>แนวกระดาษ</span><select id="a4_orientation" name="orientation">${[['auto','ตามรูปแบบเอกสาร'],['portrait','แนวตั้ง'],['landscape','แนวนอน']].map(([value,label])=>`<option value="${value}" ${s.orientation===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <div class="receipt-printer-margins">${fields}</div><div class="receipt-printer-actions"><button class="btn primary" type="submit">บันทึก A4</button><button class="btn" type="button" id="testA4PaperBtn">ทดลองพิมพ์ A4</button><button class="btn" type="button" id="resetA4PaperBtn">คืนค่าเริ่มต้น</button></div>
    <p id="a4PaperStatus" class="receipt-printer-status" role="status">${readA4PaperSettings()?'ใช้ค่า A4 ที่บันทึกไว้บนเครื่องนี้':'ยังใช้ระยะขอบเดิมของแต่ละเอกสาร กดบันทึกเพื่อใช้ค่า A4 นี้'}</p>
    <div class="receipt-printer-help">เลือกกระดาษ A4 และมาตราส่วน 100% ในหน้าต่างพิมพ์ ปิดหัวกระดาษ/ท้ายกระดาษ และใช้ระยะขอบตามโปรแกรม<br>ทดลองพิมพ์ใช้ค่าที่กรอกอยู่ บันทึกแล้วจึงมีผลกับหน้าพิมพ์ที่เปิดใหม่<br>“ตามรูปแบบเอกสาร” จะคงแนวตั้งหรือแนวนอนของเอกสารนั้น ตัวอย่างนี้แสดงแนวตั้ง</div>
    </form><section class="settings-section receipt-printer-preview"><h2>ตัวอย่าง A4</h2><iframe id="a4PaperPreview" title="ตัวอย่างหน้ากระดาษ A4" sandbox=""></iframe></section></div>`;
}
function attachA4PaperEvents(){
  const form=document.getElementById('a4PaperForm');if(!form) return;
  const status=document.getElementById('a4PaperStatus'),values=()=>Object.fromEntries(new FormData(form).entries());
  const announce=(text,error=false)=>{status.textContent=text;status.classList.toggle('is-error',error);};
  const preview=()=>{document.getElementById('a4PaperPreview').srcdoc=a4PaperTestHtml(values());};
  form.addEventListener('input',()=>{preview();announce('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก');});
  form.addEventListener('change',()=>{preview();announce('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก');});
  form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity()) return;
    try{localStorage.setItem(A4_PAPER_STORAGE_KEY,JSON.stringify(normalizeA4PaperSettings(values())));announce('บันทึกแล้ว ใช้กับหน้าพิมพ์ A4 ที่เปิดใหม่บนเครื่องนี้');showToast('บันทึกการตั้งค่า A4 แล้ว');}
    catch{announce('บันทึกไม่สำเร็จ เบราว์เซอร์ไม่อนุญาตให้เก็บข้อมูลหรือพื้นที่เต็ม',true);}
  });
  document.getElementById('resetA4PaperBtn').onclick=()=>{for(const [key,value] of Object.entries(A4_PAPER_DEFAULTS)) form.elements.namedItem(key).value=value;preview();announce('คืนค่าเริ่มต้นแล้ว กดบันทึกเพื่อยืนยัน');};
  document.getElementById('testA4PaperBtn').onclick=()=>{if(!form.reportValidity()) return;
    const win=window.open('','_blank');if(!win){announce('เบราว์เซอร์บล็อกหน้าต่างทดลองพิมพ์ กรุณาอนุญาตป๊อปอัป',true);return;}
    win.document.write(a4PaperTestHtml(values(),{toolbar:true}));win.document.close();
    standardizePrintPreview(win,{trackPrint:false,applyPaperSettings:false});
    announce('เปิดตัวอย่าง A4 แล้ว กดพิมพ์เมื่อต้องการทดลอง');
  };
  preview();
}
