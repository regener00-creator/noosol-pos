function syncProductExchangeFromDOM(){
  const draft=productExchangeDraft; if(!draft) return;
  const date=document.getElementById('productExchangeDate');
  if(date){ const raw=date.value.trim(); draft.date=raw?(dmyToISO(raw)||raw):''; }
  const supplier=document.getElementById('productExchangeSupplier'); if(supplier) draft.supplier=supplier.value;
  const warehouse=document.getElementById('productExchangeWarehouse'); if(warehouse) draft.warehouseId=Number(warehouse.value)||0;
  const note=document.getElementById('productExchangeNote'); if(note) draft.note=note.value;
  ['outgoing','incoming'].forEach(side=>{
    const rows=[...document.querySelectorAll(`[data-product-exchange-row="${side}"]`)];
    if(!rows.length) return;
    const source=side==='outgoing'?draft.outgoingItems:draft.incomingItems;
    const next=rows.map((row,index)=>normalizeProductExchangeItem({
      ...(source[index]||{}),qty:row.querySelector('.product-exchange-qty')?.value,
      unit:row.querySelector('.product-exchange-unit')?.value,
      lotNumber:row.querySelector('.product-exchange-lot')?.value||'',
      expiry:(()=>{ const text=row.querySelector('.product-exchange-expiry')?.value||''; return text?dmyToISO(text)||text:''; })()
    })).filter(Boolean);
    if(side==='outgoing') draft.outgoingItems=next; else draft.incomingItems=next;
  });
  draft.updatedAt=new Date().toISOString();
}
function productExchangeSearchMatches(query){
  const draft=activeProductExchangeDraft(),q=String(query||'').trim().toLowerCase();
  if(!q) return [];
  return activeProducts().filter(product=>{
    const codes=[product.barcode,product.sku,...(product.extraBarcodes||[]),...(product.vendorBarcodes||[]).map(item=>item?.code),...(product.units||[]).map(unit=>unit.barcode)].filter(Boolean);
    return String(product.name||'').toLowerCase().includes(q)||codes.some(code=>String(code).toLowerCase().includes(q));
  }).slice(0,12);
}
function exactProductExchangeMatch(query){
  const draft=activeProductExchangeDraft(),q=String(query||'').trim().toLowerCase();
  if(!q) return null;
  for(const product of activeProducts()){
    for(const option of productUnitOptions(product)){
      if(option.barcode&&String(option.barcode).toLowerCase()===q) return {product,unit:option.name};
    }
    if(String(product.sku||'').toLowerCase()===q) return {product,unit:product.unit};
    const extra=extraBarcodeEntries(product).find(item=>String(item.code).toLowerCase()===q);
    if(extra) return {product,unit:extraBarcodeAvailableUnits(product).includes(extra.unit)?extra.unit:product.unit};
    if((product.vendorBarcodes||[]).some(item=>String(item?.code||'').toLowerCase()===q)) return {product,unit:product.unit};
  }
  return null;
}
function addProductExchangeItem(side,productId,unitName){
  syncProductExchangeFromDOM();
  const draft=activeProductExchangeDraft(),product=products.find(entry=>Number(entry.id)===Number(productId));
  if(!product) return;
  const options=productUnitOptions(product),selected=options.find(option=>option.name===unitName)||options[0];
  const target=side==='incoming'?draft.incomingItems:draft.outgoingItems;
  const existing=target.find(item=>Number(item.pid)===Number(product.id)&&item.unit===selected.name&&String(item.expiry||'')===String(side==='outgoing'?(product.expiry||''):''));
  if(existing) existing.qty=(Number(existing.qty)||0)+1;
  else target.push(normalizeProductExchangeItem({lineId:Date.now()+Math.floor(Math.random()*10000),pid:product.id,qty:1,unit:selected.name,expiry:side==='outgoing'?(product.expiry||''):''}));
  render();
  setTimeout(()=>document.getElementById(`productExchangeScan_${side}`)?.focus(),0);
}
function renderProductExchangeSearchResults(side,query){
  const box=document.getElementById(`productExchangeResults_${side}`); if(!box) return;
  const matches=productExchangeSearchMatches(query);
  if(!String(query||'').trim()){ box.hidden=true; box.innerHTML=''; return; }
  box.innerHTML=matches.length?matches.map(product=>`<button type="button" class="product-exchange-result" data-product-exchange-result="${side}:${product.id}"><span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.sku||'-')} · ${escapeHtml(product.barcode||'ไม่มีบาร์โค้ด')}</small></span><small>${escapeHtml(stockInLargestUnit({...product,stock:warehouseStock(product.id,activeProductExchangeDraft().warehouseId)}))}</small></button>`).join(''):'<div class="product-exchange-empty">ไม่พบสินค้าในคลังที่เลือก</div>';
  box.hidden=false;
  box.querySelectorAll('[data-product-exchange-result]').forEach(button=>{
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>{ const [,id]=button.dataset.productExchangeResult.split(':'); addProductExchangeItem(side,Number(id)); });
  });
}
function bindProductExchangeScanners(){
  document.querySelectorAll('[data-product-exchange-scan]').forEach(input=>{
    const side=input.dataset.productExchangeScan;
    input.addEventListener('input',()=>renderProductExchangeSearchResults(side,input.value));
    input.addEventListener('focus',()=>{ if(input.value.trim()) renderProductExchangeSearchResults(side,input.value); });
    input.addEventListener('keydown',event=>{
      if(event.key==='Escape'){ input.value=''; renderProductExchangeSearchResults(side,''); return; }
      if(event.key!=='Enter') return;
      event.preventDefault();
      const exact=exactProductExchangeMatch(input.value);
      if(exact) addProductExchangeItem(side,exact.product.id,exact.unit);
      else{
        const first=productExchangeSearchMatches(input.value)[0];
        if(first) addProductExchangeItem(side,first.id); else showToast('ไม่พบสินค้าในคลังที่เลือก');
      }
    });
    input.addEventListener('blur',()=>setTimeout(()=>{ const box=document.getElementById(`productExchangeResults_${side}`); if(box) box.hidden=true; },140));
  });
}
function validateProductExchangeDraft(draft,forStatus='ร่าง'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(draft.date||''))||dmyToISO(isoToDMY(draft.date))!==draft.date){ showToast('กรุณากรอกวันที่เอกสารเป็น วัน/เดือน/ปี'); document.getElementById('productExchangeDate')?.focus(); return false; }
  if(!draft.supplier){ showToast('กรุณาเลือกผู้จำหน่าย'); return false; }
  if(!draft.warehouseId){ showToast('กรุณาเลือกคลัง / สาขา'); return false; }
  if(!draft.outgoingItems.length){ showToast('กรุณาเพิ่มสินค้าที่ส่งไปเปลี่ยนอย่างน้อย 1 รายการ'); return false; }
  if(draft.outgoingItems.some(item=>productExchangeItemBaseQty(item)<=0)){ showToast('จำนวนสินค้าที่ส่งไปต้องมากกว่า 0'); return false; }
  if(forStatus==='รับสินค้ากลับแล้ว'){
    if(!draft.incomingItems.length){ showToast('กรุณาเพิ่มสินค้าที่ได้รับกลับอย่างน้อย 1 รายการ'); return false; }
    if(draft.incomingItems.some(item=>productExchangeItemBaseQty(item)<=0)){ showToast('จำนวนสินค้าที่รับกลับต้องมากกว่า 0'); return false; }
    if(draft.incomingItems.some(item=>!/^\d{4}-\d{2}-\d{2}$/.test(String(item.expiry||'')))){ showToast('กรุณาระบุวันหมดอายุของสินค้าที่ได้รับกลับให้ครบในรูปแบบ วัน/เดือน/ปี'); return false; }
  }
  return true;
}
function saveProductExchange(closeAfter=true){
  syncProductExchangeFromDOM();
  const draft=activeProductExchangeDraft();
  if(!validateProductExchangeDraft(draft)) return false;
  draft.outgoingItems=draft.outgoingItems.map(normalizeProductExchangeItem).filter(Boolean);
  draft.incomingItems=draft.incomingItems.map(normalizeProductExchangeItem).filter(Boolean);
  draft.updatedAt=new Date().toISOString();
  const index=productExchanges.findIndex(doc=>doc.id===draft.id);
  if(index>=0) productExchanges[index]=JSON.parse(JSON.stringify(draft)); else productExchanges.unshift(JSON.parse(JSON.stringify(draft)));
  refreshDataCounters(); persistWorkspaceData();
  if(closeAfter){ editingProductExchangeId=null; productExchangeDraft=null; showToast('บันทึกเอกสารเปลี่ยนสินค้าแล้ว'); render(); }
  return draft.id;
}
async function refreshProductExchangeProducts(doc){
  const ids=[...new Set([...(doc.outgoingItems||[]),...(doc.incomingItems||[])].map(item=>Number(item.pid)).filter(Boolean))];
  if(!ids.length) return;
  const {data,error}=await sb.from('products').select('*').in('id',ids);
  if(error) throw error;
  (data||[]).map(rowToProduct).forEach(remote=>{
    const index=products.findIndex(local=>Number(local.id)===Number(remote.id));
    if(index<0) return;
    const dirtyOperation=productDirtyOperations.get(String(remote.id));
    products[index]=dirtyOperation&&dirtyOperation!=='delete'?{...products[index],stock:remote.stock,_catalogExpiry:remote._catalogExpiry}:remote;
  });
  rebuildProductLookupMaps();
  await loadInventoryBalancesFromSupabase();
  await loadInventoryLotsFromSupabase();
  applyActiveWarehouseInventory();
  seedProductSyncSnapshot(products,productDirtyOperations);
  await persistProductsToIndexedDB(products,true);
}
async function changeProductExchangeStatus(status){
  syncProductExchangeFromDOM();
  const draft=activeProductExchangeDraft(),plan=productExchangeTransitionPlan(draft,status);
  if(!plan.allowed){ showToast('ไม่สามารถย้อนสถานะเอกสารที่ลงสต๊อกแล้ว'); render(); return; }
  if(!validateProductExchangeDraft(draft,status)) return;
  if(status==='รับสินค้ากลับแล้ว'){
    const reconciliation=productExchangeReconciliation(draft);
    if(reconciliation.unreturnedItems.length){
      const names=reconciliation.unreturnedItems.map(item=>`${item.name||products.find(product=>Number(product.id)===Number(item.pid))?.name||'-'} ${item.qty} ${item.unit||'หน่วย'}`).join('\n• ');
      if(!confirm(`ได้รับสินค้ากลับไม่ครบตามที่ส่งไป\n\nไม่ได้รับคืน:\n• ${names}\n\nรายการเหล่านี้จะถือว่าถูกตัดออกจากสต๊อกถาวร ยืนยันรับสินค้ากลับหรือไม่?`)) return;
    }
    draft.unreturnedItems=reconciliation.unreturnedItems;
  }
  const required=new Map();
  if(plan.applyOutgoing) (draft.outgoingItems||[]).forEach(item=>required.set(Number(item.pid),(required.get(Number(item.pid))||0)+productExchangeItemBaseQty(item)));
  for(const [pid,qty] of required){ const product=products.find(item=>Number(item.id)===pid); if(!product||warehouseStock(pid,draft.warehouseId)<qty){ showToast(`สต๊อกไม่พอสำหรับ ${product?.name||'สินค้าที่เลือก'}`,'danger'); return; } }
  const savedId=saveProductExchange(false); if(!savedId) return;
  const buttons=[document.getElementById('confirmExchangeSentBtn'),document.getElementById('confirmExchangeReceivedBtn')].filter(Boolean);
  buttons.forEach(button=>button.disabled=true);
  try{
    const doc=productExchanges.find(item=>item.id===savedId);
    await saveRevisionedDocument('product_exchanges',doc);
    const data=await runStockOperation('apply_product_exchange_status',{exchangeId:doc.id,nextStatus:status});
    const remoteDoc=data?.exchange||doc;
    await refreshProductExchangeProducts(remoteDoc);
    const index=productExchanges.findIndex(item=>item.id===doc.id);
    if(index>=0) productExchanges[index]=remoteDoc;
    productExchangeDraft=JSON.parse(JSON.stringify(remoteDoc));
    seedTableSnapshot('product_exchanges',productExchanges,docToRow);
    persistWorkspaceData();
    showToast(status==='รับสินค้ากลับแล้ว'?'รับสินค้ากลับและเพิ่มสต๊อกเรียบร้อย':'ส่งสินค้าไปเปลี่ยนและตัดสต๊อกเรียบร้อย');
    render();
  }catch(error){
    console.error('เปลี่ยนสถานะเอกสารเปลี่ยนสินค้าไม่สำเร็จ',error);
    showToast(error?.message||'บันทึกสถานะและสต๊อกไม่สำเร็จ กรุณาลองอีกครั้ง','danger');
    buttons.forEach(button=>button.disabled=false);
  }
}
