function readContractSteps(row){
  const steps=[];
  const base=row.querySelector('.customer-price-value').value;
  const unit=row.querySelector('.customer-price-unit').value;
  const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
  const regular=regularProductUnitPrice(product,unit),cost=productUnitCost(product,unit);
  const inherited=row.inheritedPriceRule;
  const ceiling=Math.min(regular,base===''?(inherited?.price??regular):Number(base));
  function warn(message,input){showToast(unit+' · '+message,'danger-top');setContractTierExpanded(row,true);input?.focus();return null;}
  for(const entry of row.nextElementSibling.querySelectorAll('.contract-editable-tier .tier-edit-row')){
    const minimum=entry.querySelector('.tier-min'),amount=entry.querySelector('.tier-price');
    const minQty=Number(minimum.value),price=Number(amount.value);
    if(minimum.value===''&&amount.value===''&&!minimum.validity.badInput&&!amount.validity.badInput) continue;
    if(!Number.isSafeInteger(minQty)||minQty<1) return warn('ซื้อขั้นต่ำต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป',minimum);
    if(amount.value===''||!amount.validity.valid) return warn('กรอกราคาต่อหน่วยให้ถูกต้อง',amount);
    if(price<cost) return warn('ราคาขั้นบันไดต้องไม่ต่ำกว่าทุน '+fmtMoney(cost),amount);
    if(price>ceiling) return warn('ราคาขั้นบันไดต้องไม่เกิน '+fmtMoney(ceiling),amount);
    if(steps.some(step=>step.minQty===minQty)) return warn('จำนวนซื้อขั้นต่ำซ้ำกัน',minimum);
    steps.push({minQty,price});
  }
  const merged=contractTierSteps(inherited,{tiers:steps});
  if(steps.length&&merged.some((step,i)=>i>0&&step.price>=merged[i-1].price))
    return warn('ราคาขั้นถัดไปต้องต่ำกว่าขั้นก่อนหน้า รวมขั้นที่ใช้จากกลุ่ม');
  return steps.sort((a,b)=>a.minQty-b.minQty);
}
function collectCustomerPriceRules(root=document){
  const rules=[];
  const duplicateKeys=new Set();
  for(const row of root.querySelectorAll('[data-customer-price-row]')){
    const productId=Number(row.querySelector('.customer-price-product-id')?.value||row.dataset.productId);
    const unit=String(row.querySelector('.customer-price-unit')?.value||'').trim();
    const priceText=String(row.querySelector('.customer-price-value')?.value||'').trim();
    const product=products.find(item=>Number(item.id)===productId);
    if(!product){ showToast('ไม่พบสินค้าที่กำหนดราคาพิเศษ กรุณาลบรายการแล้วเพิ่มใหม่','danger-top'); return null; }
    if(!productUnitOptions(product).some(option=>option.name===unit)){ showToast(`หน่วย “${unit||'-'}” ไม่ได้อยู่ในสินค้า “${product.name}”`,'danger-top'); row.querySelector('.customer-price-unit')?.focus(); return null; }
    const tiers=readContractSteps(row);
    if(tiers===null) return null;
    const price=priceText===''?null:Number(priceText);
    if((price===null&&!tiers.length)||(price!==null&&(!Number.isFinite(price)||price<0))){ showToast('กรุณากรอกราคาพิเศษให้ถูกต้อง','danger-top'); row.querySelector('.customer-price-value')?.focus(); return null; }
    const key=`${product.id}::${unit}`;
    if(duplicateKeys.has(key)){ showToast(`กำหนดราคา “${product.name}” หน่วย ${unit} ซ้ำกัน`,'danger-top'); return null; }
    duplicateKeys.add(key);
    rules.push({id:String(row.querySelector('.customer-price-id')?.value||crypto.randomUUID()),productId:product.id,unit,price,...(tiers.length?{tiers}:{})});
  }
  return rules;
}

