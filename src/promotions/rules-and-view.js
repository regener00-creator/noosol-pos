// ===== ระบบโปรโมชั่น =====
function promotionStatusInfo(promo){
  const today=TODAY_STR;
  if(!promo.active) return {label:'ปิดใช้งาน',cls:'promo-off'};
  if(promo.startDate && today<promo.startDate) return {label:'ยังไม่เริ่ม',cls:'promo-pending'};
  if(promo.endDate && today>promo.endDate) return {label:'หมดอายุ',cls:'promo-expired'};
  return {label:'ใช้งานอยู่',cls:'promo-live'};
}
function promotionTypeLabel(type){
  return type==='bundle'?'ราคาพิเศษเมื่อซื้อครบจำนวน':type==='buygetdiff'?'ซื้อและแถม':'ลดราคา';
}
function promotionTargetLabel(promo){
  if(promo.scope==='buygetdiff'){
    const buyP=products.find(x=>x.id===promo.bgdBuyProductId);
    const getP=products.find(x=>x.id===promo.bgdGetProductId);
    return `ซื้อ: ${buyP?buyP.name:'สินค้าถูกลบไปแล้ว'} (${promo.bgdBuyUnit}) › แถม: ${getP?getP.name:'สินค้าถูกลบไปแล้ว'} (${promo.bgdGetUnit})`;
  }
  if(promo.scope==='product'){
    const p=products.find(x=>x.id===promo.productId);
    return p?`${p.name} (${promo.unit||p.unit})`:'สินค้าถูกลบไปแล้ว';
  }
  const cat=promo.category||'ทุกหมวดหมู่', br=promo.brand?` › ${promo.brand}`:'';
  if(promo.categoryMode==='select'){
    const count=(promo.items||[]).length;
    return `${cat}${br} — เจาะจง ${count} รายการ`;
  }
  return `${cat}${br} (หน่วย: ${promo.unit||'ทุกหน่วย'})`;
}
function promotionValueLabel(promo){
  if(promo.type==='discount') return promo.discountMode==='percent'?`ลด ${promo.discountValue||0}%`:`ลด ${fmtMoney(promo.discountValue||0)} บาท`;
  if(promo.type==='bundle') return `ซื้อครบ ${promo.bundleQty||0} ชิ้น ราคา ${fmtMoney(promo.bundlePrice||0)}`;
  if(promo.type==='buygetdiff'){
    const getP=products.find(x=>x.id===promo.bgdGetProductId);
    return `ซื้อครบ ${promo.bgdBuyQty||0} ${promo.bgdBuyUnit||'หน่วย'} แถม ${getP?getP.name:'สินค้า'} ${promo.bgdGetQty||0} ${promo.bgdGetUnit||'หน่วย'}`;
  }
  return '-';
}

// ===== เฟส 2: ฟังก์ชันคำนวณโปรโมชั่นกลาง =====
// ใช้ร่วมกันได้ทุกจุดที่ต้องคิดราคาสินค้า (POS, ใบเสนอราคา, ใบกำกับภาษี)
// ไม่แก้ cart/items เดิมโดยตรง แต่รับ "บรรทัดสินค้า" เข้ามาแล้วคืนผลคำนวณแยกออกมาต่างหาก

// เช็คว่าโปรโมชั่นนี้ใช้งานได้ ณ วันนี้หรือไม่ (เปิดอยู่ + อยู่ในช่วงเวลาที่กำหนด)
function isPromotionLiveToday(promo){
  if(!promo.active) return false;
  if(promo.startDate && TODAY_STR<promo.startDate) return false;
  if(promo.endDate && TODAY_STR>promo.endDate) return false;
  return true;
}

