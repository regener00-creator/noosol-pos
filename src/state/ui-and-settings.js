let currentTab = 'dashboard';
let searchQuery = '';
// สถานะตัวกรองรายงานยอดขายตามสินค้า
let rproductFilter = { period:'today', from:'', to:'', month:'', year:'', wh:'all', scope:'all', category:'', brand:'', products:[], applied:false };
// ตัวกรองหน้ารายงานยอดขายตามบิล
let rbillFilter = { period:'today', from:'', to:'', month:'', year:'', wh:'all', scope:'all', category:'', brand:'', products:[], pay:'all', applied:false };
// ตัวกรองหน้ารายงานกำไร / ขาดทุน
let rprofitFilter = { period:'today', from:'', to:'', month:'', year:'', wh:'all', pay:'all', applied:false };
let rtaxMonth=TODAY_STR.slice(0,7);
// ตัวกรองหน้าสินค้าใกล้หมด/ใกล้หมดอายุ
const LOW_STOCK_FILTER_STORAGE_KEY='pharmacy_pos_low_stock_filter_v1';
const EXPIRY_DAYS_FILTER_STORAGE_KEY='pharmacy_pos_expiry_days_filter_v1';
let savedLowStockThreshold=50;
try{ const savedThreshold=Number(localStorage.getItem(LOW_STOCK_FILTER_STORAGE_KEY)); if(Number.isFinite(savedThreshold)&&savedThreshold>=1) savedLowStockThreshold=Math.floor(savedThreshold); }catch(error){}
let savedExpiryDays=90;
try{ const savedDays=Number(localStorage.getItem(EXPIRY_DAYS_FILTER_STORAGE_KEY)); if(Number.isFinite(savedDays)&&savedDays>=1) savedExpiryDays=Math.floor(savedDays); }catch(error){}
let lowStockPageFilter = { stockMode:'low', stockThreshold:savedLowStockThreshold, stockWarehouse:'context', expiryDays:savedExpiryDays, expiryMode:'near', expiryWarehouse:'context', stockPage:1, expiryPage:1 };
let lowStockUnitSelection = {};
function resetInventoryReportWarehouseFilters(){
  lowStockPageFilter.stockWarehouse='context';
  lowStockPageFilter.expiryWarehouse='context';
  lowStockPageFilter.stockPage=1;
  lowStockPageFilter.expiryPage=1;
}
// รายการที่เพิ่มไว้ในหน้า "รายงานสินค้าคงเหลือ" (ค้นหา/สแกนแล้วสะสมเป็นรายการ)
let stockReportItems = [];
// ตัวกรองหมวดสินค้าหลัก/ย่อย สำหรับหน้ารายงานสินค้าคงเหลือ (ไว้เพิ่มทั้งหมวดในคราวเดียว)
let stockReportCatFilter = { wh:'', category:'', brand:'' };
// การเรียงลำดับตารางในหน้ารายงานสินค้าคงเหลือ
let stockReportSort = { key:'name', dir:1 };
const STOCK_REPORT_COLUMNS_KEY='sapuri_stock_report_columns_v1';
let stockReportColumns = { sku:true, barcode:true, price:true, cost:true };
try{
  const saved=JSON.parse(localStorage.getItem(STOCK_REPORT_COLUMNS_KEY)||'null');
  if(saved) stockReportColumns={sku:saved.sku!==false,barcode:saved.barcode!==false,price:saved.price!==false,cost:saved.cost!==false};
}catch(error){}
// ชุดสินค้าที่บันทึกไว้สำหรับเปิดดูราคา/ทุน/คงเหลือล่าสุดซ้ำได้
let inspectionLists = [];
let editingInspectionListId = null; // null=หน้ารวม, 'new'=สร้างใหม่, ค่าอื่น=แก้ไขรายการเดิม
let inspectionListDraft = null;
let inspectionListCatFilter = { wh:'', category:'', brand:'' };
let inspectionListSearchQuery = '';
let inspectionListPage = 1;
let inspectionListSort = { key:'sku', dir:1 };
let inspectionListOverviewSort = { key:'updatedAt', dir:-1 };
let inspectionListOverviewSelectedIds = new Set();
const INSPECTION_LIST_PAGE_SIZE = 10;
// โหมดมือถือ/เครื่องยิงบาร์โค้ดแบบมีจอ แสดงเช็คราคาและขั้นตอนตรวจ/แก้ไขสต๊อก
let mobileToolMode = 'price';
let mobileInventoryStep = 'inspection';
let mobilePriceQuery = '';
let mobilePriceProductId = null;
let mobilePriceUnitName = '';
let mobilePriceLotId = null;
let mobileProductEditor = null;
let mobileProductOpening = false;
let mobileDataStatusState = 'online';
let mobileDataStatusMessage = '';
let mobileLastRefreshAt = 0;
let mobileRefreshPromise = null;
let mobileInspectionListId = '';
let mobileInspectionOpenedListId = '';
let mobileInspectionQuery = '';
let mobileInspectionVisibleCount = 25;
let mobileInspectionLastProductId = null;
const mobileInspectionCheckedByList = {};
let mobileInspectionCreating = false;
let mobileInspectionAddingToSaved = false;
let mobileInspectionSavedAddQuery = '';
let mobileInspectionSavedAddItems = [];
let mobileStockQuery = '';
let mobileStockSourceListId = '';
let mobileStockLastProductId = null;
const MOBILE_SCAN_SOUND_URL='data:audio/mpeg;base64,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KjAADSUNERGuSdixrTXPLhn0//++TEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpv///xLUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+4RE/wQDQThEafg2AG3HyH1h414FdGUGwIFHgMUNIOgQPsBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xRk5A/wJQBBAAAAAAAAD/AAAAEAAAH+AAAAIAAAP8AAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';
const MOBILE_SCAN_ERROR_SOUND_URL='data:audio/mpeg;base64,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';
let mobileScanSound=null;
let mobileScanErrorSound=null;
let mobileScanAudioContext=null;
let mobileScanDecodedSounds={success:null,error:null};
let mobileScanDecodePromises={success:null,error:null};
let mobileScanSoundUnlockAttached=false;
let mobileCameraSession=null;
let mobileZxingLoadPromise=null;
function prepareMobileLandingPage(){
  mobileProductEditor=null;
  editingProductId=null;
  mobileToolMode='price';
  mobileInventoryStep='inspection';
  mobilePriceQuery=''; mobilePriceProductId=null; mobilePriceUnitName=''; mobilePriceLotId=null;
  mobileInspectionQuery=''; mobileInspectionLastProductId=null; mobileInspectionVisibleCount=25;
  mobileStockQuery=''; mobileStockLastProductId=null;
}
let deferredPwaInstallPrompt = null;
// รายการและตัวกรองของหน้าแก้ไขสต๊อก (แยกจากรายงานสินค้าคงเหลือโดยเด็ดขาด)
let stockEditItems = [];
let stockEditCatFilter = { category:'', brand:'' };
let stockEditSearchQuery = '';
let stockEditRowUnitSel = {};
let stockEditDraftStocks = {};
let stockEditPage = 1;
let stockEditSourceInspectionListId = null;
let stockEditSourcePending = false;
const AUTOMATIC_STOCK_ADJUSTMENT_REASON = 'ตรวจนับและปรับสต๊อกจากยอดตรวจนับ';
const AUTOMATIC_LOT_REALLOCATION_REASON = 'ปรับจำนวน LOT จากรายการผิดปกติ';
let stockEditLotSelections = {};
let stockEditNewLotNumbers = {};
let stockEditNewLotExpiries = {};
let stockEditPosting = false;
let stockControlMode = 'count';
const STOCK_EDIT_PAGE_SIZE = 10;
let stockLotReallocationSearch = '';
let stockLotReallocationPage = 1;
const STOCK_LOT_REALLOCATION_PAGE_SIZE = 10;
// คิวหน้าพิมพ์ป้ายราคา แยกจากหน้ารายการสินค้าและหน้าแก้ไขสต๊อก
let barcodePrintItems = [];
let barcodePrintCatFilter = { category:'', brand:'' };
let barcodePrintSearchQuery = '';
let barcodePrintLabelSize = '50x30';
let barcodePrintPage = 1;
const BARCODE_PRINT_PAGE_SIZE = 10;
const BARCODE_PRINT_LABEL_DIMENSIONS={
  '80x50':[80,50],
  '60x40':[60,40],
  '50x30':[50,30],
  '40x30':[40,30],
};
const PRICE_LABEL_ELEMENT_META={
  name:{label:'ชื่อสินค้า'},
  unit:{label:'หน่วย'},
  price:{label:'ราคา'},
  barcode:{label:'บาร์โค้ด'},
  code:{label:'เลขบาร์โค้ด'},
};
const PRICE_LABEL_TEXT_COLORS=['#000000','#e60012'];
const PRICE_LABEL_PRESET_LABELS={left:'ชิดซ้าย / เว้นด้านขวา',full:'เต็มพื้นที่',center:'เน้นราคากึ่งกลาง',custom:'กำหนดเอง'};
let priceLabelTemplateSyncPromise=Promise.resolve();
let priceLabelCustomTextCounter=0;
let priceLabelNamedTemplateCounter=0;
// เลขหน้าสำหรับตารางเอกสารต่างๆ (แสดงหน้าละ 10 รายการ)
let docListPage = { po:1, ret:1, gr:1, exchange:1, cashbill:1, taxinvoice:1, quotation:1 };
const DOC_LIST_PAGE_SIZE = 10;
let lowStockSort = { stock:{key:'name',dir:1}, expiry:{key:'expiry',dir:1} };
// สถานะตัวกรองหน้าประวัติการขาย (ค่าเริ่มต้น = แสดงเฉพาะวันนี้)
let historyFilter = { period:'range', from:'', to:'', month:'', year:'', bill:'', page:1 };
let posSalesHistoryModalOpen=false;
let posSalesHistoryOnDemandState=null;
// ตัวกรองหน้ารายการงานเคลื่อนไหว (ไม่เลือกสินค้า = แสดงสินค้าทั้งหมด)
let inventoryMovementFilter = { period:'range', from:'', to:'', month:'', year:'', warehouse:'', type:'all', direction:'all', scope:'type:all', category:'', brand:'', products:[], page:1 };
let inventoryMovementSearchQuery = '';
let inventoryMovementExpandedBills = new Set();
let expandedDocumentItemLists = new Set();
const INVENTORY_MOVEMENT_PAGE_SIZE = 10;
let poCounter = 32, grCounter = 31, returnCounter = 1, productExchangeCounter = 1;
let editingPOId = null; // null=list, 'new', หรือ id ของ PO
let poDraft = null; // ร่าง PO ที่กำลังแก้ (เก็บค่าไว้ระหว่าง re-render)
let poSupplierEditorOpen = false; // แก้ข้อมูลผู้จำหน่ายจากหน้า PO
let poRepresentativeEditorId = null; // null=ปิด, 'new'=เพิ่มใหม่, หรือ id ผู้แทนที่กำลังแก้
let editingGRId = null; // null=list, 'new', หรือ id ของใบรับสินค้า
let grDraft = null;
let editingReturnId = null; // null=list, 'new', หรือ id ของใบคืนสินค้า
let returnDraft = null;
let editingProductExchangeId = null; // null=list, 'new', หรือ id ของเอกสารเปลี่ยนสินค้า
let productExchangeDraft = null;
let editingTaxInvoiceSaleId = null; // null=รายการ, ค่าอื่น=หน้าสร้าง/ดูใบกำกับภาษีจากบิลขาย
let taxInvoiceDraft = null;
let taxInvoiceAddingCustomer = false;
let editingQuotationId=null;
let standaloneTaxInvoices=[];
let cashBillLookupOpen=false;
let cashBillOrderNumberDraft='';
const TAX_INVOICE_STORAGE_KEY='pharmacy_pos_standalone_tax_invoices_v1';
try{ const savedTaxDocs=JSON.parse(localStorage.getItem(TAX_INVOICE_STORAGE_KEY)||'null'); if(Array.isArray(savedTaxDocs)) standaloneTaxInvoices=savedTaxDocs; }catch(error){ console.warn('ไม่สามารถโหลดใบกำกับภาษีที่สร้างใหม่ได้',error); }
function persistStandaloneTaxInvoices(){ persistWorkspaceData(); }
let standaloneTaxInvoiceCounter=maxArrayValue(standaloneTaxInvoices,doc=>(Number(String(doc.number||'').slice(-4))||0)+1,1);
let openDocMenu = null;
let documentSort = {po:{key:'date',dir:-1},gr:{key:'date',dir:-1},ret:{key:'date',dir:-1},exchange:{key:'date',dir:-1}};
// ข้อมูลร้าน (หัวเอกสาร)
const STORE_INFO = {
  name: '',
  branch: 'สำนักงานใหญ่',
  address: '',
  taxId: '',
  phone: '',
  website: '',
};
const DEFAULT_BUSINESS_SETTINGS={type:'บุคคลธรรมดา',vat:'ยังไม่จดภาษีมูลค่าเพิ่ม',vatRegistrationDate:'',name:'',address:'',taxId:'',branch:'none',branchCode:'',branchName:'',officePhone:'',mobile:'',fax:'',line:'',website:'',documentPhone:'mobile',english:false,medicineLabelDoseUnits:[...MEDICINE_LABEL_DOSE_UNITS],medicineLabelWarningPresets:[...MEDICINE_LABEL_WARNING_PRESETS],priceLabelTemplates:{},priceLabelTemplateLibraries:{}};
let businessSettings={...DEFAULT_BUSINESS_SETTINGS};
let businessSettingsDirty=false;
let businessSettingsSyncState='local';
let businessSettingsSyncError='';
let businessSettingsLastSyncedAt='';
const NOTE_PAGE_SIZE=100;
const REPRESENTATIVE_HISTORY_PAGE_SIZE=24;
const REPRESENTATIVE_NOTE_PAGE_SIZE=50;
const REPRESENTATIVE_ACTIVITY_ITEM_SELECT='id,product_id,product_name,quoted_price,minimum_quantity,unit,condition_note,sort_order';
const NOTE_ROW_BASE_SELECT='id,title,content_html,hidden_from_level2,representative_id,product_id,activity_type,event_date,valid_from,valid_to,quoted_price,minimum_quantity,unit,reminder_date,created_by,updated_by,created_at,updated_at';
const NOTE_ROW_SELECT=`${NOTE_ROW_BASE_SELECT},representative_activity_items(${REPRESENTATIVE_ACTIVITY_ITEM_SELECT})`;
const NOTE_COLORS=[
  ['#2B2016','น้ำตาลเข้ม'],['#B42318','แดง'],['#D97706','ส้ม'],['#2D7D3D','เขียว'],
  ['#1570A6','ฟ้า'],['#3448A3','น้ำเงิน'],['#7A3E9D','ม่วง'],['#000000','ดำ']
];
let notes=[];
let notesLoaded=false;
let notesLoading=false;
let notesHasMore=false;
let noteLoadError='';
let noteSearchQuery='';
let notePageCursor=null;
let editingNoteId=null;
let noteDraft=null;
let noteDraftDirty=false;
const REPRESENTATIVE_ACTIVITY_TYPES={promotion:'โปรโมชั่น',price_quote:'แจ้งราคา',contact:'ติดต่อ / เข้าเยี่ยม',purchase_order:'สั่งสินค้า',goods_receipt:'รับสินค้า',product_return:'คืนสินค้า',general:'หมายเหตุ'};
let representativeHistoryContext=null;
let representativeActivityNotes=[];
let representativeProductAssignments=[];
let representativeManagedProductIndexRows=[];
let representativeManagedProductIds=new Set();
let representativeManagedProductIndexLoaded=false;
let representativeManagedProductIndexLoadedAt=0;
let representativeManagedProductIndexPromise=null;
let representativeManagedProductIndexToken=0;
let representativeActivityLoading=false;
let representativeActivityLoadedKey='';
let representativeActivityLoadError='';
let representativeActivityDraft=null;
let representativeActivityDraftDirty=false;
let selectedRepresentativeNoteId=null;
let selectedRepresentativeNoteIdsToDelete=new Set();
let selectedSalesRepresentativeIdsToDelete=new Set();
let representativeProductsEditor=null;
let representativeHistoryFilter={representativeSearch:'',productSearch:'',noteSearch:''};
let representativeHistoryRepresentativeIds=[];
let representativeHistoryHasMore=false;
let representativeHistoryCursor=null;
let representativeNotesHasMore=false;
let representativeNotesCursor=null;
let representativeNoteMetadata=new Map();
let representativeNoteTotals=new Map();
window.addEventListener('beforeunload',event=>{
  const hasUnsavedBusiness=currentTab==='settingsbusiness'&&businessSettingsDirty;
  const hasUnsavedNote=currentTab==='notes'&&noteDraftDirty;
  const hasUnsavedRepresentativeNote=isRepresentativeHistoryScreen()&&representativeActivityDraftDirty;
  const hasPendingSync=!!currentProfile&&(workspaceCacheSaveFailed||currentWorkspacePendingChanges().length>0||productDirtyOperations.size>0);
  if(!hasUnsavedBusiness&&!hasUnsavedNote&&!hasUnsavedRepresentativeNote&&!hasPendingSync) return;
  event.preventDefault();
  event.returnValue='';
});
// เดิมมีการตั้งค่าสินค้าใกล้หมดระดับร้าน (เปิด/ปิด + ค่าเริ่มต้น) แต่ไม่เคยมีหน้าจอให้แก้ไขค่านี้จริง
// (ฟังก์ชันบันทึกไม่เคยถูกเรียกใช้เลย) จึงเอาออกตามที่ขอ เหลือแค่ค่าคงที่ไว้ใช้เป็นค่าเริ่มต้น
// ให้สินค้าใหม่ + fallback ของการแจ้งเตือนต่อสินค้า (ซึ่งยังตั้งค่าแยกรายตัวได้ในหน้าแก้ไขสินค้าเหมือนเดิม)
const DEFAULT_LOW_STOCK_THRESHOLD=5;
let currentUserProfile={firstName:'',lastName:'',phone:'',email:'',position:'เจ้าของกิจการ',signatureName:''};
let systemUsers=[]; // populated on-demand from the admin-users edge function (owner only)
let systemUsersLoaded=false;
let systemUsersLoading=false;
let addingSystemUser=false;
let editingSystemUserId=null;
let auditLogRows=[];
let auditLogLoaded=false;
let auditLogLoading=false;
let auditLogError='';
let auditLogPage=1;
const AUDIT_LOG_PAGE_SIZE=20;
let auditLogTotal=0;
let auditLogPageCount=1;
let auditLogHasNewer=false;
let auditLogHasOlder=false;
let auditLogRequestToken=0;
let auditLogSearchTimer=null;
let auditLogFilter={search:'',entity:'all',action:'all'};
let expandedAuditLogRows=new Set();
let currentProfile=null; // Supabase Auth profile of the signed-in user, mapped by mapProfileRow()
let ownerRecoverySetupRequired=false;
let cashShifts=[];
let currentCashShift=null;
let cashShiftCloseDraft={countedCash:'',reason:''};
let cashShiftBusy=false;
let systemHasOwner=null; // null=unknown yet, true/false once checked via has_any_owner()
let storeResetMode=null;
let addingWarehouse=false;
let editingWarehouseId=null;
let editingTransferId=null; // null=หน้ารายการ, 'new'=สร้างใหม่, ค่าอื่น=แก้ไขเอกสารเดิม
let transferDraft=null;
let transferCounter=maxArrayValue(transfers,t=>(Number(String(t.id||'').slice(-4))||0)+1,1);
let transferLineCounter=1;