function saveContactEditorData(contactId=editingContactId){
  const g = id => document.getElementById(id);
  const name = g('c_name').value.trim();
  if(!name){ showToast('กรุณากรอกชื่อ-นามสกุล'); g('c_name').focus(); return null; }
  const existing=contactId==='new'?null:storeContacts().find(x=>x.id===contactId);
  if(contactId!=='new'&&!existing)return null;
  const fixedType=g('c_fixed_type')?.value||'';
  const validTypes=['customer','supplier'];
  const types = validTypes.includes(fixedType)
    ? [...new Set([...(existing?.types||[]).filter(type=>validTypes.includes(type)),fixedType])]
    : [];
  if(!fixedType&&g('c_type_customer')?.checked) types.push('customer');
  if(!fixedType&&g('c_type_supplier')?.checked) types.push('supplier');
  if(types.length===0){ showToast('กรุณาเลือกประเภท (ลูกค้า หรือ ผู้จำหน่าย)'); return null; }
  const phoneInput=g('c_phone');
  const phone=formatPhoneValue(phoneInput?.value||'');
  if(types.includes('customer')&&!normalizedPhoneDigits(phone)){
    showToast('กรุณากรอกเบอร์โทรลูกค้า','danger-top'); phoneInput?.focus(); return null;
  }
  const duplicatePhone=types.includes('customer')?duplicateCustomerPhone(phone,existing?.id):null;
  if(duplicatePhone){
    showToast(`เบอร์โทร ${phone} ถูกใช้แล้วโดยลูกค้า “${duplicatePhone.name||'-'}”`,'danger-top'); phoneInput?.focus(); return null;
  }
  const recordId=contactId==='new'?generateClientRecordId(contacts):existing?.id;
  const codeInput=g('c_code');
  const enteredCode=codeInput?.value.trim()||'';
  const code=enteredCode||existing?.code||'';
  if(code){
    const dup = storeContacts().find(x=>x.id!==contactId && String(x.code||'').trim().toLowerCase()===code.toLowerCase());
    if(dup){ showToast(`รหัสผู้ติดต่อ "${code}" ถูกใช้แล้วโดย "${dup.name}"`); codeInput?.focus(); return null; }
  }
  const entityEl = document.querySelector('input[name="c_entity"]:checked');
  const data = {
    name, types,
    ...(g('contactPriceGroup')?{priceGroupId:g('contactPriceGroup').value||null}:{}),
    entity: entityEl?entityEl.value:'juristic',
    code,
    ...(!code?{_autoCode:true}:{}),
    taxId: g('c_taxid').value.trim(),
    creditDays: g('c_credit')?(parseInt(g('c_credit').value)||''):(existing?.creditDays||''),
    address: g('c_address').value.trim(),
    email: g('c_email').value.trim(),
    line: g('c_line').value.trim(),
    phone,
    note: g('c_note').value.trim(),
    defaultDocument:'short_receipt',
  };
  if(existing){
    ['postcode','contactName','bank','bankName','bankAcc','accType'].forEach(key=>{
      if(Object.hasOwn(existing,key)) data[key]=existing[key];
    });
  }
  let savedContact=existing;
  if(contactId==='new'){
    savedContact={id:recordId, warehouseId:activeWarehouseId, ...data, customerPrices:[],loyaltyJoinedAt:new Date().toISOString()};
    contacts.push(savedContact);
    showToast(`กำลังบันทึก "${name}" ระบบจะสร้างรหัสเมื่อซิงก์สำเร็จ`);
  } else {
    Object.assign(savedContact, data);
    showToast(`กำลังเก็บและซิงก์ "${name}" กรุณาตรวจสถานะซิงก์`);
  }
  persistContacts();
  return savedContact;
}
async function saveContactFromEditor(contactId=editingContactId,saveButton=null){
  const previousContact=contacts.find(row=>String(row.id)===String(contactId));
  const before=previousContact?cloneSyncRecords([previousContact])[0]:null;
  const previousRecovery=workspaceRecoveryEntries.get(`contacts:${contactId}`);
  const beforeRecovery=previousRecovery?structuredClone(previousRecovery):null;
  const originalButtonText=saveButton?.textContent||'';
  const savedContact=saveContactEditorData(contactId);
  if(!savedContact) return null;
  const fingerprint=record=>{ const copy={...record}; delete copy._revision; delete copy._clientCreateToken; return JSON.stringify(canonicalProductInsertValue(copy)); };
  const savedFingerprint=fingerprint(savedContact);
  if(saveButton){ saveButton.disabled=true; saveButton.textContent='กำลังบันทึก...'; }
  try{
    await persistContactImmediately(savedContact);
    showToast(`บันทึก “${savedContact.name}” แล้ว`);
    return savedContact;
  }catch(error){
    console.warn('save contact',error);
    if(isDuplicateCustomerPhoneError(error)){
      // A definitive phone rejection can roll back this draft only. Network
      // failures keep their durable copy; never restore a stale entire array.
      if(contacts.find(row=>row.id===savedContact.id)===savedContact&&fingerprint(savedContact)===savedFingerprint){
        contacts=contacts.filter(row=>row!==savedContact);
        if(before) contacts.push(before);
        workspaceRecoveryEntries.delete(`contacts:${savedContact.id}`);
        if(beforeRecovery) workspaceRecoveryEntries.set(`contacts:${savedContact.id}`,beforeRecovery);
        upsertAndPrune.paused?.delete(`contacts:${savedContact.id}`);
        persistContacts();
      }
      showToast(`เบอร์โทร ${savedContact.phone||''} มีลูกค้ารายอื่นใช้งานแล้ว`,'danger-top');
    }
    else{
      rememberSyncUiError(error,{operation:'save_contact',tableName:'contacts',recordId:savedContact.id,fallbackMessage:'บันทึกลูกค้าไม่สำเร็จ'});
      showToast('ยังซิงก์รายชื่อไม่สำเร็จ เก็บงานไว้ในเครื่องแล้ว กรุณาเปิดรายละเอียดการซิงก์','danger-top');
    }
    if(saveButton){ saveButton.disabled=false; saveButton.textContent=originalButtonText; }
    return null;
  }
}
async function saveContact(){
  const saveButton=document.getElementById('saveContactBtn');
  const savedContact=await saveContactFromEditor(editingContactId,saveButton);
  if(!savedContact) return;
  editingContactId = null;
  render();
}

