function code128BValues(text){
  const value=String(text||'');
  if(!value) throw new Error('กรุณากรอกบาร์โค้ด');
  const data=[];
  for(const char of value){
    const code=char.charCodeAt(0);
    if(code<32||code>126) throw new Error('Code 128 รองรับเฉพาะตัวเลขและตัวอักษรอังกฤษ');
    data.push(code-32);
  }
  const checksum=(104+data.reduce((sum,code,index)=>sum+code*(index+1),0))%103;
  return [104,...data,checksum,106];
}

function code128BSvg(text,height=44){
  const values=code128BValues(text);
  const quiet=10;
  let x=quiet;
  const bars=[];
  values.forEach(value=>{
    const pattern=CODE128_PATTERNS[value];
    for(let index=0;index<pattern.length;index++){
      const width=Number(pattern[index]);
      if(index%2===0) bars.push(`<rect x="${x}" y="0" width="${width}" height="${height}"/>`);
      x+=width;
    }
  });
  const totalWidth=x+quiet;
  return `<svg class="barcode-label-svg" viewBox="0 0 ${totalWidth} ${height}" role="img" aria-label="บาร์โค้ด ${escapeHtml(text)}" xmlns="http://www.w3.org/2000/svg"><g fill="#000">${bars.join('')}</g></svg>`;
}

function barcodePrintUnitOptions(product){
  if(!product) return [];
  return [
    {name:product.unit||'ชิ้น',barcode:String(product.barcode||'').trim(),price:Number(product.price)||0,isMain:true,index:0},
    ...(product.units||[]).filter(unit=>unit.sub).map((unit,index)=>({name:unit.sub,barcode:String(unit.barcode||'').trim(),price:Number(unit.price)||0,isMain:false,index:index+1}))
  ];
}

function barcodePrintMissingUnitOptions(product){
  return isProductActive(product)?barcodePrintUnitOptions(product).filter(option=>!option.barcode):[];
}

function barcodePrintNeedsBarcode(product){
  return barcodePrintMissingUnitOptions(product).length>0;
}

function systemLabelCode(code,warehouseId){
  if(typeof code!=='string'||!/^(?:[AB]|W[0-9]+-)?P[0-9]{11}$/.test(code)) return false;
  if(!warehouseId||code.startsWith('P')) return true;
  const prefix=warehouseId===1?'AP':warehouseId===2?'BP':'W'+warehouseId+'-P';
  return code.startsWith(prefix);
}
function shopLabelUnit(product,normalized){
  if(!product||product.active===false||normalized.startsWith('P')||!systemLabelCode(normalized,Number(product.wh)||1)) return null;
  const units=productUnitOptions(product);
  const unit=units.find(option=>String(option.barcode||'').toUpperCase()===normalized);
  if(unit) return unit.name;
  const alias=extraBarcodeEntries(product).find(entry=>entry.code.toUpperCase()===normalized);
  return alias&&units.some(option=>option.name===alias.unit)?alias.unit:null;
}
function findStoreLabelMatch(code){
  const normalized=code.toUpperCase(),store=Number(activeWarehouseId);
  if(!store||normalized.startsWith('P')||!systemLabelCode(normalized,store)) return null;
  const indexed=findProductByExactCode(normalized);
  if(!indexed) return null;
  const unitName=shopLabelUnit(indexed.product,normalized);
  if(unitName) return {product:indexed.product,unitName};
  // A SKU in the index may equal a label belonging to another product.
  for(const product of products){
    const unit=shopLabelUnit(product,normalized);
    if(unit) return {product,unitName:unit};
  }
  return null;
}
function inventoryLabelMatches(code){
  // Inventory documents accept only current shop labels. The old P series is retired.
  if(code.toUpperCase().startsWith('P')) return [];
  const match=findStoreLabelMatch(code);
  return match?[{...match,barcode:code}]:[];
}
function barcodeReprintUnitOptions(product){
  if(!isProductActive(product)||!barcodeIssuedState?.ready||!isStoreViewCurrent(barcodeIssuedState.context)) return [];
  const units=barcodePrintUnitOptions(product);
  const candidates=[...units];
  for(const alias of extraBarcodeEntries(product)){
    const unit=units.find(entry=>entry.name===alias.unit);
    if(unit) candidates.push({...unit,barcode:alias.code});
  }
  return candidates.filter(option=>{
    const code=String(option.barcode||'').toUpperCase();
    if(systemLabelCode(code)&&(code.startsWith('P')||!systemLabelCode(code,barcodeIssuedState.context.store))) return false;
    return barcodeIssuedState.codes.has(JSON.stringify([Number(product.id),option.barcode]));
  });
}

