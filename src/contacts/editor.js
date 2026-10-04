function renderContacts(){
  if(editingCustomerPriceContactId!==null) return renderCustomerPricingForm();
  if(editingContactId!==null) return renderContactForm();
  const isCustomers=currentTab==='customers';
  if(isCustomers&&customerHistoryView) return renderCustomerPurchaseHistory();
  const q = searchQuery.trim();
  let list = contacts.filter(c=>{
    if(!c.types.includes(isCustomers?'customer':'supplier')) return false;
    if(q){ const ql=q.toLowerCase(); return c.name.toLowerCase().includes(ql) || (c.contactName||'').toLowerCase().includes(ql) || (c.phone||'').includes(q) || (c.code||'').toLowerCase().includes(ql); }
    return true;
  });
  const typeBadge = c => {
    const isCust=c.types.includes('customer'), isSupp=c.types.includes('supplier');
    if(isCust&&isSupp) return '<span class="ct-dot both"></span>ผู้จำหน่าย/ลูกค้า';
    if(isSupp) return '<span class="ct-dot supp"></span>ผู้จำหน่าย';
    return '<span class="ct-dot cust"></span>ลูกค้า';
  };
  const typeSortLabel = c => {
    const isCust=c.types.includes('customer'), isSupp=c.types.includes('supplier');
    if(isCust&&isSupp) return 'ผู้จำหน่าย/ลูกค้า';
    if(isSupp) return 'ผู้จำหน่าย';
    return 'ลูกค้า';
  };
  // เรียงข้อมูลตามคอลัมน์ที่เลือก
  const csk = contactSort.key, csdir = contactSort.dir;
  list = list.slice().sort((a,b)=>{
    let va, vb;
    if(csk==='code'){ va=a.code||''; vb=b.code||''; }
    else if(csk==='type'){ va=typeSortLabel(a); vb=typeSortLabel(b); }
    else if(csk==='loyaltyExpiry'){
      va=customerLoyaltyExpiryFromJoinedAt(a.loyaltyJoinedAt);vb=customerLoyaltyExpiryFromJoinedAt(b.loyaltyJoinedAt);
      if(!va&&!vb) return String(a.name||'').localeCompare(String(b.name||''),'th')||String(a.id).localeCompare(String(b.id));
      if(!va) return 1;
      if(!vb) return -1;
    }
    else { va=a.name||''; vb=b.name||''; }
    return (va.localeCompare(vb,'th')||String(a.name||'').localeCompare(String(b.name||''),'th')||String(a.id).localeCompare(String(b.id)))*csdir;
  });
  const totalPages=Math.max(1,Math.ceil(list.length/CONTACTS_PER_PAGE));
  contactPage=Math.min(Math.max(1,contactPage),totalPages);
  const pageStart=(contactPage-1)*CONTACTS_PER_PAGE;
  const pageList=list.slice(pageStart,pageStart+CONTACTS_PER_PAGE);
  const purchaseState=isCustomers?customerPurchaseLoad(pageList.map(c=>c.id)):null;
  const loyaltyState=isCustomers?(pageList.length?loadCustomerLoyalty(pageList.map(c=>c.id)):{loading:false,data:[],error:''}):null;
  const sortArrow = key => contactSort.key===key ? (contactSort.dir===1?' ▲':' ▼') : '';
  const th = (key,label) => `<th class="sortable" data-sort="${key}">${label}<span class="sortarrow">${sortArrow(key)}</span></th>`;
  const tableHead=isCustomers
    ?`${th('name','ชื่อ')}<th>เบอร์โทร</th><th>ไลน์</th><th>แต้มคงเหลือ</th><th>ระดับลูกค้า</th><th>ยอดซื้อเฉลี่ยต่อเดือน</th>${th('loyaltyExpiry','วันหมดอายุแต้ม')}<th></th>`
    :`${th('code','รหัสผู้ติดต่อ')}${th('name','รายชื่อ')}<th>ชื่อผู้ติดต่อ</th><th>เบอร์ติดต่อ</th><th>อีเมล</th>${th('type','ประเภท')}<th></th>`;
  return `<div class="rpt">
    <div class="pagehead"><div><h1>${isCustomers?'ลูกค้า':'ผู้จำหน่าย'} <span class="page-title-meta">· ${list.length} รายชื่อ</span></h1></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><button class="btn ghost" id="exportContactsBtn">ส่งออก Excel</button><button class="btn ghost" id="importContactsBtn">นำเข้า Excel</button><input id="contactImportFile" type="file" accept=".xlsx,.xls,.csv" hidden><button class="btn primary" id="newContactBtn">+ สร้างใหม่</button></div></div>
    <div class="ct-tabs">
      ${isCustomers?'<button class="btn ghost" id="refreshCustomerPurchases">รีเฟรชยอดซื้อ</button>':''}
      <div class="toolbar"><div class="searchbar"><input id="search" placeholder="${isCustomers?'ค้นหาจากชื่อ / เบอร์โทร / ไลน์':'ค้นหาจากรหัสผู้ติดต่อ / ชื่อ / ผู้ติดต่อ / เบอร์'}" value="${escapeHtml(searchQuery)}"></div></div>
    </div>
    ${isCustomers?customerPurchaseNotice(purchaseState):''}
    <div class="doc-list-wrap seamless-table-wrap">
    <table class="grid-table doc-head-blue contact-summary-table"><thead><tr>${tableHead}</tr></thead>
    <tbody>${pageList.map(c=>`<tr>
      ${isCustomers?'':`<td class="mono">${escapeHtml(c.code||'-')}</td>`}
      <td style="text-align:${isCustomers?'center':'left'};">${escapeHtml(c.name)}</td>
      ${isCustomers?`<td class="mono">${escapeHtml(c.phone||'-')}</td><td>${escapeHtml(c.line||'-')}</td><td>${customerLoyaltyBalanceHtml(loyaltyState,c.id)}</td><td style="white-space:nowrap;">${customerTierOnlyHtml(purchaseState,c.id)}</td><td class="mono">${customerMonthlyAverageHtml(purchaseState,c.id)}</td><td class="mono">${customerLoyaltyExpiryHtml(loyaltyState,c.id)}</td>`:`<td>${escapeHtml(c.contactName||'-')}</td><td class="mono">${escapeHtml(c.phone||'-')}</td><td>${escapeHtml(c.email||'-')}</td><td style="white-space:nowrap;">${typeBadge(c)}</td>`}
      <td style="text-align:center;"><div class="history-actions contact-action-icons">${isCustomers?`<button class="history-icon-btn customer-purchase-history-action" data-customer-history="${c.id}" title="ประวัติการซื้อ" aria-label="ดูประวัติการซื้อ ${escapeHtml(c.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11v8"/><path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5"/><path d="M8 8h5M8 12h3"/><circle cx="17" cy="16" r="4"/><path d="M17 14v2l1.4 1"/></svg></button>`:''}${c.types.includes('customer')?`<button class="history-icon-btn customer-price-action" data-act="customerprice" data-id="${c.id}" title="ราคาพิเศษ" aria-label="ราคาพิเศษ ${escapeHtml(c.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 13 11 22l-9-9V4h9l9 9z"/><circle cx="7.5" cy="9.5" r="1.5"/></svg></button>`:''}<button class="history-icon-btn" data-act="editcontact" data-id="${c.id}" title="แก้ไข" aria-label="แก้ไข ${escapeHtml(c.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="history-icon-btn danger" data-act="deletecontact" data-id="${c.id}" title="ลบ" aria-label="ลบ ${escapeHtml(c.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div></td>
    </tr>`).join('')||`<tr><td colspan="${isCustomers?8:7}" style="text-align:center;color:var(--text-muted);padding:30px;">ไม่มีรายชื่อในกลุ่มนี้</td></tr>`}</tbody></table>
    </div>${pagerHtml(contactPage,totalPages,'contactpage')}</div>`;
}

function customerPriceRowHtml(rule={},index=0){
  const product=products.find(item=>Number(item.id)===Number(rule.productId));
  if(!product) return '';
  const options=productUnitOptions(product);
  const selectedUnit=options.some(option=>option.name===rule.unit)?rule.unit:(options[0]?.name||product.unit||'');
  const selectedOption=options.find(option=>option.name===selectedUnit)||options[0];
  return `<tr class="customer-price-row" data-customer-price-row data-product-id="${escapeHtml(product.id)}">
    <td class="mono customer-price-barcode">${escapeHtml(productBarcodeForUnit(product,selectedUnit)||'-')}</td>
    <td class="customer-price-product-name"><input type="hidden" class="customer-price-id" value="${escapeHtml(rule.id||'')}"><input type="hidden" class="customer-price-product-id" value="${escapeHtml(product.id)}"><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.sku||'-')}</small></td>
    <td><select class="customer-price-unit" aria-label="หน่วย ${escapeHtml(product.name)}">${options.map(option=>`<option value="${escapeHtml(option.name)}" ${option.name===selectedUnit?'selected':''}>${escapeHtml(option.name)}</option>`).join('')}</select></td>
    <td><input class="customer-price-value mono" type="number" min="0" step="0.01" value="${Number.isFinite(Number(rule.price))?escapeHtml(rule.price):''}" placeholder="0.00" aria-label="ราคาพิเศษ ${escapeHtml(product.name)}"></td>
    <td><input class="customer-price-cost mono" value="${escapeHtml(fmtMoney(selectedOption?.cost||0))}" readonly tabindex="-1" aria-label="ทุน ${escapeHtml(product.name)}"></td>
    <td><button class="history-icon-btn danger customer-price-remove" type="button" title="ลบราคาพิเศษ" aria-label="ลบราคาพิเศษ ${escapeHtml(product.name)}">×</button></td>
  </tr>`;
}

function sellQuotationAtPos(id){
  const quotation=quotations.find(item=>item.id===id); if(!quotation) return;
  if(cart.length&&!confirm('มีสินค้าอยู่ในหน้า POS ต้องการแทนที่ด้วยรายการจากใบเสนอราคานี้หรือไม่?')) return;
  if(quotation.saleId&&!confirm(`ใบเสนอราคานี้เคยขายแล้วในบิล ${quotation.saleId}\nต้องการนำไปขายซ้ำหรือไม่?`)) return;
  const nextCart=[];
  for(const [sourceQuotationLineIndex,item] of (quotation.items||[]).entries()){
    const storedProductId=item.productId||item.pid;
    const product=storedProductId?products.find(row=>Number(row.id)===Number(storedProductId)):products.find(row=>row.name===item.name);
    if(!product||!isProductActive(product)){ showToast(`สินค้า “${item.name||'-'}” ไม่มีอยู่หรือถูกปิดใช้งาน จึงยังนำใบเสนอราคาไปขายไม่ได้`,'danger-top'); return; }
    const option=productUnitOptions(product).find(row=>row.name===item.unit);
    if(!option){ showToast(`หน่วย ${item.unit||'-'} ของ “${product.name}” ไม่ตรงกับข้อมูลสินค้าปัจจุบัน`,'danger-top'); return; }
    nextCart.push({lineId:lineCounter++,pid:product.id,name:product.name,unit:option.name,unitName:option.name,price:Number(item.price)||0,regularPrice:Number(option.price)||0,cost:option.cost,factor:option.factor,qty:Number(item.qty)||1,priceSource:'quotation',customerPriceRuleId:null,sourceQuotationId:quotation.id,sourceQuotationLineIndex});
  }
  if(!nextCart.length){ showToast('ใบเสนอราคานี้ไม่มีรายการสินค้าที่ขายได้','danger-top'); return; }
  const customer=customersList().find(item=>String(item.id)===String(quotation.customerInfo?.id));
  saleMember=customer?customerSaleSnapshot(customer):{...(quotation.customerInfo||{}),name:quotation.customer||quotation.customerInfo?.name||'',defaultDocument:customerDefaultDocument(quotation.customerInfo)};
  cart=nextCart;
  saleLoyaltySelection=null;customerLoyaltyState=null;
  saleDiscount=Number(quotation.discount)||0;
  saleSourceQuotationId=quotation.id;
  currentTab='checkout';
  searchQuery='';
  showToast(`นำ ${quotation.id} ไปยัง POS แล้ว ราคาตามใบเสนอราคาจะไม่ซ้อนโปรโมชั่น`);
  render();
}

function emptyCustomerContactDraft(type='customer'){
  const normalizedType=type==='supplier'?'supplier':'customer';
  return {name:'',entity:normalizedType==='customer'?'individual':'juristic',types:[normalizedType],email:'',line:'',phone:'',taxId:'',creditDays:'',address:'',note:'',customerPrices:[]};
}
function contactEditorFieldsHtml(c,fixedType=''){
  const normalizedFixedType=['customer','supplier'].includes(fixedType)?fixedType:'';
  const chk = t => (c.types||[]).includes(t)?'checked':'';
  const isJuristic=c.entity!=='individual';
  const isNewCustomer=normalizedFixedType==='customer'&&!c.id;
  const requiresCustomerPhone=normalizedFixedType==='customer'||contactIncludesCustomer(c);
  const hideCode=normalizedFixedType==='customer'||currentTab==='customers';
  const typeField=normalizedFixedType
    ? `<input type="hidden" id="c_fixed_type" value="${normalizedFixedType}">`
    : `<div class="contact-editor-field"><label>ประเภท</label><div class="cradio">
            <label><input type="checkbox" id="c_type_customer" ${chk('customer')}> ลูกค้า</label>
            <label><input type="checkbox" id="c_type_supplier" ${chk('supplier')}> ผู้จำหน่าย</label>
          </div></div>`;
  const taxIdField=`<div class="contact-editor-field"><label id="c_taxid_label">${isJuristic?'เลขผู้เสียภาษี':'เลขบัตรประชาชน'}</label><input id="c_taxid" value="${escapeHtml(c.taxId||'')}" placeholder="${isJuristic?'เลขผู้เสียภาษี':'เลขบัตรประชาชน'} 13 หลัก (ไม่บังคับ)"></div>`;
  const phoneField=`<div class="contact-editor-field"><label>เบอร์โทร <span class="req" data-customer-phone-required ${requiresCustomerPhone?'':'hidden'}>*</span></label><input id="c_phone" class="phone-input" inputmode="numeric" autocomplete="tel" maxlength="12" value="${escapeHtml(formatPhoneValue(c.phone||''))}" placeholder="xxx-xxx-xxxx" ${requiresCustomerPhone?'required':''}></div>`;
  return `<div class="contact-editor-grid">
          ${typeField}
          <div class="contact-editor-field"><label>ประเภทผู้ติดต่อ</label><div class="cradio">
            <label><input type="radio" name="c_entity" value="juristic" ${c.entity==='juristic'?'checked':''}> นิติบุคคล</label>
            <label><input type="radio" name="c_entity" value="individual" ${c.entity==='individual'?'checked':''}> บุคคลธรรมดา</label>
          </div></div>
          <div class="contact-editor-identity-row contact-editor-wide ${hideCode?(isNewCustomer?'contact-editor-identity-row-customer-new':'contact-editor-identity-row-customer-edit'):''}">
            ${hideCode?'':`<div class="contact-editor-field"><label>รหัสผู้ติดต่อ</label><input id="c_code" value="${escapeHtml(c.code||'')}" placeholder="ระบบสร้างให้อัตโนมัติเมื่อบันทึก"></div>`}
            <div class="contact-editor-field"><label>ชื่อ-นามสกุล <span class="req">*</span></label><input id="c_name" value="${escapeHtml(c.name||'')}" placeholder="กรอกชื่อ-นามสกุล"></div>
            ${hideCode?phoneField:taxIdField}
            ${isNewCustomer?'':`<div class="contact-editor-field"><label>เครดิต</label><input id="c_credit" type="number" min="0" value="${escapeHtml(c.creditDays||'')}" placeholder="0 วัน"></div>`}
          </div>
          <div class="contact-editor-field contact-editor-wide"><label>ที่อยู่</label><textarea id="c_address" rows="3">${escapeHtml(c.address||'')}</textarea></div>
          <div class="contact-editor-contact-row contact-editor-wide">
            <div class="contact-editor-field"><label>อีเมล์</label><input id="c_email" type="email" value="${escapeHtml(c.email||'')}"></div>
            <div class="contact-editor-field"><label>ไลน์</label><input id="c_line" value="${escapeHtml(c.line||'')}" placeholder="LINE ID"></div>
            ${hideCode?taxIdField:phoneField}
          </div>
          <div class="contact-editor-field contact-editor-wide"><label>เพิ่มเติม</label><textarea id="c_note" rows="3">${escapeHtml(c.note||'')}</textarea></div>
      </div>`;
}
function bindContactCustomerPhoneRequirement(root=document){
  const phone=root.querySelector('#c_phone');
  const marker=root.querySelector('[data-customer-phone-required]');
  if(!phone) return;
  const update=()=>{
    const fixedType=root.querySelector('#c_fixed_type')?.value||'';
    const required=fixedType==='customer'||!!root.querySelector('#c_type_customer')?.checked;
    phone.required=required;
    if(marker) marker.hidden=!required;
  };
  root.querySelector('#c_type_customer')?.addEventListener('change',update);
  update();
}
function bindContactTaxIdLabel(root=document){
  const label=root.querySelector('#c_taxid_label');
  const input=root.querySelector('#c_taxid');
  const radios=[...root.querySelectorAll('input[name="c_entity"]')];
  if(!label||!input||!radios.length) return;
  const update=()=>{
    const isJuristic=radios.find(radio=>radio.checked)?.value!=='individual';
    const text=isJuristic?'เลขผู้เสียภาษี':'เลขบัตรประชาชน';
    label.textContent=text;
    input.placeholder=`${text} 13 หลัก (ไม่บังคับ)`;
  };
  radios.forEach(radio=>radio.addEventListener('change',update));
  update();
}
function renderContactForm(){
  const isNew = editingContactId==='new';
  const fixedType=currentTab==='customers'?'customer':'supplier';
  const c = isNew ? emptyCustomerContactDraft(fixedType) : contacts.find(x=>x.id===editingContactId);
  const saveLabel=isNew?'บันทึกแล้วปิด':'บันทึก';
  return `
    <div class="pagehead"><div><div class="breadcrumb">สมุดรายชื่อ › ${isNew?'สร้างรายชื่อผู้ติดต่อ':'แก้ไขรายชื่อผู้ติดต่อ'}</div><h1>${isNew?'สร้างรายชื่อผู้ติดต่อ':'แก้ไขรายชื่อผู้ติดต่อ'}</h1></div>
      <div class="form-final-actions" style="display:flex;gap:8px;"><button class="btn ghost" id="cancelContactBtn">ปิดหน้าต่าง</button><button class="btn primary" id="saveContactBtn">${saveLabel}</button></div>
    </div>
    <div class="panel contact-editor-panel">${contactEditorFieldsHtml(c,fixedType)}</div>`;
}

function renderCustomerPricingForm(){
  const customer=contacts.find(contact=>Number(contact.id)===Number(editingCustomerPriceContactId));
  if(!customer) return '<div class="empty">ไม่พบข้อมูลลูกค้า</div>';
  const customerPrices=normalizedCustomerPriceRules(customer);
  return `<div class="rpt customer-pricing-page">
    <div class="pagehead"><div><div class="breadcrumb">สมุดรายชื่อ › ราคาพิเศษ</div><h1>ราคาพิเศษสำหรับลูกค้ารายนี้ <span class="page-title-meta">· ${escapeHtml(customer.name)}</span></h1></div>
      <div class="form-final-actions" style="display:flex;gap:8px;"><button class="btn ghost" id="cancelCustomerPricingBtn">ย้อนกลับ</button><button class="btn primary" id="saveCustomerPricingBtn">บันทึกราคาพิเศษ</button></div>
    </div>
    <div class="panel customer-pricing-panel">
      <div class="customer-pricing-heading"><div><h3>รายการสินค้า</h3><p>ค้นหาหรือยิงบาร์โค้ดเพื่อเพิ่มสินค้า ราคานี้จะไม่ซ้อนโปรโมชั่นทั่วไป และไม่มีผลกับราคาหน้าร้านหรือตัวเลขในบิลเก่า</p></div></div>
      <div class="customer-price-search-wrap"><div class="customer-price-search"><span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/></svg></span><input id="customerPriceSearch" placeholder="ค้นหาสินค้า / รหัส / สแกนบาร์โค้ด" autocomplete="off"></div><div class="customer-price-search-results" id="customerPriceSearchResults" hidden></div></div>
      <div class="customer-price-table-wrap"><table class="grid-table customer-price-table"><colgroup><col class="customer-price-col-barcode"><col class="customer-price-col-name"><col class="customer-price-col-unit"><col class="customer-price-col-price"><col class="customer-price-col-cost"><col class="customer-price-col-action"></colgroup><thead><tr><th>บาร์โค้ดสินค้า</th><th>ชื่อ</th><th>หน่วย</th><th>ราคาพิเศษ</th><th>ทุน</th><th></th></tr></thead><tbody id="customerPriceRows">${customerPrices.map(customerPriceRowHtml).join('')||'<tr class="customer-price-empty"><td colspan="6">ยังไม่ได้กำหนดราคาพิเศษ</td></tr>'}</tbody></table></div>
    </div>
  </div>`;
}

function renderSalesRepresentatives(){
  if(!representativeHistoryContext) representativeHistoryContext={central:true,originTab:'representativehistory'};
  return renderRepresentativeHistory();
}
