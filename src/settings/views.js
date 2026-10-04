function renderBusinessSettings(){
  const b=businessSettings;
  const vatSelected=b.vat===VAT_REGISTERED_LABEL;
  const branch=['none','head','branch'].includes(b.branch)?b.branch:'none';
  const statusState=businessSettingsDirty?'dirty':businessSettingsSyncState;
  const statusText=businessSettingsDirty?'มีการแก้ไขที่ยังไม่ได้บันทึก':businessSettingsSyncState==='synced'?(businessSettingsLastSyncedAt?`ซิงก์ข้อมูลล่าสุด ${auditLogDateTime(businessSettingsLastSyncedAt)}`:'ซิงก์ข้อมูลกับ Supabase แล้ว'):businessSettingsSyncState==='syncing'?'กำลังซิงก์ข้อมูลกับ Supabase...':businessSettingsSyncState==='error'?`บันทึกในเครื่องแล้ว แต่ซิงก์ไม่สำเร็จ: ${businessSettingsSyncError||'กรุณาลองบันทึกอีกครั้ง'}`:'ข้อมูลยังอยู่ในเครื่องนี้';
  return `<div class="settings-page business-settings-page" id="businessSettingsForm">
    <div class="pagehead topbar-action-source"><div></div><div class="form-final-actions"><button class="btn primary" id="saveBusinessSettingsBtn">บันทึกข้อมูลธุรกิจ</button></div></div>
    <div class="settings-section">
      <div class="settings-row"><label>ประเภทธุรกิจ:</label><select id="set_business_type"><option ${b.type==='บริษัท'?'selected':''}>บริษัท</option><option ${b.type==='บุคคลธรรมดา'?'selected':''}>บุคคลธรรมดา</option><option ${b.type==='ห้างหุ้นส่วน'?'selected':''}>ห้างหุ้นส่วน</option></select></div>
      <div class="settings-row"><label>จดภาษีมูลค่าเพิ่ม:</label><select id="set_business_vat"><option ${b.vat==='จดภาษีมูลค่าเพิ่มแล้ว'?'selected':''}>จดภาษีมูลค่าเพิ่มแล้ว</option><option ${b.vat==='ยังไม่จดภาษีมูลค่าเพิ่ม'?'selected':''}>ยังไม่จดภาษีมูลค่าเพิ่ม</option></select></div>
      <div class="settings-row" id="businessVatDateRow" ${vatSelected?'':'hidden'}><label>วันที่เริ่มจด VAT ตาม ภ.พ.20:</label><div><input id="set_business_vat_date" class="dmy-input" value="${escapeHtml(isoToDMY(b.vatRegistrationDate))}" placeholder="วว/ดด/ปปปป" inputmode="numeric" maxlength="10" autocomplete="off"><small class="business-field-hint">ระบบจะเริ่มคิด VAT และอนุญาตให้ออกใบกำกับภาษีตั้งแต่วันที่นี้</small></div></div>
      <div class="hint">หากเลือก “ยังไม่จดภาษีมูลค่าเพิ่ม” ระบบจะไม่คิด VAT และไม่ออกใบกำกับภาษีสำหรับรายการขายใหม่ โดยจะเก็บค่าภาษีของสินค้าเดิมไว้ใช้เมื่อจด VAT ในอนาคต</div>
    </div>
    <div class="settings-section"><h2>รายละเอียดธุรกิจ</h2><div class="hint">ข้อมูลใช้สำหรับการออกเอกสาร</div>
      <div class="settings-row"><label>ชื่อธุรกิจ:</label><input id="set_business_name" value="${escapeHtml(b.name)}" autocomplete="organization"></div>
      <div class="settings-row"><label>ที่อยู่:</label><textarea id="set_business_address" rows="4" autocomplete="street-address">${escapeHtml(b.address)}</textarea></div>
      <div class="settings-row"><label>เลขประจำตัวผู้เสียภาษี:</label><div><input id="set_business_tax" value="${escapeHtml(b.taxId)}" inputmode="numeric" maxlength="13" autocomplete="off"><small class="business-field-hint" id="businessTaxIdHint">${escapeHtml(businessTypeTaxIdHint(b.type))}</small></div></div>
      <div class="settings-row" id="businessTaxBranchRow" ${vatSelected?'':'hidden'}><label>สำนักงาน/สาขาตาม ภ.พ.20:</label><div class="settings-radio settings-radio-inline"><label><input type="radio" name="set_branch" value="none" ${branch==='none'?'checked':''}> ยังไม่ระบุ</label><label><input type="radio" name="set_branch" value="head" ${branch==='head'?'checked':''}> สำนักงานใหญ่</label><label><input type="radio" name="set_branch" value="branch" ${branch==='branch'?'checked':''}> สาขา</label></div></div>
      <div class="business-tax-note" id="businessTaxBranchNote" ${vatSelected?'':'hidden'}>ข้อมูลนี้เป็นสาขาทางภาษีตาม ภ.พ.20 และแยกจากคลังสินค้าที่เลือกใช้งานใน TOPBAR</div>
      <div id="businessBranchFields" ${vatSelected&&branch==='branch'?'':'hidden'}>
        <div class="settings-row"><label>รหัสสาขา:</label><div><input id="set_business_branch_code" value="${escapeHtml(b.branchCode||'')}" placeholder="เช่น 00001" inputmode="numeric" maxlength="5" autocomplete="off"><small class="business-field-hint">รหัสสาขา 5 หลักตามเอกสาร ภ.พ.20</small></div></div>
        <div class="settings-row"><label>ชื่อสาขา:</label><input id="set_business_branch_name" value="${escapeHtml(b.branchName||'')}" placeholder="กรอกชื่อสาขา" maxlength="120"></div>
      </div>
    </div>

    <div class="settings-section"><h2>ข้อมูลติดต่อ</h2><div class="hint">ข้อมูลใช้สำหรับการออกเอกสาร</div>
      <div class="settings-row"><label>เบอร์สำนักงาน:</label><input id="set_business_office" class="phone-input" value="${escapeHtml(b.officePhone)}" inputmode="tel" autocomplete="tel"></div>
      <div class="settings-row"><label>เบอร์มือถือ:</label><input id="set_business_mobile" class="phone-input" value="${escapeHtml(b.mobile)}" inputmode="tel" autocomplete="tel"></div>
      <div class="settings-row"><label>เบอร์หลักบนเอกสาร:</label><select id="set_business_document_phone"><option value="mobile" ${b.documentPhone!=='office'?'selected':''}>เบอร์มือถือ</option><option value="office" ${b.documentPhone==='office'?'selected':''}>เบอร์สำนักงาน</option></select></div>
      <div class="settings-row"><label>เบอร์โทรสาร:</label><input id="set_business_fax" class="phone-input" value="${escapeHtml(b.fax)}" inputmode="tel"></div>
      <div class="settings-row"><label>LINE:</label><input id="set_business_line" value="${escapeHtml(b.line||'')}" autocomplete="off" placeholder="เช่น @NOOSOL"></div>
      <div class="settings-row"><label>เว็บไซต์:</label><input id="set_business_website" value="${escapeHtml(b.website)}" inputmode="url" autocomplete="url" placeholder="เช่น www.noosol.com"></div>
      <div class="business-sync-status" id="businessSyncStatus" data-state="${escapeHtml(statusState)}">${escapeHtml(statusText)}</div>
    </div></div>`;
}