// รวบรวมคู่ "สินค้า+หน่วย" ทั้งหมดที่ถูกใช้ไปแล้วในโปรโมชั่นที่เปิดใช้งานอยู่ (active=true) ไม่สนวันที่เริ่ม/สิ้นสุด
// ใช้เช็คกันเลือกสินค้า+หน่วยซ้ำข้าม scope (สินค้ารายตัว และ หมวดหมู่/แบรนด์เจาะจง)
// excludePromotionId: ไม่นับโปรฯ ตัวที่กำลังแก้ไขอยู่เอง (กันชนกับตัวเอง)
function getUsedPromotionSlots(excludePromotionId){
  const slots=new Set(); // key: `${productId}::${unit}`
  promotions.forEach(promo=>{
    if(!promo.active) return;
    if(promo.id===excludePromotionId) return;
    if(promo.scope==='product'){
      if(promo.productId && promo.unit) slots.add(`${promo.productId}::${promo.unit}`);
    } else if(promo.scope==='category'){
      (promo.items||[]).forEach(it=>{ if(it.productId && it.unit) slots.add(`${it.productId}::${it.unit}`); });
    } else if(promo.scope==='buygetdiff'){
      if(promo.bgdBuyProductId && promo.bgdBuyUnit) slots.add(`${promo.bgdBuyProductId}::${promo.bgdBuyUnit}`);
      if(promo.bgdGetProductId && promo.bgdGetUnit) slots.add(`${promo.bgdGetProductId}::${promo.bgdGetUnit}`);
    }
  });
  return slots;
}
function isPromotionSlotUsed(productId,unit,excludePromotionId){
  if(!productId||!unit) return false;
  return getUsedPromotionSlots(excludePromotionId).has(`${productId}::${unit}`);
}
// หาว่าคู่ (productId,unit) นี้ถูกใช้ในโปรฯ ตัวไหน (เพื่อโชว์ชื่อโปรฯ ที่ชนกันในข้อความแจ้งเตือน)
function findPromotionUsingSlot(productId,unit,excludePromotionId){
  for(const promo of promotions){
    if(!promo.active) continue;
    if(promo.id===excludePromotionId) continue;
    if(promo.scope==='product' && promo.productId===productId && promo.unit===unit) return promo;
    if(promo.scope==='category' && (promo.items||[]).some(it=>it.productId===productId && it.unit===unit)) return promo;
    if(promo.scope==='buygetdiff' && ((promo.bgdBuyProductId===productId && promo.bgdBuyUnit===unit) || (promo.bgdGetProductId===productId && promo.bgdGetUnit===unit))) return promo;
  }
  return null;
}

// หาโปรโมชั่นที่ตรงกับบรรทัดสินค้าหนึ่งบรรทัด (ตาม pid+unit หรือ category/brand+unit หรือ category/brand+เจาะจงรายการ)
// line ต้องมี: {pid, unit} เป็นอย่างน้อย (unit คือหน่วยที่ขายจริงในบรรทัดนั้น)
function findMatchingPromotion(line){
  if(!line || !line.pid) return null;
  // ราคาพิเศษรายลูกค้าและราคาที่ตกลงในใบเสนอราคาเป็นราคาสุทธิแล้ว
  // จึงไม่ซ้อนโปรโมชั่นทั่วไปโดยอัตโนมัติ
  if(line.priceSource==='customer'||line.priceSource==='quotation') return null;
  const product=products.find(p=>p.id===line.pid);
  if(!product) return null;
  const live=promotions.filter(isPromotionLiveToday);
  // ให้ความสำคัญกับโปรฯ ที่ผูกสินค้ารายตัวก่อน (เจาะจงกว่าหมวดหมู่)
  const productMatch=live.find(promo=>promo.scope==='product' && promo.productId===line.pid && promo.unit===line.unit);
  if(productMatch) return productMatch;
  const categoryMatch=live.find(promo=>{
    if(promo.scope!=='category') return false;
    const productCategory=String(product.category||'').trim()||'ไม่ทราบหมวดหมู่';
    if(promo.category && promo.category!==productCategory) return false;
    if(promo.brand && promo.brand!==(product.brand||'ทั่วไป')) return false;
    if(promo.categoryMode==='select'){
      // โหมดเจาะจงเลือกสินค้า: เช็คว่า pid+unit นี้อยู่ในรายการที่เลือกไว้ไหม (แต่ละสินค้ามีหน่วยของตัวเอง)
      return (promo.items||[]).some(it=>it.productId===line.pid && it.unit===line.unit);
    }
    // โหมดเอาทุกสินค้า (ค่าเริ่มต้น รวมถึงโปรฯ เก่าก่อนมี categoryMode): ใช้ unit เดียวทั้งหมวด
    return promo.unit===line.unit;
  });
  return categoryMatch||null;
}

