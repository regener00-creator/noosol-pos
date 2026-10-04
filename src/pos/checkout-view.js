function renderCheckout(){
  const selectedCustomer=activeSaleCustomer();
  if(!selectedCustomer||!cart.length) saleLoyaltySelection=null;
  const shiftBanner=currentCashShift
    ?`<div class="cash-shift-topbar-action open"><span><strong>${escapeHtml(currentCashShift.shiftNo)} เปิดอยู่</strong> : เงินตั้งต้น ${fmtMoney(currentCashShift.openingCash)} บาท · ${escapeHtml(currentCashShift.openedByName)}</span><button class="btn ghost small" data-open-cash-shift>สรุปชำระ</button></div>`
    :`<div class="cash-shift-topbar-action"><button class="btn primary small" data-open-cash-shift>เปิดระบบชำระ</button></div>`;
  let rowsHtml='';
  const promoResult=applyPromotions(cart);
  const taxSummary=cartTaxSummary(promoResult);
  const promoHints=getPromotionUpsellHints(cart);
  const pendingPromoLineIds=new Set(promoHints.filter(hint=>hint.qualifiedSets===0).map(hint=>hint.lineId));
  if(cart.length===0){
    rowsHtml = `<tr><td colspan="8" class="pos-empty">ไม่พบรายการสินค้า — ค้นหาหรือสแกนบาร์โค้ดเพื่อเพิ่ม</td></tr>`;
  } else {
    cart.forEach((line,idx)=>{
      const p=products.find(x=>x.id===line.pid);
      const promoLine=promoResult.lines[idx];
      const lt=promoLine.promoId?promoLine.promoLineTotal:line.price*line.qty;
      const lineVatMode=line.custom?(taxSummary.registered?'incl':'none'):effectiveProductVatMode(p);
      const displayLineTotal=grossAmountForVatMode(lt,lineVatMode,taxSummary.registered);
      if(line.autoFreeFromPromo){
        // บรรทัดของแถมอัตโนมัติจากโปรฯ "ซื้อสินค้า A แถมสินค้า B" - ลบ/แก้ไขเองไม่ได้ ต้องลดจำนวนสินค้าหลัก (A) ก่อนถึงจะหายไปเอง
        rowsHtml += `<tr class="pos-autofree-row">
          <td class="mono">${String(idx+1).padStart(3,'0')}</td>
          <td class="mono">${escapeHtml(productBarcodeForUnit(p,line.unit)||'-')}</td>
          <td>🎁 ${escapeHtml(line.name)}<br><small class="pos-promo-tag promo-active">ของแถม — ${escapeHtml(line.autoFreePromoName||'')}</small></td>
          <td class="mono num">0.00</td>
          <td>${escapeHtml(line.unit)}</td>
          <td class="pos-qty mono">${line.qty}</td>
          <td class="mono num">0.00</td>
          <td class="pos-del-cell"><button class="pos-del" disabled title="เป็นของแถม — ลดจำนวนสินค้าหลักเพื่อเอาออก" style="opacity:.35;cursor:not-allowed;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg></button></td>
        </tr>`;
        return;
      }
      const opts = p?productUnitOptions(p):[];
      const unitCell = line.custom
        ? `<input class="custom-line-input custom-line-unit" data-custom-unit data-line="${line.lineId}" value="${escapeHtml(line.unit)}" list="inlineCustomUnits" placeholder="หน่วย">`
        : opts.length>1
        ? `<select class="line-unit" data-line="${line.lineId}">${opts.map(o=>`<option value="${escapeHtml(o.name)}" ${o.name===line.unit?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>`
        : escapeHtml(line.unit);
      const linkedPromo=(!line.custom && line.pid)?findMatchingPromotion(line):null;
      const displayUnitPrice=grossAmountForVatMode(line.price,lineVatMode,taxSummary.registered);
      const dispensingLabel=normalizeDispensingLabel(line.dispensingLabel);
      const itemNameHtml=line.custom?`<div class="custom-line-wrap"><input class="custom-line-input custom-line-name" data-custom-name data-line="${line.lineId}" value="${escapeHtml(line.name)}" placeholder="กรอกชื่อรายการ"></div>`:escapeHtml(line.name);
      const priceCell = line.custom
        ? `<input class="custom-line-input custom-line-price" data-custom-price data-line="${line.lineId}" type="number" min="0" step="0.01" value="${line.price}" placeholder="0.00">`
        : line.priceSource==='customer'
        ? `<span>${fmtMoney(displayUnitPrice)}<br><small class="pos-customer-price-tag">ราคาพิเศษ ${escapeHtml(selectedCustomer?.name||'ลูกค้า')}</small></span>`
        : line.priceSource==='quotation'
        ? `<span>${fmtMoney(displayUnitPrice)}<br><small class="pos-quotation-price-tag">ราคาจากใบเสนอราคา</small></span>`
        : promoLine.promoId
        ? `<span title="${escapeHtml(promoLine.promoNote)}">${fmtMoney(displayUnitPrice)}<br><small class="pos-promo-tag promo-active">🏷 ${escapeHtml(promoLine.promoName)}</small></span>`
        : linkedPromo
        ? `<span title="${escapeHtml(promotionValueLabel(linkedPromo))}">${fmtMoney(displayUnitPrice)}<br><small class="pos-promo-tag promo-pending">🏷 ${escapeHtml(linkedPromo.name)}</small></span>`
        : fmtMoney(displayUnitPrice);
      rowsHtml += `<tr${pendingPromoLineIds.has(line.lineId)?' class="pos-promo-pending-row"':''}>
        <td class="mono">${String(idx+1).padStart(3,'0')}</td>
        <td class="mono">${escapeHtml(productBarcodeForUnit(p,line.unit)||'-')}</td>
        <td><div class="pos-item-name-line"><div class="pos-item-name-content">${itemNameHtml}</div><button class="pos-med-label-btn ${dispensingLabel?'active':''}" type="button" data-medicine-label-line="${line.lineId}" title="${dispensingLabel?'แก้ไขฉลากยา':'จัดทำฉลากยา'}">ฉลากยา</button></div>${dispensingLabel?`<small class="pos-med-label-summary">${escapeHtml(medicineLabelSummary(dispensingLabel))}</small>`:''}</td>
        <td class="mono num">${priceCell}</td>
        <td class="line-unit-cell">${unitCell}</td>
        <td class="pos-qty"><input class="line-qty" type="number" min="1" step="1" value="${line.qty}" data-line="${line.lineId}"></td>
        <td class="mono num"><span data-line-total="${line.lineId}">${fmtMoney(displayLineTotal)}</span></td>
        <td class="pos-del-cell"><button class="pos-del" data-act="removeline" data-line="${line.lineId}" title="ลบ"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg></button></td>
      </tr>`;
      if(promoLine.promoFreeQty>0){
        rowsHtml += `<tr class="pos-free-row">
          <td class="mono"></td>
          <td class="mono"></td>
          <td colspan="2">🎁 แถมฟรี — ${escapeHtml(line.name)}</td>
          <td>${escapeHtml(line.unit)}</td>
          <td class="pos-qty mono">${promoLine.promoFreeQty}</td>
          <td class="mono num">0.00</td>
          <td></td>
        </tr>`;
      }
    });
  }
  const {subtotal,discount,total:grand,vat,beforeVat,registered}=taxSummary;

  // แถบสินค้าโปรด
  let favHtml = '';
  if(showFavorites){
    const favProds = favorites.map(entry=>{
      const product=products.find(item=>Number(item.id)===favoriteProductId(entry));
      if(!isProductActive(product)) return null;
      const unit=favoriteSelectedUnit(entry,product);
      const option=productUnitOptions(product).find(item=>item.name===unit)||productUnitOptions(product)[0];
      return {product,unit,price:Number(option?.price)||0};
    }).filter(Boolean);
    favHtml = `<div class="fav-strip">
      <div class="fav-head"><span>⭐ สินค้าโปรด</span><button class="btn ghost small" id="manageFavBtn">จัดการ</button></div>
      <div class="fav-items">${favProds.length? favProds.map(item=>`<button class="fav-card" data-act="add" data-id="${item.product.id}" data-unit="${escapeHtml(item.unit)}"><div class="fav-name">${escapeHtml(item.product.name)}</div><div class="fav-price mono">${escapeHtml(item.unit)} - ${fmtFavoritePrice(item.price)}</div></button>`).join('') : '<div class="fav-empty">ยังไม่มีสินค้าโปรด — กดปุ่ม "จัดการ" เพื่อเพิ่ม</div>'}</div>
    </div>`;
  }

  return `${shiftBanner}
    <div class="pos-searchrow">
      <div class="pos-search"><span class="pos-bc"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/></svg></span><input id="search" placeholder="ค้นหาสินค้า / รหัส / สแกนบาร์โค้ด (ctrl + Q)" value="${escapeHtml(searchQuery)}" autocomplete="off"></div>
      <button class="pos-smallest-unit-btn ${posSmallestUnitOnce?'active':''}" id="posSmallestUnitBtn" type="button" aria-pressed="${posSmallestUnitOnce?'true':'false'}"><kbd>Home</kbd><span>หน่วยเล็กสุด</span></button>
    </div>
    ${posSmallestUnitOnce?'<div class="pos-smallest-unit-status"><span class="pos-smallest-unit-status-dot"></span><strong>พร้อมขายหน่วยเล็กสุด</strong><span>ยิงหรือเลือกสินค้า 1 รายการ · กด Home หรือ Esc เพื่อยกเลิก</span></div>':''}
    ${searchQuery ? renderSearchResults() : ''}
    <div class="pos-grid">
      <div class="pos-left">
        <div class="pos-title-row"><div class="pos-title">รายการ : ${formatSaleRefDisplay(saleRef)}</div><button class="btn ghost" id="addCustomItemBtn">+ รายการกรอกเอง</button></div>
        <datalist id="inlineCustomUnits">${units.map(unit=>`<option value="${escapeHtml(unit)}">`).join('')}</datalist><table class="grid-table pos-table"><colgroup><col class="pt-idx"><col class="pt-barcode"><col class="pt-name"><col class="pt-price"><col class="pt-unit"><col class="pt-qty"><col class="pt-total"><col class="pt-del"></colgroup><thead><tr><th>รายการที่</th><th>บาร์โค้ดสินค้า</th><th>ชื่อ</th><th>ราคา</th><th>หน่วย</th><th>จำนวน</th><th>รวม</th><th></th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
        ${favHtml}
      </div>
      <div class="pos-right">
        <div class="pos-customer-slot">
          <button class="pos-customer-select-btn ${selectedCustomer?'selected':''}" id="openCustomerPickerBtn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="8" r="4"/><path d="M3 21v-2a7 7 0 0 1 14 0v2M17 11h4M19 9v4"/></svg>
            <span><strong>${escapeHtml(selectedCustomer?.name||'ลูกค้าทั่วไป')}</strong><small>${selectedCustomer?'กดเพื่อเปลี่ยนลูกค้า':'กดเพื่อเลือกลูกค้า'}</small></span>
          </button>
        </div>
        <div id="customerLoyaltyPanel" data-customer-loyalty-host>${customerLoyaltyPanelHtml(selectedCustomer)}</div>
        <div class="pos-actions">
          <button class="pos-action ${showFavorites?'on':''}" id="favBtn"><span class="pa-ic">⭐</span> สินค้าโปรด</button>
          <button class="pos-action" id="priceCheckBtn"><span class="pa-ic">🔍</span> เช็คราคา</button>
          <button class="pos-action" id="histBtn"><span class="pa-ic">🧾</span> ประวัติการขาย</button>
        </div>
        <div class="pos-summary">
          <div class="sumrow"><span>รวมทั้งหมด</span><span class="mono" id="posSubtotalValue">${fmtMoney(subtotal)}</span></div>
          <div class="sumrow"><span>ส่วนลด</span><span class="sumdiscount"><button class="btn ghost small" id="editDiscountBtn">✎ ส่วนลด</button> <span class="mono" id="posDiscountValue">${fmtMoney(discount)}</span></span></div>
          <div class="sumrow"><span id="posBeforeVatLabel">${registered?'มูลค่าก่อน VAT':'มูลค่าสินค้า'}</span><span class="mono" id="posBeforeVatValue">${fmtMoney(beforeVat)}</span></div>
          <div class="sumrow"><span id="posVatLabel">${registered?'ภาษีมูลค่าเพิ่ม 7%':'ไม่คิด VAT (กิจการยังไม่จด VAT)'}</span><span class="mono" id="posVatValue">${fmtMoney(vat)}</span></div>
          <div class="sumrow grand"><span>ยอดชำระ</span><span class="mono" id="posGrandValue">${fmtMoney(grand)}</span></div>
        </div>
        <div class="pos-footer">
          <button class="pos-fbtn pay" id="checkoutBtn" ${cart.length===0||!currentCashShift||checkoutInFlight?'disabled':''}>[F2] เก็บเงิน</button>
          <button class="pos-fbtn hold" id="holdBtn" title="พักออเดอร์" aria-label="พักออเดอร์">พัก</button>
          <button class="pos-fbtn danger" id="clearBillBtn" title="ยกเลิกออเดอร์นี้" aria-label="ยกเลิกออเดอร์"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg></button>
        </div>
        ${promoHints.length?`<div class="pos-promo-hints">${promoHints.map(h=>`<div class="pos-promo-hint"><div class="pos-promo-hint-head">💡 ${escapeHtml(h.name)} - ${escapeHtml(h.unit)}</div><div class="pos-promo-hint-body"><div><span>ชื่อโปร:</span> ${escapeHtml(h.promoName)}</div><div><span>ผลลัพธ์:</span> ${escapeHtml(h.note)}</div><div class="pos-promo-hint-nudge">ซื้อเพิ่มอีก ${h.needMore} ${escapeHtml(h.unit)} เพื่อรับสิทธิ์โปรโมชั่นนี้</div></div></div>`).join('')}</div>`:''}
      </div>
    </div>${posSalesHistoryModalOpen?renderPOSSalesHistoryModal():''}`;
}

function recalcPOSCartDOM(){
  const {subtotal,discount,total:grand,vat,beforeVat,registered}=cartTaxSummary();
  const set=(id,value)=>{ const el=document.getElementById(id); if(el) el.textContent=fmtMoney(value); };
  set('posSubtotalValue',subtotal); set('posDiscountValue',discount); set('posBeforeVatValue',beforeVat); set('posVatValue',vat); set('posGrandValue',grand);
  const beforeLabel=document.getElementById('posBeforeVatLabel'),vatLabel=document.getElementById('posVatLabel');
  if(beforeLabel) beforeLabel.textContent=registered?'มูลค่าก่อน VAT':'มูลค่าสินค้า';
  if(vatLabel) vatLabel.textContent=registered?'ภาษีมูลค่าเพิ่ม 7%':'ไม่คิด VAT (กิจการยังไม่จด VAT)';
  refreshCustomerLoyaltyPanel();
}

function renderSearchResults(){
  const q = searchQuery.trim();
  if(!q) return '';
  const ql = q.toLowerCase();
  const matches = activeProducts().filter(p=>p.name.toLowerCase().includes(ql)||matchesBarcode(p,q)||(p.sku||'').toLowerCase().includes(ql)).slice(0,8);
  if(matches.length===0) return `<div class="pos-results"><div class="pos-noresult">ไม่พบสินค้า "${escapeHtml(q)}"</div></div>`;
  return `<div class="pos-results">${matches.map(p=>{
    const outLabel=p.stock<0?' · สต็อกติดลบ':(p.stock===0?' · หมดสต็อก':'');
    return `<div class="pos-result" data-act="add" data-id="${escapeHtml(p.id)}">
      <div><div class="pr-name">${escapeHtml(p.name)}</div><div class="pr-meta">${escapeHtml(p.sku||'')} · คงเหลือ <span class="${p.stock<0?'stock-negative':''}">${escapeHtml(p.stock)}</span> ${escapeHtml(p.unit||'')}</div></div>
      <div class="pr-price mono">${fmtMoney(p.price)}${escapeHtml(outLabel)}</div>
    </div>`;
  }).join('')}</div>`;
}

function salesHistoryItemsPreview(items){
  const list=items||[];
  return `<div class="history-preview">${list.length?list.map(item=>`${escapeHtml(item.name)} ×${escapeHtml(item.qty)}`).join('<br>'):'-'}</div>`;
}
function salesHistoryItemsFull(items){
  const list=items||[];
  if(!list.length) return '-';
  return `<div class="history-preview">${list.map(item=>`${escapeHtml(item.name)} ×${escapeHtml(item.qty)}`).join('<br>')}</div>`;
}

const HISTORY_PAGE_SIZE = 10;
function saleHistoryTimeDisplay(value){
  const text=String(value||'').trim();
  if(!text) return '-';
  // sale_time จากฐานข้อมูลเป็น ISO ที่มีเขตเวลา ส่วน data.time เป็นเวลาไทยแบบเดิม
  if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)){
    const parsed=new Date(text);
    if(!Number.isNaN(parsed.getTime())){
      const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(parsed);
      const hour=parts.find(part=>part.type==='hour')?.value;
      const minute=parts.find(part=>part.type==='minute')?.value;
      if(hour&&minute) return `${hour}:${minute}`;
    }
  }
  const match=text.match(/(?:^|[T\s])(\d{1,2}):(\d{2})/);
  return match?`${match[1].padStart(2,'0')}:${match[2]}`:'-';
}
function historyDateRange(){
  const f=historyFilter;
  if(f.period==='month'){
    const mm=f.month||TODAY_STR.slice(0,7);
    const [y,m]=mm.split('-').map(Number);
    const from=`${y}-${String(m).padStart(2,'0')}-01`;
    const lastDay=new Date(y,m,0).getDate();
    const to=`${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    return {from,to};
  }
  if(f.period==='year'){
    const y=f.year||TODAY_STR.slice(0,4);
    return {from:`${y}-01-01`, to:`${y}-12-31`};
  }
  return {from:f.from||TODAY_STR, to:f.to||TODAY_STR};
}
function filterSalesHistory(rows,filter,range){
  const bill=String(filter?.bill||'').trim().toLowerCase();
  return (rows||[]).filter(sale=>{
    const date=String(sale?.date||'').slice(0,10);
    const billNumber=`${sale?.ref||''} ${sale?.id||''}`.toLowerCase();
    return date>=range.from&&date<=range.to&&(!bill||billNumber.includes(bill));
  });
}
function saleHistoryCustomerDisplay(sale){
  const member=sale?.member;
  const memberName=member&&typeof member==='object'?member.name:member;
  const name=String(memberName||sale?.customerName||sale?.customerSnapshot?.name||sale?.cashReceiptA4Meta?.customer?.name||sale?.fullTaxInvoice?.customer?.name||sale?.name||'').trim();
  return !name||name==='ลูกค้าทั่วไป'?'-':name;
}
