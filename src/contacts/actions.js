function readContractPrice(row,onInvalid){
  const entries=[];
  const unit=row.querySelector('.customer-price-unit').value;
  const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
  const regular=regularProductUnitPrice(product,unit),cost=productUnitCost(product,unit);
  const inherited=row.inheritedPriceRule;
  function warn(message,input){
    if(onInvalid) onInvalid(unit+' · '+message);
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
  const ceiling=Math.min(regular,price??inherited?.price??regular);
  let previous=oneUnit?.price;
  for(const step of entries){
    if(step.price<cost) return warn('ราคาขั้นบันไดต้องไม่ต่ำกว่าทุน '+fmtMoney(cost),step.input);
    if(previous!=null&&step.price>=previous) return warn(`ซื้อขั้นต่ำ ${step.minQty} ${unit} ต้องต่ำกว่าขั้นก่อนหน้า ${fmtMoney(previous)} บาท`,step.input);
    if(step.price>ceiling) return warn('ราคาขั้นบันไดต้องไม่เกิน '+fmtMoney(ceiling),step.input);
    previous=step.price;
  }
  const tiers=entries.map(({minQty,price})=>({minQty,price}));
  const merged=contractTierSteps(inherited,{tiers});
  if(tiers.length&&merged.some((step,i)=>i>0&&step.price>=merged[i-1].price))
    return warn('ราคาขั้นถัดไปต้องต่ำกว่าขั้นก่อนหน้า รวมขั้นที่ใช้จากกลุ่ม');
  return {price,tiers};
}
function collectCustomerPriceRules(root=document,{onInvalid}={}){
  function warn(message,input){
    if(onInvalid) onInvalid(message);
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
  const controls=[select,back,pickCustomers];
  let queued=false;
  let unsaved=false;
  const isCurrent=()=>priceGroupPage===view&&page.isConnected&&currentTab==='pricegroups'&&isStoreViewCurrent(context)&&loggedInUser()?.owner;
  const setBusy=busy=>{view.saving=busy;controls.forEach(control=>control.disabled=busy);};
  const canLeave=()=>!unsaved||confirm('มีการแก้ไขกลุ่มราคาที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?');
  setBusy(view.saving);
  back.onclick=()=>{
    if(canLeave()){currentTab='products';render();}
  };
  select.onchange=()=>{
    if(!canLeave()){select.value=view.groupId;return;}
    view.groupId=select.value;
    render();
  };
  attachCustomerPricingEvents(page,{customerId:null,onChange:saveChanges,canOpenCustomer:()=>isCurrent()&&!view.saving&&canLeave()});
  const editable='.customer-price-unit,.contract-editable-tier .tier-min,.contract-editable-tier .tier-price';
  page.addEventListener('change',event=>{
    if(event.target.matches(editable)) saveChanges();
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

  function saveChanges(){
    if(!isCurrent()) return;
    unsaved=true;
    if(view.saving){queued=true;return;}
    retry.hidden=true;
    const customerPrices=collectCustomerPriceRules(page,{
      onInvalid:message=>status.textContent=message
    });
    if(!customerPrices) return;
    if(!savedGroup&&!customerPrices.length){unsaved=false;status.textContent='';return;}
    const updated={id:level.id,name:level.name,customerPrices};
    const levels=fixedPriceLevels().map(group=>group.id===level.id?updated:group);
    for(const rule of customerPrices){
      const product=products.find(p=>Number(p.id)===Number(rule.productId));
      const message=priceLevelOrderError(product,rule.unit,levels);
      if(message){status.textContent=message;return;}
    }
    if(JSON.stringify(stableJsonValue(savedGroup))===JSON.stringify(stableJsonValue(updated))){
      unsaved=false;
      status.textContent='บันทึกแล้ว';
      return;
    }
    submit(updated);
  }

  async function submit(updated){
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
      unsaved=queued;
      status.textContent='บันทึกแล้ว';
    }catch(error){
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
function attachCustomerPricingEvents(root=document,{customerId=editingCustomerPriceContactId,onClose=()=>{editingCustomerPriceContactId=null;render();},onSaved,onChange,canOpenCustomer}={}){
  const cancelCustomerPricingBtn=root.querySelector('#cancelCustomerPricingBtn');
  if(cancelCustomerPricingBtn) cancelCustomerPricingBtn.addEventListener('click',onClose);
  const saveCustomerPricingBtn=root.querySelector('#saveCustomerPricingBtn');
  if(saveCustomerPricingBtn) saveCustomerPricingBtn.addEventListener('click',()=>saveCustomerPricing({root,customerId,onSaved}));
  const customerPriceRows=root.querySelector('#customerPriceRows');
  const group=customerGroupForPricing(customerId==null?null:storeContacts().find(contact=>Number(contact.id)===Number(customerId)));
  const bindCustomerPriceRows=()=>root.querySelectorAll('[data-customer-price-row]').forEach(row=>{
    const unitSelect=row.querySelector('.customer-price-unit');
    const detail=row.nextElementSibling;
    const refreshContractUnit=()=>{
      const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
      const unit=unitSelect.value;
      row.inheritedPriceRule=customerPriceRule(group,product.id,unit);
      detail.querySelector('.contract-inherited').textContent=inheritedContractText(row.inheritedPriceRule,unit);
      if(!detail.hidden) renderContractComparisons(row);
      const cost=row.querySelector('.customer-price-cost').value;
      detail.querySelectorAll('.contract-editable-tier .tier-cost').forEach(input=>input.value=cost);
      updateContractPriceColors(row);
    };
    refreshContractUnit();
    row.querySelector('[data-contract-toggle]').onclick=()=>setContractTierExpanded(row,detail.hidden);
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
    if(unitSelect){
      unitSelect.dataset.previousUnit=unitSelect.value;
      unitSelect.onchange=()=>{
        const productId=Number(row.dataset.productId);
        const duplicate=[...root.querySelectorAll('[data-customer-price-row]')].find(other=>other!==row&&Number(other.dataset.productId)===productId&&other.querySelector('.customer-price-unit')?.value===unitSelect.value);
        if(duplicate){ showToast('สินค้านี้มีราคาพิเศษของหน่วยที่เลือกอยู่แล้ว','danger-top'); unitSelect.value=unitSelect.dataset.previousUnit; return; }
        const product=products.find(item=>Number(item.id)===productId);
        const option=productUnitOptions(product).find(item=>item.name===unitSelect.value);
        row.querySelector('.customer-price-barcode').textContent=productBarcodeForUnit(product,unitSelect.value)||'-';
        row.querySelector('.customer-price-regular').value=fmtMoney(option?.price||0);
        row.querySelector('.customer-price-cost').value=fmtMoney(option?.cost||0);
        unitSelect.dataset.previousUnit=unitSelect.value;
        refreshContractUnit();
      };
    }
    const remove=row.querySelector('.customer-price-remove');
    if(remove) remove.onclick=()=>{
      const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
      if(!confirm(`ยืนยันลบ “${product?.name||'สินค้า'}” หน่วย ${unitSelect.value} ออกจากรายการราคาพิเศษหรือไม่?`)) return;
      detail.remove();
      row.remove();
      onChange?.();
      if(customerPriceRows&&!customerPriceRows.querySelector('[data-customer-price-row]')) customerPriceRows.innerHTML='<tr class="customer-price-empty"><td colspan="6">ยังไม่ได้กำหนดราคาพิเศษ</td></tr>';
    };
  });
  const customerPriceSearch=root.querySelector('#customerPriceSearch');
  const customerPriceSearchResults=root.querySelector('#customerPriceSearchResults');
  const customerPriceMatches=query=>productScanMatches(query).map(({product,unitName})=>({product,unit:unitName}));
  const addCustomerPriceProduct=(product,unit)=>{
    if(!product||!customerPriceRows) return;
    const selectedUnit=productUnitOptions(product).some(option=>option.name===unit)?unit:product.unit;
    const existing=[...customerPriceRows.querySelectorAll('[data-customer-price-row]')].find(row=>Number(row.dataset.productId)===Number(product.id)&&row.querySelector('.customer-price-unit')?.value===selectedUnit);
    if(existing){
      showToast(`มีราคาพิเศษ “${product.name}” หน่วย ${selectedUnit} อยู่แล้ว`);
      setContractTierExpanded(existing,true);
      existing.nextElementSibling.querySelector('.contract-editable-tier .tier-price,.contract-editable-tier [data-add-tier]')?.focus();
      return;
    }
    customerPriceRows.querySelector('.customer-price-empty')?.remove();
    customerPriceRows.insertAdjacentHTML('beforeend',customerPriceRowHtml({productId:product.id,unit:selectedUnit},root.matches?.('.pos-customer-pricing-overlay'),group));
    bindCustomerPriceRows();
    const detail=customerPriceRows.lastElementChild;
    setContractTierExpanded(detail.previousElementSibling,true);
    detail.querySelector('[data-add-tier]')?.focus();
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
