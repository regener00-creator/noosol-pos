function isProductActive(product){
  return Boolean(product)&&product.active!==false;
}
function productDataReviewStatus(product){
  const status=String(product?.dataReviewStatus||'').trim().toLowerCase();
  if(status==='pending') return 'pending';
  if(status==='complete'||String(product?.dataReviewedAt||'').trim()) return 'complete';
  return '';
}
function isProductDataReviewed(product){
  return productDataReviewStatus(product)==='complete';
}
function activeProducts(productList=products){
  return (productList||[]).filter(isProductActive);
}
function productUnitCost(p,unitName,fallbackFactor){
  if(!p) return 0;
  const mainCost=Number(p.cost!==undefined&&p.cost!==''?p.cost:p.openingCost)||0;
  if(unitName&&unitName!==p.unit){
    const u=(p.units||[]).find(x=>x.sub===unitName);
    if(u&&u.cost!==undefined&&u.cost!=='') return Number(u.cost)||0;
    return mainCost*(Number(u?.factor)||Number(fallbackFactor)||1);
  }
  return mainCost;
}
function saleLineCostSnapshot(line,product){
  const qty=Math.max(0,Number(line?.qty)||0);
  const cost=line?.custom
    ? Number(line.price)||0
    : product
      ? productUnitCost(product,line?.unit,line?.factor)
      : Number(line?.cost)||0;
  return {cost,costTotal:cost*qty,costSource:line?.custom?'custom_price':'product_manual'};
}
function customerDefaultDocument(customer){
  return 'short_receipt';
}
function customerSaleSnapshot(customer){
  if(!customer) return null;
  return {
    id:customer.id,name:customer.name||'',taxId:customer.taxId||'',address:customer.address||'',
    branch:customer.branch==='branch'?'branch':'head',branchNo:customer.branchNo||'',phone:customer.phone||'',
    email:customer.email||'',defaultDocument:customerDefaultDocument(customer),
  };
}
function activeSaleCustomer(){
  if(typeof saleMember==='undefined'||!saleMember) return null;
  if(typeof saleMember==='object') return customersList().find(customer=>String(customer.id)===String(saleMember.id))||saleMember;
  return customersList().find(customer=>customer.name===String(saleMember))||null;
}
function normalizedCustomerPriceRules(customer){
  return (Array.isArray(customer?.customerPrices)?customer.customerPrices:[]).map((rule,index)=>({
    id:String(rule.id||`${customer?.id||'customer'}-${index+1}`),
    productId:Number(rule.productId)||0,
    unit:String(rule.unit||'').trim(),
    price:Number(rule.price),
  })).filter(rule=>rule.productId&&rule.unit&&Number.isFinite(rule.price)&&rule.price>=0);
}
function customerPriceRule(customer,productId,unitName){
  return normalizedCustomerPriceRules(customer).find(rule=>Number(rule.productId)===Number(productId)&&rule.unit===String(unitName||''))||null;
}
function regularProductUnitPrice(product,unitName){
  const option=productUnitOptions(product).find(item=>item.name===unitName)||productUnitOptions(product)[0];
  return Number(option?.price)||0;
}
function applySalePriceToLine(line,product,unitName,{preserveQuotation=true}={}){
  if(!line||!product) return line;
  if(preserveQuotation&&line.priceSource==='quotation') return line;
  const regularPrice=regularProductUnitPrice(product,unitName);
  const rule=customerPriceRule(activeSaleCustomer(),product.id,unitName);
  line.regularPrice=regularPrice;
  line.price=rule?rule.price:regularPrice;
  line.priceSource=rule?'customer':'standard';
  line.customerPriceRuleId=rule?.id||null;
  return line;
}
function refreshCartCustomerPrices(){
  cart.forEach(line=>{
    if(line.custom||line.autoFreeFromPromo) return;
    const product=products.find(item=>Number(item.id)===Number(line.pid));
    if(product) applySalePriceToLine(line,product,line.unit);
  });
}
function openPOSCustomerPicker(){
  const customers=customersList();
  const selected=activeSaleCustomer();
  const pageSize=60;
  let page=1;
  const indexed=customers.map((customer,index)=>({customer,index,text:`${customer.name||''} ${customer.code||''} ${customer.phone||''} ${customer.taxId||''}`.normalize('NFKC').toLowerCase(),digits:[customer.phone,customer.taxId].map(value=>String(value||'').replace(/\D/g,''))}));
  const rowHtml=({customer,index})=>{
    const ruleCount=normalizedCustomerPriceRules(customer).length;
    const active=String(customer.id)===String(selected?.id);
    return `<button class="pos-customer-picker-item ${active?'active':''}" type="button" data-pos-customer-index="${index}">
      <span class="pos-customer-picker-main"><strong>${escapeHtml(customer.name||'-')}</strong><small>${escapeHtml(customer.phone||customer.taxId||'ไม่มีเบอร์โทร')}</small></span>
      <span class="pos-customer-picker-meta">${ruleCount?`<b>${ruleCount} ราคาพิเศษ</b>`:''}</span>
      <span class="pos-customer-picker-check">${active?'✓':''}</span>
    </button>`;
  };
  const overlay=document.createElement('div');
  overlay.className='modal-overlay pos-customer-picker-overlay';
  overlay.innerHTML=`<div class="modal pos-customer-picker-modal" role="dialog" aria-modal="true" aria-labelledby="posCustomerPickerTitle">
    <div class="modal-head"><div><h3 id="posCustomerPickerTitle">เลือกสมาชิก</h3></div><div class="pos-customer-picker-head-actions"><button class="btn primary" id="addPOSCustomerBtn" type="button">เพิ่มลูกค้า</button><button class="modal-close" type="button" aria-label="ปิด">×</button></div></div>
    <div class="pos-customer-picker-search"><input id="posCustomerPickerSearch" type="search" placeholder="ค้นหาชื่อ-เบอร์โทร" autocomplete="off"></div>
    <div class="pos-customer-picker-list">
      <div id="posCustomerPickerRows"></div>
      <div class="pos-customer-picker-empty" id="posCustomerPickerNoResults" hidden>ไม่พบลูกค้าที่ค้นหา</div>
      <div class="picker-pagination" id="posCustomerPickerPager" aria-live="polite"></div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  const choose=customer=>{
    saleMember=customer?customerSaleSnapshot(customer):null;
    saleLoyaltySelection=null;customerLoyaltyState=null;
    refreshCartCustomerPrices();
    close();
    render();
  };
  overlay.querySelector('.modal-close').addEventListener('click',close);
  overlay.querySelector('#addPOSCustomerBtn').addEventListener('click',()=>{
    close();
    openPOSCustomerCreateModal();
  });
  overlay.addEventListener('mousedown',event=>{ if(event.target===overlay) close(); });
  overlay.querySelector('#posCustomerPickerRows').addEventListener('click',event=>{
    if(event.target.closest('[data-pos-customer-general]')){ choose(null); return; }
    const button=event.target.closest('[data-pos-customer-index]');
    if(button) choose(customers[Number(button.dataset.posCustomerIndex)]);
  });
  const search=overlay.querySelector('#posCustomerPickerSearch');
  const noResults=overlay.querySelector('#posCustomerPickerNoResults');
  const renderRows=()=>{
    const query=search.value.normalize('NFKC').trim().toLowerCase();
    const digits=/^[\d\s()+-]+$/.test(query)?query.replace(/\D/g,''):'';
    const matches=indexed.filter(entry=>!query||entry.text.includes(query)||(digits&&entry.digits.some(value=>value.includes(digits))));
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));
    page=Math.min(page,pages);
    overlay.querySelector('#posCustomerPickerRows').innerHTML=`<button class="pos-customer-picker-item ${selected?'':'active'}" type="button" data-pos-customer-general>
      <span class="pos-customer-picker-main"><strong>ลูกค้าทั่วไป</strong><small>ไม่ใช้ราคาพิเศษของสมาชิก</small></span>
      <span class="pos-customer-picker-meta"></span>
      <span class="pos-customer-picker-check">${selected?'':'✓'}</span>
    </button>`+matches.slice((page-1)*pageSize,page*pageSize).map(rowHtml).join('');
    noResults.hidden=matches.length>0;
    overlay.querySelector('#posCustomerPickerPager').innerHTML=`<span>${matches.length} รายชื่อ · หน้า ${page} / ${pages}</span>${pages>1?`<button class="btn ghost" type="button" data-customer-page="-1" ${page===1?'disabled':''}>ก่อนหน้า</button><button class="btn ghost" type="button" data-customer-page="1" ${page===pages?'disabled':''}>ถัดไป</button>`:''}`;
  };
  search.addEventListener('input',()=>{ page=1; renderRows(); });
  overlay.querySelector('#posCustomerPickerPager').addEventListener('click',event=>{
    const button=event.target.closest('[data-customer-page]');
    if(button&&!button.disabled){ page+=Number(button.dataset.customerPage); renderRows(); overlay.querySelector('.pos-customer-picker-list').scrollTop=0; }
  });
  renderRows();
  requestAnimationFrame(()=>search.focus());
}
function generateClientRecordId(records=[]){
  const used=new Set((records||[]).map(record=>String(record?.id)));
  for(let attempt=0;attempt<64;attempt++){
    const candidate=randomProductIdCandidate();
    if(Number.isSafeInteger(candidate)&&candidate>0&&!used.has(String(candidate))) return candidate;
  }
  throw new Error('ไม่สามารถสร้างรหัสอ้างอิงใหม่ได้ กรุณาลองอีกครั้ง');
}
function generateInspectionListId(){
  const prefix=normalizeDocumentPrefix(documentPrefixes.inspection,'IC');
  const token=globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${randomProductIdCandidate().toString(36)}`;
  return `${prefix}-${String(token).replaceAll('-','').slice(0,16).toUpperCase()}`;
}
function openPOSCustomerCreateModal(){
  const overlay=document.createElement('div');
  overlay.className='modal-overlay pos-customer-create-overlay';
  overlay.innerHTML=`<div class="modal pos-customer-create-modal" role="dialog" aria-modal="true" aria-labelledby="posCustomerCreateTitle">
    <div class="modal-head"><div><h3 id="posCustomerCreateTitle">สร้างรายชื่อผู้ติดต่อ</h3><div class="sub">เพิ่มลูกค้าใหม่โดยไม่ต้องออกจากหน้า POS</div></div><button class="modal-close" type="button" aria-label="ปิด">×</button></div>
    <div class="pos-customer-create-body">${contactEditorFieldsHtml(emptyCustomerContactDraft(),'customer')}</div>
    <div class="pos-customer-create-actions"><button class="btn ghost" id="cancelPOSCustomerCreateBtn" type="button">ปิดหน้าต่าง</button><button class="btn primary" id="savePOSCustomerCreateBtn" type="button">บันทึกแล้วปิด</button></div>
  </div>`;
  document.body.appendChild(overlay);
  bindContactTaxIdLabel(overlay);
  bindContactCustomerPhoneRequirement(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').addEventListener('click',close);
  overlay.querySelector('#cancelPOSCustomerCreateBtn').addEventListener('click',close);
  overlay.addEventListener('mousedown',event=>{ if(event.target===overlay) close(); });
  overlay.querySelector('#savePOSCustomerCreateBtn').addEventListener('click',async()=>{
    const customer=await saveContactFromEditor('new',overlay.querySelector('#savePOSCustomerCreateBtn'));
    if(!customer) return;
    saleMember=customerSaleSnapshot(customer);
    saleLoyaltySelection=null;customerLoyaltyState=null;
    refreshCartCustomerPrices();
    close();
    render();
  });
  overlay.querySelector('#c_name')?.focus();
}
function addToCart(pid, unitName, qty){
  const p = products.find(x=>x.id===pid); if(!p) return;
  if(p.active===false){ showToast(`สินค้า “${p.name}” ถูกปิดใช้งานแล้ว`,'danger-top'); return; }
  qty = qty || 1;
  // หาหน่วยที่เลือก: ถ้าเป็นหน่วยหลักใช้ราคาปกติ, ถ้าเป็นหน่วยรองใช้ factor+ราคาของหน่วยนั้น
  let unit=p.unit, price=p.price, factor=1, cost=productUnitCost(p,p.unit,1);
  if(unitName && unitName!==p.unit){
    const u=(p.units||[]).find(x=>x.sub===unitName);
    if(u){ unit=u.sub; price=u.price||p.price*(u.factor||1); factor=u.factor||1; cost=productUnitCost(p,u.sub,factor); }
  }
  // ถ้ามีบรรทัดสินค้า+หน่วยเดียวกันอยู่แล้ว บวกจำนวนเข้าไป
  const existing = cart.find(l=>l.pid===pid && l.unit===unit);
  if(existing){ existing.qty += qty; }
  else {
    const line={lineId:lineCounter++, pid, name:p.name, unit, unitName:unit, price, regularPrice:price, cost, factor, qty,priceSource:'standard',customerPriceRuleId:null};
    applySalePriceToLine(line,p,unit,{preserveQuotation:false});
    cart.push(line);
  }
}
function addCustomCartLine(name,price,unit,qty){
  name=String(name||'').trim(); unit=String(unit||'ชิ้น').trim()||'ชิ้น'; price=Number(price)||0; qty=Number(qty)||1;
  if(!name||price<0||qty<=0) return false;
  const existing=cart.find(line=>line.custom&&line.name===name&&line.unit===unit&&Number(line.price)===price);
  if(existing) existing.qty+=qty;
  else cart.push({lineId:lineCounter++,pid:null,name,unit,unitName:unit,price,cost:price,factor:0,qty,custom:true});
  return true;
}
function addBlankCustomCartLine(){
  const lineId=lineCounter++;
  cart.push({lineId,pid:null,name:'',unit:'',unitName:'',price:'',cost:'',factor:0,qty:1,custom:true});
  render();
  setTimeout(()=>document.querySelector(`.custom-line-name[data-line="${lineId}"]`)?.focus(),0);
}
