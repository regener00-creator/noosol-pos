function priceLabelClamp(value,min,max,fallback=min){
  const number=Number(value);
  return Math.min(max,Math.max(min,Number.isFinite(number)?number:fallback));
}

function priceLabelBarcodeMinimum(labelSize='80x50'){
  const [width,height]=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]||BARCODE_PRINT_LABEL_DIMENSIONS['80x50'];
  return {
    width:Math.min(100,24/width*100),
    height:Math.min(100,6/height*100),
    widthMm:24,
    heightMm:6,
    recommendedWidth:Math.min(100,32/width*100),
    recommendedHeight:Math.min(100,8/height*100),
    recommendedWidthMm:32,
    recommendedHeightMm:8,
  };
}

function priceLabelPresetTemplate(labelSize='80x50',preset='left'){
  const [width]=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]||BARCODE_PRINT_LABEL_DIMENSIONS['80x50'];
  const fontScale=width>=80?1:width>=60?.84:width>=50?.72:.64;
  const font=(value,min=5.5)=>Math.max(min,Math.round(value*fontScale*10)/10);
  const presets={
    left:{
      name:{x:3,y:4,width:61,height:18,fontSize:font(11,7),fontWeight:700,color:'#000000',align:'left',visible:true},
      unit:{x:3,y:24,width:61,height:8,fontSize:font(10,6.5),fontWeight:400,color:'#000000',align:'left',visible:true},
      price:{x:3,y:33,width:61,height:27,fontSize:font(29,16),fontWeight:800,color:'#e60012',align:'left',visible:true},
      barcode:{x:3,y:63,width:55,height:25,visible:true},
      code:{x:3,y:90,width:55,height:7,fontSize:font(8,5.5),fontWeight:400,color:'#000000',align:'left',visible:true},
    },
    full:{
      name:{x:4,y:4,width:92,height:19,fontSize:font(11,7),fontWeight:700,color:'#000000',align:'left',visible:true},
      unit:{x:4,y:25,width:25,height:9,fontSize:font(10,6.5),fontWeight:400,color:'#000000',align:'left',visible:true},
      price:{x:32,y:23,width:64,height:32,fontSize:font(29,16),fontWeight:800,color:'#e60012',align:'right',visible:true},
      barcode:{x:6,y:61,width:88,height:27,visible:true},
      code:{x:6,y:90,width:88,height:7,fontSize:font(8,5.5),fontWeight:400,color:'#000000',align:'center',visible:true},
    },
    center:{
      name:{x:4,y:4,width:92,height:19,fontSize:font(11,7),fontWeight:700,color:'#000000',align:'center',visible:true},
      unit:{x:4,y:24,width:92,height:8,fontSize:font(9,6.2),fontWeight:400,color:'#000000',align:'center',visible:true},
      price:{x:4,y:32,width:92,height:30,fontSize:font(29,16),fontWeight:800,color:'#e60012',align:'center',visible:true},
      barcode:{x:15,y:65,width:70,height:23,visible:true},
      code:{x:15,y:90,width:70,height:7,fontSize:font(8,5.5),fontWeight:400,color:'#000000',align:'center',visible:true},
    },
  };
  const selected=presets[preset]||presets.left;
  return normalizePriceLabelTemplate({version:1,preset:presets[preset]?preset:'left',elements:selected},labelSize,{skipFallback:true});
}

function normalizePriceLabelElement(key,value,labelSize,fallback){
  const base=fallback||{};
  const source=value&&typeof value==='object'?value:{};
  const barcodeMinimum=priceLabelBarcodeMinimum(labelSize);
  const minWidth=key==='barcode'?barcodeMinimum.width:5;
  const minHeight=key==='barcode'?barcodeMinimum.height:4;
  const width=priceLabelClamp(source.width,minWidth,100,base.width||minWidth);
  const height=priceLabelClamp(source.height,minHeight,100,base.height||minHeight);
  const element={
    x:priceLabelClamp(source.x,0,100-width,Math.min(base.x||0,100-width)),
    y:priceLabelClamp(source.y,0,100-height,Math.min(base.y||0,100-height)),
    width:Math.round(width*100)/100,
    height:Math.round(height*100)/100,
    visible:source.visible===undefined?base.visible!==false:Boolean(source.visible),
  };
  if(key!=='barcode'){
    element.fontSize=Math.round(priceLabelClamp(source.fontSize,4,120,base.fontSize||10)*10)/10;
    element.fontWeight=[400,500,600,700,800].includes(Number(source.fontWeight))?Number(source.fontWeight):(Number(base.fontWeight)||400);
    const requestedColor=String(source.color||'').toLowerCase();
    const fallbackColor=String(base.color||'#000000').toLowerCase();
    element.color=PRICE_LABEL_TEXT_COLORS.includes(requestedColor)?requestedColor:(PRICE_LABEL_TEXT_COLORS.includes(fallbackColor)?fallbackColor:'#000000');
    element.align=['left','center','right'].includes(source.align)?source.align:(base.align||'left');
    element.reverse=source.reverse===undefined?Boolean(base.reverse):Boolean(source.reverse);
  }
  return element;
}

function normalizePriceLabelCustomText(value,labelSize='80x50',index=0){
  const source=value&&typeof value==='object'?value:{};
  const [width]=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]||BARCODE_PRINT_LABEL_DIMENSIONS['80x50'];
  const fontSize=width>=80?11:width>=60?9:width>=50?7.5:6.5;
  const base={x:62,y:5,width:35,height:14,fontSize,fontWeight:600,color:'#000000',align:'center',reverse:false,visible:true};
  const element=normalizePriceLabelElement('custom',source,labelSize,base);
  const rawId=String(source.id||`text-${index+1}`).replace(/[^a-z0-9_-]/gi,'').slice(0,48)||`text-${index+1}`;
  return {...element,id:rawId,text:String(source.text||'พิมพ์ข้อความ').trim().slice(0,120)||'พิมพ์ข้อความ'};
}

function normalizePriceLabelTemplate(value,labelSize='80x50',options={}){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const source=value&&typeof value==='object'?value:{};
  let fallback;
  if(options.skipFallback){
    fallback=source.elements||{};
  }else{
    fallback=priceLabelPresetTemplate(validSize,'left').elements;
  }
  const sourceElements=source.elements&&typeof source.elements==='object'?source.elements:{};
  const elements={};
  Object.keys(PRICE_LABEL_ELEMENT_META).forEach(key=>{
    const base=fallback[key]||{};
    elements[key]=normalizePriceLabelElement(key,sourceElements[key],validSize,base);
  });
  const customTextIds=new Set();
  const customTexts=(Array.isArray(source.customTexts)?source.customTexts:[]).slice(0,20).map((entry,index)=>{
    const normalized=normalizePriceLabelCustomText(entry,validSize,index);
    if(customTextIds.has(normalized.id)) normalized.id=`${normalized.id}-${index+1}`;
    customTextIds.add(normalized.id);
    return normalized;
  });
  const preset=Object.prototype.hasOwnProperty.call(PRICE_LABEL_PRESET_LABELS,source.preset)?source.preset:'custom';
  return {version:2,size:validSize,preset,elements,customTexts};
}

function normalizePriceLabelTemplateLibrary(value,labelSize='80x50'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const source=value&&typeof value==='object'?value:{};
  const ids=new Set();
  const templates=(Array.isArray(source.templates)?source.templates:[]).slice(0,50).map((entry,index)=>{
    const rawId=String(entry?.id||`template-${index+1}`).replace(/[^a-z0-9_-]/gi,'').slice(0,64)||`template-${index+1}`;
    const id=ids.has(rawId)?`${rawId}-${index+1}`:rawId;
    ids.add(id);
    return {id,name:String(entry?.name||`แม่แบบ ${index+1}`).trim().replace(/\s+/g,' ').slice(0,60)||`แม่แบบ ${index+1}`,updatedAt:String(entry?.updatedAt||''),template:normalizePriceLabelTemplate(entry?.template,validSize)};
  });
  const activeId=templates.some(entry=>entry.id===source.activeId)?String(source.activeId):(templates[0]?.id||'');
  return {version:1,size:validSize,activeId,templates};
}

