let salesHistory=[];
const SALES_STORAGE_KEY="pharmacy_pos_sales_history_v1";
async function updateSaleDocumentMetadata(saleId,metadata){
  const id=String(saleId||'').trim();
  if(!id) throw new Error('ไม่พบรหัสรายการขาย');
  const {data,error}=await sb.rpc('update_sale_document_metadata',{p_sale_id:id,p_metadata:metadata});
  if(error) throw error;
  const index=salesHistory.findIndex(item=>String(item.id)===id);
  if(index<0) throw new Error('ไม่พบรายการขายในอุปกรณ์นี้');
  salesHistory[index]={...salesHistory[index],...(data?.sale||data||{}),id};
  return salesHistory[index];
}
const weekSales = [ {d:'28 ก.ค.',v:420}, {d:'29 ก.ค.',v:580}, {d:'30 ก.ค.',v:310}, {d:'31 ก.ค.',v:490}, {d:'1 ส.ค.',v:670}, {d:'2 ส.ค.',v:174}, {d:'3 ส.ค.',v:96} ];
let TODAY_STR = currentDateStr();
const DEFAULT_DOCUMENT_PREFIXES={sale:'RE',cashBill:'CB',taxInvoice:'INV',quotation:'QT',shortage:'SH',productReturn:'RT',goodsReceipt:'RI',productExchange:'EX',transfer:'TF',inspection:'CHECK',stockAdjustment:'SC',cashShift:'CS',warehouse:'WH'};
let documentPrefixes={...DEFAULT_DOCUMENT_PREFIXES};
const DOCUMENT_PREFIX_FIELDS=[
  {key:'sale',label:'ใบเสร็จจาก POS / ประวัติการขาย'},
  {key:'cashBill',label:'บิลเงินสด A4'},
  {key:'taxInvoice',label:'ใบกำกับภาษีเต็มรูปแบบ'},
  {key:'quotation',label:'ใบเสนอราคา'},
  {key:'shortage',label:'สั่งซื้อสินค้า'},
  {key:'productReturn',label:'ใบคืนสินค้า'},
  {key:'goodsReceipt',label:'ใบรับสินค้า'},
  {key:'productExchange',label:'เปลี่ยนสินค้า'},
  {key:'transfer',label:'โอนสินค้าระหว่างคลัง'},
  {key:'inspection',label:'ตรวจสินค้า'},
  {key:'stockAdjustment',label:'ตรวจนับและปรับสต๊อก'},
  {key:'cashShift',label:'เปิด-ปิดระบบชำระ / เลขกะ'},
  {key:'warehouse',label:'รหัสคลังสินค้า / สาขา'}
];
function normalizeDocumentPrefix(value,fallback=''){
  return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8)||fallback;
}
let invoiceCounter=maxArrayValue(salesHistory,s=>(Number(String(s.id||'').replace(/\D/g,''))||0)+1,1043);
function nextSaleRef(){
  const values=salesHistory.map(s=>s.ref).filter(Boolean);
  const prefix=documentPrefixes.sale;
  return buildDocNumber(prefix, nextDailySeq(prefix, values));
}
// เวลาปัจจุบันของเครื่อง แบบ HH:MM (ใช้บันทึกเวลาขายจริงตอนทำรายการ)
function nowTimeStr(){
  const d=new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
// แสดงผลเลขรายการหน้า POS แบบอ่านง่าย เช่น RE202608091046 -> 2026-08-09 / 1046 (ไม่กระทบเลขจริงที่บันทึกในระบบ)
function formatSaleRefDisplay(ref){
  const digits=String(ref||'').replace(/\D/g,'');
  if(digits.length<8) return ref;
  const y=digits.slice(0,4), m=digits.slice(4,6), d=digits.slice(6,8), num=digits.slice(8);
  return `${y}-${m}-${d}${num?` / ${num}`:''}`;
}
let saleRef = nextSaleRef();
let saleDiscount = 0; // บาท
let saleLoyaltySelection=null;
let customerLoyaltyState=null;
let customerLoyaltyExpiryTimer=null;
let saleMember = null; // ชื่อสมาชิก
const VAT_RATE = 0.07;
const VAT_REGISTERED_LABEL = 'จดภาษีมูลค่าเพิ่มแล้ว';
function isBusinessVatRegistered(settings=businessSettings){
  const effectiveDate=String(settings?.vatRegistrationDate||'').slice(0,10);
  return settings?.vat===VAT_REGISTERED_LABEL&&(!effectiveDate||effectiveDate<=currentDateStr());
}
function businessPrimaryPhone(settings=businessSettings){
  const preferred=settings?.documentPhone==='office'?'officePhone':'mobile';
  const fallback=preferred==='officePhone'?'mobile':'officePhone';
  return String(settings?.[preferred]||settings?.[fallback]||settings?.phone||'').trim();
}
function businessTaxBranchLabel(settings=businessSettings,options={}){
  const registered=options.registered===undefined?isBusinessVatRegistered(settings):options.registered===true;
  if(!registered) return '';
  const branch=String(settings?.branch||'none');
  if(branch==='head') return 'สำนักงานใหญ่';
  if(branch!=='branch') return '';
  const code=String(settings?.branchCode||'').trim();
  const name=String(settings?.branchName||'').trim();
  return ['สาขา',code,name].filter(Boolean).join(' ');
}
function businessDocumentName(settings=businessSettings,fallbackName='',options={}){
  const name=String(settings?.name||fallbackName||'').trim();
  const branch=businessTaxBranchLabel(settings,options);
  return `${name}${branch?` (${branch})`:''}`;
}
const BUSINESS_DOCUMENT_SNAPSHOT_KEYS=['type','vat','vatRegistrationDate','name','address','taxId','branch','branchCode','branchName','officePhone','mobile','phone','fax','line','website','documentPhone','english'];
function businessDocumentSnapshot(settings=businessSettings){
  const source=settings&&typeof settings==='object'?settings:{};
  return BUSINESS_DOCUMENT_SNAPSHOT_KEYS.reduce((snapshot,key)=>{
    if(source[key]!==undefined) snapshot[key]=source[key];
    return snapshot;
  },{});
}
function businessTypeTaxIdHint(type){
  if(type==='บุคคลธรรมดา') return 'บุคคลธรรมดาไทยใช้เลขบัตรประชาชน 13 หลักได้';
  if(type==='บริษัท'||type==='ห้างหุ้นส่วน') return 'ใช้เลขทะเบียนนิติบุคคล/เลขประจำตัวผู้เสียภาษี 13 หลัก';
  return 'กรอกเลขประจำตัวผู้เสียภาษี 13 หลัก';
}
function normalizeProductVatMode(value){
  return ['incl','excl','none'].includes(value)?value:'incl';
}
function productVatModeLabel(value){
  return normalizeProductVatMode(value)==='excl'?'ราคายังไม่รวม VAT':normalizeProductVatMode(value)==='none'?'ไม่มี VAT':'ราคารวม VAT แล้ว';
}
function parseProductVatMode(value,fallback='incl'){
  const normalized=String(value??'').trim().toLowerCase();
  if(!normalized) return normalizeProductVatMode(fallback);
  if(normalized==='excl'||normalized.includes('ยังไม่รวม')) return 'excl';
  if(normalized==='none'||normalized.includes('ไม่มี')||normalized.includes('ยกเว้น')) return 'none';
  if(normalized==='incl'||normalized.includes('รวม vat')) return 'incl';
  return normalizeProductVatMode(fallback);
}
function effectiveProductVatMode(product,settings=businessSettings){
  return isBusinessVatRegistered(settings)?normalizeProductVatMode(product?.vat):'none';
}
function grossAmountForVatMode(amount,vatMode,registered=true){
  const value=Math.max(0,Number(amount)||0);
  return registered&&normalizeProductVatMode(vatMode)==='excl'?value*(1+VAT_RATE):value;
}
function calculateSaleTaxSummary(lines,requestedDiscount=0,registered=true){
  const prepared=(lines||[]).map(line=>{
    const amount=Math.max(0,Number(line?.amount)||0);
    const mode=registered?normalizeProductVatMode(line?.vatMode):'none';
    const gross=grossAmountForVatMode(amount,mode,registered);
    const beforeVat=registered&&mode==='incl'?gross/(1+VAT_RATE):amount;
    const vat=registered&&mode!=='none'?gross-beforeVat:0;
    return {amount,vatMode:mode,gross,beforeVat,vat};
  });
  const subtotal=prepared.reduce((sum,line)=>sum+line.gross,0);
  const discount=Math.min(Math.max(0,Number(requestedDiscount)||0),subtotal);
  const ratio=subtotal>0?(subtotal-discount)/subtotal:0;
  const beforeVat=prepared.reduce((sum,line)=>sum+line.beforeVat*ratio,0);
  const vat=prepared.reduce((sum,line)=>sum+line.vat*ratio,0);
  const total=subtotal-discount;
  const round=value=>Math.round((Number(value)||0)*100)/100;
  return {registered:!!registered,subtotal:round(subtotal),discount:round(discount),beforeVat:round(beforeVat),vat:round(vat),total:round(total)};
}
function documentProductForTax(item){
  return products.find(product=>Number(product.id)===Number(item?.productId||item?.pid))||products.find(product=>product.name===item?.name)||null;
}
function documentItemVatMode(item,registered,settings=businessSettings,fallbackMode='incl'){
  if(!registered) return 'none';
  if(['incl','excl','none'].includes(item?.vatMode)) return item.vatMode;
  const product=documentProductForTax(item);
  return product?effectiveProductVatMode(product,settings):normalizeProductVatMode(fallbackMode);
}
function calculateDocumentTaxSummary(items,requestedDiscount=0,registered=isBusinessVatRegistered(),settings=businessSettings,fallbackMode='incl'){
  return calculateSaleTaxSummary((items||[]).map(item=>({
    amount:(Number(item?.qty)||0)*(Number(item?.price)||0),
    vatMode:documentItemVatMode(item,registered,settings,fallbackMode),
  })),requestedDiscount,registered);
}
function calculatePurchaseTaxSummary(items,requestedDiscount=0,taxMode='incl'){
  const mode=normalizeProductVatMode(taxMode);
  return calculateSaleTaxSummary((items||[]).map(item=>({amount:(Number(item?.qty)||0)*(Number(item?.price)||0),vatMode:mode})),requestedDiscount,mode!=='none');
}
function taxSummaryRowsHtml(tax,{purchase=false}={}){
  if(!tax.registered) return `<div class="sumrow"><span>${purchase?'ไม่มี VAT':'ไม่คิด VAT (กิจการยังไม่จด VAT)'}</span><span class="mono">0.00</span></div><div class="sumrow"><span>มูลค่าสินค้า</span><span class="mono">${fmtMoney(tax.beforeVat)}</span></div>`;
  return `<div class="sumrow"><span>ภาษีมูลค่าเพิ่ม 7%</span><span class="mono">${fmtMoney(tax.vat)}</span></div><div class="sumrow"><span>มูลค่าก่อนภาษีมูลค่าเพิ่ม</span><span class="mono">${fmtMoney(tax.beforeVat)}</span></div>`;
}
function cartTaxSummary(promoResult=applyPromotions(cart),discount=saleDiscount,settings=businessSettings){
  const registered=isBusinessVatRegistered(settings);
  const lines=promoResult.lines.map(line=>({amount:Number(line.promoLineTotal)||0,vatMode:line.custom?(registered?'incl':'none'):effectiveProductVatMode(products.find(product=>product.id===line.pid),settings)}));
  const points=arguments.length<2&&typeof effectiveLoyaltyRedemption==='function'?effectiveLoyaltyRedemption(promoResult):0;
  return calculateSaleTaxSummary(lines,Number(discount)+points,registered);
}
function saleTaxSummary(sale){
  const registered=sale?.vatRegistered===true;
  if(sale?.customerReturn&&sale.taxSummary) return {...sale.taxSummary,registered};
  if(sale?.taxSummary){
    if(registered) return {...sale.taxSummary,registered:true};
    const safeTotal=Math.max(0,Number(sale.taxSummary.total)||Number(sale.total)||0);
    return {...sale.taxSummary,registered:false,beforeVat:safeTotal,vat:0,total:safeTotal};
  }
  const total=Math.max(0,(Number(sale?.total)||0)-(Number(sale?.fee)||0));
  const vat=registered?Math.max(0,Number(sale?.vat)||0):0;
  return {registered,subtotal:total+(Number(sale?.discount)||0),discount:Number(sale?.discount)||0,beforeVat:registered?Math.max(0,total-vat):total,vat,total};
}
function canIssueTaxInvoiceForSale(sale){
  return !!sale&&sale.status==='done'&&!sale.customerReturn&&!(sale.customerReturnLog||[]).length&&isBusinessVatRegistered()&&sale.vatRegistered===true;
}
let favorites = []; // {pid,unit} — สินค้าโปรดหนึ่งหน่วยต่อหนึ่งสินค้า
let showFavorites = true;  // แสดงแถบสินค้าโปรดใต้บิลหรือไม่

// Production starts empty; demo documents must never enter the durable outbox.
let quotations = [];
let saleSourceQuotationId=null;
const QUOTATION_STORAGE_KEY='pharmacy_pos_quotations_v1';
try{ const savedQuotations=JSON.parse(localStorage.getItem(QUOTATION_STORAGE_KEY)||'null'); if(Array.isArray(savedQuotations)) quotations=savedQuotations; }catch(error){ console.warn('ไม่สามารถโหลดใบเสนอราคาได้',error); }
function persistQuotations(){ persistWorkspaceData(); }
let quotationCounter=maxArrayValue(quotations,doc=>(Number(String(doc.id||'').replace(/\D/g,'').slice(-4))||0)+1,1);
let invoicesAR = []; // เอกสารขายเชื่อ (ลูกหนี้)
let creditNotes = [];
let purchaseOrders = [];
let goodsReceipts = [];
let productExchanges = [];
let productReturns = [];
let transfers = [];
const TRANSFER_STORAGE_KEY='pharmacy_pos_transfers_v1';
try{ const savedTransfers=JSON.parse(localStorage.getItem(TRANSFER_STORAGE_KEY)||'null'); if(Array.isArray(savedTransfers)) transfers=savedTransfers; }catch(error){ console.warn('ไม่สามารถโหลดรายการโอนสินค้าได้',error); }
function persistTransfers(){ persistWorkspaceData(); }
