// Device preferences and pairing never enter workspace snapshots or cloud sync.
const DIRECT_PRINTER_KEY='pepos_direct_printer_v1';
const DIRECT_PRINTER_TOKEN_KEY='pepos_direct_printer_token_v1';
const BARCODE_PAPER_KEY='pepos_barcode_paper_v1';
const DIRECT_PRINTER_TYPES=Object.freeze({receipt:'ใบเสร็จอย่างย่อ',a4:'เอกสาร A4',barcode:'บาร์โค้ด / ป้ายราคา'});
function directPrinterEnabled(){
  try{return localStorage.getItem(DIRECT_PRINTER_KEY)==='enabled';}catch{return false;}
}
function directPrinterId(bytes=16){
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),value=>value.toString(16).padStart(2,'0')).join('');
}
async function directPrinterRequest(path,payload={},timeout=8000){
  const token=localStorage.getItem(DIRECT_PRINTER_TOKEN_KEY)||'';
  if(!/^[a-f0-9]{64}$/.test(token)) throw new Error('กรุณาเชื่อมต่อตัวช่วยในหน้าตั้งค่าการพิมพ์ก่อน');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetch('http://127.0.0.1:17839'+path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(payload),signal:controller.signal,cache:'no-store',credentials:'omit'});
    const result=await response.json();
    if(!response.ok||result.error) throw new Error(result.error||'ตัวช่วยพิมพ์ไม่รับคำขอ');
    return result;
  }catch(error){
    if(error.name==='AbortError'||error instanceof TypeError) throw new Error('ติดต่อ SAPURI Print ไม่ได้ กรุณาเปิดตัวช่วยและอนุญาตการเชื่อมต่อเครือข่ายในเครื่อง หากเพิ่งกดพิมพ์ให้ตรวจคิวก่อนสั่งใหม่');
    throw error;
  }finally{clearTimeout(timer);}
}
function directPrinterLayout(doc){
  const css=Array.from(doc.querySelectorAll('style'),style=>style.textContent).join('\n');
  const sizes=Array.from(css.matchAll(/@page\s*\{[^}]*?\bsize\s*:\s*([^;}]+)/gi));
  const size=sizes.length?sizes[sizes.length-1][1].trim():'A4';
  if(doc.querySelector('.receipt')){
    const width=Number(doc.querySelector('.receipt').getBoundingClientRect().width)*25.4/96;
    return {kind:'receipt',width:width<65?58:80,height:200}; // Native renderer measures the final receipt height.
  }
  const dimensions=size.match(/^(\d+(?:\.\d+)?)mm\s+(\d+(?:\.\d+)?)mm/i);
  if(doc.querySelector('.label,.medicine-label,.command-card')&&dimensions) return {kind:'barcode',width:Number(dimensions[1]),height:Number(dimensions[2])};
  const landscape=/landscape/i.test(size);
  return {kind:'a4',width:landscape?297:210,height:landscape?210:297};
}
async function directPrinterHtml(doc){
  const clone=doc.documentElement.cloneNode(true);
  clone.querySelectorAll('script,iframe,object,embed,base,form,meta[http-equiv],link,.print-preview-topbar,.toolbar,.screenbar,.bar,.tools,.document-print-sidebar,[data-direct-print-status]').forEach(node=>node.remove());
  clone.querySelectorAll('*').forEach(node=>{
    for(const attribute of [...node.attributes]) if(/^on/i.test(attribute.name)||['srcdoc','action','formaction'].includes(attribute.name))node.removeAttribute(attribute.name);
  });
  const originalImages=[...doc.images],images=[...clone.querySelectorAll('img')];
  for(const img of images){
    if(img.src.startsWith('data:')) continue;
    const original=originalImages.find(source=>source.getAttribute('src')===img.getAttribute('src'));
    try{
      if(!original?.complete||!original.naturalWidth) throw new Error('image not loaded');
      const canvas=doc.createElement('canvas');canvas.width=original.naturalWidth;canvas.height=original.naturalHeight;
      canvas.getContext('2d').drawImage(original,0,0);img.src=canvas.toDataURL('image/png');img.removeAttribute('srcset');
    }catch{throw new Error('เตรียมรูปภาพบนเอกสารไม่สำเร็จ กรุณารอให้รูปโหลดครบแล้วลองใหม่');}
  }
  return '<!DOCTYPE html>'+clone.outerHTML;
}
function directPrinterNotice(win,message,error=false){
  let notice=win.document.querySelector('[data-direct-print-status]');
  if(!notice){notice=win.document.createElement('div');notice.dataset.directPrintStatus='1';notice.setAttribute('role','status');win.document.body.prepend(notice);}
  notice.textContent=message;
  notice.style.cssText='position:sticky;top:60px;z-index:100;padding:12px 18px;font:14px Tahoma,sans-serif;background:'+(error?'#fff0ee;color:#a12315':'#eaf7ee;color:#21643a');
}
function attachDirectPrinter(win){
  if(!win?.document||win.__sapuriDirectPrintAttached) return;
  win.__sapuriDirectPrintAttached=true;
  const browserPrint=win.print.bind(win);
  win.print=()=>{
    if(!directPrinterEnabled()) return browserPrint();
    if(win.__sapuriPrintBusy) return win.__sapuriPrintBusy;
    if(win.__sapuriPrintNeedsReview){
      if(!win.confirm('งานก่อนหน้ายังยืนยันไม่ได้ว่ากระดาษออกหรือไม่ กรุณาตรวจคิวเครื่องพิมพ์ก่อน ต้องการส่งเป็นงานใหม่หรือไม่?')) return;
      win.__sapuriPrintJob=null;win.__sapuriPrintNeedsReview=false;
    }
    win.__sapuriPrintBusy=(async()=>{
      try{
        directPrinterNotice(win,'กำลังเตรียมงานพิมพ์…');
        if(!win.__sapuriPrintJob){
          await win.document.fonts?.ready;
          win.__sapuriPrintJob={id:directPrinterId(),...directPrinterLayout(win.document),html:await directPrinterHtml(win.document)};
        }
        const request=win.__sapuriPrintJob;
        // The same id is reused after an uncertain response. The helper journals
        // accepted jobs and never submits the same id to Windows twice.
        let result=await directPrinterRequest('/print',request,15000);
        for(let attempt=0;['queued','printing'].includes(result.state)&&attempt<90;attempt++){
          directPrinterNotice(win,result.message||'กำลังส่งงานพิมพ์…');
          await new Promise(resolve=>setTimeout(resolve,600));
          result=await directPrinterRequest('/job',{id:request.id});
        }
        if(result.state!=='sent'){
          win.__sapuriPrintNeedsReview=['failed','unknown'].includes(result.state);
          throw new Error(result.message||'ยังไม่ทราบผลส่งงาน กรุณาตรวจคิวก่อนสั่งใหม่');
        }
        directPrinterNotice(win,result.message);win.__sapuriPrintJob=null;
        // Existing receipt auto-close handlers only run after confirmed dispatch.
        win.dispatchEvent(new win.Event('afterprint'));
      }catch(error){if(!win.closed) directPrinterNotice(win,error.message,true);}
      finally{win.__sapuriPrintBusy=null;}
    })();
    return win.__sapuriPrintBusy;
  };
}
function renderDirectPrinterSettings(){
  return `<section class="settings-section"><h2>เครื่องพิมพ์ประจำเครื่องนี้</h2><p>เลือกเครื่องแยกตามประเภท กดพิมพ์แล้วส่งไปเครื่องที่บันทึกไว้โดยอัตโนมัติ</p><div class="receipt-printer-actions"><button class="btn primary" type="button" id="connectDirectPrinter">เชื่อมต่อตัวช่วยพิมพ์</button><button class="btn" type="button" id="refreshDirectPrinters">โหลดเครื่องพิมพ์ใหม่</button><a class="btn" href="https://github.com/regener00-creator/noosol-pos/releases/download/printing-v3.0/SAPURI-POS-Setup-Windows-v3.0.zip" target="_blank" rel="noopener">ดาวน์โหลดชุดตั้งค่า Windows</a></div><p id="directPrinterConnection" role="status">กำลังตรวจตัวช่วยพิมพ์…</p><div class="direct-printer-cards">${Object.entries(DIRECT_PRINTER_TYPES).map(([kind,label])=>`<form class="direct-printer-card" data-direct-printer="${kind}"><h3>${label}</h3><label for="directPrinter_${kind}">เครื่องพิมพ์</label><select id="directPrinter_${kind}" name="printer" required disabled><option value="">เชื่อมต่อตัวช่วยเพื่อโหลดเครื่องพิมพ์</option></select><div class="receipt-printer-actions"><button class="btn primary" type="submit" disabled>บันทึกเครื่องพิมพ์</button><button class="btn" type="button" data-test-direct="${kind}" disabled>ทดลองพิมพ์</button></div><p data-printer-status role="status">ยังไม่เชื่อมต่อ</p></form>`).join('')}</div><p class="hint">ครั้งแรกติดตั้งตัวช่วย แล้วกดเชื่อมต่อ หาก Chrome ถาม ให้เปิด SAPURI Print และอนุญาตการเชื่อมต่อในเครื่อง ค่าจะจำแยกแต่ละคอมและบัญชี Windows</p></section>`;
}
function renderBarcodePaperSettings(){
  const selected=readBarcodePaperSize();
  return `<section class="settings-section"><h2>กระดาษบาร์โค้ด / ป้ายราคา</h2><form id="barcodePaperForm"><label class="receipt-printer-field" for="barcodePaperSize"><span>ขนาดป้ายเริ่มต้น</span><select id="barcodePaperSize" name="size">${['50x30','80x50','60x40','40x30'].map(size=>`<option value="${size}" ${selected===size?'selected':''}>${size.replace('x',' × ')} มม.</option>`).join('')}</select></label><button class="btn primary" type="submit">บันทึกขนาดป้าย</button><p id="barcodePaperStatus" role="status">ใช้เป็นค่าเริ่มต้นในหน้าพิมพ์ป้ายราคา เปลี่ยนขนาดเฉพาะงานได้ก่อนพิมพ์</p></form></section>`;
}
function readBarcodePaperSize(){try{const size=localStorage.getItem(BARCODE_PAPER_KEY);return ['50x30','80x50','60x40','40x30'].includes(size)?size:'50x30';}catch{return '50x30';}}
function directPrinterTest(kind){
  if(kind==='receipt') return printReceiptPrinterTest(readReceiptPrinterSettings());
  const win=window.open('','_blank');if(!win){showToast('กรุณาอนุญาตหน้าต่างพิมพ์','warning-top');return;}
  if(kind==='a4') win.document.write(a4PaperTestHtml(readA4PaperSettings()||A4_PAPER_DEFAULTS,{toolbar:true}));
  else{
    const [width,height]=readBarcodePaperSize().split('x').map(Number);
    const barcode=code128BSvg('8850000000015',32);
    win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ทดสอบเครื่องพิมพ์บาร์โค้ด</title><style>@page{size:${width}mm ${height}mm;margin:0}body{margin:0;color:#000;font:10px Tahoma}.label{box-sizing:border-box;width:${width}mm;height:${height}mm;padding:2mm;text-align:center;overflow:hidden}.label svg{max-width:100%;height:10mm}.toolbar{padding:10px}@media print{.toolbar{display:none}}</style></head><body><div class="toolbar"><button onclick="window.print()">พิมพ์</button></div><div class="label"><b>SAPURI — ทดสอบป้าย</b><div>${barcode}</div><div>8850000000015</div><small>ไม่ใช่รายการขาย</small></div></body></html>`);
  }
  win.document.close();standardizePrintPreview(win,{trackPrint:false,applyPaperSettings:false});win.print();
}
function attachDirectPrinterSettings(){
  const connection=document.getElementById('directPrinterConnection');if(!connection) return;
  let saved={};
  const announce=(message,error=false)=>{connection.textContent=message;connection.classList.toggle('is-error',error);};
  const load=async()=>{
    try{
      const result=await directPrinterRequest('/printers');saved=result.settings||{};
      if(!Array.isArray(result.printers)) throw new Error('กรุณาอัปเดตตัวช่วยพิมพ์');
      localStorage.setItem(DIRECT_PRINTER_KEY,'enabled');announce('เชื่อมต่อ SAPURI Print แล้ว · พิมพ์อัตโนมัติตามเครื่องที่บันทึก');
      document.querySelectorAll('[data-direct-printer]').forEach(form=>{
        const kind=form.dataset.directPrinter,select=form.elements.printer,current=saved[kind]?.printer||'';
        select.innerHTML='<option value="">เลือกเครื่องพิมพ์</option>'+result.printers.map(printer=>`<option value="${escapeHtml(printer.name)}" ${current===printer.name?'selected':''} ${printer.isVirtual?'disabled':''}>${escapeHtml(printer.name)}${printer.isVirtual?' — ไม่รองรับพิมพ์อัตโนมัติ':printer.offline?' — ออฟไลน์':''}</option>`).join('');
        if(current&&!result.printers.some(p=>p.name===current)){const option=document.createElement('option');option.value=current;option.textContent=current+' — ไม่พบใน Windows';option.selected=true;select.appendChild(option);}
        select.disabled=false;form.querySelectorAll('button').forEach(button=>button.disabled=false);
        form.querySelector('[data-printer-status]').textContent=current?'เครื่องที่บันทึก: '+current:'ยังไม่ได้ตั้งเครื่องพิมพ์ประเภทนี้';
      });return true;
    }catch(error){announce(error.message,true);return false;}
  };
  document.getElementById('refreshDirectPrinters').onclick=()=>load();
  document.getElementById('connectDirectPrinter').onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      let token=localStorage.getItem(DIRECT_PRINTER_TOKEN_KEY);
      if(!/^[a-f0-9]{64}$/.test(token||'')){token=directPrinterId(32);localStorage.setItem(DIRECT_PRINTER_TOKEN_KEY,token);}
      announce('รอเปิด SAPURI Print… หากมีคำถามจาก Chrome ให้เลือกเปิดตัวช่วย');
      window.location.href='sapuri-print://pair/'+token;
      for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,1000));try{await directPrinterRequest('/status',{},1500);await load();return;}catch{}}
      announce('ยังไม่เชื่อมต่อ กรุณาติดตั้งชุดตั้งค่า เปิด SAPURI Print แล้วกดเชื่อมต่ออีกครั้ง',true);
    }catch(error){announce(error.message,true);}finally{button.disabled=false;}
  };
  document.querySelectorAll('[data-direct-printer]').forEach(form=>{
    const kind=form.dataset.directPrinter,status=form.querySelector('[data-printer-status]');
    form.addEventListener('change',()=>{status.textContent='มีการเปลี่ยนแปลง กดบันทึกเครื่องพิมพ์ก่อนใช้งาน';});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!form.reportValidity()) return;
      const button=form.querySelector('[type="submit"]');button.disabled=true;
      try{const result=await directPrinterRequest('/settings',{kind,printer:form.elements.printer.value});saved=result.settings;status.textContent='บันทึกแล้ว: '+saved[kind].printer;}
      catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    });
    form.querySelector('[data-test-direct]').onclick=()=>{
      if(!saved[kind]?.printer||form.elements.printer.value!==saved[kind].printer){status.textContent='กรุณาบันทึกเครื่องพิมพ์ที่เลือกก่อนทดลอง';return;}
      directPrinterTest(kind);
    };
  });
  const barcodeForm=document.getElementById('barcodePaperForm');
  if(barcodeForm)barcodeForm.onsubmit=event=>{event.preventDefault();try{localStorage.setItem(BARCODE_PAPER_KEY,barcodeForm.elements.size.value);barcodePrintLabelSize=readBarcodePaperSize();document.getElementById('barcodePaperStatus').textContent='บันทึกขนาดป้ายบนเครื่องนี้แล้ว';}catch{document.getElementById('barcodePaperStatus').textContent='บันทึกไม่สำเร็จ กรุณาตรวจพื้นที่เบราว์เซอร์';}};
  if(localStorage.getItem(DIRECT_PRINTER_TOKEN_KEY))void load();else announce('ยังไม่เชื่อมต่อ · ติดตั้งตัวช่วยแล้วกดเชื่อมต่อครั้งแรก');
}
