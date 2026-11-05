function navigatePosSearchResults(event){
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||
    !['ArrowDown','ArrowUp','Tab','Enter','Escape'].includes(event.key)) return false;
  const search=document.querySelector('#main #search');
  const selected=event.target.closest?.('.pos-results .pos-result[data-act="add"]');
  if(!search||!search.value.trim()||event.target!==search&&!selected) return false;
  if(event.key==='Enter'){
    if(!selected)return false;
    event.preventDefault();
    if(!event.repeat)addProductFromPOSAction(selected,{focusCart:true});
    return true;
  }
  event.preventDefault();
  closePosUnitCycleMenu();
  if(event.key==='Escape'){
    searchQuery='';search.value='';
    refreshPOSSearchResults();
    search.focus();
    return true;
  }
  // Flush a pending search before focusing a result so the debounce cannot remove it.
  if(posSearchRenderTimer!==null)refreshPOSSearchResults();
  const results=[...document.querySelectorAll('.pos-results .pos-result[data-act="add"]:not(.disabled)')];
  const step=event.key==='ArrowUp'||event.key==='Tab'&&event.shiftKey?-1:1;
  const index=results.indexOf(selected);
  const next=index<0?results.at(step<0?-1:0):results[index+step];
  (next||search).focus({preventScroll:true});
  (next||search).scrollIntoView({block:'nearest',inline:'nearest'});
  return true;
}

function confirmPosCartLineRemoval(lineId){
  const index=cart.findIndex(line=>String(line.lineId)===String(lineId));
  if(index<0||cart[index].autoFreeFromPromo) return;
  const line=cart[index];
  if(!confirm(`ลบรายการที่ ${index+1} “${line.name||'รายการกรอกเอง'}” ออกจากบิลนี้หรือไม่?`)) return;
  const quantity=document.activeElement;
  if(quantity?.matches('.line-qty')&&quantity.dataset.line!==String(lineId)) quantity.blur();
  cart=cart.filter(item=>item.lineId!==line.lineId);
  posActiveLineId=null;
  render();
}

function setPosCartLineUnit(lineId,unitName){
  const line=cart.find(item=>String(item.lineId)===String(lineId));
  if(!line||line.custom||line.autoFreeFromPromo) return false;
  const product=products.find(item=>item.id===line.pid);
  const option=product&&productUnitOptions(product).find(item=>item.name===unitName);
  if(!option) return false;
  line.unit=option.name;line.unitName=option.name;line.cost=option.cost;line.factor=option.factor;
  line.priceSource='standard';
  applySalePriceToLine(line,product,option.name,{preserveQuotation:false});
  posActiveLineId=line.lineId;
  render();
  return true;
}