// คำนวณผลของโปรโมชั่นหนึ่งบรรทัด คืนค่า {unitPrice, lineTotal, freeQty, promoId, promoName, note}
// unitPrice/lineTotal คือราคาสุทธิหลังหักโปรฯ แล้ว (ยังไม่รวมส่วนลดท้ายบิลแยกต่างหาก)
// freeQty เก็บไว้ในโครงสร้างสำหรับอนาคต ปัจจุบันไม่มีประเภทโปรฯ ใดกำหนดค่านี้ (buygetdiff จัดการของแถมผ่าน reconcileAutoFreeLines แทน)
function calcPromotionForLine(line){
  const originalUnitPrice=Number(line.price)||0;
  const qty=Number(line.qty)||0;
  const base={unitPrice:originalUnitPrice,lineTotal:originalUnitPrice*qty,freeQty:0,promoId:null,promoName:'',note:''};
  // บรรทัดของแถมอัตโนมัติจาก "ซื้อ A แถม B" ต้องราคา 0 คงที่เสมอ ไม่คำนวณโปรฯ อื่นซ้อนทับ (แม้สินค้า B จะมีโปรฯ อื่นผูกอยู่ก็ตาม)
  if(line.autoFreeFromPromo){
    return {unitPrice:0,lineTotal:0,freeQty:0,promoId:line.autoFreeFromPromo,promoName:line.autoFreePromoName||'',note:'ของแถม'};
  }
  if(qty<=0) return base;
  const promo=findMatchingPromotion(line);
  if(!promo) return base;

  if(promo.type==='discount'){
    let discountedUnitPrice=originalUnitPrice;
    if(promo.discountMode==='percent'){
      discountedUnitPrice=originalUnitPrice*(1-(Number(promo.discountValue)||0)/100);
    } else {
      discountedUnitPrice=originalUnitPrice-(Number(promo.discountValue)||0);
    }
    discountedUnitPrice=Math.max(0,discountedUnitPrice);
    return {unitPrice:discountedUnitPrice,lineTotal:discountedUnitPrice*qty,freeQty:0,promoId:promo.id,promoName:promo.name,note:promotionValueLabel(promo)};
  }

  if(promo.type==='bundle'){
    const bundleQty=Number(promo.bundleQty)||0, bundlePrice=Number(promo.bundlePrice)||0;
    if(bundleQty<=0) return base;
    const bundleSets=Math.floor(qty/bundleQty);
    const remainder=qty-(bundleSets*bundleQty);
    if(bundleSets<=0) return base; // ยังซื้อไม่ครบเงื่อนไข ใช้ราคาปกติ
    const total=(bundleSets*bundlePrice)+(remainder*originalUnitPrice);
    return {unitPrice:total/qty,lineTotal:total,freeQty:0,promoId:promo.id,promoName:promo.name,note:promotionValueLabel(promo)};
  }

  return base;
}

// รับ array ของบรรทัดสินค้า [{pid,unit,price,qty,...}] คืน array ผลลัพธ์คู่ขนาน (ไม่แก้ไขต้นฉบับ)
// พร้อมสรุปยอดรวมก่อน/หลังโปรฯ และรายชื่อโปรฯ ที่ถูกใช้ในบิลนี้
function applyPromotions(lines){
  const results=(lines||[]).map(line=>({line,calc:calcPromotionForLine(line)}));
  const originalTotal=results.reduce((sum,r)=>sum+(Number(r.line.price)||0)*(Number(r.line.qty)||0),0);
  const discountedTotal=results.reduce((sum,r)=>sum+r.calc.lineTotal,0);
  const usedPromotions=[...new Map(results.filter(r=>r.calc.promoId).map(r=>[r.calc.promoId,{id:r.calc.promoId,name:r.calc.promoName}])).values()];
  return {
    lines:results.map(r=>({...r.line,promoUnitPrice:r.calc.unitPrice,promoLineTotal:r.calc.lineTotal,promoFreeQty:r.calc.freeQty,promoId:r.calc.promoId,promoName:r.calc.promoName,promoNote:r.calc.note})),
    originalTotal,
    discountedTotal,
    totalSaved:Math.max(0,originalTotal-discountedTotal),
    usedPromotions,
  };
}

