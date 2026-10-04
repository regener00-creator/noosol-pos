// ---------- Sidebar ----------
const NAV = [
  {section:'ทั่วไป', items:[
    ['dashboard','DASHBOARD','<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'],
    ['notes','NOTE','<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>'],
  ]},
  {section:'ขาย', items:[
    ['checkout','POS','<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6"/>'],
    ['history','ประวัติการขาย / ใบเสร็จ','<path d="M3 3v6h6"/><path d="M3.5 13a9 9 0 1 0 2-6.6L3 9"/><path d="M12 7v5l3 3"/>'],
    ['promotions','โปรโมชั่น','<path d="M20.59 13.41 11 22H2v-9L11.41 3.59a2 2 0 0 1 2.83 0l6.35 6.35a2 2 0 0 1 0 2.83zM7 8h.01"/><circle cx="7.5" cy="7.5" r="1.5"/>'],
    ['cashshift','เปิด-ปิดระบบชำระ','<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M7 3l-2 2M17 3l2 2"/>'],
  ]},
  {section:'ซื้อ & รับสินค้า', items:[
    ['purchaseorder','สั่งซื้อสินค้า','<path d="M3 3h3l2.4 12.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6"/>'],
    ['goodsreceipt','รับเข้าสินค้า','<path d="M21 8L12 3 3 8"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13V3"/>'],
    ['productexchange','เปลี่ยนสินค้า','<path d="M7 7h11l-3-3"/><path d="M18 7l-3 3"/><path d="M17 17H6l3 3"/><path d="M6 17l3-3"/>'],
    ['productreturn','ใบคืนสินค้า','<path d="M3 7h13a5 5 0 0 1 0 10H8"/><path d="M8 13l-4 4 4 4"/><path d="M4 17h12"/>'],
  ]},
  {section:'คลัง & สินค้า', items:[
    ['products','PRODUCT','<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/>'],
    ['stockcontrol','ตรวจนับ / ปรับสต๊อก','<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h5M8 16h4"/><path d="M15 15l2 2 4-5"/>'],
    ['transfer','โอนสินค้าระหว่างคลัง','<path d="M7 16l-4-4 4-4"/><path d="M3 12h13"/><path d="M17 8l4 4-4 4"/><path d="M21 12H8"/>'],
    ['barcodeprint','พิมพ์ป้ายราคา','<path d="M3 5h2v14H3zM7 5h1v14H7zM10 5h3v14h-3zM15 5h1v14h-1zM18 5h3v14h-3z"/>'],
  ]},
  {section:'สมุดรายชื่อ', items:[
    ['contacts','ผู้จำหน่าย','<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>'],
    ['representativehistory','ผู้แทน','<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/><path d="M12 7v5l3 2"/>'],
    ['customers','ลูกค้า','<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>'],
  ]},
  {section:'เอกสารขาย', items:[
    ['cashbill','บิลเงินสด','<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/>'],
    ['taxinvoice','ใบกำกับภาษีเต็มรูปแบบ','<path d="M4 3h16v18H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>'],
    ['quotation','ใบเสนอราคา','<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5"/>'],
  ]},
  {section:'รายงาน', items:[
    ['rinventory','สินค้าคงเหลือ','<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'],
    ['lowstock','สินค้าใกล้หมด','<path d="M12 9v4"/><circle cx="12" cy="16.5" r="0.5" fill="currentColor"/><path d="M10.3 3.9L2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'],
    ['expiry','สินค้าใกล้หมดอายุ','<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M8 3.9 6.5 2.5M16 3.9l1.5-1.4"/>'],
    ['rproduct','ยอดขายตามสินค้า','<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>'],
    ['rbill','ยอดขายตามบิล','<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>'],
    ['rprofit','กำไร / ขาดทุน','<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/><path d="M7 8h12"/>'],
    ['rtax','รายงานภาษี','<path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h8M8 15h4"/>'],
    ['inventorymovement','รายงานความเคลื่อนไหว','<path d="M4 7h12"/><path d="M13 4l3 3-3 3"/><path d="M20 17H8"/><path d="M11 14l-3 3 3 3"/>'],
  ]},
  {section:'ตั้งค่า', items:[
    ['settingsbusiness','ตั้งค่าธุรกิจ','<path d="M4 21v-9l8-5 8 5v9"/><path d="M9 21v-6h6v6"/>'],
    ['warehouse','ตั้งค่าคลังสินค้า','<path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-6h6v6"/>'],
    ['settingsusers','ตั้งค่าผู้ใช้งาน','<path d="M15 19a6 6 0 0 0-12 0"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M16 11h6"/>'],
    ['settingsprinter','ตั้งค่าเครื่องพิมพ์ใบเสร็จ','<path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/>'],
    ['settingssystem','ตั้งค่าระบบ','<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'],
    ['auditlog','AUDIT LOG','<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/><path d="M8 4V2M16 4V2"/>'],
  ]},
];