async function saveCustomerPricing({root=document,customerId=editingCustomerPriceContactId,onSaved}={}){
  if(!canPerformPageAction('edit','customers')){showToast('ไม่มีสิทธิ์แก้ไขราคาพิเศษ','danger-top');return;}
  const saveButton=root.querySelector('#saveCustomerPricingBtn');
  if(saveButton?.disabled) return;
  const customer=storeContacts().find(contact=>Number(contact.id)===Number(customerId));
  if(!customer){ showToast('ไม่พบข้อมูลลูกค้า','danger-top'); return; }
  const customerPrices=collectCustomerPriceRules(root);
  if(customerPrices===null) return;
  const belowCost=customerPrices.flatMap(rule=>{
    const product=products.find(item=>Number(item.id)===Number(rule.productId));
    const cost=Number(productUnitOptions(product).find(option=>option.name===rule.unit)?.cost)||0;
    return rule.price!=null&&rule.price<cost?[`${product.name} (${rule.unit}) — ราคาพิเศษ ${fmtMoney(rule.price)} บาท / ทุน ${fmtMoney(cost)} บาท`]:[];
  });
  if(belowCost.length&&!confirm(`ราคาพิเศษต่ำกว่าทุน ${belowCost.length} รายการ อาจทำให้ขายขาดทุน\n\n${belowCost.join('\n')}\n\nยืนยันบันทึกราคาพิเศษนี้หรือไม่?`)) return;
  const visibleProductIds=new Set(products.map(product=>Number(product.id)));
  const otherPrices=(customer.customerPrices||[]).filter(rule=>!visibleProductIds.has(Number(rule.productId)));
  customer.customerPrices=[...customerPrices,...otherPrices];
  persistContacts();
  if(saveButton){ saveButton.disabled=true; saveButton.textContent='กำลังบันทึก...'; }
  try{
    await persistContactImmediately(customer);
    showToast(`บันทึกราคาพิเศษของ “${customer.name}” แล้ว`);
    if(onSaved){if(saveButton)saveButton.disabled=false;onSaved(customer);}
    else{editingCustomerPriceContactId=null;render();}
  }catch(error){
    console.warn('save customer pricing',error);
    rememberSyncUiError(error,{operation:'save_customer_pricing',tableName:'contacts',recordId:customer.id,fallbackMessage:'บันทึกราคาพิเศษไม่สำเร็จ'});
    showToast('บันทึกราคาพิเศษขึ้นระบบไม่สำเร็จ กรุณาลองอีกครั้ง','danger-top');
    if(saveButton){ saveButton.disabled=false; saveButton.textContent='บันทึก'; }
  }
}

