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
  const settings=storeLabelSettings();
  const key=priceLabelTemplateKeys(kind)[1];
  const libraries=settings[key]&&typeof settings[key]==='object'?settings[key]:{};
  return normalizePriceLabelTemplateLibrary(libraries[validSize],validSize);
}

async function persistPriceLabelTemplateState(labelSize,template,library,kind='price'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const normalized=normalizePriceLabelTemplate(template,validSize);
  const normalizedLibrary=normalizePriceLabelTemplateLibrary(library,validSize);
  const [templateKey,libraryKey]=priceLabelTemplateKeys(kind);
  if(!await saveStoreLabelSettings({[templateKey]:normalized,[libraryKey]:normalizedLibrary},validSize,{confirmed:true})) throw new Error('ยังบันทึกไม่สำเร็จ กรุณาลองอีกครั้ง');
  return {template:normalized,library:normalizedLibrary};
}

function getPriceLabelTemplate(labelSize='80x50',kind='price'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const settings=storeLabelSettings();
  const library=getPriceLabelTemplateLibrary(validSize,kind);
  const active=library.templates.find(entry=>entry.id===library.activeId);
  if(active) return normalizePriceLabelTemplate(active.template,validSize);
  const key=priceLabelTemplateKeys(kind)[0];
  const saved=settings[key]&&typeof settings[key]==='object'?settings[key][validSize]:null;
  return saved?normalizePriceLabelTemplate(saved,validSize):kind==='promotion'?promotionLabelPreset(validSize):priceLabelPresetTemplate(validSize,'left');
}

async function savePriceLabelTemplate(labelSize,template,kind='price'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const normalized=normalizePriceLabelTemplate(template,validSize);
  const library=getPriceLabelTemplateLibrary(validSize,kind);
  const activeIndex=library.templates.findIndex(entry=>entry.id===library.activeId);
  if(activeIndex>=0) library.templates[activeIndex]={...library.templates[activeIndex],updatedAt:new Date().toISOString(),template:normalized};
  return (await persistPriceLabelTemplateState(validSize,normalized,library,kind)).template;
}

async function saveNamedPriceLabelTemplate(labelSize,name,template,templateId='',options={}){
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
  const saved=await persistPriceLabelTemplateState(validSize,activeTemplate,library,kind);
  return saved.library.templates.find(item=>item.id===id)||entry;
}

