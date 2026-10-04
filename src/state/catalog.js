// ---------- Data ----------
// กู้ชุดข้อมูลเดิมหนึ่งครั้ง หลังการรีเซ็ตครั้งก่อนที่ยังไม่มีระบบสำรองข้อมูล
const RESET_RECOVERY_ONCE_KEY='pos2_reset_recovery_20260813_v1';
if(localStorage.getItem(RESET_RECOVERY_ONCE_KEY)!=='done'){
  Object.keys(localStorage).filter(key=>key.startsWith('pharmacy_pos_')).forEach(key=>localStorage.removeItem(key));
  localStorage.setItem(RESET_RECOVERY_ONCE_KEY,'done');
}
let warehouses=[];
const WAREHOUSE_STORAGE_KEY='pharmacy_pos_warehouses_v1';
try{ const savedWarehouses=JSON.parse(localStorage.getItem(WAREHOUSE_STORAGE_KEY)||'null'); if(Array.isArray(savedWarehouses)&&savedWarehouses.length) warehouses=savedWarehouses; }catch(error){ console.warn('ไม่สามารถโหลดรายชื่อคลังสินค้าได้',error); }
function persistWarehouses(){ persistWorkspaceData(); }
let nextWarehouseId=maxArrayValue(warehouses,w=>(Number(w.id)||0)+1,1);
let products=[];
let productByIdMap=new Map(),exactProductCodeMap=new Map();
function rebuildProductLookupMaps(){
  productByIdMap=new Map();
  exactProductCodeMap=new Map();
  const addCode=(code,product,unitName)=>{
    const key=String(code||'').trim();
    if(key&&!exactProductCodeMap.has(key)) exactProductCodeMap.set(key,{product,unitName});
  };
  products.forEach(product=>{
    productByIdMap.set(Number(product.id),product);
    if(product.active===false) return;
    addCode(product.barcode,product,product.unit);
    addCode(product.sku,product,product.unit);
    (product.vendorBarcodes||[]).forEach(entry=>addCode(entry?.code,product,product.unit));
    extraBarcodeEntries(product).forEach(entry=>addCode(entry.code,product,entry.unit));
    (product.units||[]).forEach(unit=>addCode(unit?.barcode,product,unit?.sub));
  });
}
function productById(id){ return productByIdMap.get(Number(id))||null; }
rebuildProductLookupMaps();

