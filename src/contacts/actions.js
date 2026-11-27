function readContractPrice(row,onInvalid){
  const entries=[];
  const unit=row.querySelector('.customer-price-unit').value;
  const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
  const cost=productUnitCost(product,unit);
  function warn(message,input){
    if(onInvalid) onInvalid(unit+' · '+message,input);
    else{showToast(unit+' · '+message,'danger-top');setContractTierExpanded(row,true);input?.focus();}
    return null;
  }
  for(const entry of row.nextElementSibling.querySelectorAll('.contract-editable-tier .tier-edit-row')){
    const minimum=entry.querySelector('.tier-min'),amount=entry.querySelector('.tier-price');
    const minQty=Number(minimum.value),price=Number(amount.value);
    if(minimum.value===''&&amount.value===''&&!minimum.validity.badInput&&!amount.validity.badInput) continue;
    if(!Number.isSafeInteger(minQty)||minQty<1) return warn('ซื้อขั้นต่ำต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป',minimum);
    if(amount.value===''||!amount.validity.valid) return warn('กรอกราคาต่อหน่วยให้ถูกต้อง',amount);
    if(entries.some(step=>step.minQty===minQty)) return warn('จำนวนซื้อขั้นต่ำซ้ำกัน',minimum);
    entries.push({minQty,price,input:amount});
  }
  entries.sort((a,b)=>a.minQty-b.minQty);
  // Keep a starting price in its existing storage format for checkout compatibility.
  const keepLegacyStart=entries[0]?.minQty===1&&entries[0].price===Number(row.dataset.legacyFirstStep);
  const oneUnit=entries[0]?.minQty===1&&!row.hasAttribute('data-quantity-one-tier')&&!keepLegacyStart?entries.shift():null;
  const price=keepLegacyStart?Number(row.dataset.legacyStartingPrice):oneUnit?.price??null;
  let previous=price;
  for(const step of entries){
    if(step.price<cost) return warn('ราคาขั้นบันไดต้องไม่ต่ำกว่าทุน '+fmtMoney(cost),step.input);
    if(previous!=null&&step.price>=previous) return warn(`ซื้อขั้นต่ำ ${step.minQty} ${unit} ต้องต่ำกว่าขั้นก่อนหน้า ${fmtMoney(previous)} บาท`,step.input);
    previous=step.price;
  }
  const tiers=entries.map(({minQty,price})=>({minQty,price}));
  return {price,tiers};
}
function collectCustomerPriceRules(root=document,{onInvalid}={}){
  function warn(message,input){
    if(onInvalid) onInvalid(message,input);
    else{showToast(message,'danger-top');input?.focus();}
    return null;
  }
  const rules=[];
  const duplicateKeys=new Set();
  for(const row of root.querySelectorAll('[data-customer-price-row]')){
    const productId=Number(row.dataset.productId);
    const unit=row.querySelector('.customer-price-unit').value;
    const product=products.find(item=>Number(item.id)===productId);
    if(!product) return warn('ไม่พบสินค้าที่กำหนดราคาพิเศษ กรุณาลบรายการแล้วเพิ่มใหม่');
    if(!productUnitOptions(product).some(option=>option.name===unit)) return warn(`หน่วย “${unit||'-'}” ไม่ได้อยู่ในสินค้า “${product.name}”`,row.querySelector('.customer-price-unit'));
    const rule=readContractPrice(row,onInvalid);
    if(!rule) return null;
    const {price,tiers}=rule;
    if(price===null&&!tiers.length) continue;
    const key=`${product.id}::${unit}`;
    if(duplicateKeys.has(key)) return warn(`กำหนดราคา “${product.name}” หน่วย ${unit} ซ้ำกัน`);
    duplicateKeys.add(key);
    const idInput=row.querySelector('.customer-price-id');
    if(!idInput.value) idInput.value=crypto.randomUUID();
    rules.push({id:idInput.value,productId:product.id,unit,price,...(tiers.length?{tiers}:{})});
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

function attachPriceGroupEvents(page){
  const view=priceGroupPage;
  const context=captureStoreView();
  let savedGroup=storePriceGroups().find(entry=>entry.id===view.groupId)||null;
  const select=page.querySelector('[data-group-select]');
  const level=fixedPriceLevels().find(entry=>entry.id===view.groupId);
  const pickCustomers=page.querySelector('[data-pick-group-customers]');
  const back=page.querySelector('[data-back-group]');
  const status=page.querySelector('[data-price-group-status]');
  const retry=page.querySelector('[data-retry-group]');
  const warning=page.querySelector('[data-price-warning]');
  const pendingRemovals=new Set();
  let warningField=null;
  let queued=false;
  let unsaved=false;
  const isCurrent=()=>priceGroupPage===view&&page.isConnected&&currentTab==='pricegroups'&&isStoreViewCurrent(context)&&loggedInUser()?.owner;
  const setBusy=busy=>{view.saving=busy;[select,back,pickCustomers].forEach(control=>control.disabled=busy);};
  const canLeave=()=>{
    if(view.saving){showToast('กำลังบันทึกกลุ่มราคา กรุณารอสักครู่');return false;}
    return !unsaved||confirm('มีการแก้ไขกลุ่มราคาที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?');
  };
  view.canLeave=canLeave;
  setBusy(view.saving);
  back.onclick=()=>{
    if(canLeave()){currentTab='products';render();}
  };
  select.onchange=()=>{
    if(!canLeave()){select.value=view.groupId;return;}
    view.groupId=select.value;
    render();
  };
  attachCustomerPricingEvents(page,{
    customerId:null,onChange:saveChanges,onRemove:removePriceRow,
    canOpenCustomer:()=>isCurrent()&&!view.saving&&canLeave()
  });
  const editable='.contract-editable-tier .tier-min,.contract-editable-tier .tier-price';
  page.addEventListener('change',event=>{
    if(!event.target.matches(editable)) return;
    saveChanges();
  });
  page.addEventListener('input',event=>{
    event.target.closest('.contract-editable-tier .tier-edit-row')?.querySelector('.tier-price')?.removeAttribute('aria-invalid');
  });
  page.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||!event.target.matches('.contract-editable-tier input:not([readonly])')) return;
    event.preventDefault();
    event.target.blur();
  });
  retry.onclick=saveChanges;
  pickCustomers.onclick=()=>{
    if(isCurrent()&&!view.saving) openPriceGroupCustomerPicker(page,level.id,isCurrent);
  };
  warning.querySelector('button').onclick=()=>warning.close();
  warning.addEventListener('close',()=>{
    if(!warningField?.isConnected) return;
    warningField.focus();
    warningField.select();
  });

  function warnPrice(message,input){
    if(warning.open) return;
    warningField=input?.isConnected?input:null;
    if(warningField){
      const row=warningField.closest('.contract-tier-detail').previousElementSibling;
      setContractTierExpanded(row,true);
      warningField.setAttribute('aria-invalid','true');
    }
    warning.querySelector('p').textContent=message;
    warning.showModal();
  }
  function removePriceRow(row){
    pendingRemovals.add({
      id:row.querySelector('.customer-price-id').value,
      productId:Number(row.dataset.productId),
      unit:row.dataset.originalUnit
    });
    saveChanges();
  }
  function saveChanges(){
    if(!isCurrent()) return;
    unsaved=true;
    if(view.saving){queued=true;return;}
    retry.hidden=true;
    const removals=[...pendingRemovals];
    let issue=null;
    const customerPrices=collectCustomerPriceRules(page,{
      onInvalid:(message,input)=>issue={message,input,showPopup:input?.matches('.tier-price')&&input.value!==''}
    });
    const updated={id:level.id,name:level.name,customerPrices};
    if(issue){
      status.textContent=issue.message;
      if(issue.showPopup) warnPrice(issue.message,issue.input);
      // Persist confirmed deletions even if a different row has an invalid draft.
      const savedPrices=savedGroup?.customerPrices||[];
      const remaining=savedPrices.filter(rule=>!removals.some(removed=>
        removed.id&&rule.id===removed.id||
        !rule.id&&Number(rule.productId)===removed.productId&&rule.unit===removed.unit));
      if(remaining.length<savedPrices.length){
        submit({...savedGroup,customerPrices:remaining},removals,issue);
      }else{
        removals.forEach(removed=>pendingRemovals.delete(removed));
      }
      return;
    }
    if(!savedGroup&&!customerPrices.length){
      removals.forEach(removed=>pendingRemovals.delete(removed));
      unsaved=false;
      status.textContent='';
      return;
    }
    if(JSON.stringify(stableJsonValue(savedGroup))===JSON.stringify(stableJsonValue(updated))){
      removals.forEach(removed=>pendingRemovals.delete(removed));
      unsaved=false;
      status.textContent='บันทึกแล้ว';
      return;
    }
    submit(updated,removals);
  }

  async function submit(updated,removals,issue){
    setBusy(true);
    status.textContent='กำลังบันทึก…';
    try{
      const {data,error}=await sb.rpc('save_store_price_group',{p_warehouse_id:context.store,p_expected:savedGroup,p_group:updated});
      if(error) throw error;
      if(!isStoreViewCurrent(context)) return;
      warehouseBusinessProfiles[context.store]={...warehouseBusinessSettings(),priceGroups:data};
      persistWorkspaceData();
      if(!isCurrent()) return;
      savedGroup=data.find(entry=>entry.id===updated.id);
      removals.forEach(removed=>pendingRemovals.delete(removed));
      unsaved=queued||!!issue;
      status.textContent=issue?'ลบรายการแล้ว · '+issue.message:'บันทึกแล้ว';
    }catch(error){
      if(!isCurrent()) return;
      status.textContent='บันทึกกลุ่มราคาไม่สำเร็จ · '+error.message;
      retry.hidden=false;
    }finally{
      setBusy(false);
      if(queued){
        queued=false;
        saveChanges();
      }
    }
  }
}
function openPriceGroupCustomerPicker(page,groupId,isCurrent){
  const group=fixedPriceLevels().find(entry=>entry.id===groupId);
  if(!group||!canPerformPageAction('edit','customers')) return;
  const dialog=document.createElement('dialog');
  dialog.className='price-group-customer-dialog';
  dialog.setAttribute('aria-labelledby','priceGroupCustomersTitle');
  dialog.innerHTML=`<div class="modal-head">
      <h3 id="priceGroupCustomersTitle">เลือกลูกค้า · ${escapeHtml(group.name)}</h3>
      <button type="button" class="modal-close" aria-label="ปิด">×</button>
    </div>
    <div class="price-group-customer-body">
      <input class="price-group-customer-search" type="search" aria-label="ค้นหาลูกค้า" placeholder="ค้นหาชื่อ เบอร์โทร หรือกลุ่มราคา">
      <div class="price-group-customer-columns">
        <section><h4>รายชื่อลูกค้า</h4><ul data-customers-available></ul></section>
        <section><h4>${escapeHtml(group.name)}</h4><ul data-customers-assigned></ul></section>
      </div>
      <div role="status" class="price-group-customer-status"></div>
    </div>`;
  page.appendChild(dialog);
  const close=dialog.querySelector('.modal-close');
  const search=dialog.querySelector('input');
  const status=dialog.querySelector('[role="status"]');
  let busy=false;
  const available=dialog.querySelector('[data-customers-available]');
  const assigned=dialog.querySelector('[data-customers-assigned]');
  const compareNames=new Intl.Collator('th',{numeric:true});
  function draw(){
    const groups=new Map(fixedPriceLevels().map(entry=>[entry.id,entry.name]));
    const query=search.value.trim().toLocaleLowerCase('th');
    const rows=customersList().slice().sort((a,b)=>compareNames.compare(a.name,b.name));
    available.innerHTML=listHtml(rows.filter(customer=>customer.priceGroupId!==groupId),false);
    assigned.innerHTML=listHtml(rows.filter(customer=>customer.priceGroupId===groupId),true);
    function listHtml(customers,inGroup){
      return customers.filter(customer=>[customer.name,customer.phone,groups.get(customer.priceGroupId)].join(' ').toLocaleLowerCase('th').includes(query))
        .map(customer=>{
          const groupName=groups.get(customer.priceGroupId);
          const action=inGroup?'นำออกจากกลุ่ม':'เข้ากลุ่ม';
          return `<li><button type="button" class="price-group-customer-row" data-group-customer="${escapeHtml(customer.id)}"
            aria-label="${escapeHtml(action+' '+customer.name)}" ${busy?'disabled':''}>
            <span>${escapeHtml(customer.name)}${groupName?` <small> : ${escapeHtml(groupName)}</small>`:''}</span>
            <span aria-hidden="true">${inGroup?'−':'+'}</span></button></li>`;
        }).join('')||'<li class="price-group-customer-empty">ไม่มีรายชื่อ</li>';
    }
  }
  search.oninput=draw;
  close.onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(busy) event.preventDefault();});
  dialog.addEventListener('close',()=>{
    dialog.remove();
    page.querySelector('[data-pick-group-customers]')?.focus();
  });
  dialog.addEventListener('click',async event=>{
    const button=event.target.closest('[data-group-customer]');
    if(!button||busy||!isCurrent()) return;
    const customer=customersList().find(entry=>String(entry.id)===button.dataset.groupCustomer);
    if(!customer) return;
    const nextGroup=customer.priceGroupId===groupId?null:groupId;
    busy=close.disabled=true;
    status.textContent='กำลังบันทึก…';
    draw();
    try{
      await persistContactImmediately(customer,{
        changes:{priceGroupId:nextGroup},
        isCurrent
      });
      persistContacts();
      status.textContent=nextGroup?`เพิ่ม ${customer.name} เข้ากลุ่มแล้ว`:`นำ ${customer.name} ออกจากกลุ่มแล้ว`;
    }catch(error){
      status.textContent='ย้ายลูกค้าไม่สำเร็จ · '+error.message;
    }finally{
      busy=close.disabled=false;
      draw();
      search.focus();
    }
  });
  draw();
  dialog.showModal();
  search.focus();
}
function openPersonalPriceList(row,canOpenCustomer){
  const unit=row.querySelector('.customer-price-unit').value;
  const entries=personalPriceEntries(row.dataset.productId,unit);
  const dialog=document.createElement('dialog');
  dialog.className='price-group-customer-dialog';
  dialog.setAttribute('aria-label','ราคาพิเศษรายบุคคล');
  dialog.innerHTML='<div class="modal-head"><h3>ราคาพิเศษรายบุคคล</h3><button type="button" class="modal-close" aria-label="ปิด">×</button></div>'+
    '<div class="price-group-customer-body"><button type="button" class="btn ghost small" data-sort-price>เรียงราคาน้อยไปมาก</button><div class="personal-price-list"></div></div>';
  function draw(){
    dialog.querySelector('.personal-price-list').innerHTML=entries.map(({customer,rule})=>{
      const tiers=rule.tiers.slice().sort((a,b)=>a.minQty-b.minQty);
      const base=rule.price==null?'':fmtMoney(rule.price);
      const steps=tiers.map(t=>'<small>'+escapeHtml(t.minQty+' '+unit+' · '+fmtMoney(t.price))+'</small>').join('');
      return '<button class="btn ghost" type="button" data-personal-customer="'+escapeHtml(customer.id)+'">'+escapeHtml(customer.name)+(base?' : '+base:'')+steps+'</button>';
    }).join('');
  }
  dialog.querySelector('[data-sort-price]').onclick=()=>{
    entries.sort((a,b)=>a.lowest-b.lowest||a.customer.name.localeCompare(b.customer.name,'th'));
    draw();
  };
  dialog.querySelector('.modal-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.addEventListener('click',event=>{
    const button=event.target.closest('[data-personal-customer]');
    if(!button||!canOpenCustomer?.()) return;
    const customer=entries.find(entry=>String(entry.customer.id)===button.dataset.personalCustomer)?.customer;
    if(!customer) return;
    dialog.close();
    editingCustomerPriceContactId=customer.id;
    render();
  });
  draw();
  row.closest('#priceGroupPage').append(dialog);
  dialog.showModal();
}
function handleContractTierRowClick(event){
  if(event.target.closest('button:not([data-contract-toggle]), select, input:not([readonly])')) return;
  const row=event.currentTarget;
  setContractTierExpanded(row,row.nextElementSibling.hidden);
}
function setContractTierExpanded(row,expanded){
  if(expanded){
    renderContractComparisons(row);
    updateContractPriceColors(row);
  }
  row.nextElementSibling.hidden=!expanded;
  row.querySelector('[data-contract-toggle]').setAttribute('aria-expanded',String(expanded));
  refreshScrollableTableHeights();
}
function updateContractPriceColors(row){
  const unit=row.querySelector('.customer-price-unit').value;
  const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
  const regular=regularProductUnitPrice(product,unit),cost=productUnitCost(product,unit);
  row.nextElementSibling.querySelectorAll('.contract-editable-tier .tier-price').forEach(input=>{
    const comparison=customerPriceComparison(input.value,regular,cost);
    input.classList.toggle('below-regular',comparison==='below-regular');
    input.classList.toggle('above-regular',comparison==='above-regular');
    input.classList.toggle('below-cost',comparison==='below-cost');
  });
}
function attachCustomerPricingEvents(root=document,{customerId=editingCustomerPriceContactId,onClose=()=>{editingCustomerPriceContactId=null;render();},onSaved,onChange,onRemove,canOpenCustomer}={}){
  const cancelCustomerPricingBtn=root.querySelector('#cancelCustomerPricingBtn');
  if(cancelCustomerPricingBtn) cancelCustomerPricingBtn.addEventListener('click',onClose);
  const saveCustomerPricingBtn=root.querySelector('#saveCustomerPricingBtn');
  if(saveCustomerPricingBtn) saveCustomerPricingBtn.addEventListener('click',()=>saveCustomerPricing({root,customerId,onSaved}));
  const customerPriceRows=root.querySelector('#customerPriceRows');
  const group=customerGroupForPricing(customerId==null?null:storeContacts().find(contact=>Number(contact.id)===Number(customerId)));
  const bindCustomerPriceRow=row=>{
    const unitSelect=row.querySelector('.customer-price-unit');
    const detail=row.nextElementSibling;
    row.onclick=handleContractTierRowClick;
    detail.onclick=event=>{
      if(event.target.closest('[data-personal-list]')){
        openPersonalPriceList(row,canOpenCustomer);
        return;
      }
      const button=event.target.closest('[data-add-tier],[data-remove-tier]');
      if(!button) return;
      const rows=detail.querySelector('.contract-editable-tier .tier-edit-rows');
      if(button.hasAttribute('data-remove-tier')){
        rows.lastElementChild?.remove();
        if(!rows.lastElementChild) detail.querySelector('[data-add-tier]')?.focus();
        onChange?.();
        return;
      }
      if(!readContractPrice(row)) return;
      const lastMinimum=rows.lastElementChild?.querySelector('.tier-min');
      if(lastMinimum?.value===''){lastMinimum.focus();return;}
      rows.insertAdjacentHTML('beforeend',priceTierRowHtml({},{cost:row.querySelector('.customer-price-cost').value}));
      rows.lastElementChild.querySelector('.tier-min').focus();
    };
    detail.oninput=event=>{
      if(event.target.matches('.contract-editable-tier .tier-price')) updateContractPriceColors(row);
    };
    // Enter stays in the step fields and never lands on a delete button.
    detail.onkeydown=event=>{
      if(onChange||event.key!=='Enter'||event.isComposing||event.keyCode===229||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||
        !event.target.matches('.contract-editable-tier input:not([readonly])')) return;
      event.preventDefault();
      if(event.repeat) return;
      const fields=[...root.querySelectorAll('.contract-tier-detail:not([hidden]) .contract-editable-tier input:not([readonly]):not(:disabled)')];
      (fields[fields.indexOf(event.target)+1]||root.querySelector('#customerPriceSearch'))?.focus();
    };
    unitSelect.onchange=()=>{
      const unit=unitSelect.value;
      unitSelect.value=row.dataset.originalUnit;
      if(unit===row.dataset.originalUnit) return;
      const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
      addCustomerPriceProduct(product,unit,row);
    };
    const remove=row.querySelector('.customer-price-remove');
    if(remove) remove.onclick=()=>{
      const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
      if(!confirm(`ยืนยันลบ “${product?.name||'สินค้า'}” หน่วย ${unitSelect.value} ออกจากรายการราคาพิเศษหรือไม่?`)) return;
      detail.remove();
      row.remove();
      onRemove?.(row);
      if(customerPriceRows&&!customerPriceRows.querySelector('[data-customer-price-row]')) customerPriceRows.innerHTML='<tr class="customer-price-empty"><td colspan="6">ยังไม่ได้กำหนดราคาพิเศษ</td></tr>';
    };
  };
  const customerPriceSearch=root.querySelector('#customerPriceSearch');
  const customerPriceSearchResults=root.querySelector('#customerPriceSearchResults');
  const customerPriceMatches=query=>productScanMatches(query).map(({product,unitName})=>({product,unit:unitName}));
  const addCustomerPriceProduct=(product,unit,sourceRow=null)=>{
    if(!product||!customerPriceRows) return;
    const selectedUnit=productUnitOptions(product).some(option=>option.name===unit)?unit:product.unit;
    let row=[...customerPriceRows.querySelectorAll('[data-customer-price-row]')].find(item=>
      Number(item.dataset.productId)===Number(product.id)&&item.dataset.originalUnit===selectedUnit);
    if(row){
      if(!sourceRow) showToast(`มีราคาพิเศษ “${product.name}” หน่วย ${selectedUnit} อยู่แล้ว`);
    }else{
      customerPriceRows.querySelector('.customer-price-empty')?.remove();
      const anchor=sourceRow?.nextElementSibling;
      const html=customerPriceRowHtml({productId:product.id,unit:selectedUnit},root.matches?.('.pos-customer-pricing-overlay'),group);
      if(anchor){
        anchor.insertAdjacentHTML('afterend',html);
        row=anchor.nextElementSibling;
      }else{
        customerPriceRows.insertAdjacentHTML('beforeend',html);
        row=customerPriceRows.lastElementChild.previousElementSibling;
      }
      bindCustomerPriceRow(row);
    }
    if(sourceRow) setContractTierExpanded(sourceRow,false);
    setContractTierExpanded(row,true);
    const fields=row.nextElementSibling.querySelector('.contract-editable-tier');
    const firstPrice=fields.querySelector('.tier-price');
    const addStep=fields.querySelector('[data-add-tier]');
    if(sourceRow&&!firstPrice) addStep.click();
    else (firstPrice||addStep).focus();

    if(!sourceRow){
      if(customerPriceSearch) customerPriceSearch.value='';
      if(customerPriceSearchResults){customerPriceSearchResults.hidden=true;customerPriceSearchResults.innerHTML='';}
    }
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
  customerPriceRows?.querySelectorAll('[data-customer-price-row]').forEach(bindCustomerPriceRow);
}
