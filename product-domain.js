// Shared, side-effect-free catalog rules. Used by desktop, mobile and imports.
// Keep DOM, storage and database calls outside this file.
function productStructureValidationError(product){
  const text=value=>String(value??'').trim();
  const validMoney=value=>value!==null&&text(value)!==''&&Number.isFinite(Number(value))&&Number(value)>=0;
  if(!text(product.name)||!text(product.unit)) return 'กรุณาระบุชื่อสินค้าและหน่วยหลัก';
  if(!validMoney(product.price)||!validMoney(product.cost)) return 'ราคาขายและราคาทุนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป';
  if(product.units!=null&&!Array.isArray(product.units)) return 'โครงสร้างหน่วยสินค้าไม่ถูกต้อง';
  const rows=product.units||[];
  const main=text(product.unit),byName=new Map();
  for(const [index,row] of rows.entries()){
    const name=text(row?.sub);
    if(!name||name.startsWith('__')) return `กรุณาระบุหน่วยเพิ่มเติมแถวที่ ${index+1} ก่อนบันทึก`;
    if(name===main||byName.has(name)) return 'ชื่อหน่วยสินค้าเพิ่มเติมต้องไม่ซ้ำกันหรือซ้ำกับหน่วยหลัก';
    byName.set(name,row);
    if(!Number.isFinite(Number(row.per))||Number(row.per)<=0) return `กรุณากรอกจำนวนต่อหน่วยของหน่วยเพิ่มเติมแถวที่ ${index+1} ให้มากกว่า 0 ก่อนบันทึก`;
    if(!validMoney(row.price??0)||!validMoney(row.cost??0)) return 'ราคาของหน่วยสินค้าเพิ่มเติมต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป';
  }
  for(const row of rows){
    let name=text(row.sub),factor=1;
    const visited=new Set();
    while(name!==main){
      if(visited.has(name)||!byName.has(name)) return 'หน่วยอ้างอิงไม่ถูกต้อง หรืออ้างอิงหน่วยวนกลับกัน';
      visited.add(name);
      const current=byName.get(name);
      factor*=Number(current.per);
      name=text(current.base)||main;
    }
    const stored=Number(row.factor);
    if(!Number.isFinite(factor)||factor<=0||!Number.isFinite(stored)||stored<=0||Math.abs(stored-factor)>Math.max(1,Math.abs(factor))*1e-6) return 'อัตราแปลงหน่วยไม่ตรงกับจำนวนต่อหน่วย กรุณาตรวจสอบหน่วยเพิ่มเติม';
  }
  return '';
}
if(typeof module!=='undefined'&&module.exports) module.exports={productStructureValidationError};