// ซิงค์บรรทัด "ของแถมอัตโนมัติ" ในตะกร้าให้ตรงกับโปรโมชั่นแบบ "ซื้อสินค้า A แถมสินค้า B" (scope='buygetdiff') ที่เปิดใช้งานอยู่
// ทำงานทุกครั้งก่อน render: ลบของแถมเดิมออกก่อนเสมอ แล้วคำนวณใหม่ทั้งหมดตามสินค้า A ที่มีอยู่จริงในตะกร้าขณะนั้น (กันข้อมูลเก่าค้าง)
function reconcileAutoFreeLines(){
  cart = cart.filter(l=>!l.autoFreeFromPromo);
  const promos = promotions.filter(p=>p.scope==='buygetdiff' && isPromotionLiveToday(p));
  promos.forEach(promo=>{
    const buyLine = cart.find(l=>l.pid===promo.bgdBuyProductId && l.unit===promo.bgdBuyUnit && !l.custom && l.priceSource!=='customer' && l.priceSource!=='quotation');
    if(!buyLine) return;
    const buyQty = Number(promo.bgdBuyQty)||0;
    if(buyQty<=0) return;
    const qty = Number(buyLine.qty)||0;
    const fullSets = Math.floor(qty/buyQty);
    if(fullSets<=0) return;
    const freeQty = fullSets*(Number(promo.bgdGetQty)||0);
    if(freeQty<=0) return;
    const p = products.find(x=>x.id===promo.bgdGetProductId);
    if(!p) return;
    const unit = promo.bgdGetUnit||p.unit;
    let factor=1, cost=productUnitCost(p,p.unit,1);
    if(unit!==p.unit){
      const u=(p.units||[]).find(x=>x.sub===unit);
      factor=u?.factor||1;
      cost=productUnitCost(p,unit,factor);
    }
    cart.push({lineId:lineCounter++,pid:promo.bgdGetProductId,name:p.name,unit,unitName:unit,price:0,cost,factor,qty:freeQty,autoFreeFromPromo:promo.id,autoFreePromoName:promo.name});
  });
}

// หาโปรฯ ที่ "เกือบเข้าเงื่อนไข" ต่อบรรทัดในตะกร้า (ยังไม่ครบจำนวนขั้นต่ำ) เพื่อเตือนพนักงานให้ชวนลูกค้าซื้อเพิ่ม
// ใช้ได้เฉพาะโปรฯ ที่มีขั้นต่ำจำนวนจริง (bundle, buygetdiff) — ลด%/เงินสด ไม่มีขั้นต่ำจึงไม่ต้องเตือน
function getPromotionUpsellHints(lines){
  const hints=[];
  (lines||[]).forEach(line=>{
    if(!line.pid || Number(line.qty)<=0 || line.priceSource==='customer' || line.priceSource==='quotation') return;
    if(line.autoFreeFromPromo) return; // บรรทัดของแถมเองไม่ต้องเตือนซ้ำ (ไม่ใช่ "ใกล้เข้าเงื่อนไข" แต่เป็นผลลัพธ์ที่ได้แล้ว)
    const qty=Number(line.qty)||0;
    const promo=findMatchingPromotion(line);
    if(promo && promo.type==='bundle'){
      const bundleQty=Number(promo.bundleQty)||0;
      if(bundleQty>0){
        const remainder=qty%bundleQty;
        if(remainder>0){
          hints.push({lineId:line.lineId,name:line.name,unit:line.unit,promoName:promo.name,needMore:bundleQty-remainder,qualifiedSets:Math.floor(qty/bundleQty),note:promotionValueLabel(promo)});
        }
      }
      return;
    }
    // เช็คโปรฯ "ซื้อสินค้าหนึ่ง แถมอีกสินค้าหนึ่ง" (buygetdiff) แยกต่างหาก เพราะ findMatchingPromotion ไม่ครอบคลุม scope นี้
    const bgdPromo=promotions.find(p=>p.scope==='buygetdiff' && isPromotionLiveToday(p) && p.bgdBuyProductId===line.pid && p.bgdBuyUnit===line.unit);
    if(bgdPromo){
      const buyQty=Number(bgdPromo.bgdBuyQty)||0;
      if(buyQty>0){
        const remainder=qty%buyQty;
        if(remainder>0){
          hints.push({lineId:line.lineId,name:line.name,unit:line.unit,promoName:bgdPromo.name,needMore:buyQty-remainder,qualifiedSets:Math.floor(qty/buyQty),note:promotionValueLabel(bgdPromo)});
        }
      }
    }
  });
  return hints;
}