async function deleteNamedPriceLabelTemplate(labelSize,templateId,kind='price'){
  const validSize=BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const library=getPriceLabelTemplateLibrary(validSize,kind);
  const deleting=library.templates.find(entry=>entry.id===templateId);
  if(!deleting) return null;
  library.templates=library.templates.filter(entry=>entry.id!==templateId);
  if(library.activeId===templateId) library.activeId=library.templates[0]?.id||'';
  const next=library.templates.find(entry=>entry.id===library.activeId);
  const activeTemplate=next?.template||(kind==='promotion'?promotionLabelPreset(validSize):priceLabelPresetTemplate(validSize,'left'));
  const saved=await persistPriceLabelTemplateState(validSize,activeTemplate,library,kind);
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

function priceLabelUnitText(unit){
  const name=String(unit||'').trim();
  return name?`/ ${name}`:'';
}

function priceLabelRegularHtml(item,product,option,labelSize='80x50'){
  const template=getPriceLabelTemplate(labelSize);
  const values={name:product?.name||'',unit:priceLabelUnitText(item?.unit||option?.name),price:fmtMoney(option?.price||0).replace(/\.00$/,''),code:item?.barcode||''};
  const elements=Object.entries(template.elements).map(([key,element])=>{
    if(!element.visible) return '';
    const content=key==='barcode'?code128BSvg(values.code,40):escapeHtml(values[key]||'');
    const className=key==='barcode'?'barcode':key==='code'?'code':key;
    return `<div class="price-label-print-element ${className}" data-price-label-element="${key}" style="position:absolute;overflow:hidden;line-height:1.08;${priceLabelElementStyle(element,key)}">${content}</div>`;
  }).join('');
  const customTexts=template.customTexts.map(element=>element.visible?`<div class="price-label-print-element custom-text" data-price-label-custom-text="${escapeHtml(element.id)}" style="position:absolute;overflow:hidden;line-height:1.08;${priceLabelElementStyle(element,'custom')}">${escapeHtml(element.text)}</div>`:'').join('');
  return `<section class="label" style="padding:0"><div class="regular-layout" style="position:relative;width:100%;height:100%;overflow:hidden">${elements}${customTexts}</div></section>`;
}

function priceLabelDesignerSample(item=barcodePrintItems[0]){
  const product=item?products.find(entry=>entry.id===item.pid):null;
  const option=product?barcodePrintUnitOptions(product).find(entry=>entry.name===item.unit):null;
  const code=item?.barcode||option?.barcode||'';
  return {
    name:product?.name||'Decolgen prin (4 tablets)',
    unit:priceLabelUnitText(item?.unit||option?.name||'กล่อง'),
    price:fmtMoney(option?.price??180).replace(/\.00$/,''),
    code:code||'0123456789012',
    exampleBarcode:!code,
  };
}

let priceLabelDesignerPage=null;
function resetPriceLabelDesignerPage(){
  priceLabelDesignerPage?.dispose?.();
  priceLabelDesignerPage=null;
}
function attachPriceLabelDesignerPage(){
  const host=document.getElementById('priceLabelDesignerHost');
  if(host&&priceLabelDesignerPage?.element)host.replaceChildren(priceLabelDesignerPage.element);
}
function openPriceLabelDesigner(labelSize=barcodePrintLabelSize,options={}){
  resetPriceLabelDesignerPage();
  priceLabelDesignerPage={context:captureWorkspaceRead(),options,drafts:new Map(),element:null,dispose:null};
  render();
  mountPriceLabelDesignerEditor(labelSize,options);
}
function mountPriceLabelDesignerEditor(labelSize,options={}){
  const promotion=options.kind==='promotion',kind=promotion?'promotion':'price';

  const validSize=labelSize==='a4-50x30'?'50x30':BARCODE_PRINT_LABEL_DIMENSIONS[labelSize]?labelSize:'80x50';
  const selectedSize=labelSize==='a4-50x30'?labelSize:validSize;
  const [widthMm,heightMm]=BARCODE_PRINT_LABEL_DIMENSIONS[validSize];
  const barcodeMinimum=priceLabelBarcodeMinimum(validSize);
  let library=getPriceLabelTemplateLibrary(validSize,kind);
  let selectedTemplateId=library.activeId;
  const activeNamedTemplate=library.templates.find(entry=>entry.id===selectedTemplateId);
  let draft=normalizePriceLabelTemplate(activeNamedTemplate?.template||getPriceLabelTemplate(validSize,kind),validSize);
  const session=priceLabelDesignerPage;
  const retained=session?.drafts.get(validSize);
  if(retained){draft=retained.draft;selectedTemplateId=retained.selectedTemplateId;}
  let selected=promotion&&draft.customTexts.length?`custom:${draft.customTexts[0].id}`:'name';
  const previewItems=barcodePrintItems.filter(item=>products.some(product=>product.id===item.pid)).map(item=>({...item}));
  let sample=priceLabelDesignerSample(previewItems[0]);
  session?.dispose?.();
  const overlay=document.createElement('div');
  overlay.className='price-label-designer-editor';
  overlay.innerHTML=`<div class="price-label-designer-content">
    <div class="price-label-designer-body"><div class="price-label-designer-main"><div class="price-label-template-library"><div class="price-label-template-selectors"><label>ขนาดป้าย<select id="priceLabelDesignerSize">${Object.entries(PROMOTION_LABEL_SIZES).filter(([size])=>promotion||!size.startsWith('a4-poster')).map(([size,label])=>`<option value="${size}" ${size===selectedSize?'selected':''}>${size==='a4-50x30'?'A4 · 50 × 30 มม. · 36 ป้าย/แผ่น':label}</option>`).join('')}${promotion?'':'<option value="settings">ตั้งค่าขนาดป้ายเริ่มต้น</option>'}</select></label><label>แบบป้าย<select id="savedPriceLabelTemplateSelect" aria-label="แบบป้าย"></select></label><details class="price-label-template-menu" id="priceLabelTemplateMenu"><summary class="btn ghost" aria-label="จัดการแบบป้าย">⋯</summary><div class="price-label-template-menu-items"><button type="button" id="saveAsNewPriceLabelTemplateBtn">บันทึกเป็นแบบใหม่</button><button type="button" id="renamePriceLabelTemplateBtn">เปลี่ยนชื่อ</button><button type="button" id="deleteSavedPriceLabelTemplateBtn" class="price-label-delete-text-btn">ลบแบบ</button></div></details></div></div>

    <div class="price-label-canvas-pane"><div class="price-label-canvas-shell"><div id="priceLabelDesignerCanvas" class="price-label-canvas" style="aspect-ratio:${widthMm}/${heightMm}"></div></div></div></div><aside id="priceLabelDesignerPanel" class="price-label-designer-panel"></aside></div>
    <div class="price-label-designer-actions"><div class="price-label-designer-actions-right"><button class="btn ghost" id="cancelPriceLabelDesignerBtn" type="button">ยกเลิก</button><button class="btn primary" id="savePriceLabelDesignerBtn" type="button">บันทึก</button></div></div></div>`;
  session.element=overlay;
  attachPriceLabelDesignerPage();
  const canvas=overlay.querySelector('#priceLabelDesignerCanvas');
  if(!promotion&&previewItems.length>1){
    const picker=document.createElement('div');
    picker.className='price-label-sample-picker';
    picker.innerHTML=`<label for="priceLabelSampleSelect">สินค้าตัวอย่าง</label><div class="price-label-sample-controls"><button type="button" class="btn ghost" id="priceLabelSamplePrev" aria-label="สินค้าตัวอย่างก่อนหน้า" title="สินค้าก่อนหน้า" disabled>‹</button><select id="priceLabelSampleSelect">${previewItems.map((item,index)=>{
      const product=products.find(entry=>entry.id===item.pid);
      return `<option value="${index}">${escapeHtml(product.name)} · ${escapeHtml(item.unit)}</option>`;
    }).join('')}</select><button type="button" class="btn ghost" id="priceLabelSampleNext" aria-label="สินค้าตัวอย่างถัดไป" title="สินค้าถัดไป">›</button></div>`;
    overlay.querySelector('.price-label-canvas-pane').prepend(picker);
    const sampleSelect=picker.querySelector('select');
    const previousButton=picker.querySelector('#priceLabelSamplePrev');
    const nextButton=picker.querySelector('#priceLabelSampleNext');
    const selectSample=index=>{
      const item=previewItems[index];
      if(!item)return;
      sampleSelect.value=String(index);
      previousButton.disabled=index===0;
      nextButton.disabled=index===previewItems.length-1;
      sample=priceLabelDesignerSample(item);
      renderEditor();
    };
    sampleSelect.addEventListener('change',()=>selectSample(Number(sampleSelect.value)));
    previousButton.addEventListener('click',()=>selectSample(Number(sampleSelect.value)-1));
    nextButton.addEventListener('click',()=>selectSample(Number(sampleSelect.value)+1));
  }
  const panel=overlay.querySelector('#priceLabelDesignerPanel');
  const savedTemplateSelect=overlay.querySelector('#savedPriceLabelTemplateSelect');
  const templateMenu=overlay.querySelector('#priceLabelTemplateMenu');
  const renameTemplateButton=overlay.querySelector('#renamePriceLabelTemplateBtn');
  let nameDialog=null,savePending=false;
  const runSave=async action=>{
    if(savePending)return;
    savePending=true;
    const controls=[...overlay.querySelectorAll('button,input,select,textarea,summary')];
    const disabled=controls.map(el=>el.disabled);
    controls.forEach(el=>el.disabled=true);
    try{await action();}
    catch(error){if(priceLabelDesignerPage===session)showToast(error.message||'บันทึกไม่สำเร็จ','danger-top');}
    finally{savePending=false;controls.forEach((el,index)=>el.disabled=disabled[index]);if(priceLabelDesignerPage===session)refreshLibraryControls();}
  };
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
    const value=kind==='barcode'?(sample.code?code128BSvg(sample.code,40):''):kind==='custom'?escapeHtml(element.text):escapeHtml(sample[kind]||'');
    return `<div class="price-label-design-element ${selected===target?'selected':''}" data-price-label-element="${escapeHtml(target)}" style="${priceLabelElementStyle(element,kind,currentPreviewScale())}">${promotion?`<span data-promotion-content style="display:block;width:100%;flex-shrink:0;line-height:1.3">${value}</span>`:value}<span class="price-label-resize-handle" aria-hidden="true"></span></div>`;
  };
  const addTextButtonMarkup="<button class=\"btn primary price-label-add-text-btn\" id=\"addPriceLabelCustomTextBtn\" type=\"button\">+ เพิ่มข้อความ</button>";
  const controlMarkup=()=>{
    let info=targetInfo(selected);
    if(!info){selected=promotion&&draft.customTexts.length?customTarget(draft.customTexts[0].id):'name';info=targetInfo(selected);}
    if(!info)return `<div class="price-label-element-tabs">${addTextButtonMarkup}</div><p>กด “+ เพิ่มข้อความ” เพื่อเริ่มออกแบบป้าย</p>`;
    const {element,kind}=info;
    const positionFields=[['x','ตำแหน่งซ้าย (%)'],['y','ตำแหน่งบน (%)'],['width','ความกว้าง (%)'],['height','ความสูง (%)']].map(([field,label])=>`<label class="price-label-control-field"><span>${label}</span><input type="number" min="0" max="100" step="0.5" data-price-label-field="${field}" value="${Math.round(element[field]*100)/100}"></label>`).join('');
    const customTextField=kind==='custom'?`<label class="price-label-control-field wide"><span>ข้อความ</span>${promotion?`<textarea rows="3" maxlength="120" data-price-label-custom-value>${escapeHtml(element.text)}</textarea>`:`<input maxlength="120" data-price-label-custom-value value="${escapeHtml(element.text)}" autocomplete="off">`}</label>`:'';
    const colors=PRICE_LABEL_TEXT_COLORS.map(color=>`<label class="price-label-color-choice"><input type="radio" name="priceLabelTextColor" data-price-label-color value="${color}" ${element.color===color?'checked':''}><span class="price-label-color-swatch" style="background:${color}"></span>${color==='#000000'?'ดำ':'แดง'}</label>`).join('');
    const barcodeBelowRecommended=kind==='barcode'&&(element.width<barcodeMinimum.recommendedWidth||element.height<barcodeMinimum.recommendedHeight);
    const typography=kind==='barcode'?`<div class="price-label-barcode-limit ${barcodeBelowRecommended?'warning':''}">ขนาดต่ำสุดสำหรับป้ายนี้: กว้าง ${barcodeMinimum.width.toFixed(1)}% · สูง ${barcodeMinimum.height.toFixed(1)}% (${barcodeMinimum.widthMm} × ${barcodeMinimum.heightMm} มม.)${barcodeBelowRecommended?`<br><strong>ขนาดปัจจุบันต่ำกว่าขนาดแนะนำ ${barcodeMinimum.recommendedWidthMm} × ${barcodeMinimum.recommendedHeightMm} มม. ควรทดลองสแกนก่อนใช้งาน</strong>`:''}</div>`:`${customTextField}<div class="price-label-control-section-title">ตัวอักษร</div><label class="price-label-control-field"><span>ขนาด (pt)</span><input type="number" min="4" max="120" step="0.5" data-price-label-field="fontSize" value="${element.fontSize}"></label><label class="price-label-control-field"><span>ความหนา</span><select data-price-label-field="fontWeight">${[[400,'ปกติ'],[500,'กลาง'],[600,'กึ่งหนา'],[700,'หนา'],[800,'หนามาก']].map(([value,label])=>`<option value="${value}" ${element.fontWeight===value?'selected':''}>${label}</option>`).join('')}</select></label><div class="price-label-control-field wide"><span>สี</span><div class="price-label-color-options">${colors}</div></div><label class="price-label-control-field wide price-label-reverse-toggle" title="พื้นหลังเป็นสีที่เลือก ตัวอักษรสีขาว"><input type="checkbox" data-price-label-reverse ${element.reverse?'checked':''}> REVERSE TYPE</label><label class="price-label-control-field wide"><span>จัดแนว</span><select data-price-label-field="align"><option value="left" ${element.align==='left'?'selected':''}>ชิดซ้าย</option><option value="center" ${element.align==='center'?'selected':''}>กึ่งกลาง</option><option value="right" ${element.align==='right'?'selected':''}>ชิดขวา</option></select></label>`;
    return `<div class="price-label-element-tabs">${editorTargets().map(entry=>`<div class="price-label-element-choice"><input type="checkbox" data-price-label-toggle="${escapeHtml(entry.target)}" aria-label="แสดง${escapeHtml(entry.label)}บนป้าย" ${entry.element.visible?'checked':''}><button type="button" class="price-label-element-tab ${selected===entry.target?'active':''} ${entry.element.visible?'':'off'}" data-price-label-tab="${escapeHtml(entry.target)}">${escapeHtml(entry.label)}</button></div>${entry.target==='code'?addTextButtonMarkup:''}`).join('')}${promotion?addTextButtonMarkup:''}</div><div class="price-label-control-card"><div class="price-label-control-head"><strong>${escapeHtml(info.label)}</strong>${kind==='custom'?'<button class="icon-btn danger" id="deletePriceLabelCustomTextBtn" type="button" title="ลบข้อความนี้" aria-label="ลบข้อความนี้"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button>':''}</div><div class="price-label-control-grid">${positionFields}${typography}</div></div>`;
  };
  const updateNode=(node,element,key)=>{
    node.style.cssText=priceLabelElementStyle(element,key,currentPreviewScale());
    if(promotion)fitPromotionTextElement(node);
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
        draft.preset='custom'; if(!selectedTemplateId)savedTemplateSelect.value='preset:custom';
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
    savedTemplateSelect.value=selectedTemplateId||`preset:${promotion?(draft.preset==='custom'?'custom':'promotion'):draft.preset}`;
    panel.querySelectorAll('[data-price-label-tab]').forEach(button=>button.addEventListener('click',()=>{ selected=button.dataset.priceLabelTab; renderEditor(); }));
    panel.querySelectorAll('[data-price-label-toggle]').forEach(input=>input.addEventListener('change',()=>{
      const target=input.dataset.priceLabelToggle;
      const info=targetInfo(target);if(!info)return;
      setTargetElement(target,{...info.element,visible:input.checked});
      draft.preset='custom';renderEditor();
      const selector=`[data-price-label-toggle="${CSS.escape(target)}"]`;
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
    if(!library.templates.some(entry=>entry.id===selectedTemplateId))selectedTemplateId='';
    const presets=promotion?[['promotion','ป้ายโปรโมชั่นเริ่มต้น'],['custom','กำหนดเอง']]:Object.entries(PRICE_LABEL_PRESET_LABELS);
    savedTemplateSelect.innerHTML=`<optgroup label="แบบสำเร็จรูป">${presets.map(([value,label])=>`<option value="preset:${value}">${escapeHtml(label)}</option>`).join('')}</optgroup>${library.templates.length?`<optgroup label="แบบที่บันทึก">${library.templates.map(entry=>`<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}${entry.id===library.activeId?' · กำลังใช้งาน':''}</option>`).join('')}</optgroup>`:''}`;
    savedTemplateSelect.value=selectedTemplateId||`preset:${promotion?(draft.preset==='custom'?'custom':'promotion'):draft.preset}`;
    deleteSavedTemplateButton.disabled=!selectedTemplateId;
    renameTemplateButton.disabled=!selectedTemplateId;
  };
  const askTemplateName=(title,value,onSave)=>{
    templateMenu.open=false;
    if(nameDialog)return;
    nameDialog=document.createElement('div');
    nameDialog.className='modal-overlay';
    nameDialog.innerHTML=`<form class="modal price-label-name-modal" id="priceLabelNameDialog" role="dialog" aria-modal="true" aria-labelledby="priceLabelNameTitle"><div class="modal-head"><h3 id="priceLabelNameTitle">${escapeHtml(title)}</h3><button type="button" class="modal-close" aria-label="ปิด">×</button></div><label class="price-label-name-field">ชื่อแบบป้าย<input id="priceLabelTemplateNameInput" maxlength="60" required autocomplete="off" value="${escapeHtml(value)}"><span id="priceLabelNameError" role="alert"></span></label><div class="price-label-settings-actions"><button type="button" class="btn ghost" id="cancelPriceLabelNameBtn">ยกเลิก</button><button type="submit" class="btn primary" id="savePriceLabelNameBtn">บันทึก</button></div></form>`;
    const dismiss=()=>{nameDialog?.remove();nameDialog=null;};
    nameDialog.querySelector('.modal-close').onclick=dismiss;
    nameDialog.querySelector('#cancelPriceLabelNameBtn').onclick=dismiss;
    nameDialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss();}});
    nameDialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();
      if(priceLabelDesignerPage!==session||!isWorkspaceReadCurrent(session.context)){dismiss();return;}
      const name=nameDialog.querySelector('input').value.trim().replace(/\s+/g,' ');
      if(!name){nameDialog.querySelector('#priceLabelNameError').textContent='กรุณากรอกชื่อแบบป้าย';return;}
      const submit=nameDialog.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;
      await runSave(async()=>{const error=await onSave(name);if(error){if(nameDialog)nameDialog.querySelector('#priceLabelNameError').textContent=error;return;}dismiss();});
      if(submit.isConnected)submit.disabled=false;
    };
    document.body.appendChild(nameDialog);
    nameDialog.querySelector('input').focus();nameDialog.querySelector('input').select();
  };
  const saveDraftAsNew=finish=>askTemplateName('บันทึกเป็นแบบใหม่','',async name=>{
    const entry=await saveNamedPriceLabelTemplate(validSize,name,draft,'',{activate:finish,kind});
    if(!entry)return 'ชื่อแบบป้ายนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น';
    if(priceLabelDesignerPage!==session||!isWorkspaceReadCurrent(session.context))return;
    library=getPriceLabelTemplateLibrary(validSize,kind);selectedTemplateId=entry.id;
    refreshLibraryControls();
    if(finish)close();
    showToast(`บันทึกแบบ “${entry.name}” แล้ว`);
  });
  const close=()=>{ resetPriceLabelDesignerPage(); render(); options.onClose?.(); };
  overlay.querySelector('#cancelPriceLabelDesignerBtn').addEventListener('click',close);
  session.dispose=()=>{previewResizeObserver?.disconnect();nameDialog?.remove();nameDialog=null;overlay.remove();};
  overlay.querySelector('#priceLabelDesignerSize').addEventListener('change',event=>{
    if(event.target.value==='settings'){
      event.target.value=selectedSize;
      openPriceLabelSettings();
      return;
    }
    session.drafts.set(validSize,{draft,selectedTemplateId});
    const size=event.target.value;
    if(promotion)rememberPromotionPrintSize(size);
    mountPriceLabelDesignerEditor(size,options);
  });
  savedTemplateSelect.addEventListener('change',()=>{
    const value=savedTemplateSelect.value;
    if(value.startsWith('preset:')){
      selectedTemplateId='';
      const preset=value.slice(7);
      if(preset!=='custom'){
        const customTexts=draft.customTexts;
        draft=promotion?promotionLabelPreset(validSize):priceLabelPresetTemplate(validSize,preset);
        if(promotion)draft.preset='left';
        else draft.customTexts=customTexts;
      }else draft.preset='custom';
    }else{
      const entry=library.templates.find(item=>item.id===value);if(!entry)return;
      selectedTemplateId=entry.id;draft=normalizePriceLabelTemplate(entry.template,validSize);
    }
    selected=promotion&&draft.customTexts.length?customTarget(draft.customTexts[0].id):'name';
    refreshLibraryControls();renderEditor();
  });
  overlay.addEventListener('click',event=>{if(!templateMenu.contains(event.target))templateMenu.open=false;});
  templateMenu.addEventListener('keydown',event=>{if(event.key==='Escape'){templateMenu.open=false;templateMenu.querySelector('summary').focus();}});
  overlay.querySelector('#saveAsNewPriceLabelTemplateBtn').addEventListener('click',()=>saveDraftAsNew(false));
  renameTemplateButton.addEventListener('click',()=>{
    const entry=library.templates.find(item=>item.id===selectedTemplateId);if(!entry)return;
    askTemplateName('เปลี่ยนชื่อแบบป้าย',entry.name,async name=>{
      const renamed=await saveNamedPriceLabelTemplate(validSize,name,entry.template,entry.id,{activate:false,kind});
      if(!renamed)return 'ชื่อแบบป้ายนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น';
      if(priceLabelDesignerPage!==session||!isWorkspaceReadCurrent(session.context))return;
      library=getPriceLabelTemplateLibrary(validSize,kind);refreshLibraryControls();
      showToast('เปลี่ยนชื่อแบบป้ายแล้ว');
    });
  });
  deleteSavedTemplateButton.addEventListener('click',()=>runSave(async()=>{
    templateMenu.open=false;
    const entry=library.templates.find(item=>item.id===selectedTemplateId);
    if(!entry||!confirm(`ลบแม่แบบ “${entry.name}” ใช่หรือไม่?`)) return;
    const result=await deleteNamedPriceLabelTemplate(validSize,entry.id,kind);
    if(!result||priceLabelDesignerPage!==session||!isWorkspaceReadCurrent(session.context)) return;
    library=result.library; selectedTemplateId=library.activeId; draft=normalizePriceLabelTemplate(result.template,validSize); selected='name'; refreshLibraryControls(); renderEditor(); showToast(`ลบแม่แบบ “${entry.name}” แล้ว`);
  }));
  panel.addEventListener('click',event=>{
    if(!event.target.closest('#addPriceLabelCustomTextBtn'))return;
    if(draft.customTexts.length>=20){ showToast('เพิ่มข้อความได้สูงสุด 20 กล่องต่อแม่แบบ'); return; }
    const id=`text-${Date.now().toString(36)}-${++priceLabelCustomTextCounter}`;
    const offset=draft.customTexts.length%5;
    const element=normalizePriceLabelCustomText({id,text:'พิมพ์ข้อความ',x:promotion?5:62,y:5+offset*16,width:promotion?90:35},validSize,draft.customTexts.length);
    draft.customTexts.push(element); selected=customTarget(id); draft.preset='custom'; renderEditor();
    setTimeout(()=>{ const input=panel.querySelector('[data-price-label-custom-value]'); input?.focus(); input?.select(); },0);
  });
  overlay.querySelector('#savePriceLabelDesignerBtn').addEventListener('click',()=>{
    const existing=library.templates.find(entry=>entry.id===selectedTemplateId);
    if(!existing){saveDraftAsNew(true);return;}
    void runSave(async()=>{
      const entry=await saveNamedPriceLabelTemplate(validSize,existing.name,draft,existing.id,{kind});
      if(priceLabelDesignerPage!==session||!isWorkspaceReadCurrent(session.context))return;
      if(!entry){showToast('บันทึกแบบป้ายไม่สำเร็จ');return;}
      close();showToast(`บันทึกแบบ “${entry.name}” แล้ว`);
    });
  });
  if(typeof ResizeObserver==='function'){
    previewResizeObserver=new ResizeObserver(()=>syncPreviewScale());
    previewResizeObserver.observe(canvas);
  }
  refreshLibraryControls();
  renderEditor();
  if(promotion)document.fonts?.ready.then(()=>{if(priceLabelDesignerPage===session)syncPreviewScale();});
}

