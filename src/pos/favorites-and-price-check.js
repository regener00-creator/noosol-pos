function openManageFavModal(){
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal fav-manage-modal">
    <div class="modal-head"><h3>จัดการสินค้าโปรด</h3><button class="modal-close">×</button></div>
    <div class="fav-add-box">
      <input type="text" id="favAddSearch" placeholder="ค้นหาชื่อ / รหัส / บาร์โค้ด เพื่อเพิ่ม" autocomplete="off">
      <div id="favAddResults" class="fav-add-results" hidden></div>
    </div>
    <div class="manage-list" id="favManageList">${favManageListHtml()}</div>
    <div class="fav-manage-footer"><button class="btn primary" id="favSaveBtn">เสร็จสิ้น</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;

  overlay.querySelector('#favSaveBtn').onclick=()=>{ close(); render(); };

  const listEl=overlay.querySelector('#favManageList');
  const refreshList=()=>{
    listEl.innerHTML=favManageListHtml();
    bindListButtons();
  };
  const moveFavorite=(index,direction,focusProductId=null)=>{
    const nextIndex=index+direction;
    if(index<0||index>=favorites.length||nextIndex<0||nextIndex>=favorites.length) return false;
    [favorites[index],favorites[nextIndex]]=[favorites[nextIndex],favorites[index]];
    saveFavorites();
    refreshList();
    if(focusProductId!=null) listEl.querySelector(`[data-fav-product-id="${focusProductId}"]`)?.focus();
    return true;
  };
  function bindListButtons(){
    let draggedRow=null;
    listEl.querySelectorAll('[data-fav-drag-index]').forEach(row=>{
      row.addEventListener('dragstart',event=>{
        if(event.target.closest('select,button')){ event.preventDefault(); return; }
        draggedRow=row;
        row.classList.add('is-dragging');
        event.dataTransfer.effectAllowed='move';
        event.dataTransfer.setData('text/plain',row.dataset.favProductId||'');
      });
      row.addEventListener('dragover',event=>{
        if(!draggedRow||draggedRow===row) return;
        event.preventDefault();
        event.dataTransfer.dropEffect='move';
        const bounds=row.getBoundingClientRect();
        const insertAfter=event.clientY>bounds.top+(bounds.height/2);
        listEl.insertBefore(draggedRow,insertAfter?row.nextElementSibling:row);
      });
      row.addEventListener('drop',event=>event.preventDefault());
      row.addEventListener('dragend',()=>{
        if(!draggedRow) return;
        draggedRow.classList.remove('is-dragging');
        const byProductId=new Map(favorites.map(entry=>[favoriteProductId(entry),entry]));
        const reordered=[...listEl.querySelectorAll('[data-fav-product-id]')]
          .map(item=>byProductId.get(Number(item.dataset.favProductId)))
          .filter(Boolean);
        const changed=reordered.some((entry,index)=>favoriteProductId(entry)!==favoriteProductId(favorites[index]));
        draggedRow=null;
        if(changed){
          favorites=reordered;
          saveFavorites();
          showToast('บันทึกลำดับสินค้าโปรดแล้ว');
        }
        refreshList();
      });
      row.addEventListener('keydown',event=>{
        if(event.target!==row||!event.altKey||(event.key!=='ArrowUp'&&event.key!=='ArrowDown')) return;
        event.preventDefault();
        moveFavorite(Number(row.dataset.favDragIndex),event.key==='ArrowUp'?-1:1,Number(row.dataset.favProductId));
      });
    });
    listEl.querySelectorAll('[data-fav-remove]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const index=Number(btn.dataset.favRemove);
        if(index<0||index>=favorites.length) return;
        favorites.splice(index,1);
        saveFavorites();
        refreshList();
      });
    });
    listEl.querySelectorAll('[data-fav-unit-change]').forEach(select=>{
      select.addEventListener('change',()=>{
        const index=Number(select.dataset.favUnitChange);
        const product=products.find(item=>Number(item.id)===favoriteProductId(favorites[index]));
        if(!product) return;
        favorites[index]=favoriteEntryForProduct(product,select.value);
        saveFavorites();
        refreshList();
      });
    });
  }
  bindListButtons();

  // ค้นหาสินค้าเพื่อเพิ่ม
  const searchEl=overlay.querySelector('#favAddSearch');
  const resultsEl=overlay.querySelector('#favAddResults');
  const renderResults=(q)=>{
    q=(q||'').trim();
    if(!q){ resultsEl.hidden=true; resultsEl.innerHTML=''; return; }
    const ql=q.toLowerCase();
    const matches=activeProducts().filter(p=> !favoriteHasProduct(p.id) && ( p.name.toLowerCase().includes(ql) || (p.sku||'').toLowerCase().includes(ql) || matchesBarcode(p,q) )).slice(0,20);
    if(!matches.length){ resultsEl.innerHTML='<div class="fav-add-noresult">ไม่พบสินค้า หรือเพิ่มไว้ครบแล้ว</div>'; resultsEl.hidden=false; return; }
    resultsEl.innerHTML=matches.map(p=>{
      const exactUnit=productUnitOptions(p).find(option=>option.barcode&&option.barcode===q)?.name||extraBarcodeUnitForCode(p,q)||p.unit;
      return `<div class="fav-unit-result" data-fav-result="${p.id}"><div class="fav-unit-result-info"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.sku||'-')}</span></div><select class="fav-unit-select" data-fav-result-unit="${p.id}" aria-label="เลือกหน่วย ${escapeHtml(p.name)}">${favoriteUnitOptionsHtml(p,exactUnit)}</select><button type="button" class="btn primary small fav-unit-add" data-fav-add="${p.id}">เพิ่ม</button></div>`;
    }).join('');
    resultsEl.hidden=false;
    resultsEl.querySelectorAll('[data-fav-add]').forEach(btn=>{
      btn.addEventListener('mousedown', e=>e.preventDefault());
      btn.addEventListener('click', ()=>{
        const pid=Number(btn.dataset.favAdd);
        const product=products.find(item=>Number(item.id)===pid);
        const unit=resultsEl.querySelector(`[data-fav-result-unit="${pid}"]`)?.value;
        if(product&&!favoriteHasProduct(pid)) favorites.push(favoriteEntryForProduct(product,unit));
        saveFavorites();
        searchEl.value=''; resultsEl.hidden=true; resultsEl.innerHTML='';
        refreshList();
        searchEl.focus();
      });
    });
  };
  searchEl.addEventListener('input', ()=>renderResults(searchEl.value));
  searchEl.addEventListener('focus', ()=>renderResults(searchEl.value));
  searchEl.addEventListener('blur', ()=>setTimeout(()=>{
    if(!resultsEl.contains(document.activeElement)) resultsEl.hidden=true;
  },150));
  searchEl.addEventListener('keydown', e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      const first=resultsEl.querySelector('[data-fav-add]');
      if(first) first.click();
    }
  });
}

