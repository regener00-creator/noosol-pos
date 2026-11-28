function readContractPrice(row,onInvalid,editor=row.nextElementSibling.querySelector('.contract-tier-grid [data-contract-unit]')){
  const entries=[];
  const unit=editor.closest('[data-contract-unit]').dataset.contractUnit;
  const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
  const cost=productUnitCost(product,unit);
  function warn(message,input){
    if(onInvalid) onInvalid(unit+' · '+message,input);
    else{showToast(unit+' · '+message,'danger-top');selectContractPriceUnit(row,unit);input?.focus();}
    return null;
  }
  for(const entry of editor.querySelectorAll('.tier-edit-row')){
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
  const keepLegacyStart=entries[0]?.minQty===1&&entries[0].price===Number(editor.dataset.legacyFirstStep);
  const oneUnit=entries[0]?.minQty===1&&!editor.hasAttribute('data-quantity-one-tier')&&!keepLegacyStart?entries.shift():null;
  const price=keepLegacyStart?Number(editor.dataset.legacyStartingPrice):oneUnit?.price??null;
  if(editor.dataset.priceLevel==='normal'&&price===null) return warn('กรอกราคาปกติสำหรับ 1 หน่วย',editor.querySelector('.tier-price'));
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
    const product=products.find(item=>Number(item.id)===productId);
    if(!product) return warn('ไม่พบสินค้าที่กำหนดราคาพิเศษ กรุณาลบรายการแล้วเพิ่มใหม่');
    for(const editor of row.nextElementSibling.querySelectorAll('[data-contract-unit]')){
      const unit=editor.dataset.contractUnit;
      const rule=readContractPrice(row,onInvalid,editor);
      if(!rule) return null;
      const {price,tiers}=rule;
      if(price===null&&!tiers.length) continue;
      if(!productUnitOptions(product).some(option=>option.name===unit)) return warn(`หน่วย “${unit}” ไม่ได้อยู่ในสินค้า “${product.name}”`,row.querySelector('.customer-price-unit'));
      const key=`${product.id}::${unit}`;
      if(duplicateKeys.has(key)) return warn(`กำหนดราคา “${product.name}” หน่วย ${unit} ซ้ำกัน`);
      duplicateKeys.add(key);
      editor.dataset.ruleId||=crypto.randomUUID();
      rules.push({id:editor.dataset.ruleId,productId:product.id,unit,price,...(tiers.length?{tiers}:{})});
    }
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
  const customer=customersList().find(contact=>String(contact.id)===String(customerId));
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
  const savedGroups=new Map(storePriceGroups().map(group=>[group.id,group]));
  const levels=new Map(fixedPriceLevels().map(level=>[level.id,level]));
  const pickCustomers=page.querySelector('[data-pick-group-customers]');
  const back=page.querySelector('[data-back-group]');
  const status=page.querySelector('[data-price-group-status]');
  const retry=page.querySelector('[data-retry-group]');
  const warning=page.querySelector('[data-price-warning]');
  const dirty=new Set();
  const pending=new Set();
  const validationIssues=new Map();
  let warningField=null;
  const isCurrent=()=>priceGroupPage===view&&page.isConnected&&currentTab==='pricegroups'&&isStoreViewCurrent(context)&&loggedInUser()?.owner;
  view.canLeave=()=>{
    if(view.saving){showToast('กำลังบันทึกกลุ่มราคา กรุณารอสักครู่');return false;}
    return !dirty.size||confirm('มีการแก้ไขกลุ่มราคาที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?');
  };
  back.onclick=()=>{if(view.canLeave()){currentTab='products';render();}};
  pickCustomers.onclick=()=>{if(isCurrent()&&!view.saving)openPriceGroupCustomerPicker(page,isCurrent);};
  attachCustomerPricingEvents(page,{customerId:null,onChange:queueSave,canOpenCustomer:()=>isCurrent()&&view.canLeave()});
  page.addEventListener('input',event=>event.target.removeAttribute('aria-invalid'));
  page.addEventListener('change',event=>{
    if(event.target.matches('.tier-min,.tier-price'))queueSave(event.target.closest('[data-price-level]'));
  });
  page.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||!event.target.matches('[data-price-level] input:not([readonly])'))return;
    event.preventDefault();
    event.target.blur();
  });
  retry.onclick=()=>{dirty.forEach(editor=>pending.add(editor));void saveChanges();};
  warning.querySelector('button').onclick=()=>warning.close();
  warning.addEventListener('close',()=>{
    if(!warningField?.isConnected)return;
    warningField.focus();
    warningField.select();
  });

  function queueSave(editor){
    if(!editor)return;
    dirty.add(editor);
    pending.add(editor);
    void saveChanges();
  }

  async function saveChanges(){
    if(!isCurrent()||view.saving)return;
    view.saving=true;
    back.disabled=pickCustomers.disabled=true;
    retry.hidden=true;
    try{
      while(pending.size){
        const editor=pending.values().next().value;
        pending.delete(editor);
        if(!isCurrent())return;
        const row=editor.closest('.contract-tier-detail').previousElementSibling;
        const productId=Number(row.dataset.productId);
        const unit=editor.closest('[data-contract-unit]').dataset.contractUnit;
        const levelId=editor.dataset.priceLevel;
        let issue=null;
        const rule=readContractPrice(row,(message,input)=>{issue={message,input,row,unit};},editor);
        if(!rule){validationIssues.set(editor,issue);continue;}
        validationIssues.delete(editor);
        dirty.delete(editor);
        status.textContent='กำลังบันทึก…';
        try{
          if(levelId==='normal'){
            const changed=await saveNormalGroupPrice(productId,unit,rule);
            if(changed&&!rule.tiers.some(step=>step.minQty===1)){
              delete editor.dataset.legacyStartingPrice;
              delete editor.dataset.legacyFirstStep;
            }
            if(row.querySelector('.customer-price-unit').value===unit)row.querySelector('.customer-price-regular').value=fmtMoney(rule.price);
            updateContractPriceColors(row);
          }else{
            const level=levels.get(levelId),saved=savedGroups.get(levelId)||null;
            const previous=saved?.customerPrices||[];
            const existing=previous.find(entry=>Number(entry.productId)===productId&&entry.unit===unit);
            const customerPrices=previous.filter(entry=>entry!==existing);
            if(rule.price!==null||rule.tiers.length){
              const updated={id:existing?.id||`product-${productId}-${unit}`,productId,unit,price:rule.price,
                ...(rule.tiers.length?{tiers:rule.tiers}:{})};
              if(existing)customerPrices.splice(previous.indexOf(existing),0,updated);
              else customerPrices.push(updated);
            }
            if(JSON.stringify(stableJsonValue(previous))===JSON.stringify(stableJsonValue(customerPrices)))continue;
            const {data,error}=await sb.rpc('save_store_price_group',{p_warehouse_id:context.store,p_expected:saved,
              p_group:{id:level.id,name:level.name,customerPrices}});
            if(error)throw error;
            if(!isStoreViewCurrent(context))return;
            warehouseBusinessProfiles[context.store]={...warehouseBusinessSettings(),priceGroups:data};
            savedGroups.set(levelId,data.find(group=>group.id===levelId));
            persistWorkspaceData();
          }
        }catch(error){dirty.add(editor);throw error;}
      }
      const validation=[...validationIssues.values()].at(-1);
      if(validation){
        const {message,input,row,unit}=validation;
        status.textContent=message;
        if(input?.matches('.tier-price')&&input.value!==''&&!warning.open){
          selectContractPriceUnit(row,unit);
          warningField=input;
          input.setAttribute('aria-invalid','true');
          warning.querySelector('p').textContent=message;
          warning.showModal();
        }
      }else status.textContent='บันทึกแล้ว';
    }catch(error){
      if(!isCurrent())return;
      status.textContent='บันทึกกลุ่มราคาไม่สำเร็จ · '+error.message;
      retry.hidden=false;
    }finally{
      view.saving=false;
      back.disabled=pickCustomers.disabled=false;
    }
  }
}