let contacts=[];
const CONTACTS_STORAGE_KEY='pharmacy_pos_contacts_v1';
try{ const savedContacts=JSON.parse(localStorage.getItem(CONTACTS_STORAGE_KEY)||'null'); if(Array.isArray(savedContacts)) contacts=savedContacts; }catch(error){ console.warn('ไม่สามารถโหลดสมุดรายชื่อได้',error); }
function persistContacts(){ persistWorkspaceData(); }
async function persistContactImmediately(contact){
  if(!currentProfile||!contact) return true;
  return withRevisionedTableLock('contacts',async()=>{
  // A queued background save may already have acknowledged this exact draft.
  const live=contacts.find(row=>String(row.id)===String(contact.id));
  if(!live) throw new Error('รายชื่อนี้ถูกนำออกจากเครื่องระหว่างบันทึก');
  if(syncedTableRows.contacts?.get(String(live.id))===JSON.stringify(contactToRow(live))&&!workspaceRecoveryEntries.has(`contacts:${live.id}`)) return true;
  if(!Number(live._revision)&&!live._clientCreateToken) live._clientCreateToken=generateProductCreateToken();
  const sent=cloneSyncRecords([live]);
  await ensureWorkspaceRecoveryDurable();
  const acknowledge=syncAcknowledgement('contacts',contacts,contactToRow);
  const error=(Number(sent[0]._revision)||0)>0
    ?await updateRevisionedRows('contacts',sent,contactToRow,acknowledge)
    :await insertRevisionedRows('contacts',sent,contactToRow,acknowledge);
  if(error) throw error;
  upsertAndPrune.paused?.delete(`contacts:${live.id}`);
  await ensureWorkspaceRecoveryDurable();
  return true;
  });
}
let contactFilter = 'all'; // all | customer | supplier | both
let contactPage = 1;
const CONTACTS_PER_PAGE = 10;
let editingContactId = null; // null=list, 'new', หรือ id
let editingCustomerPriceContactId = null;
let salesRepresentatives=[];
let editingSalesRepresentativeId = null;
// ===== ระบบโปรโมชั่น =====
// scope: 'product' (ผูกสินค้าเดี่ยว) | 'category' (ผูกหมวด/แบรนด์)
// type: 'discount' (ลด%/ลดเงินสด) | 'bundle' (ราคาพิเศษเมื่อซื้อครบจำนวน) | 'buygetdiff' (ซื้อสินค้าหนึ่ง แถมอีกสินค้าหนึ่ง)
let promotions = [];
const PROMOTIONS_STORAGE_KEY='pharmacy_pos_promotions_v1';
try{ const savedPromotions=JSON.parse(localStorage.getItem(PROMOTIONS_STORAGE_KEY)||'null'); if(Array.isArray(savedPromotions)) promotions=savedPromotions; }catch(error){ console.warn('ไม่สามารถโหลดโปรโมชั่นได้',error); }
function promotionToRow(promotion){ return {id:promotion.id,data:additionalData(promotion,['id','_revision']),revision:Number(promotion._revision)||0}; }
async function syncPromotionsToSupabase(){
  if(!currentProfile) return;
  try{ await upsertAndPrune('promotions',promotions,promotionToRow); }
  catch(error){ console.warn('sync promotions failed',error); }
}
async function loadPromotionsFromSupabase(){
  if(!currentProfile) return;
  try{
    const {data,error}=await fetchAllRows(()=>sb.from('promotions').select('*').order('id'));
    if(error){ console.warn('load promotions',error); return; }
    if((data||[]).length){
      promotions=data.map(row=>({...(row.data||{}),id:row.id,_revision:Number(row.revision)||1}));
      seedTableSnapshot('promotions',promotions,promotionToRow);
    }else{
      seedTableSnapshot('promotions',[],promotionToRow);
      if(promotions.length) await syncPromotionsToSupabase();
    }
  }catch(error){ console.warn('load promotions failed',error); }
}
function persistPromotions(){
  persistWorkspaceData();
  localStorage.removeItem(PROMOTIONS_STORAGE_KEY);
  syncPromotionsToSupabase();
}
let editingPromotionId = null; // null=list, 'new', หรือ id
let currentPromoDraftItems = null; // รายการสินค้าที่เจาะจงเลือกในฟอร์มโปรโมชั่น (โหมด scope=category, categoryMode=select) — sync จาก promo.items ทุกครั้งที่เปิดฟอร์ม
let promoDraftItemsSyncedFor = undefined; // ติดตามว่า currentPromoDraftItems sync จาก editingPromotionId ตัวไหนไปแล้ว กัน overwrite ระหว่างแก้ไขที่ยังไม่ได้บันทึก
function customersList(){ return contacts.filter(c=>c.types.includes('customer')); }
function suppliersList(){ return contacts.filter(c=>c.types.includes('supplier')); }
let employees = [ 'เภสัชกรหญิงมานี', 'พนักงานขายสมชาย' ];
let categories = [ 'ไม่ทราบหมวดหมู่' ]; // 'ไม่ทราบหมวดหมู่' is a real fallback the app relies on (products with no category); the rest fill in from actual product data via refreshCategoryBrandUnitLists()
let units = [ 'แผง', 'ซอง', 'ขวด', 'กระปุก', 'กล่อง', 'ห่อ', 'ชิ้น', 'โหล', 'แพ็ค', 'ลัง', 'หลอด', 'ม้วน', 'กระป๋อง', 'ถุง' ];
function addUnitIfNew(u){ u=(u||'').trim(); if(u && !units.includes(u)) units.push(u); return u; }
function addCategoryIfNew(c){ c=(c||'').trim(); if(c && !categories.includes(c)) categories.push(c); return c; }
let brands = [ 'ทั่วไป' ]; // 'ทั่วไป' is a real fallback the app relies on (products with no brand); the rest fill in from actual product data via refreshCategoryBrandUnitLists()
function addBrandIfNew(b){ b=(b||'').trim(); if(b && !brands.includes(b)) brands.push(b); return b; }
// เติม categories/units/brands ให้ครบตามข้อมูลสินค้าจริงที่มีอยู่ (จำเป็นหลังโหลดสินค้าจำนวนมากจาก Supabase
// ซึ่งไม่ได้ผ่านฟอร์ม "เพิ่มสินค้า" ทีละรายการที่จะเรียก addCategoryIfNew/addUnitIfNew/addBrandIfNew ให้เองตามปกติ)
function refreshCategoryBrandUnitLists(){
  products.forEach(p=>{ addCategoryIfNew(p.category); addBrandIfNew(p.brand); addUnitIfNew(p.unit); });
}
let productTypes = [ ['stock','สินค้านับสต็อก'], ['nostock','สินค้าไม่นับสต็อก'] ];