function openStockCheckModal(pid){
  const p = products.find(x=>x.id===pid); if(!p) return;
  const rows = stockAllUnits(p);
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:380px;">
    <div class="modal-head"><h3>คงเหลือ: ${escapeHtml(p.name)}</h3><button class="modal-close">×</button></div>
    <div class="modal-sub" id="stockCheckSub">คงเหลือทั้งหมด ${escapeHtml(p.stock)} ${escapeHtml(p.unit||'')} · แสดงผลตามหน่วยสินค้า</div>
    <div class="manage-list">${rows.map(r=>`<div class="manage-item"><span>${escapeHtml(r.name)}</span><b class="mono">${escapeHtml(Math.round(r.amount*100)/100)}</b></div>`).join('')}</div>
    <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 16px 16px;"><button class="btn ghost stock-check-cancel">ปิด</button><button class="btn primary" id="stockCheckAdjustBtn" ${canPerformPageAction('edit','inspectionlists')?'':'disabled'}>ไปตรวจนับและปรับสต๊อก</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('.stock-check-cancel').onclick=close;

  overlay.querySelector('#stockCheckAdjustBtn')?.addEventListener('click',()=>{
    close();
    currentTab='stockcontrol';
    stockControlMode='count';
    if(!stockEditItems.includes(p.id)) stockEditItems.unshift(p.id);
    stockEditPage=1;
    render();
  });
}