let sidebarRenderSignature='';
function renderSidebar(){
  const user=loggedInUser();
  const signature=JSON.stringify([user?.id,user?.level,user?.owner,currentTab,isAllWarehousesMode(),user?.pagePermissions||[],user?.warehouseIds||[]]);
  if(signature===sidebarRenderSignature&&document.getElementById('sidebar')?.children.length) return;
  sidebarRenderSignature=signature;
  let html = `<div class="brand sidebar-user"><div class="sidebar-user-text"><b>${escapeHtml(user?.firstName||user?.username||'')}</b><span>${escapeHtml(systemUserLevelLabel(user?.level))}</span></div></div>`;
  NAV.forEach(g=>{
    const visibleItems=g.items.filter(([tab])=>canAccessTab(tab));
    if(!visibleItems.length) return;
    if(g.section) html += `<div class="navsection">${g.section}</div>`;
    visibleItems.forEach(([tab,label,svg])=>{
      html += `<button class="navbtn ${currentTab===tab?'active':''}" data-tab="${tab}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${svg}</svg>${label}</button>`;
    });
  });
  html += `<div class="sidebar-logout-wrap"><button class="logout-btn sidebar-logout-btn" id="logoutBtn">ออกจากระบบ</button></div>`;
  document.getElementById('sidebar').innerHTML = html;
  document.getElementById('logoutBtn')?.addEventListener('click',logoutSystem);
  document.querySelectorAll('.navbtn').forEach(btn=>{ btn.addEventListener('click', ()=>{ if(currentTab==='settingsbusiness'&&businessSettingsDirty&&!confirm('มีข้อมูลธุรกิจที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) return; if(currentTab==='notes'&&noteDraftDirty&&!confirm('มีโน้ตที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) return; if(isRepresentativeHistoryScreen()&&representativeActivityDraftDirty&&!confirm('มี NOTE ผู้แทนที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) return; businessSettingsDirty=false; noteDraftDirty=false; representativeActivityDraftDirty=false; currentTab = btn.dataset.tab; if(currentTab!=='checkout') posSmallestUnitOnce=false; searchQuery=''; editingPOId=null; poDraft=null; editingGRId=null; grDraft=null; editingReturnId=null; returnDraft=null; editingProductExchangeId=null; productExchangeDraft=null; editingTaxInvoiceSaleId=null; editingQuotationId=null; cashBillLookupOpen=false; taxInvoiceDraft=null; taxInvoiceAddingCustomer=false; openDocMenu=null; poSupplierEditorOpen=false; poRepresentativeEditorId=null; editingContactId=null; editingCustomerPriceContactId=null; editingSalesRepresentativeId=null; representativeHistoryContext=null; representativeActivityDraft=null; resetRepresentativeActivityLoad(); editingPromotionId=null; editingProductId=null; editingInspectionListId=null; inspectionListDraft=null; inspectionListSearchQuery=''; inspectionListCatFilter={wh:'',category:'',brand:''}; inspectionListPage=1; addingSystemUser=false; editingSystemUserId=null; addingWarehouse=false; editingWarehouseId=null; editingTransferId=null; transferDraft=null; rproductFilter.applied=false; rbillFilter.applied=false; rprofitFilter.applied=false; render(); }); });
}