function deleteContact(id){
  const contact=storeContacts().find(x=>x.id===id); if(!contact) return;
  if(!confirm(`ยืนยันลบรายชื่อ "${contact.name}" ?`)) return;
  contacts=contacts.filter(x=>x.id!==id);
  persistContacts();
  showToast(`ลบรายชื่อ "${contact.name}" แล้ว`);
  render();
}

function openPriceGroups(){
  if(!loggedInUser()?.owner||currentTab!=='customers') return;
  priceGroupPage={groupId:storePriceGroups()[0]?.id||'',saving:false};
  render();
}
function attachPriceGroupEvents(page){
  const view=priceGroupPage;
  const context=captureStoreView();
  const groups=storePriceGroups();
  const group=groups.find(entry=>entry.id===view.groupId);
  const select=page.querySelector('[data-group-select]');
  const save=page.querySelector('[data-save-group]');
  const back=page.querySelector('[data-back-group]');
  const remove=page.querySelector('[data-delete-group]');
  const controls=[select,save,back,...(remove?[remove]:[])];
  controls.forEach(control=>control.disabled=view.saving);
  back.onclick=()=>{priceGroupPage=null;render();};
  select.onchange=()=>{view.groupId=select.value;render();};
  attachCustomerPricingEvents(page,{customerId:null});
  const canChangeGroup=()=>!view.saving&&isStoreViewCurrent(context)&&loggedInUser()?.owner;
  save.onclick=()=>{
    if(!canChangeGroup()) return;
    const name=page.querySelector('[data-group-name]').value.trim();
    if(!name||groups.some(entry=>entry.id!==view.groupId&&entry.name===name)){
      showToast('กรุณาใช้ชื่อกลุ่มที่ไม่ว่างและไม่ซ้ำ');
      return;
    }
    const customerPrices=collectCustomerPriceRules(page);
    if(!customerPrices) return;
    return submit({id:group?.id||crypto.randomUUID(),name,customerPrices});
  };
  if(remove) remove.onclick=()=>{
    if(!canChangeGroup()||!confirm(`ลบกลุ่มราคา “${group.name}” ใช่ไหม? ลูกค้าที่อยู่ในกลุ่มนี้จะใช้ราคาปกติหรือราคาพิเศษรายบุคคลที่ตั้งไว้`)) return;
    return submit({id:group.id,remove:true});
  };
  async function submit(updated){
    const action=updated.remove?'ลบ':'บันทึก';
    view.saving=true;
    controls.forEach(control=>control.disabled=true);
    let saved=false;
    try{
      const {data,error}=await sb.rpc('save_store_price_group',{p_warehouse_id:context.store,p_expected:group||null,p_group:updated});
      if(error) throw error;
      if(isStoreViewCurrent(context)){
        warehouseBusinessProfiles[context.store]={...warehouseBusinessSettings(),priceGroups:data};
        persistWorkspaceData();
        showToast(action+'กลุ่มราคาแล้ว');
        view.groupId=updated.remove?(data[0]?.id||''):updated.id;
        saved=true;
      }
    }catch(error){
      showToast(action+'กลุ่มราคาไม่สำเร็จ · '+error.message,'danger-top');
    }finally{
      view.saving=false;
      controls.forEach(control=>control.disabled=false);
      if(priceGroupPage===view&&currentTab==='customers'&&isStoreViewCurrent(context)&&(saved||!page.isConnected)) render();
    }
  }
}
function setContractTierExpanded(row,expanded){
  row.nextElementSibling.hidden=!expanded;
  row.querySelector('[data-contract-toggle]').setAttribute('aria-expanded',String(expanded));
  refreshScrollableTableHeights();
}
function attachCustomerPricingEvents(root=document,{customerId=editingCustomerPriceContactId,onClose=()=>{editingCustomerPriceContactId=null;render();},onSaved}={}){
  const cancelCustomerPricingBtn=root.querySelector('#cancelCustomerPricingBtn');
  if(cancelCustomerPricingBtn) cancelCustomerPricingBtn.addEventListener('click',onClose);
  const saveCustomerPricingBtn=root.querySelector('#saveCustomerPricingBtn');
  if(saveCustomerPricingBtn) saveCustomerPricingBtn.addEventListener('click',()=>saveCustomerPricing({root,customerId,onSaved}));
  const customerPriceRows=root.querySelector('#customerPriceRows');
  const group=customerGroupForPricing(customerId==null?null:storeContacts().find(contact=>Number(contact.id)===Number(customerId)));
  const bindCustomerPriceRows=()=>root.querySelectorAll('[data-customer-price-row]').forEach(row=>{
    const unitSelect=row.querySelector('.customer-price-unit');
    const priceInput=row.querySelector('.customer-price-value');
    const detail=row.nextElementSibling;
    const refreshContractUnit=()=>{
      const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
      const unit=unitSelect.value;
      row.inheritedPriceRule=customerPriceRule(group,product.id,unit);
      detail.querySelector('.contract-inherited').textContent=inheritedContractText(row.inheritedPriceRule,unit);
      detail.querySelector('.contract-editable-tier h4').textContent='ราคาขั้นบันได · '+unit;
      detail.querySelector('.contract-general-tier').innerHTML=contractGeneralTierHtml(product,unit);
      const cost=row.querySelector('.customer-price-cost').value;
      detail.querySelectorAll('.contract-editable-tier .tier-cost').forEach(input=>input.value=cost);
      priceInput.placeholder=row.inheritedPriceRule?.price!=null?fmtMoney(row.inheritedPriceRule.price):'ราคาปกติ';
    };
    refreshContractUnit();
    row.querySelector('[data-contract-toggle]').onclick=()=>setContractTierExpanded(row,detail.hidden);
    detail.onclick=event=>{
      const button=event.target.closest('[data-add-tier],[data-remove-tier]');
      if(!button) return;
      const rows=detail.querySelector('.contract-editable-tier .tier-edit-rows');
      if(button.hasAttribute('data-remove-tier')){
        rows.lastElementChild?.remove();
        if(!rows.lastElementChild) detail.querySelector('[data-add-tier]')?.focus();
        return;
      }
      if(readContractSteps(row)===null) return;
      const lastMinimum=rows.lastElementChild?.querySelector('.tier-min');
      if(lastMinimum?.value===''){lastMinimum.focus();return;}
      rows.insertAdjacentHTML('beforeend',priceTierRowHtml({},{cost:row.querySelector('.customer-price-cost').value}));
      rows.lastElementChild.querySelector('.tier-min').focus();
    };
    const updatePriceComparison=()=>{
      const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
      const option=productUnitOptions(product).find(item=>item.name===unitSelect.value);
      const comparison=customerPriceComparison(priceInput.value,option?.price||0,option?.cost||0);
      priceInput.classList.toggle('below-regular',comparison==='below-regular');
      priceInput.classList.toggle('above-regular',comparison==='above-regular');
      priceInput.classList.toggle('below-cost',comparison==='below-cost');
    };
    priceInput.oninput=updatePriceComparison;
    // Keep repeated Enter presses in editable prices, away from delete/add-sale buttons.
    priceInput.onkeydown=event=>{
      if(event.key!=='Enter'||event.isComposing||event.keyCode===229||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey) return;
      event.preventDefault();
      if(event.repeat) return;
      const inputs=[...root.querySelectorAll('.customer-price-value:not(:disabled)')];
      const next=inputs[inputs.indexOf(priceInput)+1]||root.querySelector('#customerPriceSearch');
      next?.focus();
    };
    if(unitSelect){
      unitSelect.dataset.previousUnit=unitSelect.value;
      unitSelect.onchange=()=>{
        const productId=Number(row.querySelector('.customer-price-product-id')?.value||row.dataset.productId);
        const duplicate=[...root.querySelectorAll('[data-customer-price-row]')].find(other=>other!==row&&Number(other.querySelector('.customer-price-product-id')?.value||other.dataset.productId)===productId&&other.querySelector('.customer-price-unit')?.value===unitSelect.value);
        if(duplicate){ showToast('สินค้านี้มีราคาพิเศษของหน่วยที่เลือกอยู่แล้ว','danger-top'); unitSelect.value=unitSelect.dataset.previousUnit; return; }
        const product=products.find(item=>Number(item.id)===productId);
        const option=productUnitOptions(product).find(item=>item.name===unitSelect.value);
        row.querySelector('.customer-price-barcode').textContent=productBarcodeForUnit(product,unitSelect.value)||'-';
        row.querySelector('.customer-price-regular').value=fmtMoney(option?.price||0);
        row.querySelector('.customer-price-cost').value=fmtMoney(option?.cost||0);
        unitSelect.dataset.previousUnit=unitSelect.value;
        refreshContractUnit();
        updatePriceComparison();
      };
    }
    const remove=row.querySelector('.customer-price-remove');
    if(remove) remove.onclick=()=>{
      const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
      if(!confirm(`ยืนยันลบ “${product?.name||'สินค้า'}” หน่วย ${unitSelect.value} ออกจากรายการราคาพิเศษหรือไม่?`)) return;
      detail.remove();
      row.remove();
      if(customerPriceRows&&!customerPriceRows.querySelector('[data-customer-price-row]')) customerPriceRows.innerHTML='<tr class="customer-price-empty"><td colspan="7">ยังไม่ได้กำหนดราคาพิเศษ</td></tr>';
    };
  });
  const customerPriceSearch=root.querySelector('#customerPriceSearch');
  const customerPriceSearchResults=root.querySelector('#customerPriceSearchResults');
  const customerPriceMatches=query=>productScanMatches(query).map(({product,unitName})=>({product,unit:unitName}));
  const addCustomerPriceProduct=(product,unit)=>{
    if(!product||!customerPriceRows) return;
    const selectedUnit=productUnitOptions(product).some(option=>option.name===unit)?unit:product.unit;
    const existing=[...customerPriceRows.querySelectorAll('[data-customer-price-row]')].find(row=>Number(row.querySelector('.customer-price-product-id')?.value||row.dataset.productId)===Number(product.id)&&row.querySelector('.customer-price-unit')?.value===selectedUnit);
    if(existing){ showToast(`มีราคาพิเศษ “${product.name}” หน่วย ${selectedUnit} อยู่แล้ว`); existing.querySelector('.customer-price-value')?.focus(); return; }
    customerPriceRows.querySelector('.customer-price-empty')?.remove();
    customerPriceRows.insertAdjacentHTML('beforeend',customerPriceRowHtml({productId:product.id,unit:selectedUnit,price:''},customerPriceRows.querySelectorAll('[data-customer-price-row]').length,root.matches?.('.pos-customer-pricing-overlay'),group));
    bindCustomerPriceRows();
    customerPriceRows.querySelector('[data-customer-price-row]:nth-last-child(2) .customer-price-value')?.focus();
    if(customerPriceSearch) customerPriceSearch.value='';
    if(customerPriceSearchResults){ customerPriceSearchResults.hidden=true; customerPriceSearchResults.innerHTML=''; }
  };
  const renderCustomerPriceSearchResults=()=>{
    if(!customerPriceSearch||!customerPriceSearchResults) return [];
    const query=customerPriceSearch.value.trim();
    const matches=customerPriceMatches(query);
    if(!query){ customerPriceSearchResults.hidden=true; customerPriceSearchResults.innerHTML=''; return matches; }
    customerPriceSearchResults.innerHTML=matches.length?matches.map(({product,unit})=>`<button class="customer-price-search-result" type="button" data-customer-price-product="${escapeHtml(product.id)}" data-customer-price-unit="${escapeHtml(unit)}"><span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(productBarcodeForUnit(product,unit)||product.sku||'-')} · ${escapeHtml(unit)}</small></span><strong class="mono">${fmtMoney(regularProductUnitPrice(product,unit))}</strong></button>`).join(''):'<div class="customer-price-search-empty">ไม่พบสินค้า</div>';
    customerPriceSearchResults.hidden=false;
    customerPriceSearchResults.querySelectorAll('[data-customer-price-product]').forEach(button=>{
      button.onmousedown=event=>event.preventDefault();
      button.onclick=()=>addCustomerPriceProduct(products.find(product=>Number(product.id)===Number(button.dataset.customerPriceProduct)),button.dataset.customerPriceUnit);
    });
    return matches;
  };
  if(customerPriceSearch){
    customerPriceSearch.addEventListener('input',renderCustomerPriceSearchResults);
    customerPriceSearch.addEventListener('keydown',event=>{
      if(event.key!=='Enter') return;
      event.preventDefault();
      const matches=customerPriceMatches(customerPriceSearch.value);
      if(matches.length) addCustomerPriceProduct(matches[0].product,matches[0].unit);
      else showToast('ไม่พบสินค้าที่ค้นหา','danger-top');
    });
    customerPriceSearch.addEventListener('blur',()=>setTimeout(()=>{ if(customerPriceSearchResults) customerPriceSearchResults.hidden=true; },120));
    customerPriceSearch.addEventListener('focus',renderCustomerPriceSearchResults);
  }
  bindCustomerPriceRows();
}
