async function saveProduct(){
  if(saveProduct.saving) return;
  const unitInput=document.getElementById('f_unit');
  if(unitInput) remapUnusedProductUnitInputs(unitInput);
  const mobileEditor=mobileProductEditor;
  if(mobileEditor){
    if(mobileEditor.saving||!canEditMobilePrice()||!mobileRequireOnline('บันทึกสินค้า')) return;
    captureMobileProductDraft();
    const current=products.find(product=>product.id===editingProductId);
    if(editingProductId!=='new'&&(!current||mobileProductEditSignature(current)!==mobileEditor.baseline)){
      showToast('ข้อมูลสินค้านี้เปลี่ยนระหว่างแก้ไข กรุณาออกแล้วเปิดใหม่เพื่อตรวจข้อมูลล่าสุด','danger-top'); return;
    }
    const invalid=document.querySelector('#mobileProductEditor input[type="number"]:invalid');
    if(invalid){ showToast('กรุณากรอกราคาและอัตราแปลงเป็นตัวเลขที่ถูกต้อง','danger-top'); invalid.focus(); return; }
  }
  const g = id => document.getElementById(id);
  const name = g('f_name').value.trim();
  const unit = g('f_unit').value.trim();
  const price = parseFloat(g('f_price').value);
  if(!name){ showToast('กรุณากรอกชื่อสินค้า'); g('f_name').focus(); return; }
  if(!unit){ showToast('กรุณากรอกหน่วยสินค้า'); g('f_unit').focus(); return; }
  if(!Number.isFinite(price)||price<0){ showToast('กรุณากรอกราคาขายตั้งแต่ 0 ขึ้นไป'); g('f_price').focus(); return; }
  const gv = id => { const el=g(id); return el?el.value:''; };
  // multi-unit rows
  const multiunit = g('f_multiunit') && g('f_multiunit').checked;
  const mainUnitName = unit;
  // Validate before filtering: otherwise a partially entered row is silently lost.
  // Read input strings so an explicitly entered zero also counts as entered data.
  if(multiunit){
    const unitRows=Array.from(document.querySelectorAll('#unitRows .unitrow'));
    const incompleteIndex=unitRows.findIndex(row=>{
      const sub=String(row.querySelector('.u_sub')?.value||'').trim();
      const hasValues=Array.from(row.querySelectorAll('.u_per,.u_price,.u_cost,.u_barcode')).some(input=>input.value.trim()!=='');
      const base=String(row.querySelector('.u_base')?.value||'').trim();
      return sub.startsWith('__')||(!sub&&(hasValues||(base&&base!==mainUnitName)));
    });
    if(incompleteIndex>=0){
      showToast(`กรุณาระบุหน่วยเพิ่มเติมแถวที่ ${incompleteIndex+1} ก่อนบันทึก`,'danger-top');
      unitRows[incompleteIndex].querySelector('.u_sub')?.focus();
      return;
    }
    const invalidQuantityIndex=unitRows.findIndex(row=>{
      if(!String(row.querySelector('.u_sub')?.value||'').trim()) return false;
      const input=row.querySelector('.u_per');
      const quantity=Number(input?.value);
      return !input?.value.trim()||!Number.isFinite(quantity)||quantity<=0;
    });
    if(invalidQuantityIndex>=0){
      showToast(`กรุณากรอกจำนวนต่อหน่วยของหน่วยเพิ่มเติมแถวที่ ${invalidQuantityIndex+1} ให้มากกว่า 0 ก่อนบันทึก`,'danger-top');
      unitRows[invalidQuantityIndex].querySelector('.u_per')?.focus();
      return;
    }
  }
  const rawRows = multiunit ? collectUnitRowsFromDOM().filter(u=>u.sub) : [];
  const units = rawRows.map(r=>({
    sub: r.sub,
    per: r.per,
    base: r.base || mainUnitName,
    factor: resolveNetFactor(r.sub, rawRows, mainUnitName), // จำนวนหน่วยหลักสุทธิ (เช่น ลัง=100 แผง)
    price: r.price,
    cost: r.cost,
    barcode: r.barcode,
  }));
  const validBarcodeUnits=new Set([mainUnitName,...units.map(item=>item.sub)].filter(Boolean));
  const extraBarcodeRows=mobileEditor?extraBarcodeEntries(mobileEditor.draft):Array.from(document.querySelectorAll('#extraBarcodeRows .bcrow')).map(row=>{
    const requestedUnit=String(row.querySelector('.eb_unit')?.value||'').trim();
    return {
      unit:validBarcodeUnits.has(requestedUnit)?requestedUnit:mainUnitName,
      code:String(row.querySelector('.eb_code')?.value||'').trim(),
    };
  }).filter(item=>item.code);
  const existing = (editingProductId!=='new') ? products.find(x=>x.id===editingProductId) : null;
  const directUnitChange=!!existing&&unit!==String(existing.unit||'').trim();
  if(directUnitChange&&(!canEditMobilePrice()||g('f_unit').dataset.directUnitEdit!==String(existing.id))){
    showToast('กรุณาใช้ปุ่ม “เปลี่ยนหน่วยหลัก” เพื่อแปลงสต๊อกทุกคลังอย่างถูกต้อง','danger');
    return;
  }
  if(directUnitChange){
    const blockers=unusedProductUnitLocalBlockers(existing);
    if(!sb||navigator.onLine===false||coreSyncInFlight||blockers.length){
      showToast(blockers.length?'แก้หน่วยโดยตรงไม่ได้: '+blockers.join(', '):'กรุณาเชื่อมต่ออินเทอร์เน็ตและรอซิงก์เสร็จก่อนแก้หน่วยหลัก','danger-top'); return;
    }
    if(units.some(row=>row.sub===unit||!Number.isFinite(row.factor)||row.factor<=0)){
      showToast('หน่วยหลักซ้ำกับหน่วยเพิ่มเติม หรืออัตราแปลงไม่ถูกต้อง กรุณาตรวจหน่วยสินค้า','danger-top'); return;
    }
  }
  const hasOpening = g('f_openingtoggle') && g('f_openingtoggle').checked;
  // เก็บค่าเดิมไว้เพื่อให้ข้อมูลเก่าที่เคยบันทึกไม่สูญหาย แม้รายงานจะใช้เกณฑ์รวมที่ผู้ใช้เลือกแทนแล้ว
  const lowAlert = existing ? (existing.lowAlert!==false) : true;
  const threshold = existing ? (existing.threshold??DEFAULT_LOW_STOCK_THRESHOLD) : DEFAULT_LOW_STOCK_THRESHOLD;
  const lowMode = existing ? (existing.lowMode||'default') : 'default';
  const data = {
    name, unit, price,
    active: g('f_active') ? g('f_active').checked : existing?.active!==false,
    cost: parseFloat(gv('f_cost'))||0,
    sku: g('f_sku').value.trim(),
    category: g('f_category').value,
    brand: (g('f_brand')&&g('f_brand').value) || 'ทั่วไป',
    barcode: g('f_barcode').value.trim(),
    extraBarcodes: extraBarcodeRows.map(item=>item.code),
    extraBarcodeUnits: extraBarcodeRows.map(item=>item.unit),
    vendorBarcodes: mobileEditor?(mobileEditor.draft.vendorBarcodes||[]).map(row=>({...row})):Array.from(document.querySelectorAll('#vendorBarcodeRows .bcrow')).map(r=>({vendor:r.querySelector('.vb_vendor').value, code:r.querySelector('.vb_code').value.trim()})).filter(v=>v.code),
    wh: existing?.wh||Number(activeWarehouseId),
    desc: g('f_desc').value.trim(),
    // Product metadata never changes stock. New products start at zero and
    // existing stock remains whatever inventory_balances currently reports.
    stock: existing?(Number(existing.stock)||0):0,
    type: existing?.type || 'stock',
    vat: gv('f_vat') || 'incl',
    multiunit, units,
    hasOpening, openingDate: gv('f_openingdate'), openingQty: parseFloat(gv('f_openingqty'))||0, openingCost: parseFloat(gv('f_openingcost'))||0,
    lowAlert, lowMode, threshold,
  };
  if(existing&&data.active===false&&cart.some(line=>Number(line.pid)===Number(existing.id))){
    showToast('สินค้านี้อยู่ในบิลที่กำลังเปิด กรุณาลบออกจากบิลก่อนปิดใช้งาน','danger');
    return;
  }
  const structureError=productStructureValidationError(data);
  if(structureError){ showToast(structureError,'danger-top'); return; }
  const barcodeError=productBarcodeValidationError(data,existing?.id);
  if(barcodeError){ showToast(barcodeError,'danger-top'); return; }
  if(mobileEditor){
    const error=mobileProductValidationError(data,directUnitChange?{...existing,extraBarcodes:data.extraBarcodes,extraBarcodeUnits:data.extraBarcodeUnits,unit:data.unit}:existing);
    if(error){ showToast(error,'danger-top'); return; }
    mobileEditor.saving=true;
    g('mobileProductEditor').disabled=true;
    g('saveProductBtn').textContent='กำลังบันทึก...';
  }
  saveProduct.saving=true;
  const saveButton=g('saveProductBtn');
  const saveTarget=editingProductId;
  const expectedMetadata=existing?mobileProductEditSignature(existing):'';
  if(saveButton) saveButton.disabled=true;
  try{
  await assertProductBarcodesAvailable(data,existing);
  // A slow preflight must never save into a different form after Cancel/navigation.
  if(!saveButton?.isConnected||editingProductId!==saveTarget||mobileProductEditor!==mobileEditor) return;
  if(existing&&mobileProductEditSignature(products.find(product=>product.id===saveTarget))!==expectedMetadata){
    showToast('ข้อมูลสินค้านี้เปลี่ยนระหว่างตรวจสอบ กรุณาเปิดใหม่เพื่อตรวจข้อมูลล่าสุด','danger-top'); return;
  }
  const latestBarcodeError=productBarcodeValidationError(data,existing?.id);
  if(latestBarcodeError){ showToast(latestBarcodeError,'danger-top'); return; }
  let directUnitSavedProduct=null;
  if(directUnitChange){
    const blockers=unusedProductUnitLocalBlockers(existing);
    if(blockers.length||coreSyncInFlight) throw new Error('ข้อมูลกำลังใช้งานหรือรอซิงก์ กรุณาตรวจสอบอีกครั้ง');
    const {data:result,error}=await sb.rpc('save_unused_product_unit',{
      p_product_id:Number(existing.id),p_expected_revision:Number(existing._revision)||0,
      p_record:productMetadataToRow({...existing,...data}),
    });
    if(error) throw new Error(error.message||'แก้หน่วยหลักไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง');
    if(!result?.product||Number(result.product.id)!==Number(existing.id)) throw new Error('ไม่ได้รับผลยืนยัน กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง');
    directUnitSavedProduct=rowToProduct(result.product);
  }
  let savedProductId=null;
  let productChangeType='update';
  if(saveTarget==='new'){
    const id=generateClientProductId();
    let sku=data.sku;
    if(!sku){
      const allocation=allocateReadableProductSku(products.map(product=>product.sku),nextProductSkuNumber);
      sku=allocation.sku;
      nextProductSkuNumber=allocation.nextSequence;
    }else{
      nextProductSkuNumber=Math.max(nextProductSkuNumber,productSkuSequenceNumber(sku)+1);
    }
    products.push({id,...data,sku,_clientCreateToken:generateProductCreateToken()});
    savedProductId=id;
    productChangeType='insert';
    if(!mobileEditor) showToast(`เพิ่มสินค้า "${name}" แล้ว`);
  } else {
    let p = products.find(x=>x.id===saveTarget);
    if(!p&&directUnitSavedProduct){ p=directUnitSavedProduct; products.push(p); }
    if(!p) throw new Error('ไม่พบสินค้า กรุณาโหลดข้อมูลล่าสุด');
    savedProductId=p.id;
    const catalogExpiry=p._catalogExpiry;
    Object.assign(p, directUnitSavedProduct||data);
    p._catalogExpiry=catalogExpiry;
    if(!mobileEditor) showToast(`บันทึกการแก้ไข "${name}" แล้ว`);
  }
  if(mobileEditor&&mobileProductEditor===mobileEditor&&editingProductId===saveTarget&&saveButton?.isConnected){
    // Keep the same identity/token on a cache or network retry: never create twice.
    editingProductId=savedProductId;
    const savedProduct=products.find(product=>product.id===savedProductId);
    mobileEditor.baseline=mobileProductEditSignature(savedProduct);
    mobileEditor.draft.sku=savedProduct.sku;
    g('f_sku').value=savedProduct.sku;
  }
  if(data.active===false){
    favorites=normalizeFavorites(favorites.filter(entry=>favoriteProductId(entry)!==Number(savedProductId)),products);
    syncFavoritesToSupabase();
  }
  rebuildProductLookupMaps();
  let cached;
  if(directUnitSavedProduct){
    // Already committed atomically on the server: never enqueue an ordinary
    // metadata write that could later bypass the unused-product recheck.
    (syncedTableRows.products||=new Map()).set(String(savedProductId),JSON.stringify(productMetadataToRow(products.find(p=>p.id===savedProductId))));
    cached=await persistProductChangesToIndexedDB({updatedIds:[savedProductId]});
    persistWorkspaceData();
  }else cached=await persistWorkspaceData({productChanges:productChangeType==='insert'?{insertedIds:[savedProductId]}:{updatedIds:[savedProductId]}});
  if(!cached){ showToast('บันทึกข้อมูลแล้ว แต่เก็บสำเนาสินค้าในเครื่องไม่สำเร็จ กรุณาอย่าเพิ่งปิดหน้านี้','danger-top'); return; }
  // A server commit must update the cache even after navigation, but must not
  // close or overwrite the editor that the user opened while it was pending.
  if(!saveButton?.isConnected||mobileProductEditor!==mobileEditor||(editingProductId!==saveTarget&&editingProductId!==savedProductId)) return;
  if(mobileEditor){
    const savedProduct=products.find(product=>product.id===savedProductId);
    mobileProductEditor=null;
    mobileToolMode='price';
    mobileSelectPriceProduct(savedProduct,savedProduct.unit);
    setMobileDataStatus('syncing','บันทึกในเครื่องแล้ว · กำลังซิงก์');
  }
  editingProductId = null;
  render();
  if(mobileEditor){
    await syncCoreDataToSupabase();
    const pending=productDirtyOperations.has(String(savedProductId));
    setMobileDataStatus(pending?'error':'online',pending?'สินค้ายังรอซิงก์':'บันทึกและซิงก์สินค้าแล้ว');
    showToast(pending?'เก็บข้อมูลในเครื่องแล้ว แต่ยังรอซิงก์ กรุณาตรวจรายละเอียดก่อนปิดแอป':'บันทึกและซิงก์สินค้าแล้ว',pending?'danger-top':undefined);
    if(currentTab==='mobiletools'&&!mobileProductEditor) render();
  }
  }catch(error){
    showToast(error?.message||'บันทึกสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง','danger-top');
  }finally{
    saveProduct.saving=false;
    if(saveButton?.isConnected) saveButton.disabled=false;
    if(mobileEditor&&mobileProductEditor===mobileEditor){
      mobileEditor.saving=false;
      const form=g('mobileProductEditor'); if(form) form.disabled=false;
      const button=g('saveProductBtn'); if(button) button.textContent='บันทึก';
    }
  }
}