function barcodeReprintItem(productId,unitName,quantity,code){
  const product=products.find(entry=>entry.id===Number(productId));
  const units=barcodeReprintUnitOptions(product).filter(entry=>entry.name===unitName);
  const option=units.find(entry=>entry.barcode===code)||units[0];
  if(!option) throw new Error('ไม่พบหน่วยสินค้าที่มีบาร์โค้ด กรุณาเลือกสินค้าและหน่วยอีกครั้ง');
  const qty=Number(quantity);
  if(!Number.isInteger(qty)||qty<1||qty>500) throw new Error('จำนวนป้ายต้องเป็นจำนวนเต็ม 1–500');
  code128BValues(option.barcode);
  return {pid:product.id,unit:option.name,barcode:option.barcode,qty};
}

let barcodePrintSavePending=false;
let barcodePrintRequest=null;
let barcodePrintMode='new';
let barcodePrintShowMenu=true;
let barcodePrintOtherQueue=null;
let barcodeReprintContext=null;
let barcodeIssuedState=null;
async function loadSystemIssuedLabelCodes(){
  const state={context:captureStoreView(),ready:false,loading:true,error:'',codes:new Set()};
  barcodeIssuedState=state;
  render();
  try{
    const {data,error}=await sb.rpc('system_issued_label_codes',{p_warehouse_id:state.context.store});
    if(error) throw error;
    if(!Array.isArray(data)) throw new Error('ข้อมูลประวัติบาร์โค้ดไม่ถูกต้อง');
    state.codes=new Set(data.map(item=>JSON.stringify([Number(item.pid),String(item.barcode)])));
    state.ready=true;
  }catch(error){state.error='โหลดประวัติการจ่ายบาร์โค้ดไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่';}
  finally{
    state.loading=false;
    if(barcodeIssuedState===state&&isStoreViewCurrent(state.context)&&currentTab==='barcodeprint') render();
  }
}
function barcodePrintSelectableUnitOptions(product){
  return barcodePrintMode==='reprint'?barcodeReprintUnitOptions(product):barcodePrintMissingUnitOptions(product);
}
function setBarcodePrintMode(mode){
  if(mode==='promotion'&&!barcodePrintSavePending){promotionPrintActive=true;barcodePrintShowMenu=false;render();return;}
  if(!['new','reprint'].includes(mode)||barcodePrintSavePending) return;
  promotionPrintActive=false;
  barcodePrintShowMenu=false;
  barcodePrintLabelSize=typeof readPriceLabelDefaultSize==='function'?readPriceLabelDefaultSize(mode):barcodePrintLabelSize;
  if(mode===barcodePrintMode){if(mode==='reprint')loadSystemIssuedLabelCodes();else render();return;}
  const previous={items:barcodePrintItems,request:barcodePrintRequest,context:captureStoreView()};
  const restored=barcodePrintOtherQueue&&isStoreViewCurrent(barcodePrintOtherQueue.context)?barcodePrintOtherQueue:null;
  barcodePrintItems=restored?.items||[];
  barcodePrintRequest=restored?.request||null;
  barcodePrintOtherQueue=previous;
  barcodePrintMode=mode;
  barcodeReprintContext=captureStoreView();
  barcodePrintSearchQuery=''; barcodePrintCatFilter={category:'',brand:''}; barcodePrintPage=1;
  if(mode==='reprint') return loadSystemIssuedLabelCodes();
  render();
}
function barcodePrintRequestPayload(items=barcodePrintItems){
  return items.map(item=>({pid:Number(item.pid),unit:item.unit,barcode:String(item.barcode||'').trim(),qty:Number(item.qty)}));
}
function barcodePrintIsRetry(items=barcodePrintItems){
  if(barcodePrintMode==='reprint') return false;
  return barcodePrintRequest?.actor===currentProfile?.id&&barcodePrintRequest?.key===JSON.stringify(barcodePrintRequestPayload(items));
}
function reconcileBarcodePrintItems(){
  if(barcodePrintSavePending||barcodePrintIsRetry()) return;
  const byId=new Map(products.map(product=>[product.id,product]));
  barcodePrintItems=barcodePrintItems.filter(item=>{
    const product=byId.get(item.pid);
    return barcodePrintSelectableUnitOptions(product).some(option=>option.name===item.unit);
  });
}

function barcodePrintAvailableProducts(filter={}){
  return products.filter(product=>barcodePrintSelectableUnitOptions(product).length&&(!filter.category||product.category===filter.category)&&(!filter.brand||product.brand===filter.brand));
}