async function saveNormalGroupPrice(productId,unit,rule){
  const product=products.find(item=>Number(item.id)===productId);
  if(!product||!productUnitOptions(product).some(option=>option.name===unit))throw new Error('ไม่พบหน่วยสินค้า');
  const tiers=rule.tiers.map(step=>({unit,...step}));
  const changed=rule.price!==regularProductUnitPrice(product,unit)||
    JSON.stringify(stableJsonValue(tiers))!==JSON.stringify(stableJsonValue(productTierRows(product,unit)));
  if(changed){
    product.priceTiers=[...(product.priceTiers||[]).filter(step=>step.unit!==unit),...tiers];
    if(unit===product.unit)product.price=rule.price;
    else product.units=product.units.map(option=>option.sub===unit?{...option,price:rule.price}:option);
  }
  if(changed||productDirtyOperations.has(String(productId))){
    if(!await persistWorkspaceData({productChanges:{updatedIds:[productId]}})){
      throw new Error('เก็บข้อมูลในเครื่องไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
    await syncCoreDataToSupabase();
    if(productDirtyOperations.has(String(productId)))throw new Error('ราคา NORMAL ยังรอซิงก์');
  }
  return changed;
}

function openPriceGroupCustomerPicker(page,isCurrent){
  if(!canPerformPageAction('edit','customers'))return;
  const levels=[{id:'',name:'NORMAL'},...fixedPriceLevels().map((group,index)=>({id:group.id,name:'LV'+(index+1)}))];
  const names=new Map(levels.map(level=>[level.id,level.name]));
  const panel=({id,name})=>`<section class="price-group-customer-panel" data-customer-level="${escapeHtml(id)}">
    <h4><button type="button" aria-label="ย้ายลูกค้าไป ${name}">${name}</button></h4><ul></ul></section>`;
  const dialog=document.createElement('dialog');
  dialog.className='price-group-customer-dialog price-group-assignment-dialog';
  dialog.setAttribute('aria-labelledby','priceGroupCustomersTitle');
  dialog.innerHTML=`<div class="modal-head">
      <h3 id="priceGroupCustomersTitle">เลือกลูกค้าเข้ากลุ่ม</h3>
      <button type="button" class="modal-close" aria-label="ปิด">×</button>
    </div>
    <div class="price-group-customer-body">
      <input class="price-group-customer-search" type="search" aria-label="ค้นหาลูกค้า" placeholder="ค้นหาชื่อ เบอร์โทร หรือกลุ่มราคา">
      ${panel(levels[0])}
      <div class="price-group-customer-columns">${levels.slice(1).map(panel).join('')}</div>
      <div role="status" class="price-group-customer-status"></div>
    </div>`;
  page.appendChild(dialog);
  const close=dialog.querySelector('.modal-close');
  const search=dialog.querySelector('input');
  const status=dialog.querySelector('[role="status"]');
  const panels=[...dialog.querySelectorAll('[data-customer-level]')];
  const compareNames=new Intl.Collator('th',{numeric:true});
  let activeId='',draggedId='',busy=false;
  const groupOf=customer=>names.has(customer.priceGroupId)?customer.priceGroupId:'';
  const walkInName='ลูกค้าทั่วไป';

  function draw(){
    const query=search.value.trim().toLocaleLowerCase('th');
    const rows=customersList().filter(customer=>[customer.name,customer.phone,names.get(groupOf(customer))].join(' ').toLocaleLowerCase('th').includes(query))
      .sort((a,b)=>compareNames.compare(a.name,b.name));
    const listHtml=customers=>customers.map(customer=>{
      const id=String(customer.id),name=escapeHtml(customer.name);
      return `<li><button class="price-group-customer-row" type="button" draggable="${!busy}" data-group-customer="${escapeHtml(id)}" aria-pressed="${id===activeId}" ${busy?'disabled':''}>${name}</button></li>`;
    }).join('');
    panels.forEach(panel=>{
      const groupId=panel.dataset.customerLevel;
      const walkIn=!groupId&&(walkInName+' normal').includes(query)
        ?`<li><span class="price-group-walk-in" draggable="false">${walkInName}</span></li>`:'';
      panel.querySelector('ul').innerHTML=walkIn+listHtml(rows.filter(customer=>groupOf(customer)===groupId));
    });
  }

  async function moveCustomer(id,groupId){
    if(busy||!id||!isCurrent()||!names.has(groupId))return;
    const customer=customersList().find(entry=>String(entry.id)===id);
    if(!customer||String(customer.priceGroupId||'')===groupId)return;
    activeId=id;
    busy=close.disabled=true;
    status.textContent='กำลังบันทึก…';
    draw();
    try{
      await persistContactImmediately(customer,{changes:{priceGroupId:groupId||null},isCurrent});
      persistContacts();
      status.textContent='';
      activeId='';
    }catch(error){status.textContent='ย้ายลูกค้าไม่สำเร็จ · '+error.message;}
    finally{busy=close.disabled=false;draw();search.focus();}
  }
  close.onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{dialog.remove();page.querySelector('[data-pick-group-customers]')?.focus();},{once:true});
  search.addEventListener('input',draw);
  dialog.addEventListener('click',event=>{
    const customer=event.target.closest('[data-group-customer]');
    if(customer&&!busy){
      activeId=customer.dataset.groupCustomer;
      dialog.querySelectorAll('[data-group-customer]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.groupCustomer===activeId)));
    }
    const target=event.target.closest('[data-customer-level] h4 button');
    if(target)void moveCustomer(activeId,target.closest('[data-customer-level]').dataset.customerLevel);
  });
  dialog.addEventListener('dragstart',event=>{
    const customer=event.target.closest('[data-group-customer]');
    if(!customer||busy){event.preventDefault();return;}
    draggedId=customer.dataset.groupCustomer;
    event.dataTransfer.setData('text/plain',draggedId);
    event.dataTransfer.effectAllowed='move';
  });
  dialog.addEventListener('dragend',()=>{draggedId='';panels.forEach(panel=>panel.classList.remove('is-drop-target'));});
  panels.forEach(panel=>{
    panel.addEventListener('dragover',event=>{
      if(!draggedId||busy)return;
      event.preventDefault();
      event.dataTransfer.dropEffect='move';
      panels.forEach(target=>target.classList.toggle('is-drop-target',target===panel));
    });
    panel.addEventListener('drop',event=>{
      if(!draggedId)return;
      event.preventDefault();
      panel.classList.remove('is-drop-target');
      const id=draggedId;
      draggedId='';
      void moveCustomer(id,panel.dataset.customerLevel);
    });
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
function selectContractPriceUnit(row,unit){
  const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
  const option=product&&productUnitOptions(product).find(item=>item.name===unit);
  if(!option) return null;
  const detail=row.nextElementSibling;
  const grid=detail.querySelector('.contract-tier-grid');
  const bank=detail.querySelector('[data-contract-unit-editors]');
  const current=grid.querySelector('[data-contract-unit]');
  let editor=current;
  if(current.dataset.contractUnit!==unit){
    editor=[...bank.children].find(item=>item.dataset.contractUnit===unit);
    if(!editor){
      bank.insertAdjacentHTML('beforeend',row.closest('#priceGroupPage')?priceGroupUnitHtml(product,unit):contractPriceEditorHtml({unit},option.cost||0));
      editor=bank.lastElementChild;
      if(row.contractPriceReadOnly){
        editor.querySelectorAll('input').forEach(input=>input.disabled=true);
        editor.querySelector('.tier-edit-actions')?.remove();
      }
    }
    bank.append(current);
    grid.append(editor);
  }
  row.querySelector('.customer-price-unit').value=unit;
  row.querySelector('.customer-price-barcode').textContent=productBarcodeForUnit(product,unit)||'-';
  row.querySelector('.customer-price-regular').value=fmtMoney(option.price||0);
  row.querySelector('.customer-price-cost').value=fmtMoney(option.cost||0);
  detail.querySelector('.contract-inherited').textContent=inheritedContractText(customerPriceRule(row.contractPriceGroup,product.id,unit),unit);
  setContractTierExpanded(row,true);
  return editor;
}
function setContractTierExpanded(row,expanded){
  if(expanded){
    if(!row.closest('#priceGroupPage'))renderContractComparisons(row);
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
  row.nextElementSibling.querySelectorAll('.contract-tier-grid .contract-editable-tier .tier-price').forEach(input=>{
    const comparison=customerPriceComparison(input.value,regular,cost);
    input.classList.toggle('below-regular',comparison==='below-regular');
    input.classList.toggle('above-regular',comparison==='above-regular');
    input.classList.toggle('below-cost',comparison==='below-cost');
  });
}
function attachCustomerPricingEvents(root=document,{customerId=editingCustomerPriceContactId,onClose=()=>{editingCustomerPriceContactId=null;render();},onSaved,onChange,canOpenCustomer,readOnly=false}={}){
  const cancelCustomerPricingBtn=root.querySelector('#cancelCustomerPricingBtn');
  if(cancelCustomerPricingBtn) cancelCustomerPricingBtn.addEventListener('click',onClose);
  const saveCustomerPricingBtn=root.querySelector('#saveCustomerPricingBtn');
  if(saveCustomerPricingBtn) saveCustomerPricingBtn.addEventListener('click',()=>saveCustomerPricing({root,customerId,onSaved}));
  const customerPriceRows=root.querySelector('#customerPriceRows');
  const group=customerGroupForPricing(customerId==null?null:storeContacts().find(contact=>Number(contact.id)===Number(customerId)));
  const bindCustomerPriceRow=row=>{
    const unitSelect=row.querySelector('.customer-price-unit');
    const detail=row.nextElementSibling;
    row.contractPriceGroup=group;
    row.contractPriceReadOnly=readOnly;
    row.onclick=handleContractTierRowClick;
    detail.onclick=event=>{
      if(event.target.closest('[data-personal-list]')){
        openPersonalPriceList(row,canOpenCustomer);
        return;
      }
      const button=event.target.closest('[data-add-tier],[data-remove-tier]');
      if(!button) return;
      const editor=button.closest('.contract-editable-tier');
      const rows=editor.querySelector('.tier-edit-rows');
      if(button.hasAttribute('data-remove-tier')){
        if(editor.dataset.priceLevel==='normal'&&rows.children.length<=1) return;
        rows.lastElementChild?.remove();
        if(!rows.lastElementChild) editor.querySelector('[data-add-tier]')?.focus();
        onChange?.(editor);
        return;
      }
      if(!readContractPrice(row,undefined,editor)) return;
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
      const fields=[...root.querySelectorAll('.contract-tier-detail:not([hidden]) .contract-tier-grid .contract-editable-tier input:not([readonly]):not(:disabled)')];
      (fields[fields.indexOf(event.target)+1]||root.querySelector('#customerPriceSearch'))?.focus();
    };
    unitSelect.onchange=()=>{
      const current=detail.querySelector('.contract-tier-grid [data-contract-unit]');
      if(current.dataset.contractUnit===unitSelect.value) return;
      const editor=selectContractPriceUnit(row,unitSelect.value);
      if(!readOnly&&!onChange&&!editor?.querySelector('.tier-price')) editor?.querySelector('[data-add-tier]')?.click();
    };
    const remove=row.querySelector('.customer-price-remove');
    if(remove) remove.onclick=()=>{
      const product=products.find(item=>Number(item.id)===Number(row.dataset.productId));
      if(!confirm(`ยืนยันลบ “${product?.name||'สินค้า'}” หน่วย ${unitSelect.value} ออกจากรายการราคาพิเศษหรือไม่?`)) return;
      const editor=detail.querySelector('.contract-tier-grid [data-contract-unit]');
      const next=[...detail.querySelector('[data-contract-unit-editors]').children].find(other=>
        [...other.querySelectorAll('.tier-min,.tier-price')].some(input=>input.value!==''||input.validity.badInput));
      if(next){
        selectContractPriceUnit(row,next.dataset.contractUnit);
        editor.remove();
      }else{
        detail.remove();
        row.remove();
      }
      if(customerPriceRows&&!customerPriceRows.querySelector('[data-customer-price-row]')) customerPriceRows.innerHTML='<tr class="customer-price-empty"><td colspan="6">ยังไม่ได้กำหนดราคาพิเศษ</td></tr>';
    };
  };
  const customerPriceSearch=root.querySelector('#customerPriceSearch');
  const customerPriceSearchResults=root.querySelector('#customerPriceSearchResults');
  const customerPriceMatches=query=>productScanMatches(query).map(({product,unitName})=>({product,unit:unitName}));
  const addCustomerPriceProduct=(product,unit)=>{
    if(!product||!customerPriceRows) return;
    const selectedUnit=productUnitOptions(product).some(option=>option.name===unit)?unit:product.unit;
    let row=[...customerPriceRows.querySelectorAll('[data-customer-price-row]')].find(item=>Number(item.dataset.productId)===Number(product.id));
    if(!row){
      customerPriceRows.querySelector('.customer-price-empty')?.remove();
      customerPriceRows.insertAdjacentHTML('beforeend',customerPriceRowHtml([{productId:product.id,unit:selectedUnit}],root.matches?.('.pos-customer-pricing-overlay'),group,root.id==='priceGroupPage'));
      row=customerPriceRows.lastElementChild.previousElementSibling;
      bindCustomerPriceRow(row);
    }
    const editor=selectContractPriceUnit(row,selectedUnit);
    (editor.querySelector('.tier-price')||editor.querySelector('[data-add-tier]'))?.focus();
    customerPriceSearch.value='';
    customerPriceSearchResults.hidden=true;
    customerPriceSearchResults.innerHTML='';
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