function valueReferencesProduct(value,productId){
  const target=Number(productId);
  if(!Number.isFinite(target)||value===null||value===undefined) return false;
  if(Array.isArray(value)) return value.some(item=>valueReferencesProduct(item,target));
  if(typeof value!=='object') return false;
  for(const key of ['productId','pid','bgdBuyProductId','bgdGetProductId']){
    if(Object.prototype.hasOwnProperty.call(value,key)&&Number(value[key])===target) return true;
  }
  return Object.values(value).some(item=>valueReferencesProduct(item,target));
}

function productDeletionLocalBlockers(productId){
  const id=Number(productId),blockers=[];
  const add=(label,condition)=>{ if(condition&&!blockers.includes(label)) blockers.push(label); };
  add('บิลที่กำลังเปิดอยู่',valueReferencesProduct(cart,id));
  add('ประวัติการขาย',valueReferencesProduct(salesHistory,id));
  add('เอกสารสินค้า',[
    quotations,invoicesAR,creditNotes,purchaseOrders,goodsReceipts,productExchanges,
    productReturns,transfers,standaloneTaxInvoices,
  ].some(list=>valueReferencesProduct(list,id)));
  add('รายการตรวจสินค้า',valueReferencesProduct(inspectionLists,id));
  add('โปรโมชั่น',valueReferencesProduct(promotions,id));
  add('จำนวนคงเหลือในคลัง',inventoryBalanceRows.some(row=>Number(row.product_id)===id&&Math.abs(Number(row.stock)||0)>0.000001));
  add('ประวัติ LOT',inventoryLotRows.some(row=>Number(row.product_id)===id));
  return blockers;
}

