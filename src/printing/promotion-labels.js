let promotionPrintActive=false;
let promotionPrintSize='50x30';
let promotionPrintQuantity=1;
const PROMOTION_LABEL_SIZES={'50x30':'50 × 30 มม.','80x50':'80 × 50 มม.','60x40':'60 × 40 มม.','40x30':'40 × 30 มม.','a4-50x30':'A4 · ป้าย 50 × 30 มม. · 36 ป้าย/แผ่น','a4-poster':'A4 เต็มหน้า · แนวตั้ง'};
function promotionTemplateSize(size=promotionPrintSize){return size==='a4-50x30'?'50x30':size;}
function promotionLabelPreset(size){
  const template=priceLabelPresetTemplate(size,'left');
  Object.values(template.elements).forEach(element=>element.visible=false);
  const width=BARCODE_PRINT_LABEL_DIMENSIONS[size]?.[0]||50;
  const scale=width/50;
  template.customTexts=[
    normalizePriceLabelCustomText({id:'promotion-title',text:'โปรโมชั่น',x:5,y:8,width:90,height:28,fontSize:Math.min(100,18*scale),fontWeight:700,color:'#e60012',reverse:true},size),
    normalizePriceLabelCustomText({id:'promotion-detail',text:'พิมพ์ข้อความโปรโมชั่น',x:5,y:43,width:90,height:42,fontSize:Math.min(80,12*scale),fontWeight:700},size),
  ];
  template.preset='custom';return template;
}
function promotionLabelHtml(template,size){
  const normalized=normalizePriceLabelTemplate(template,size);
  const content=normalized.customTexts.filter(element=>element.visible).map(element=>`<div class="price-label-print-element custom-text" data-promotion-text="${escapeHtml(element.id)}" style="position:absolute;overflow:hidden;line-height:1.08;${priceLabelElementStyle(element,'custom')}">${escapeHtml(element.text)}</div>`).join('');
  return `<section class="label" style="padding:0"><div class="regular-layout" style="position:relative;width:100%;height:100%;overflow:hidden">${content}</div></section>`;
}
function renderPromotionLabelPrint(){
  if(!Object.hasOwn(PROMOTION_LABEL_SIZES,promotionPrintSize))promotionPrintSize='50x30';
  const size=promotionTemplateSize(),[width,height]=BARCODE_PRINT_LABEL_DIMENSIONS[size];
  const library=getPriceLabelTemplateLibrary(size,'promotion');
  const template=getPriceLabelTemplate(size,'promotion');
  return `<section class="rpt promotion-print-page"><div class="pagehead"><h1>ป้ายโปรโมชั่น</h1><div class="promotion-print-actions form-final-actions"><button type="button" class="btn ghost" id="barcodePrintMenuBtn">ย้อนกลับ</button><button type="button" class="btn ghost" id="promotionLabelDesignBtn">ออกแบบป้ายโปรโมชั่น</button><button type="button" class="btn primary" id="promotionLabelPrintBtn">พิมพ์ป้ายโปรโมชั่น</button></div></div>
    <div class="panel promotion-print-controls"><label>ขนาดกระดาษ<select id="promotionLabelSize">${Object.entries(PROMOTION_LABEL_SIZES).map(([value,label])=>`<option value="${value}" ${value===promotionPrintSize?'selected':''}>${label}</option>`).join('')}</select></label><label>จำนวนป้าย<input id="promotionLabelQuantity" type="number" min="1" max="500" step="1" value="${escapeHtml(String(promotionPrintQuantity))}"></label><label>แม่แบบ<select id="promotionLabelTemplate"><option value="" ${library.templates.length?'disabled':''}>${library.templates.length?'เลือกแม่แบบ':'แม่แบบเริ่มต้น'}</option>${library.templates.map(entry=>`<option value="${escapeHtml(entry.id)}" ${entry.id===library.activeId?'selected':''}>${escapeHtml(entry.name)}</option>`).join('')}</select></label></div>
    <div class="promotion-print-preview"><div style="width:${width}mm;height:${height}mm;flex-shrink:0;">${promotionLabelHtml(template,size)}</div></div></section>`;
}
function attachPromotionLabelEvents(){
  const sizeInput=document.getElementById('promotionLabelSize');
  if(!sizeInput)return;
  const context=captureWorkspaceRead();
  sizeInput.onchange=()=>{promotionPrintSize=sizeInput.value;render();};
  document.getElementById('promotionLabelQuantity').oninput=event=>{promotionPrintQuantity=event.target.value;};
  document.getElementById('promotionLabelTemplate').onchange=event=>{
    const size=promotionTemplateSize(),library=getPriceLabelTemplateLibrary(size,'promotion');
    const entry=library.templates.find(item=>item.id===event.target.value);if(!entry)return;
    library.activeId=entry.id;persistPriceLabelTemplateState(size,entry.template,library,'promotion');render();
  };
  document.getElementById('promotionLabelDesignBtn').onclick=()=>openPriceLabelDesigner(promotionTemplateSize(),{kind:'promotion',onClose:()=>{
    if(isWorkspaceReadCurrent(context)&&currentTab==='barcodeprint'&&promotionPrintActive&&!barcodePrintShowMenu)render();
  }});
  document.getElementById('promotionLabelPrintBtn').onclick=()=>{
    const quantity=Number(promotionPrintQuantity),size=promotionTemplateSize(),template=getPriceLabelTemplate(size,'promotion');
    if(!Number.isInteger(quantity)||quantity<1||quantity>500){showToast('กรุณาระบุจำนวนป้ายเป็นจำนวนเต็ม 1–500');document.getElementById('promotionLabelQuantity').focus();return;}
    if(!template.customTexts.some(element=>element.visible&&element.text.trim())){showToast('กรุณาเพิ่มข้อความที่ต้องการแสดงบนป้ายก่อนพิมพ์');return;}
    const popup=window.open('','_blank');
    if(!popup){showToast('กรุณาอนุญาต Pop-up เพื่อเปิดหน้าพิมพ์');return;}
    try{writeBarcodePrintWindow(popup,[],promotionPrintSize,{trackPrint:false,promotionTemplate:template,promotionQuantity:quantity});}
    catch(error){if(!popup.closed)popup.close();showToast(error.message||'เปิดหน้าพิมพ์ไม่สำเร็จ');}
  };
}