function renderPromotions(){
  if(editingPromotionId!==null) return renderPromotionForm();
  const q=searchQuery.trim().toLowerCase();
  const list=promotions.filter(promo=>!q || (promo.name||'').toLowerCase().includes(q));
  return `<div class="rpt promotion-list-page"><div class="pagehead promotion-list-topbar-source"><div></div><button class="btn primary" id="newPromotionBtn">+ สร้างโปรโมชั่น</button></div>
    <div class="toolbar"><div></div><div class="searchbar"><input id="search" placeholder="ค้นหาจากชื่อโปรโมชั่น" value="${searchQuery}"></div></div>
    <div class="doc-list-wrap seamless-table-wrap">
    <table class="grid-table doc-head-blue contact-summary-table"><thead><tr><th>ชื่อโปรโมชั่น</th><th>ประเภท</th><th>เงื่อนไข</th><th>ผลลัพธ์</th><th>ช่วงเวลา</th><th>สถานะ</th><th style="width:120px;"></th></tr></thead>
    <tbody>${list.map(promo=>{
      const status=promotionStatusInfo(promo);
      const period=(promo.startDate||promo.endDate)?`${promo.startDate?isoToDMY(promo.startDate):'ไม่จำกัด'} - ${promo.endDate?isoToDMY(promo.endDate):'ไม่จำกัด'}`:'ไม่จำกัดเวลา';
      return `<tr>
      <td>${escapeHtml(promo.name||'-')}</td>
      <td>${promotionTypeLabel(promo.type)}</td>
      <td style="text-align:left;">${escapeHtml(promotionTargetLabel(promo))}</td>
      <td>${escapeHtml(promotionValueLabel(promo))}</td>
      <td class="mono">${period}</td>
      <td><span class="promo-status ${status.cls}">${status.label}</span></td>
      <td style="text-align:center;"><div class="history-actions"><button class="history-icon-btn" data-act="editpromotion" data-id="${promo.id}" title="แก้ไข" aria-label="แก้ไข ${escapeHtml(promo.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button><button class="history-icon-btn danger" data-act="deletepromotion" data-id="${promo.id}" title="ลบ" aria-label="ลบ ${escapeHtml(promo.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div></td>
    </tr>`;}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px;">ยังไม่มีโปรโมชั่น</td></tr>'}</tbody></table>
    </div></div>`;
}

// แสดงรายการสินค้าที่เจาะจงเลือกไว้ในโหมด "หมวดหมู่/แบรนด์ - เจาะจงเลือกสินค้า" พร้อม dropdown หน่วยแยกต่อตัว
function renderPromoCategoryItemsList(items){
  if(!items.length) return '<div style="font-size:12.5px;color:var(--text-muted);padding:8px 0;">ยังไม่ได้เลือกสินค้า — กดปุ่ม "เลือกสินค้า" ด้านบน</div>';
  return items.map((it,idx)=>{
    const p=products.find(x=>x.id===it.productId);
    if(!p) return '';
    const unitOpts=[p.unit,...(p.units||[]).map(u=>u.sub)];
    const optionsHtml=unitOpts.map(u=>{
      const isCurrent=it.unit===u;
      const usedBy=!isCurrent?findPromotionUsingSlot(p.id,u,editingPromotionId):null;
      if(usedBy) return `<option value="${escapeHtml(u)}" disabled>${escapeHtml(u)} (ใช้ในโปรฯ "${escapeHtml(usedBy.name)}" แล้ว)</option>`;
      return `<option value="${escapeHtml(u)}" ${isCurrent?'selected':''}>${escapeHtml(u)}</option>`;
    }).join('');
    return `<div class="promo-item-row" data-idx="${idx}">
      <div class="promo-item-row-name">${escapeHtml(p.name)} <span style="color:var(--text-muted);">(${escapeHtml(p.sku||'-')})</span></div>
      <select class="promo-item-unit" data-idx="${idx}">${optionsHtml}</select>
      <button type="button" class="promo-item-remove" data-idx="${idx}" title="เอาออก"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>`;
  }).join('');
}
function renderPromotionForm(){
  const isNew=editingPromotionId==='new';
  const promo=isNew?{name:'',active:true,startDate:'',endDate:'',scope:'product',productId:null,category:'',brand:'',categoryMode:'all',items:[],unit:'',type:'discount',discountMode:'percent',discountValue:'',bundleQty:'',bundlePrice:'',bgdBuyProductId:null,bgdBuyUnit:'',bgdBuyQty:'',bgdGetProductId:null,bgdGetUnit:'',bgdGetQty:''}:promotions.find(x=>x.id===editingPromotionId);
  if(!promo) return '<div class="panel">ไม่พบโปรโมชั่น</div>';
  if(promoDraftItemsSyncedFor!==editingPromotionId){
    currentPromoDraftItems=(promo.items||[]).map(it=>({...it}));
    promoDraftItemsSyncedFor=editingPromotionId;
  }
  const selectedProduct=promo.productId?products.find(p=>p.id===promo.productId):null;
  const unitOptionsForProduct=p=>{
    if(!p) return '';
    const opts=[p.unit,...(p.units||[]).map(u=>u.sub)];
    return opts.map(u=>{
      const isCurrent=promo.unit===u; // หน่วยที่ตัวเองใช้อยู่แล้ว (ตอนแก้ไข) ไม่ถือว่าชนกับตัวเอง
      const usedBy=!isCurrent?findPromotionUsingSlot(p.id,u,editingPromotionId):null;
      if(usedBy) return `<option value="${escapeHtml(u)}" disabled>${escapeHtml(u)} (ใช้ในโปรฯ "${escapeHtml(usedBy.name)}" แล้ว)</option>`;
      return `<option value="${escapeHtml(u)}" ${isCurrent?'selected':''}>${escapeHtml(u)}</option>`;
    }).join('');
  };
  const selectedBgdBuyProduct=promo.bgdBuyProductId?products.find(p=>p.id===promo.bgdBuyProductId):null;
  const selectedBgdGetProduct=promo.bgdGetProductId?products.find(p=>p.id===promo.bgdGetProductId):null;
  const bgdUnitOptions=(p,currentUnit)=>{
    if(!p) return '';
    const opts=[p.unit,...(p.units||[]).map(u=>u.sub)];
    return opts.map(u=>{
      const isCurrent=currentUnit===u;
      const usedBy=!isCurrent?findPromotionUsingSlot(p.id,u,editingPromotionId):null;
      if(usedBy) return `<option value="${escapeHtml(u)}" disabled>${escapeHtml(u)} (ใช้ในโปรฯ "${escapeHtml(usedBy.name)}" แล้ว)</option>`;
      return `<option value="${escapeHtml(u)}" ${isCurrent?'selected':''}>${escapeHtml(u)}</option>`;
    }).join('');
  };
  return `<div class="pagehead"><div><div class="breadcrumb">โปรโมชั่น › ${isNew?'สร้างโปรโมชั่น':'แก้ไขโปรโมชั่น'}</div><h1>${isNew?'สร้างโปรโมชั่น':'แก้ไขโปรโมชั่น'}</h1></div>
    <div class="form-final-actions" style="display:flex;gap:8px;"><button class="btn ghost" id="cancelPromotionBtn">ปิดหน้าต่าง</button><button class="btn primary" id="savePromotionBtn">บันทึก</button></div></div>
    <div class="grid2col grid2col-even align-top">
      <div>
        <div class="panel">
          <h3>ข้อมูลโปรโมชั่น</h3>
          <div class="cform">
            <div class="crow"><label>ชื่อโปรโมชั่น <span class="req">*</span></label><input id="promo_name" value="${escapeHtml(promo.name||'')}" placeholder="เช่น ลดราคาวิตามินซี 10%"></div>
            <div class="crow"><label>สถานะ</label><div class="cradio">
              <label><input type="radio" name="promo_active" value="1" ${promo.active?'checked':''}> เปิดใช้งาน</label>
              <label><input type="radio" name="promo_active" value="0" ${!promo.active?'checked':''}> ปิดใช้งาน</label>
            </div></div>
            <div class="crow"><label>วันเริ่มโปรโมชั่น</label>${dmyDateFieldHtml('promo_start',promo.startDate)}</div>
            <div class="crow"><label>วันสิ้นสุดโปรโมชั่น</label>${dmyDateFieldHtml('promo_end',promo.endDate)}</div>
          </div>
        </div>
        <div class="panel" style="margin-top:16px;">
          <h3>ประเภทโปรโมชั่น</h3>
          <div class="cform">
            <div class="crow"><label>ประเภท</label><div class="cradio">
              <label><input type="radio" name="promo_type" value="discount" ${promo.type==='discount'?'checked':''}> ลดราคา</label>
              <label><input type="radio" name="promo_type" value="bundle" ${promo.type==='bundle'?'checked':''}> ราคาพิเศษเมื่อซื้อครบจำนวน</label>
              <label><input type="radio" name="promo_type" value="buygetdiff" ${promo.type==='buygetdiff'?'checked':''}> ซื้อและแถม</label>
            </div></div>
            <div id="promo_fields_discount" class="promo-fields-group" style="display:${promo.type==='discount'?'flex':'none'};">
              <div class="crow"><label>รูปแบบส่วนลด</label><div class="cradio">
                <label><input type="radio" name="promo_discount_mode" value="percent" ${promo.discountMode!=='amount'?'checked':''}> ลดเป็น %</label>
                <label><input type="radio" name="promo_discount_mode" value="amount" ${promo.discountMode==='amount'?'checked':''}> ลดเป็นจำนวนเงิน</label>
              </div></div>
              <div class="crow"><label>มูลค่าส่วนลด <span class="req">*</span></label><input id="promo_discount_value" type="number" min="0" step="0.01" value="${promo.discountValue||''}" placeholder="เช่น 10"></div>
            </div>
            <div id="promo_fields_bundle" class="promo-fields-group" style="display:${promo.type==='bundle'?'flex':'none'};">
              <div class="crow"><label>ซื้อครบจำนวน (ชิ้น) <span class="req">*</span></label><input id="promo_bundle_qty" type="number" min="1" step="1" value="${promo.bundleQty||''}" placeholder="เช่น 3"></div>
              <div class="crow"><label>ราคาพิเศษรวม (บาท) <span class="req">*</span></label><input id="promo_bundle_price" type="number" min="0" step="0.01" value="${promo.bundlePrice||''}" placeholder="เช่น 299"></div>
            </div>
            <div id="promo_fields_buygetdiff" class="promo-fields-group" style="display:${promo.type==='buygetdiff'?'flex':'none'};">
              <div class="crow"><label>สินค้าที่ต้องซื้อ (A) <span class="req">*</span></label>
                <div id="promo_bgd_buy_field_wrap">
                  <input type="hidden" id="promo_bgd_buy_product_id" value="${promo.bgdBuyProductId||''}">
                  <div class="doc-scanner-wrap" style="margin:0;">
                    <div class="doc-scanner"><span class="doc-scanner-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span><input id="promo_bgd_buy_product_search" placeholder="ค้นหาสินค้าที่ต้องซื้อ" autocomplete="off" value="${selectedBgdBuyProduct?escapeHtml(selectedBgdBuyProduct.name):''}"></div>
                    <div class="doc-scan-results" id="promoBgdBuyProductResults" hidden></div>
                  </div>
                  ${selectedBgdBuyProduct?`<div class="promo-selected-hint" style="font-size:12px;color:var(--text-muted);margin-top:6px;">เลือกแล้ว: <b style="color:var(--text);">${escapeHtml(selectedBgdBuyProduct.name)}</b> (${escapeHtml(selectedBgdBuyProduct.sku||'-')})</div>`:''}
                </div>
              </div>
              <div class="crow"><label>หน่วยที่ต้องซื้อ <span class="req">*</span></label>
                <select id="promo_bgd_buy_unit" class="promo-select">${selectedBgdBuyProduct?bgdUnitOptions(selectedBgdBuyProduct,promo.bgdBuyUnit):'<option value="">เลือกสินค้าก่อน</option>'}</select>
              </div>
              <div class="crow"><label>จำนวนที่ต้องซื้อต่อชุด <span class="req">*</span></label><input id="promo_bgd_buy_qty" type="number" min="1" step="1" value="${promo.bgdBuyQty||''}" placeholder="เช่น 1"></div>
              <div style="border-top:1px dashed var(--border);margin:6px 0 10px;"></div>
              <div class="crow"><label>สินค้าที่จะแถม (B) <span class="req">*</span></label>
                <div id="promo_bgd_get_field_wrap">
                  <input type="hidden" id="promo_bgd_get_product_id" value="${promo.bgdGetProductId||''}">
                  <div class="doc-scanner-wrap" style="margin:0;">
                    <div class="doc-scanner"><span class="doc-scanner-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span><input id="promo_bgd_get_product_search" placeholder="ค้นหาสินค้าที่จะแถม" autocomplete="off" value="${selectedBgdGetProduct?escapeHtml(selectedBgdGetProduct.name):''}"></div>
                    <div class="doc-scan-results" id="promoBgdGetProductResults" hidden></div>
                  </div>
                  ${selectedBgdGetProduct?`<div class="promo-selected-hint" style="font-size:12px;color:var(--text-muted);margin-top:6px;">เลือกแล้ว: <b style="color:var(--text);">${escapeHtml(selectedBgdGetProduct.name)}</b> (${escapeHtml(selectedBgdGetProduct.sku||'-')})</div>`:''}
                </div>
              </div>
              <div class="crow"><label>หน่วยที่จะแถม <span class="req">*</span></label>
                <select id="promo_bgd_get_unit" class="promo-select">${selectedBgdGetProduct?bgdUnitOptions(selectedBgdGetProduct,promo.bgdGetUnit):'<option value="">เลือกสินค้าก่อน</option>'}</select>
              </div>
              <div class="crow"><label>จำนวนที่แถมต่อชุด <span class="req">*</span></label><input id="promo_bgd_get_qty" type="number" min="1" step="1" value="${promo.bgdGetQty||''}" placeholder="เช่น 2"></div>
              <div style="font-size:12px;color:var(--text-muted);">ตัวอย่าง: ซื้อ Restiv ครบ 1 กล่อง แถม Fish Oil 2 ขวด — ซื้อ Restiv ทุก 1 กล่อง จะได้ Fish Oil เพิ่ม 2 ขวดโดยไม่คิดเงิน (แถมเข้าตะกร้าอัตโนมัติ ลบเองไม่ได้ ต้องลดจำนวน Restiv จึงจะหายไป)</div>
            </div>
          </div>
        </div>
      </div>
      <div class="panel" id="promo_left_panel" style="display:${promo.type==='buygetdiff'?'none':'block'};">
        <h3>สินค้าที่เข้าร่วมโปรโมชั่น</h3>
        <div class="cform">
          <div class="crow"><label>ผูกกับ</label><div class="cradio">
            <label><input type="radio" name="promo_scope" value="product" ${promo.scope==='product'?'checked':''}> สินค้ารายตัว</label>
            <label><input type="radio" name="promo_scope" value="category" ${promo.scope==='category'?'checked':''}> หมวดหมู่ / แบรนด์</label>
          </div></div>
          <div id="promo_scope_product" class="crow" style="display:${promo.scope==='product'?'block':'none'};">
            <label>เลือกสินค้า <span class="req">*</span></label>
            <div id="promo_product_field_wrap">
              <input type="hidden" id="promo_product_id" value="${promo.productId||''}">
              <div class="doc-scanner-wrap" style="margin:0;">
                <div class="doc-scanner"><span class="doc-scanner-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span><input id="promo_product_search" placeholder="ค้นหาชื่อสินค้า / รหัส / บาร์โค้ด" autocomplete="off" value="${selectedProduct?escapeHtml(selectedProduct.name):''}"></div>
                <div class="doc-scan-results" id="promoProductResults" hidden></div>
              </div>
              ${selectedProduct?`<div class="promo-selected-hint" style="font-size:12px;color:var(--text-muted);margin-top:6px;">เลือกแล้ว: <b style="color:var(--text);">${escapeHtml(selectedProduct.name)}</b> (${escapeHtml(selectedProduct.sku||'-')})</div>`:''}
            </div>
          </div>
          <div id="promo_scope_category" class="crow" style="display:${promo.scope==='category'?'block':'none'};">
            <label>หมวดหมู่ <span class="req">*</span></label>
            <select id="promo_category" class="promo-select"><option value="">-- เลือกหมวดหมู่ --</option>${categories.map(c=>`<option value="${escapeHtml(c)}" ${promo.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select>
            <label style="margin-top:10px;">แบรนด์ (ไม่บังคับ)</label>
            <select id="promo_brand" class="promo-select"><option value="">-- ทุกแบรนด์ในหมวดนี้ --</option>${brands.map(b=>`<option value="${escapeHtml(b)}" ${promo.brand===b?'selected':''}>${escapeHtml(b)}</option>`).join('')}</select>
            <label style="margin-top:10px;">สินค้าในหมวด/แบรนด์นี้ <span class="req">*</span></label>
            <button type="button" class="btn ghost" id="openPromoItemPickerBtn" style="width:100%;justify-content:center;">📦 เลือกสินค้า</button>
            <div id="promoCategoryItemsList" class="promo-item-list">${renderPromoCategoryItemsList(currentPromoDraftItems||[])}</div>
          </div>
          <div id="promo_scope_product_unit" class="crow" style="display:${promo.scope==='product'?'block':'none'};"><label>หน่วยที่ร่วมโปรโมชั่น <span class="req">*</span></label>
            <select id="promo_unit" class="promo-select">${selectedProduct?unitOptionsForProduct(selectedProduct):'<option value="">เลือกสินค้าก่อน</option>'}</select>
          </div>
        </div>
      </div>
    </div>`;
}