function barcodePrintFindProductItem(productId){ return barcodePrintItems.find(item=>item.pid===Number(productId)); }
function barcodePrintTargetKey(productId,unitName){ return `${Number(productId)}::${String(unitName||'')}`; }

function barcodePrintBarcodeOwners(){
  const owners=[];
  products.forEach(product=>{
    if(product.barcode) owners.push({code:String(product.barcode).trim(),pid:product.id,unit:product.unit,kind:'unit'});
    extraBarcodeEntries(product).forEach(item=>{ if(item.code) owners.push({code:String(item.code).trim(),pid:product.id,unit:item.unit,kind:'extra'}); });
    (product.vendorBarcodes||[]).forEach(item=>{ if(item?.code) owners.push({code:String(item.code).trim(),pid:product.id,unit:'',kind:'vendor'}); });
    (product.units||[]).forEach(unit=>{ if(unit?.barcode) owners.push({code:String(unit.barcode).trim(),pid:product.id,unit:unit.sub,kind:'unit'}); });
  });
  return owners;
}

function productBarcodeFields(product){
  return [
    {code:product?.barcode,label:`หน่วยหลัก${product?.unit?` (${product.unit})`:''}`},
    ...(product?.units||[]).map((item,index)=>({code:item?.barcode,label:`หน่วยเพิ่มเติมแถวที่ ${index+1}${item?.sub?` (${item.sub})`:''}`})),
    ...extraBarcodeEntries(product).map((item,index)=>({code:item.code,label:`บาร์โค้ดเพิ่มเติมแถวที่ ${index+1}`})),
    ...(product?.vendorBarcodes||[]).map((item,index)=>({code:item?.code,label:`บาร์โค้ดผู้จำหน่ายแถวที่ ${index+1}`})),
  ].map(item=>({...item,code:String(item.code??'').trim()})).filter(item=>item.code);
}
function productBarcodeCodes(product){
  return [...new Set(productBarcodeFields(product).map(item=>item.code.toLowerCase()))].sort();
}
function productBarcodeConflictMessage(code,owner){
  return `บาร์โค้ด ${code} มีอยู่ในสินค้าอื่นแล้ว${owner?.name?`: ${owner.name}${owner.sku?` (${owner.sku})`:''}`:''} กรุณาใช้บาร์โค้ดอื่น`;
}
function productBarcodeValidationError(product,existingId=null){
  // Check the raw fields before deduplicating codes for the cross-product lookup.
  const seen=new Map();
  for(const field of productBarcodeFields(product)){
    const key=field.code.toLowerCase();
    if(seen.has(key)) return `บาร์โค้ด ${field.code} ซ้ำกันระหว่าง ${seen.get(key)} กับ ${field.label} กรุณาแก้ไขหรือลบเลขที่ซ้ำก่อนบันทึก`;
    seen.set(key,field.label);
  }
  const codes=new Set(productBarcodeCodes(product));
  const conflict=barcodePrintBarcodeOwners().find(owner=>String(owner.pid)!==String(existingId)&&codes.has(String(owner.code).trim().toLowerCase()));
  return conflict?productBarcodeConflictMessage(conflict.code,products.find(item=>String(item.id)===String(conflict.pid))):'';
}
async function loadServerBarcodeOwners(codes){
  const unique=[...new Set(codes)];
  if(!unique.length) return [];
  if(!navigator.onLine) throw new Error('กรุณาเชื่อมต่ออินเทอร์เน็ตเพื่อตรวจบาร์โค้ดซ้ำก่อนบันทึกสินค้า');
  const owners=[];
  for(let offset=0;offset<unique.length;offset+=1000){
    const {data,error}=await sb.rpc('find_product_barcode_owners',{p_codes:unique.slice(offset,offset+1000),p_warehouse_id:Number(activeWarehouseId)});
    if(error) throw new Error('ตรวจบาร์โค้ดกับเซิร์ฟเวอร์ไม่สำเร็จ ยังไม่ได้บันทึกสินค้า กรุณาลองใหม่');
    owners.push(...(data||[]));
  }
  return owners;
}
async function assertProductBarcodesAvailable(product,existing=null){
  const localError=productBarcodeValidationError(product,existing?.id);
  if(localError) throw new Error(localError);
  const codes=productBarcodeCodes(product);
  if(existing&&JSON.stringify(codes)===JSON.stringify(productBarcodeCodes(existing))) return;
  const owners=await loadServerBarcodeOwners(codes);
  const conflict=owners.find(owner=>String(owner.product_id)!==String(existing?.id));
  if(conflict) throw new Error(productBarcodeConflictMessage(conflict.barcode,conflict));
}

