function bindPasswordVisibilityToggles(root=document){
  root.querySelectorAll('[data-toggle-password]').forEach(button=>{
    if(button.dataset.passwordToggleBound==='1') return;
    button.dataset.passwordToggleBound='1';
    button.addEventListener('click',()=>{
      const input=document.getElementById(button.dataset.togglePassword);
      if(!input) return;
      const showing=input.type==='password';
      input.type=showing?'text':'password';
      button.classList.toggle('showing-password',showing);
      const subject=button.dataset.passwordLabel||'Password';
      const label=`${showing?'ซ่อน':'แสดง'}${/^[A-Za-z]/.test(subject)?' ':''}${subject}`;
      button.setAttribute('aria-label',label);
      button.title=label;
      input.focus();
    });
  });
}

function attachEvents(){
  attachReceiptPrinterEvents();
  if(currentTab==='mobiletools'){
    prepareMobileScanSound();
    prepareMobileScanErrorSound();
    prepareMobileScanDecodedSound('success');
    prepareMobileScanDecodedSound('error');
    attachMobileScanSoundUnlock();
  }
  attachNoteEvents();
  attachRepresentativeHistoryEvents();
  document.querySelectorAll('[data-open-cash-shift]').forEach(button=>button.addEventListener('click',()=>{ currentTab='cashshift'; render(); }));
  document.getElementById('cashShiftOpenForm')?.addEventListener('submit',openCashShift);
  document.getElementById('cashShiftCloseForm')?.addEventListener('submit',closeCashShift);
  const cashShiftCountedCash=document.getElementById('cashShiftCountedCash');
  if(cashShiftCountedCash) cashShiftCountedCash.addEventListener('input',()=>{
    cashShiftCloseDraft.countedCash=cashShiftCountedCash.value;
    const output=document.getElementById('cashShiftVariance'); if(!output||!currentCashShift) return;
    const value=cashShiftCountedCash.value.trim();
    if(value===''){ output.className='cash-shift-variance'; output.querySelector('b').textContent='กรอกเงินที่นับจริง'; return; }
    const variance=Math.round((Number(value)-cashShiftSummary(currentCashShift).expectedCash)*100)/100;
    output.className=`cash-shift-variance ${Math.abs(variance)<.01?'ok':'danger'}`;
    output.querySelector('b').textContent=`${variance>0?'+':''}${fmtMoney(variance)} บาท`;
  });
  const cashShiftCloseReason=document.getElementById('cashShiftCloseReason');
  if(cashShiftCloseReason) cashShiftCloseReason.addEventListener('input',()=>{ cashShiftCloseDraft.reason=cashShiftCloseReason.value; });
  document.querySelectorAll('[data-print-cash-shift]').forEach(button=>button.addEventListener('click',()=>printCashShiftSummary(button.dataset.printCashShift)));
  const auditLogSearch=document.getElementById('auditLogSearch');
  if(auditLogSearch) auditLogSearch.addEventListener('input',()=>{
    auditLogFilter.search=auditLogSearch.value;
    auditLogPage=1;
    auditLogRequestToken++;
    clearTimeout(auditLogSearchTimer);
    auditLogSearchTimer=setTimeout(()=>{
      auditLogLoaded=false;
      loadAuditLogsFromSupabase(true,'first');
    },350);
  });
  const auditLogEntity=document.getElementById('auditLogEntity');
  if(auditLogEntity) auditLogEntity.addEventListener('change',()=>{
    auditLogFilter.entity=auditLogEntity.value; auditLogPage=1; auditLogLoaded=false;
    loadAuditLogsFromSupabase(true,'first'); render();
  });
  const auditLogAction=document.getElementById('auditLogAction');
  if(auditLogAction) auditLogAction.addEventListener('change',()=>{
    auditLogFilter.action=auditLogAction.value; auditLogPage=1; auditLogLoaded=false;
    loadAuditLogsFromSupabase(true,'first'); render();
  });
  document.getElementById('auditLogClearSearch')?.addEventListener('click',()=>{
    clearTimeout(auditLogSearchTimer);
    auditLogFilter.search=''; auditLogPage=1; auditLogLoaded=false;
    loadAuditLogsFromSupabase(true,'first'); render();
    setTimeout(()=>document.getElementById('auditLogSearch')?.focus(),0);
  });
  document.getElementById('auditLogClearFilters')?.addEventListener('click',()=>{
    clearTimeout(auditLogSearchTimer);
    auditLogFilter={search:'',entity:'all',action:'all'}; auditLogPage=1; auditLogLoaded=false;
    loadAuditLogsFromSupabase(true,'first'); render();
  });
  document.getElementById('auditLogRefresh')?.addEventListener('click',()=>{ auditLogLoaded=false; auditLogPage=1; loadAuditLogsFromSupabase(true,'first'); render(); });
  document.querySelectorAll('[data-audit-log-toggle]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.auditLogToggle;
    if(expandedAuditLogRows.has(key)) expandedAuditLogRows.delete(key); else expandedAuditLogRows.add(key);
    render();
  }));
  document.querySelectorAll('[data-audit-log-page]').forEach(button=>button.addEventListener('click',()=>{
    loadAuditLogsFromSupabase(true,button.dataset.auditLogPage);
    render();
  }));
  document.querySelectorAll('[data-stock-control-mode]').forEach(button=>button.addEventListener('click',()=>{
    stockControlMode=button.dataset.stockControlMode;
    render();
  }));
  const stockLotSearchInput=document.getElementById('stockLotReallocationSearch');
  if(stockLotSearchInput) stockLotSearchInput.addEventListener('input',()=>{
    stockLotReallocationSearch=stockLotSearchInput.value;
    stockLotReallocationPage=1;
    render();
    const next=document.getElementById('stockLotReallocationSearch');
    if(next){ next.focus(); next.setSelectionRange(next.value.length,next.value.length); }
  });
  document.querySelectorAll('[data-stock-lot-reallocation]').forEach(button=>button.addEventListener('click',()=>openStockLotReallocation(button.dataset.stockLotReallocation)));
  document.querySelectorAll('[data-stock-lot-page]').forEach(button=>button.addEventListener('click',()=>{
    const value=button.dataset.stockLotPage;
    if(value==='prev') stockLotReallocationPage=Math.max(1,stockLotReallocationPage-1);
    else if(value==='next') stockLotReallocationPage++;
    else stockLotReallocationPage=Number(value)||1;
    render();
  }));
  document.querySelectorAll('[data-stock-control-review]').forEach(button=>button.addEventListener('click',()=>stockControlOpenAdjustmentForProduct(button.dataset.stockControlReview)));
  document.querySelectorAll('[data-stock-control-import-list]').forEach(button=>button.addEventListener('click',()=>stockEditImportInspectionList(button.dataset.stockControlImportList,true)));
  document.getElementById('mobileToolsLogout')?.addEventListener('click',()=>{
    if(confirm('ยืนยันการออกจากระบบใช่หรือไม่?')){ closeMobileCameraScanner(); logoutSystem(); }
  });
  const mobileToolsRefresh=document.getElementById('mobileToolsRefresh');
  document.getElementById('mobileNewProduct')?.addEventListener('click',()=>openMobileProductEditor());
  document.getElementById('mobileProductSyncDetails')?.addEventListener('click',openSyncDetailsModal);
  if(mobileToolsRefresh) mobileToolsRefresh.addEventListener('click',()=>refreshMobileToolsData(mobileToolsRefresh));
  document.getElementById('mobileInstallApp')?.addEventListener('click',requestMobilePwaInstall);
  document.querySelectorAll('[data-mobile-tool]').forEach(button=>button.addEventListener('click',()=>{
    mobileToolMode=button.dataset.mobileTool;
    mobilePriceQuery=''; mobilePriceProductId=null; mobilePriceLotId=null;
    mobileInspectionQuery=''; mobileInspectionLastProductId=null; mobileInspectionVisibleCount=25;
    mobileStockQuery=''; mobileStockLastProductId=null;
    render();
  }));
  document.querySelectorAll('[data-mobile-inventory-step]').forEach(button=>button.addEventListener('click',()=>{
    mobileInventoryStep=button.dataset.mobileInventoryStep==='stock'?'stock':'inspection';
    mobileInspectionQuery=''; mobileInspectionLastProductId=null; mobileInspectionVisibleCount=25;
    mobileStockQuery=''; mobileStockLastProductId=null;
    render();
  }));
  const mobilePriceInput=document.getElementById('mobilePriceInput');
  if(mobilePriceInput){
    mobilePriceInput.addEventListener('input',()=>{
      mobilePriceQuery=mobilePriceInput.value;
      mobilePriceProductId=null;
      mobilePriceLotId=null;
      const result=document.getElementById('mobilePriceResult');
      if(result){
        result.innerHTML=mobilePriceResultHtml();
        attachMobilePriceResultEvents();
      }
    });
    mobilePriceInput.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); mobileHandlePriceCode(mobilePriceInput.value); } });
  }
  attachMobilePriceResultEvents();
  document.getElementById('mobilePriceCamera')?.addEventListener('click',()=>{ unlockMobileScanSound(); openMobileCameraScanner(mobileHandlePriceCode,{continuous:true,hostId:'mobilePriceCameraSlot',buttonId:'mobilePriceCamera'}); });
  const mobileInspectionList=document.getElementById('mobileInspectionList');
  if(mobileInspectionList) mobileInspectionList.addEventListener('change',()=>{
    if(mobileInspectionSavedAddItems.length&&!confirm('ยังไม่ได้บันทึกสินค้าที่เพิ่ม ต้องการเปลี่ยนรายการและทิ้งสินค้าชุดนี้หรือไม่?')){
      mobileInspectionList.value=String(mobileInspectionListId||'');
      return;
    }
    resetMobileInspectionSavedAdd();
    mobileInspectionListId=mobileInspectionList.value;
    mobileInspectionOpenedListId='';
    mobileInspectionQuery=''; mobileInspectionLastProductId=null; mobileInspectionVisibleCount=25;
    render();
  });
  document.getElementById('mobileOpenInspectionList')?.addEventListener('click',()=>{
    const list=mobileInspectionCurrentList(); if(!list) return;
    resetMobileInspectionSavedAdd();
    mobileInspectionOpenedListId=list.id;
    mobileInspectionQuery=''; mobileInspectionLastProductId=null; mobileInspectionVisibleCount=25;
    render();
  });
  document.getElementById('mobileDeleteInspectionList')?.addEventListener('click',()=>{
    if(!mobileRequireOnline('ลบบันทึกรายการ')) return;
    const list=mobileInspectionCurrentList();
    if(list) deleteInspectionListById(list.id);
  });
  document.getElementById('mobileInspectionAddToggle')?.addEventListener('click',()=>{
    mobileInspectionAddingToSaved=true;
    mobileInspectionSavedAddQuery='';
    mobileInspectionSavedAddItems=[];
    mobileInspectionLastProductId=null;
    render();
  });
  document.getElementById('mobileInspectionAddClose')?.addEventListener('click',()=>{
    if(mobileInspectionSavedAddItems.length&&!confirm('ปิดและทิ้งสินค้าที่ยังไม่ได้บันทึกหรือไม่?')) return;
    closeMobileCameraScanner();
    resetMobileInspectionSavedAdd();
    render();
  });
  const mobileInspectionAddInput=document.getElementById('mobileInspectionAddInput');
  if(mobileInspectionAddInput){
    mobileInspectionAddInput.addEventListener('input',()=>{
      mobileInspectionSavedAddQuery=mobileInspectionAddInput.value;
      render();
      const input=document.getElementById('mobileInspectionAddInput');
      if(input){ input.focus(); input.selectionStart=input.selectionEnd=input.value.length; }
    });
    mobileInspectionAddInput.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); mobileHandleInspectionCode(mobileInspectionAddInput.value); } });
  }
  document.getElementById('mobileInspectionAddCamera')?.addEventListener('click',()=>{ unlockMobileScanSound(); openMobileCameraScanner(mobileHandleInspectionCode,{continuous:true,hostId:'mobileInspectionAddCameraSlot',buttonId:'mobileInspectionAddCamera'}); });
  document.querySelectorAll('[data-mobile-inspection-add-result]').forEach(button=>button.addEventListener('click',()=>{
    const product=products.find(entry=>Number(entry.id)===Number(button.dataset.mobileInspectionAddResult));
    if(product) addProductToMobileInspectionSavedDraft(product);
  }));
  document.querySelectorAll('[data-mobile-inspection-add-remove]').forEach(button=>button.addEventListener('click',()=>{
    mobileInspectionSavedAddItems.splice(Number(button.dataset.mobileInspectionAddRemove),1);
    render();
  }));
  document.getElementById('mobileInspectionAddSave')?.addEventListener('click',saveMobileInspectionSavedAdd);
  const mobileInspectionInput=document.getElementById('mobileInspectionInput');
  if(mobileInspectionInput){
    mobileInspectionInput.addEventListener('input',()=>{
      mobileInspectionQuery=mobileInspectionInput.value;
      mobileInspectionLastProductId=null;
      mobileInspectionVisibleCount=25;
      render();
      const input=document.getElementById('mobileInspectionInput');
      if(input){ input.focus(); input.selectionStart=input.selectionEnd=input.value.length; }
    });
    mobileInspectionInput.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); mobileHandleInspectionCode(mobileInspectionInput.value); } });
  }
  document.getElementById('mobileInspectionCamera')?.addEventListener('click',()=>{ unlockMobileScanSound(); openMobileCameraScanner(mobileHandleInspectionCode,{continuous:true,hostId:'mobileInspectionCameraSlot',buttonId:'mobileInspectionCamera'}); });
  document.getElementById('mobileNewInspectionList')?.addEventListener('click',startMobileInspectionDraft);
  document.getElementById('mobileCancelInspectionDraft')?.addEventListener('click',()=>{
    if((inspectionListDraft?.items||[]).length&&!confirm('ยกเลิกรายการนี้และทิ้งสินค้าที่เพิ่มไว้หรือไม่?')) return;
    cancelMobileInspectionDraft();
  });
  document.getElementById('mobileSaveInspectionDraft')?.addEventListener('click',saveMobileInspectionDraft);
  document.querySelectorAll('[data-mobile-draft-add]').forEach(button=>button.addEventListener('click',()=>{
    const product=products.find(entry=>Number(entry.id)===Number(button.dataset.mobileDraftAdd));
    if(product) addProductToMobileInspectionDraft(product);
  }));
  document.querySelectorAll('[data-mobile-draft-remove]').forEach(button=>button.addEventListener('click',()=>{
    if(!inspectionListDraft) return;
    inspectionListDraft.items.splice(Number(button.dataset.mobileDraftRemove),1);
    mobileInspectionLastProductId=null;
    render();
  }));
  document.querySelectorAll('[data-mobile-inspection-remove]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    const list=mobileInspectionCurrentList();
    if(list) removeProductFromMobileInspection(list.id,Number(button.dataset.mobileInspectionRemove));
  }));
  document.querySelectorAll('[data-mobile-inspection-item]').forEach(item=>item.addEventListener('click',()=>{
    const list=mobileInspectionCurrentList(); if(!list) return;
    const productId=Number(item.dataset.mobileInspectionItem),checked=mobileInspectionCheckedSet(list.id);
    if(checked.has(productId)) checked.delete(productId); else checked.add(productId);
    mobileInspectionLastProductId=productId;
    render();
  }));
  document.getElementById('mobileResetChecks')?.addEventListener('click',()=>{
    const list=mobileInspectionCurrentList();
    if(list) mobileInspectionCheckedSet(list.id).clear();
    mobileInspectionLastProductId=null; mobileInspectionQuery=''; render();
  });
  document.getElementById('mobileLoadMore')?.addEventListener('click',()=>{ mobileInspectionVisibleCount+=25; render(); });
  document.getElementById('mobileContinueToStock')?.addEventListener('click',()=>{
    const list=mobileInspectionCurrentList();
    if(!list) return;
    const progress=mobileInspectionProgress(list);
    if(progress.total&&progress.checked<progress.total&&!confirm(`ตรวจแล้ว ${progress.checked} จาก ${progress.total} รายการ ต้องการไปสรุปและแก้ไขสต๊อกตอนนี้หรือไม่?`)) return;
    mobileInventoryStep='stock';
    mobileStockSourceListId=list.id;
    if(!stockEditImportInspectionList(list.id,true)){
      mobileInventoryStep='inspection';
      render();
    }
  });
  const mobileStockSourceList=document.getElementById('mobileStockSourceList');
  if(mobileStockSourceList) mobileStockSourceList.addEventListener('change',()=>{ mobileStockSourceListId=mobileStockSourceList.value; });
  document.getElementById('mobileStockImport')?.addEventListener('click',()=>{
    const listId=mobileStockSourceList?.value||mobileStockSourceListId;
    if(listId){ mobileStockSourceListId=listId; stockEditImportInspectionList(listId,true); }
  });
  const mobileStockInput=document.getElementById('mobileStockInput');
  if(mobileStockInput){
    mobileStockInput.addEventListener('input',()=>{
      mobileStockQuery=mobileStockInput.value;
      mobileStockLastProductId=null;
      render();
      const input=document.getElementById('mobileStockInput');
      if(input){ input.focus(); input.selectionStart=input.selectionEnd=input.value.length; }
    });
    mobileStockInput.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); mobileHandleStockCode(mobileStockInput.value); } });
  }
  document.getElementById('mobileStockCamera')?.addEventListener('click',()=>{ unlockMobileScanSound(); openMobileCameraScanner(mobileHandleStockCode,{continuous:true,hostId:'mobileStockCameraSlot',buttonId:'mobileStockCamera'}); });
  document.querySelectorAll('[data-mobile-stock-result]').forEach(button=>button.addEventListener('click',()=>{
    const product=products.find(entry=>Number(entry.id)===Number(button.dataset.mobileStockResult));
    if(product) addProductToMobileStockEdit(product);
  }));
  document.querySelectorAll('[data-mobile-stock-remove]').forEach(button=>button.addEventListener('click',()=>{
    const productId=Number(button.dataset.mobileStockRemove);
    stockEditItems=stockEditItems.filter(itemId=>Number(itemId)!==productId);
    delete stockEditRowUnitSel[productId];
    delete stockEditDraftStocks[productId];
    delete stockEditLotSelections[productId];
    delete stockEditNewLotNumbers[productId];
    delete stockEditNewLotExpiries[productId];
    if(Number(mobileStockLastProductId)===productId) mobileStockLastProductId=null;
    render();
  }));
  document.querySelectorAll('[data-mobile-stock-unit]').forEach(select=>select.addEventListener('change',()=>{
    const productId=Number(select.dataset.mobileStockUnit);
    const product=products.find(entry=>Number(entry.id)===productId);
    if(!product) return;
    const selected=inspectionListUnitOptions(product).find(option=>option.name===select.value)||inspectionListUnitOptions(product)[0];
    stockEditRowUnitSel[productId]=selected?.name||product.unit;
    const amountInput=document.querySelector(`[data-mobile-stock-amount="${productId}"]`);
    if(!amountInput) return;
    const hasDraft=Object.prototype.hasOwnProperty.call(stockEditDraftStocks,productId);
    const baseStock=hasDraft?stockEditDraftStocks[productId]:product.stock;
    amountInput.dataset.factor=String(selected?.factor||1);
    amountInput.value=stockUnitAmountFromBase(baseStock,selected?.factor||1);
    amountInput.classList.toggle('pending',hasDraft);
  }));
  const refreshMobileStockConfirmButton=()=>{
    const button=document.getElementById('mobileConfirmStockEdit');
    const changes=stockEditPendingChanges();
    if(button) button.disabled=(changes.length===0&&!stockEditSourcePending)||!stockEditMobileLotSelectionsReady(changes)||Boolean(document.querySelector('[data-mobile-stock-new-expiry].invalid'))||stockEditPosting||!mobileIsOnline();
  };
  const mobileStockList=document.querySelector('.mobile-stock-list');
  if(mobileStockList){
    mobileStockList.addEventListener('change',event=>{
      const lotSelect=event.target.closest('[data-mobile-stock-lot]');
      if(!lotSelect) return;
      const productId=Number(lotSelect.dataset.mobileStockLot);
      stockEditLotSelections[productId]=lotSelect.value;
      refreshMobileStockLotControl(productId);
      refreshMobileStockConfirmButton();
    });
    mobileStockList.addEventListener('input',event=>{
      const lotNumberInput=event.target.closest('[data-mobile-stock-new-lot]');
      if(lotNumberInput){
        stockEditNewLotNumbers[Number(lotNumberInput.dataset.mobileStockNewLot)]=lotNumberInput.value;
        return;
      }
      const expiryInput=event.target.closest('[data-mobile-stock-new-expiry]');
      if(!expiryInput) return;
      const expiryText=expiryInput.value.trim();
      const iso=dmyToISO(expiryText);
      stockEditNewLotExpiries[Number(expiryInput.dataset.mobileStockNewExpiry)]=iso||'';
      expiryInput.classList.toggle('invalid',expiryText!==''&&!iso);
      refreshMobileStockConfirmButton();
    });
  }
  document.querySelectorAll('[data-mobile-stock-amount]').forEach(input=>{
    input.addEventListener('focus',()=>input.select());
    input.addEventListener('input',()=>{
      const product=products.find(entry=>Number(entry.id)===Number(input.dataset.mobileStockAmount));
      if(!product) return;
      const amountText=input.value.trim(),amount=Number(amountText);
      if(amountText===''||!Number.isFinite(amount)){
        delete stockEditDraftStocks[product.id];
        input.classList.remove('pending');
        refreshMobileStockLotControl(product.id);
        refreshMobileStockConfirmButton();
        return;
      }
      const newStock=stockBaseFromUnitAmount(amount,input.dataset.factor);
      if(newStock===Number(product.stock)) delete stockEditDraftStocks[product.id];
      else stockEditDraftStocks[product.id]=newStock;
      if(stockEditSourceInspectionListId&&newStock!==Number(product.stock)) stockEditSourcePending=true;
      input.classList.toggle('pending',newStock!==Number(product.stock));
      refreshMobileStockLotControl(product.id);
      refreshMobileStockConfirmButton();
    });
    input.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); input.blur(); } });
  });
  document.getElementById('mobileConfirmStockEdit')?.addEventListener('click',confirmMobileStockEditChanges);
  bindPasswordVisibilityToggles();
  bindPOSAddActions();
  const addCustomItemBtn=document.getElementById('addCustomItemBtn');
  if(addCustomItemBtn) addCustomItemBtn.addEventListener('click',addBlankCustomCartLine);
  document.querySelectorAll('[data-medicine-label-line]').forEach(button=>button.addEventListener('click',()=>openMedicineLabelEditor(button.dataset.medicineLabelLine)));
  document.querySelectorAll('[data-custom-name]').forEach(input=>{ input.addEventListener('input',()=>{ const line=cart.find(item=>item.lineId==input.dataset.line); if(line) line.name=input.value; }); });
  document.querySelectorAll('[data-custom-unit]').forEach(input=>{ input.addEventListener('input',()=>{ const line=cart.find(item=>item.lineId==input.dataset.line); if(line){ line.unit=input.value; line.unitName=input.value; } }); });
  document.querySelectorAll('[data-custom-price]').forEach(input=>{ input.addEventListener('input',()=>{ const line=cart.find(item=>item.lineId==input.dataset.line); if(!line) return; line.price=input.value===''?'':Math.max(0,parseFloat(input.value)||0); line.cost=line.price; const total=document.querySelector(`[data-line-total="${line.lineId}"]`); if(total) total.textContent=fmtMoney((Number(line.price)||0)*(Number(line.qty)||0)); recalcPOSCartDOM(); }); });