function renderPosCommandBarcodeSection(){
  return `<div class="settings-section"><h2>บาร์โค้ดคำสั่งหน้า POS</h2><div class="hint">ใช้แทนปุ่ม Home: ยิงบาร์โค้ดคำสั่งนี้ 1 ครั้ง แล้วสินค้ารายการถัดไปที่ยิงหรือเลือกจะขายเป็นหน่วยเล็กสุดทันที หลังเพิ่มสินค้าแล้วระบบจะกลับสู่โหมดปกติอัตโนมัติ</div>
    <div class="pos-command-barcode-card">
      <div class="pos-command-barcode-preview"><strong>ขายหน่วยเล็กสุด 1 รายการ</strong>${code128BSvg(POS_SMALLEST_UNIT_COMMAND,52)}<span>${escapeHtml(POS_SMALLEST_UNIT_COMMAND)}</span></div>
      <div class="pos-command-barcode-steps"><b>วิธีใช้</b><ol><li>ยิงบาร์โค้ดคำสั่งนี้</li><li>ตรวจว่าหน้า POS แสดงคำว่า “พร้อมขายหน่วยเล็กสุด”</li><li>ยิงสินค้าที่ต้องการ ระบบจะเลือกหน่วยเล็กสุดให้เพียงรายการเดียว</li></ol><p>กด Home หรือ Esc เพื่อยกเลิกก่อนยิงสินค้าได้</p></div>
    </div>
    <div class="settings-actions"><button class="btn primary" id="printPosSmallestUnitCommandBtn" type="button">พิมพ์บาร์โค้ดคำสั่ง</button></div>
  </div>`;
}
function printPosSmallestUnitCommandBarcode(){
  const win=window.open('','_blank');
  if(!win){ showToast('เบราว์เซอร์บล็อกหน้าพิมพ์ กรุณาอนุญาต Pop-up แล้วลองใหม่','danger-top'); return; }
  const barcode=code128BSvg(POS_SMALLEST_UNIT_COMMAND,52);
  win.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>บาร์โค้ดคำสั่งขายหน่วยเล็กสุด</title><style>
    @page{size:80mm 50mm;margin:0}*{box-sizing:border-box}body{margin:0;background:#ececec;font-family:Tahoma,"Noto Sans Thai",sans-serif;color:#000}.toolbar{height:58px;background:#fff;padding:10px 18px;text-align:right}.toolbar button{padding:9px 18px;border:0;border-radius:7px;background:#4F4038;color:#fff;font:600 14px Tahoma;cursor:pointer}.command-card{width:80mm;height:50mm;margin:18px auto 0;background:#fff;border:1.2px solid #000;border-radius:4mm;padding:4mm 5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}.command-card h1{font-size:18pt;line-height:1.15;margin:0 0 2.5mm;text-align:center}.command-card .barcode-label-svg{display:block;width:66mm;height:18mm}.command-card .code{font:10pt monospace;letter-spacing:.4px;margin-top:1.2mm}.command-card .note{font-size:9pt;margin-top:1.5mm;font-weight:700}@media print{body{background:#fff}.toolbar{display:none}.command-card{margin:0;border:1.2px solid #000}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">พิมพ์</button></div><main class="command-card"><h1>ขายหน่วยเล็กสุด 1 รายการ</h1>${barcode}<div class="code">${escapeHtml(POS_SMALLEST_UNIT_COMMAND)}</div><div class="note">ยิงใบนี้ก่อนสินค้า 1 ครั้ง</div></main></body></html>`);
  win.document.close();
  standardizePrintPreview(win);
}

// Kept outside workspace snapshots/sync: each browser profile owns its printer layout.
const RECEIPT_PRINTER_STORAGE_KEY='pepos_receipt_printer_v1';
const RECEIPT_PRINTER_DEFAULTS=Object.freeze({paperWidth:80,marginTop:24,marginBottom:15,marginLeft:8,marginRight:8});
function normalizeReceiptPrinterSettings(value){
  const source=value&&typeof value==='object'?value:{};
  const result={paperWidth:Number(source.paperWidth)===58?58:80};
  for(const key of ['marginTop','marginBottom','marginLeft','marginRight']){
    const raw=source[key],number=Number(raw),max=key==='marginLeft'||key==='marginRight'?10:30;
    result[key]=raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(number)?Math.round(Math.max(0,Math.min(max,number))*10)/10:RECEIPT_PRINTER_DEFAULTS[key];
  }
  return result;
}
function readReceiptPrinterSettings(){
  try{ return normalizeReceiptPrinterSettings(JSON.parse(localStorage.getItem(RECEIPT_PRINTER_STORAGE_KEY)||'null')); }
  catch{ return {...RECEIPT_PRINTER_DEFAULTS}; }
}
function receiptPrinterLayoutCss(settings=readReceiptPrinterSettings()){
  const s=normalizeReceiptPrinterSettings(settings),narrow=s.paperWidth===58;
  return `@page{size:auto;margin:0}
    .receipt{box-sizing:border-box;width:${s.paperWidth}mm;padding:${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm;overflow-wrap:anywhere}
    .receipt .meta{grid-template-columns:${narrow?18:25}mm minmax(0,1fr)}
    .receipt .item{grid-template-columns:minmax(0,1fr) ${narrow?16:19}mm}
    .receipt .summary>div{gap:2mm}.receipt .summary>div>b{flex-shrink:0}
    ${narrow?'.receipt .store{font-size:9pt}.receipt .store h2{font-size:12pt}.receipt .title,.receipt .summary .total{font-size:10pt}.receipt .meta,.receipt .item,.receipt .summary,.receipt .footer{font-size:8pt}':''}
    @media print{html,body{margin:0;padding:0;background:#fff}.receipt{width:${s.paperWidth}mm;margin:0;min-height:0;box-shadow:none}.bar{display:none!important}}`;
}
function applyReceiptPrinterLayout(win,settings=readReceiptPrinterSettings()){
  const style=win.document.createElement('style');
  style.id='receiptPrinterLayout';
  style.textContent=receiptPrinterLayoutCss(settings);
  win.document.getElementById(style.id)?.remove();
  win.document.head.appendChild(style);
}
function receiptPrinterTestHtml(settings,{toolbar=false}={}){
  const s=normalizeReceiptPrinterSettings(settings);
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>ทดลองพิมพ์ใบเสร็จ — ไม่ใช่รายการขาย</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eee9e6;color:#111;font-family:Sarabun,Tahoma,sans-serif}
    .receipt{margin:12px auto;background:#fff;box-shadow:0 2px 8px #0002}.center{text-align:center}.store{font-size:11pt;line-height:1.35}.store h2{font-size:14pt;margin:0 0 2px}.title{font-size:12pt;font-weight:700}.meta{display:grid;gap:1mm;font-size:10pt;margin-top:4mm}.dash{border-top:1px dashed #111;margin:4mm 0}.item{display:grid;gap:2mm;padding:2mm 0;font-size:9.5pt;align-items:start}.item b{font-weight:500}.item small{display:block}.item strong{text-align:right;font-weight:500}.summary{font-size:10pt}.summary>div{display:flex;justify-content:space-between;padding:1mm 0}.summary .total{font-size:12pt;font-weight:700;border-top:1px solid #111;border-bottom:3px double #111;padding:2mm 0}.footer{font-size:9pt;line-height:1.6}.bar{background:#fff;padding:10px}
    ${receiptPrinterLayoutCss(s)}</style></head><body>${toolbar?'<div class="bar"><button onclick="window.print()">พิมพ์</button></div>':''}
    <div class="receipt"><div class="center store"><h2>ทดสอบเครื่องพิมพ์</h2><div>ภาษาไทย / English / 0123456789</div></div><div class="dash"></div>
    <div class="center title">ใบเสร็จตัวอย่าง ${s.paperWidth} มม.</div><div class="center footer">ไม่ใช่หลักฐานการซื้อขาย</div>
    <div class="meta"><b>เลขที่</b><span>TEST-0001</span><b>ชำระโดย</b><span>เงินสด (ตัวอย่าง)</span></div><div class="dash"></div>
    <div class="item"><div><b>สินค้าตัวอย่างชื่อยาว สำหรับตรวจสอบการตัดบรรทัด</b><small>2 กล่อง × 125.00</small></div><strong>250.00</strong></div>
    <div class="item"><div><b>สินค้าตัวอย่างรายการที่สอง</b><small>1 ชิ้น × 50.00</small></div><strong>50.00</strong></div>
    <div class="dash"></div><div class="summary"><div><span>จำนวนเงินหลังหักส่วนลด</span><b>300.00</b></div><div class="total"><span>รวมทั้งสิ้น</span><b>300.00</b></div></div>
    <div class="dash"></div><div class="center footer">ทดลองพิมพ์เท่านั้น<br>ไม่บันทึกยอดขายและไม่ตัดสต๊อก<br>โทร 02-000-0000<br>LINE @example</div></div></body></html>`;
}
function printReceiptPrinterTest(settings){
  const win=window.open('','_blank');
  if(!win){ showToast('เบราว์เซอร์บล็อกหน้าต่างทดลองพิมพ์ กรุณาอนุญาตป๊อปอัป','warning-top'); return false; }
  win.document.write(receiptPrinterTestHtml(settings,{toolbar:true}));
  win.document.close();
  // A sample is not a bill and must not create a sale or a print-event record.
  standardizePrintPreview(win,{trackPrint:false});
  setTimeout(()=>{ if(!win.closed) win.print(); },350);
  return true;
}
function renderReceiptPrinterSettings(){
  const settings=readReceiptPrinterSettings();
  const field=(key,label,max)=>`<label class="receipt-printer-field" for="printer_${key}"><span>${label} (มม.)</span><input id="printer_${key}" name="${key}" type="number" min="0" max="${max}" step="0.1" required value="${settings[key]}"></label>`;
  return `<div class="settings-page receipt-printer-page"><div class="receipt-printer-heading"><h2>ตั้งค่าเครื่องพิมพ์ใบเสร็จ</h2><span class="receipt-printer-badge">เฉพาะเครื่องนี้</span></div>
    <p class="hint">ใช้กับใบเสร็จอย่างย่อเท่านั้น จำค่าในเบราว์เซอร์นี้ ไม่เปลี่ยนเครื่องอื่น บิล A4 หรือฉลากยา</p>
    <div class="receipt-printer-grid"><form class="settings-section" id="receiptPrinterForm">
      <h2>กระดาษและระยะขอบ</h2><label class="receipt-printer-field" for="printer_paperWidth"><span>ความกว้างกระดาษ</span><select id="printer_paperWidth" name="paperWidth"><option value="80" ${settings.paperWidth===80?'selected':''}>80 มม.</option><option value="58" ${settings.paperWidth===58?'selected':''}>58 มม.</option></select></label>
      <div class="receipt-printer-margins">${field('marginTop','ขอบบน',30)}${field('marginBottom','ขอบล่าง',30)}${field('marginLeft','ขอบซ้าย',10)}${field('marginRight','ขอบขวา',10)}</div>
      <div class="receipt-printer-actions"><button type="submit" class="btn primary">บันทึก</button><button type="button" class="btn" id="testReceiptPrinterBtn">ทดลองพิมพ์</button><button type="button" class="btn" id="resetReceiptPrinterBtn">คืนค่าเริ่มต้น</button></div>
      <p id="receiptPrinterStatus" class="receipt-printer-status" role="status">ค่าที่ใช้กับใบเสร็จบนเครื่องนี้</p>
      <div class="receipt-printer-help"><strong>พิมพ์ผ่านเบราว์เซอร์</strong><p>เลือกเครื่องพิมพ์และขนาดกระดาษให้ตรงกันในหน้าต่างพิมพ์ ตั้งมาตราส่วน 100% ปิดหัวกระดาษ/ท้ายกระดาษ และเลือกไม่มีระยะขอบ</p><p>ตอนนี้ยังมีหน้าต่างยืนยันการพิมพ์ การพิมพ์ทันทีโดยไม่ถามต้องตั้งค่าร่วมกับเครื่องพิมพ์จริงเพิ่มเติม</p><p>ทดลองพิมพ์ใช้ค่าที่กรอกอยู่ กดบันทึกเพื่อนำไปใช้กับใบเสร็จจริง หากล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเบราว์เซอร์ ต้องตั้งค่าใหม่</p></div>
    </form><section class="settings-section receipt-printer-preview"><h2>ตัวอย่างใบเสร็จ</h2><iframe id="receiptPrinterPreview" title="ตัวอย่างขนาดใบเสร็จ ไม่ใช่รายการขาย" sandbox=""></iframe></section></div></div>`;
}
function attachReceiptPrinterEvents(){
  const form=document.getElementById('receiptPrinterForm'); if(!form) return;
  const status=document.getElementById('receiptPrinterStatus');
  const values=()=>Object.fromEntries(new FormData(form).entries());
  const preview=()=>{ document.getElementById('receiptPrinterPreview').srcdoc=receiptPrinterTestHtml(values()); };
  const announce=(text,error=false)=>{ status.textContent=text; status.classList.toggle('is-error',error); };
  form.addEventListener('input',()=>{ preview(); announce('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก'); });
  form.addEventListener('change',()=>{ preview(); announce('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก'); });
  form.addEventListener('submit',event=>{
    event.preventDefault(); if(!form.reportValidity()) return;
    try{
      localStorage.setItem(RECEIPT_PRINTER_STORAGE_KEY,JSON.stringify(normalizeReceiptPrinterSettings(values())));
      announce('บันทึกแล้ว ใช้กับใบเสร็จอย่างย่อบนเครื่องนี้');
      showToast('บันทึกการตั้งค่าเครื่องพิมพ์แล้ว');
    }catch{ announce('บันทึกไม่สำเร็จ เบราว์เซอร์ไม่อนุญาตให้เก็บข้อมูลหรือพื้นที่เต็ม',true); }
  });
  document.getElementById('testReceiptPrinterBtn').onclick=()=>{
    if(!form.reportValidity()) return;
    if(printReceiptPrinterTest(values())) announce('เปิดทดลองพิมพ์แล้ว กรุณาตรวจผลจากเครื่องพิมพ์จริง');
  };
  document.getElementById('resetReceiptPrinterBtn').onclick=()=>{
    for(const [key,value] of Object.entries(RECEIPT_PRINTER_DEFAULTS)) form.elements.namedItem(key).value=value;
    preview(); announce('คืนค่าเริ่มต้นแล้ว กดบันทึกเพื่อยืนยัน');
  };
  preview();
}

function renderSystemSettings(){
  return `<div class="settings-page">
    <div class="settings-section"><h2>รหัสนำหน้าเอกสาร</h2><div class="hint">กำหนดตัวอักษรนำหน้าหมายเลขเอกสาร ใช้ตัวอักษรอังกฤษหรือตัวเลขได้สูงสุด 8 ตัว และมีผลกับเอกสารที่สร้างใหม่เท่านั้น</div>
      <div class="document-prefix-grid">
        ${DOCUMENT_PREFIX_FIELDS.map(field=>`<div class="document-prefix-field"><label for="doc_prefix_${field.key}">${escapeHtml(field.label)}</label><input id="doc_prefix_${field.key}" maxlength="8" autocomplete="off" value="${escapeHtml(documentPrefixes[field.key])}" aria-label="รหัสนำหน้า ${escapeHtml(field.label)}"></div>`).join('')}
      </div>
      <div class="settings-actions"><button class="btn primary" id="saveDocumentPrefixesBtn">บันทึกรหัสนำหน้าเอกสาร</button></div>
    </div>
    ${renderPosCommandBarcodeSection()}
    ${renderStoreBackupSection()}
    ${renderStoreMaintenanceSection()}
    ${renderStoreResetDialog()}
    </div>`;
}

function storeBackupSummary(data=workspaceSnapshot()){
  if(data?.tables){
    const count=name=>data.tables['public.'+name]?.length||0;
    return {products:count('products'),contacts:count('contacts')+count('sales_representatives'),promotions:count('promotions'),
      documents:['sales','quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts','product_exchanges','purchase_orders_full','product_returns','transfers','standalone_tax_invoices'].reduce((sum,name)=>sum+count(name),0),
      lots:count('inventory_lots'),movements:count('inventory_lot_movements'),shifts:count('cash_shifts'),notes:count('notes')};
  }
  const documents=['salesHistory','quotations','invoicesAR','creditNotes','purchaseOrders','goodsReceipts','productExchanges','purchaseOrdersFull','productReturns','transfers','standaloneTaxInvoices']
    .reduce((total,key)=>total+(Array.isArray(data?.[key])?data[key].length:0),0);
  return {
    products:Array.isArray(data?.products)?data.products.length:0,
    contacts:(Array.isArray(data?.contacts)?data.contacts.length:0)+(Array.isArray(data?.salesRepresentatives)?data.salesRepresentatives.length:0),
    promotions:Array.isArray(data?.promotions)?data.promotions.length:0,
    documents,
    lots:Array.isArray(data?.inventoryBackup?.lots)?data.inventoryBackup.lots.length:0,
    movements:Array.isArray(data?.inventoryBackup?.movements)?data.inventoryBackup.movements.length:0
  };
}

function renderStoreBackupSection(){
  if(loggedInUser()?.owner!==true) return '';
  const summary=storeBackupSummary();
  const lastRaw=localStorage.getItem(STORE_BACKUP_LAST_KEY)||'';
  const lastDate=lastRaw?new Date(lastRaw):null;
  const lastText=lastDate&&!Number.isNaN(lastDate.getTime())?lastDate.toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'ยังไม่เคยดาวน์โหลดไฟล์สำรองจากเครื่องนี้';
  return `<div class="settings-section"><h2>สำรองข้อมูลร้าน</h2><div class="hint">ไฟล์สำรองดึงข้อมูลที่บันทึกบนเซิร์ฟเวอร์ ณ เวลาเดียวกัน ครอบคลุมสินค้า สต๊อกและ LOT กะขาย เอกสาร ลูกค้า ผู้จำหน่าย ผู้แทน สินค้าที่ดูแล NOTE ประวัติ และการตั้งค่าร้าน</div>
      <div class="backup-summary"><div class="backup-summary-item"><b>${summary.products}</b><span>รายการสินค้า</span></div><div class="backup-summary-item"><b>${summary.contacts}</b><span>รายชื่อที่เกี่ยวข้อง</span></div><div class="backup-summary-item"><b>${summary.promotions}</b><span>โปรโมชั่น</span></div><div class="backup-summary-item"><b>${summary.documents}</b><span>เอกสารและรายการขาย</span></div></div>
      <div class="backup-note">สำรองล่าสุดจากอุปกรณ์นี้: <strong>${escapeHtml(lastText)}</strong><br>ไฟล์สำรองไม่รวมบัญชีผู้ใช้งานและรหัสผ่าน ซึ่งจัดเก็บแยกในระบบยืนยันตัวตน<br>งานรอซิงก์บนเครื่องนี้แนบแยกไว้เพื่อตรวจสอบ ไม่ถูกนำเข้าขณะกู้คืน กรุณาซิงก์ทุกเครื่องให้สำเร็จก่อนสำรองหรือกู้คืน</div>
      <div class="backup-grid">
        <div class="backup-card"><div class="backup-icon">↓</div><h3>ดาวน์โหลดไฟล์สำรอง</h3><p>ระบบจะบันทึกข้อมูลล่าสุดจากร้านเป็นไฟล์ JSON ลงในอุปกรณ์ แนะนำให้สำรองอย่างน้อยสัปดาห์ละ 1 ครั้ง</p><button class="btn primary" id="downloadStoreBackupBtn">ดาวน์โหลดไฟล์สำรอง</button></div>
        <div class="backup-card restore"><div class="backup-icon">↑</div><h3>กู้คืนจากไฟล์สำรอง</h3><p>เลือกไฟล์ที่ดาวน์โหลดจากระบบนี้ ข้อมูลในร้านจะถูกแทนที่ด้วยข้อมูลจากวันที่สำรอง</p><button class="btn ghost" id="restoreStoreBackupBtn">เลือกไฟล์เพื่อกู้คืน</button><input id="restoreStoreBackupFile" type="file" accept="application/json,.json" hidden></div>
      </div>
      <div class="backup-note backup-warning"><strong>ข้อควรระวัง:</strong> เก็บไฟล์สำรองไว้ในพื้นที่ส่วนตัว เพราะไฟล์มีข้อมูลสินค้า ลูกค้า และเอกสารของร้าน การกู้คืนจะทำได้เฉพาะเจ้าของร้านและต้องยืนยันอีกครั้งก่อนเริ่ม</div>
    </div>`;
}

function renderUserSettings(){
  const u=currentUserProfile;
  const account=loggedInUser();
  return `<div class="settings-page"><h1 class="settings-title">ข้อมูลส่วนตัว</h1>
    <div class="settings-section"><h2>ข้อมูลส่วนตัว</h2>
      <div class="settings-row"><label>ชื่อ:</label><input id="set_user_first" value="${escapeHtml(u.firstName||'')}"></div>
      <div class="settings-row"><label>นามสกุล:</label><input id="set_user_last" value="${escapeHtml(u.lastName||'')}"></div>
      <div class="settings-row"><label>เบอร์ติดต่อ:</label><input id="set_user_phone" class="phone-input" value="${escapeHtml(u.phone||'')}"></div>
      <div class="settings-row"><label>ID ผู้ใช้งาน:</label><input value="${escapeHtml(account?.username||'')}" readonly></div>
    </div>
    <div class="settings-section"><h2>ลายเซ็นอิเล็กทรอนิกส์</h2>
      <div class="settings-row"><label>แนบไฟล์ลายเซ็น:</label><div><label class="signature-drop" for="set_signature_file"><span>ลากและวางไฟล์ที่นี่</span><span>หรือ</span><span class="btn ghost">📎 แนบไฟล์ภาพ</span><input id="set_signature_file" type="file" accept="image/*"></label><div id="signatureFileName" style="margin-top:8px;color:var(--text-muted);">${escapeHtml(u.signatureName||'*ขนาดภาพที่แนะนำ 400×140 px และขนาดไม่เกิน 3MB')}</div></div></div>
      <div class="settings-actions"><button class="btn primary" id="saveUserSettingsBtn">บันทึกข้อมูลส่วนตัว</button></div>
    </div></div>`;
}

function renderSystemUsers(){
  if(loggedInUser()?.owner!==true) return `<div class="empty"><h2>ไม่มีสิทธิ์เข้าถึง</h2><p>เฉพาะเจ้าของร้านเท่านั้นที่สามารถจัดการ ID และ Password ของผู้ใช้งานได้</p></div>`;
  if(!systemUsersLoaded){ if(!systemUsersLoading) loadSystemUsersFromServer(); return `<div class="empty"><h2>กำลังโหลด...</h2></div>`; }
  if(addingSystemUser) return renderAddSystemUser();
  return `<div class="pagehead topbar-action-source"><div></div><button class="btn primary" id="addSystemUserBtn">เพิ่มผู้ใช้งาน</button></div>
    <table class="grid-table doc-head-blue settings-user-table"><thead><tr><th>ID ผู้ใช้งาน / ชื่อ</th><th>เบอร์โทร</th><th>ข้อมูลอื่น ๆ</th><th>สิทธิ์การเข้าถึง</th><th style="width:122px;"></th></tr></thead><tbody>${systemUsers.map(u=>{ const names=u.owner?['ทุกคลัง']:(u.warehouseIds||[]).map(id=>whName(Number(id))).filter(name=>name&&name!=='-'); return `<tr><td><div class="user-email">◉ ${escapeHtml(u.username)}</div><div class="user-sub">${escapeHtml(u.firstName||'-')} ${u.owner?'<span class="owner-pill">♛ เจ้าของหลัก</span>':''}</div></td><td>${escapeHtml(u.phone||'-')}</td><td>${escapeHtml(u.note||'-')}</td><td><strong>${escapeHtml(systemUserLevelLabel(u.level))}</strong><small class="system-user-access-warehouses">คลัง: ${escapeHtml(names.join(', ')||'ยังไม่ได้กำหนด')}</small></td><td style="text-align:center;"><div class="history-actions" style="justify-content:center;"><button class="history-icon-btn" data-edit-system-user="${escapeHtml(u.id)}" title="แก้ไขผู้ใช้งาน" aria-label="แก้ไขผู้ใช้งาน ${escapeHtml(u.username)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button>${u.owner?'':`<button class="history-icon-btn danger" data-delete-system-user="${escapeHtml(u.id)}" title="ลบผู้ใช้งาน" aria-label="ลบผู้ใช้งาน ${escapeHtml(u.username)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>`}</div></td></tr>`; }).join('')}</tbody></table>`;
}

function systemUserLevelLabel(level){
  return ({1:'Level 1 - เจ้าของร้าน',2:'Level 2 - บุคคลทั่วไป',3:'Level 3 - ยังไม่กำหนด',4:'Level 4 - ยังไม่กำหนด'})[Number(level)]||'Level 2 - บุคคลทั่วไป';
}

const AUDIT_LOG_ENTITY_TYPES=['products','product','warehouses','settings','contacts','sales_representatives','notes','promotions','sales','cash_shifts','quotations','invoices_ar','credit_notes','purchase_orders','goods_receipts','product_exchanges','purchase_orders_full','product_returns','transfers','standalone_tax_invoices','inspection_lists','profiles','profile_warehouse_access','inventory_count','inventory_lot','store_reset'];
const AUDIT_LOG_ACTION_TYPES=['insert','update','delete','stock_adjusted','unit_changed','lot_expiry_changed','lot_reallocated','store_reset'];
async function loadAuditLogsFromSupabase(force=false,direction='first'){
  if(loggedInUser()?.owner!==true||(!force&&(auditLogLoading||auditLogLoaded))) return;
  const pageDirection=['first','previous','next','last'].includes(direction)?direction:'first';
  const cursorRow=pageDirection==='next'?auditLogRows[auditLogRows.length-1]:pageDirection==='previous'?auditLogRows[0]:null;
  if((pageDirection==='next'||pageDirection==='previous')&&!cursorRow) return;
  const requestToken=++auditLogRequestToken;
  const filterSnapshot={
    search:String(auditLogFilter.search||'').trim(),
    entity:auditLogFilter.entity||'all',
    action:auditLogFilter.action||'all'
  };
  const includeTotal=pageDirection==='first'||!auditLogLoaded;
  auditLogLoading=true;
  auditLogError='';
  try{
    const {data,error}=await sb.rpc('get_central_audit_log_page',{
      p_limit:AUDIT_LOG_PAGE_SIZE,
      p_cursor_time:cursorRow?.occurred_at||null,
      p_cursor_key:cursorRow?.event_key||null,
      p_direction:pageDirection,
      p_search:filterSnapshot.search,
      p_entity:filterSnapshot.entity,
      p_action:filterSnapshot.action,
      p_include_total:includeTotal
    });
    if(error) throw error;
    if(requestToken!==auditLogRequestToken) return;
    auditLogRows=Array.isArray(data?.rows)?data.rows:[];
    if(data?.totalCount!==null&&data?.totalCount!==undefined){
      auditLogTotal=Math.max(0,Number(data.totalCount)||0);
      auditLogPageCount=Math.max(1,Math.ceil(auditLogTotal/AUDIT_LOG_PAGE_SIZE));
    }
    if(pageDirection==='first') auditLogPage=1;
    else if(pageDirection==='last') auditLogPage=auditLogPageCount;
    else if(pageDirection==='previous') auditLogPage=Math.max(1,auditLogPage-1);
    else if(pageDirection==='next') auditLogPage=Math.min(auditLogPageCount,auditLogPage+1);
    auditLogHasNewer=data?.hasNewer===true;
    auditLogHasOlder=data?.hasOlder===true;
    expandedAuditLogRows.clear();
    auditLogLoaded=true;
  }catch(error){
    if(requestToken!==auditLogRequestToken) return;
    console.error('โหลด AUDIT LOG ไม่สำเร็จ',error);
    auditLogError=error?.message||'โหลดประวัติการทำงานไม่สำเร็จ';
  }finally{
    if(requestToken===auditLogRequestToken){
      auditLogLoading=false;
      if(currentTab==='auditlog') render();
    }
  }
}
function auditLogDateTime(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return '-';
  const pad=number=>String(number).padStart(2,'0');
  return `${pad(date.getDate())}-${pad(date.getMonth()+1)}-${date.getFullYear()} / ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function auditEntityLabel(type){
  return ({products:'สินค้า',product:'สินค้า',warehouses:'คลังสินค้า',settings:'การตั้งค่า',contacts:'สมุดรายชื่อ',sales_representatives:'ผู้แทนขาย',notes:'NOTE / ผู้แทน',promotions:'โปรโมชั่น',sales:'บิลขาย',cash_shifts:'กะขาย',quotations:'ใบเสนอราคา',invoices_ar:'ใบแจ้งหนี้',credit_notes:'ใบลดหนี้',purchase_orders:'สั่งซื้อสินค้า',goods_receipts:'ใบรับสินค้า',product_exchanges:'เปลี่ยนสินค้า',purchase_orders_full:'เอกสารซื้อเดิม',product_returns:'ใบคืนสินค้า',transfers:'โอนสินค้าระหว่างคลัง',standalone_tax_invoices:'ใบกำกับภาษี',inspection_lists:'รายการตรวจสินค้า',profiles:'ผู้ใช้งาน',profile_warehouse_access:'สิทธิ์คลังสินค้า',inventory_count:'ปรับสต๊อก',inventory_lot:'Lot สินค้า',store_reset:'ล้างข้อมูลระบบ'})[type]||type||'-';
}
function auditActionLabel(action){
  return ({insert:'สร้าง',update:'แก้ไข',delete:'ลบ',stock_adjusted:'ปรับสต๊อก',unit_changed:'เปลี่ยนหน่วยหลัก',lot_expiry_changed:'แก้วันหมดอายุ Lot',lot_reallocated:'ปรับจำนวนแยก Lot',store_reset:'ล้างข้อมูล'})[action]||action||'-';
}
function auditFieldLabel(field){
  return ({record:'ข้อมูล',name:'ชื่อ',sku:'รหัสสินค้า',price:'ราคาขาย',cost:'ทุน',stock:'คงเหลือ',unit:'หน่วย',data:'รายละเอียด',status:'สถานะ',expiry:'วันหมดอายุ',lot_quantity:'จำนวน Lot',value:'ค่า',warehouse_id:'คลังสินค้า',owner:'เจ้าของร้าน',level:'ระดับสิทธิ์'})[field]||field;
}
function auditValueText(value){
  if(value===null||value===undefined||value==='') return '-';
  if(typeof value==='object'){
    const text=JSON.stringify(value);
    return text.length>500?text.slice(0,500)+'…':text;
  }
  return String(value);
}
function auditRowSummary(row){
  const productId=Number(row.entity_id);
  const product=(row.entity_type==='products'||row.entity_type==='product'||row.entity_type==='inventory_lot')?products.find(item=>Number(item.id)===productId):null;
  const target=product?.name||row.entity_id||'-';
  const fields=(row.changed_fields||[]).filter(field=>field!=='record').map(auditFieldLabel).slice(0,3);
  return `${auditActionLabel(row.action)} ${auditEntityLabel(row.entity_type)} · ${target}${fields.length?` · ${fields.join(', ')}`:''}`;
}
function auditDataHtml(data){
  if(!data||typeof data!=='object'||!Object.keys(data).length) return '<span>-</span>';
  return Object.entries(data).slice(0,12).map(([key,value])=>`<div><b>${escapeHtml(auditFieldLabel(key))}</b> ${escapeHtml(auditValueText(value))}</div>`).join('');
}
function renderAuditLog(){
  if(loggedInUser()?.owner!==true) return `<div class="empty"><h2>ไม่มีสิทธิ์เข้าถึง</h2><p>เฉพาะเจ้าของร้านเท่านั้นที่ดู AUDIT LOG ได้</p></div>`;
  if(!auditLogLoaded&&!auditLogLoading) setTimeout(()=>loadAuditLogsFromSupabase(),0);
  const pageRows=auditLogRows;
  const pageCount=Math.max(1,auditLogPageCount);
  auditLogPage=Math.min(Math.max(1,auditLogPage),pageCount);
  const entityTypes=[...new Set([...AUDIT_LOG_ENTITY_TYPES,auditLogFilter.entity==='all'?null:auditLogFilter.entity].filter(Boolean))];
  const actionTypes=[...new Set([...AUDIT_LOG_ACTION_TYPES,auditLogFilter.action==='all'?null:auditLogFilter.action].filter(Boolean))];
  const entityOptions=entityTypes.map(value=>`<option value="${escapeHtml(value)}" ${auditLogFilter.entity===value?'selected':''}>${escapeHtml(auditEntityLabel(value))}</option>`).join('');
  const actionOptions=actionTypes.map(value=>`<option value="${escapeHtml(value)}" ${auditLogFilter.action===value?'selected':''}>${escapeHtml(auditActionLabel(value))}</option>`).join('');
  const hasActiveFilter=!!auditLogFilter.search||auditLogFilter.entity!=='all'||auditLogFilter.action!=='all';
  const rows=pageRows.map(row=>{
    const key=String(row.event_key||'');
    const expanded=expandedAuditLogRows.has(key);
    const warehouse=row.warehouse_id?whName(Number(row.warehouse_id)):'ทุกคลัง';
    const dangerous=row.action==='delete'||row.action==='store_reset';
    return `<tr><td>${escapeHtml(auditLogDateTime(row.occurred_at))}</td><td><div class="audit-log-actor"><strong>${escapeHtml(row.actor_name||'ระบบ')}</strong><small>${row.actor_level?`Level ${escapeHtml(row.actor_level)}`:'ระบบ'}</small></div></td><td><strong>${escapeHtml(auditEntityLabel(row.entity_type))}</strong><br><small>${escapeHtml(row.entity_id||'-')}</small></td><td><span class="audit-log-chip ${dangerous?'danger':row.action==='insert'?'':'neutral'}">${escapeHtml(auditActionLabel(row.action))}</span></td><td>${escapeHtml(warehouse)}</td><td>${escapeHtml(auditRowSummary(row))}</td><td><button class="history-icon-btn" data-audit-log-toggle="${escapeHtml(key)}" title="${expanded?'ซ่อน':'ดู'}รายละเอียด" aria-label="${expanded?'ซ่อน':'ดู'}รายละเอียด">${expanded?'−':'+'}</button></td></tr>${expanded?`<tr class="audit-log-detail-row"><td colspan="7"><div class="audit-log-details"><div class="audit-log-data"><b>ข้อมูลเดิม</b>${auditDataHtml(row.before_data)}</div><div class="audit-log-data"><b>ข้อมูลใหม่</b>${auditDataHtml(row.after_data)}</div></div></td></tr>`:''}`;
  }).join('');
  return `<div class="audit-log-page"><div class="pagehead topbar-action-source"><div></div><button class="btn primary" id="auditLogRefresh">รีเฟรชข้อมูล</button></div>
    <div class="audit-log-toolbar" role="search" aria-label="ค้นหาและกรอง AUDIT LOG">
      <label class="audit-log-filter audit-log-search-filter"><span class="audit-log-filter-label">ค้นหาประวัติ</span><span class="audit-log-control audit-log-search-control"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><input id="auditLogSearch" value="${escapeHtml(auditLogFilter.search)}" placeholder="ผู้ใช้งาน รายการ หรือเลขเอกสาร" autocomplete="off">${auditLogFilter.search?'<button type="button" class="audit-log-clear-search" id="auditLogClearSearch" title="ล้างคำค้นหา" aria-label="ล้างคำค้นหา">×</button>':''}</span></label>
      <label class="audit-log-filter"><span class="audit-log-filter-label">ประเภทรายการ</span><span class="audit-log-control"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"></path><path d="M8 9h8M8 13h5"></path></svg><select id="auditLogEntity"><option value="all">ทุกรายการ</option>${entityOptions}</select></span></label>
      <label class="audit-log-filter"><span class="audit-log-filter-label">การทำงาน</span><span class="audit-log-control"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg><select id="auditLogAction"><option value="all">ทุกการทำงาน</option>${actionOptions}</select></span></label>
      <div class="audit-log-toolbar-summary"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h10"></path></svg><span>ผลลัพธ์ที่พบ</span><strong>${auditLogTotal} รายการ</strong>${hasActiveFilter?'<button type="button" class="audit-log-clear-filters" id="auditLogClearFilters">ล้างตัวกรองทั้งหมด</button>':''}</div>
    </div>
    ${auditLogError?`<div class="notice danger">${escapeHtml(auditLogError)}</div>`:''}
    ${auditLogLoading&&!auditLogLoaded?'<div class="audit-log-empty">กำลังโหลดประวัติการทำงาน...</div>':`<div class="audit-log-table-wrap"><table class="audit-log-table"><thead><tr><th>วันและเวลา</th><th>ผู้ใช้งาน</th><th>รายการ</th><th>การทำงาน</th><th>คลังสินค้า</th><th>รายละเอียด</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="audit-log-empty">ไม่พบประวัติการทำงาน</td></tr>'}</tbody></table></div>`}
    <div class="audit-log-pagination"><button class="btn ghost" data-audit-log-page="first" ${!auditLogHasNewer||auditLogLoading?'disabled':''}>กลับไปหน้าแรก</button><button class="btn ghost" data-audit-log-page="previous" ${!auditLogHasNewer||auditLogLoading?'disabled':''}>ก่อนหน้า</button><span>หน้า ${auditLogPage} / ${pageCount}</span><button class="btn ghost" data-audit-log-page="next" ${!auditLogHasOlder||auditLogLoading?'disabled':''}>ถัดไป</button><button class="btn ghost" data-audit-log-page="last" ${!auditLogHasOlder||auditLogLoading?'disabled':''}>ไปหน้าสุดท้าย</button></div></div>`;
}

function defaultLevel2PagePermissions(){
  const visible=new Set(['dashboard','checkout','notes','cashshift','history','goodsreceipt','products','inventorymovement','rinventory','lowstock','expiry','rproduct','rbill','inspectionlists']);
  return PAGE_PERMISSION_OPTIONS.filter(([pageKey])=>visible.has(pageKey)).map(([pageKey])=>({
    pageKey,warehouseId:null,canView:true,
    canCreate:['checkout','notes','cashshift','goodsreceipt','inspectionlists'].includes(pageKey),
    canEdit:['checkout','notes','cashshift','goodsreceipt','inspectionlists'].includes(pageKey),
    canDelete:pageKey==='notes',canPrint:['history','goodsreceipt','rinventory','rproduct','rbill'].includes(pageKey),
    canExport:['inventorymovement','rinventory','rproduct','rbill'].includes(pageKey)
  }));
}
function normalizedSystemUserPermissionRows(user){
  const source=Array.isArray(user?.pagePermissions)&&user.pagePermissions.length?user.pagePermissions:defaultLevel2PagePermissions();
  return source.map(row=>({
    pageKey:String(row.pageKey||row.page_key||''),warehouseId:row.warehouseId??row.warehouse_id??null,
    canView:row.canView??row.can_view??true,canCreate:row.canCreate??row.can_create??false,
    canEdit:row.canEdit??row.can_edit??false,canDelete:row.canDelete??row.can_delete??false,
    canPrint:row.canPrint??row.can_print??false,canExport:row.canExport??row.can_export??false
  }));
}
function systemUserPermissionMatrixHtml(user){
  const permissionMap=new Map(normalizedSystemUserPermissionRows(user).map(row=>[row.pageKey,row]));
  const checked=(row,key)=>row?.[key]===true?'checked':'';
  const rows=PAGE_PERMISSION_OPTIONS.map(([pageKey,label])=>{
    const permission=permissionMap.get(pageKey);
    return `<tr data-system-user-permission-row="${pageKey}"><td><label class="permission-page-toggle"><input type="checkbox" data-permission-action="canView" ${checked(permission,'canView')}><span>${escapeHtml(label)}</span></label></td><td><input type="checkbox" data-permission-action="canCreate" ${checked(permission,'canCreate')}></td><td><input type="checkbox" data-permission-action="canEdit" ${checked(permission,'canEdit')}></td><td><input type="checkbox" data-permission-action="canDelete" ${checked(permission,'canDelete')}></td><td><input type="checkbox" data-permission-action="canPrint" ${checked(permission,'canPrint')}></td><td><input type="checkbox" data-permission-action="canExport" ${checked(permission,'canExport')}></td></tr>`;
  }).join('');
  return `<div class="system-user-permission-wrap"><table class="system-user-permission-table"><thead><tr><th>หน้าที่ใช้งาน</th><th>สร้าง</th><th>แก้ไข</th><th>ลบ</th><th>พิมพ์</th><th>Excel</th></tr></thead><tbody>${rows}</tbody></table></div><small class="system-user-warehouse-hint">สิทธิ์ของแต่ละหน้าจะใช้ร่วมกับคลังสินค้าที่เลือกด้านบน</small>`;
}
function renderAddSystemUser(){
  if(loggedInUser()?.owner!==true) return `<div class="empty"><h2>ไม่มีสิทธิ์เข้าถึง</h2><p>เฉพาะเจ้าของร้านเท่านั้นที่สามารถสร้างหรือแก้ไขผู้ใช้งานได้</p></div>`;
  const user=editingSystemUserId!==null?systemUsers.find(item=>String(item.id)===String(editingSystemUserId)):null;
  const editing=!!user,currentLevel=Number(user?.level)||(user?.owner?1:2);
  const defaultWarehouseId=Number(activeWarehouseId)||Number(warehouses[0]?.id)||0;
  const selectedWarehouseIds=new Set((editing?(user?.warehouseIds||[]):[defaultWarehouseId]).map(Number).filter(Boolean));
  const warehouseOptions=warehouses.map(warehouse=>`<label class="system-user-warehouse-option"><input type="checkbox" data-system-user-warehouse value="${escapeHtml(warehouse.id)}" ${selectedWarehouseIds.has(Number(warehouse.id))?'checked':''}><span>${escapeHtml(warehouse.name)}</span></label>`).join('');
  const recoveryFields=user?.owner?`<div class="system-user-form-field wide"><label>คำถาม *</label><input id="new_user_recovery_question" type="text" maxlength="200" autocomplete="off" placeholder="เช่น ชื่อเล่นของคุณแม่คืออะไร" value="${escapeHtml(user.recoveryQuestion||'')}"><small class="system-user-warehouse-hint">ใช้คำถามที่เจ้าของร้านจำคำตอบได้ แต่บุคคลอื่นเดาได้ยาก</small></div>
      <div class="system-user-form-field wide"><label>คำตอบ *</label><div class="password-input-wrap"><input id="new_user_recovery_answer" type="password" maxlength="200" autocomplete="new-password" placeholder="${user.hasRecoveryAnswer?'เว้นว่างเพื่อใช้คำตอบเดิม':'กรอกคำตอบสำหรับรีเซ็ต Password'}"><button class="password-eye-btn" type="button" data-toggle-password="new_user_recovery_answer" aria-label="แสดงคำตอบ" title="แสดงคำตอบ"><svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6a10.5 10.5 0 0 0 5.4-1.4"/></svg></button></div><small class="system-user-warehouse-hint">ระบบจะไม่แสดงคำตอบเดิม หากเปลี่ยนคำถามต้องกรอกคำตอบใหม่ด้วย</small></div>`:'';
  return `<div class="settings-page"><div class="pagehead"><div><div class="breadcrumb">ตั้งค่า › ผู้ใช้งานในระบบ › ${editing?'แก้ไขผู้ใช้งาน':'เพิ่มผู้ใช้งาน'}</div><h1>${editing?'แก้ไขผู้ใช้งาน':'เพิ่มผู้ใช้งาน'}</h1></div><div class="form-final-actions" style="display:flex;gap:8px;"><button class="btn ghost" id="cancelAddSystemUserBtn">ยกเลิก</button><button class="btn primary" id="saveSystemUserBtn">บันทึกผู้ใช้งาน</button></div></div>
    <div class="panel"><div class="system-user-form-grid">
      <div class="system-user-form-field wide"><label>ID *</label><input id="new_user_id" type="text" autocomplete="off" placeholder="กำหนด ID สำหรับเข้าสู่ระบบ" value="${escapeHtml(user?.username||'')}" ${editing?'readonly title="เปลี่ยน ID ไม่ได้หลังสร้างบัญชีแล้ว"':''}></div>
      <div class="system-user-form-field"><label>${editing?'Password ใหม่':'Password *'}</label><div class="password-input-wrap"><input id="new_user_password" type="password" minlength="10" placeholder="${editing?'เว้นว่างเพื่อใช้ Password เดิม':'อย่างน้อย 10 ตัวอักษร มีตัวอักษรและตัวเลข'}"><button class="password-eye-btn" type="button" data-toggle-password="new_user_password" aria-label="แสดง Password" title="แสดง Password"><svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6a10.5 10.5 0 0 0 5.4-1.4"/></svg></button></div></div>
      <div class="system-user-form-field"><label>ยืนยัน Password ใหม่${editing?'':' *'}</label><div class="password-input-wrap"><input id="new_user_password_confirm" type="password" minlength="10" placeholder="${editing?'เว้นว่างเพื่อใช้ Password เดิม':'กรอก Password อีกครั้ง'}"><button class="password-eye-btn" type="button" data-toggle-password="new_user_password_confirm" aria-label="แสดง Password" title="แสดง Password"><svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.6 6.6C3.6 8.3 2 12 2 12s3.5 6 10 6a10.5 10.5 0 0 0 5.4-1.4"/></svg></button></div></div>
      <div class="system-user-form-field"><label>ชื่อ *</label><input id="new_user_first" value="${escapeHtml(user?.firstName||'')}"></div>
      <div class="system-user-form-field"><label>เบอร์โทร</label><input id="new_user_phone" class="phone-input" inputmode="tel" value="${escapeHtml(user?.phone||'')}"></div>
      <div class="system-user-form-field wide"><label>ข้อมูลอื่น ๆ</label><textarea id="new_user_note" rows="3" placeholder="ข้อมูลเพิ่มเติมเกี่ยวกับผู้ใช้งาน">${escapeHtml(user?.note||'')}</textarea></div>
      ${recoveryFields}
      <div class="system-user-form-field wide"><label>สิทธิ์การเข้าถึง</label><select id="new_user_level" ${user?.owner?'disabled':''}><option value="1" ${currentLevel===1?'selected':''} ${user?.owner?'':'disabled'}>Level 1 - เจ้าของร้าน</option><option value="2" ${currentLevel!==1?'selected':''}>Level 2 - พนักงาน (กำหนดสิทธิ์รายหน้า)</option></select></div>
      ${user?.owner?'':`<div class="system-user-form-field wide"><label>คลังสินค้าที่เข้าถึง *</label><div class="system-user-warehouse-grid">${warehouseOptions||'<span>ยังไม่มีคลังสินค้าในระบบ</span>'}</div><small class="system-user-warehouse-hint">เลือกอย่างน้อย 1 คลัง ผู้ใช้งานจะเห็นและทำรายการได้เฉพาะคลังที่เลือก</small></div>`}
      ${user?.owner?'':`<div class="system-user-form-field wide"><label>สิทธิ์ตามหน้าที่</label>${systemUserPermissionMatrixHtml(user)}</div>`}
    </div></div></div>`;
}
