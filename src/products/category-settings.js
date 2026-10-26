// A shared name can belong to several main categories. Keep product.category /
// product.brand unchanged so existing products and document history remain intact.
let productCategorySettings={categories:[],subcategories:[]};
let productCategorySettingsLoaded=false;
let productCategorySettingsError='';
let productCategorySettingsLoading=false;
let productCategorySettingsSaving=false;
function categoryName(value){ return String(value||'').trim(); }
function validMainCategory(value){ const name=categoryName(value); return !!name&&name!=='ไม่ทราบหมวดหมู่'&&!name.startsWith('__'); }
function normalizeProductCategorySettings(value){
  const categories=[...new Set((Array.isArray(value?.categories)?value.categories:[]).map(categoryName).filter(validMainCategory))];
  const subcategories=[];
  for(const row of Array.isArray(value?.subcategories)?value.subcategories:[]){
    const name=categoryName(row?.name);
    if(!name||name==='ทั่วไป'||name.startsWith('__')) continue;
    let target=subcategories.find(item=>item.name===name);
    if(!target){ target={name,categories:[]}; subcategories.push(target); }
    target.categories=[...new Set([...target.categories,...(Array.isArray(row.categories)?row.categories:[]).map(categoryName).filter(cat=>categories.includes(cat))])];
  }
  return {categories,subcategories};
}
function effectiveProductCategorySettings(value=productCategorySettings,rows=products){
  const result=normalizeProductCategorySettings(value);
  for(const product of rows){
    const cat=categoryName(product.category),sub=categoryName(product.brand)||'ทั่วไป';
    if(!validMainCategory(cat)) continue;
    if(!result.categories.includes(cat)) result.categories.push(cat);
    if(sub==='ทั่วไป'||sub.startsWith('__')) continue;
    let row=result.subcategories.find(item=>item.name===sub);
    if(!row){ row={name:sub,categories:[]}; result.subcategories.push(row); }
    if(!row.categories.includes(cat)) row.categories.push(cat);
  }
  return result;
}
function productSubcategoryNames(cat,settings=effectiveProductCategorySettings()){
  return ['ทั่วไป',...settings.subcategories.filter(row=>row.categories.includes(categoryName(cat))).map(row=>row.name)];
}
function productCategoryValidationError(cat,sub,settings=effectiveProductCategorySettings()){
  if(!validMainCategory(cat)||!settings.categories.includes(categoryName(cat))) return 'กรุณาเลือกหมวดสินค้าหลักก่อนบันทึก';
  if(!productSubcategoryNames(cat,settings).includes(categoryName(sub)||'ทั่วไป')) return 'หมวดสินค้าย่อยนี้ใช้ไม่ได้กับหมวดหลักที่เลือก กรุณาเลือกใหม่';
  return '';
}
function productCategorySelects(product){
  const settings=effectiveProductCategorySettings();
  const cat=categoryName(product.category),sub=categoryName(product.brand)||'ทั่วไป';
  const options=(names,selected)=>names.map(name=>`<option value="${escapeHtml(name)}" ${name===selected?'selected':''}>${escapeHtml(name)}</option>`).join('');
  return {
    main:`<select id="f_category" required aria-required="true"><option value="">เลือกหมวดสินค้าหลัก</option>${options(settings.categories,cat)}</select>`,
    sub:`<select id="f_brand" ${validMainCategory(cat)?'':'disabled'}>${options(productSubcategoryNames(cat,settings),sub)}</select>`,
  };
}
function attachProductCategorySelectEvents(){
  const main=document.getElementById('f_category'),sub=document.getElementById('f_brand');
  if(!main||!sub||main._categoryBound) return;
  main._categoryBound=true;
  main.addEventListener('change',()=>{
    const previous=sub.value,names=productSubcategoryNames(main.value);
    sub.innerHTML=names.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    sub.value=names.includes(previous)?previous:'ทั่วไป';
    sub.disabled=!validMainCategory(main.value);
  });
}
async function loadProductCategorySettingsFromSupabase(){
  const context=captureWorkspaceRead();
  productCategorySettingsLoading=true;
  try{
    const {data,error}=await sb.from('settings').select('value').eq('key','product_categories').maybeSingle();
    if(!isWorkspaceReadCurrent(context)) return false;
    if(error) throw error;
    productCategorySettings=normalizeProductCategorySettings(data?.value);
    refreshCategoryBrandUnitLists();
    productCategorySettingsLoaded=true;
    productCategorySettingsError='';
    return true;
  }catch(error){
    if(isWorkspaceReadCurrent(context)) productCategorySettingsError='โหลดหมวดสินค้าไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่';
    return false;
  }finally{
    if(isWorkspaceReadCurrent(context)) productCategorySettingsLoading=false;
  }
}
async function saveProductCategorySettings(value){
  if(currentProfile?.owner!==true) throw new Error('เฉพาะเจ้าของร้านเท่านั้นที่ตั้งค่าหมวดสินค้าได้');
  if(!productCategorySettingsLoaded||productCategorySettingsError) throw new Error('กรุณาโหลดหมวดสินค้าให้สำเร็จก่อนบันทึก');
  if(navigator.onLine===false) throw new Error('กรุณาเชื่อมต่ออินเทอร์เน็ตก่อนบันทึกหมวดสินค้า');
  if(productCategorySettingsSaving) throw new Error('กำลังบันทึกหมวดสินค้า กรุณารอสักครู่');
  const context=captureWorkspaceRead(),next=normalizeProductCategorySettings(value);
  productCategorySettingsSaving=true;
  try{
    const {error}=await sb.rpc('owner_set_setting',{p_key:'product_categories',p_value:next});
    if(error) throw error;
    if(!isWorkspaceReadCurrent(context)) throw new Error('ผู้ใช้งานเปลี่ยนระหว่างบันทึก กรุณาเปิดหน้าตั้งค่าใหม่');
    productCategorySettings=next;
    productCategorySettingsError='';
    refreshCategoryBrandUnitLists();
    persistWorkspaceData();
  }finally{ productCategorySettingsSaving=false; }
}
