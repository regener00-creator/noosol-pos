// ===== Supabase Auth wiring (replaces plaintext systemUsers login) =====
const SUPABASE_URL = 'https://tgwqmpvdjyxwivjxceoq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Lo0ABFMvYp8IqceZ3DLIow_jrMv1V8j';
const sb = window.supabase?.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth:{persistSession:true,autoRefreshToken:true}
}) : null;
const EDGE_FUNCTIONS_URL = SUPABASE_URL + '/functions/v1';
const XLSX_SCRIPT_URL='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let xlsxLoadPromise=null;
const APP_ASSET_VERSION=new URL(document.currentScript?.src||location.href).searchParams.get('v')||'';
// Build extracts exactly these declarations into versioned classic-script chunks.
// The ordered source manifest preserves shared scope; build emits lazy page chunks.
const PAGE_CODE_GROUPS={
  "reports":{"tabs":["rproduct","rbill","rprofit","rtax","rinventory","inventorymovement","lowstock","expiry"],"functions":["renderRProduct","renderRBill","renderRProfit","renderRTax","renderRInventory","renderInventoryMovement","renderLowStock","renderExpiry"]},
  "documents":{"tabs":["cashbill","taxinvoice","quotation","purchaseorder","productreturn","goodsreceipt","productexchange"],"functions":["renderCashBills","renderCashBillLookup","renderTaxInvoices","renderTaxInvoiceOrderLookup","renderStandaloneTaxInvoiceForm","renderTaxInvoiceForm","renderQuotation","renderQuotationForm","renderPurchaseOrder","renderPOForm","renderShortageOrderForm","renderProductReturnForm","renderProductReturn","renderGoodsReceipt","renderProductExchange","renderProductExchangeForm"]},
  "settings":{"tabs":["settingsbusiness","settingssystem","settingsuser","settingsusers","settingsprinter","auditlog","warehouse"],"functions":["renderBusinessSettings","renderSystemSettings","renderReceiptPrinterSettings","renderUserSettings","renderSystemUsers","renderAddSystemUser","renderAuditLog","renderWarehouse","renderWarehouseForm"]},
  "catalog":{"tabs":["products","contacts","customers","promotions"],"functions":["renderProducts","renderProductForm","renderContacts","renderContactForm","renderCustomerPurchaseHistory","renderCustomerPricingForm","renderPromotions","renderPromotionForm"]}
};
const pageCodeLoads=new Map();
function pageCodeGroup(tab){ return Object.keys(PAGE_CODE_GROUPS).find(group=>PAGE_CODE_GROUPS[group].tabs.includes(tab)); }
function pageCodeReady(group){ return !group||PAGE_CODE_GROUPS[group].functions.every(name=>typeof window[name]==='function'); }
function ensurePageCodeLoaded(tab){
  const group=pageCodeGroup(tab);
  if(pageCodeReady(group)) return Promise.resolve(true);
  if(pageCodeLoads.has(group)) return pageCodeLoads.get(group);
  const promise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=`/page-${group}.js${APP_ASSET_VERSION?`?v=${encodeURIComponent(APP_ASSET_VERSION)}`:''}`;
    script.async=true;
    script.onload=()=>{
      if(pageCodeReady(group)){ resolve(true); return; }
      script.remove();
      const changed=window.__pageCodeVersions?.[group]&&window.__pageCodeVersions[group]!==APP_ASSET_VERSION;
      reject(new Error(changed?'มีโปรแกรมเวอร์ชันใหม่ กรุณาบันทึกงานแล้วโหลดโปรแกรมใหม่เพื่อเปิดหน้านี้':'โหลดส่วนประกอบหน้านี้ไม่ครบ กรุณาโหลดโปรแกรมใหม่'));
    };
    script.onerror=()=>{ script.remove(); reject(new Error('โหลดหน้านี้ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่')); };
    document.head.appendChild(script);
  }).catch(error=>{ pageCodeLoads.delete(group); throw error; });
  pageCodeLoads.set(group,promise);
  return promise;
}
function showPageCodeLoading(tab,mainElement){
  if(pageCodeReady(pageCodeGroup(tab))) return false;
  const owner={};
  mainElement.pageCodeOwner=owner;
  mainElement.innerHTML='<div class="hint" role="status">กำลังโหลดหน้านี้...</div>';
  ensurePageCodeLoaded(tab).then(()=>{
    if(currentTab===tab&&mainElement.pageCodeOwner===owner) render();
  }).catch(error=>{
    if(currentTab!==tab||mainElement.pageCodeOwner!==owner) return;
    mainElement.innerHTML=`<div class="hint" role="alert">${escapeHtml(error.message)} <button class="btn" id="retryPageCodeBtn" type="button">ลองใหม่</button> <button class="btn ghost" id="reloadPageCodeBtn" type="button">โหลดโปรแกรมใหม่</button></div>`;
    mainElement.querySelector('#retryPageCodeBtn').onclick=()=>render();
    mainElement.querySelector('#reloadPageCodeBtn').onclick=async()=>{
      if(currentProfile){
        if(!confirm('บันทึกงานในแบบฟอร์มแล้วหรือยัง? การโหลดใหม่จะปิดแบบฟอร์มที่ยังไม่ได้บันทึก แต่ระบบจะเก็บสำเนางานรอซิงก์ไว้')) return;
        try{ await ensureWorkspaceRecoveryDurable(); }
        catch(error){ showToast(error.message,'danger'); return; }
      }
      location.reload();
    };
  });
  return true;
}
let excelToolsLoadPromise=null;
function ensureExcelToolsLoaded(){
  if(window.exportProductsToExcel) return Promise.resolve(true);
  if(excelToolsLoadPromise) return excelToolsLoadPromise;
  excelToolsLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=`/excel-tools.js${APP_ASSET_VERSION?`?v=${encodeURIComponent(APP_ASSET_VERSION)}`:''}`;
    script.async=true;
    script.onload=()=>window.exportProductsToExcel?resolve(true):reject(new Error('โหลดเครื่องมือ Excel ไม่สมบูรณ์'));
    script.onerror=()=>reject(new Error('โหลดเครื่องมือ Excel ไม่สำเร็จ'));
    document.head.appendChild(script);
  }).catch(error=>{ excelToolsLoadPromise=null; throw error; });
  return excelToolsLoadPromise;
}
async function invokeExcelTool(name,...args){
  try{ await ensureExcelToolsLoaded(); return await window[name](...args); }
  catch(error){ showToast(error?.message||'เปิดเครื่องมือ Excel ไม่สำเร็จ','danger-top'); return null; }
}
function ensureXlsxLoaded(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=XLSX_SCRIPT_URL;
    script.async=true;
    script.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('ระบบ Excel โหลดไม่สมบูรณ์'));
    script.onerror=()=>reject(new Error('ไม่สามารถโหลดระบบ Excel กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'));
    document.head.appendChild(script);
  }).catch(error=>{ xlsxLoadPromise=null; throw error; });
  return xlsxLoadPromise;
}
function noosolAuthEmail(username){ return String(username||'').trim().toLowerCase()+'@noosol-pos.internal'; }
async function callEdgeFunction(name, payload){
  const { data:{ session } } = await sb.auth.getSession();
  const res = await fetch(EDGE_FUNCTIONS_URL+'/'+name, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer '+(session?.access_token||SUPABASE_PUBLISHABLE_KEY),
      'apikey':SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(payload||{}),
  });
  let body; try{ body = await res.json(); }catch(e){ body = {}; }
  if(!res.ok) throw new Error(body.error || ('เกิดข้อผิดพลาด ('+res.status+')'));
  return body;
}