function openPriceCheckModal(){
  const canViewCost=loggedInUser()?.owner===true;
  const pcUnitSel={}; // per-product manually-chosen unit override, scoped to this modal session
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal" style="width:480px;max-height:82vh;">
    <div class="modal-head"><h3>เช็คราคาสินค้า</h3><button class="modal-close">×</button></div>
    <div class="modal-sub">พิมพ์ชื่อ / รหัส / ยิงบาร์โค้ด เพื่อดูข้อมูลสินค้า (ไม่เพิ่มลงบิล)</div>
    <div style="padding:0 16px 12px;"><input id="pcInput" placeholder="ค้นหาหรือสแกนบาร์โค้ด..." style="width:100%;padding:11px 13px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;"></div>
    <div class="manage-list" id="pcResult"><div class="fav-empty" style="padding:16px;">เริ่มพิมพ์เพื่อค้นหา...</div></div>
  </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;

  const input=overlay.querySelector('#pcInput');
  const result=overlay.querySelector('#pcResult');
  const doSearch=()=>{
    const q=input.value.trim();
    if(!q){ result.innerHTML=`<div class="fav-empty" style="padding:16px;">เริ่มพิมพ์เพื่อค้นหา...</div>`; return; }
    const ql=q.toLowerCase();
    const matches=activeProducts().filter(p=>p.name.toLowerCase().includes(ql)||matchesBarcode(p,q)||(p.sku||'').toLowerCase().includes(ql)).slice(0,10);
    if(matches.length===0){ result.innerHTML=`<div class="fav-empty" style="padding:16px;">ไม่พบสินค้า "${escapeHtml(q)}"</div>`; return; }
    result.innerHTML=matches.map(p=>{
      const unitOpts=[{sub:p.unit, price:p.price, cost:p.cost||0, barcode:p.barcode||''}, ...((p.units||[]).map(u=>({sub:u.sub, price:u.price||0, cost:u.cost||0, barcode:u.barcode||''})))];
      // ถ้าคำค้นตรงกับบาร์โค้ดของหน่วยเสริม (เช่น กล่อง/ลัง) ให้เลือกหน่วยนั้นเป็นค่าเริ่มต้น เว้นแต่ผู้ใช้เคยเลือกหน่วยเองไว้แล้วในการ์ดนี้
      const subUnit=(p.units||[]).find(u=>(u.barcode||'').includes(q));
      const defaultUnit=subUnit?subUnit.sub:(extraBarcodeUnitForCode(p,q)||p.unit);
      const selUnit=pcUnitSel[p.id]||defaultUnit;
      const unitInfo=unitOpts.find(u=>u.sub===selUnit)||unitOpts[0];
      const unitFieldHtml=unitOpts.length>1
        ? `<select class="pc-unit-select" data-pid="${p.id}">${unitOpts.map(u=>`<option value="${escapeHtml(u.sub)}" ${u.sub===unitInfo.sub?'selected':''}>${escapeHtml(u.sub)}</option>`).join('')}</select>`
        : `<b class="mono">${escapeHtml(unitInfo.sub)}</b>`;
      return `<div class="pc-item">
        <div class="pc-name">${escapeHtml(p.name)}</div>
        <div class="pc-grid">
          <div><span>รหัส</span><b class="mono">${escapeHtml(p.sku||'-')}</b></div>
          <div><span>หน่วย</span>${unitFieldHtml}</div>
          <div><span>ขาย</span><b class="mono">${fmtMoney(unitInfo.price)}</b></div>
          ${canViewCost?`<div><span>ทุน</span><b class="mono">${fmtMoney(unitInfo.cost)}</b></div>`:'<div class="pc-grid-placeholder" aria-hidden="true"></div>'}
          <div><span>วันหมดอายุ</span><b class="mono">${fmtDateShort(p.expiry)}</b></div>
          <div><span>คงเหลือ</span><b class="mono">${escapeHtml(stockInLargestUnit(p))}</b></div>
        </div>
      </div>`;
    }).join('');
    result.querySelectorAll('.pc-unit-select').forEach(sel=>{
      sel.addEventListener('change', ()=>{
        pcUnitSel[Number(sel.dataset.pid)]=sel.value;
        doSearch();
      });
    });
  };
  input.addEventListener('input', doSearch);
  input.addEventListener('keydown', e=>{
    if(e.key!=='Enter') return;
    doSearch();
    // เลือกข้อความทั้งหมดในช่องทันทีหลังค้นหา เพื่อให้ยิงบาร์โค้ด/พิมพ์ครั้งถัดไปเขียนทับอัตโนมัติ
    // (เครื่องสแกนบาร์โค้ดส่วนใหญ่ส่ง Enter ต่อท้ายเสมอเป็นมาตรฐาน จึงใช้จังหวะนี้เตรียมช่องให้พร้อมรับค่าใหม่)
    setTimeout(()=>input.select(),0);
  });
  setTimeout(()=>input.focus(), 50);
}