document.querySelectorAll('.line-qty').forEach(el=>{
  const getLine=()=>cart.find(x=>x.lineId==el.dataset.line);
  const updateCustomLive=()=>{
    const l=getLine();
    if(!l||!l.custom) return;
    const raw=el.value.trim();
    if(raw===''||raw==='-'||raw==='+'||raw==='.') return;
    const v=parseFloat(raw);
    if(!Number.isFinite(v)||v<=0) return;
    l.qty=v;
    const total=document.querySelector(`[data-line-total="${l.lineId}"]`);
    if(total) total.textContent=fmtMoney((Number(l.price)||0)*v);
    recalcPOSCartDOM();
  };
  const commit=()=>{
    const l=getLine();
    if(!l) return;
    let v=parseFloat(el.value);
    if(!Number.isFinite(v)||v<=0) v=1;
    if(!l.custom) v=Math.max(1,Math.floor(v));
    l.qty=v;
    el.value=v;
    if(l.custom){
      const total=document.querySelector(`[data-line-total="${l.lineId}"]`);
      if(total) total.textContent=fmtMoney((Number(l.price)||0)*v);
      recalcPOSCartDOM();
    } else render();
  };
  if(getLine()?.custom) el.addEventListener('input',updateCustomLive);
  el.addEventListener('change', commit);
  el.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); commit(); const s=document.getElementById('search'); if(s) s.focus(); } });
});
  document.querySelectorAll('[data-act="removeline"]').forEach(el=>{ el.addEventListener('click', ()=>{ const target=cart.find(x=>x.lineId==el.dataset.line); if(target?.autoFreeFromPromo){ showToast('เป็นของแถม — ลดจำนวนสินค้าหลักเพื่อเอาออก'); return; } cart=cart.filter(x=>x.lineId!=el.dataset.line); render(); }); });
  // เปลี่ยนหน่วยของบรรทัดในบิล
  document.querySelectorAll('.line-unit').forEach(el=>{
    el.addEventListener('change', ()=>{
      const l=cart.find(x=>x.lineId==el.dataset.line); if(!l) return;
      const p=products.find(x=>x.id===l.pid); const opt=productUnitOptions(p).find(o=>o.name===el.value);
      if(opt){ l.unit=opt.name; l.unitName=opt.name; l.cost=opt.cost; l.factor=opt.factor; l.priceSource='standard'; applySalePriceToLine(l,p,opt.name,{preserveQuotation:false}); render(); }
    });
  });
  const searchEl = document.getElementById('search');
  if(searchEl) searchEl.dataset.startingValue=String(searchEl.value||'').trim();
  if(searchEl&&!searchEl.dataset.searchBound){
    searchEl.dataset.searchBound='1';
    searchEl.addEventListener('keydown',e=>{
      if(currentTab!=='products'||e.isComposing) return;
      if(e.key==='Enter'){
        const productSearchStartingValue=searchEl.dataset.startingValue||'';
        const currentValue=String(searchEl.value||'').trim();
        const knownSuffix=[...exactProductCodeMap.keys()]
          .filter(code=>String(code).length>=4&&currentValue.endsWith(String(code)))
          .sort((left,right)=>String(right).length-String(left).length)[0]||'';
        const appendedValue=currentValue.startsWith(productSearchStartingValue)&&currentValue.length>productSearchStartingValue.length
          ?currentValue.slice(productSearchStartingValue.length).trim()
          :(currentValue!==productSearchStartingValue?currentValue:'');
        const scannerValue=knownSuffix||(/^[A-Za-z0-9._/+:-]{4,}$/.test(appendedValue)?appendedValue:'');
        if(!scannerValue) return;
        e.preventDefault();
        clearTimeout(listSearchRenderTimer);
        searchQuery=scannerValue;
        productPage=1;
        selectProductListUnitByExactCode(scannerValue);
        searchEl.value=scannerValue;
        render();
        const nextSearch=document.getElementById('search');
        if(nextSearch){ nextSearch.focus({preventScroll:true}); nextSearch.select(); }
        return;
      }
    });
    searchEl.addEventListener('input',e=>{
      searchQuery=e.target.value;
      productPage=1;
      if(['contacts','customers'].includes(currentTab)) contactPage=1;
      if(currentTab!=='checkout'){
        if(e.isComposing) return;
        clearTimeout(listSearchRenderTimer);
        const searchTab=currentTab;
        listSearchRenderTimer=setTimeout(()=>{
          if(currentTab!==searchTab||document.getElementById('search')!==searchEl) return;
          const selectionStart=searchEl.selectionStart,selectionEnd=searchEl.selectionEnd;
          if(searchTab==='products') selectProductListUnitByExactCode(searchQuery);
          render();
          restoreSearchInputFocus(selectionStart,selectionEnd);
        },120);
        return;
      }
      clearTimeout(posSearchRenderTimer);
      posSearchRenderTimer=setTimeout(refreshPOSSearchResults,60);
    });
    if(currentTab==='checkout') searchEl.addEventListener('keydown', e=>{
      if(e.key==='Enter'){
        const q=searchQuery.trim(); if(!q) return;
        if(isPosSmallestUnitCommand(q)){
          e.preventDefault();
          posSmallestUnitOnce=true; searchQuery=''; render();
          setTimeout(()=>document.getElementById('search')?.focus(),0);
          showToast('พร้อมแล้ว — ยิงสินค้ารายการถัดไปเพื่อขายเป็นหน่วยเล็กสุด');
          return;
        }
        // พิมพ์ *N เพื่อล็อกจำนวนล่วงหน้า เช่น *10
        const qtyMatch = q.match(/^\*\s*(\d+)$/);
        if(qtyMatch){ pendingQty = Math.max(1, parseInt(qtyMatch[1])||1); searchQuery=''; render(); const s=document.getElementById('search'); if(s){ s.focus(); s.placeholder=`× ${pendingQty} — ยิงบาร์โค้ด/พิมพ์รหัสสินค้าถัดไป`; } showToast(`ล็อกจำนวน × ${pendingQty} ไว้แล้ว`); return; }
        // ค้นหาสินค้า: บาร์โค้ดตรงเป๊ะก่อน (รวมบาร์โค้ดของหน่วยย่อยเช่นกล่อง/ลัง) แล้วค่อยชื่อ/รหัส
        const exactHit=findProductByExactCode(q);
        if(exactHit){ addToCart(exactHit.product.id, consumePosSaleUnit(exactHit.product,exactHit.unitName), pendingQty); checkNegativeStockToast(exactHit.product.id); pendingQty=1; searchQuery=''; render(); const s=document.getElementById('search'); if(s) s.focus(); return; }
        const list = activeProducts().filter(p=>p.name.toLowerCase().includes(q.toLowerCase())||matchesBarcode(p,q)||(p.sku||'').toLowerCase().includes(q.toLowerCase()));
        if(list.length>=1){ const p=list[0]; addToCart(p.id, consumePosSaleUnit(p,null), pendingQty); checkNegativeStockToast(p.id); pendingQty=1; searchQuery=''; render(); const s=document.getElementById('search'); if(s) s.focus(); }
      }
    });
    // แสดงจำนวนที่ล็อกไว้ใน placeholder ถ้ามี
    if(pendingQty>1 && !searchQuery) searchEl.placeholder = `× ${pendingQty} — ยิงบาร์โค้ด/พิมพ์รหัสสินค้าถัดไป`;
  }
  document.getElementById('posSmallestUnitBtn')?.addEventListener('click',()=>setPosSmallestUnitOnce(!posSmallestUnitOnce));
  document.getElementById('openCustomerPickerBtn')?.addEventListener('click',openPOSCustomerPicker);
  const checkoutBtn = document.getElementById('checkoutBtn');
  if(checkoutBtn) checkoutBtn.addEventListener('click', openPaymentModal);
  // --- top action buttons ---
  const favBtn = document.getElementById('favBtn');
  if(favBtn) favBtn.addEventListener('click', ()=>{ showFavorites=!showFavorites; render(); });
  const manageFavBtn = document.getElementById('manageFavBtn');
  if(manageFavBtn) manageFavBtn.addEventListener('click', openManageFavModal);
  const priceCheckBtn = document.getElementById('priceCheckBtn');
  if(priceCheckBtn) priceCheckBtn.addEventListener('click', openPriceCheckModal);
  // --- รายการตรวจสินค้า: สร้างรายการบันทึกและเพิ่มสินค้าด้วยค้นหา/สแกน ---
  const newInspectionListBtn=document.getElementById('newInspectionListBtn');
  if(newInspectionListBtn) newInspectionListBtn.addEventListener('click',()=>openInspectionListEditor('new'));
  const deleteSelectedInspectionListsBtn=document.getElementById('deleteSelectedInspectionListsBtn');
  if(deleteSelectedInspectionListsBtn) deleteSelectedInspectionListsBtn.addEventListener('click',deleteSelectedInspectionLists);
  document.querySelectorAll('[data-inspection-overview-sort]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.inspectionOverviewSort;
    if(inspectionListOverviewSort.key===key) inspectionListOverviewSort.dir*=-1;
    else inspectionListOverviewSort={key,dir:key==='status'?1:-1};
    render();
  }));
  const inspectionListSelectAll=document.getElementById('inspectionListSelectAll');
  if(inspectionListSelectAll) inspectionListSelectAll.addEventListener('change',()=>{
    inspectionListOverviewSortedLists().forEach(list=>{
      const id=String(list.id);
      if(inspectionListSelectAll.checked) inspectionListOverviewSelectedIds.add(id);
      else inspectionListOverviewSelectedIds.delete(id);
    });
    render();
  });
  document.querySelectorAll('[data-inspection-list-select]').forEach(input=>input.addEventListener('change',()=>{
    const id=String(input.dataset.inspectionListSelect);
    if(input.checked) inspectionListOverviewSelectedIds.add(id);
    else inspectionListOverviewSelectedIds.delete(id);
    render();
  }));
  document.querySelectorAll('[data-open-inspection-list]').forEach(button=>button.addEventListener('click',()=>openInspectionListEditor(button.dataset.openInspectionList)));
  document.querySelectorAll('[data-delete-inspection-list]').forEach(button=>button.addEventListener('click',()=>{
    deleteInspectionListById(button.dataset.deleteInspectionList);
  }));
  const cancelInspectionListBtn=document.getElementById('cancelInspectionListBtn');
  if(cancelInspectionListBtn) cancelInspectionListBtn.addEventListener('click',()=>{ editingInspectionListId=null; inspectionListDraft=null; inspectionListSearchQuery=''; inspectionListCatFilter={wh:'',category:'',brand:''}; inspectionListPage=1; render(); });
  const saveInspectionListBtn=document.getElementById('saveInspectionListBtn');
  if(saveInspectionListBtn) saveInspectionListBtn.addEventListener('click',saveInspectionListDraft);
  const inspectionListName=document.getElementById('inspectionListName');
  if(inspectionListName) inspectionListName.addEventListener('input',()=>{ if(inspectionListDraft) inspectionListDraft.name=inspectionListName.value; });
  const inspectionListWarehouse=document.getElementById('inspectionListWarehouse');
  const inspectionListCategory=document.getElementById('inspectionListCategory');
  const inspectionListBrand=document.getElementById('inspectionListBrand');
  const inspectionListAddCategoryBtn=document.getElementById('inspectionListAddCategoryBtn');
  if(inspectionListWarehouse) inspectionListWarehouse.addEventListener('change',()=>{ inspectionListCatFilter.wh=inspectionListWarehouse.value; if(inspectionListDraft) inspectionListDraft.warehouseId=Number(inspectionListWarehouse.value)||Number(activeWarehouseId); inspectionListPage=1; render(); });
  if(inspectionListCategory) inspectionListCategory.addEventListener('change',()=>{ inspectionListCatFilter.category=inspectionListCategory.value; inspectionListCatFilter.brand=''; render(); });
  if(inspectionListBrand) inspectionListBrand.addEventListener('change',()=>{ inspectionListCatFilter.brand=inspectionListBrand.value; render(); });
  if(inspectionListAddCategoryBtn) inspectionListAddCategoryBtn.addEventListener('click',()=>openInspectionListCategoryPicker(inspectionListCatFilter));
  const inspectionListSearch=document.getElementById('inspectionListSearch');
  const inspectionListResults=document.getElementById('inspectionListResults');
  if(inspectionListSearch&&inspectionListResults){
    const addProduct=(product,unitName)=>{
      const added=inspectionListAddProduct(product,unitName);
      inspectionListSearchQuery='';
      if(!added&&product) showToast('สินค้านี้อยู่ในรายการแล้ว ระบบเลือกหน่วยล่าสุดให้แล้ว');
      render(); setTimeout(()=>document.getElementById('inspectionListSearch')?.focus(),0);
    };
    const showResults=query=>{
      inspectionListSearchQuery=query;
      const value=String(query||'').trim();
      if(!value){ inspectionListResults.hidden=true; inspectionListResults.innerHTML=''; return; }
      const lower=value.toLowerCase();
      const matches=activeProducts().filter(product=>(product.name.toLowerCase().includes(lower)||(product.sku||'').toLowerCase().includes(lower)||matchesBarcode(product,value))).slice(0,15);
      if(!matches.length){ inspectionListResults.innerHTML='<div class="fav-add-noresult">ไม่พบสินค้า</div>'; inspectionListResults.hidden=false; return; }
      inspectionListResults.innerHTML=matches.map(product=>`<div class="fav-add-result" data-inspection-result="${product.id}"><b>${escapeHtml(product.name)}</b><span>${escapeHtml(product.sku||'-')} · คงเหลือ ${escapeHtml(stockInLargestUnit(product))}${inspectionListDraft?.items.some(item=>Number(item.pid)===Number(product.id))?' · อยู่ในรายการแล้ว':''}</span></div>`).join('');
      inspectionListResults.hidden=false;
      inspectionListResults.querySelectorAll('[data-inspection-result]').forEach(row=>{
        row.addEventListener('mousedown',event=>event.preventDefault());
        row.addEventListener('click',()=>addProduct(products.find(product=>product.id===Number(row.dataset.inspectionResult))));
      });
    };
    inspectionListSearch.addEventListener('input',()=>showResults(inspectionListSearch.value));
    inspectionListSearch.addEventListener('focus',()=>{ if(inspectionListSearch.value.trim()) showResults(inspectionListSearch.value); });
    inspectionListSearch.addEventListener('blur',()=>setTimeout(()=>{ inspectionListResults.hidden=true; },150));
    inspectionListSearch.addEventListener('keydown',event=>{
      if(event.key!=='Enter') return;
      event.preventDefault();
      const value=inspectionListSearch.value.trim(); if(!value) return;
      const exact=findProductByExactCode(value);
      if(exact){ addProduct(exact.product,exact.unitName); return; }
      const first=inspectionListResults.querySelector('[data-inspection-result]');
      if(first) addProduct(products.find(product=>product.id===Number(first.dataset.inspectionResult)));
    });
  }
  document.querySelectorAll('[data-inspection-unit]').forEach(select=>select.addEventListener('change',()=>{
    const item=inspectionListDraft?.items[Number(select.dataset.inspectionUnit)];
    if(item){ item.unit=select.value; render(); }
  }));
  document.querySelectorAll('[data-inspection-remove]').forEach(button=>button.addEventListener('click',()=>{
    if(!inspectionListDraft) return;
    inspectionListDraft.items.splice(Number(button.dataset.inspectionRemove),1); render();
  }));
  document.querySelectorAll('[data-inspection-sort]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.inspectionSort;
    if(!['sku','barcode','name','stock'].includes(key)) return;
    inspectionListSort=inspectionListSort.key===key?{key,dir:inspectionListSort.dir===1?-1:1}:{key,dir:1};
    inspectionListPage=1;
    render();
  }));
  document.querySelectorAll('[data-inspection-list-page]').forEach(button=>button.addEventListener('click',()=>{
    const value=button.dataset.inspectionListPage;
    const totalPages=Math.max(1,Math.ceil((inspectionListDraft?.items.length||0)/INSPECTION_LIST_PAGE_SIZE));
    if(value==='prev') inspectionListPage=Math.max(1,inspectionListPage-1);
    else if(value==='next') inspectionListPage=Math.min(totalPages,inspectionListPage+1);
    else inspectionListPage=Math.min(totalPages,Math.max(1,Number(value)||1));
    render();
  }));
  const printStockReportBtn = document.getElementById('printStockReportBtn');
  if(printStockReportBtn) printStockReportBtn.addEventListener('click', printStockReport);
  const printLowStockBtn = document.getElementById('printLowStockBtn');
  if(printLowStockBtn) printLowStockBtn.addEventListener('click', ()=>printStockAlertReport('stock'));
  const printExpiryBtn = document.getElementById('printExpiryBtn');
  if(printExpiryBtn) printExpiryBtn.addEventListener('click', ()=>printStockAlertReport('expiry'));
  const resetStockReportBtn = document.getElementById('resetStockReportBtn');
  if(resetStockReportBtn) resetStockReportBtn.addEventListener('click', ()=>{
    if(!stockReportItems.length){ showToast('ยังไม่มีข้อมูลให้รีเซ็ต'); return; }
    if(!confirm('ต้องการล้างรายการทั้งหมดในรายงานนี้ใช่หรือไม่?')) return;
    stockReportItems=[]; stockReportCatFilter={wh:'', category:'', brand:''};
    showToast('รีเซ็ตข้อมูลแล้ว'); render();
  });
  // ค้นหา/สแกนสินค้าเพื่อเพิ่มลงรายงานสินค้าคงเหลือ (หน้า inline ไม่ใช่ modal)
  const srInput=document.getElementById('srInput');
  const srResults=document.getElementById('srResults');
  const srTbody=document.getElementById('srTbody');
  const srSelectedWrap=document.getElementById('stockReportSelectedWrap');
  if(srInput && srTbody){
    const refreshSrTable=()=>{
      srTbody.innerHTML=stockReportRowsHtml();
      if(srSelectedWrap) srSelectedWrap.innerHTML=stockReportSelectedItemsHtml();
      srTbody.querySelectorAll('[data-sr-remove]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const pid=Number(btn.dataset.srRemove);
          stockReportItems=stockReportItems.filter(r=>r.pid!==pid);
          refreshSrTable();
        });
      });
    };
    refreshSrTable();
    [['srShowSku','sku'],['srShowBarcode','barcode'],['srShowPrice','price'],['srShowCost','cost']].forEach(([id,key])=>{
      document.getElementById(id)?.addEventListener('change',event=>{
        stockReportColumns[key]=event.target.checked;
        try{ localStorage.setItem(STOCK_REPORT_COLUMNS_KEY,JSON.stringify(stockReportColumns)); }catch(error){}
        render();
      });
    });
    if(srSelectedWrap) srSelectedWrap.addEventListener('click', event=>{
      const removeButton=event.target.closest('[data-sr-chip-remove]');
      if(removeButton){
        stockReportItems=stockReportItems.filter(row=>row.pid!==Number(removeButton.dataset.srChipRemove));
        refreshSrTable();
        return;
      }
      if(event.target.closest('#srClearSelected')){
        stockReportItems=[];
        refreshSrTable();
      }
    });
    const addSrProduct=(p)=>{
      if(stockReportItems.some(r=>r.pid===p.id)) return;
      const warehouseValue=String(stockReportCatFilter.wh||(isAllWarehousesMode()?'all':activeWarehouseId));
      stockReportItems.unshift({pid:p.id, name:p.name, stock:reportStock(p.id,warehouseValue), unit:p.unit, expiry:reportExpiry(p.id,warehouseValue), wh:warehouseValue});
      refreshSrTable();
    };
    // เลือกหมวดสินค้าหลัก/ย่อย แล้วเพิ่มสินค้าทั้งหมวดในคราวเดียว
    const srWarehouseSelect=document.getElementById('srWarehouseSelect');
    const srCategorySelect=document.getElementById('srCategorySelect');
    const srBrandSelect=document.getElementById('srBrandSelect');
    const srAddByCategoryBtn=document.getElementById('srAddByCategoryBtn');
    if(srWarehouseSelect) srWarehouseSelect.addEventListener('change', ()=>{ stockReportCatFilter.wh=srWarehouseSelect.value; stockReportItems=[]; render(); });
    if(srCategorySelect) srCategorySelect.addEventListener('change', ()=>{ stockReportCatFilter.category=srCategorySelect.value; stockReportCatFilter.brand=''; render(); });
    if(srBrandSelect) srBrandSelect.addEventListener('change', ()=>{ stockReportCatFilter.brand=srBrandSelect.value; render(); });
    if(srAddByCategoryBtn) srAddByCategoryBtn.addEventListener('click', ()=>{
      openStockReportCategoryPicker(stockReportCatFilter, refreshSrTable);
    });
    const renderSrResults=(q)=>{
      q=(q||'').trim();
      if(!q){ srResults.hidden=true; srResults.innerHTML=''; return; }
      const ql=q.toLowerCase();
      const matches=products.filter(p=>stockReportProductMatchesFilter(p,stockReportCatFilter)&&(p.name.toLowerCase().includes(ql) || (p.sku||'').toLowerCase().includes(ql) || p.barcode===q || (p.extraBarcodes||[]).includes(q) || (p.vendorBarcodes||[]).some(v=>v.code===q) || (p.units||[]).some(u=>u.barcode===q))).slice(0,15);
      if(!matches.length){ srResults.innerHTML='<div class="fav-add-noresult">ไม่พบสินค้า</div>'; srResults.hidden=false; return; }
      const warehouseValue=String(stockReportCatFilter.wh||(isAllWarehousesMode()?'all':activeWarehouseId));
      srResults.innerHTML=matches.map(p=>`<div class="fav-add-result" data-pid="${escapeHtml(p.id)}"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.sku||'-')} · คงเหลือ ${escapeHtml(reportStock(p.id,warehouseValue))} ${escapeHtml(p.unit||'')}${warehouseValue==='all'?' · รวมทุกคลัง':''}</span></div>`).join('');
      srResults.hidden=false;
      srResults.querySelectorAll('.fav-add-result').forEach(el=>{
        el.addEventListener('mousedown', e=>e.preventDefault());
        el.addEventListener('click', ()=>{
          const p=products.find(x=>x.id===Number(el.dataset.pid)); if(p) addSrProduct(p);
          srInput.value=''; srResults.hidden=true; srResults.innerHTML=''; srInput.focus();
        });
      });
    };
    const trySrExact=(q)=>{
      const exact=products.find(p=>stockReportProductMatchesFilter(p,stockReportCatFilter)&&(p.barcode===q||(p.extraBarcodes||[]).includes(q)||(p.vendorBarcodes||[]).some(v=>v.code===q)||p.sku===q||(p.units||[]).some(u=>u.barcode===q)));
      if(exact){ addSrProduct(exact); srInput.value=''; srResults.hidden=true; return true; }
      return false;
    };
    srInput.addEventListener('input', ()=>renderSrResults(srInput.value));
    srInput.addEventListener('keydown', e=>{
      if(e.key==='Enter'){
        e.preventDefault();
        const q=srInput.value.trim(); if(!q) return;
        if(trySrExact(q)) return;
        const first=srResults.querySelector('.fav-add-result');
        if(first){ const p=products.find(x=>x.id===Number(first.dataset.pid)); if(p) addSrProduct(p); srInput.value=''; srResults.hidden=true; }
      }
    });
    srInput.addEventListener('blur', ()=>setTimeout(()=>{ srResults.hidden=true; },150));
  }
  // --- หน้าพิมพ์ป้ายราคา: เลือกสินค้า กำหนดรหัส/หน่วย/จำนวนป้าย แล้วบันทึกพร้อมพิมพ์ ---
  const barcodePrintCategorySelect=document.getElementById('barcodePrintCategorySelect');
  const barcodePrintBrandSelect=document.getElementById('barcodePrintBrandSelect');
  const barcodePrintAddCategoryBtn=document.getElementById('barcodePrintAddCategoryBtn');
  const barcodePrintAddMissingBtn=document.getElementById('barcodePrintAddMissingBtn');
  const barcodePrintLabelSizeSelect=document.getElementById('barcodePrintLabelSize');
  const barcodePrintSearch=document.getElementById('barcodePrintSearch');
  const barcodePrintResults=document.getElementById('barcodePrintResults');
  const openPriceLabelDesignerBtn=document.getElementById('openPriceLabelDesignerBtn');
  const clearBarcodePrintBtn=document.getElementById('clearBarcodePrintBtn');
  const savePrintBarcodeBtn=document.getElementById('savePrintBarcodeBtn');
  if(barcodePrintCategorySelect) barcodePrintCategorySelect.addEventListener('change',()=>{ barcodePrintCatFilter.category=barcodePrintCategorySelect.value; barcodePrintCatFilter.brand=''; render(); });
  if(barcodePrintBrandSelect) barcodePrintBrandSelect.addEventListener('change',()=>{ barcodePrintCatFilter.brand=barcodePrintBrandSelect.value; render(); });
  if(barcodePrintAddCategoryBtn) barcodePrintAddCategoryBtn.addEventListener('click',()=>openBarcodePrintCategoryPicker(barcodePrintCatFilter,false));
  if(barcodePrintAddMissingBtn) barcodePrintAddMissingBtn.addEventListener('click',()=>openBarcodePrintCategoryPicker({category:'',brand:''},true));
  if(barcodePrintLabelSizeSelect) barcodePrintLabelSizeSelect.addEventListener('change',()=>{ barcodePrintLabelSize=barcodePrintLabelSizeSelect.value; });
  if(openPriceLabelDesignerBtn) openPriceLabelDesignerBtn.addEventListener('click',()=>openPriceLabelDesigner(barcodePrintLabelSize));
  if(clearBarcodePrintBtn) clearBarcodePrintBtn.addEventListener('click',()=>{
    if(!confirm('ต้องการล้างรายการพิมพ์ป้ายราคาทั้งหมดใช่หรือไม่?')) return;
    barcodePrintItems=[]; barcodePrintSearchQuery=''; barcodePrintCatFilter={category:'',brand:''}; barcodePrintPage=1; render();
  });
  if(barcodePrintSearch&&barcodePrintResults){
    const addProduct=product=>{
      const added=barcodePrintAddProduct(product);
      showToast(added?`เพิ่ม “${product.name}” ในรายการแล้ว`:'สินค้านี้อยู่ในรายการแล้ว');
      barcodePrintSearchQuery='';
      render();
      setTimeout(()=>document.getElementById('barcodePrintSearch')?.focus(),0);
    };
    const showResults=query=>{
      barcodePrintSearchQuery=query;
      const value=String(query||'').trim();
      if(!value){ barcodePrintResults.hidden=true; barcodePrintResults.innerHTML=''; return; }
      const matches=products.filter(product=>barcodePrintMatchesQuery(product,value)).slice(0,15);
      if(!matches.length){ barcodePrintResults.innerHTML='<div class="fav-add-noresult">ไม่พบสินค้า</div>'; barcodePrintResults.hidden=false; return; }
      barcodePrintResults.innerHTML=matches.map(product=>{
        const missing=barcodePrintUnitOptions(product).filter(option=>!option.barcode).length;
        return `<div class="fav-add-result" data-barcode-print-result="${product.id}"><b>${escapeHtml(product.name)}</b><span>${escapeHtml(product.sku||'-')} · ${missing?`ไม่มีบาร์โค้ด ${missing} หน่วย`:'มีบาร์โค้ดแล้ว'}${barcodePrintFindProductItem(product.id)?' · อยู่ในรายการแล้ว':''}</span></div>`;
      }).join('');
      barcodePrintResults.hidden=false;
      barcodePrintResults.querySelectorAll('[data-barcode-print-result]').forEach(row=>{
        row.addEventListener('mousedown',event=>event.preventDefault());
        row.addEventListener('click',()=>addProduct(products.find(product=>product.id===Number(row.dataset.barcodePrintResult))));
      });
    };
    barcodePrintSearch.addEventListener('input',()=>showResults(barcodePrintSearch.value));
    barcodePrintSearch.addEventListener('focus',()=>{ if(barcodePrintSearch.value.trim()) showResults(barcodePrintSearch.value); });
    barcodePrintSearch.addEventListener('blur',()=>setTimeout(()=>{ barcodePrintResults.hidden=true; },150));
    barcodePrintSearch.addEventListener('keydown',event=>{
      if(event.key!=='Enter') return;
      event.preventDefault();
      const value=barcodePrintSearch.value.trim(); if(!value) return;
      const exact=products.find(product=>String(product.sku||'')===value||barcodePrintBarcodeOwners().some(owner=>owner.pid===product.id&&owner.code===value));
      if(exact){ addProduct(exact); return; }
      const first=barcodePrintResults.querySelector('[data-barcode-print-result]');
      if(first) addProduct(products.find(product=>product.id===Number(first.dataset.barcodePrintResult)));
    });
  }
  document.querySelectorAll('[data-barcode-print-unit]').forEach(select=>select.addEventListener('change',()=>{
    const index=Number(select.dataset.barcodePrintUnit);
    const item=barcodePrintItems[index];
    const product=products.find(entry=>entry.id===item?.pid); if(!item||!product) return;
    item.unit=select.value;
    const option=barcodePrintUnitOptions(product).find(entry=>entry.name===item.unit);
    item.barcode=option?.barcode||generateInternalBarcode(product,item.unit);
    render();
  }));
  document.querySelectorAll('[data-barcode-print-code]').forEach(input=>{
    input.addEventListener('focus',()=>input.select());
    input.addEventListener('input',()=>{ const item=barcodePrintItems[Number(input.dataset.barcodePrintCode)]; if(item){ item.barcode=input.value; input.classList.remove('invalid'); } });
  });
  document.querySelectorAll('[data-barcode-print-qty]').forEach(input=>{
    input.addEventListener('focus',()=>input.select());
    input.addEventListener('input',()=>{ const item=barcodePrintItems[Number(input.dataset.barcodePrintQty)]; if(item) item.qty=input.value; });
  });
  document.querySelectorAll('[data-barcode-print-remove]').forEach(button=>button.addEventListener('click',()=>{ barcodePrintItems.splice(Number(button.dataset.barcodePrintRemove),1); render(); }));
  document.querySelectorAll('[data-barcode-print-page]').forEach(button=>button.addEventListener('click',()=>{
    const value=button.dataset.barcodePrintPage;
    const totalPages=Math.max(1,Math.ceil(barcodePrintItems.length/BARCODE_PRINT_PAGE_SIZE));
    if(value==='prev') barcodePrintPage=Math.max(1,barcodePrintPage-1);
    else if(value==='next') barcodePrintPage=Math.min(totalPages,barcodePrintPage+1);
    else barcodePrintPage=Math.min(totalPages,Math.max(1,Number(value)||1));
    render();
  }));
  if(savePrintBarcodeBtn) savePrintBarcodeBtn.addEventListener('click',async ()=>{
    const errors=barcodePrintValidation(barcodePrintItems);
    document.querySelectorAll('.barcode-print-code-input').forEach(input=>input.classList.remove('invalid'));
    if(errors.length){
      errors.forEach(error=>document.querySelector(`[data-barcode-print-code="${error.index}"]`)?.classList.add('invalid'));
      alert(`ยังไม่สามารถบันทึกและพิมพ์ได้\n\n${errors.slice(0,8).map(error=>error.message).join('\n')}${errors.length>8?`\nและอีก ${errors.length-8} จุด`:''}`);
      return;
    }
    const printWindow=window.open('','_blank');
    if(!printWindow){ showToast('เบราว์เซอร์บล็อกหน้าพิมพ์ กรุณาอนุญาต Pop-up แล้วลองใหม่'); return; }
    await saveBarcodePrintItems(printWindow);
  });
  // --- หน้าแก้ไขสต๊อก: เลือก/ค้นหาสินค้า และแก้จำนวนตามหน่วยในตารางโดยตรง ---
  const stockEditCategorySelect=document.getElementById('stockEditCategorySelect');
  const stockEditBrandSelect=document.getElementById('stockEditBrandSelect');
  const stockEditAddByCategoryBtn=document.getElementById('stockEditAddByCategoryBtn');
  const stockEditInput=document.getElementById('stockEditInput');
  const stockEditResults=document.getElementById('stockEditResults');
  const confirmStockEditBtn=document.getElementById('confirmStockEditBtn');
  const clearStockEditBtn=document.getElementById('clearStockEditBtn');
  const importInspectionListBtn=document.getElementById('importInspectionListBtn');
  if(importInspectionListBtn) importInspectionListBtn.addEventListener('click',openStockEditInspectionListPicker);
  if(stockEditCategorySelect) stockEditCategorySelect.addEventListener('change',()=>{ stockEditCatFilter.category=stockEditCategorySelect.value; stockEditCatFilter.brand=''; render(); });
  if(stockEditBrandSelect) stockEditBrandSelect.addEventListener('change',()=>{ stockEditCatFilter.brand=stockEditBrandSelect.value; render(); });
  if(stockEditAddByCategoryBtn) stockEditAddByCategoryBtn.addEventListener('click',()=>openStockEditCategoryPicker(stockEditCatFilter));
  if(clearStockEditBtn) clearStockEditBtn.addEventListener('click',()=>{
    if(!confirm('ต้องการล้างรายการสินค้าในหน้าแก้ไขสต๊อกใช่หรือไม่?')) return;
    stockEditItems=[]; stockEditRowUnitSel={}; stockEditDraftStocks={}; stockEditSearchQuery=''; stockEditCatFilter={category:'',brand:''}; stockEditPage=1; stockEditSourceInspectionListId=null; stockEditSourcePending=false; stockEditLotSelections={}; stockEditNewLotNumbers={}; stockEditNewLotExpiries={}; render();
  });
  if(stockEditInput&&stockEditResults){
    const addProduct=p=>{
      if(stockEditItems.includes(p.id)){ showToast('สินค้านี้อยู่ในรายการแล้ว'); }
      else { stockEditItems.unshift(p.id); stockEditPage=1; }
      stockEditSearchQuery='';
      render();
      setTimeout(()=>document.getElementById('stockEditInput')?.focus(),0);
    };
    const showResults=query=>{
      stockEditSearchQuery=query;
      const q=String(query||'').trim();
      if(!q){ stockEditResults.hidden=true; stockEditResults.innerHTML=''; return; }
      const matches=products.filter(p=>stockEditMatchesQuery(p,q)).slice(0,15);
      if(!matches.length){ stockEditResults.innerHTML='<div class="fav-add-noresult">ไม่พบสินค้า</div>'; stockEditResults.hidden=false; return; }
      stockEditResults.innerHTML=matches.map(p=>`<div class="fav-add-result" data-stock-edit-result="${p.id}"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.sku||'-')} · ${escapeHtml(p.barcode||'ไม่มีบาร์โค้ด')} · คงเหลือ ${escapeHtml(stockInLargestUnit(p))}${stockEditItems.includes(p.id)?' · อยู่ในรายการแล้ว':''}</span></div>`).join('');
      stockEditResults.hidden=false;
      stockEditResults.querySelectorAll('[data-stock-edit-result]').forEach(row=>{
        row.addEventListener('mousedown',event=>event.preventDefault());
        row.addEventListener('click',()=>{ const p=products.find(x=>x.id===Number(row.dataset.stockEditResult)); if(p) addProduct(p); });
      });
    };
    const tryExact=query=>{
      const q=String(query||'').trim();
      const exact=products.find(p=>String(p.sku||'')===q||matchesBarcode(p,q));
      if(exact){ addProduct(exact); return true; }
      return false;
    };
    stockEditInput.addEventListener('input',()=>showResults(stockEditInput.value));
    stockEditInput.addEventListener('focus',()=>{ if(stockEditInput.value.trim()) showResults(stockEditInput.value); });
    stockEditInput.addEventListener('blur',()=>setTimeout(()=>{ stockEditResults.hidden=true; },150));
    stockEditInput.addEventListener('keydown',event=>{
      if(event.key!=='Enter') return;
      event.preventDefault();
      const q=stockEditInput.value.trim(); if(!q) return;
      if(tryExact(q)) return;
      const first=stockEditResults.querySelector('[data-stock-edit-result]');
      if(first){ const p=products.find(x=>x.id===Number(first.dataset.stockEditResult)); if(p) addProduct(p); }
    });
  }
  document.querySelectorAll('[data-stock-edit-unit]').forEach(select=>select.addEventListener('change',()=>{ stockEditRowUnitSel[Number(select.dataset.stockEditUnit)]=select.value; render(); }));
  const refreshStockEditConfirmButton=()=>{ if(confirmStockEditBtn) confirmStockEditBtn.disabled=(stockEditPendingChanges().length===0&&!stockEditSourcePending)||Boolean(document.querySelector('[data-stock-edit-new-expiry].stock-edit-invalid'))||stockEditPosting; };
  document.querySelectorAll('[data-stock-edit-amount]').forEach(input=>{
    input.addEventListener('focus',()=>input.select());
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){ event.preventDefault(); input.blur(); }
      if(event.key==='Escape'){
        event.preventDefault();
        delete stockEditDraftStocks[Number(input.dataset.stockEditAmount)];
        render();
      }
    });
    input.addEventListener('input',()=>{
      const p=products.find(x=>x.id===Number(input.dataset.stockEditAmount));
      if(!p) return;
      const amountText=input.value.trim();
      const amount=Number(amountText);
      if(amountText===''||!Number.isFinite(amount)){
        delete stockEditDraftStocks[p.id];
        input.classList.remove('stock-edit-pending');
        input.classList.add('stock-edit-invalid');
        refreshStockEditConfirmButton();
        return;
      }
      const newStock=stockBaseFromUnitAmount(amount,input.dataset.factor);
      if(newStock===Number(p.stock)) delete stockEditDraftStocks[p.id];
      else stockEditDraftStocks[p.id]=newStock;
      if(stockEditSourceInspectionListId&&newStock!==Number(p.stock)) stockEditSourcePending=true;
      input.classList.remove('stock-edit-invalid');
      input.classList.toggle('stock-edit-pending',newStock!==Number(p.stock));
      input.classList.toggle('stock-negative',newStock<0);
      refreshStockEditConfirmButton();
    });
    input.addEventListener('change',()=>render());
  });
  if(confirmStockEditBtn) confirmStockEditBtn.addEventListener('click',confirmStockEditChanges);
  document.querySelectorAll('[data-stock-edit-lot]').forEach(select=>select.addEventListener('change',()=>{ stockEditLotSelections[Number(select.dataset.stockEditLot)]=select.value; render(); }));
  document.querySelectorAll('[data-stock-edit-new-lot]').forEach(input=>input.addEventListener('input',()=>{ stockEditNewLotNumbers[Number(input.dataset.stockEditNewLot)]=input.value; }));
  document.querySelectorAll('[data-stock-edit-new-expiry]').forEach(input=>input.addEventListener('input',()=>{
    const expiryText=input.value.trim(),iso=dmyToISO(expiryText);
    stockEditNewLotExpiries[Number(input.dataset.stockEditNewExpiry)]=iso||'';
    input.classList.toggle('stock-edit-invalid',expiryText!==''&&!iso);
    refreshStockEditConfirmButton();
  }));
  document.querySelectorAll('[data-stock-edit-remove]').forEach(button=>button.addEventListener('click',()=>{
    const id=Number(button.dataset.stockEditRemove);
    stockEditItems=stockEditItems.filter(itemId=>itemId!==id);
    delete stockEditRowUnitSel[id];
    delete stockEditDraftStocks[id];
    delete stockEditLotSelections[id];
    delete stockEditNewLotNumbers[id];
    delete stockEditNewLotExpiries[id];
    render();
  }));
  document.querySelectorAll('[data-stock-edit-page]').forEach(button=>button.addEventListener('click',()=>{
    const value=button.dataset.stockEditPage;
    const totalPages=Math.max(1,Math.ceil(stockEditCurrentProducts().length/STOCK_EDIT_PAGE_SIZE));
    if(value==='prev') stockEditPage=Math.max(1,stockEditPage-1);
    else if(value==='next') stockEditPage=Math.min(totalPages,stockEditPage+1);
    else stockEditPage=Math.min(totalPages,Math.max(1,Number(value)||1));
    render();
  }));
  const histBtn = document.getElementById('histBtn');
  if(histBtn) histBtn.addEventListener('click', ()=>{ posSalesHistoryModalOpen=true; render(); });
  const closePOSSalesHistory=()=>{ posSalesHistoryModalOpen=false; render(); document.getElementById(currentTab==='cashbill'?'cash_bill_order_number':'histBtn')?.focus(); };
  document.getElementById('closePOSSalesHistoryBtn')?.addEventListener('click',closePOSSalesHistory);
  document.getElementById('closePOSSalesHistoryBottomBtn')?.addEventListener('click',closePOSSalesHistory);
  document.querySelector('.pos-sales-history-overlay')?.addEventListener('mousedown',event=>{ if(event.target===event.currentTarget) closePOSSalesHistory(); });
  document.querySelector('.pos-sales-history-overlay')?.addEventListener('keydown',event=>{
    if(event.key==='Escape'){ event.preventDefault(); event.stopPropagation(); closePOSSalesHistory(); }
  });
  // --- footer buttons ---
  const clearBillBtn = document.getElementById('clearBillBtn');
  if(clearBillBtn) clearBillBtn.addEventListener('click', clearBill);
  const holdBtn = document.getElementById('holdBtn');
  if(holdBtn) holdBtn.addEventListener('click', holdOrder);
  const editDiscountBtn = document.getElementById('editDiscountBtn');
  if(editDiscountBtn) editDiscountBtn.addEventListener('click', ()=>{ const v=prompt('ใส่จำนวนส่วนลด (บาท):', saleDiscount||''); if(v!==null){ saleDiscount=Math.max(0, parseFloat(v)||0); render(); } });
  // --- history: resume hold ---
  document.querySelectorAll('[data-act="resumehold"]').forEach(el=>{
    el.addEventListener('click', e=>{ e.stopPropagation(); resumeHold(el.dataset.id); });
  });
  document.querySelectorAll('[data-sale-view]').forEach(btn=>{ btn.addEventListener('click',e=>{ e.stopPropagation(); openSaleHistoryDetail(btn.dataset.saleView); }); });
  document.querySelectorAll('[data-delete-sale]').forEach(btn=>{ btn.addEventListener('click',e=>{ e.stopPropagation(); deleteSaleHistory(btn.dataset.deleteSale); }); });

  document.querySelectorAll('[data-void-sale]').forEach(btn=>{ btn.addEventListener('click',e=>{ e.stopPropagation(); voidSaleHistory(btn.dataset.voidSale); }); });
  document.querySelectorAll('[data-tax-sale]').forEach(btn=>{ btn.addEventListener('click',()=>startTaxInvoiceForm(btn.dataset.taxSale)); });
  document.querySelectorAll('[data-tax-doc]').forEach(btn=>{ btn.addEventListener('click',()=>startStandaloneTaxInvoiceForm(btn.dataset.taxDoc)); });
  const newTaxInvoiceBtn=document.getElementById('newTaxInvoiceBtn');
  if(newTaxInvoiceBtn) newTaxInvoiceBtn.addEventListener('click',openNewTaxInvoiceForm);
  const newCashBillBtn=document.getElementById('newCashBillBtn');
  if(newCashBillBtn) newCashBillBtn.addEventListener('click',()=>{ cashBillLookupOpen=true; cashBillOrderNumberDraft=''; render(); });
  const closeCashBillLookupBtn=document.getElementById('closeCashBillLookupBtn');
  if(closeCashBillLookupBtn) closeCashBillLookupBtn.addEventListener('click',()=>{ cashBillLookupOpen=false; render(); });
  const searchCashBillOrderBtn=document.getElementById('searchCashBillOrderBtn');
  if(searchCashBillOrderBtn) searchCashBillOrderBtn.addEventListener('click',()=>{ posSalesHistoryModalOpen=true; render(); document.getElementById('closePOSSalesHistoryBtn')?.focus(); });
  document.getElementById('continueCashBillOrderBtn')?.addEventListener('click',searchCashBillOrder);
  document.querySelectorAll('[data-copy-bill]').forEach(button=>button.addEventListener('click',async()=>{
    const number=button.dataset.copyBill;
    try{
      await navigator.clipboard.writeText(number);
      cashBillOrderNumberDraft=number;
      const input=document.getElementById('cash_bill_order_number');
      if(input) input.value=number;
      showToast('คัดลอกเลขบิลแล้ว');
    }catch(error){ showToast('คัดลอกไม่สำเร็จ กรุณาลากเลือกเลขบิลแล้วคัดลอกเอง','danger'); }
  }));
  const cashBillOrderNumber=document.getElementById('cash_bill_order_number');
  cashBillOrderNumber?.addEventListener('input',()=>{ cashBillOrderNumberDraft=cashBillOrderNumber.value; });
  if(cashBillOrderNumber) cashBillOrderNumber.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); searchCashBillOrder(); } });
  document.querySelectorAll('[data-cashbill-edit]').forEach(button=>button.addEventListener('click',()=>openA4CashReceiptModal(button.dataset.cashbillEdit)));
  document.querySelectorAll('[data-cashbill-print]').forEach(button=>button.addEventListener('click',()=>printA4CashReceipt(button.dataset.cashbillPrint)));
  document.querySelectorAll('[data-cashbill-delete]').forEach(button=>button.addEventListener('click',()=>deleteCashBill(button.dataset.cashbillDelete)));
  const historicalTaxInvoiceBtn=document.getElementById('historicalTaxInvoiceBtn');
  if(historicalTaxInvoiceBtn) historicalTaxInvoiceBtn.addEventListener('click',openHistoricalTaxInvoiceForm);
  const cancelTaxInvoiceFormBtn=document.getElementById('cancelTaxInvoiceFormBtn');
  if(cancelTaxInvoiceFormBtn) cancelTaxInvoiceFormBtn.addEventListener('click',()=>{ if(currentTab==='quotation') editingQuotationId=null; else editingTaxInvoiceSaleId=null; taxInvoiceDraft=null; taxInvoiceAddingCustomer=false; render(); });
  const addTaxCustomerBtn=document.getElementById('addTaxCustomerBtn');
  if(addTaxCustomerBtn) addTaxCustomerBtn.addEventListener('click',beginAddTaxInvoiceCustomer);
  const cancelTaxCustomerBtn=document.getElementById('cancelTaxCustomerBtn');
  if(cancelTaxCustomerBtn) cancelTaxCustomerBtn.addEventListener('click',cancelAddTaxInvoiceCustomer);
  const saveTaxCustomerBtn=document.getElementById('saveTaxCustomerBtn');
  if(saveTaxCustomerBtn) saveTaxCustomerBtn.addEventListener('click',saveTaxInvoiceCustomer);
  const searchTaxInvoiceOrderBtn=document.getElementById('searchTaxInvoiceOrderBtn');
  if(searchTaxInvoiceOrderBtn) searchTaxInvoiceOrderBtn.addEventListener('click',searchTaxInvoiceOrder);
  const taxOrderNumber=document.getElementById('tax_order_number');
  if(taxOrderNumber) taxOrderNumber.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); searchTaxInvoiceOrder(); } });
  const saveTaxInvoiceFormBtn=document.getElementById('saveTaxInvoiceFormBtn');
  if(saveTaxInvoiceFormBtn) saveTaxInvoiceFormBtn.addEventListener('click',saveTaxInvoiceForm);
  const saveStandaloneTaxInvoiceBtn=document.getElementById('saveStandaloneTaxInvoiceBtn');
  if(saveStandaloneTaxInvoiceBtn) saveStandaloneTaxInvoiceBtn.addEventListener('click',saveStandaloneTaxInvoice);
  const saveQuotationBtn=document.getElementById('saveQuotationBtn');
  if(saveQuotationBtn) saveQuotationBtn.addEventListener('click',saveQuotation);
  const addTaxInvoiceItemBtn=document.getElementById('addTaxInvoiceItemBtn');
  if(addTaxInvoiceItemBtn) addTaxInvoiceItemBtn.addEventListener('click',()=>{ syncPOFromDOM(); if((currentTab==='taxinvoice'||currentTab==='quotation')&&typeof syncTaxInvoiceDraftFromDOM==='function') syncTaxInvoiceDraftFromDOM(); taxInvoiceDraft.items.push({name:'',qty:1,unit:'',price:''}); render(); });
  const printStandaloneTaxInvoiceBtn=document.getElementById('printStandaloneTaxInvoiceBtn');
  if(printStandaloneTaxInvoiceBtn) printStandaloneTaxInvoiceBtn.addEventListener('click',()=>printFullTaxInvoice(String(editingTaxInvoiceSaleId).slice(7)));
  const printTaxInvoiceFormBtn=document.getElementById('printTaxInvoiceFormBtn');
  if(printTaxInvoiceFormBtn) printTaxInvoiceFormBtn.addEventListener('click',()=>printFullTaxInvoice(editingTaxInvoiceSaleId));
  const taxCustomerSelect=document.getElementById('tax_customer_select');
  if(taxCustomerSelect&&!taxCustomerSelect.disabled) taxCustomerSelect.addEventListener('change',()=>{
    if(editingTaxInvoiceSaleId==='manual-new'||(currentTab==='quotation'&&editingQuotationId!==null)) syncPOFromDOM();
    syncTaxInvoiceDraftFromDOM();
    const customer=customersList().find(c=>String(c.id)===String(taxCustomerSelect.value));
    if(customer) Object.assign(taxInvoiceDraft,{customerId:customer.id,name:customer.name||'',taxId:customer.taxId||'',address:customer.address||'',phone:customer.phone||'',email:customer.email||'',branch:'สำนักงานใหญ่',branchNo:''});
    else Object.assign(taxInvoiceDraft,{customerId:'',name:'',taxId:'',address:'',phone:'',email:'',branch:'สำนักงานใหญ่',branchNo:''});
    if(currentTab==='quotation') Object.assign(taxInvoiceDraft,{entity:customer?.entity||'individual',line:customer?.line||'',contactTypes:customer?.types||['customer'],credit:Math.max(0,parseInt(customer?.creditDays)||0)});
    taxInvoiceAddingCustomer=false;
    render();
  });
  // --- product list -> form ---
  document.querySelectorAll('input[name="quotation_customer_entity"]').forEach(radio=>radio.addEventListener('change',()=>{
    const text=radio.value==='juristic'?'เลขผู้เสียภาษี':'เลขบัตรประชาชน';
    document.getElementById('quotation_customer_taxid_label').textContent=text;
    document.getElementById('tax_form_customer_taxid').placeholder=`${text} 13 หลัก (ไม่บังคับ)`;
  }));
  const newProductBtn = document.getElementById('newProductBtn');
  if(newProductBtn) newProductBtn.addEventListener('click', ()=>{ editingProductId='new'; searchQuery=''; render(); });
  const importProductsBtn = document.getElementById('importProductsBtn');
  const productImportFile = document.getElementById('productImportFile');
  if(importProductsBtn&&productImportFile) importProductsBtn.addEventListener('click',()=>productImportFile.click());
  if(productImportFile) productImportFile.addEventListener('change',async()=>{
    const file=productImportFile.files?.[0];
    productImportFile.value='';
    if(file) await invokeExcelTool('importProductsFromExcel',file);
  });
  const exportProductsBtn = document.getElementById('exportProductsBtn');
  if(exportProductsBtn) exportProductsBtn.addEventListener('click',()=>invokeExcelTool('exportProductsToExcel'));
  document.querySelectorAll('[data-act="editproduct"]').forEach(el=>{
    el.addEventListener('click', ()=>{ if(isLevel2User()) return; editingProductId=Number(el.dataset.id); render(); });
  });
  document.querySelectorAll('[data-product-representative-history]').forEach(el=>{
    el.addEventListener('click',()=>{ if(isLevel2User()) return; openRepresentativeHistory({productId:Number(el.dataset.productRepresentativeHistory),originTab:'products'}); });
  });
  document.querySelectorAll('[data-act="stockcheck"]').forEach(el=>{
    el.addEventListener('click', ()=>openStockCheckModal(Number(el.dataset.id)));
  });
  // --- contacts ---
  attachCustomerPurchaseEvents();
  bindCustomerLoyaltyEvents();
  document.querySelectorAll('[data-cfilter]').forEach(el=>{
    el.addEventListener('click', ()=>{ contactFilter=el.dataset.cfilter; contactPage=1; searchQuery=''; render(); });
  });
  const newContactBtn = document.getElementById('newContactBtn');
  if(newContactBtn) newContactBtn.addEventListener('click', ()=>{ editingContactId='new'; searchQuery=''; render(); });
  const importContactsBtn = document.getElementById('importContactsBtn');
  const contactImportFile = document.getElementById('contactImportFile');
  if(importContactsBtn&&contactImportFile) importContactsBtn.addEventListener('click',()=>contactImportFile.click());
  if(contactImportFile) contactImportFile.addEventListener('change',async()=>{
    const file=contactImportFile.files?.[0];
    contactImportFile.value='';
    if(file) await invokeExcelTool('importContactsFromExcel',file);
  });
  const exportContactsBtn = document.getElementById('exportContactsBtn');
  if(exportContactsBtn) exportContactsBtn.addEventListener('click',()=>invokeExcelTool('exportContactsToExcel'));
  document.querySelectorAll('[data-act="editcontact"]').forEach(el=>{
    el.addEventListener('click', ()=>{ editingCustomerPriceContactId=null; editingContactId=Number(el.dataset.id); render(); });
  });
  document.querySelectorAll('[data-act="customerprice"]').forEach(el=>{
    el.addEventListener('click', ()=>{ editingContactId=null; editingCustomerPriceContactId=Number(el.dataset.id); render(); });
  });
  document.querySelectorAll('[data-act="deletecontact"]').forEach(el=>{
    el.addEventListener('click', ()=>deleteContact(Number(el.dataset.id)));
  });
  const cancelContactBtn = document.getElementById('cancelContactBtn');
  if(cancelContactBtn) cancelContactBtn.addEventListener('click', ()=>{ editingContactId=null; render(); });
  const saveContactBtn = document.getElementById('saveContactBtn');
  if(saveContactBtn) saveContactBtn.addEventListener('click', saveContact);
  bindContactTaxIdLabel(document);
  bindContactCustomerPhoneRequirement(document);
  const cancelCustomerPricingBtn=document.getElementById('cancelCustomerPricingBtn');
  if(cancelCustomerPricingBtn) cancelCustomerPricingBtn.addEventListener('click',()=>{ editingCustomerPriceContactId=null; render(); });
  const saveCustomerPricingBtn=document.getElementById('saveCustomerPricingBtn');
  if(saveCustomerPricingBtn) saveCustomerPricingBtn.addEventListener('click',saveCustomerPricing);
  const customerPriceRows=document.getElementById('customerPriceRows');
  const bindCustomerPriceRows=()=>document.querySelectorAll('[data-customer-price-row]').forEach(row=>{
    const unitSelect=row.querySelector('.customer-price-unit');
    if(unitSelect){
      unitSelect.dataset.previousUnit=unitSelect.value;
      unitSelect.onchange=()=>{
        const productId=Number(row.querySelector('.customer-price-product-id')?.value||row.dataset.productId);
        const duplicate=[...document.querySelectorAll('[data-customer-price-row]')].find(other=>other!==row&&Number(other.querySelector('.customer-price-product-id')?.value||other.dataset.productId)===productId&&other.querySelector('.customer-price-unit')?.value===unitSelect.value);
        if(duplicate){ showToast('สินค้านี้มีราคาพิเศษของหน่วยที่เลือกอยู่แล้ว','danger-top'); unitSelect.value=unitSelect.dataset.previousUnit; return; }
        const product=products.find(item=>Number(item.id)===productId);
        const option=productUnitOptions(product).find(item=>item.name===unitSelect.value);
        row.querySelector('.customer-price-barcode').textContent=productBarcodeForUnit(product,unitSelect.value)||'-';
        row.querySelector('.customer-price-cost').value=fmtMoney(option?.cost||0);
        unitSelect.dataset.previousUnit=unitSelect.value;
      };
    }
    const remove=row.querySelector('.customer-price-remove');
    if(remove) remove.onclick=()=>{
      row.remove();
      if(customerPriceRows&&!customerPriceRows.querySelector('[data-customer-price-row]')) customerPriceRows.innerHTML='<tr class="customer-price-empty"><td colspan="6">ยังไม่ได้กำหนดราคาพิเศษ</td></tr>';
    };
  });
  const customerPriceSearch=document.getElementById('customerPriceSearch');
  const customerPriceSearchResults=document.getElementById('customerPriceSearchResults');
  const customerPriceMatches=query=>{
    const text=String(query||'').trim(),lower=text.toLowerCase();
    if(!text) return [];
    const exact=findProductByExactCode(text);
    const matches=activeProducts().filter(product=>product.name.toLowerCase().includes(lower)||(product.sku||'').toLowerCase().includes(lower)||matchesBarcode(product,text)).slice(0,8);
    if(exact?.product){
      const filtered=matches.filter(product=>Number(product.id)!==Number(exact.product.id));
      return [{product:exact.product,unit:exact.unitName||exact.product.unit},...filtered.map(product=>({product,unit:product.unit}))].slice(0,8);
    }
    return matches.map(product=>({product,unit:product.unit}));
  };
  const addCustomerPriceProduct=(product,unit)=>{
    if(!product||!customerPriceRows) return;
    const selectedUnit=productUnitOptions(product).some(option=>option.name===unit)?unit:product.unit;
    const existing=[...customerPriceRows.querySelectorAll('[data-customer-price-row]')].find(row=>Number(row.querySelector('.customer-price-product-id')?.value||row.dataset.productId)===Number(product.id)&&row.querySelector('.customer-price-unit')?.value===selectedUnit);
    if(existing){ showToast(`มีราคาพิเศษ “${product.name}” หน่วย ${selectedUnit} อยู่แล้ว`); existing.querySelector('.customer-price-value')?.focus(); return; }
    customerPriceRows.querySelector('.customer-price-empty')?.remove();
    customerPriceRows.insertAdjacentHTML('beforeend',customerPriceRowHtml({productId:product.id,unit:selectedUnit,price:''},customerPriceRows.querySelectorAll('[data-customer-price-row]').length));
    bindCustomerPriceRows();
    customerPriceRows.querySelector('[data-customer-price-row]:last-child .customer-price-value')?.focus();
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
    customerPriceSearchResults.querySelectorAll('[data-customer-price-product]').forEach(button=>button.addEventListener('mousedown',event=>{
      event.preventDefault();
      addCustomerPriceProduct(products.find(product=>Number(product.id)===Number(button.dataset.customerPriceProduct)),button.dataset.customerPriceUnit);
    }));
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
  const newSalesRepBtn = document.getElementById('newSalesRepBtn');
  if(newSalesRepBtn) newSalesRepBtn.addEventListener('click', ()=>{ editingSalesRepresentativeId='new'; searchQuery=''; render(); });
  const importSalesRepsBtn = document.getElementById('importSalesRepsBtn');
  const salesRepImportFile = document.getElementById('salesRepImportFile');
  if(importSalesRepsBtn&&salesRepImportFile) importSalesRepsBtn.addEventListener('click',()=>salesRepImportFile.click());
  if(salesRepImportFile) salesRepImportFile.addEventListener('change',async()=>{
    const file=salesRepImportFile.files?.[0];
    salesRepImportFile.value='';
    if(file) await invokeExcelTool('importSalesRepresentativesFromExcel',file);
  });
  const exportSalesRepsBtn = document.getElementById('exportSalesRepsBtn');
  if(exportSalesRepsBtn) exportSalesRepsBtn.addEventListener('click',()=>invokeExcelTool('exportSalesRepresentativesToExcel'));
  document.querySelectorAll('[data-act="editsalesrep"]').forEach(el=>{
    el.addEventListener('click', ()=>{ editingSalesRepresentativeId=Number(el.dataset.id); render(); });
  });
  document.querySelectorAll('[data-representative-history]').forEach(el=>{
    el.addEventListener('click',()=>openRepresentativeHistory({representativeId:Number(el.dataset.representativeHistory),originTab:'salesreps'}));
  });
  document.querySelectorAll('[data-act="deletesalesrep"]').forEach(el=>{
    el.addEventListener('click', ()=>deleteSalesRepresentative(Number(el.dataset.id)));
  });
  const cancelSalesRepBtn = document.getElementById('cancelSalesRepBtn');
  if(cancelSalesRepBtn) cancelSalesRepBtn.addEventListener('click', ()=>{ editingSalesRepresentativeId=null; render(); });
  const saveSalesRepBtn = document.getElementById('saveSalesRepBtn');
  if(saveSalesRepBtn) saveSalesRepBtn.addEventListener('click', saveSalesRepresentative);
  // --- promotions ---
  const newPromotionBtn=document.getElementById('newPromotionBtn');
  if(newPromotionBtn) newPromotionBtn.addEventListener('click', ()=>{ editingPromotionId='new'; searchQuery=''; render(); });
  document.querySelectorAll('[data-act="editpromotion"]').forEach(el=>{
    el.addEventListener('click', ()=>{ editingPromotionId=Number(el.dataset.id); render(); });
  });
  document.querySelectorAll('[data-act="deletepromotion"]').forEach(el=>{
    el.addEventListener('click', ()=>deletePromotion(Number(el.dataset.id)));
  });
  const cancelPromotionBtn=document.getElementById('cancelPromotionBtn');
  if(cancelPromotionBtn) cancelPromotionBtn.addEventListener('click', ()=>{ editingPromotionId=null; promoDraftItemsSyncedFor=undefined; render(); });
  const savePromotionBtn=document.getElementById('savePromotionBtn');
  if(savePromotionBtn) savePromotionBtn.addEventListener('click', savePromotion);
  // สลับมุมมอง สินค้ารายตัว <-> หมวดหมู่/แบรนด์
  document.querySelectorAll('input[name="promo_scope"]').forEach(el=>{
    el.addEventListener('change', ()=>{
      const scopeProduct=document.getElementById('promo_scope_product');
      const scopeCategory=document.getElementById('promo_scope_category');
      const isProduct=el.value==='product';
      if(scopeProduct) scopeProduct.style.display=isProduct?'block':'none';
      if(scopeCategory) scopeCategory.style.display=isProduct?'none':'block';
      updatePromoUnitFieldVisibility();
    });
  });
  bindPromoProductSearch();
  // ปุ่มเปิด modal เลือกสินค้าในหมวดหมู่/แบรนด์
  const openPromoItemPickerBtn=document.getElementById('openPromoItemPickerBtn');
  if(openPromoItemPickerBtn) openPromoItemPickerBtn.addEventListener('click', openPromoItemPicker);
  bindPromoCategoryItemListEvents();
  // เปลี่ยนหมวดหมู่/แบรนด์ → ล้างรายการสินค้าที่เจาะจงเลือกไว้เดิม (อาจไม่อยู่ในหมวด/แบรนด์ใหม่แล้ว)
  ['promo_category','promo_brand'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.addEventListener('change', ()=>{
      if(currentPromoDraftItems && currentPromoDraftItems.length){
        currentPromoDraftItems=[];
        const listWrap=document.getElementById('promoCategoryItemsList');
        if(listWrap){ listWrap.innerHTML=renderPromoCategoryItemsList(currentPromoDraftItems); bindPromoCategoryItemListEvents(); }
        showToast('เปลี่ยนหมวดหมู่/แบรนด์แล้ว — กรุณาเลือกสินค้าใหม่');
      }
    });
  });
  // สลับฟิลด์ตามประเภทโปรโมชั่น
  document.querySelectorAll('input[name="promo_type"]').forEach(el=>{
    el.addEventListener('change', ()=>{
      const map={discount:'promo_fields_discount',bundle:'promo_fields_bundle',buygetdiff:'promo_fields_buygetdiff'};
      Object.entries(map).forEach(([type,id])=>{
        const field=document.getElementById(id);
        if(field) field.style.display=(type===el.value)?'flex':'none';
      });
      // ประเภท "ซื้อสินค้าหนึ่ง แถมอีกสินค้าหนึ่ง" ไม่ใช้ panel 'สินค้าที่เข้าร่วมโปรโมชั่น' ฝั่งซ้าย (ระบุสินค้าในฟิลด์ประเภทโปรฯ แทน)
      const leftPanel=document.getElementById('promo_left_panel');
      if(leftPanel) leftPanel.style.display=(el.value==='buygetdiff')?'none':'block';
    });
  });
  bindPromoBgdProductSearch('buy');
  bindPromoBgdProductSearch('get');
  const saveBusinessSettingsBtn=document.getElementById('saveBusinessSettingsBtn');
  if(saveBusinessSettingsBtn) saveBusinessSettingsBtn.addEventListener('click',saveBusinessSettings);
  const businessSettingsForm=document.getElementById('businessSettingsForm');
  const businessSyncStatus=document.getElementById('businessSyncStatus');
  const markBusinessSettingsDirty=()=>{
    businessSettingsDirty=true;
    if(businessSyncStatus){ businessSyncStatus.dataset.state='dirty'; businessSyncStatus.textContent='มีการแก้ไขที่ยังไม่ได้บันทึก'; }
  };
  businessSettingsForm?.querySelectorAll('input,select,textarea').forEach(field=>{
    field.addEventListener(field.matches('select,input[type="radio"]')?'change':'input',markBusinessSettingsDirty);
  });
  const businessBranchFields=document.getElementById('businessBranchFields');
  const businessTaxBranchRow=document.getElementById('businessTaxBranchRow');
  const businessTaxBranchNote=document.getElementById('businessTaxBranchNote');
  const businessVatDateRow=document.getElementById('businessVatDateRow');
  const updateBusinessSettingsVisibility=()=>{
    const vatSelected=document.getElementById('set_business_vat')?.value===VAT_REGISTERED_LABEL;
    if(businessVatDateRow) businessVatDateRow.hidden=!vatSelected;
    if(businessTaxBranchRow) businessTaxBranchRow.hidden=!vatSelected;
    if(businessTaxBranchNote) businessTaxBranchNote.hidden=!vatSelected;
    if(businessBranchFields) businessBranchFields.hidden=!vatSelected||document.querySelector('input[name="set_branch"]:checked')?.value!=='branch';
  };
  document.querySelectorAll('input[name="set_branch"]').forEach(radio=>radio.addEventListener('change',()=>{
    updateBusinessSettingsVisibility();
  }));
  document.getElementById('set_business_vat')?.addEventListener('change',updateBusinessSettingsVisibility);
  document.getElementById('set_business_type')?.addEventListener('change',event=>{
    const hint=document.getElementById('businessTaxIdHint');
    if(hint) hint.textContent=businessTypeTaxIdHint(event.target.value);
  });
  const businessTaxInput=document.getElementById('set_business_tax');
  if(businessTaxInput) businessTaxInput.addEventListener('input',()=>{ businessTaxInput.value=businessTaxInput.value.replace(/\D/g,'').slice(0,13); });
  const businessBranchCodeInput=document.getElementById('set_business_branch_code');
  if(businessBranchCodeInput) businessBranchCodeInput.addEventListener('input',()=>{ businessBranchCodeInput.value=businessBranchCodeInput.value.replace(/\D/g,'').slice(0,5); });
  const saveDocumentPrefixesBtn=document.getElementById('saveDocumentPrefixesBtn');
  if(saveDocumentPrefixesBtn) saveDocumentPrefixesBtn.addEventListener('click',saveDocumentPrefixes);
  document.getElementById('printPosSmallestUnitCommandBtn')?.addEventListener('click',printPosSmallestUnitCommandBarcode);
  const downloadStoreBackupBtn=document.getElementById('downloadStoreBackupBtn');
  if(downloadStoreBackupBtn) downloadStoreBackupBtn.addEventListener('click',downloadStoreBackup);
  const restoreStoreBackupBtn=document.getElementById('restoreStoreBackupBtn');
  const restoreStoreBackupFile=document.getElementById('restoreStoreBackupFile');
  if(restoreStoreBackupBtn&&restoreStoreBackupFile) restoreStoreBackupBtn.addEventListener('click',()=>restoreStoreBackupFile.click());
  if(restoreStoreBackupFile) restoreStoreBackupFile.addEventListener('change',async()=>{
    const file=restoreStoreBackupFile.files?.[0];
    restoreStoreBackupFile.value='';
    if(file) await restoreStoreBackup(file);
  });
  document.getElementById('openDocumentResetBtn')?.addEventListener('click',()=>{ storeResetMode='documents'; render(); setTimeout(()=>document.getElementById('storeResetPassword')?.focus(),0); });
  document.getElementById('openFactoryResetBtn')?.addEventListener('click',()=>{ storeResetMode='factory'; render(); setTimeout(()=>document.getElementById('storeResetPassword')?.focus(),0); });
  document.getElementById('cancelStoreResetBtn')?.addEventListener('click',()=>{ storeResetMode=null; render(); });
  document.getElementById('storeResetForm')?.addEventListener('submit',submitStoreReset);
  // จัดรูปแบบเบอร์โทรอัตโนมัติขณะพิมพ์ (xxx-xxx-xxxx)
  document.querySelectorAll('.phone-input').forEach(inp=>{
    inp.addEventListener('input',()=>{ inp.value=formatPhoneValue(inp.value); });
  });
  const saveUserSettingsBtn=document.getElementById('saveUserSettingsBtn');
  if(saveUserSettingsBtn) saveUserSettingsBtn.addEventListener('click',saveUserSettings);
  // ===== ตัวกรองรายงานยอดขายตามสินค้า =====
  const rpPeriod=document.getElementById('rpf_period');
  if(rpPeriod) rpPeriod.addEventListener('change',()=>{ rproductFilter.period=rpPeriod.value; render(); });
  const rpFrom=document.getElementById('rpf_from'); if(rpFrom) rpFrom.addEventListener('change',()=>{ const iso=dmyToISO(rpFrom.value); if(iso) rproductFilter.from=iso; });
  const rpTo=document.getElementById('rpf_to'); if(rpTo) rpTo.addEventListener('change',()=>{ const iso=dmyToISO(rpTo.value); if(iso) rproductFilter.to=iso; });
  const rpMonth=document.getElementById('rpf_month'); if(rpMonth) rpMonth.addEventListener('change',()=>{ rproductFilter.month=rpMonth.value; render(); });
  const rpYear=document.getElementById('rpf_year'); if(rpYear) rpYear.addEventListener('change',()=>{ rproductFilter.year=rpYear.value; render(); });
  const rpWh=document.getElementById('rpf_wh'); if(rpWh) rpWh.addEventListener('change',()=>{ rproductFilter.wh=rpWh.value; });
  const rpScope=document.getElementById('rpf_scope'); if(rpScope) rpScope.addEventListener('change',()=>{ rproductFilter.scope=rpScope.value; rproductFilter.category=''; rproductFilter.brand=''; rproductFilter.products=[]; render(); });
  const rpCat=document.getElementById('rpf_category'); if(rpCat) rpCat.addEventListener('change',()=>{ rproductFilter.category=rpCat.value; });
  const rpBrand=document.getElementById('rpf_brand'); if(rpBrand) rpBrand.addEventListener('change',()=>{ rproductFilter.brand=rpBrand.value; });
  // ค้นหาสินค้าแบบพิมพ์/สแกน/รหัส (เลือกได้หลายตัว — เลือกแล้วลงในเอกสารเลย)
  const rpProdSearch=document.getElementById('rpf_product_search');
  const rpProdResults=document.getElementById('rpf_product_results');
  // ปุ่มเอาสินค้าออกจากรายการในเอกสาร
  document.querySelectorAll('.rpt-row-x').forEach(x=>x.addEventListener('click',()=>{ const name=x.dataset.name; rproductFilter.products=(rproductFilter.products||[]).filter(n=>n!==name); render(); }));
  const rpClear=document.getElementById('rpClearProductsBtn'); if(rpClear) rpClear.addEventListener('click',()=>{ rproductFilter.products=[]; render(); });
  if(rpProdSearch&&rpProdResults){
    const addProduct=(name)=>{ if(!rproductFilter.products) rproductFilter.products=[]; if(!rproductFilter.products.includes(name)) rproductFilter.products.push(name); render(); };
    const renderResults=(q)=>{
      q=(q||'').trim();
      if(!q){ rpProdResults.classList.remove('show'); rpProdResults.innerHTML=''; return; }
      const ql=q.toLowerCase();
      const chosen=rproductFilter.products||[];
      const matches=products.filter(p=> !chosen.includes(p.name) && ( p.name.toLowerCase().includes(ql) || (p.sku||'').toLowerCase().includes(ql) || p.barcode===q || (p.extraBarcodes||[]).includes(q) || (p.vendorBarcodes||[]).some(v=>v.code===q) || (p.units||[]).some(u=>u.barcode===q) )).slice(0,20);
      if(!matches.length){ rpProdResults.innerHTML='<div class="rpf-result-empty">ไม่พบสินค้า</div>'; rpProdResults.classList.add('show'); return; }
      rpProdResults.innerHTML=matches.map(p=>`<div class="rpf-result" data-name="${escapeHtml(p.name)}"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.sku||'-')} · ${escapeHtml(p.barcode||'ไม่มีบาร์โค้ด')} · คงเหลือ ${escapeHtml(p.stock)} ${escapeHtml(p.unit||'')}</span></div>`).join('');
      rpProdResults.classList.add('show');
    };
    const tryExact=(q)=>{ const exact=products.find(p=>p.barcode===q||(p.extraBarcodes||[]).includes(q)||(p.vendorBarcodes||[]).some(v=>v.code===q)||p.sku===q||(p.units||[]).some(u=>u.barcode===q)); if(exact){ addProduct(exact.name); return true; } return false; };
    rpProdSearch.addEventListener('input',()=>{ renderResults(rpProdSearch.value); });
    rpProdSearch.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); const q=rpProdSearch.value.trim(); if(!q) return; if(tryExact(q)) return; const first=rpProdResults.querySelector('.rpf-result'); if(first){ addProduct(first.dataset.name); } } });
    rpProdResults.addEventListener('click',e=>{ const row=e.target.closest('.rpf-result'); if(!row) return; addProduct(row.dataset.name); });
    setTimeout(()=>{ rpProdSearch.focus(); },0);
  }
  const rpApply=document.getElementById('rpApplyBtn'); if(rpApply) rpApply.addEventListener('click',()=>{ rproductFilter.applied=true; render(); });
  const rpPrint=document.getElementById('rpPrintBtn'); if(rpPrint) rpPrint.addEventListener('click',()=>{ printRProduct(); });
  // ===== ตัวกรองรายงานยอดขายตามบิล =====
  const rbPeriod=document.getElementById('rbf_period');
  if(rbPeriod) rbPeriod.addEventListener('change',()=>{ rbillFilter.period=rbPeriod.value; render(); });
  const rbFrom=document.getElementById('rbf_from'); if(rbFrom) rbFrom.addEventListener('change',()=>{ const iso=dmyToISO(rbFrom.value); if(iso) rbillFilter.from=iso; });
  const rbTo=document.getElementById('rbf_to'); if(rbTo) rbTo.addEventListener('change',()=>{ const iso=dmyToISO(rbTo.value); if(iso) rbillFilter.to=iso; });
  const rbMonth=document.getElementById('rbf_month'); if(rbMonth) rbMonth.addEventListener('change',()=>{ rbillFilter.month=rbMonth.value; render(); });
  const rbYear=document.getElementById('rbf_year'); if(rbYear) rbYear.addEventListener('change',()=>{ rbillFilter.year=rbYear.value; render(); });
  const rbWh=document.getElementById('rbf_wh'); if(rbWh) rbWh.addEventListener('change',()=>{ rbillFilter.wh=rbWh.value; });
  const rbPay=document.getElementById('rbf_pay'); if(rbPay) rbPay.addEventListener('change',()=>{ rbillFilter.pay=rbPay.value; });
  const rbApply=document.getElementById('rbApplyBtn'); if(rbApply) rbApply.addEventListener('click',()=>{ rbillFilter.applied=true; render(); });
  const rbPrint=document.getElementById('rbPrintBtn'); if(rbPrint) rbPrint.addEventListener('click',()=>{ printRBill(); });
  // ===== ตัวกรองรายงานกำไร / ขาดทุน =====
  const rprofitPeriod=document.getElementById('rprofit_period'); if(rprofitPeriod) rprofitPeriod.addEventListener('change',()=>{rprofitFilter.period=rprofitPeriod.value;render();});
  const rprofitFrom=document.getElementById('rprofit_from'); if(rprofitFrom) rprofitFrom.addEventListener('change',()=>{const iso=dmyToISO(rprofitFrom.value);if(iso) rprofitFilter.from=iso;});
  const rprofitTo=document.getElementById('rprofit_to'); if(rprofitTo) rprofitTo.addEventListener('change',()=>{const iso=dmyToISO(rprofitTo.value);if(iso) rprofitFilter.to=iso;});
  const rprofitMonth=document.getElementById('rprofit_month'); if(rprofitMonth) rprofitMonth.addEventListener('change',()=>{rprofitFilter.month=rprofitMonth.value;render();});
  const rprofitYear=document.getElementById('rprofit_year'); if(rprofitYear) rprofitYear.addEventListener('change',()=>{rprofitFilter.year=rprofitYear.value;render();});
  const rprofitWh=document.getElementById('rprofit_wh'); if(rprofitWh) rprofitWh.addEventListener('change',()=>{rprofitFilter.wh=rprofitWh.value;});
  const rprofitPay=document.getElementById('rprofit_pay'); if(rprofitPay) rprofitPay.addEventListener('change',()=>{rprofitFilter.pay=rprofitPay.value;});
  const rprofitApply=document.getElementById('rprofitApplyBtn'); if(rprofitApply) rprofitApply.addEventListener('click',()=>{rprofitFilter.applied=true;render();});
  const rprofitPrint=document.getElementById('rprofitPrintBtn'); if(rprofitPrint) rprofitPrint.addEventListener('click',printRProfit);
  const rtaxMonthInput=document.getElementById('rtax_month'); if(rtaxMonthInput) rtaxMonthInput.addEventListener('change',()=>{rtaxMonth=rtaxMonthInput.value||TODAY_STR.slice(0,7);render();});
  const signatureFile=document.getElementById('set_signature_file');
  if(signatureFile) signatureFile.addEventListener('change',()=>{ currentUserProfile.signatureName=signatureFile.files?.[0]?.name||''; const label=document.getElementById('signatureFileName'); if(label) label.textContent=currentUserProfile.signatureName||'ยังไม่ได้เลือกไฟล์'; });
  const addSystemUserBtn=document.getElementById('addSystemUserBtn');
  if(addSystemUserBtn) addSystemUserBtn.addEventListener('click',()=>{ editingSystemUserId=null; addingSystemUser=true; render(); });
  document.querySelectorAll('[data-edit-system-user]').forEach(btn=>{
    btn.addEventListener('click',()=>{ editingSystemUserId=btn.dataset.editSystemUser; addingSystemUser=true; render(); });
  });
  const cancelAddSystemUserBtn=document.getElementById('cancelAddSystemUserBtn');
  if(cancelAddSystemUserBtn) cancelAddSystemUserBtn.addEventListener('click',()=>{ addingSystemUser=false; editingSystemUserId=null; render(); });
  const saveSystemUserBtn=document.getElementById('saveSystemUserBtn');
  if(saveSystemUserBtn) saveSystemUserBtn.addEventListener('click',saveSystemUser);
  document.querySelectorAll('[data-system-user-permission-row]').forEach(row=>{
    const view=row.querySelector('[data-permission-action="canView"]');
    row.querySelectorAll('[data-permission-action]').forEach(input=>input.addEventListener('change',()=>{
      if(input!==view&&input.checked) view.checked=true;
      if(input===view&&!input.checked) row.querySelectorAll('[data-permission-action]').forEach(other=>{ other.checked=false; });
    }));
  });
  document.querySelectorAll('[data-delete-system-user]').forEach(btn=>{
    btn.addEventListener('click',()=>deleteSystemUser(btn.dataset.deleteSystemUser));
  });
  // --- product groups ---
  document.querySelectorAll('[data-product-review-filter]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      productReviewFilter=btn.dataset.productReviewFilter;
      productReviewFilterUsed=true;
      productPage=1;
      render();
    });
  });
  document.querySelectorAll('.product-group-category').forEach(el=>{
    el.addEventListener('click',()=>{
      selectedGroup={cat:el.dataset.productCategory};
      productPage=1;
      render();
    });
  });
  document.querySelectorAll('.product-group-brand').forEach(el=>{
    el.addEventListener('click',()=>{
      selectedGroup={cat:el.dataset.productCategory,brand:el.dataset.productBrand};
      productPage=1;
      render();
    });
  });
  // --- sort headers ---
  document.querySelectorAll('.grid-table th.sortable').forEach(el=>{
    el.addEventListener('click', ()=>{
      const key = el.dataset.sort;
      const sortState = ['contacts','customers'].includes(currentTab) ? contactSort : productSort;
      if(sortState.key===key) sortState.dir *= -1;
      else { sortState.key = key; sortState.dir = 1; }
      if(['contacts','customers'].includes(currentTab)) contactPage=1;
      render();
    });
  });
  // --- pagination ---
  // เปลี่ยนหน้าโดยยึดตำแหน่งแถบปุ่มเปลี่ยนหน้า (pager) ให้อยู่ตำแหน่งเดิมบนจอ
  // (แต่ละหน้ามีจำนวนแถวไม่เท่ากัน ความสูงหน้าจึงต่างกัน — ยึดพิกเซลบนสุดอย่างเดียวจะเพี้ยน)
  function renderKeepScroll(){
    const pagerBefore=document.querySelector('.pager');
    const anchorTop=pagerBefore?pagerBefore.getBoundingClientRect().top:null;
    const winY=window.scrollY||document.documentElement.scrollTop||0;
    render();
    const restore=()=>{
      const pagerAfter=document.querySelector('.pager');
      if(pagerAfter && anchorTop!==null){
        const newTop=pagerAfter.getBoundingClientRect().top;
        window.scrollBy(0, newTop-anchorTop);
      } else {
        window.scrollTo(0,winY);
      }
    };
    restore();
    requestAnimationFrame(restore);
  }
  document.querySelectorAll('[data-page]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const v=el.dataset.page;
      if(v==='prev'){ if(productPage>1) productPage--; }
      else if(v==='next'){ productPage++; }
      else { productPage=Number(v); }
      renderKeepScroll();
    });
  });
  document.querySelectorAll('[data-contactpage]').forEach(el=>{
    el.addEventListener('click',()=>{
      const v=el.dataset.contactpage;
      if(v==='prev'){ if(contactPage>1) contactPage--; }
      else if(v==='next'){ contactPage++; }
      else { contactPage=Number(v); }
      renderKeepScroll();
    });
  });
  // ช่องวันที่แบบ วัน/เดือน/ปี — ใช้ตัวจัดรูปแบบร่วมกันทั้งหน้าปกติและ popup
  bindDmyDateFields();
  document.querySelectorAll('[data-cycle-product-review-status]').forEach(button=>{
    button.addEventListener('click',async()=>{
      const pid=Number(button.dataset.cycleProductReviewStatus);
      const product=products.find(item=>Number(item.id)===pid);
      if(!product) return;
      const trackedFields=['dataReviewStatus','dataReviewUpdatedAt','dataReviewUpdatedBy','dataReviewedAt','dataReviewedBy'];
      const previousValues=Object.fromEntries(trackedFields.map(field=>[field,product[field]]));
      const currentStatus=productDataReviewStatus(product);
      const requestedStatus=currentStatus==='pending'?'complete':currentStatus==='complete'?'':'pending';
      const shouldClear=requestedStatus==='';
      button.disabled=true;
      if(shouldClear){
        trackedFields.forEach(field=>{ delete product[field]; });
      }else{
        const changedAt=new Date().toISOString();
        const changedBy=currentPharmacistName()||String(loggedInUser()?.username||'').trim();
        product.dataReviewStatus=requestedStatus;
        product.dataReviewUpdatedAt=changedAt;
        product.dataReviewUpdatedBy=changedBy;
        if(requestedStatus==='complete'){
          product.dataReviewedAt=changedAt;
          product.dataReviewedBy=changedBy;
        }else{
          delete product.dataReviewedAt;
          delete product.dataReviewedBy;
        }
      }
      const cached=await persistWorkspaceData({productChanges:{updatedIds:[pid]}});
      if(!cached){
        trackedFields.forEach(field=>{
          if(previousValues[field]===undefined) delete product[field];
          else product[field]=previousValues[field];
        });
        showToast('บันทึกสถานะตรวจข้อมูลไม่สำเร็จ กรุณาลองใหม่','danger-top');
        render();
        return;
      }
      showToast(shouldClear?'ล้างสถานะตรวจข้อมูลแล้ว':requestedStatus==='pending'?'ทำเครื่องหมายว่ากำลังแก้ไข / รอข้อมูลแล้ว':'ทำเครื่องหมายว่าข้อมูลครบถ้วนแล้ว');
      render();
    });
  });
  // แก้ไขข้อมูลสินค้าแบบอินไลน์ในหน้ารายการสินค้า (รหัส/ชื่อ/ราคา/ทุน/วันหมดอายุของคลังที่ใช้งาน)
  document.querySelectorAll('.prod-inline-edit').forEach(el=>{
    if(el.classList.contains('prod-inline-barcode')){
      el.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); el.blur(); } });
    }
    el.addEventListener('change', async ()=>{
      const pid=Number(el.dataset.pid);
      const field=el.dataset.field;
      const p=products.find(x=>x.id===pid); if(!p) return;
      if(field==='price'||field==='cost'){
        const v=parseFloat(el.value);
        const val=isNaN(v)?0:v;
        const unit=el.dataset.unit;
        if(!unit || unit===p.unit){ p[field]=val; }
        else{ const u=(p.units||[]).find(x=>x.sub===unit); if(u) u[field]=val; }
      } else if(field==='sku'){
        const v=el.value.trim();
        if(v && products.some(x=>x.id!==pid && (x.sku||'').toLowerCase()===v.toLowerCase())){
          showToast('รหัสสินค้านี้ถูกใช้แล้ว กรุณาใช้รหัสอื่น');
          el.value=p.sku||'';
          return;
        }
        p.sku=v;
      } else if(field==='barcode'){
        const unit=String(el.dataset.unit||p.unit||'');
        const unitRow=unit===String(p.unit||'')?null:(p.units||[]).find(item=>String(item.sub||'')===unit);
        if(unit!==String(p.unit||'')&&!unitRow){
          showToast('ไม่พบหน่วยสินค้าที่เลือก กรุณาเลือกหน่วยใหม่','danger-top');
          render();
          return;
        }
        const previous=String(unitRow?unitRow.barcode||'':p.barcode||'').trim();
        const requested=el.value.trim();
        const conflict=requested&&barcodePrintBarcodeOwners().find(owner=>
          String(owner.code||'').toLowerCase()===requested.toLowerCase()&&
          !(Number(owner.pid)===pid&&owner.kind==='unit'&&String(owner.unit||'')===unit)
        );
        if(conflict){
          const conflictProduct=products.find(item=>Number(item.id)===Number(conflict.pid));
          el.value=previous;
          showToast(`บาร์โค้ด ${requested} ถูกใช้กับ ${conflictProduct?.name||'สินค้าอื่น'} แล้ว`,'danger-top');
          return;
        }
        const draft={...p,barcode:unitRow?p.barcode:requested,units:(p.units||[]).map(item=>item===unitRow?{...item,barcode:requested}:item)};
        try{ await assertProductBarcodesAvailable(draft,p); }
        catch(error){ el.value=previous; showToast(error.message,'danger-top'); return; }
        if(unitRow) unitRow.barcode=requested;
        else p.barcode=requested;
      } else if(field==='name'){
        const v=el.value.trim();
        if(v) p.name=v; else el.value=p.name;
      }
      rebuildProductLookupMaps();
      const cached=await persistWorkspaceData({productChanges:{updatedIds:[pid]}});
      if(!cached){ showToast('บันทึกข้อมูลแล้ว แต่เก็บสำเนาในเครื่องไม่สำเร็จ กรุณาอย่าเพิ่งปิดหน้านี้','danger-top'); return; }
      showToast('บันทึกการแก้ไขแล้ว');
      render();
    });
  });
  document.querySelectorAll('.prod-unit-select').forEach(el=>{
    el.addEventListener('change', ()=>{
      const pid=Number(el.dataset.pid);
      rememberProductListUnit(products.find(product=>Number(product.id)===pid),el.value);
      render();
    });
  });
  // คลิกที่กล่องช่องเดือนแล้วเปิดปฏิทินได้เลย ไม่ต้องเล็งไปที่ไอคอนเล็กๆ (ช่องวันที่ใช้พฤติกรรมเดิม)
  document.querySelectorAll('input[type="month"].rpt-select').forEach(el=>{
    el.addEventListener('click', ()=>{ if(typeof el.showPicker==='function'){ try{ el.showPicker(); }catch(error){} } });
  });
  // --- ตัวกรองหน้าสินค้าใกล้หมด/ใกล้หมดอายุ ---
  document.querySelectorAll('[data-lowstock-mode]').forEach(el=>{
    el.addEventListener('click',()=>{
      lowStockPageFilter.stockMode=el.dataset.lowstockMode||'low';
      lowStockPageFilter.stockPage=1;
      render();
    });
  });
  const lowStockThresholdInput=document.getElementById('lowStockThresholdInput');
  if(lowStockThresholdInput){
    const applyLowStockThreshold=()=>{
      const threshold=Math.floor(Number(lowStockThresholdInput.value));
      if(!Number.isFinite(threshold)||threshold<1){
        showToast('กรุณากรอกจำนวนตั้งแต่ 1 ขึ้นไป','danger');
        lowStockThresholdInput.value=lowStockPageFilter.stockThreshold;
        return;
      }
      lowStockPageFilter.stockThreshold=threshold;
      lowStockPageFilter.stockMode='low';
      lowStockPageFilter.stockPage=1;
      safeLocalStorageSet(LOW_STOCK_FILTER_STORAGE_KEY,String(threshold),'เกณฑ์สินค้าใกล้หมด');
      render();
    };
    lowStockThresholdInput.addEventListener('change',applyLowStockThreshold);
    lowStockThresholdInput.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); applyLowStockThreshold(); } });
  }
  const lowStockWarehouseFilter=document.getElementById('lowStockWarehouseFilter');
  if(lowStockWarehouseFilter) lowStockWarehouseFilter.addEventListener('change',()=>{
    lowStockPageFilter.stockWarehouse=lowStockWarehouseFilter.value||inventoryReportDefaultWarehouseValue();
    lowStockPageFilter.stockPage=1;
    render();
  });
  document.querySelectorAll('[data-lowstock-unit]').forEach(select=>select.addEventListener('change',()=>{
    lowStockUnitSelection[Number(select.dataset.lowstockUnit)]=select.value;
    render();
  }));
  document.querySelectorAll('[data-expiry-summary-mode]').forEach(el=>{
    el.addEventListener('click',()=>{
      lowStockPageFilter.expiryMode=el.dataset.expirySummaryMode||'near';
      lowStockPageFilter.expiryPage=1;
      render();
    });
  });
  const expiryDaysInput=document.getElementById('expiryDaysInput');
  if(expiryDaysInput){
    const applyExpiryDays=()=>{
      const days=Math.floor(Number(expiryDaysInput.value));
      if(!Number.isFinite(days)||days<1){
        showToast('กรุณากรอกจำนวนวันตั้งแต่ 1 ขึ้นไป','danger');
        expiryDaysInput.value=lowStockPageFilter.expiryDays;
        return;
      }
      lowStockPageFilter.expiryDays=days;
      lowStockPageFilter.expiryMode='near';
      lowStockPageFilter.expiryPage=1;
      safeLocalStorageSet(EXPIRY_DAYS_FILTER_STORAGE_KEY,String(days),'ช่วงวันสินค้าใกล้หมดอายุ');
      render();
    };
    expiryDaysInput.addEventListener('change',applyExpiryDays);
    expiryDaysInput.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); applyExpiryDays(); } });
  }
  const expiryWarehouseFilter=document.getElementById('expiryWarehouseFilter');
  if(expiryWarehouseFilter) expiryWarehouseFilter.addEventListener('change',()=>{ lowStockPageFilter.expiryWarehouse=expiryWarehouseFilter.value||inventoryReportDefaultWarehouseValue(); lowStockPageFilter.expiryPage=1; render(); });
  document.querySelectorAll('[data-lowsort]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const [table,key]=el.dataset.lowsort.split(':');
      const s=lowStockSort[table];
      if(s.key===key) s.dir*=-1; else { s.key=key; s.dir=1; }
      if(table==='stock') lowStockPageFilter.stockPage=1; else lowStockPageFilter.expiryPage=1;
      render();
    });
  });
  document.querySelectorAll('[data-srsort]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const key=el.dataset.srsort;
      if(stockReportSort.key===key) stockReportSort.dir*=-1; else { stockReportSort.key=key; stockReportSort.dir=1; }
      render();
    });
  });
  document.querySelectorAll('[data-lowpage-stock]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const v=el.dataset.lowpageStock;
      if(v==='prev'){ if(lowStockPageFilter.stockPage>1) lowStockPageFilter.stockPage--; }
      else if(v==='next'){ lowStockPageFilter.stockPage++; }
      else { lowStockPageFilter.stockPage=Number(v); }
      render();
    });
  });
  document.querySelectorAll('[data-lowpage-expiry]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const v=el.dataset.lowpageExpiry;
      if(v==='prev'){ if(lowStockPageFilter.expiryPage>1) lowStockPageFilter.expiryPage--; }
      else if(v==='next'){ lowStockPageFilter.expiryPage++; }
      else { lowStockPageFilter.expiryPage=Number(v); }
      render();
    });
  });
  // --- เปลี่ยนหน้าสำหรับตารางเอกสาร (สั่งของขาด/สั่งซื้อสินค้า/รับเข้าสินค้า/ใบกำกับภาษี/ใบเสนอราคา) ---
  [['docpage-po','po'],['docpage-ret','ret'],['docpage-gr','gr'],['docpage-exchange','exchange'],['docpage-cashbill','cashbill'],['docpage-taxinvoice','taxinvoice'],['docpage-quotation','quotation']].forEach(([attr,key])=>{
    document.querySelectorAll(`[data-${attr}]`).forEach(el=>{
      el.addEventListener('click', ()=>{
        const v=el.dataset[attr.replace(/-([a-z])/g,(m,c)=>c.toUpperCase())];
        if(v==='prev'){ if(docListPage[key]>1) docListPage[key]--; }
        else if(v==='next'){ docListPage[key]++; }
        else { docListPage[key]=Number(v); }
        render();
      });
    });
  });
  document.querySelectorAll('[data-product-lots]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    openProductLotDetails(Number(button.dataset.productLots),Number(button.dataset.lotWarehouse)||activeWarehouseId);
  }));
  // --- ตัวกรองหน้ารายการงานเคลื่อนไหว ---
  const movementPeriod=document.getElementById('movementPeriod');
  if(movementPeriod) movementPeriod.addEventListener('change',()=>{ inventoryMovementFilter.period=movementPeriod.value; inventoryMovementFilter.page=1; render(); });
  const movementFrom=document.getElementById('movementFrom');
  if(movementFrom) movementFrom.addEventListener('change',()=>{ const iso=dmyToISO(movementFrom.value); if(iso) inventoryMovementFilter.from=iso; });
  const movementTo=document.getElementById('movementTo');
  if(movementTo) movementTo.addEventListener('change',()=>{ const iso=dmyToISO(movementTo.value); if(iso) inventoryMovementFilter.to=iso; });
  const movementMonth=document.getElementById('movementMonth');
  if(movementMonth) movementMonth.addEventListener('change',()=>{ inventoryMovementFilter.month=movementMonth.value; inventoryMovementFilter.page=1; render(); });
  const movementYear=document.getElementById('movementYear');
  if(movementYear) movementYear.addEventListener('change',()=>{ inventoryMovementFilter.year=movementYear.value; inventoryMovementFilter.page=1; render(); });
  const movementWarehouse=document.getElementById('movementWarehouse');
  if(movementWarehouse) movementWarehouse.addEventListener('change',()=>{ inventoryMovementFilter.warehouse=movementWarehouse.value; inventoryMovementFilter.page=1; render(); });
  const movementType=document.getElementById('movementType');
  if(movementType) movementType.addEventListener('change',()=>{
    const [kind,value]=movementType.value.split(':');
    inventoryMovementFilter.scope=movementType.value;
    inventoryMovementFilter.type=kind==='type'?value:'all';
    inventoryMovementFilter.direction=kind==='direction'?value:'all';
    inventoryMovementFilter.page=1;
    render();
  });
  const movementApplyBtn=document.getElementById('movementApplyBtn');
  if(movementApplyBtn) movementApplyBtn.addEventListener('click',()=>{ inventoryMovementFilter.page=1; render(); });
  const movementCategory=document.getElementById('movementCategory');
  if(movementCategory) movementCategory.addEventListener('change',()=>{ inventoryMovementFilter.category=movementCategory.value; inventoryMovementFilter.brand=''; inventoryMovementFilter.page=1; render(); });
  const movementBrand=document.getElementById('movementBrand');
  if(movementBrand) movementBrand.addEventListener('change',()=>{ inventoryMovementFilter.brand=movementBrand.value; inventoryMovementFilter.page=1; render(); });
  const movementAddCategoryBtn=document.getElementById('movementAddCategoryBtn');
  if(movementAddCategoryBtn) movementAddCategoryBtn.addEventListener('click',()=>openInventoryMovementCategoryPicker(inventoryMovementFilter));
  document.querySelectorAll('[data-movement-remove]').forEach(button=>button.addEventListener('click',()=>{
    const productId=Number(button.dataset.movementRemove);
    inventoryMovementFilter.products=inventoryMovementFilter.products.filter(id=>Number(id)!==productId);
    inventoryMovementFilter.page=1; render();
  }));
  const movementClearProducts=document.getElementById('movementClearProducts');
  if(movementClearProducts) movementClearProducts.addEventListener('click',()=>{ inventoryMovementFilter.products=[]; inventoryMovementFilter.page=1; render(); });
  const movementSearch=document.getElementById('movementSearch');
  const movementSearchResults=document.getElementById('movementSearchResults');
  if(movementSearch&&movementSearchResults){
    const addProduct=product=>{
      if(!product) return;
      if(!inventoryMovementFilter.products.some(id=>Number(id)===Number(product.id))) inventoryMovementFilter.products.push(product.id);
      inventoryMovementSearchQuery=''; inventoryMovementFilter.page=1; render();
      setTimeout(()=>document.getElementById('movementSearch')?.focus(),0);
    };
    const showResults=query=>{
      inventoryMovementSearchQuery=query;
      const value=String(query||'').trim();
      if(!value){ movementSearchResults.hidden=true; movementSearchResults.innerHTML=''; return; }
      const lower=value.toLowerCase();
      const matches=products.filter(product=>String(product.name||'').toLowerCase().includes(lower)||String(product.sku||'').toLowerCase().includes(lower)||matchesBarcode(product,value)).slice(0,15);
      if(!matches.length){ movementSearchResults.innerHTML='<div class="fav-add-noresult">ไม่พบสินค้า</div>'; movementSearchResults.hidden=false; return; }
      movementSearchResults.innerHTML=matches.map(product=>`<div class="fav-add-result" data-movement-result="${product.id}"><b>${escapeHtml(product.name)}</b><span>${escapeHtml(product.sku||'-')} · ${inventoryMovementFilter.products.some(id=>Number(id)===Number(product.id))?'เลือกไว้แล้ว':`คงเหลือ ${escapeHtml(stockInLargestUnit({...product,stock:isAllWarehousesMode()?allWarehouseStock(product.id):product.stock}))}`}</span></div>`).join('');
      movementSearchResults.hidden=false;
      movementSearchResults.querySelectorAll('[data-movement-result]').forEach(row=>{
        row.addEventListener('mousedown',event=>event.preventDefault());
        row.addEventListener('click',()=>addProduct(products.find(product=>Number(product.id)===Number(row.dataset.movementResult))));
      });
    };
    movementSearch.addEventListener('input',()=>showResults(movementSearch.value));
    movementSearch.addEventListener('focus',()=>{ if(movementSearch.value.trim()) showResults(movementSearch.value); });
    movementSearch.addEventListener('blur',()=>setTimeout(()=>{ movementSearchResults.hidden=true; },150));
    movementSearch.addEventListener('keydown',event=>{
      if(event.key!=='Enter') return;
      event.preventDefault();
      const value=movementSearch.value.trim(); if(!value) return;
      const exact=findProductByExactCode(value);
      if(exact){ addProduct(exact.product); return; }
      const first=movementSearchResults.querySelector('[data-movement-result]');
      if(first) addProduct(products.find(product=>Number(product.id)===Number(first.dataset.movementResult)));
    });
  }
  document.querySelectorAll('[data-movement-group]').forEach(row=>{
    const toggle=()=>{
      const key=decodeURIComponent(row.dataset.movementGroup||'');
      if(!key) return;
      if(inventoryMovementExpandedBills.has(key)) inventoryMovementExpandedBills.delete(key); else inventoryMovementExpandedBills.add(key);
      renderKeepScroll();
    };
    row.addEventListener('click',toggle);
    row.addEventListener('keydown',event=>{ if(event.key==='Enter'||event.key===' '){ event.preventDefault(); toggle(); } });
  });
  document.querySelectorAll('[data-document-items-toggle]').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    const key=decodeURIComponent(button.dataset.documentItemsToggle||'');
    if(!key) return;
    if(expandedDocumentItemLists.has(key)) expandedDocumentItemLists.delete(key); else expandedDocumentItemLists.add(key);
    renderKeepScroll();
  }));
  document.querySelectorAll('[data-movement-page]').forEach(button=>button.addEventListener('click',()=>{
    const value=button.dataset.movementPage,totalPages=Math.max(1,Math.ceil(inventoryMovementFilteredGroups().length/INVENTORY_MOVEMENT_PAGE_SIZE));
    if(value==='prev') inventoryMovementFilter.page=Math.max(1,inventoryMovementFilter.page-1);
    else if(value==='next') inventoryMovementFilter.page=Math.min(totalPages,inventoryMovementFilter.page+1);
    else inventoryMovementFilter.page=Math.min(totalPages,Math.max(1,Number(value)||1));
    renderKeepScroll();
  }));
  // --- ตัวกรองหน้าประวัติการขาย ---
  const hfPeriod=document.getElementById('hf_period');
  if(hfPeriod) hfPeriod.addEventListener('change',()=>{ historyFilter.period=hfPeriod.value; historyFilter.page=1; render(); });
  const hfFrom=document.getElementById('hf_from'); if(hfFrom) hfFrom.addEventListener('change',()=>{ const iso=dmyToISO(hfFrom.value); if(iso) historyFilter.from=iso; });
  const hfTo=document.getElementById('hf_to'); if(hfTo) hfTo.addEventListener('change',()=>{ const iso=dmyToISO(hfTo.value); if(iso) historyFilter.to=iso; });
  const hfMonth=document.getElementById('hf_month'); if(hfMonth) hfMonth.addEventListener('change',()=>{ historyFilter.month=hfMonth.value; historyFilter.page=1; render(); });
  const hfYear=document.getElementById('hf_year'); if(hfYear) hfYear.addEventListener('change',()=>{ historyFilter.year=hfYear.value; historyFilter.page=1; render(); });
  const hfBill=document.getElementById('hf_bill');
  if(hfBill){
    hfBill.addEventListener('input',()=>{ historyFilter.bill=hfBill.value; });
    hfBill.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); historyFilter.bill=hfBill.value; historyFilter.page=1; render(); } });
  }
  const hfApply=document.getElementById('hfApplyBtn'); if(hfApply) hfApply.addEventListener('click',()=>{ if(hfBill) historyFilter.bill=hfBill.value; historyFilter.page=1; render(); });
  document.querySelectorAll('[data-hpage]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const v=el.dataset.hpage;
      if(v==='prev'){ if(historyFilter.page>1) historyFilter.page--; }
      else if(v==='next'){ historyFilter.page++; }
      else { historyFilter.page=Number(v); }
      renderKeepScroll();
    });
  });
  const cancelProductBtn = document.getElementById('cancelProductBtn');
  if(cancelProductBtn) cancelProductBtn.addEventListener('click', ()=>{ if(mobileProductEditor){ closeMobileProductEditor(); return; } editingProductId=null; render(); });
  const changeBaseUnitBtn=document.getElementById('changeBaseUnitBtn');
  if(changeBaseUnitBtn) changeBaseUnitBtn.addEventListener('click',()=>mobileProductEditor?openMobileBaseUnitChange():openProductBaseUnitChangeModal());
  refreshUnusedProductUnitAccess();
  // toggle sections
  [['f_multiunit','multiunitBody'],['f_extrabc_toggle','extraBcBody'],['f_vendorbc_toggle','vendorBcBody']].forEach(([tog,body])=>{
    const t=document.getElementById(tog);
    if(t) t.addEventListener('change', ()=>{ const b=document.getElementById(body); if(b) b.style.display = t.checked?'':'none'; });
  });
  // add/remove unit rows
  const addUnitBtn = document.getElementById('addUnitBtn');
  if(addUnitBtn) addUnitBtn.addEventListener('click', ()=>{
    const mainUnit=(document.getElementById('f_unit')||{}).value||'หน่วยหลัก';
    const mainStock=Number(document.getElementById('f_stock')?.value)||0;
    const rawData=collectUnitRowsFromDOM({preserveInput:true});
    rawData.push({sub:'',per:'',base:mainUnit,price:'',cost:'',barcode:''});
    const data=computeUnitRowsWithStock(rawData,mainUnit,mainStock);
    const names=data.map(d=>d.sub);
    document.getElementById('unitRows').innerHTML=data.map(u=>unitRowHtml(u,mainUnit,names)).join('');
    bindUnitRowEvents();
    refreshExtraBarcodeUnitOptions();
  });
  bindUnitRowEvents();
  // add/remove extra barcode rows
  const addExtraBarcodeBtn = document.getElementById('addExtraBarcodeBtn');
  if(addExtraBarcodeBtn) addExtraBarcodeBtn.addEventListener('click', ()=>{
    const rows=document.getElementById('extraBarcodeRows');
    const names=currentProductFormUnitNames();
    const main=String(document.getElementById('f_unit')?.value||names[0]||'');
    const div=document.createElement('div'); div.innerHTML=extraBarcodeRowHtml({code:'',unit:main},names,main);
    rows.appendChild(div.firstElementChild); bindBcDelete();
  });
  const addVendorBarcodeBtn = document.getElementById('addVendorBarcodeBtn');
  if(addVendorBarcodeBtn) addVendorBarcodeBtn.addEventListener('click', ()=>{
    const rows=document.getElementById('vendorBarcodeRows');
    const div=document.createElement('div'); div.innerHTML=vendorBarcodeRowHtml({});
    rows.appendChild(div.firstElementChild); bindBcDelete();
  });
  bindBcDelete();
  const mainUnitControl=document.getElementById('f_unit');
  if(mainUnitControl) mainUnitControl.addEventListener('change',()=>setTimeout(()=>{
    if(!mainUnitControl.isConnected) return;
    remapUnusedProductUnitInputs(mainUnitControl);
    refreshUnitRows();
    refreshExtraBarcodeUnitOptions();
  },0));
  const mainEl = document.getElementById('main');
  if(mainEl && !mainEl._comboBound){
    mainEl._comboBound = true;
    mainEl.addEventListener('focus', e=>{ if(e.target.classList && e.target.classList.contains('combo-select')) e.target._prev = e.target.value; }, true);
    mainEl.addEventListener('change', e=>{
      const sel = e.target;
      if(!sel.classList || !sel.classList.contains('combo-select')) return;
      let kind = 'unit';
      if(sel.id==='f_category') kind='category';
      else if(sel.id==='f_brand') kind='brand';
      const cfg = {
        category: {label:'หมวดสินค้า', list:categories},
        brand: {label:'กลุ่มย่อย', list:brands},
        unit: {label:'หน่วยสินค้า', list:units},
      }[kind];
      if(sel.value==='__add__'){
        const name = (prompt(`พิมพ์ชื่อ${cfg.label}ใหม่:`)||'').trim();
        if(name){
          if(!cfg.list.includes(name)) cfg.list.push(name);
          addComboOption(kind, name);
          sel.value = name;
        } else { sel.value = sel._prev || ''; }
      } else if(sel.value==='__manage__'){
        sel.value = sel._prev || '';
        openManageModal(kind);
      } else {
        sel._prev = sel.value;
      }
    });
  }
  const saveProductBtn = document.getElementById('saveProductBtn');
  if(saveProductBtn) saveProductBtn.addEventListener('click', saveProduct);
  const deleteProductBtn = document.getElementById('deleteProductBtn');
  if(deleteProductBtn) deleteProductBtn.addEventListener('click', deleteUnusedProduct);
  document.querySelectorAll('[data-act="markpaid"]').forEach(el=>{
    el.addEventListener('click', ()=>{ const inv=invoicesAR.find(i=>i.id===el.dataset.id); if(inv){inv.paid=true; persistWorkspaceData(); showToast(`รับชำระ ${inv.id} แล้ว`); render();} });
  });
  document.querySelectorAll('[data-act="receivepo"]').forEach(el=>{
    el.addEventListener('click', async ()=>{
      const po = purchaseOrders.find(p=>p.id===el.dataset.id);
      if(po){
        po.status='สั่งแล้ว';
        const receivedItems=normalizeGoodsReceiptItems(po.items);
        const warehouseId=goodsReceiptWarehouseId({items:receivedItems});
        const receipt={id:'GR-'+String(++grCounter).padStart(4,'0'),po:po.id,supplier:po.supplier,date:TODAY_STR,warehouseId,items:receivedItems,total:po.total,status:'รอรับสินค้า',stockApplied:false,stockAppliedAt:''};
        goodsReceipts.unshift(receipt);
        persistWorkspaceData();
        await changeGoodsReceiptStatus(receipt.id,'รับสินค้าแล้ว');
        if(receipt.stockApplied) showToast(`รับสินค้าตาม ${po.id} เข้าคลังแล้ว`);
      }
    });
  });
  const newQuoteBtn = document.getElementById('newQuoteBtn');
  if(newQuoteBtn) newQuoteBtn.addEventListener('click',openNewQuotationForm);
  document.querySelectorAll('[data-edit-quotation]').forEach(btn=>{ btn.addEventListener('click',()=>openQuotationForm(btn.dataset.editQuotation)); });
  document.querySelectorAll('[data-sell-quotation]').forEach(btn=>{ btn.addEventListener('click',()=>sellQuotationAtPos(btn.dataset.sellQuotation)); });
  document.querySelectorAll('[data-print-quotation]').forEach(btn=>{ btn.addEventListener('click',()=>printQuotation(btn.dataset.printQuotation)); });
  document.querySelectorAll('[data-delete-quotation]').forEach(btn=>{ btn.addEventListener('click',()=>deleteQuotation(btn.dataset.deleteQuotation)); });
  document.querySelectorAll('[data-delete-tax-sale]').forEach(btn=>{ btn.addEventListener('click',e=>{ e.stopPropagation(); deleteTaxInvoiceFromSale(btn.dataset.deleteTaxSale); }); });
  document.querySelectorAll('[data-delete-tax-doc]').forEach(btn=>{ btn.addEventListener('click',e=>{ e.stopPropagation(); deleteStandaloneTaxInvoice(btn.dataset.deleteTaxDoc); }); });
  document.querySelectorAll('[data-print-tax]').forEach(btn=>{ btn.addEventListener('click',e=>{ e.stopPropagation(); printFullTaxInvoice(btn.dataset.printTax); }); });
  const newPOBtn = document.getElementById('newPOBtn');
  if(newPOBtn) newPOBtn.addEventListener('click', ()=>{ editingPOId='new'; poDraft=null; poSupplierEditorOpen=false; poRepresentativeEditorId=null; render(); });
  const newGRBtn = document.getElementById('newGRBtn');
  if(newGRBtn) newGRBtn.addEventListener('click', ()=>{ editingGRId='new'; grDraft=null; poSupplierEditorOpen=false; render(); });
  const newReturnBtn=document.getElementById('newReturnBtn');
  if(newReturnBtn) newReturnBtn.addEventListener('click',()=>{ editingReturnId='new'; returnDraft=null; poSupplierEditorOpen=false; render(); });
  const newProductExchangeBtn=document.getElementById('newProductExchangeBtn');
  if(newProductExchangeBtn) newProductExchangeBtn.addEventListener('click',()=>{ editingProductExchangeId='new'; productExchangeDraft=null; render(); });
  document.querySelectorAll('[data-product-exchange-edit]').forEach(button=>button.addEventListener('click',()=>{ editingProductExchangeId=button.dataset.productExchangeEdit; productExchangeDraft=null; render(); }));
  document.querySelectorAll('[data-product-exchange-delete]').forEach(button=>button.addEventListener('click',()=>{
    const id=button.dataset.productExchangeDelete;
    const index=productExchanges.findIndex(doc=>doc.id===id); if(index<0) return;
    if(refusePostedDocumentDeletion('exchange',productExchanges[index])) return;
    if(!confirm(`ยืนยันลบ ${id} ?`)) return;
    productExchanges.splice(index,1);
    persistWorkspaceData(); showToast(`ลบ ${id} แล้ว`); render();
  }));
  document.getElementById('cancelProductExchangeBtn')?.addEventListener('click',()=>{ editingProductExchangeId=null; productExchangeDraft=null; render(); });
  document.getElementById('saveProductExchangeBtn')?.addEventListener('click',()=>saveProductExchange(true));
  document.getElementById('confirmExchangeSentBtn')?.addEventListener('click',()=>changeProductExchangeStatus('ส่งไปเปลี่ยนแล้ว'));
  document.getElementById('confirmExchangeReceivedBtn')?.addEventListener('click',()=>changeProductExchangeStatus('รับสินค้ากลับแล้ว'));
  document.getElementById('copyExchangeOutgoingBtn')?.addEventListener('click',()=>{
    syncProductExchangeFromDOM(); const draft=activeProductExchangeDraft();
    if(draft.incomingItems.length&&!confirm('แทนที่รายการฝั่งรับกลับด้วยรายการสินค้าที่ส่งไปหรือไม่?')) return;
    draft.incomingItems=draft.outgoingItems.map((item,index)=>normalizeProductExchangeItem({...item,lineId:Date.now()+index,expiry:''})).filter(Boolean);
    render();
  });
  document.querySelectorAll('[data-product-exchange-remove]').forEach(button=>button.addEventListener('click',()=>{
    syncProductExchangeFromDOM(); const [side,indexText]=button.dataset.productExchangeRemove.split(':'),draft=activeProductExchangeDraft(),items=side==='incoming'?draft.incomingItems:draft.outgoingItems;
    items.splice(Number(indexText),1); render();
  }));
  document.querySelectorAll('.product-exchange-unit').forEach(select=>select.addEventListener('change',()=>{ syncProductExchangeFromDOM(); render(); }));
  document.querySelectorAll('.product-exchange-qty').forEach(input=>input.addEventListener('change',()=>{ syncProductExchangeFromDOM(); render(); }));
  const exchangeWarehouse=document.getElementById('productExchangeWarehouse');
  if(exchangeWarehouse) exchangeWarehouse.addEventListener('change',()=>{
    const draft=activeProductExchangeDraft(),next=Number(exchangeWarehouse.value)||0;
    if((draft.outgoingItems.length||draft.incomingItems.length)&&!confirm('เปลี่ยนคลังแล้วรายการสินค้าที่เลือกไว้จะถูกล้าง ยืนยันหรือไม่?')){ exchangeWarehouse.value=String(draft.warehouseId||''); return; }
    draft.warehouseId=next; draft.outgoingItems=[]; draft.incomingItems=[]; render();
  });
  bindProductExchangeScanners();
  document.querySelectorAll('[data-act="editpo"]').forEach(el=>{ el.addEventListener('click', ()=>{ editingPOId=el.dataset.id; poDraft=null; poSupplierEditorOpen=false; poRepresentativeEditorId=null; render(); }); });
  document.querySelectorAll('[data-act="printpo"]').forEach(el=>{ el.addEventListener('click', ()=>printPO(el.dataset.id)); });
  const cancelPOBtn = document.getElementById('cancelPOBtn');
  if(cancelPOBtn) cancelPOBtn.addEventListener('click', ()=>{ const kind=currentDocKind(); setDocEditingId(kind,null); setDocDraft(kind,null); poSupplierEditorOpen=false; poRepresentativeEditorId=null; render(); });
  const savePOBtn = document.getElementById('savePOBtn');
  if(savePOBtn) savePOBtn.addEventListener('click', async()=>{ await savePO(false); });
  const printPOFormBtn = document.getElementById('printPOFormBtn');
  if(printPOFormBtn) printPOFormBtn.addEventListener('click', async()=>{ const kind=currentDocKind(); const saved=await savePO(true); if(saved) printPO(saved,kind); });
  const addPOItemBtn = document.getElementById('addPOItemBtn');
  if(addPOItemBtn) addPOItemBtn.addEventListener('click', ()=>{
    const rows=document.getElementById('poItemRows');
    const draft=activePurchaseDraft();
    const rowHtml=currentTab==='productreturn'
      ? productReturnItemRowHtml({name:'',qty:1,unit:'',price:'',lineId:String(Date.now()),warehouseId:Number(draft?.warehouseId)||0,lotId:null},rows.children.length,draft?.warehouseId,draft?.stockApplied===true)
      : (currentTab==='purchaseorder'?shortageItemRowHtml:poItemRowHtml)({name:'',qty:1,unit:'',price:''},rows.children.length);
    const div=document.createElement('tbody'); div.innerHTML=rowHtml;
    rows.appendChild(div.firstElementChild); bindPOItemEvents();
  });
  const poSupplier = document.getElementById('po_supplier');
  document.querySelectorAll('[data-document-party]').forEach(trigger=>trigger.addEventListener('click',()=>openDocumentPartyPicker(trigger)));
  if(poSupplier) poSupplier.addEventListener('change', ()=>{ syncPOFromDOM(); poSupplierEditorOpen=false; poRepresentativeEditorId=null; render(); });
  const poWarehouse=document.getElementById('po_warehouse');
  if(poWarehouse) poWarehouse.addEventListener('change',()=>{
    const draft=activePurchaseDraft(),previous=Number(draft?.warehouseId)||0,next=Number(poWarehouse.value)||0;
    if(next===previous) return;
    if((draft?.items||[]).some(item=>item.name)&&!confirm('เปลี่ยนสาขาแล้วรายการสินค้าที่เลือกไว้จะถูกล้าง ยืนยันหรือไม่?')){
      poWarehouse.value=previous?String(previous):'';
      return;
    }
    syncPOFromDOM();
    draft.warehouseId=next;
    draft.items=[{name:'',qty:1,unit:'',price:''}];
    render();
  });
  const newPORepBtn=document.getElementById('newPORepBtn');
  if(newPORepBtn) newPORepBtn.addEventListener('click',()=>{ syncPOFromDOM(); poRepresentativeEditorId='new'; render(); });
  const editPORepBtn=document.getElementById('editPORepBtn');
  if(editPORepBtn) editPORepBtn.addEventListener('click',()=>{ syncPOFromDOM(); const draft=activePurchaseDraft(); const rep=salesRepresentatives.find(x=>x.name===draft?.supplier); if(rep){ poRepresentativeEditorId=rep.id; render(); } });
  const shortageManagedProductsBtn=document.getElementById('shortageManagedProductsBtn');
  if(shortageManagedProductsBtn) shortageManagedProductsBtn.addEventListener('click',openShortageManagedProductsModal);
  const cancelPORepEditBtn=document.getElementById('cancelPORepEditBtn');
  if(cancelPORepEditBtn) cancelPORepEditBtn.addEventListener('click',()=>{ syncPOFromDOM(); poRepresentativeEditorId=null; render(); });
  const savePORepEditBtn=document.getElementById('savePORepEditBtn');
  if(savePORepEditBtn) savePORepEditBtn.addEventListener('click',savePORepresentativeFromPO);
  const poDate = document.getElementById('po_date');
  const poCredit = document.getElementById('po_credit');
  const updateDueDate=()=>{ syncPOFromDOM(); const draft=activePurchaseDraft(); const due=document.getElementById('po_due'); if(due&&draft) due.value=isoToDMY(addDaysToDate(draft.date,draft.credit)); };
  if(poDate) poDate.addEventListener('change', updateDueDate);
  if(poCredit) poCredit.addEventListener('input', updateDueDate);
  const editPOSupplierBtn = document.getElementById('editPOSupplierBtn');
  if(editPOSupplierBtn) editPOSupplierBtn.addEventListener('click', ()=>{ if(currentTab==='goodsreceipt'&&loggedInUser()?.owner!==true){ poSupplierEditorOpen=false; showToast('LEVEL 2 แก้ไขข้อมูลผู้จำหน่ายจากใบรับสินค้าไม่ได้'); return; } syncPOFromDOM(); poSupplierEditorOpen=!poSupplierEditorOpen; render(); });
  const cancelPOSupplierEditBtn = document.getElementById('cancelPOSupplierEditBtn');
  if(cancelPOSupplierEditBtn) cancelPOSupplierEditBtn.addEventListener('click', ()=>{ syncPOFromDOM(); poSupplierEditorOpen=false; render(); });
  const savePOSupplierEditBtn = document.getElementById('savePOSupplierEditBtn');
  if(savePOSupplierEditBtn) savePOSupplierEditBtn.addEventListener('click', savePOSupplierFromPO);
  const poDiscount = document.getElementById('po_discount');
  if(poDiscount) poDiscount.addEventListener('change', ()=>{ syncPOFromDOM(); render(); });
  const poTaxMode=document.getElementById('po_tax_mode');
  if(poTaxMode) poTaxMode.addEventListener('change',()=>{ syncPOFromDOM(); render(); });
  document.querySelectorAll('[data-doc-menu]').forEach(btn=>{ btn.addEventListener('click', e=>{ e.stopPropagation(); openDocMenu=openDocMenu===btn.dataset.docMenu?null:btn.dataset.docMenu; render(); }); });
  // จัดตำแหน่งเมนูแก้ไขให้ยึดกับปุ่มจริงบนจอ (position:fixed) กันไม่ให้โดนตัดโดยขอบโค้งของตาราง
  const openMenuEl=document.querySelector('.doc-action-menu');
  if(openMenuEl){
    const trigger=document.querySelector('.doc-menu-btn.open');
    if(trigger){
      const rect=trigger.getBoundingClientRect();
      const menuWidth=205;
      let left=rect.right-menuWidth;
      if(left<8) left=8;
      let top=rect.bottom+4;
      openMenuEl.style.left=left+'px';
      openMenuEl.style.top=top+'px';
      // ถ้าล้นขอบล่างจอ ให้เด้งขึ้นด้านบนปุ่มแทน
      requestAnimationFrame(()=>{
        const menuRect=openMenuEl.getBoundingClientRect();
        if(menuRect.bottom>window.innerHeight-8){
          openMenuEl.style.top=(rect.top-menuRect.height-4)+'px';
        }
      });
    }
  }
  document.querySelectorAll('[data-doc-action]').forEach(btn=>{ btn.addEventListener('click', async e=>{ e.stopPropagation(); await handleDocumentAction(btn.dataset.kind,btn.dataset.id,btn.dataset.docAction); }); });
  document.querySelectorAll('[data-doc-sort]').forEach(btn=>{ btn.addEventListener('click', ()=>{ const [kind,key]=btn.dataset.docSort.split(':'); const sort=documentSort[kind]; if(sort.key===key) sort.dir*=-1; else documentSort[kind]={key,dir:['date','due','total','elapsed'].includes(key)?-1:1}; render(); }); });
  document.querySelectorAll('.doc-status-select').forEach(sel=>{ sel.addEventListener('change', ()=>{ const k=sel.dataset.statusKind; if(k==='po'){ const doc=purchaseOrders.find(x=>x.id===sel.dataset.id); if(doc){ doc.status=sel.value; persistWorkspaceData(); showToast(`เปลี่ยนสถานะเป็น “${sel.value}” แล้ว`); render(); } }else if(k==='ret'){ changeProductReturnStatus(sel.dataset.id,sel.value); }else if(k==='gr'){ if(sel.value==='ชำระเรียบร้อย'){ const doc=goodsReceipts.find(x=>x.id===sel.dataset.id); if(doc?.stockApplied===true) openGoodsReceiptPayment(sel.dataset.id); else changeGoodsReceiptStatus(sel.dataset.id,sel.value); }else changeGoodsReceiptStatus(sel.dataset.id,sel.value); } }); });
  document.querySelectorAll('.doc-list thead .doc-check').forEach(box=>{ box.addEventListener('change', ()=>{ document.querySelectorAll('.doc-list tbody .doc-check').forEach(rowBox=>rowBox.checked=box.checked); updateDocumentSelectionUI(); }); });
  document.querySelectorAll('.doc-list tbody .doc-check').forEach(box=>{ box.addEventListener('change', updateDocumentSelectionUI); });
  const docSelectedClear=document.getElementById('docSelectedClear');
  if(docSelectedClear) docSelectedClear.addEventListener('click',()=>{ document.querySelectorAll('.doc-list .doc-check').forEach(box=>box.checked=false); updateDocumentSelectionUI(); });
  const docBulkPrint=document.getElementById('docBulkPrint');
  if(docBulkPrint) docBulkPrint.addEventListener('click',()=>printSelectedDocuments());
  const docBulkDelete=document.getElementById('docBulkDelete');
  if(docBulkDelete) docBulkDelete.addEventListener('click',()=>deleteSelectedDocuments(document.getElementById('docBulkbar')?.dataset.kind||'po',selectedDocumentIds()));
  bindPOItemEvents();
  bindDocumentProductScanner();
  const newWarehouseBtn=document.getElementById('newWarehouseBtn');
  if(newWarehouseBtn) newWarehouseBtn.addEventListener('click',()=>{ addingWarehouse=true; editingWarehouseId=null; render(); });
  document.querySelectorAll('[data-edit-warehouse]').forEach(btn=>{ btn.addEventListener('click',()=>{ editingWarehouseId=Number(btn.dataset.editWarehouse); addingWarehouse=true; render(); }); });
  document.querySelectorAll('[data-delete-warehouse]').forEach(btn=>{ btn.addEventListener('click',()=>deleteWarehouse(Number(btn.dataset.deleteWarehouse))); });
  ['cancelWarehouseBtn','cancelWarehouseBottomBtn'].forEach(id=>{ const btn=document.getElementById(id); if(btn) btn.addEventListener('click',()=>{ addingWarehouse=false; editingWarehouseId=null; render(); }); });
  ['saveWarehouseBtn','saveWarehouseBottomBtn'].forEach(id=>{ const btn=document.getElementById(id); if(btn) btn.addEventListener('click',saveWarehouse); });

  const newTransferBtn = document.getElementById('newTransferBtn');
  if(newTransferBtn) newTransferBtn.addEventListener('click', ()=>{ editingTransferId='new'; transferDraft=null; render(); });
  document.querySelectorAll('[data-print-transfer]').forEach(btn=>btn.addEventListener('click',()=>printTransfer(btn.dataset.printTransfer)));
  document.querySelectorAll('[data-edit-transfer]').forEach(btn=>{ btn.addEventListener('click',()=>{ editingTransferId=btn.dataset.editTransfer; transferDraft=null; render(); }); });
  document.querySelectorAll('[data-cancel-transfer]').forEach(btn=>{ btn.addEventListener('click',()=>cancelTransfer(btn.dataset.cancelTransfer)); });
  document.querySelectorAll('[data-delete-transfer]').forEach(btn=>{ btn.addEventListener('click',()=>deleteCancelledTransfer(btn.dataset.deleteTransfer)); });
  ['cancelTransferBtn','cancelTransferBottomBtn'].forEach(id=>{ const btn=document.getElementById(id); if(btn) btn.addEventListener('click',()=>{ editingTransferId=null; transferDraft=null; render(); }); });

  ['saveTransferBtn','saveTransferBottomBtn'].forEach(id=>{ const btn=document.getElementById(id); if(btn) btn.addEventListener('click',async()=>{ await saveTransfer(false); }); });
  const addTransferItemBtn=document.getElementById('addTransferItemBtn');
  if(addTransferItemBtn) addTransferItemBtn.addEventListener('click',()=>{ syncTransferFromDOM(); activeTransferDraft().items.push(blankTransferItem()); render(); });
  const transferFrom=document.getElementById('transfer_from');
  if(transferFrom) transferFrom.addEventListener('change',()=>{ syncTransferFromDOM(); render(); });
  const transferTo=document.getElementById('transfer_to');
  if(transferTo) transferTo.addEventListener('change',syncTransferFromDOM);
  bindTransferItemEvents();
}
