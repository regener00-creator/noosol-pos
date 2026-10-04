const APP_TABLE_SCROLL_HOST_SELECTOR=[
  '.app-table-scroll-region',
  '.sales-history-table-wrap','.product-table-scroll','.cash-shift-table-wrap',
  '.audit-log-table-wrap','.stock-edit-table-wrap','.inspection-list-table-wrap',
  '.inspection-list-overview-wrap','.barcode-print-table-wrap','.lowstock-table-scroll',
  '.product-exchange-table-wrap','.warehouse-name-table','.transfer-items-wrap',
  '.doc-list-wrap','.seamless-table-wrap','.table-scroll'
].join(',');
const APP_TABLE_SCROLL_EXEMPT_SELECTOR='.rpt-page-scroll';

function scrollableTableFooterReserve(host,mainElement){
  const controls=[...mainElement.querySelectorAll('.pager,.audit-log-pagination')].filter(element=>{
    if(host.contains(element)||getComputedStyle(element).display==='none') return false;
    return Boolean(host.compareDocumentPosition(element)&Node.DOCUMENT_POSITION_FOLLOWING);
  });
  if(!controls.length) return 16;
  const control=controls[0];
  const style=getComputedStyle(control);
  return Math.min(110,Math.ceil(control.getBoundingClientRect().height+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0)+20));
}

function refreshScrollableTableHeights(mainElement=document.getElementById('main')){
  if(!mainElement) return;
  const mainRect=mainElement.getBoundingClientRect();
  const maxForMain=Math.max(220,Math.floor(mainElement.clientHeight-28));
  mainElement.querySelectorAll('.app-table-scroll-region').forEach(host=>{
    const top=host.getBoundingClientRect().top;
    const reserve=scrollableTableFooterReserve(host,mainElement);
    const available=Math.max(220,Math.min(maxForMain,Math.floor(mainRect.bottom-top-reserve)));
    host.style.setProperty('--app-table-scroll-height',`${available}px`);
  });
}

function prepareScrollableTables(mainElement=document.getElementById('main')){
  if(!mainElement) return;
  [...mainElement.querySelectorAll('table')].forEach(table=>{
    if(table.closest(APP_TABLE_SCROLL_EXEMPT_SELECTOR)) return;
    let host=table.closest(APP_TABLE_SCROLL_HOST_SELECTOR);
    if(!host||!mainElement.contains(host)){
      host=document.createElement('div');
      host.className='app-table-scroll-region';
      table.parentNode.insertBefore(host,table);
      host.appendChild(table);
    }else{
      host.classList.add('app-table-scroll-region');
    }
  });
  requestAnimationFrame(()=>refreshScrollableTableHeights(mainElement));
}