async function deleteUnusedProduct(){
  if(loggedInUser()?.owner!==true||Number(loggedInUser()?.level)!==1){
    showToast('เฉพาะเจ้าของร้าน Level 1 เท่านั้นที่ลบสินค้าได้','danger');
    return false;
  }
  const product=products.find(item=>Number(item.id)===Number(editingProductId));
  if(!product) return false;
  const localBlockers=productDeletionLocalBlockers(product.id);
  if(localBlockers.length){
    showToast(`ลบสินค้าไม่ได้ เนื่องจากมี: ${localBlockers.join(', ')}`,'danger');
    return false;
  }
  if(!confirm(`ยืนยันลบสินค้า “${product.name}”\nรหัสสินค้า ${product.sku||'-'}\n\nการลบถาวรไม่สามารถย้อนกลับได้`)) return false;
  const button=document.getElementById('deleteProductBtn');
  if(button){ button.disabled=true; button.textContent='กำลังตรวจสอบ...'; }
  try{
    const {data,error}=await sb.rpc('delete_unused_product',{p_product_id:Number(product.id)});
    if(error) throw error;
    const blockers=Array.isArray(data?.blockers)?data.blockers:[];
    if(data?.deleted!==true){
      showToast(blockers.length?`ลบสินค้าไม่ได้ เนื่องจากมี: ${blockers.join(', ')}`:'ลบสินค้าไม่ได้ เพราะสินค้านี้มีข้อมูลเกี่ยวข้อง','danger');
      if(button){ button.disabled=false; button.textContent='ลบสินค้า'; }
      return false;
    }
    products=products.filter(item=>Number(item.id)!==Number(product.id));
    rebuildProductLookupMaps();
    favorites=normalizeFavorites(favorites.filter(entry=>favoriteProductId(entry)!==Number(product.id)),products);
    inventoryBalanceRows=inventoryBalanceRows.filter(row=>Number(row.product_id)!==Number(product.id));
    inventoryLotRows=inventoryLotRows.filter(row=>Number(row.product_id)!==Number(product.id));
    rebuildInventoryBalanceMap();
    rebuildInventoryLotMap();
    const dirtyOperation=productDirtyOperations.get(String(product.id));
    const productCacheSaved=dirtyOperation
      ?await clearAcknowledgedProductDirtyOperations([product.id],new Map([[String(product.id),dirtyOperation]]))
      :await persistProductsToIndexedDB(products,true);
    if(productCacheSaved) seedTableSnapshot('products',products,productMetadataToRow);
    else seedProductSyncSnapshot(products,productDirtyOperations);
    lastSyncedSnapshot.favorites=JSON.stringify(favorites);
    editingProductId=null;
    refreshDataCounters();
    persistWorkspaceData();
    showToast(productCacheSaved?`ลบสินค้า “${product.name}” แล้ว`:`ลบสินค้าจากระบบแล้ว แต่เก็บสำเนาในเครื่องไม่สำเร็จ กรุณารีเฟรชก่อนทำงานต่อ`,productCacheSaved?undefined:'danger-top');
    render();
    return true;
  }catch(error){
    console.error('delete unused product',error);
    showToast(error?.message?.includes('Could not find the function')?'ระบบฐานข้อมูลยังไม่พร้อมสำหรับการลบสินค้า กรุณาลองใหม่หลังอัปเดตระบบ':(error?.message||'ลบสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง'),'danger');
    if(button){ button.disabled=false; button.textContent='ลบสินค้า'; }
    return false;
  }
}