function priceLabelTemplateKeys(kind){
  return kind==='promotion'?['promotionLabelTemplates','promotionLabelTemplateLibraries']:['priceLabelTemplates','priceLabelTemplateLibraries'];
}
function getPriceLabelTemplateLibrary(labelSize='80x50',kind='price'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const settings=typeof businessSettings==='object'&&businessSettings?businessSettings:{};
  const key=priceLabelTemplateKeys(kind)[1];
  const libraries=settings[key]&&typeof settings[key]==='object'?settings[key]:{};
  return normalizePriceLabelTemplateLibrary(libraries[validSize],validSize);
}

function persistPriceLabelTemplateState(labelSize,template,library,kind='price'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const normalized=normalizePriceLabelTemplate(template,validSize);
  const normalizedLibrary=normalizePriceLabelTemplateLibrary(library,validSize);
  const [templateKey,libraryKey]=priceLabelTemplateKeys(kind);
  const previousTemplates=businessSettings?.[templateKey]&&typeof businessSettings[templateKey]==='object'?businessSettings[templateKey]:{};
  const previousLibraries=businessSettings?.[libraryKey]&&typeof businessSettings[libraryKey]==='object'?businessSettings[libraryKey]:{};
  businessSettings={...businessSettings,[templateKey]:{...previousTemplates,[validSize]:normalized},[libraryKey]:{...previousLibraries,[validSize]:normalizedLibrary}};
  if(typeof persistWorkspaceData==='function') persistWorkspaceData();
  if(typeof syncBusinessSettingsToSupabase==='function') priceLabelTemplateSyncPromise=priceLabelTemplateSyncPromise.then(()=>syncBusinessSettingsToSupabase(),()=>syncBusinessSettingsToSupabase());
  return {template:normalized,library:normalizedLibrary};
}

function getPriceLabelTemplate(labelSize='80x50',kind='price'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const settings=typeof businessSettings==='object'&&businessSettings?businessSettings:{};
  const library=getPriceLabelTemplateLibrary(validSize,kind);
  const active=library.templates.find(entry=>entry.id===library.activeId);
  if(active) return normalizePriceLabelTemplate(active.template,validSize);
  const key=priceLabelTemplateKeys(kind)[0];
  const saved=settings[key]&&typeof settings[key]==='object'?settings[key][validSize]:null;
  return saved?normalizePriceLabelTemplate(saved,validSize):kind==='promotion'?promotionLabelPreset(validSize):priceLabelPresetTemplate(validSize,'left');
}

function savePriceLabelTemplate(labelSize,template,kind='price'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const normalized=normalizePriceLabelTemplate(template,validSize);
  const library=getPriceLabelTemplateLibrary(validSize,kind);
  const activeIndex=library.templates.findIndex(entry=>entry.id===library.activeId);
  if(activeIndex>=0) library.templates[activeIndex]={...library.templates[activeIndex],updatedAt:new Date().toISOString(),template:normalized};
  return persistPriceLabelTemplateState(validSize,normalized,library,kind).template;
}

function saveNamedPriceLabelTemplate(labelSize,name,template,templateId='',options={}){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const normalizedName=String(name||'').trim().replace(/\s+/g,' ').slice(0,60);
  if(!normalizedName) return null;
  const kind=options.kind||'price';
  const library=getPriceLabelTemplateLibrary(validSize,kind);
  const normalizedId=String(templateId||'').replace(/[^a-z0-9_-]/gi,'').slice(0,64);
  const existingIndex=library.templates.findIndex(entry=>entry.id===normalizedId);
  const duplicate=library.templates.some((entry,index)=>index!==existingIndex&&entry.name.toLocaleLowerCase('th-TH')===normalizedName.toLocaleLowerCase('th-TH'));
  if(duplicate) return null;
  const id=existingIndex>=0?library.templates[existingIndex].id:`template-${Date.now().toString(36)}-${++priceLabelNamedTemplateCounter}`;
  const normalizedTemplate=normalizePriceLabelTemplate(template,validSize);
  const entry={id,name:normalizedName,updatedAt:new Date().toISOString(),template:normalizedTemplate};
  if(existingIndex>=0) library.templates[existingIndex]=entry;
  else library.templates.push(entry);
  const activate=options.activate!==false;
  if(activate) library.activeId=id;
  const activeTemplate=activate?normalizedTemplate:(library.templates.find(item=>item.id===library.activeId)?.template||getPriceLabelTemplate(validSize,kind));
  const saved=persistPriceLabelTemplateState(validSize,activeTemplate,library,kind);
  return saved.library.templates.find(item=>item.id===id)||entry;
}

function deleteNamedPriceLabelTemplate(labelSize,templateId,kind='price'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const library=getPriceLabelTemplateLibrary(validSize,kind);
  const deleting=library.templates.find(entry=>entry.id===templateId);
  if(!deleting) return null;
  library.templates=library.templates.filter(entry=>entry.id!==templateId);
  if(library.activeId===templateId) library.activeId=library.templates[0]?.id||'';
  const next=library.templates.find(entry=>entry.id===library.activeId);
  const activeTemplate=next?.template||(kind==='promotion'?promotionLabelPreset(validSize):priceLabelPresetTemplate(validSize,'left'));
  const saved=persistPriceLabelTemplateState(validSize,activeTemplate,library,kind);
  return {deleted:deleting,library:saved.library,template:saved.template};
}

function priceLabelPreviewScale(canvasWidthPx,labelWidthMm){
  const canvasWidth=Number(canvasWidthPx);
  const physicalWidthMm=Number(labelWidthMm);
  if(!Number.isFinite(canvasWidth)||canvasWidth<=0||!Number.isFinite(physicalWidthMm)||physicalWidthMm<=0) return 1;
  return canvasWidth/(physicalWidthMm*96/25.4);
}

function priceLabelElementStyle(element,key,renderScale=1){
  const scale=priceLabelClamp(renderScale,.1,20,1);
  const justify=element.align==='center'?'center':element.align==='right'?'flex-end':'flex-start';
  const reverseStyle=element.reverse?`background:${element.color};color:#ffffff;padding:0 ${Math.round(1.2*scale*1000)/1000}mm;border-radius:${Math.round(.7*scale*1000)/1000}mm;`:`background:transparent;color:${element.color};`;
  const wrapping=key==='custom'?'white-space:pre-wrap;overflow-wrap:anywhere;':'';
  const typography=key==='barcode'?'justify-content:flex-start;':`font-size:${Math.round(element.fontSize*scale*1000)/1000}pt;font-weight:${element.fontWeight};${reverseStyle}text-align:${element.align};justify-content:${justify};`;
  return `left:${element.x}%;top:${element.y}%;width:${element.width}%;height:${element.height}%;display:flex;align-items:center;box-sizing:border-box;${typography}${wrapping}`;
}

function priceLabelRegularHtml(item,product,option,labelSize='80x50'){
  const template=getPriceLabelTemplate(labelSize);
  const values={name:product?.name||'',unit:item?.unit||option?.name||'',price:fmtMoney(option?.price||0).replace(/\.00$/,''),code:item?.barcode||''};
  const elements=Object.entries(template.elements).map(([key,element])=>{
    if(!element.visible) return '';
    const content=key==='barcode'?code128BSvg(values.code,40):escapeHtml(values[key]||'');
    const className=key==='barcode'?'barcode':key==='code'?'code':key;
    return `<div class="price-label-print-element ${className}" data-price-label-element="${key}" style="position:absolute;overflow:hidden;line-height:1.08;${priceLabelElementStyle(element,key)}">${content}</div>`;
  }).join('');
  const customTexts=template.customTexts.map(element=>element.visible?`<div class="price-label-print-element custom-text" data-price-label-custom-text="${escapeHtml(element.id)}" style="position:absolute;overflow:hidden;line-height:1.08;${priceLabelElementStyle(element,'custom')}">${escapeHtml(element.text)}</div>`:'').join('');
  return `<section class="label" style="padding:0"><div class="regular-layout" style="position:relative;width:100%;height:100%;overflow:hidden">${elements}${customTexts}</div></section>`;
}

