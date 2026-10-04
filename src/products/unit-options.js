function productUnitOptions(p){
  // คืน list ของหน่วยที่เลือกได้: หน่วยหลัก + หน่วยรองที่ตั้งไว้ (label = ชื่อหน่วยล้วน)
  const opts=[{name:p.unit, label:p.unit, price:p.price, cost:productUnitCost(p,p.unit,1), factor:1, barcode:p.barcode||''}];
  (p.units||[]).forEach(u=>{
    // Never invent a 1:1 conversion for corrupt legacy data. Explicit zero prices are valid.
    const factor=Number(u.factor);
    if(u.sub&&u.sub!==p.unit&&Number.isFinite(factor)&&factor>0&&!opts.some(option=>option.name===u.sub)) opts.push({name:u.sub,label:u.sub,price:u.price??p.price*factor,cost:productUnitCost(p,u.sub,factor),factor,barcode:u.barcode||''});
  });
  return opts;
}
function productBarcodeForUnit(product,unitName){
  if(!product) return '';
  if(!unitName||unitName===product.unit) return String(product.barcode||'').trim();
  return String((product.units||[]).find(unit=>unit.sub===unitName)?.barcode||'').trim();
}
function smallestProductUnitName(product){
  if(!product) return '';
  const options=productUnitOptions(product).filter(option=>Number(option.factor)>0);
  if(!options.length) return String(product?.unit||'');
  return options.reduce((smallest,option)=>Number(option.factor)<Number(smallest.factor)?option:smallest,options[0]).name;
}
function consumePosSaleUnit(product,fallbackUnitName=null){
  if(!posSmallestUnitOnce) return fallbackUnitName;
  posSmallestUnitOnce=false;
  return smallestProductUnitName(product)||fallbackUnitName;
}
function isPosSmallestUnitCommand(value){
  return String(value||'').trim().toUpperCase()===POS_SMALLEST_UNIT_COMMAND;
}
function setPosSmallestUnitOnce(enabled,{announce=true}={}){
  posSmallestUnitOnce=Boolean(enabled);
  searchQuery='';
  render();
  setTimeout(()=>document.getElementById('search')?.focus(),0);
  if(announce) showToast(posSmallestUnitOnce?'พร้อมแล้ว — สินค้ารายการถัดไปจะขายเป็นหน่วยเล็กสุด':'ยกเลิกการขายหน่วยเล็กสุดแล้ว');
}
function favoriteProductId(entry){
  const value=entry&&typeof entry==='object'?(entry.pid??entry.productId):entry;
  const id=Number(value);
  return Number.isFinite(id)&&id>0?id:0;
}
function favoriteSelectedUnit(entry,product){
  const requested=String(entry&&typeof entry==='object'?(entry.unit||''):'').trim();
  if(!product) return requested;
  const options=productUnitOptions(product);
  return options.some(option=>option.name===requested)?requested:String(product.unit||options[0]?.name||'');
}
function favoriteEntryForProduct(product,unitName){
  if(!product) return null;
  return {pid:Number(product.id),unit:favoriteSelectedUnit({unit:unitName},product)};
}
function normalizeFavorites(value,productList=products){
  if(!Array.isArray(value)) return [];
  const seen=new Set(),result=[];
  value.forEach(entry=>{
    const pid=favoriteProductId(entry);
    if(!pid||seen.has(pid)) return;
    const product=(productList||[]).find(item=>Number(item.id)===pid);
    if(product&&product.active===false) return;
    result.push({pid,unit:favoriteSelectedUnit(entry,product)});
    seen.add(pid);
  });
  return result;
}
function favoriteHasProduct(productId){
  return favorites.some(entry=>favoriteProductId(entry)===Number(productId));
}
function saveFavorites(){
  favorites=normalizeFavorites(favorites);
  persistWorkspaceData();
  syncFavoritesToSupabase();
}
// แปลงสต็อก (นับเป็นหน่วยหลัก) ให้แสดงเป็นหน่วยใหญ่สุด เช่น 120 แผง -> "1 ลัง 2 กล่อง" (เศษ)
function stockInLargestUnit(p){
  const units = (p.units||[]).filter(u=>u.sub && u.factor>0).slice().sort((a,b)=>b.factor-a.factor);
  let remain = p.stock;
  const parts = [];
  for(const u of units){ const n = Math.floor(remain/u.factor); if(n>0){ parts.push(`${n} ${u.sub}`); remain -= n*u.factor; } }
  if(remain>0 || parts.length===0) parts.push(`${remain} ${p.unit}`);
  return parts.join(' ');
}
// แตกสต็อกเป็นทุกหน่วย (เต็มจำนวนในแต่ละหน่วย) สำหรับ tooltip/ป๊อปอัป
function stockAllUnits(p){
  const rows = [{name:p.unit, factor:1}, ...(p.units||[]).filter(u=>u.sub&&u.factor>0).map(u=>({name:u.sub, factor:u.factor}))];
  rows.sort((a,b)=>b.factor-a.factor);
  return rows.map(r=>({ name:r.name, factor:r.factor, amount: p.stock/r.factor }));
}
function stockBaseFromUnitAmount(amount,factor){ const f=Number(factor); return (Number(amount)||0)*(f>0?f:1); }
function stockUnitAmountFromBase(baseStock,factor){ const f=Number(factor); return Math.round(((Number(baseStock)||0)/(f>0?f:1))*100)/100; }