function createBarcodePrintItem(product,scan=null){
  const options=barcodePrintSelectableUnitOptions(product);
  const selected=scan?options.find(option=>option.name===scan.unitName&&option.barcode.toUpperCase()===scan.barcode.toUpperCase()):options[0];
  if(!selected) return null;
  return {pid:product.id,unit:selected.name,barcode:selected.barcode,qty:1};
}

function barcodePrintAddProduct(product,scan=null){
  if(!product) return false;
  const item=createBarcodePrintItem(product,scan);
  if(!item) return false;
  const existing=barcodePrintFindProductItem(product.id);
  if(existing){
    if(!scan) return false;
    Object.assign(existing,{unit:item.unit,barcode:item.barcode});
    return true;
  }
  barcodePrintItems.push(item);
  barcodePrintPage=Math.max(1,Math.ceil(barcodePrintItems.length/BARCODE_PRINT_PAGE_SIZE));
  return true;
}

function barcodePrintMatchesQuery(product,query){
  const value=String(query||'').trim();
  if(!value) return true;
  const needle=value.toLowerCase();
  return String(product.name||'').toLowerCase().includes(needle)||String(product.sku||'').toLowerCase().includes(needle)||matchesBarcode(product,value);
}

function barcodePrintValidation(items=barcodePrintItems){
  if(!items.length) return [{index:-1,message:'กรุณาเลือกหน่วยสินค้าที่ยังไม่มีบาร์โค้ดก่อนพิมพ์'}];
  const owners=barcodePrintBarcodeOwners();
  const queueCodes=new Map();
  const errors=[];
  items.forEach((item,index)=>{
    const product=products.find(entry=>entry.id===item.pid);
    const code=String(item.barcode||'').trim();
    const row=index+1;
    if(!product){ errors.push({index,message:`แถว ${row}: ไม่พบสินค้า`}); return; }
    if(!isProductActive(product)){ errors.push({index,message:`แถว ${row}: สินค้านี้เลิกใช้งานแล้ว`}); return; }
    const option=barcodePrintUnitOptions(product).find(entry=>entry.name===item.unit);
    if(!option){ errors.push({index,message:`แถว ${row}: ไม่พบหน่วยสินค้าที่เลือก`}); return; }
    if(option.barcode){ errors.push({index,message:`แถว ${row}: หน่วย ${item.unit} มีบาร์โค้ดแล้ว กรุณาเลือกเฉพาะหน่วยที่ยังไม่มีบาร์โค้ด`}); return; }
    if(code){
      try{ code128BValues(code); }catch(error){ errors.push({index,message:`แถว ${row}: ${error.message}`}); return; }
      if(code.length>48){ errors.push({index,message:`แถว ${row}: บาร์โค้ดยาวเกิน 48 ตัว`}); return; }
    }
    if(!Number.isInteger(Number(item.qty))||Number(item.qty)<1||Number(item.qty)>500){ errors.push({index,message:`แถว ${row}: จำนวนฉลากต้องเป็น 1–500`}); }
    if(!code) return; // The server assigns the selected store's barcode at print time.
    const currentKey=barcodePrintTargetKey(item.pid,item.unit);
    const conflict=owners.find(owner=>owner.code===code&&(owner.kind!=='unit'||barcodePrintTargetKey(owner.pid,owner.unit)!==currentKey));
    if(conflict){
      const conflictProduct=products.find(entry=>entry.id===conflict.pid);
      errors.push({index,message:`แถว ${row}: บาร์โค้ด ${code} ถูกใช้กับ ${conflictProduct?.name||'สินค้าอื่น'} แล้ว`});
    }
    if(queueCodes.has(code)&&queueCodes.get(code)!==currentKey) errors.push({index,message:`แถว ${row}: บาร์โค้ด ${code} ซ้ำในรายการพิมพ์`});
    else queueCodes.set(code,currentKey);
  });
  return errors;
}

function barcodePrintPagination(itemList=barcodePrintItems,page=barcodePrintPage,pageSize=BARCODE_PRINT_PAGE_SIZE){
  const totalPages=Math.max(1,Math.ceil(itemList.length/pageSize));
  const currentPage=Math.min(Math.max(1,Number(page)||1),totalPages);
  const start=(currentPage-1)*pageSize;
  return {rows:itemList.slice(start,start+pageSize).map((item,offset)=>({item,index:start+offset})),currentPage,totalPages};
}
