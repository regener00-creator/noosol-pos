let promotionPrintActive=false;
let promotionPrintSize='50x30';
let promotionPrintQuantity=1;
const PROMOTION_LABEL_SIZES={'50x30':'50 × 30 มม.','80x50':'80 × 50 มม.','60x40':'60 × 40 มม.','40x30':'40 × 30 มม.','a4-50x30':'A4 · ป้าย 50 × 30 มม. · 36 ป้าย/แผ่น','a4-poster':'A4 เต็มหน้า · แนวตั้ง','a4-poster-landscape':'A4 เต็มหน้า · แนวนอน'};
function promotionPaperKey(){return 'pepos-promotion-paper-v1:'+String(activeWarehouseId||1);}
function readPromotionPrintSize(){
  try{const size=localStorage.getItem(promotionPaperKey());return Object.hasOwn(PROMOTION_LABEL_SIZES,size)?size:'50x30';}catch{return '50x30';}
}
function rememberPromotionPrintSize(size){
  if(!Object.hasOwn(PROMOTION_LABEL_SIZES,size))return;
  promotionPrintSize=size;
  try{localStorage.setItem(promotionPaperKey(),size);}catch{}
}
// Fit the same text and font in the designer, preview and print document.
function fitPromotionTextElement(element){
  const text=element.querySelector('[data-promotion-content]');if(!text)return;
  const view=element.ownerDocument.defaultView,style=view.getComputedStyle(element);
  const maximum=parseFloat(style.fontSize)||16;
  const availableWidth=element.clientWidth-parseFloat(style.paddingLeft||0)-parseFloat(style.paddingRight||0);
  const availableHeight=element.clientHeight;
  if(availableWidth<=0||availableHeight<=0)return;
  const fits=size=>{
    text.style.fontSize=size+'px';
    const range=element.ownerDocument.createRange();range.selectNodeContents(text);
    const bounds=range.getBoundingClientRect();
    return Math.max(text.scrollHeight,bounds.height)<=availableHeight-.5&&Math.max(text.scrollWidth,bounds.width)<=availableWidth+.5;
  };
  element.dataset.fitted='true';
  if(fits(maximum))return;
  let low=.1,high=maximum;
  for(let i=0;i<16;i++){const middle=(low+high)/2;if(fits(middle))low=middle;else high=middle;}
  fits(low);
}
function fitPromotionLabelText(root){root.querySelectorAll('[data-promotion-text]').forEach(fitPromotionTextElement);}
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
  const content=normalized.customTexts.filter(element=>element.visible).map(element=>`<div class="price-label-print-element custom-text" data-promotion-text="${escapeHtml(element.id)}" style="position:absolute;overflow:hidden;line-height:1.08;${priceLabelElementStyle(element,'custom')}"><span data-promotion-content style="display:block;width:100%;flex-shrink:0;line-height:1.3">${escapeHtml(element.text)}</span></div>`).join('');
  return `<section class="label" style="padding:0"><div class="regular-layout" style="position:relative;width:100%;height:100%;overflow:hidden">${content}</div></section>`;
}
function renderPromotionLabelPrint(){
  promotionPrintSize=readPromotionPrintSize();
  const size=promotionTemplateSize(),[width,height]=BARCODE_PRINT_LABEL_DIMENSIONS[size];
  const library=getPriceLabelTemplateLibrary(size,'promotion');
  const template=getPriceLabelTemplate(size,'promotion');
  return `<section class="rpt promotion-print-page"><div class="pagehead label-print-pagehead"><div class="promotion-print-actions form-final-actions"><button type="button" class="btn ghost" id="barcodePrintMenuBtn">ย้อนกลับ</button><button type="button" class="btn primary" id="promotionLabelPrintBtn">พิมพ์ป้ายโปรโมชั่น</button></div></div>
    <div class="panel promotion-print-controls"><label>ขนาดกระดาษ<select id="promotionLabelSize">${Object.entries(PROMOTION_LABEL_SIZES).map(([value,label])=>`<option value="${value}" ${value===promotionPrintSize?'selected':''}>${label}</option>`).join('')}</select></label><label>จำนวนป้าย<input id="promotionLabelQuantity" type="number" min="1" max="500" step="1" value="${escapeHtml(String(promotionPrintQuantity))}"></label><label>แม่แบบ<select id="promotionLabelTemplate"><option value="" ${library.templates.length?'disabled':''}>${library.templates.length?'เลือกแม่แบบ':'แม่แบบเริ่มต้น'}</option>${library.templates.map(entry=>`<option value="${escapeHtml(entry.id)}" ${entry.id===library.activeId?'selected':''}>${escapeHtml(entry.name)}</option>`).join('')}</select></label></div>
    <div class="promotion-print-preview"><div class="promotion-preview-viewport" style="max-width:${width}mm;aspect-ratio:${width}/${height}"><div class="promotion-preview-page" style="width:${width}mm;height:${height}mm;">${promotionLabelHtml(template,size)}</div></div></div></section>`;
}
let promotionPreviewObserver=null;
function attachPromotionLabelEvents(){
  promotionPreviewObserver?.disconnect();promotionPreviewObserver=null;
  const sizeInput=document.getElementById('promotionLabelSize');
  if(!sizeInput)return;
  sizeInput.onchange=()=>{rememberPromotionPrintSize(sizeInput.value);render();};
  const viewport=document.querySelector('.promotion-preview-viewport');
  const page=viewport?.querySelector('.promotion-preview-page');
  const fitPreview=()=>{
    if(!viewport?.isConnected||!page)return;
    // Measure and fit at physical print size, then scale only the screen preview.
    page.style.transform='none';
    fitPromotionLabelText(page);
    const scale=Math.min(1,viewport.clientWidth/page.offsetWidth);
    page.style.transform=`scale(${scale})`;
  };
  fitPreview();
  document.fonts?.ready.then(fitPreview);
  if(viewport&&typeof ResizeObserver==='function'){
    promotionPreviewObserver=new ResizeObserver(fitPreview);promotionPreviewObserver.observe(viewport);
  }
  document.getElementById('promotionLabelQuantity').oninput=event=>{promotionPrintQuantity=event.target.value;};
  document.getElementById('promotionLabelTemplate').onchange=async event=>{
    const input=event.target;input.disabled=true;
    const context=captureStoreView();
    const size=promotionTemplateSize(),library=getPriceLabelTemplateLibrary(size,'promotion');
    const entry=library.templates.find(item=>item.id===event.target.value);if(!entry){input.disabled=false;return;}
    library.activeId=entry.id;try{await persistPriceLabelTemplateState(size,entry.template,library,'promotion');}catch(error){showToast(error.message,'danger-top');}finally{if(isStoreViewCurrent(context))render();}
  };
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
