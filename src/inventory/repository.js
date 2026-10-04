// ----- Core data sync: warehouses, products, contacts, sales reps -----
// Queryable fields live in real columns; `data` keeps only additional metadata.
// Local arrays remain the UI model while incremental sync sends changed rows.
const ACTIVE_WAREHOUSE_STORAGE_KEY='pepos_active_warehouse_v1';
let activeWarehouseId=0;
let allWarehousesMode=false;
let warehouseAccessRows=[];
let pagePermissionRows=[];
let inventoryBalanceRows=[];
let inventoryBalanceMap=new Map();
let inventoryLotRows=[];
let inventoryLotMap=new Map();
let loadedInventoryBalanceWarehouseIds=new Set();
let loadedInventoryLotWarehouseIds=new Set();
let inventoryWarehouseLoadPromises=new Map();
function inventoryBalanceKey(productId,warehouseId){ return `${Number(warehouseId)||0}:${Number(productId)||0}`; }
function inventoryLotKey(productId,warehouseId){ return inventoryBalanceKey(productId,warehouseId); }
function rebuildInventoryBalanceMap(){
  inventoryBalanceMap=new Map((inventoryBalanceRows||[]).map(row=>[inventoryBalanceKey(row.product_id,row.warehouse_id),row]));
}
function rebuildInventoryLotMap(){
  inventoryLotMap=new Map();
  (inventoryLotRows||[]).forEach(row=>{
    const key=inventoryLotKey(row.product_id,row.warehouse_id);
    const rows=inventoryLotMap.get(key)||[];
    rows.push(row);
    inventoryLotMap.set(key,rows);
  });
}
function accessibleWarehouses(){
  if(currentProfile?.owner) return warehouses||[];
  const allowed=new Set((warehouseAccessRows||[]).filter(row=>row.can_sell!==false).map(row=>Number(row.warehouse_id)));
  return (warehouses||[]).filter(warehouse=>allowed.has(Number(warehouse.id)));
}
const PAGE_PERMISSION_OPTIONS=[
  ['dashboard','ภาพรวม'],['checkout','ขายสินค้า'],['notes','NOTE'],['cashshift','เปิด-ปิดระบบชำระ'],['history','ประวัติการขาย'],
  ['goodsreceipt','ใบรับสินค้า'],['products','รายการสินค้า'],['inventorymovement','รายงานการเคลื่อนไหว'],
  ['rinventory','รายงานสินค้าคงเหลือ'],['lowstock','สินค้าใกล้หมด'],['expiry','สินค้าใกล้หมดอายุ'],
  ['rproduct','รายงานสินค้า'],['rbill','รายงานบิล'],['cashbill','บิลเงินสด'],['inspectionlists','ตรวจนับและปรับสต๊อก'],
  ['purchaseorder','สั่งซื้อสินค้า'],['productreturn','ใบคืนสินค้า'],
  ['productexchange','เปลี่ยนสินค้า'],['contacts','ผู้จำหน่าย / ลูกค้า'],['salesreps','ผู้แทน'],
  ['taxinvoice','ใบกำกับภาษีเต็มรูปแบบ'],['quotation','ใบเสนอราคา'],['barcodeprint','พิมพ์ป้ายราคา'],
  ['promotions','โปรโมชั่น'],['warehouse','คลังสินค้า / สาขา'],['transfer','โอนย้ายสต๊อก'],
  ['rprofit','รายงานกำไร'],['rtax','รายงานภาษี']
];
function permissionsForPage(pageKey,warehouseId=activeWarehouseId,rows=pagePermissionRows){
  const pageRows=(rows||[]).filter(row=>String(row.page_key||row.pageKey)===String(pageKey));
  const warehouseRows=pageRows.filter(row=>Number(row.warehouse_id||row.warehouseId)===Number(warehouseId));
  return warehouseRows.length?warehouseRows:pageRows.filter(row=>row.warehouse_id==null&&row.warehouseId==null);
}
function canPerformPageAction(action='view',pageKey=currentTab,user=loggedInUser(),rows=pagePermissionRows){
  // Both contact views retain the existing database permission key.
  if(pageKey==='customers') pageKey='contacts';
  if(user?.owner===true||Number(user?.level)===1) return true;
  // Unknown/future staff levels must fail closed.  Previously Level 3/4
  // bypassed the permission matrix and received every action implicitly.
  if(Number(user?.level)!==2) return false;
  const allRows=rows||[];
  if(!allRows.length){
    if(action==='view') return !LEVEL2_HIDDEN_TABS.has(pageKey);
    if(pageKey==='notes') return ['create','edit','delete'].includes(action);
    return ['checkout','cashshift','goodsreceipt','inspectionlists'].includes(pageKey)&&['create','edit','print'].includes(action);
  }
  const matches=permissionsForPage(pageKey,activeWarehouseId,allRows);
  if(!matches.length) return false;
  const column={view:'can_view',create:'can_create',edit:'can_edit',delete:'can_delete',print:'can_print',export:'can_export'}[action]||'can_view';
  return matches.some(row=>row[column]===true||row[column.replace('can_','can')]===true);
}
function canUseAllWarehousesMode(){ return currentProfile?.owner===true&&accessibleWarehouses().length>1&&!isMobileDeviceMode(); }
function isAllWarehousesMode(){ return allWarehousesMode===true; }
function reportWarehouseIds(){ return accessibleWarehouses().map(warehouse=>Number(warehouse.id)).filter(Boolean); }
function activeWarehouse(){ return (warehouses||[]).find(warehouse=>Number(warehouse.id)===Number(activeWarehouseId))||null; }
function warehouseStock(productId,warehouseId=activeWarehouseId){
  return Number(inventoryBalanceMap.get(inventoryBalanceKey(productId,warehouseId))?.stock)||0;
}
function warehouseExpiry(productId,warehouseId=activeWarehouseId){
  return inventoryBalanceMap.get(inventoryBalanceKey(productId,warehouseId))?.expiry||'';
}
function normalizeInventoryLotRow(row){
  return {...row,id:Number(row.id),product_id:Number(row.product_id),warehouse_id:Number(row.warehouse_id),quantity_base:Number(row.quantity_base)||0,unit_cost_base:Number(row.unit_cost_base)||0};
}
function inventoryLotsForProduct(productId,warehouseId=activeWarehouseId,{includeEmpty=true}={}){
  const rows=inventoryLotMap.get(inventoryLotKey(productId,warehouseId))||[];
  return includeEmpty?rows:rows.filter(row=>Number(row.quantity_base)>0);
}
function activeInventoryLotsForProduct(productId,warehouseId=activeWarehouseId){
  return inventoryLotsForProduct(productId,warehouseId,{includeEmpty:false}).filter(row=>row.status!=='blocked');
}
function inventoryLotCount(productId,warehouseId=activeWarehouseId){ return activeInventoryLotsForProduct(productId,warehouseId).length; }
function inventoryLotStatus(row){
  if(Number(row?.quantity_base)<=0||row?.status==='exhausted') return {key:'exhausted',label:'หมดแล้ว'};
  const left=daysUntil(row?.expiry_date);
  if(row?.expiry_date&&left<0) return {key:'expired',label:'หมดอายุ'};
  if(row?.expiry_date&&left<=90) return {key:'near',label:'ใกล้หมดอายุ'};
  return {key:'active',label:'ปกติ'};
}
function allWarehouseStock(productId){
  return reportWarehouseIds().reduce((sum,warehouseId)=>sum+warehouseStock(productId,warehouseId),0);
}
function allWarehouseExpiryRows(productId){
  return reportWarehouseIds().map(warehouseId=>({
    warehouseId,
    warehouseName:warehouses.find(warehouse=>Number(warehouse.id)===warehouseId)?.name||'-',
    expiry:warehouseExpiry(productId,warehouseId)
  })).filter(row=>row.expiry);
}
function earliestWarehouseExpiry(productId){
  return allWarehouseExpiryRows(productId).map(row=>row.expiry).sort()[0]||'';
}
function reportStock(productId,warehouseValue){
  return String(warehouseValue)==='all'?allWarehouseStock(productId):warehouseStock(productId,Number(warehouseValue)||activeWarehouseId);
}
function reportExpiry(productId,warehouseValue){
  return String(warehouseValue)==='all'?earliestWarehouseExpiry(productId):warehouseExpiry(productId,Number(warehouseValue)||activeWarehouseId);
}
function updateInventoryBalanceLocal(productId,warehouseId,stock,expiry){
  const key=inventoryBalanceKey(productId,warehouseId);
  let row=inventoryBalanceMap.get(key);
  if(!row){ row={product_id:Number(productId),warehouse_id:Number(warehouseId),stock:0,expiry:null}; inventoryBalanceRows.push(row); inventoryBalanceMap.set(key,row); }
  row.stock=Number(stock)||0;
  if(expiry!==undefined) row.expiry=expiry||null;
  if(Number(warehouseId)===Number(activeWarehouseId)){
    const product=products.find(item=>Number(item.id)===Number(productId));
    if(product){ product.stock=row.stock; if(expiry!==undefined) product.expiry=row.expiry||''; }
  }
  return row;
}
function applyActiveWarehouseInventory(){
  if(!activeWarehouseId) return;
  (products||[]).forEach(product=>{
    if(product._catalogExpiry===undefined) product._catalogExpiry=product.expiry||'';
    product.stock=warehouseStock(product.id,activeWarehouseId);
    product.expiry=warehouseExpiry(product.id,activeWarehouseId);
  });
}
function normalizedInventoryWarehouseIds(warehouseIds){
  return [...new Set((warehouseIds||[]).map(Number).filter(Boolean))].sort((a,b)=>a-b);
}
function inventoryScopeWarehouseIds(){
  if(isAllWarehousesMode()) return normalizedInventoryWarehouseIds(reportWarehouseIds());
  return normalizedInventoryWarehouseIds([activeWarehouseId]);
}
let inventoryReadGeneration=0;
let inventoryReadChains=new Map();
function queueInventoryRead(kind,read){
  const generation=inventoryReadGeneration,profileId=currentProfile?.id;
  const isCurrent=()=>generation===inventoryReadGeneration&&profileId===currentProfile?.id;
  const previous=inventoryReadChains.get(kind)||Promise.resolve();
  const pending=previous.catch(()=>false).then(()=>isCurrent()?read(isCurrent):false);
  inventoryReadChains.set(kind,pending);
  return pending.finally(()=>{ if(inventoryReadChains.get(kind)===pending) inventoryReadChains.delete(kind); });
}
function normalizedInventoryProductIds(productIds){
  return productIds===null?null:[...new Set((productIds||[]).map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))];
}
async function fetchInventoryScopeRows(queryFactory,productIds){
  if(productIds===null) return fetchAllRows(queryFactory);
  const rows=[];
  for(let offset=0;offset<productIds.length;offset+=200){
    const {data,error}=await fetchAllRows(()=>queryFactory().in('product_id',productIds.slice(offset,offset+200)));
    if(error) return {data:null,error};
    rows.push(...(data||[]));
  }
  return {data:rows,error:null};
}
function resetLoadedInventoryScopes(){
  inventoryReadGeneration++;
  inventoryReadChains=new Map();
  loadedInventoryBalanceWarehouseIds=new Set();
  loadedInventoryLotWarehouseIds=new Set();
  inventoryWarehouseLoadPromises=new Map();
}
async function loadInventoryBalancesFromSupabase({warehouseIds=inventoryScopeWarehouseIds(),force=true,productIds=null}={}){
  if(!currentProfile) return false;
  const requested=normalizedInventoryWarehouseIds(warehouseIds);
  const selected=normalizedInventoryProductIds(productIds);
  if(selected!==null&&!selected.length) return true;
  return queueInventoryRead('balances',async isCurrent=>{
  const targets=force||selected!==null?requested:requested.filter(id=>!loadedInventoryBalanceWarehouseIds.has(id));
  if(!targets.length) return true;
  const {data,error}=await fetchInventoryScopeRows(()=>sb.from('inventory_balances').select('warehouse_id,product_id,stock,expiry,updated_at').in('warehouse_id',targets).order('warehouse_id').order('product_id'),selected);
  if(error){ console.warn('load inventory balances',error); return false; }
  if(!isCurrent()) return false;
  const targetSet=new Set(targets);
  const selectedSet=selected===null?null:new Set(selected);
  inventoryBalanceRows=[
    ...inventoryBalanceRows.filter(row=>!targetSet.has(Number(row.warehouse_id))||(selectedSet&&!selectedSet.has(Number(row.product_id)))),
    ...(data||[]).map(row=>({...row,warehouse_id:Number(row.warehouse_id),product_id:Number(row.product_id),stock:Number(row.stock)||0}))
  ];
  if(selected===null) targets.forEach(id=>loadedInventoryBalanceWarehouseIds.add(id));
  rebuildInventoryBalanceMap(); applyActiveWarehouseInventory(); return true;
  });
}
async function loadInventoryLotsFromSupabase({warehouseIds=inventoryScopeWarehouseIds(),force=true,productIds=null}={}){
  if(!currentProfile) return false;
  const requested=normalizedInventoryWarehouseIds(warehouseIds);
  const selected=normalizedInventoryProductIds(productIds);
  if(selected!==null&&!selected.length) return true;
  return queueInventoryRead('lots',async isCurrent=>{
  const targets=force||selected!==null?requested:requested.filter(id=>!loadedInventoryLotWarehouseIds.has(id));
  if(!targets.length) return true;
  const {data,error}=await fetchInventoryScopeRows(()=>sb.from('inventory_lots').select('id,product_id,warehouse_id,internal_code,manufacturer_lot,expiry_date,quantity_base,unit_cost_base,received_at,source_type,source_id,status,updated_at').in('warehouse_id',targets).gt('quantity_base',0).order('warehouse_id').order('product_id').order('expiry_date',{ascending:true,nullsFirst:false}).order('received_at').order('id'),selected);
  if(error){ console.warn('load inventory lots',error); return false; }
  if(!isCurrent()) return false;
  const targetSet=new Set(targets);
  const selectedSet=selected===null?null:new Set(selected);
  inventoryLotRows=[
    ...inventoryLotRows.filter(row=>!targetSet.has(Number(row.warehouse_id))||(selectedSet&&!selectedSet.has(Number(row.product_id)))),
    ...(data||[]).map(normalizeInventoryLotRow)
  ];
  if(selected===null) targets.forEach(id=>loadedInventoryLotWarehouseIds.add(id));
  rebuildInventoryLotMap();
  return true;
  });
}
async function loadWarehouseInventoryFromSupabase(warehouseIds=inventoryScopeWarehouseIds(),{force=false}={}){
  const targets=normalizedInventoryWarehouseIds(warehouseIds);
  if(!targets.length) return true;
  const key=`${force?'force':'cached'}:${targets.join(',')}`;
  if(inventoryWarehouseLoadPromises.has(key)) return inventoryWarehouseLoadPromises.get(key);
  const promise=Promise.all([
    loadInventoryBalancesFromSupabase({warehouseIds:targets,force}),
    loadInventoryLotsFromSupabase({warehouseIds:targets,force})
  ]).then(results=>results.every(Boolean)).finally(()=>{ if(inventoryWarehouseLoadPromises.get(key)===promise) inventoryWarehouseLoadPromises.delete(key); });
  inventoryWarehouseLoadPromises.set(key,promise);
  return promise;
}
function activeWarehouseStorageKey(profile=currentProfile){ return `${ACTIVE_WAREHOUSE_STORAGE_KEY}:${profile?.id||''}`; }
function clearActiveWarehouseSelection(profile=currentProfile){
  const key=activeWarehouseStorageKey(profile);
  try{ localStorage.removeItem(key); }catch(error){}
  try{ sessionStorage.removeItem(key); }catch(error){}
}
function restoreActiveWarehouseSelection(){
  let stored='';
  const key=activeWarehouseStorageKey();
  try{ stored=String(localStorage.getItem(key)||''); }catch(error){}
  if(!stored){
    try{ stored=String(sessionStorage.getItem(key)||''); }catch(error){}
    if(stored){ try{ localStorage.setItem(key,stored); }catch(error){} }
  }
  const allowed=accessibleWarehouses();
  allWarehousesMode=stored==='all'&&canUseAllWarehousesMode();
  const storedId=Number(stored)||0;
  activeWarehouseId=allWarehousesMode?(Number(allowed[0]?.id)||0):(allowed.some(warehouse=>Number(warehouse.id)===storedId)?storedId:0);
  if(activeWarehouseId) applyActiveWarehouseInventory();
}
function selectActiveWarehouse(warehouseId){
  const allowed=accessibleWarehouses();
  if(String(warehouseId)==='all'){
    if(!canUseAllWarehousesMode()) return false;
    allWarehousesMode=true;
    activeWarehouseId=Number(allowed[0]?.id)||0;
    try{ localStorage.setItem(activeWarehouseStorageKey(),'all'); }catch(error){}
    applyActiveWarehouseInventory();
    resetWarehouseScopedUiState('all');
    loadWarehouseInventoryFromSupabase(reportWarehouseIds()).then(()=>render()).catch(error=>console.warn('load all warehouse inventory',error));
    return true;
  }
  const selected=allowed.find(warehouse=>Number(warehouse.id)===Number(warehouseId));
  if(!selected) return false;
  allWarehousesMode=false;
  activeWarehouseId=Number(selected.id);
  try{ localStorage.setItem(activeWarehouseStorageKey(),String(activeWarehouseId)); }catch(error){}
  applyActiveWarehouseInventory();
  resetWarehouseScopedUiState(String(activeWarehouseId));
  loadWarehouseInventoryFromSupabase([activeWarehouseId]).then(()=>render()).catch(error=>console.warn('load selected warehouse inventory',error));
  return true;
}
function resetWarehouseScopedUiState(reportWarehouseValue){
  cart=[]; saleDiscount=0; saleMember=null; saleSourceQuotationId=null; pendingQty=1;
  cashShifts=[]; currentCashShift=null; cashShiftCloseDraft={countedCash:'',reason:''};
  stockReportItems=[];
  stockReportCatFilter={wh:reportWarehouseValue,category:'',brand:''};
  stockEditItems=[]; stockEditRowUnitSel={}; stockEditDraftStocks={}; stockEditSourceInspectionListId=null; stockEditSourcePending=false; stockEditPage=1;
  stockEditLotSelections={}; stockEditNewLotNumbers={}; stockEditNewLotExpiries={}; stockEditPosting=false; stockControlMode='count';
  stockLotReallocationSearch=''; stockLotReallocationPage=1;
  inspectionListDraft=null; editingInspectionListId=null;
  if(typeof resetInventoryReportWarehouseFilters==='function') resetInventoryReportWarehouseFilters();
  inventoryMovementFilter.warehouse=reportWarehouseValue;
  inventoryMovementFilter.page=1;
  rproductFilter.wh=reportWarehouseValue;
  rbillFilter.wh=reportWarehouseValue;
  rprofitFilter.wh=reportWarehouseValue;
  if(currentProfile&&reportWarehouseValue!=='all'&&typeof loadCashShiftsFromSupabase==='function') loadCashShiftsFromSupabase().then(()=>render());
}