function barcodePrintRowsHtml(entries=barcodePrintPagination().rows){
  if(!barcodePrintItems.length) return '<tr><td colspan="7" class="barcode-print-empty">ยังไม่มีรายการ — ค้นหาสินค้า หรือเลือกสินค้าจากด้านบน</td></tr>';
  return entries.map(({item,index})=>{
    const product=products.find(entry=>entry.id===item.pid);
    if(!product) return '';
    const options=barcodePrintRowOptions(item,product);
    const selected=options.find(option=>option.name===item.unit&&option.barcode===item.barcode)||options.find(option=>option.name===item.unit);
    if(!selected) return '';
    const unitSelect=options.length===1
      ?`<span class="barcode-print-unit-label">${escapeHtml(selected.name)}</span>`
      :`<select class="barcode-print-unit-select" data-barcode-print-unit="${index}" ${barcodePrintSavePending?'disabled':''}>${options.map(option=>`<option value="${escapeHtml(barcodePrintMode==='reprint'?option.barcode:option.name)}" ${option===selected?'selected':''}>${escapeHtml(option.name)}${barcodePrintMode==='reprint'?' · '+escapeHtml(option.barcode):''}</option>`).join('')}</select>`;
    return `<tr data-barcode-print-row="${index}">
      <td class="mono" style="text-align:center;">${escapeHtml(product.sku||'-')}</td>
      <td>${escapeHtml(product.name)}${item.reservation?'<br><span class="barcode-print-missing">จองเลขแล้ว</span>':selected.barcode?'':`<br><span class="barcode-print-missing">หน่วยนี้ยังไม่มีบาร์โค้ด</span>`}</td>
      <td style="text-align:center;">${unitSelect}</td>
      <td><input class="barcode-print-code-input" data-barcode-print-code="${index}" ${barcodePrintSavePending?'disabled':''} ${barcodePrintMode==='reprint'||item.reservation?'readonly':''} value="${escapeHtml(item.barcode)}" placeholder="${escapeHtml(barcodePrintPreviewCode(item)||'กดจองเลขบาร์โค้ด')}" maxlength="48" autocomplete="off" aria-label="บาร์โค้ด ${escapeHtml(product.name)}">${!item.reservation&&!item.barcode&&barcodePrintMode==='new'&&!barcodePrintPreviewCode(item)?`<small style="display:block;text-align:center;">${barcodePrintPreview?.loading?'กำลังโหลดเลขตัวอย่าง…':'ยังโหลดเลขตัวอย่างไม่ได้'}</small>`:''}</td>
      <td class="mono" style="text-align:center;">${fmtMoney(selected.price)}</td>
      <td style="text-align:center;"><input type="number" min="1" max="500" step="1" class="barcode-print-qty-input" data-barcode-print-qty="${index}" ${barcodePrintSavePending?'disabled':''} value="${Number(item.qty)||1}" aria-label="จำนวนฉลาก ${escapeHtml(product.name)}"></td>
      <td style="text-align:center;"><button class="barcode-print-remove" data-barcode-print-remove="${index}" ${barcodePrintSavePending?'disabled':''} title="ลบ ${escapeHtml(product.name)} ออกจากรายการ" aria-label="ลบ ${escapeHtml(product.name)} ออกจากรายการ"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></td>
    </tr>`;
  }).join('');
}