function priceLabelDesignerSample(){
  const item=barcodePrintItems[0];
  const product=item?products.find(entry=>entry.id===item.pid):null;
  const option=product?barcodePrintUnitOptions(product).find(entry=>entry.name===item.unit):null;
  return {
    name:product?.name||'Decolgen prin (4 tablets)',
    unit:item?.unit||option?.name||'กล่อง',
    price:fmtMoney(option?.price??180).replace(/\.00$/,''),
    code:item?.barcode||'P00000000000',
  };
}

function openPriceLabelDesigner(labelSize=barcodePrintLabelSize,options={}){
  const promotion=options.kind==='promotion',kind=promotion?'promotion':'price';
  if(labelSize==='a4-50x30')labelSize='50x30';
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const [widthMm,heightMm]=BARCODE_PRINT_LABEL_DIMENSIONS[validSize];
  const barcodeMinimum=priceLabelBarcodeMinimum(validSize);
  let library=getPriceLabelTemplateLibrary(validSize,kind);
  let selectedTemplateId=library.activeId;
  const activeNamedTemplate=library.templates.find(entry=>entry.id===selectedTemplateId);
  let draft=normalizePriceLabelTemplate(activeNamedTemplate?.template||getPriceLabelTemplate(validSize,kind),validSize);
  let selected=promotion&&draft.customTexts.length?`custom:${draft.customTexts[0].id}`:'name';
  const sample=priceLabelDesignerSample();
  document.querySelector('.price-label-designer-modal')?.closest('.modal-overlay')?.remove();
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal price-label-designer-modal"><div class="modal-head"><div><h3>${promotion?'ออกแบบป้ายโปรโมชั่น':'ออกแบบป้ายราคา'}</h3><div class="price-label-designer-head-meta">${promotion?'เขียนข้อความและจัดวางได้เอง บันทึกแม่แบบแยกสำหรับป้ายโปรโมชั่น':'บันทึกแม่แบบแยกตามขนาดป้าย และใช้กับป้ายราคาปกติทุกครั้งที่พิมพ์'}</div></div><button class="modal-close" type="button" aria-label="ปิด">×</button></div>
    <div class="price-label-template-library"><label>แม่แบบที่บันทึก<select id="savedPriceLabelTemplateSelect" aria-label="แม่แบบป้ายราคาที่บันทึก"></select></label><label>ชื่อแม่แบบ<input id="priceLabelTemplateNameInput" maxlength="60" placeholder="เช่น ป้ายราคาหน้าชั้น"></label><button class="btn ghost" id="saveAsNewPriceLabelTemplateBtn" type="button">บันทึกเป็นแม่แบบใหม่</button><button class="btn ghost price-label-delete-text-btn" id="deleteSavedPriceLabelTemplateBtn" type="button">ลบแม่แบบ</button></div>
    <div class="price-label-designer-toolbar"><label ${promotion?'hidden':''}>รูปแบบเริ่มต้น <select id="priceLabelPresetSelect">${Object.entries(PRICE_LABEL_PRESET_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><button class="btn ghost price-label-add-text-btn" id="addPriceLabelCustomTextBtn" type="button">+ เพิ่มข้อความ</button><span class="price-label-designer-size">${widthMm} × ${heightMm} มม. ${validSize==='a4-poster'?'แนวตั้ง':'แนวนอน'}</span></div>
    <div class="price-label-designer-body"><div class="price-label-canvas-pane"><p class="price-label-canvas-help">ลากเพื่อย้ายตำแหน่ง · ลากมุมขวาล่างเพื่อปรับขนาด · คลิกหัวข้อด้านขวาเพื่อแก้รายละเอียด</p><div class="price-label-canvas-shell"><div id="priceLabelDesignerCanvas" class="price-label-canvas" style="aspect-ratio:${widthMm}/${heightMm}"></div></div><div class="price-label-safety-note" ${promotion?'hidden':''}><span>⚠</span><span>บาร์โค้ดย่อได้ต่ำสุด ${barcodeMinimum.widthMm} × ${barcodeMinimum.heightMm} มม. แต่ขนาดที่แนะนำคืออย่างน้อย ${barcodeMinimum.recommendedWidthMm} × ${barcodeMinimum.recommendedHeightMm} มม. หากย่อกว่านี้ควรทดลองพิมพ์และสแกนก่อนใช้งานจำนวนมาก</span></div></div><aside id="priceLabelDesignerPanel" class="price-label-designer-panel"></aside></div>
    <div class="price-label-designer-actions"><button class="btn ghost" id="resetPriceLabelTemplateBtn" type="button">คืนค่าเริ่มต้น</button><div class="price-label-designer-actions-right"><button class="btn ghost" id="cancelPriceLabelDesignerBtn" type="button">ยกเลิก</button><button class="btn primary" id="savePriceLabelDesignerBtn" type="button">บันทึกและใช้แม่แบบนี้</button></div></div></div>`;
  document.body.appendChild(overlay);
  const canvas=overlay.querySelector('#priceLabelDesignerCanvas');
  const panel=overlay.querySelector('#priceLabelDesignerPanel');
  const presetSelect=overlay.querySelector('#priceLabelPresetSelect');
  const savedTemplateSelect=overlay.querySelector('#savedPriceLabelTemplateSelect');
  const templateNameInput=overlay.querySelector('#priceLabelTemplateNameInput');
  const deleteSavedTemplateButton=overlay.querySelector('#deleteSavedPriceLabelTemplateBtn');
  let previewResizeObserver=null;
  const currentPreviewScale=()=>priceLabelPreviewScale(canvas.getBoundingClientRect().width,widthMm);
  const customTarget=id=>`custom:${id}`;
  const targetInfo=target=>{
    if(String(target).startsWith('custom:')){
      const id=String(target).slice(7);
      const index=draft.customTexts.findIndex(entry=>entry.id===id);
      if(index>=0) return {target,kind:'custom',index,element:draft.customTexts[index],label:`ข้อความ ${index+1}`};
    }
    if(!promotion&&draft.elements[target]) return {target,kind:target,index:-1,element:draft.elements[target],label:PRICE_LABEL_ELEMENT_META[target].label};
    return null;
  };
  const setTargetElement=(target,element)=>{
    const info=targetInfo(target);
    if(!info) return;
    if(info.kind==='custom') draft.customTexts[info.index]=element;
    else draft.elements[info.kind]=element;
  };
  const editorTargets=()=>[
    ...(promotion?[]:Object.entries(PRICE_LABEL_ELEMENT_META).map(([target,meta])=>({target,kind:target,element:draft.elements[target],label:meta.label}))),
    ...draft.customTexts.map((element,index)=>({target:customTarget(element.id),kind:'custom',element,label:`ข้อความ ${index+1}`})),
  ];
  const normalizeTargetElement=(target,value,fallback)=>{
    const info=targetInfo(target);
    if(!info) return null;
    if(info.kind!=='custom') return normalizePriceLabelElement(info.kind,value,validSize,fallback);
    const normalized=normalizePriceLabelElement('custom',value,validSize,fallback);
    return {...normalized,id:info.element.id,text:info.element.text};
  };
  const elementMarkup=(target,kind,element)=>{
    if(!element.visible)return '';
    const value=kind==='barcode'?code128BSvg(sample.code,40):kind==='custom'?escapeHtml(element.text):escapeHtml(sample[kind]||'');
    return `<div class="price-label-design-element ${selected===target?'selected':''}" data-price-label-element="${escapeHtml(target)}" style="${priceLabelElementStyle(element,kind,currentPreviewScale())}">${value}<span class="price-label-resize-handle" aria-hidden="true"></span></div>`;
  };
  const controlMarkup=()=>{
    let info=targetInfo(selected);
    if(!info){selected=promotion&&draft.customTexts.length?customTarget(draft.customTexts[0].id):'name';info=targetInfo(selected);}
    if(!info)return '<p>กด “+ เพิ่มข้อความ” เพื่อเริ่มออกแบบป้าย</p>';
    const {element,kind}=info;
    const positionFields=[['x','ตำแหน่งซ้าย (%)'],['y','ตำแหน่งบน (%)'],['width','ความกว้าง (%)'],['height','ความสูง (%)']].map(([field,label])=>`<label class="price-label-control-field"><span>${label}</span><input type="number" min="0" max="100" step="0.5" data-price-label-field="${field}" value="${Math.round(element[field]*100)/100}"></label>`).join('');
    const customTextField=kind==='custom'?`<label class="price-label-control-field wide"><span>ข้อความ</span>${promotion?`<textarea rows="3" maxlength="120" data-price-label-custom-value>${escapeHtml(element.text)}</textarea>`:`<input maxlength="120" data-price-label-custom-value value="${escapeHtml(element.text)}" autocomplete="off">`}</label>`:'';
    const colors=PRICE_LABEL_TEXT_COLORS.map(color=>`<label class="price-label-color-choice"><input type="radio" name="priceLabelTextColor" data-price-label-color value="${color}" ${element.color===color?'checked':''}><span class="price-label-color-swatch" style="background:${color}"></span>${color==='#000000'?'ดำ':'แดง'}</label>`).join('');
    const barcodeBelowRecommended=kind==='barcode'&&(element.width<barcodeMinimum.recommendedWidth||element.height<barcodeMinimum.recommendedHeight);
    const typography=kind==='barcode'?`<div class="price-label-barcode-limit ${barcodeBelowRecommended?'warning':''}">ขนาดต่ำสุดสำหรับป้ายนี้: กว้าง ${barcodeMinimum.width.toFixed(1)}% · สูง ${barcodeMinimum.height.toFixed(1)}% (${barcodeMinimum.widthMm} × ${barcodeMinimum.heightMm} มม.)${barcodeBelowRecommended?`<br><strong>ขนาดปัจจุบันต่ำกว่าขนาดแนะนำ ${barcodeMinimum.recommendedWidthMm} × ${barcodeMinimum.recommendedHeightMm} มม. ควรทดลองสแกนก่อนใช้งาน</strong>`:''}</div>`:`${customTextField}<div class="price-label-control-section-title">ตัวอักษร</div><label class="price-label-control-field"><span>ขนาด (pt)</span><input type="number" min="4" max="120" step="0.5" data-price-label-field="fontSize" value="${element.fontSize}"></label><label class="price-label-control-field"><span>ความหนา</span><select data-price-label-field="fontWeight">${[[400,'ปกติ'],[500,'กลาง'],[600,'กึ่งหนา'],[700,'หนา'],[800,'หนามาก']].map(([value,label])=>`<option value="${value}" ${element.fontWeight===value?'selected':''}>${label}</option>`).join('')}</select></label><div class="price-label-control-field wide"><span>สี</span><div class="price-label-color-options">${colors}</div></div><label class="price-label-control-field wide price-label-reverse-toggle" title="พื้นหลังเป็นสีที่เลือก ตัวอักษรสีขาว"><input type="checkbox" data-price-label-reverse ${element.reverse?'checked':''}> REVERSE TYPE</label><label class="price-label-control-field wide"><span>จัดแนว</span><select data-price-label-field="align"><option value="left" ${element.align==='left'?'selected':''}>ชิดซ้าย</option><option value="center" ${element.align==='center'?'selected':''}>กึ่งกลาง</option><option value="right" ${element.align==='right'?'selected':''}>ชิดขวา</option></select></label>${kind==='custom'?'<div class="price-label-custom-text-actions"><button class="btn ghost price-label-delete-text-btn" id="deletePriceLabelCustomTextBtn" type="button">ลบข้อความนี้</button></div>':''}`;
    return `<p class="price-label-element-help">ติ๊กเพื่อแสดงบนป้าย · คลิกชื่อเพื่อแก้รายละเอียด</p><div class="price-label-element-tabs">${editorTargets().map(entry=>`<div class="price-label-element-choice"><input type="checkbox" data-price-label-toggle="${escapeHtml(entry.target)}" aria-label="แสดง${escapeHtml(entry.label)}บนป้าย" ${entry.element.visible?'checked':''}><button type="button" class="price-label-element-tab ${selected===entry.target?'active':''} ${entry.element.visible?'':'off'}" data-price-label-tab="${escapeHtml(entry.target)}">${escapeHtml(entry.label)}</button></div>`).join('')}</div><div class="price-label-control-card"><div class="price-label-control-head"><strong>${escapeHtml(info.label)}</strong><label class="price-label-visible-toggle"><input type="checkbox" data-price-label-visible ${element.visible?'checked':''}> แสดงบนป้าย</label></div><div class="price-label-control-grid"><div class="price-label-control-section-title" style="margin-top:0;padding-top:0;border-top:0">ตำแหน่งและขนาด</div>${positionFields}${typography}</div></div>`;
  };
  const updateNode=(node,element,key)=>{
    node.style.cssText=priceLabelElementStyle(element,key,currentPreviewScale());
  };
  const syncPreviewScale=()=>{
    canvas.querySelectorAll('[data-price-label-element]').forEach(node=>{
      const info=targetInfo(node.dataset.priceLabelElement);
      if(info) updateNode(node,info.element,info.kind);
    });
  };
  const attachCanvasInteractions=()=>{
    canvas.querySelectorAll('[data-price-label-element]').forEach(node=>{
      node.addEventListener('pointerdown',event=>{
        if(event.button!==undefined&&event.button!==0) return;
        const target=node.dataset.priceLabelElement;
        const info=targetInfo(target);
        if(!info) return;
        selected=target;
        canvas.querySelectorAll('[data-price-label-element]').forEach(entry=>entry.classList.toggle('selected',entry===node));
        const resizing=Boolean(event.target.closest('.price-label-resize-handle'));
        const rect=canvas.getBoundingClientRect();
        const startX=event.clientX,startY=event.clientY,start={...info.element};
        draft.preset='custom'; presetSelect.value='custom';
        node.setPointerCapture?.(event.pointerId);
        const move=moveEvent=>{
          const dx=(moveEvent.clientX-startX)/rect.width*100,dy=(moveEvent.clientY-startY)/rect.height*100;
          const next=resizing?{...start,width:start.width+dx,height:start.height+dy}:{...start,x:start.x+dx,y:start.y+dy};
          const normalized=normalizeTargetElement(target,next,start);
          setTargetElement(target,normalized);
          updateNode(node,normalized,info.kind);
        };
        const end=endEvent=>{
          node.releasePointerCapture?.(endEvent.pointerId);
          node.removeEventListener('pointermove',move); node.removeEventListener('pointerup',end); node.removeEventListener('pointercancel',end);
          renderEditor();
        };
        node.addEventListener('pointermove',move); node.addEventListener('pointerup',end); node.addEventListener('pointercancel',end);
        event.preventDefault();
      });
    });
  };
  const renderEditor=()=>{
    draft=normalizePriceLabelTemplate(draft,validSize);
    if(!targetInfo(selected)) selected='name';
    canvas.innerHTML=editorTargets().map(entry=>elementMarkup(entry.target,entry.kind,entry.element)).join('');
    syncPreviewScale();
    panel.innerHTML=controlMarkup();
    presetSelect.value=draft.preset;
    panel.querySelectorAll('[data-price-label-tab]').forEach(button=>button.addEventListener('click',()=>{ selected=button.dataset.priceLabelTab; renderEditor(); }));
    panel.querySelectorAll('[data-price-label-visible],[data-price-label-toggle]').forEach(input=>input.addEventListener('change',()=>{
      const target=input.dataset.priceLabelToggle||selected;
      const info=targetInfo(target);if(!info)return;
      setTargetElement(target,{...info.element,visible:input.checked});
      draft.preset='custom';renderEditor();
      const selector=input.hasAttribute('data-price-label-toggle')?`[data-price-label-toggle="${CSS.escape(target)}"]`:'[data-price-label-visible]';
      panel.querySelector(selector)?.focus({preventScroll:true});
    }));
    panel.querySelectorAll('[data-price-label-field]').forEach(input=>input.addEventListener('change',()=>{
      const field=input.dataset.priceLabelField;
      const info=targetInfo(selected); if(!info) return;
      const value=field==='align'?input.value:Number(input.value);
      setTargetElement(selected,normalizeTargetElement(selected,{...info.element,[field]:value},info.element));
      draft.preset='custom'; renderEditor();
    }));
    panel.querySelectorAll('[data-price-label-color]').forEach(input=>input.addEventListener('change',()=>{ const info=targetInfo(selected); if(!info) return; setTargetElement(selected,normalizeTargetElement(selected,{...info.element,color:input.value},info.element)); draft.preset='custom'; renderEditor(); }));
    panel.querySelector('[data-price-label-reverse]')?.addEventListener('change',event=>{ const info=targetInfo(selected); if(!info) return; setTargetElement(selected,normalizeTargetElement(selected,{...info.element,reverse:event.target.checked},info.element)); draft.preset='custom'; renderEditor(); });
    panel.querySelector('[data-price-label-custom-value]')?.addEventListener('change',event=>{ const info=targetInfo(selected); if(!info||info.kind!=='custom') return; const text=String(event.target.value||'').trim().slice(0,120)||'พิมพ์ข้อความ'; draft.customTexts[info.index]={...info.element,text}; draft.preset='custom'; renderEditor(); });
    panel.querySelector('#deletePriceLabelCustomTextBtn')?.addEventListener('click',()=>{ const info=targetInfo(selected); if(!info||info.kind!=='custom') return; draft.customTexts.splice(info.index,1); selected='name'; draft.preset='custom'; renderEditor(); });
    attachCanvasInteractions();
  };
  const refreshLibraryControls=()=>{
    if(!library.templates.some(entry=>entry.id===selectedTemplateId)) selectedTemplateId=library.activeId||library.templates[0]?.id||'';
    savedTemplateSelect.innerHTML=library.templates.length?library.templates.map(entry=>`<option value="${escapeHtml(entry.id)}" ${entry.id===selectedTemplateId?'selected':''}>${escapeHtml(entry.name)}${entry.id===library.activeId?' · กำลังใช้งาน':''}</option>`).join(''):'<option value="">ยังไม่มีแม่แบบที่บันทึก</option>';
    savedTemplateSelect.disabled=!library.templates.length;
    deleteSavedTemplateButton.disabled=!selectedTemplateId;
    const selectedEntry=library.templates.find(entry=>entry.id===selectedTemplateId);
    templateNameInput.value=selectedEntry?.name||'';
  };
  const close=()=>{ previewResizeObserver?.disconnect(); overlay.remove(); options.onClose?.(); };
  overlay.querySelector('.modal-close').addEventListener('click',close);
  overlay.querySelector('#cancelPriceLabelDesignerBtn').addEventListener('click',close);
  overlay.addEventListener('click',event=>{ if(event.target===overlay) close(); });
  presetSelect.addEventListener('change',()=>{
    if(presetSelect.value==='custom') return;
    const customTexts=draft.customTexts;
    draft=priceLabelPresetTemplate(validSize,presetSelect.value); draft.customTexts=customTexts; selected='name'; renderEditor();
  });
  savedTemplateSelect.addEventListener('change',()=>{
    const entry=library.templates.find(item=>item.id===savedTemplateSelect.value);
    if(!entry) return;
    selectedTemplateId=entry.id; templateNameInput.value=entry.name; draft=normalizePriceLabelTemplate(entry.template,validSize); selected='name'; renderEditor();
  });
  overlay.querySelector('#saveAsNewPriceLabelTemplateBtn').addEventListener('click',()=>{
    const name=templateNameInput.value.trim();
    if(!name){ showToast('กรุณาตั้งชื่อแม่แบบก่อนบันทึก'); templateNameInput.focus(); return; }
    const entry=saveNamedPriceLabelTemplate(validSize,name,draft,'',{activate:false,kind});
    if(!entry){ showToast('ชื่อแม่แบบนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น'); templateNameInput.focus(); return; }
    library=getPriceLabelTemplateLibrary(validSize,kind); selectedTemplateId=entry.id; draft=normalizePriceLabelTemplate(entry.template,validSize); refreshLibraryControls(); showToast(`บันทึกแม่แบบ “${entry.name}” แล้ว`);
  });
  deleteSavedTemplateButton.addEventListener('click',()=>{
    const entry=library.templates.find(item=>item.id===selectedTemplateId);
    if(!entry||!confirm(`ลบแม่แบบ “${entry.name}” ใช่หรือไม่?`)) return;
    const result=deleteNamedPriceLabelTemplate(validSize,entry.id,kind);
    if(!result) return;
    library=result.library; selectedTemplateId=library.activeId; draft=normalizePriceLabelTemplate(result.template,validSize); selected='name'; refreshLibraryControls(); renderEditor(); showToast(`ลบแม่แบบ “${entry.name}” แล้ว`);
  });
  overlay.querySelector('#addPriceLabelCustomTextBtn').addEventListener('click',()=>{
    if(draft.customTexts.length>=20){ showToast('เพิ่มข้อความได้สูงสุด 20 กล่องต่อแม่แบบ'); return; }
    const id=`text-${Date.now().toString(36)}-${++priceLabelCustomTextCounter}`;
    const offset=draft.customTexts.length%5;
    const element=normalizePriceLabelCustomText({id,text:'พิมพ์ข้อความ',x:promotion?5:62,y:5+offset*16,width:promotion?90:35},validSize,draft.customTexts.length);
    draft.customTexts.push(element); selected=customTarget(id); draft.preset='custom'; renderEditor();
    setTimeout(()=>{ const input=panel.querySelector('[data-price-label-custom-value]'); input?.focus(); input?.select(); },0);
  });
  overlay.querySelector('#resetPriceLabelTemplateBtn').addEventListener('click',()=>{
    if(!confirm(`คืนแม่แบบป้าย ${widthMm} × ${heightMm} มม. เป็นค่าเริ่มต้นใช่หรือไม่?`)) return;
    draft=promotion?promotionLabelPreset(validSize):priceLabelPresetTemplate(validSize,'left'); selected=promotion?customTarget(draft.customTexts[0].id):'name'; renderEditor();
  });
  overlay.querySelector('#savePriceLabelDesignerBtn').addEventListener('click',()=>{
    const name=templateNameInput.value.trim();
    let savedName='';
    if(selectedTemplateId){
      const entry=saveNamedPriceLabelTemplate(validSize,name,draft,selectedTemplateId,{kind});
      if(!entry){ showToast(name?'ชื่อแม่แบบนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น':'กรุณาตั้งชื่อแม่แบบก่อนบันทึก'); templateNameInput.focus(); return; }
      savedName=entry.name;
    }else if(name){
      const entry=saveNamedPriceLabelTemplate(validSize,name,draft,'',{kind});
      if(!entry){ showToast('ชื่อแม่แบบนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น'); templateNameInput.focus(); return; }
      savedName=entry.name;
    }else savePriceLabelTemplate(validSize,draft,kind);
    close(); showToast(savedName?`บันทึกและใช้แม่แบบ “${savedName}” แล้ว`:`บันทึกแม่แบบป้ายราคา ${widthMm} × ${heightMm} มม. แล้ว`);
  });
  if(typeof ResizeObserver==='function'){
    previewResizeObserver=new ResizeObserver(()=>syncPreviewScale());
    previewResizeObserver.observe(canvas);
  }
  refreshLibraryControls();
  renderEditor();
}

function barcodePrintRowsHtml(entries=barcodePrintPagination().rows){
  if(!barcodePrintItems.length) return '<tr><td colspan="7" class="barcode-print-empty">ยังไม่มีรายการ — ค้นหาสินค้า หรือเลือกสินค้าจากด้านบน</td></tr>';
  return entries.map(({item,index})=>{
    const product=products.find(entry=>entry.id===item.pid);
    if(!product) return '';
    const options=barcodePrintSelectableUnitOptions(product);
    const selected=options.find(option=>option.name===item.unit);
    if(!selected) return '';
    const unitSelect=options.length===1
      ?`<span class="barcode-print-unit-label">${escapeHtml(selected.name)}</span>`
      :`<select class="barcode-print-unit-select" data-barcode-print-unit="${index}">${options.map(option=>`<option value="${escapeHtml(option.name)}" ${option.name===selected.name?'selected':''}>${escapeHtml(option.name)}</option>`).join('')}</select>`;
    return `<tr data-barcode-print-row="${index}">
      <td class="mono" style="text-align:center;">${escapeHtml(product.sku||'-')}</td>
      <td>${escapeHtml(product.name)}${selected.barcode?'':`<br><span class="barcode-print-missing">หน่วยนี้ยังไม่มีบาร์โค้ด</span>`}</td>
      <td style="text-align:center;">${unitSelect}</td>
      <td><input class="barcode-print-code-input" data-barcode-print-code="${index}" ${barcodePrintMode==='reprint'?'readonly':''} value="${escapeHtml(item.barcode)}" placeholder="ออกเลขอัตโนมัติเมื่อพิมพ์" maxlength="48" autocomplete="off" aria-label="บาร์โค้ด ${escapeHtml(product.name)}"></td>
      <td class="mono" style="text-align:center;">${fmtMoney(selected.price)}</td>
      <td style="text-align:center;"><input type="number" min="1" max="500" step="1" class="barcode-print-qty-input" data-barcode-print-qty="${index}" value="${Number(item.qty)||1}" aria-label="จำนวนฉลาก ${escapeHtml(product.name)}"></td>
      <td style="text-align:center;"><button class="barcode-print-remove" data-barcode-print-remove="${index}" title="ลบ ${escapeHtml(product.name)} ออกจากรายการ" aria-label="ลบ ${escapeHtml(product.name)} ออกจากรายการ"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></td>
    </tr>`;
  }).join('');
}

function renderBarcodePrint(){
  if(barcodePrintShowMenu) return `<section class="rpt barcode-print-menu"><div class="pagehead"><h1>พิมพ์ป้ายราคา</h1></div>
    <div class="barcode-print-mode-grid">
      <button type="button" class="barcode-print-mode-card" data-barcode-print-mode="new"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 3h10l6 6v12H4zM14 3v6h6M8 15h8M12 11v8"/></svg><strong>พิมพ์ป้ายราคาใหม่</strong><span>เลือกสินค้าและหน่วยที่ยังไม่มีบาร์โค้ด</span></button>
      <button type="button" class="barcode-print-mode-card" data-barcode-print-mode="reprint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 14h10v7H7zM17 11h1"/></svg><strong>พิมพ์ป้ายราคาซ้ำ</strong><span>เลือกเฉพาะบาร์โค้ดที่ระบบเคยจ่ายให้</span></button>
      <button type="button" class="barcode-print-mode-card" data-barcode-print-mode="promotion"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 4h18v16H3zM7 8h10M7 12h10M7 16h6"/></svg><strong>ป้ายโปรโมชั่น</strong><span>สร้างข้อความเองได้ ไม่ต้องเลือกสินค้า</span></button>
    </div></section>`;
  if(promotionPrintActive)return renderPromotionLabelPrint();
  if(barcodePrintMode==='reprint'&&(!barcodeIssuedState?.ready||!isWorkspaceReadCurrent(barcodeIssuedState.context))) return `<section class="rpt"><div class="pagehead"><h1>พิมพ์ป้ายราคาซ้ำ</h1><button class="btn ghost" id="barcodePrintMenuBtn">ย้อนกลับ</button></div><p role="status">${barcodeIssuedState?.loading?'กำลังตรวจประวัติการจ่ายบาร์โค้ด…':escapeHtml(barcodeIssuedState?.error||'กรุณาโหลดประวัติการจ่ายบาร์โค้ด')}</p>${barcodeIssuedState?.loading?'':'<button class="btn primary" id="barcodeIssuedRetryBtn">ลองใหม่</button>'}</section>`;
  reconcileBarcodePrintItems();
  const defaultSize=typeof readPriceLabelDefaultSize==='function'?readPriceLabelDefaultSize(barcodePrintMode):'50x30';
  const filter=barcodePrintCatFilter;
  const available=barcodePrintAvailableProducts();
  const brandOptions=brands.filter(brand=>available.some(product=>(!filter.category||product.category===filter.category)&&product.brand===brand));
  const filteredCount=available.filter(product=>(!filter.category||product.category===filter.category)&&(!filter.brand||product.brand===filter.brand)).length;
  const missingCount=available.length;
  const reprint=barcodePrintMode==='reprint';
  const pagination=barcodePrintPagination();
  barcodePrintPage=pagination.currentPage;
  return `<div class="rpt barcode-print-page">
    <div class="pagehead"><div><h1>${reprint?'พิมพ์ป้ายราคาซ้ำ':'พิมพ์ป้ายราคาใหม่'} <span class="page-title-meta">ค่าเริ่มต้น: ${defaultSize==='a4-50x30'?'A4 · 50 × 30 มม. · 36 ป้าย/แผ่น':defaultSize.replace('x',' × ')+' มม. แนวนอน'} ${reprint?'เลือกเฉพาะบาร์โค้ดที่ระบบเคยจ่ายให้ ใช้เลขเดิม ไม่ออกเลขใหม่':'หากสินค้ายังไม่มีบาร์โค้ด ระบบจะสร้าง Code 128 ภายในและบันทึกให้กับหน่วยที่เลือกเมื่อสั่งพิมพ์'}</span></h1></div><div class="barcode-print-actions form-final-actions"><button class="btn ghost" id="barcodePrintMenuBtn">ย้อนกลับ</button><button class="btn ghost" id="openPriceLabelDesignerBtn">ออกแบบป้ายราคา</button><button class="btn ghost" id="clearBarcodePrintBtn" ${barcodePrintItems.length?'':'disabled'}>ล้างรายการ</button><button class="btn primary" id="savePrintBarcodeBtn" ${barcodePrintItems.length?'':'disabled'}>${reprint?'พิมพ์ป้ายเดิมซ้ำ':'บันทึกและพิมพ์ป้ายราคา'} (${barcodePrintItems.length})</button></div></div>
    <div class="rpt-filters" style="margin-bottom:14px;">
      <div class="rpf-item"><select id="barcodePrintCategorySelect" class="rpt-select"><option value="">หมวดสินค้าหลัก: ทั้งหมด</option>${categories.map(category=>`<option value="${escapeHtml(category)}" ${filter.category===category?'selected':''}>${escapeHtml(category)}</option>`).join('')}</select></div>
      <div class="rpf-item"><select id="barcodePrintBrandSelect" class="rpt-select"><option value="">หมวดสินค้าย่อย: ทั้งหมด</option>${brandOptions.map(brand=>`<option value="${escapeHtml(brand)}" ${filter.brand===brand?'selected':''}>${escapeHtml(brand)}</option>`).join('')}</select></div>
      <button class="btn ghost" id="barcodePrintAddCategoryBtn" ${(filter.category||filter.brand)?'':'disabled'}>เลือกสินค้าในหมวดนี้${(filter.category||filter.brand)?` (${filteredCount})`:''}</button>
    <div class="barcode-print-search-wrap">
      <input id="barcodePrintSearch" class="barcode-print-search" value="${escapeHtml(barcodePrintSearchQuery)}" placeholder="ค้นหาจาก ชื่อ / รหัส / บาร์โค้ด..." autocomplete="off">
      <div id="barcodePrintResults" class="fav-add-results" hidden style="left:0;right:0;top:calc(100% - 6px);"></div>
    </div>
      <button type="button" class="btn ghost barcode-print-settings" id="openPriceLabelSettingsBtn" title="ตั้งค่าขนาดป้ายเริ่มต้น" aria-label="ตั้งค่าขนาดป้ายเริ่มต้น"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 3-.6 2.4-1.5.9-2.4-.7-3 5.2L3.3 12l-.1 1.7-1.7 1.6 3 5.2 2.4-.7 1.5.9L9 23h6l.6-2.3 1.5-.9 2.4.7 3-5.2-1.7-1.6-.1-1.7 1.8-1.2-3-5.2-2.4.7-1.5-.9L15 3z" transform="translate(1 0) scale(.9)"/><circle cx="12" cy="12" r="3"/></svg></button>
      ${reprint?'':`<button class="btn ghost" id="barcodePrintAddMissingBtn">สินค้าที่ต้องสร้างบาร์โค้ด (${missingCount})</button>`}
    </div>
    <div class="barcode-print-table-wrap seamless-table-wrap">
      <table class="grid-table doc-head-blue barcode-print-table"><colgroup><col class="barcode-print-col-sku"><col class="barcode-print-col-name"><col class="barcode-print-col-unit"><col class="barcode-print-col-code"><col class="barcode-print-col-price"><col class="barcode-print-col-qty"><col class="barcode-print-col-action"></colgroup>
        <thead><tr><th>รหัสสินค้า</th><th>สินค้า</th><th>หน่วย</th><th>บาร์โค้ด</th><th>ราคา</th><th>จำนวนฉลาก</th><th aria-label="จัดการ"></th></tr></thead>
        <tbody>${barcodePrintRowsHtml(pagination.rows)}</tbody>
      </table>
    </div>
    ${pagerHtml(barcodePrintPage,pagination.totalPages,'barcode-print-page')}
  </div>`;
}

function openPriceLabelSettings(){
  if(document.getElementById('priceLabelSettingsDialog'))return;
  const mode=barcodePrintMode;
  const context=captureWorkspaceRead();
  const sizes=[['a4-50x30','A4 · 50 × 30 มม. · 36 ป้าย/แผ่น'],['50x30','ป้ายราคา 50 × 30 มม.'],['80x50','ป้ายราคา 80 × 50 มม.'],['60x40','ป้ายราคา 60 × 40 มม.'],['40x30','ป้ายราคา 40 × 30 มม.']];
  const defaultSize=readPriceLabelDefaultSize(mode);
  const trigger=document.getElementById('openPriceLabelSettingsBtn');
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal price-label-settings-modal" id="priceLabelSettingsDialog" role="dialog" aria-modal="true" aria-labelledby="priceLabelSettingsTitle"><div class="modal-head"><h3 id="priceLabelSettingsTitle">ตั้งค่าขนาดป้ายเริ่มต้น</h3><button type="button" class="modal-close" aria-label="ปิด">×</button></div><div class="price-label-size-options">${sizes.map(([value,label])=>`<label><input type="radio" name="priceLabelPaperSize" value="${value}" ${barcodePrintLabelSize===value?'checked':''}><span>${label}${defaultSize===value?' (ค่าเริ่มต้น)':''}</span></label>`).join('')}</div><div class="price-label-settings-actions"><button type="button" class="btn ghost" id="cancelPriceLabelSettingsBtn">ยกเลิก</button><button type="button" class="btn primary" id="savePriceLabelDefaultBtn">บันทึกค่าเริ่มต้น</button></div></div>`;
  const close=()=>{overlay.remove();trigger?.focus();};
  overlay.querySelector('.modal-close').addEventListener('click',close);
  overlay.querySelector('#cancelPriceLabelSettingsBtn').addEventListener('click',close);
  overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
  overlay.querySelector('#savePriceLabelDefaultBtn').addEventListener('click',()=>{
    if(!isWorkspaceReadCurrent(context)||barcodePrintMode!==mode){close();return;}
    const size=overlay.querySelector('input[name="priceLabelPaperSize"]:checked')?.value;
    if(!sizes.some(([value])=>value===size))return;
    try{
      savePriceLabelDefaultSize(size,mode);
      barcodePrintLabelSize=size;
      close();render();document.getElementById('openPriceLabelSettingsBtn')?.focus();
      showToast(`ตั้งเป็นค่าเริ่มต้นสำหรับ${mode==='reprint'?'พิมพ์ป้ายราคาซ้ำ':'พิมพ์ป้ายราคาใหม่'}บนเครื่องนี้แล้ว`);
    }catch{showToast('บันทึกค่าเริ่มต้นไม่สำเร็จ กรุณาตรวจพื้นที่เบราว์เซอร์','error');}
  });
  document.body.appendChild(overlay);
  overlay.querySelector('input:checked')?.focus();
}

function openBarcodeReprintDialog(){
  setBarcodePrintMode('reprint');
}

function printBarcodeReprintItems(){
  let printWindow;
  try{
    if(!barcodeReprintContext||!isWorkspaceReadCurrent(barcodeReprintContext)) throw new Error('ข้อมูลผู้ใช้เปลี่ยน กรุณาเปิดหน้าพิมพ์ซ้ำอีกครั้ง');
    if(!barcodePrintItems.length) throw new Error('กรุณาเลือกสินค้าก่อนพิมพ์');
    const items=barcodePrintItems.map(item=>barcodeReprintItem(item.pid,item.unit,item.qty));
    if(items.some((item,index)=>item.barcode!==barcodePrintItems[index].barcode)){
      barcodePrintItems=items;
      render();
      throw new Error('บาร์โค้ดสินค้ามีการเปลี่ยนแปลง กรุณาตรวจเลขก่อนกดพิมพ์อีกครั้ง');
    }
    printWindow=window.open('','_blank');
    if(!printWindow) throw new Error('เบราว์เซอร์บล็อกหน้าพิมพ์ กรุณาอนุญาต Pop-up แล้วลองใหม่');
    writeBarcodePrintWindow(printWindow,items,barcodePrintLabelSize,{trackPrint:false});
    showToast('เตรียมพิมพ์บาร์โค้ดเดิมแล้ว');
  }catch(error){
    if(printWindow&&!printWindow.closed) printWindow.close();
    showToast(error?.message||'เปิดหน้าพิมพ์ไม่สำเร็จ','error');
  }
}

function writeBarcodePrintWindow(printWindow,items=barcodePrintItems,labelSize=barcodePrintLabelSize,{trackPrint=true,promotionTemplate=null,promotionQuantity=0}={}){
  if(!printWindow) return false;
  const a4=labelSize==='a4-50x30';
  const fullA4=labelSize==='a4-poster';
  if(a4)labelSize='50x30';
  const [width,height]=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]||BARCODE_PRINT_LABEL_DIMENSIONS['80x50'];
  const labels=[];
  if(promotionTemplate){
    if(!Number.isInteger(promotionQuantity)||promotionQuantity<1||promotionQuantity>500)throw new Error('จำนวนป้ายต้องเป็นจำนวนเต็ม 1–500');
    const markup=promotionLabelHtml(promotionTemplate,labelSize);
    for(let index=0;index<promotionQuantity;index++)labels.push(markup);
  }
  (promotionTemplate?[]:items).forEach(item=>{
    const product=products.find(entry=>entry.id===item.pid);
    const option=barcodePrintUnitOptions(product).find(entry=>entry.name===item.unit);
    if(!product||!option) return;
    const regularLabel=priceLabelRegularHtml(item,product,option,labelSize);
    for(let count=0;count<Number(item.qty);count++) labels.push(regularLabel);
  });
  const fontBase=typeof location==='undefined'?'':location.origin;
  const printFontStyle=`<style>@font-face{font-family:'Google Sans';src:url('${fontBase}/fonts/google-sans-variable-v2.woff2') format('woff2');font-style:normal;font-weight:400 700}@font-face{font-family:'Google Sans';src:url('${fontBase}/fonts/google-sans-italic-variable-v2.woff2') format('woff2');font-style:italic;font-weight:400 700}body,.toolbar button,.label{font-family:'Google Sans','Noto Sans Thai',Tahoma,sans-serif}</style>`;
  let content=labels.join(''),sheetStyle='';
  if(a4){
    const sheets=[];
    for(let offset=0;offset<labels.length;offset+=36){
      const cells=Array.from({length:36},(_,index)=>`<div class="label-cut-cell">${labels[offset+index]||''}</div>`).join('');
      sheets.push(`<section class="label-sheet">${cells}</section>`);
    }
    content='<p class="label-print-help">A4 แนวตั้ง · 4 ช่อง × 9 แถว · ป้าย 50 × 30 มม. · พิมพ์ขนาดจริง 100% แล้วตัดตามเส้น</p>'+sheets.join('');
    sheetStyle=`.label-sheet{display:grid;grid-template-columns:repeat(4,50mm);grid-template-rows:repeat(9,30mm);width:210mm;height:297mm;padding:13.5mm 5mm;margin:10px auto;background:#fff;break-inside:avoid;page-break-after:always;break-after:page}.label-sheet:last-child{page-break-after:auto;break-after:auto}.label-cut-cell{position:relative;width:50mm;height:30mm}.label-cut-cell::after{content:"";position:absolute;inset:0;border:.1mm solid #aaa;pointer-events:none}.label-sheet .label{margin:0;page-break-after:auto;break-after:auto}.label-print-help{margin:12px;text-align:center;font-size:13px}@media print{.label-sheet{margin:0}.label-print-help{display:none}}`;
  }
  const pageSize=a4||fullA4?'A4 portrait':`${width}mm ${height}mm`;

  printWindow.document.open();
  printWindow.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>พิมพ์${promotionTemplate?'ป้ายโปรโมชั่น':'ป้ายราคา'} ${labels.length} ดวง</title><style>@page{size:${pageSize};margin:0}*{box-sizing:border-box}body{margin:0;background:#e9edf0;color:#111;font-family:'Noto Sans Thai',Tahoma,sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#fff;box-shadow:0 2px 8px #0002;font-size:13px}.toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:8px 16px;font:600 13px 'Noto Sans Thai',Tahoma,sans-serif;cursor:pointer}.label{width:${width}mm;height:${height}mm;margin:10px auto;padding:0;background:#fff;overflow:hidden;page-break-after:always;break-after:page}.label:last-child{page-break-after:auto;break-after:auto}.barcode-label-svg{display:block;width:100%;height:100%}.price-label-print-element{-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{body{background:#fff}.toolbar{display:none}.label{margin:0;box-shadow:none}}${sheetStyle}</style>${printFontStyle}</head><body><div class="toolbar"><span>${promotionTemplate?'ป้ายโปรโมชั่น':'ป้ายราคา'} ${width} × ${height} มม. ${fullA4?'แนวตั้ง':'แนวนอน'} · ทั้งหมด ${labels.length} ดวง</span><button onclick="window.print()">พิมพ์</button></div>${content}</body></html>`);
  printWindow.document.close();
  const preparePreview=async()=>{
    if(printWindow.closed) return;
    // Reuse the app's loaded font faces so document.write popups can render
    // immediately even when Chromium stalls their separate font requests.
    if(document.fonts?.load&&printWindow.document.fonts?.add){
      try{
        await document.fonts.load('16px "Google Sans"');
        if(printWindow.closed)return;
        const faces=[...document.fonts].filter(face=>face.family.replace(/["']/g,'')==='Google Sans'&&face.status==='loaded');
        if(faces.length){
          for(const sheet of printWindow.document.styleSheets){
            for(let index=sheet.cssRules.length-1;index>=0;index--){
              const rule=sheet.cssRules[index];
              if(rule.type===5&&rule.style.fontFamily.replace(/["']/g,'')==='Google Sans')sheet.deleteRule(index);
            }
          }
          [...printWindow.document.fonts].filter(face=>face.family.replace(/["']/g,'')==='Google Sans').forEach(face=>printWindow.document.fonts.delete(face));
          faces.forEach(face=>printWindow.document.fonts.add(face));
        }
      }catch(error){console.warn('price label font load',error);}
    }
    if(typeof standardizePrintPreview==='function') standardizePrintPreview(printWindow,{trackPrint,applyPaperSettings:!a4&&!fullA4});
    const printNow=()=>{ try{ if(!printWindow.closed){printWindow.focus(); printWindow.print();} }catch(error){} };
    if(printWindow.document.fonts?.ready?.then) printWindow.document.fonts.ready.then(printNow).catch(()=>setTimeout(printNow,450));
    else setTimeout(printNow,450);
  };
  // All label markup and font rules are written synchronously before this call.
  void preparePreview();
  return true;
}

async function saveBarcodePrintItems(printWindow){
  if(barcodePrintSavePending){ if(printWindow&&!printWindow.closed) printWindow.close(); return false; }
  const errors=barcodePrintIsRetry()?[]:barcodePrintValidation(barcodePrintItems);
  document.querySelectorAll('.barcode-print-code-input').forEach(input=>input.classList.remove('invalid'));
  if(errors.length){
    errors.forEach(error=>document.querySelector(`[data-barcode-print-code="${error.index}"]`)?.classList.add('invalid'));
    if(printWindow&&!printWindow.closed) printWindow.close();
    alert(`ยังไม่สามารถบันทึกและพิมพ์ได้\n\n${errors.slice(0,8).map(error=>error.message).join('\n')}${errors.length>8?`\nและอีก ${errors.length-8} จุด`:''}`);
    return false;
  }
  const snapshot=barcodePrintRequestPayload();
  const context=captureWorkspaceRead();
  const before=new Map(snapshot.map(item=>{
    const product=products.find(product=>product.id===item.pid);
    return [item.pid,product?JSON.stringify(productMetadataToRow(product)):''];
  }));
  const labelSize=barcodePrintLabelSize;
  barcodePrintSavePending=true;
  try{
    if(!navigator.onLine) throw new Error('กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนออกเลขบาร์โค้ดและพิมพ์');
    if(snapshot.some(item=>productDirtyOperations.has(String(item.pid)))) throw new Error('สินค้ามีข้อมูลรอซิงก์ กรุณารอให้ซิงก์เสร็จก่อนพิมพ์');
    if(!barcodePrintIsRetry()) barcodePrintRequest={actor:currentProfile.id,key:JSON.stringify(snapshot),id:crypto.randomUUID()};
    const {data,error}=await sb.rpc('assign_price_label_barcodes',{p_request_id:barcodePrintRequest.id,p_items:snapshot});
    if(error) throw error;
    if(!isWorkspaceReadCurrent(context)) throw new Error('บัญชีผู้ใช้งานเปลี่ยน กรุณาโหลดข้อมูลล่าสุด');
    if(!Array.isArray(data?.items)||!Array.isArray(data?.products)||data.items.length!==snapshot.length) throw new Error('รับผลบันทึกบาร์โค้ดไม่ครบ กรุณาลองใหม่');
    data.items.forEach((item,index)=>{
      const requested=snapshot[index];
      if(item.pid!==requested.pid||item.unit!==requested.unit||item.qty!==requested.qty||
        (requested.barcode?item.barcode!==requested.barcode:!/^P\d{11}$/.test(item.barcode))) throw new Error('ผลการออกเลขบาร์โค้ดไม่ตรงกับรายการ กรุณาลองใหม่');
    });
    for(const row of data.products){
      const local=products.find(product=>product.id===row.id);
      if(!local||!before.has(row.id)) continue;
      const saved=rowToProduct(row);
      if(Number(local._revision)>Number(saved._revision)) continue;
      if(!productDirtyOperations.has(String(row.id))&&JSON.stringify(productMetadataToRow(local))===before.get(row.id)){
        Object.assign(local,saved,{stock:local.stock,expiry:local.expiry});
      }else{
        // Preserve edits made while the request was in flight, acknowledging
        // only the server-assigned barcode and the new revision.
        for(const item of data.items.filter(item=>item.pid===row.id)){
          const target=local.unit===item.unit?local:(local.units||[]).find(unit=>unit.sub===item.unit);
          if(target) target.barcode=item.barcode;
        }
        local._revision=saved._revision;
      }
      (syncedTableRows.products||=new Map()).set(String(row.id),JSON.stringify(productMetadataToRow(saved)));
    }
    if(typeof invalidateProductIssuedBarcodeHistory==='function')invalidateProductIssuedBarcodeHistory();
    rebuildProductLookupMaps();
    const cached=await persistProductChangesToIndexedDB({updatedIds:data.products.map(row=>row.id)});
    if(!isWorkspaceReadCurrent(context)) throw new Error('บัญชีผู้ใช้งานเปลี่ยน กรุณาโหลดข้อมูลล่าสุด');
    // Codes are already committed centrally. A local cache failure must never
    // undo them or return their numbers to the generator.
    writeBarcodePrintWindow(printWindow,data.items,labelSize);
    barcodePrintRequest=null;
    showToast(cached?`เตรียมพิมพ์ป้ายราคา ${data.items.reduce((sum,item)=>sum+Number(item.qty),0)} ดวงแล้ว`:'บันทึกบาร์โค้ดส่วนกลางแล้ว แต่เก็บสำเนาในเครื่องไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุด');
    return true;
  }catch(error){
    if(printWindow&&!printWindow.closed) printWindow.close();
    showToast(error?.message||'ยังยืนยันการออกเลขไม่ได้ กรุณาลองใหม่ ระบบจะไม่ออกเลขซ้ำ','danger-top');
    return false;
  }finally{
    barcodePrintSavePending=false;
    if(isWorkspaceReadCurrent(context)){ reconcileBarcodePrintItems(); render(); }
  }
}