const TAB_DOCUMENT_TABLES={
  quotation:['quotations'],invoice:['invoices_ar'],creditnote:['credit_notes'],purchaseorder:['purchase_orders'],
  goodsreceipt:['goods_receipts'],productexchange:['product_exchanges'],
  productreturn:['product_returns'],transfer:['transfers'],taxinvoice:['standalone_tax_invoices'],
  rtax:['goods_receipts'],
};
const ON_DEMAND_AGGREGATE_TABS=new Set(['dashboard','history','rproduct','rbill','rprofit','rtax','inventorymovement']);
const onDemandTabJobs=new Map();
const onDemandTabErrors=new Map();
function localIsoDaysAgo(days){
  const date=currentLocalDate(); date.setDate(date.getDate()-Math.max(0,Number(days)||0));
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function monthServerRange(monthValue=TODAY_STR.slice(0,7)){
  const [year,month]=String(monthValue||'').split('-').map(Number);
  if(!year||!month) return serverDateRange(TODAY_STR,TODAY_STR);
  return serverDateRange(`${year}-${String(month).padStart(2,'0')}-01`,`${year}-${String(month).padStart(2,'0')}-${String(new Date(year,month,0).getDate()).padStart(2,'0')}`);
}
function salesRangeForTab(tab){
  if(tab==='dashboard') return serverDateRange(`${TODAY_STR.slice(0,7)}-01`,TODAY_STR);
  if(tab==='checkout') return serverDateRange(TODAY_STR,TODAY_STR);
  if(tab==='cashshift') return serverDateRange(String(currentCashShift?.openedAt||TODAY_STR).slice(0,10),TODAY_STR);
  if(tab==='history') return serverDateRange(historyDateRange().from,historyDateRange().to);
  if(tab==='rproduct'&&rproductFilter.applied) return serverDateRange(rproductPeriodRange().from,rproductPeriodRange().to);
  if(tab==='rbill'&&rbillFilter.applied) return serverDateRange(rbillPeriodRange().from,rbillPeriodRange().to);
  if(tab==='rprofit'&&rprofitFilter.applied) return serverDateRange(rprofitPeriodRange().from,rprofitPeriodRange().to);
  if(tab==='rtax') return monthServerRange(rtaxMonth);
  if(tab==='inventorymovement') return serverDateRange(inventoryMovementDateRange().from,inventoryMovementDateRange().to);
  if(tab==='cashbill'||tab==='taxinvoice') return serverDateRange(localIsoDaysAgo(365),TODAY_STR);
  return null;
}
function dataRequestsForTab(tab){
  const requests={sales:null,documents:[]};
  const salesRange=salesRangeForTab(tab);
  if(salesRange) requests.sales={range:salesRange,includeHolds:tab==='checkout',includeRecent:tab==='dashboard'};
  (TAB_DOCUMENT_TABLES[tab]||[]).forEach(table=>requests.documents.push({table,recent:true,range:null}));
  if(tab==='inventorymovement'){
    const range=serverDateRange(inventoryMovementDateRange().from,inventoryMovementDateRange().to);
    ['goods_receipts','product_exchanges','product_returns','transfers'].forEach(table=>requests.documents.push({table,range,recent:false}));
  }
  return requests;
}
function onDemandRequestKey(tab,requests){
  return `${tab}:${JSON.stringify({sales:requests.sales?.range||null,holds:!!requests.sales?.includeHolds,recent:!!requests.sales?.includeRecent,documents:requests.documents.map(item=>[item.table,item.range?.from||'',item.range?.to||'',!!item.recent])})}`;
}
function ensureOnDemandDataForTab(tab){
  const requests=dataRequestsForTab(tab);
  const salesNeeded=!!requests.sales&&!salesRequestLoaded(requests.sales);
  const documentsNeeded=requests.documents.filter(item=>!documentRequestLoaded(item.table,item));
  const key=onDemandRequestKey(tab,requests);
  const truncatedSales=!!requests.sales&&salesRequestTruncated(requests.sales);
  const truncatedDocuments=requests.documents.filter(item=>documentRequestTruncated(item.table,item)).map(item=>item.table);
  if(!salesNeeded&&!documentsNeeded.length){
    if(truncatedSales||truncatedDocuments.length) return {status:'truncated',key,tab,requests,truncatedSales,truncatedDocuments,blocking:ON_DEMAND_AGGREGATE_TABS.has(tab)||tab==='checkout'};
    return {status:'ready',key,tab,requests};
  }
  if(onDemandTabErrors.has(key)) return {status:'error',key,tab,requests,error:onDemandTabErrors.get(key)};
  if(!onDemandTabJobs.has(key)){
    const tasks=[];
    if(salesNeeded) tasks.push(loadSalesHistoryFromSupabase({from:requests.sales.range.from,to:requests.sales.range.to,includeHolds:requests.sales.includeHolds,includeRecent:requests.sales.includeRecent}));
    documentsNeeded.forEach(item=>tasks.push(loadDocumentTableFromSupabase(item.table,item)));
    const job=Promise.all(tasks).then(()=>{
      onDemandTabJobs.delete(key); onDemandTabErrors.delete(key);
      if(currentProfile&&(currentTab===tab||(tab==='history'&&posSalesHistoryModalOpen&&(currentTab==='checkout'||currentTab==='cashbill')))) render();
    }).catch(error=>{
      onDemandTabJobs.delete(key); onDemandTabErrors.set(key,error);
      if(currentProfile&&(currentTab===tab||(tab==='history'&&posSalesHistoryModalOpen&&(currentTab==='checkout'||currentTab==='cashbill')))) render();
    });
    onDemandTabJobs.set(key,job);
  }
  return {status:'loading',key,tab,requests};
}
function onDemandStateHtml(state){
  if(state.status==='loading') return '<div class="panel" style="margin:24px;padding:34px;text-align:center;">กำลังโหลดข้อมูลจากระบบ…</div>';
  if(state.status==='error') return `<div class="panel" style="margin:24px;padding:30px;text-align:center;"><div style="font-weight:700;margin-bottom:8px;">โหลดข้อมูลหน้านี้ไม่สำเร็จ</div><div style="color:var(--text-muted);margin-bottom:16px;">${escapeHtml(state.error?.message||'กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')}</div><button class="btn primary" id="retryOnDemandDataBtn">ลองใหม่</button></div>`;
  if(state.status!=='truncated') return '';
  const documentText=state.truncatedDocuments.length?`เอกสารเกิน ${DOCUMENT_QUERY_MAX_ROWS.toLocaleString()} รายการ`:'';
  const salesText=state.truncatedSales?`ยอดขายในช่วงที่เลือกเกิน ${SALES_QUERY_MAX_ROWS.toLocaleString()} รายการ`:'';
  const detail=[salesText,documentText].filter(Boolean).join(' และ ');
  const actions=[];
  if(state.truncatedDocuments.length) actions.push('<button class="btn ghost" id="loadAllOnDemandDocsBtn">โหลดเอกสารเก่าทั้งหมด</button>');
  if(state.truncatedSales&&state.requests.sales?.range) actions.push('<button class="btn ghost" id="loadCompleteSalesRangeBtn">โหลดช่วงที่เลือกให้ครบ</button>');
  else if(state.truncatedSales&&!state.blocking) actions.push('<button class="btn ghost" id="loadAllOnDemandSalesBtn">โหลดประวัติขายทั้งหมด</button>');
  return `<div class="panel" style="margin:16px 0;padding:18px;border-color:#e2b15b;background:#fff8e8;color:#79530f;"><b>ข้อมูลมากกว่าขีดจำกัดที่ปลอดภัย</b><div style="margin-top:5px;">${escapeHtml(detail)}${state.blocking?' กรุณาเลือกช่วงวันที่ให้แคบลงก่อนแสดงผล เพื่อไม่ให้ยอดรวมคลาดเคลื่อน':' หน้านี้กำลังแสดงเฉพาะข้อมูลล่าสุด'}</div>${actions.length?`<div style="display:flex;gap:8px;margin-top:12px;">${actions.join('')}</div>`:''}</div>`;
}
function attachOnDemandStateEvents(state){
  document.getElementById('retryOnDemandDataBtn')?.addEventListener('click',()=>{ onDemandTabErrors.delete(state.key); render(); });
  document.getElementById('loadAllOnDemandDocsBtn')?.addEventListener('click',async()=>{
    const button=document.getElementById('loadAllOnDemandDocsBtn'); if(button){ button.disabled=true; button.textContent='กำลังโหลด…'; }
    try{ await Promise.all([...new Set(state.truncatedDocuments)].map(table=>loadDocumentTableFromSupabase(table,{full:true}))); render(); }
    catch(error){ onDemandTabErrors.set(state.key,error); render(); }
  });
  document.getElementById('loadAllOnDemandSalesBtn')?.addEventListener('click',async()=>{
    const button=document.getElementById('loadAllOnDemandSalesBtn'); if(button){ button.disabled=true; button.textContent='กำลังโหลด…'; }
    try{ await loadSalesHistoryFromSupabase({full:true,includeHolds:true}); render(); }
    catch(error){ onDemandTabErrors.set(state.key,error); render(); }
  });
  document.getElementById('loadCompleteSalesRangeBtn')?.addEventListener('click',async()=>{
    const button=document.getElementById('loadCompleteSalesRangeBtn'); if(button){ button.disabled=true; button.textContent='กำลังโหลด…'; }
    const range=state.requests.sales?.range;
    try{ await loadSalesHistoryFromSupabase({from:range.from,to:range.to,includeHolds:state.requests.sales.includeHolds,completeRange:true}); render(); }
    catch(error){ onDemandTabErrors.set(state.key,error); render(); }
  });
}

const RENDERERS = {
  mobiletools: renderMobileTools,
  dashboard: renderDashboard, checkout: renderCheckout, notes: renderNotes, cashshift: renderCashShift, cashbill: ()=>renderCashBills(), taxinvoice: ()=>renderTaxInvoices(), quotation: ()=>renderQuotation(), invoice: renderInvoice,
  creditnote: renderCreditNote, history: renderHistory, purchaseorder: ()=>renderPurchaseOrder(), productreturn: ()=>renderProductReturn(), goodsreceipt: ()=>renderGoodsReceipt(), productexchange: ()=>renderProductExchange(),
  products: ()=>renderProducts(), stockcontrol: renderStockControl, barcodeprint: renderBarcodePrint, warehouse: ()=>renderWarehouse(), transfer: renderTransfer, lowstock: ()=>renderLowStock(), expiry: ()=>renderExpiry(), promotions: ()=>renderPromotions(),
  contacts: ()=>renderContacts(), customers: ()=>renderContacts(), salesreps: renderSalesRepresentatives, representativehistory: renderRepresentativeHistoryOverview, rproduct: ()=>renderRProduct(), rbill: ()=>renderRBill(), rprofit: ()=>renderRProfit(), rtax: ()=>renderRTax(),
  inventorymovement: ()=>renderInventoryMovement(), rinventory: ()=>renderRInventory(), settingsbusiness: ()=>renderBusinessSettings(), settingsuser: ()=>renderUserSettings(), settingsusers: ()=>renderSystemUsers(), settingsprinter: ()=>renderReceiptPrinterSettings(), auditlog: ()=>renderAuditLog(), settingssystem: ()=>renderSystemSettings(),
};

function render(){
  captureMobileProductDraft();
  scheduleProductReviewRefresh();
  if(!renderLoginState()){ closeMobileCameraScanner(); return; }
  TODAY_STR=currentDateStr();
  const mobileMode=isMobileDeviceMode();
  document.body.classList.toggle('mobile-device-mode',mobileMode);
  const standaloneAppWindow=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator?.standalone===true;
  document.title=standaloneAppWindow?'':'SAPURI';
  if(mobileMode) currentTab='mobiletools';
  else if(currentTab==='mobiletools') currentTab='dashboard';
  if(currentTab!=='checkout'&&!(currentTab==='cashbill'&&cashBillLookupOpen)) posSalesHistoryModalOpen=false;
  if(!canAccessTab(currentTab)){
    currentTab='dashboard';
    addingSystemUser=false; editingSystemUserId=null;
    addingWarehouse=false; editingWarehouseId=null;
    editingTransferId=null; transferDraft=null;
  }
  if(isLevel2User()&&currentTab==='products'&&editingProductId!==null&&editingProductId!=='new') editingProductId=null;
  reconcileAutoFreeLines();
  if(mobileMode){ document.getElementById('sidebar').innerHTML=''; sidebarRenderSignature=''; }
  else renderSidebar();
  // เคลียร์ปุ่มเก่าที่ topbar ก่อนสร้าง HTML ใหม่และผูก event listener เสมอ
  // ป้องกัน duplicate id ระหว่างปุ่มเก่าที่ topbar กับปุ่มใหม่ใน .main ตอน attachEvents() ค้นหาด้วย getElementById
  // (ถ้าไม่เคลียร์ก่อน document.getElementById จะเจอปุ่มเก่าที่ topbar ก่อนเสมอเพราะอยู่หน้ากว่าใน DOM แล้วผูก listener ผิดตัว)
  const topbarFormActionsSlot=document.getElementById('topbarFormActions');
  if(topbarFormActionsSlot) topbarFormActionsSlot.innerHTML='';
  const topbarDate=document.getElementById('topbarDate');
  if(topbarDate){
    topbarDate.textContent=`คลัง: ${isAllWarehousesMode()?'ทุกคลัง':(activeWarehouse()?.name||'-')} / ${fmtTopbarDate(TODAY_STR)}`;
    topbarDate.classList.add('warehouse-active');
    topbarDate.title='กดเพื่อเปลี่ยนคลังสินค้า';
    topbarDate.onclick=requestWarehouseChange;
  }
  const mainElement=document.getElementById('main');
  mainElement.classList.toggle('product-list-main',currentTab==='products'&&editingProductId===null);
  mainElement.classList.toggle('barcode-print-main',currentTab==='barcodeprint');
  mainElement.classList.toggle('sales-history-main',currentTab==='history');
  if(showPageCodeLoading(currentTab,mainElement)) return;
  mainElement.pageCodeOwner=null;
  const onDemandState=ensureOnDemandDataForTab(currentTab);
  if(onDemandState.status==='loading'||onDemandState.status==='error'||(onDemandState.status==='truncated'&&onDemandState.blocking)){
    preserveMobileCameraScanner();
    mainElement.innerHTML=onDemandStateHtml(onDemandState);
    restoreMobileCameraScanner();
    attachOnDemandStateEvents(onDemandState);
    renderLoginState();
    return;
  }
  preserveMobileCameraScanner();
  const onDemandNotice=onDemandState.status==='truncated'?onDemandStateHtml(onDemandState):'';
  posSalesHistoryOnDemandState=null;
  const focusedProductSearch=currentTab==='products'&&editingProductId===null&&document.activeElement?.matches('.product-list-search #search')?document.activeElement:null;
  const retainedSelection=focusedProductSearch?[focusedProductSearch.selectionStart,focusedProductSearch.selectionEnd]:null;
  mainElement.innerHTML = onDemandNotice+(RENDERERS[currentTab]||renderDashboard)();
  if(focusedProductSearch){
    const replacement=mainElement.querySelector('.product-list-search #search');
    if(replacement){
      focusedProductSearch.value=searchQuery;
      replacement.replaceWith(focusedProductSearch);
      restoreSearchInputFocus(...retainedSelection);
    }
  }
  applyCashShiftOverdueUi(mainElement);
  restoreMobileCameraScanner();
  prepareScrollableTables(mainElement);
  attachEvents();
  syncTopbarFormActions();
  attachMobileProductEditorEvents();
  attachOnDemandStateEvents(onDemandState);
  if(posSalesHistoryOnDemandState) attachOnDemandStateEvents(posSalesHistoryOnDemandState);
  requestAnimationFrame(()=>refreshScrollableTableHeights(mainElement));
  renderLoginState();
  if(currentTab==='mobiletools'&&mobileToolMode==='price'&&!mobileCameraSession) setTimeout(()=>document.getElementById('mobilePriceInput')?.focus(),60);
}
