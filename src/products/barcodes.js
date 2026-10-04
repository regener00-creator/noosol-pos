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
    {name:product.unit||'ชิ้น',barcode:String(product.barcode||''),price:Number(product.price)||0,isMain:true,index:0},
    ...(product.units||[]).filter(unit=>unit.sub).map((unit,index)=>({name:unit.sub,barcode:String(unit.barcode||''),price:Number(unit.price)||0,isMain:false,index:index+1}))
  ];
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
    const {data,error}=await sb.rpc('find_product_barcode_owners',{p_codes:unique.slice(offset,offset+1000)});
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

function generateInternalBarcode(product,unitName){
  const options=barcodePrintUnitOptions(product);
  const optionIndex=Math.max(0,options.findIndex(option=>option.name===unitName));
  const stem=`PEPOS${String(Number(product?.id)||0).padStart(7,'0')}${String(optionIndex).padStart(2,'0')}`;
  const used=new Set(barcodePrintBarcodeOwners().map(owner=>owner.code));
  barcodePrintItems.forEach(item=>{ if(item.barcode) used.add(String(item.barcode).trim()); });
  if(!used.has(stem)) return stem;
  let suffix=1;
  while(used.has(`${stem}-${suffix}`)) suffix++;
  return `${stem}-${suffix}`;
}

function createBarcodePrintItem(product){
  const options=barcodePrintUnitOptions(product);
  const selected=options.find(option=>!option.barcode)||options[0];
  return {pid:product.id,unit:selected.name,barcode:selected.barcode||generateInternalBarcode(product,selected.name),qty:1};
}

function barcodePrintAddProduct(product){
  if(!product) return false;
  if(barcodePrintFindProductItem(product.id)) return false;
  barcodePrintItems.push(createBarcodePrintItem(product));
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
  const owners=barcodePrintBarcodeOwners();
  const queueCodes=new Map();
  const errors=[];
  items.forEach((item,index)=>{
    const product=products.find(entry=>entry.id===item.pid);
    const code=String(item.barcode||'').trim();
    const row=index+1;
    if(!product){ errors.push({index,message:`แถว ${row}: ไม่พบสินค้า`}); return; }
    const option=barcodePrintUnitOptions(product).find(entry=>entry.name===item.unit);
    if(!option){ errors.push({index,message:`แถว ${row}: ไม่พบหน่วยสินค้าที่เลือก`}); return; }
    try{ code128BValues(code); }catch(error){ errors.push({index,message:`แถว ${row}: ${error.message}`}); return; }
    if(!Number.isInteger(Number(item.qty))||Number(item.qty)<1||Number(item.qty)>500){ errors.push({index,message:`แถว ${row}: จำนวนฉลากต้องเป็น 1–500`}); }
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