function priceLabelDesignMenuHtml(promotion=false){
  return `<div class="label-design-menu-card ${promotion?'promotion':'price'}"><button type="button" id="${promotion?'promotionLabelDesignBtn':'openPriceLabelDesignerBtn'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/></svg><strong>${promotion?'ออกแบบป้ายโปรโมชั่น':'ออกแบบป้ายราคา'}</strong></button></div>`;
}
function renderBarcodePrint(){
  if(priceLabelDesignerPage&&!isWorkspaceReadCurrent(priceLabelDesignerPage.context))resetPriceLabelDesignerPage();
  if(priceLabelDesignerPage)return '<section class="rpt price-label-designer-page" id="priceLabelDesignerHost"></section>';
  if(barcodePrintShowMenu) return `<section class="rpt barcode-print-menu">
    <div class="barcode-print-mode-grid">
      ${priceLabelDesignMenuHtml()}${priceLabelDesignMenuHtml(true)}
      <button type="button" class="barcode-print-mode-card" data-barcode-print-mode="new"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 3h10l6 6v12H4zM14 3v6h6M8 15h8M12 11v8"/></svg><strong>พิมพ์ป้ายราคาใหม่</strong></button>
      <button type="button" class="barcode-print-mode-card" data-barcode-print-mode="reprint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 14h10v7H7zM17 11h1"/></svg><strong>พิมพ์ป้ายราคาจากบาร์โค้ดเดิม</strong></button>
      <button type="button" class="barcode-print-mode-card" data-barcode-print-mode="promotion"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 4h18v16H3zM7 8h10M7 12h10M7 16h6"/></svg><strong>ป้ายโปรโมชั่น</strong></button>
    </div></section>`;
  if(promotionPrintActive)return renderPromotionLabelPrint();
  if(barcodePrintMode==='reprint'&&(!barcodeIssuedState?.ready||!isStoreViewCurrent(barcodeIssuedState.context))) return `<section class="rpt"><div class="pagehead label-print-pagehead"><button class="btn ghost" id="barcodePrintMenuBtn">ย้อนกลับ</button></div><p role="status">${barcodeIssuedState?.loading?'กำลังตรวจประวัติการจ่ายบาร์โค้ด…':escapeHtml(barcodeIssuedState?.error||'กรุณาโหลดประวัติการจ่ายบาร์โค้ด')}</p>${barcodeIssuedState?.loading?'':'<button class="btn primary" id="barcodeIssuedRetryBtn">ลองใหม่</button>'}</section>`;
  reconcileBarcodePrintItems();
  ensureBarcodePrintPreview();
  const filter=barcodePrintCatFilter;
  const available=barcodePrintAvailableProducts();
  const brandOptions=brands.filter(brand=>available.some(product=>(!filter.category||product.category===filter.category)&&product.brand===brand));
  const filteredCount=available.filter(product=>(!filter.category||product.category===filter.category)&&(!filter.brand||product.brand===filter.brand)).length;
  const reprint=barcodePrintMode==='reprint';
  const pagination=barcodePrintPagination();
  barcodePrintPage=pagination.currentPage;
  return `<div class="rpt barcode-print-page">
    <div class="pagehead label-print-pagehead"><div class="barcode-print-actions form-final-actions"><button class="btn ghost" id="barcodePrintMenuBtn">ย้อนกลับ</button>${reprint?'':`<button class="btn primary" id="reserveBarcodePrintBtn" ${barcodePrintSavePending||!barcodePrintUnreservedItems().length?'disabled':''}>${barcodePrintSavePending?'กำลังจองเลข…':'จองเลขบาร์โค้ด'}</button>`}<button class="btn primary" id="savePrintBarcodeBtn" ${!barcodePrintSavePending&&barcodePrintItems.length&&(reprint||!barcodePrintUnreservedItems().length)?'':'disabled'}>${reprint?'พิมพ์ป้ายเดิมซ้ำ':'พิมพ์ป้ายราคา'} (${barcodePrintItems.length})</button></div></div>
    <div class="rpt-filters" style="margin-bottom:14px;">
      <div class="rpf-item"><select id="barcodePrintCategorySelect" class="rpt-select"><option value="">หมวดสินค้าหลัก: ทั้งหมด</option>${categories.map(category=>`<option value="${escapeHtml(category)}" ${filter.category===category?'selected':''}>${escapeHtml(category)}</option>`).join('')}</select></div>
      <div class="rpf-item"><select id="barcodePrintBrandSelect" class="rpt-select"><option value="">หมวดสินค้าย่อย: ทั้งหมด</option>${brandOptions.map(brand=>`<option value="${escapeHtml(brand)}" ${filter.brand===brand?'selected':''}>${escapeHtml(brand)}</option>`).join('')}</select></div>
      <button class="btn ghost" id="barcodePrintAddCategoryBtn" ${(filter.category||filter.brand)?'':'disabled'}>เลือกสินค้าในหมวดนี้${(filter.category||filter.brand)?` (${filteredCount})`:''}</button>
    <div class="barcode-print-search-wrap">
      <input id="barcodePrintSearch" class="barcode-print-search" value="${escapeHtml(barcodePrintSearchQuery)}" placeholder="ค้นหาจาก ชื่อ / รหัส / บาร์โค้ด..." autocomplete="off">
      <div id="barcodePrintResults" class="fav-add-results" hidden style="left:0;right:0;top:calc(100% - 6px);"></div>
    </div>
      <button class="btn ghost" id="clearBarcodePrintBtn" ${barcodePrintItems.length&&!barcodePrintSavePending?'':'disabled'}>ล้างรายการ</button>
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
  const context=captureWorkspaceRead();
  const sizes=[['a4-50x30','A4 · 50 × 30 มม. · 36 ป้าย/แผ่น'],['50x30','ป้ายราคา 50 × 30 มม.'],['80x50','ป้ายราคา 80 × 50 มม.'],['60x40','ป้ายราคา 60 × 40 มม.'],['40x30','ป้ายราคา 40 × 30 มม.']];
  const defaultSize=readPriceLabelDefaultSize();
  const trigger=document.getElementById('priceLabelDesignerSize');
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal price-label-settings-modal" id="priceLabelSettingsDialog" role="dialog" aria-modal="true" aria-labelledby="priceLabelSettingsTitle"><div class="modal-head"><h3 id="priceLabelSettingsTitle">ตั้งค่าขนาดป้ายเริ่มต้น</h3><button type="button" class="modal-close" aria-label="ปิด">×</button></div><div class="price-label-size-options">${sizes.map(([value,label])=>`<label><input type="radio" name="priceLabelPaperSize" value="${value}" ${defaultSize===value?'checked':''}><span>${label}</span></label>`).join('')}</div><div class="price-label-settings-actions"><button type="button" class="btn ghost" id="cancelPriceLabelSettingsBtn">ยกเลิก</button><button type="button" class="btn primary" id="savePriceLabelDefaultBtn">บันทึกค่าเริ่มต้น</button></div></div>`;
  const close=()=>{overlay.remove();trigger?.focus();};
  overlay.querySelector('.modal-close').addEventListener('click',close);
  overlay.querySelector('#cancelPriceLabelSettingsBtn').addEventListener('click',close);
  overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
  overlay.querySelector('#savePriceLabelDefaultBtn').addEventListener('click',()=>{
    if(!isWorkspaceReadCurrent(context)){close();return;}
    const size=overlay.querySelector('input[name="priceLabelPaperSize"]:checked')?.value;
    if(!sizes.some(([value])=>value===size))return;
    try{
      savePriceLabelDefaultSize(size);
      barcodePrintLabelSize=size;
      close();
      if(trigger?.isConnected){trigger.value=size;trigger.dispatchEvent(new Event('change'));}
      showToast('บันทึกขนาดเริ่มต้นสำหรับป้ายใหม่และป้ายเดิมบนเครื่องนี้แล้ว');
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
    if(!barcodeReprintContext||!isStoreViewCurrent(barcodeReprintContext)) throw new Error('ข้อมูลผู้ใช้เปลี่ยน กรุณาเปิดหน้าพิมพ์ซ้ำอีกครั้ง');
    if(!barcodePrintItems.length) throw new Error('กรุณาเลือกสินค้าก่อนพิมพ์');
    const items=barcodePrintItems.map(item=>barcodeReprintItem(item.pid,item.unit,item.qty,item.barcode));
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
  const landscapeA4=labelSize==='a4-poster-landscape';
  const fullA4=labelSize==='a4-poster'||landscapeA4;
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
  const fontRules=`@font-face{font-family:'Google Sans';src:url('${fontBase}/fonts/google-sans-variable-v2.woff2') format('woff2');font-style:normal;font-weight:400 700;font-display:swap}@font-face{font-family:'Google Sans';src:url('${fontBase}/fonts/google-sans-italic-variable-v2.woff2') format('woff2');font-style:italic;font-weight:400 700;font-display:swap}`;
  const shareFonts=typeof document!=='undefined'&&document.fonts?.load&&printWindow.document.fonts?.add;
  const printFontStyle=`<style>${shareFonts?'':fontRules}body,.toolbar button,.label{font-family:'Google Sans','Noto Sans Thai',Tahoma,sans-serif}</style>`;
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
  const pageSize=landscapeA4?'A4 landscape':a4||fullA4?'A4 portrait':`${width}mm ${height}mm`;

  printWindow.document.open();
  printWindow.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>พิมพ์${promotionTemplate?'ป้ายโปรโมชั่น':'ป้ายราคา'} ${labels.length} ดวง</title><style>@page{size:${pageSize};margin:0}*{box-sizing:border-box}body{margin:0;background:#e9edf0;color:#111;font-family:'Noto Sans Thai',Tahoma,sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#fff;box-shadow:0 2px 8px #0002;font-size:13px}.toolbar button{border:0;border-radius:7px;background:#4F4038;color:#fff;padding:8px 16px;font:600 13px 'Noto Sans Thai',Tahoma,sans-serif;cursor:pointer}.label{width:${width}mm;height:${height}mm;margin:10px auto;padding:0;background:#fff;overflow:hidden;page-break-after:always;break-after:page}.label:last-child{page-break-after:auto;break-after:auto}.barcode-label-svg{display:block;width:100%;height:100%}.price-label-print-element{-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{body{background:#fff}.toolbar{display:none}.label{margin:0;box-shadow:none}}${sheetStyle}</style>${printFontStyle}</head><body><div class="toolbar"><span>${promotionTemplate?'ป้ายโปรโมชั่น':'ป้ายราคา'} ${width} × ${height} มม. ${fullA4&&!landscapeA4?'แนวตั้ง':'แนวนอน'} · ทั้งหมด ${labels.length} ดวง</span><button onclick="window.print()">พิมพ์</button></div>${content}</body></html>`);
  printWindow.document.close();
  if(promotionTemplate){
    fitPromotionLabelText(printWindow.document);
    printWindow.addEventListener('beforeprint',()=>fitPromotionLabelText(printWindow.document));
    printWindow.document.fonts?.addEventListener('loadingdone',()=>fitPromotionLabelText(printWindow.document));
  }
  const preparePreview=async()=>{
    if(printWindow.closed) return;
    // Load in the opener only. Removing a loading @font-face from a popup
    // can leave its FontFaceSet.ready pending after switching to print media.
    if(shareFonts){
      try{
        const faces=await Promise.all([document.fonts.load('16px "Google Sans"'),document.fonts.load('italic 16px "Google Sans"')]);
        if(printWindow.closed)return;
        new Set(faces.flat()).forEach(face=>printWindow.document.fonts.add(face));
      }catch(error){console.warn('price label font load',error);}
    }
    if(promotionTemplate)fitPromotionLabelText(printWindow.document);
    if(typeof standardizePrintPreview==='function') standardizePrintPreview(printWindow,{trackPrint,applyPaperSettings:!a4&&!fullA4});
    const printNow=()=>{ try{ if(!printWindow.closed){if(promotionTemplate)fitPromotionLabelText(printWindow.document);printWindow.focus(); printWindow.print();} }catch(error){} };
    if(printWindow.document.fonts?.ready?.then) printWindow.document.fonts.ready.then(printNow).catch(()=>setTimeout(printNow,450));
    else setTimeout(printNow,450);
  };
  // All label markup and font rules are written synchronously before this call.
  void preparePreview();
  return true;
}

async function saveBarcodePrintItems(printWindow,{reserveOnly=false}={}){
  if(barcodePrintSavePending){ if(printWindow&&!printWindow.closed) printWindow.close(); return false; }
  const pendingItems=reserveOnly?barcodePrintUnreservedItems():barcodePrintItems;
  if(!pendingItems.length) return false;
  const errors=barcodePrintIsRetry(pendingItems)?[]:barcodePrintValidation(pendingItems);
  document.querySelectorAll('.barcode-print-code-input').forEach(input=>input.classList.remove('invalid'));
  if(errors.length){
    errors.forEach(error=>document.querySelector(`[data-barcode-print-code="${barcodePrintItems.indexOf(pendingItems[error.index])}"]`)?.classList.add('invalid'));
    if(printWindow&&!printWindow.closed) printWindow.close();
    alert(`ยังไม่สามารถบันทึกและพิมพ์ได้\n\n${errors.slice(0,8).map(error=>error.message).join('\n')}${errors.length>8?`\nและอีก ${errors.length-8} จุด`:''}`);
    return false;
  }
  const snapshot=barcodePrintRequestPayload(pendingItems);
  const context=captureStoreView();
  const labelSize=barcodePrintLabelSize;
  barcodePrintSavePending=true;
  if(reserveOnly) render();
  try{
    if(!navigator.onLine) throw new Error('กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนออกเลขบาร์โค้ดและพิมพ์');
    const hasPendingProducts=()=>snapshot.some(item=>productDirtyOperations.has(String(item.pid)));
    if(hasPendingProducts()){
      showToast('กำลังซิงก์ข้อมูลสินค้าก่อนออกเลขบาร์โค้ด…');
      // Joining the existing core sync directly returns early. Wait for it to
      // finish before starting a retry, without running two writers together.
      for(let attempt=0;coreSyncInFlight&&attempt<150;attempt++){
        if(!isStoreViewCurrent(context)) throw new Error('ร้านหรือผู้ใช้งานเปลี่ยน กรุณาเปิดหน้าพิมพ์ใหม่');
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!isStoreViewCurrent(context)) throw new Error('ร้านหรือผู้ใช้งานเปลี่ยน กรุณาเปิดหน้าพิมพ์ใหม่');
      if(coreSyncInFlight) throw new Error('ระบบยังซิงก์ข้อมูลอยู่ กรุณารอสักครู่แล้วกดพิมพ์อีกครั้ง');
      if(hasPendingProducts()) await syncCoreDataToSupabase();
    }
    if(!isStoreViewCurrent(context)) throw new Error('ร้านหรือผู้ใช้งานเปลี่ยน กรุณาเปิดหน้าพิมพ์ใหม่');
    if(hasPendingProducts()) throw new Error('ยังซิงก์ข้อมูลสินค้าไม่สำเร็จ กรุณากดสถานะซิงก์ด้านบนเพื่อดูรายละเอียด ยังไม่ได้ออกเลขบาร์โค้ด');
    if(JSON.stringify(snapshot)!==JSON.stringify(barcodePrintRequestPayload(reserveOnly?barcodePrintUnreservedItems():barcodePrintItems))) throw new Error('รายการพิมพ์มีการเปลี่ยนแปลง กรุณาตรวจรายการแล้วกดพิมพ์ใหม่');
    if(!barcodePrintIsRetry()){
      const latestErrors=barcodePrintValidation(snapshot);
      if(latestErrors.length) throw new Error(latestErrors[0].message);
    }
    const before=new Map(snapshot.map(item=>{
      const product=products.find(product=>product.id===item.pid);
      return [item.pid,product?JSON.stringify(productMetadataToRow(product)):''];
    }));
    if(!barcodePrintIsRetry()) barcodePrintRequest={actor:currentProfile.id,key:JSON.stringify(snapshot),id:crypto.randomUUID()};
    const {data,error}=await sb.rpc('assign_price_label_barcodes',{p_warehouse_id:context.store,p_request_id:barcodePrintRequest.id,p_items:snapshot});
    if(error) throw error;
    if(!isStoreViewCurrent(context)) throw new Error('บัญชีผู้ใช้งานเปลี่ยน กรุณาโหลดข้อมูลล่าสุด');
    if(!Array.isArray(data?.items)||!Array.isArray(data?.products)||data.items.length!==snapshot.length) throw new Error('รับผลบันทึกบาร์โค้ดไม่ครบ กรุณาลองใหม่');
    data.items.forEach((item,index)=>{
      const requested=snapshot[index];
      if(item.pid!==requested.pid||item.unit!==requested.unit||item.qty!==requested.qty||
        (requested.barcode?item.barcode!==requested.barcode:!systemLabelCode(item.barcode,context.store))) throw new Error('ผลการออกเลขบาร์โค้ดไม่ตรงกับรายการ กรุณาลองใหม่');
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
          const serverUnit=saved.unit===item.unit?saved:(saved.units||[]).find(unit=>unit.sub===item.unit);
          if(target&&serverUnit) target.barcode=serverUnit.barcode||'';
        }
        local._revision=saved._revision;
      }
      (syncedTableRows.products||=new Map()).set(String(row.id),JSON.stringify(productMetadataToRow(saved)));
    }
    if(typeof invalidateProductIssuedBarcodeHistory==='function')invalidateProductIssuedBarcodeHistory();
    rebuildProductLookupMaps();
    if(reserveOnly){
      for(const issued of data.items){
        const item=barcodePrintItems.find(item=>item.pid===issued.pid&&item.unit===issued.unit&&!item.reservation);
        if(item) Object.assign(item,{barcode:issued.barcode,reservation:{code:issued.barcode,context}});
      }
      barcodePrintRequest=null;
    }
    const cached=await persistProductChangesToIndexedDB({updatedIds:data.products.map(row=>row.id)});
    if(!isStoreViewCurrent(context)) throw new Error('บัญชีผู้ใช้งานเปลี่ยน กรุณาโหลดข้อมูลล่าสุด');
    // Codes are already committed centrally. A local cache failure must never
    // undo them or return their numbers to the generator.
    if(!reserveOnly) writeBarcodePrintWindow(printWindow,data.items,labelSize);
    barcodePrintRequest=null;
    showToast(cached?reserveOnly?'จองเลขบาร์โค้ดแล้ว เลขจะคงอยู่กับสินค้าแม้ยังไม่พิมพ์':`เตรียมพิมพ์ป้ายราคา ${data.items.reduce((sum,item)=>sum+Number(item.qty),0)} ดวงแล้ว`:'บันทึกบาร์โค้ดส่วนกลางแล้ว แต่เก็บสำเนาในเครื่องไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุด');
    return true;
  }catch(error){
    if(printWindow&&!printWindow.closed) printWindow.close();
    showToast(error?.message||'ยังยืนยันการออกเลขไม่ได้ กรุณาลองใหม่ ระบบจะไม่ออกเลขซ้ำ','danger-top');
    return false;
  }finally{
    barcodePrintSavePending=false;
    if(reserveOnly) barcodePrintPreview=null;
    if(isStoreViewCurrent(context)){ reconcileBarcodePrintItems(); render(); }
  }
}

// Printing an already reserved queue is read-only: cancellation or printer failure
// must never allocate a replacement number.
function printReservedBarcodeItems(){
  let printWindow;
  try{
    if(barcodePrintSavePending) return false;
    if(!barcodePrintItems.length||barcodePrintUnreservedItems().length) throw new Error('กรุณาจองเลขบาร์โค้ดก่อนพิมพ์');
    const items=barcodePrintItems.map(item=>{
      if(!barcodePrintReservedOption(item)) throw new Error('สินค้า หน่วย หรือบาร์โค้ดเปลี่ยน กรุณาโหลดรายการใหม่');
      const qty=Number(item.qty);
      if(!Number.isInteger(qty)||qty<1||qty>500) throw new Error('จำนวนฉลากต้องเป็น 1–500');
      return {pid:item.pid,unit:item.unit,barcode:item.barcode,qty};
    });
    printWindow=window.open('','_blank');
    if(!printWindow) throw new Error('เบราว์เซอร์บล็อกหน้าพิมพ์ กรุณาอนุญาต Pop-up แล้วลองใหม่');
    writeBarcodePrintWindow(printWindow,items,barcodePrintLabelSize,{trackPrint:false});
    return true;
  }catch(error){
    if(printWindow&&!printWindow.closed) printWindow.close();
    showToast(error?.message||'เปิดหน้าพิมพ์ไม่สำเร็จ เลขบาร์โค้ดที่จองไว้ยังใช้ได้','danger-top');
    return false;
  }
}