function navigatePosCartArrows(event){
  if(event.shiftKey||event.altKey||event.metaKey||event.isComposing||event.defaultPrevented) return;
  const vertical=event.key==='ArrowUp'||event.key==='ArrowDown';
  if(!vertical&&event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
  const cell=event.target.closest?.('.pos-table [data-pos-cart-line] > td');
  if(!cell) return;
  if(!event.ctrlKey&&cell.cellIndex!==4&&cell.cellIndex!==5) return;
  event.preventDefault();
  closePosUnitCycleMenu();
  if(!event.ctrlKey&&(cell.cellIndex===4&&event.key==='ArrowLeft'||cell.cellIndex===5&&event.key==='ArrowRight')) return;
  const row=cell.parentElement;
  const step=event.key==='ArrowUp'||event.key==='ArrowLeft'?-1:1;
  const rows=[...row.parentElement.querySelectorAll('tr[data-pos-cart-line]')];
  const nextRow=vertical?rows[rows.indexOf(row)+step]:row;
  const column=vertical?cell.cellIndex:cell.cellIndex+step;
  if(!nextRow?.cells[column]) return;
  const lineId=nextRow.dataset.posCartLine;
  // Committing the quantity can replace every cell, so resolve the destination after blur.
  if(event.target.matches('.line-qty')) event.target.blur();
  const next=document.querySelector(`.pos-table [data-pos-cart-line="${CSS.escape(lineId)}"]`)?.cells[column];
  if(!next) return;
  next.tabIndex=-1;
  (next.querySelector('input:enabled,select:enabled,button:enabled')||next).focus();
}

function navigatePosCartFields(event){
  if(!['Tab','Enter'].includes(event.key)||event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey) return;
  const search=document.querySelector('#main #search');
  const target=event.target;
  if(!search||!target.isConnected) return;
  const row=target.closest?.('[data-pos-cart-line]');
  if(target!==search&&target!==document.body&&!row) return;
  if(event.key==='Enter'&&(target===search&&search.value.trim()||target.closest?.('button'))) return;

  const fields=[...document.querySelectorAll('.pos-table :is(.line-unit,.custom-line-unit,.line-qty):enabled')];
  const step=event.shiftKey?-1:1;
  // Caps Lock keeps the scanner focused while its unit menu is open.
  const confirmingUnit=target===search&&event.key==='Enter'&&!event.shiftKey;
  const anchor=confirmingUnit?document.querySelector('.line-unit.pos-unit-cycle-target')||target:target;
  const index=fields.indexOf(anchor);
  const lineFields=fields.filter(field=>field.dataset.line===String(row?.dataset.posCartLine??posActiveLineId));
  const entryFields=target!==search&&lineFields.length?lineFields:fields;
  const next=index<0?entryFields.at(step<0?-1:0):fields[index+step];
  event.preventDefault();
  closePosUnitCycleMenu();
  // Blurring a changed quantity commits it and can rebuild the entire cart.
  if(target.matches?.('.line-qty')) target.blur();
  let destination=next;
  if(next&&!next.isConnected){
    const updatedRow=document.querySelector(`[data-pos-cart-line="${CSS.escape(next.dataset.line)}"]`);
    destination=updatedRow?.querySelector(next.matches('.line-qty')?'.line-qty':'.line-unit,.custom-line-unit');
  }
  (destination||document.getElementById('search'))?.focus();
}

function closePosUnitCycleMenu(){
  const menu=document.getElementById('posUnitCycleMenu');
  if(!menu) return false;
  menu.remove();
  document.querySelectorAll('.pos-unit-cycle-target').forEach(select=>{
    select.classList.remove('pos-unit-cycle-target');select.removeAttribute('aria-controls');
  });
  return true;
}

function showPosUnitCycleMenu(lineId){
  closePosUnitCycleMenu();
  const select=[...document.querySelectorAll('.line-unit')].find(item=>String(item.dataset.line)===String(lineId));
  if(!select) return;
  select.scrollIntoView({block:'nearest',inline:'nearest'});
  const bounds=select.getBoundingClientRect();
  const menu=document.createElement('div');
  menu.id='posUnitCycleMenu';menu.className='pos-unit-cycle-menu';menu.setAttribute('role','listbox');
  menu.setAttribute('aria-label','หน่วยสินค้า · กด Caps Lock เพื่อเปลี่ยนหน่วย');
  menu.setAttribute('aria-live','polite');
  menu.innerHTML=[...select.options].map((option,index)=>`<button type="button" role="option" tabindex="-1" id="posUnitCycleOption${index}" aria-selected="${option.selected}" class="pos-unit-cycle-option ${option.selected?'selected':''}" data-pos-cycle-unit="${escapeHtml(option.value)}">${escapeHtml(option.textContent)}</button>`).join('');
  document.getElementById('main').append(menu);
  select.classList.add('pos-unit-cycle-target');select.setAttribute('aria-controls',menu.id);
  const selected=menu.querySelector('[aria-selected="true"]');
  if(selected) menu.setAttribute('aria-activedescendant',selected.id);
  const width=Math.min(Math.max(bounds.width,100),window.innerWidth-16);
  menu.style.width=`${width}px`;
  menu.style.left=`${Math.max(8,Math.min(bounds.left,window.innerWidth-width-8))}px`;
  const below=window.innerHeight-bounds.bottom-8,above=bounds.top-8;
  const placeBelow=below>=Math.min(menu.scrollHeight,240)||below>=above;
  menu.style.maxHeight=`${Math.max(36,Math.min(240,placeBelow?below:above))}px`;
  menu.style.top=`${placeBelow?bounds.bottom:Math.max(8,bounds.top-menu.getBoundingClientRect().height)}px`;
  if(selected) menu.scrollTop=Math.max(0,selected.offsetTop-(menu.clientHeight-selected.offsetHeight)/2);
  menu.addEventListener('pointerdown',event=>event.preventDefault());
  menu.addEventListener('click',event=>{
    const option=event.target.closest('[data-pos-cycle-unit]');
    if(option&&setPosCartLineUnit(lineId,option.dataset.posCycleUnit)) document.getElementById('search')?.focus({preventScroll:true});
  });
}

function cyclePosCartLineUnit(target){
  const row=target?.closest?.('[data-pos-cart-line]');
  const requestedId=row?.dataset.posCartLine??posActiveLineId;
  const line=cart.find(item=>String(item.lineId)===String(requestedId))||[...cart].reverse().find(item=>!item.autoFreeFromPromo);
  if(!line||line.custom||line.autoFreeFromPromo) return false;
  const product=products.find(item=>item.id===line.pid);
  const options=product?productUnitOptions(product):[];
  if(options.length<2) return false;
  // Commit a quantity being edited before rendering the next unit.
  if(target?.matches?.('.line-qty')) target.blur();
  const index=options.findIndex(option=>option.name===line.unit);
  const next=options[(index+1)%options.length];
  if(!setPosCartLineUnit(line.lineId,next.name)) return false;
  document.getElementById('search')?.focus({preventScroll:true});
  showPosUnitCycleMenu(line.lineId);
  return true;
}
