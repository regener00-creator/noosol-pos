function renderProducts(){
  if(editingProductId!==null) return renderProductForm();
  const {tree, catCounts, brCounts} = buildGroupTree();
  const q = searchQuery.trim();
  const needle=q.toLowerCase();
  const compareNames=new Intl.Collator('th').compare;
  const level2=isLevel2User();
  const canViewCost=!level2;
  const canOpenProductEditor=!level2;
  const productColumnCount=7+(canViewCost?1:0)+(canOpenProductEditor?1:0);
  const representativeIndexStale=!representativeManagedProductIndexLoaded||(Date.now()-representativeManagedProductIndexLoadedAt)>=REPRESENTATIVE_MANAGED_PRODUCT_INDEX_TTL_MS;
  if(canOpenProductEditor&&representativeIndexStale&&!representativeManagedProductIndexPromise) setTimeout(()=>{ void loadRepresentativeManagedProductIndex(); },0);

  // ตารางขวา: กรองตามกลุ่มที่เลือก + คำค้น
  let filtered = (selectedGroup||q||productReviewFilterUsed) ? products.filter(p=>{
    if(productReviewFilter!=='all'&&productDataReviewStatus(p)!==productReviewFilter) return false;
    if(q){
      return String(p.name||'').toLowerCase().includes(needle)||matchesBarcode(p,q)||String(p.sku||'').toLowerCase().includes(needle);
    }
    if(selectedGroup?.cat && (String(p.category||'').trim()||'ไม่ทราบหมวดหมู่')!==selectedGroup.cat) return false;
    if(selectedGroup?.brand && (p.brand||'ทั่วไป')!==selectedGroup.brand) return false;
    return true;
  }) : [];

  // หมวดหลักอยู่ในแถบสีฟ้า ส่วนหมวดย่อยของหมวดที่เลือกอยู่ในพื้นที่สีขาวด้านล่าง
  const requestedCategoryOrder=['ยา','อาหารเสริม','อื่นๆ','ไม่ทราบหมวดหมู่'];
  const categoryNames=Object.keys(tree).sort((a,b)=>{
    const ai=requestedCategoryOrder.indexOf(a),bi=requestedCategoryOrder.indexOf(b);
    if(ai>=0||bi>=0){
      if(ai<0) return b==='ไม่ทราบหมวดหมู่'?-1:1;
      if(bi<0) return a==='ไม่ทราบหมวดหมู่'?1:-1;
      return ai-bi;
    }
    return a.localeCompare(b,'th');
  });
  const activeCategory=selectedGroup?.cat&&tree[selectedGroup.cat]?selectedGroup.cat:'';
  const categoryHtml=categoryNames.map(cat=>{
    const active=activeCategory===cat;
    return `<button type="button" class="product-group-category ${active?'active':''}" data-product-category="${escapeHtml(cat)}"><span>${escapeHtml(cat)}</span><span class="product-group-category-count">${catCounts[cat]||0}</span></button>`;
  }).join('');
  let brandHtml='<div class="product-group-empty">เลือกกลุ่มสินค้าหลักเพื่อแสดงหมวดสินค้าย่อย</div>';
  if(activeCategory){
    const activeBrands=[...tree[activeCategory]].sort((a,b)=>a.localeCompare(b,'th'));
    const visibleBrands=activeBrands.filter(brand=>brand!=='ทั่วไป'||activeBrands.length>1);
    brandHtml=visibleBrands.length?visibleBrands.map(brand=>{
      const active=selectedGroup?.brand===brand;
      return `<button type="button" class="product-group-brand ${active?'active':''}" data-product-category="${escapeHtml(activeCategory)}" data-product-brand="${escapeHtml(brand)}"><span>${escapeHtml(brand)}</span><span class="product-group-brand-count">${brCounts[activeCategory+'|||'+brand]||0}</span></button>`;
    }).join(''):'<div class="product-group-empty">หมวดนี้ไม่มีหมวดสินค้าย่อย</div>';
  }

  // เรียงข้อมูลตามคอลัมน์ที่เลือก
  const sk = productSort.key, sdir = productSort.dir;
  filtered.sort((a,b)=>{
    let va, vb;
    if(sk==='price'){ va=a.price; vb=b.price; }
    else if(sk==='cost'){ va=a.cost||a.openingCost||0; vb=b.cost||b.openingCost||0; }
    else if(sk==='stock'){ va=a.stock; vb=b.stock; }
    else if(sk==='expiry'){ va=a.expiry?new Date(a.expiry).getTime():Infinity; vb=b.expiry?new Date(b.expiry).getTime():Infinity; }
    else if(sk==='name'){ va=a.name; vb=b.name; return compareNames(va,vb)*sdir; }
    else { va=a.sku||''; vb=b.sku||''; return compareNames(va,vb)*sdir; }
    return (va<vb?-1:va>vb?1:0)*sdir;
  });

  // แบ่งหน้า
  const totalPages = Math.max(1, Math.ceil(filtered.length/PRODUCTS_PER_PAGE));
  if(productPage>totalPages) productPage = totalPages;
  const start = (productPage-1)*PRODUCTS_PER_PAGE;
  const pageRows = filtered.slice(start, start+PRODUCTS_PER_PAGE);

  const sortArrow = key => productSort.key===key ? (productSort.dir===1?' ▲':' ▼') : '';
  const th = (key,label,cls) => `<th class="sortable ${cls||''}" data-sort="${key}">${label}<span class="sortarrow">${sortArrow(key)}</span></th>`;

  let pager = pagerHtml(productPage, totalPages, 'page');

  return `<div class="product-list-page">
    <div class="product-list-actions form-final-actions"><button class="btn ghost" id="exportProductsBtn">ส่งออก Excel</button><button class="btn ghost" id="importProductsBtn">นำเข้า Excel</button><input id="productImportFile" type="file" accept=".xlsx,.xls,.csv" hidden><button class="btn primary" id="newProductBtn">+ เพิ่มสินค้า</button></div>
    <div class="prodsplit">
      <div class="tree-pane">
        <div class="product-group-header"><span class="product-group-title">กลุ่มสินค้า</span><span class="product-group-separator">:</span><div class="product-group-categories">${categoryHtml}</div></div>
        <div class="product-group-brands">${brandHtml}</div>
      </div>
      <div class="searchbar product-list-search">
        <input id="search" placeholder="ค้นหาจาก ชื่อ / รหัส / บาร์โค้ด" value="${escapeHtml(searchQuery)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <div class="product-review-filters" role="group" aria-label="กรองสินค้าตามสี">
          ${[['all','ทั้งหมด'],['complete','สีเขียว'],['pending','สีเหลือง']].map(([value,label])=>`<button type="button" class="product-review-filter" data-product-review-filter="${value}" aria-pressed="${productReviewFilter===value}" title="${value==='complete'?'ข้อมูลครบถ้วน':value==='pending'?'กำลังแก้ไข / รอข้อมูล':'ทุกสี รวมสินค้าที่ยังไม่ได้ทำสี'}"><span class="product-review-filter-dot" aria-hidden="true"></span>${label}</button>`).join('')}
        </div>
      </div>
      <div class="table-pane">
        <div class="table-scroll product-table-scroll">
        <table class="grid-table doc-head-blue prodtable"><colgroup><col class="col-sku"><col class="col-barcode"><col class="col-name"><col class="col-price">${canViewCost?'<col class="col-cost">':''}<col class="col-unit"><col class="col-stock"><col class="col-lots">${canOpenProductEditor?'<col class="col-edit">':''}</colgroup><thead><tr>${th('sku','รหัสสินค้า')}<th>บาร์โค้ด</th>${th('name','สินค้า')}${th('price','ขาย','mono num')}${canViewCost?th('cost','ทุน','mono num'):''}<th>หน่วย</th>${th('stock','คงเหลือ','mono num')}<th>Lot</th>${canOpenProductEditor?'<th></th>':''}</tr></thead>
        <tbody>${pageRows.map(p=>{
          const unitOpts=[{sub:p.unit, price:p.price, cost:p.cost||p.openingCost||0, barcode:p.barcode||''}, ...((p.units||[]).map(u=>({sub:u.sub, price:u.price, cost:u.cost||0, barcode:u.barcode||''})))];
          const selUnit=productListUnitPreference(p)||prodRowUnitSel[p.id]||p.unit;
          const selOpt=unitOpts.find(u=>u.sub===selUnit)||unitOpts[0];
          const dataReviewStatus=productDataReviewStatus(p);
          const dataPending=dataReviewStatus==='pending';
          const dataReviewed=dataReviewStatus==='complete';
          const reviewStatusValue=dataReviewStatus||'normal';
          const reviewStatusLabel=dataPending?'กำลังแก้ไข / รอข้อมูล':dataReviewed?'ข้อมูลครบถ้วน':'ยังไม่กำหนดสถานะ';
          const reviewNextLabel=dataPending?'ข้อมูลครบถ้วน':dataReviewed?'ล้างสถานะ':'กำลังแก้ไข / รอข้อมูล';
          const reviewStatusIcon=dataPending
            ?'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
            :dataReviewed?'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>':'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>';
          const unitSelectHtml = unitOpts.length>1
            ? `<select class="prod-unit-select" data-pid="${p.id}">${unitOpts.map(u=>`<option value="${escapeHtml(u.sub)}" ${u.sub===selOpt.sub?'selected':''}>${escapeHtml(u.sub)}</option>`).join('')}</select>`
            : `<span class="prod-unit-fixed">${escapeHtml(p.unit)}</span>`;
          const lotCount=inventoryLotCount(p.id,activeWarehouseId);
          const representativeHistoryButton=productHasManagedRepresentative(p.id)?`<button class="icon-btn representative-history-action" data-product-representative-history="${p.id}" title="ผู้แทนที่ดูแลสินค้าและ NOTE" aria-label="เปิดผู้แทนที่ดูแล ${escapeHtml(p.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/><path d="M12 7v5l3 2"/></svg></button>`:'';
          return `<tr class="${isProductActive(p)?'':'product-inactive-row'} ${dataPending?'product-review-pending-row':''} ${dataReviewed?'product-reviewed-row':''}"><td class="mono" style="text-align:center;"><input class="prod-inline-edit" data-pid="${p.id}" data-field="sku" value="${escapeHtml(p.sku||'')}" placeholder="-"></td><td class="mono" style="text-align:center;"><input class="prod-inline-edit prod-inline-barcode prod-unit-barcode" data-pid="${p.id}" data-field="barcode" data-unit="${escapeHtml(selOpt.sub)}" value="${escapeHtml(selOpt.barcode||'')}" placeholder="-" autocomplete="off" aria-label="บาร์โค้ดหน่วย ${escapeHtml(selOpt.sub)}"></td><td><input class="prod-inline-edit prod-inline-name" data-pid="${p.id}" data-field="name" value="${escapeHtml(p.name)}">${isProductActive(p)?'':'<span class="product-status-badge">ปิดใช้งาน</span>'}</td><td class="mono num" style="text-align:center;"><input class="prod-inline-edit prod-inline-num" data-pid="${p.id}" data-field="price" data-unit="${escapeHtml(selOpt.sub)}" type="number" value="${selOpt.price}"></td>${canViewCost?`<td class="mono num" style="text-align:center;"><input class="prod-inline-edit prod-inline-num" data-pid="${p.id}" data-field="cost" data-unit="${escapeHtml(selOpt.sub)}" type="number" value="${selOpt.cost}"></td>`:''}<td style="text-align:center;">${unitSelectHtml}</td><td class="num stock-cell ${p.stock<0?'stock-negative':''}" style="text-align:center;" data-act="stockcheck" data-id="${p.id}" title="กดเพื่อดูทุกหน่วย">${escapeHtml(stockInLargestUnit(p))} <span class="stock-caret">▾</span></td><td style="text-align:center;"><button class="product-lot-link ${lotCount?'':'empty'}" data-product-lots="${p.id}">${lotCount} Lot ▾</button></td>${canOpenProductEditor?`<td class="num"><div class="product-row-actions">${representativeHistoryButton}<button class="icon-btn" data-act="editproduct" data-id="${p.id}" title="แก้ไข" aria-label="แก้ไข"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button><button class="icon-btn product-review-cycle-toggle" data-cycle-product-review-status="${p.id}" data-review-status="${reviewStatusValue}" title="สถานะ: ${reviewStatusLabel} · คลิกเพื่อเปลี่ยนเป็น ${reviewNextLabel}" aria-label="สถานะตรวจข้อมูล ${reviewStatusLabel}; คลิกเพื่อเปลี่ยนเป็น ${reviewNextLabel}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${reviewStatusIcon}</svg></button></div></td>`:''}</tr>`;
        }).join('')||`<tr><td colspan="${productColumnCount}" style="text-align:center;color:var(--text-muted);padding:30px;">${productReviewFilterUsed?'ไม่พบสินค้าตามตัวกรองที่เลือก':q?'ไม่พบสินค้าที่ค้นหา':selectedGroup?'ไม่มีสินค้าในกลุ่มนี้':'กรุณาเลือกกลุ่มสินค้า เลือกสี หรือค้นหาสินค้าได้ทันที'}</td></tr>`}</tbody></table>
        </div>
        ${pager}
      </div>
    </div></div>`;
}

function comboSelectorFor(kind){
  if(kind==='category') return '#f_category';
  if(kind==='brand') return '#f_brand';
  return '#f_unit, .u_sub';
}
function comboListFor(kind){
  if(kind==='category') return categories;
  if(kind==='brand') return brands;
  return units;
}
function addComboOption(kind, name){
  document.querySelectorAll(comboSelectorFor(kind)).forEach(s=>{
    if(![...s.options].some(o=>o.value===name)){
      s.insertBefore(new Option(name,name), s.querySelector('option[value="__add__"]'));
    }
  });
}

function removeComboOption(kind, name){
  document.querySelectorAll(comboSelectorFor(kind)).forEach(s=>{
    [...s.options].forEach(o=>{ if(o.value===name){ if(s.value===name) s.value=''; o.remove(); } });
  });
}

function openManageModal(kind){
  const list = comboListFor(kind);
  const title = kind==='category' ? 'จัดการหมวดสินค้า' : (kind==='brand' ? 'จัดการกลุ่มย่อย' : 'จัดการหน่วยสินค้า');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>${title}</h3><button class="modal-close">×</button></div>
      <div class="modal-sub">กดถังขยะเพื่อลบชื่อที่ไม่ใช้แล้ว (สินค้าที่ใช้ชื่อนั้นอยู่จะไม่ถูกลบ)</div>
      <div class="manage-list">${list.map(x=>`<div class="manage-item" data-name="${escapeHtml(x)}"><span>${escapeHtml(x)}</span><button class="manage-del" data-name="${escapeHtml(x)}" title="ลบ"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg></button></div>`).join('')||'<div class="manage-empty">ยังไม่มีรายการ</div>'}</div>
    </div>`;
  document.body.appendChild(overlay);
  const close = ()=> overlay.remove();
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelectorAll('.manage-del').forEach(b=>{
    b.onclick = ()=>{
      const name = b.dataset.name;
      const inUse = products.some(p=> kind==='category' ? p.category===name : (kind==='brand' ? p.brand===name : (p.unit===name || (p.units||[]).some(u=>u.sub===name))));
      if(inUse){ if(!confirm(`มีสินค้าใช้ "${name}" อยู่ — ยืนยันลบชื่อนี้ออกจากรายการตัวเลือก?\n(สินค้าเดิมยังคงค่าไว้ แต่จะเลือกชื่อนี้ใหม่ไม่ได้จนกว่าจะเพิ่มกลับ)`)) return; }
      const idx = list.indexOf(name);
      if(idx>-1) list.splice(idx,1);
      removeComboOption(kind, name);
      b.closest('.manage-item').remove();
      showToast(`ลบ "${name}" แล้ว`);
    };
  });
}

function extraBarcodeEntries(product){
  if(!product) return [];
  const fallback=String(product.unit||'');
  return (product.extraBarcodes||[]).map((item,index)=>{
    const code=typeof item==='object'?String(item?.code||''):String(item||'');
    const linkedUnit=typeof item==='object'?item?.unit:(product.extraBarcodeUnits||[])[index];
    return {code,unit:String(linkedUnit||fallback)};
  }).filter(entry=>entry.code);
}
function extraBarcodeAvailableUnits(product){
  return [...new Set([product?.unit,...(product?.units||[]).map(unit=>unit?.sub)].map(value=>String(value||'').trim()).filter(Boolean))];
}
function extraBarcodeUnitForCode(product,code){
  if(!product||!code) return '';
  const entry=extraBarcodeEntries(product).find(item=>item.code===String(code));
  if(!entry) return '';
  return extraBarcodeAvailableUnits(product).includes(entry.unit)?entry.unit:String(product.unit||'');
}
function extraBarcodeRowHtml(value,unitNames,mainUnit){
  const entry=typeof value==='object'&&value!==null?value:{code:value||'',unit:mainUnit||''};
  const names=[...new Set((unitNames||[]).map(unit=>String(unit||'').trim()).filter(Boolean))];
  const selected=names.includes(String(entry.unit||''))?String(entry.unit):String(mainUnit||names[0]||'');
  const options=names.length?names.map(unit=>`<option value="${escapeHtml(unit)}" ${unit===selected?'selected':''}>${escapeHtml(unit)}</option>`).join(''):'<option value="">เลือกหน่วย</option>';
  return `<div class="bcrow extra"><select class="eb_unit" aria-label="หน่วยของบาร์โค้ดเพิ่มเติม">${options}</select><input class="eb_code" value="${escapeHtml(entry.code||'')}" placeholder="เลขบาร์โค้ดเพิ่มเติม"><button class="bc_del" title="ลบ">×</button></div>`;
}
function currentProductFormUnitNames(){
  const main=String(document.getElementById('f_unit')?.value||'').trim();
  const secondary=Array.from(document.querySelectorAll('#unitRows .u_sub')).map(select=>String(select.value||'').trim()).filter(Boolean);
  return [...new Set([main,...secondary].filter(Boolean))];
}
function refreshExtraBarcodeUnitOptions(){
  const names=currentProductFormUnitNames(),main=String(document.getElementById('f_unit')?.value||names[0]||'');
  document.querySelectorAll('#extraBarcodeRows .eb_unit').forEach(select=>{
    const previous=select.value;
    select.innerHTML=names.length?names.map(unit=>`<option value="${escapeHtml(unit)}">${escapeHtml(unit)}</option>`).join(''):'<option value="">เลือกหน่วย</option>';
    select.value=names.includes(previous)?previous:(names.includes(main)?main:(names[0]||''));
  });
}
function vendorBarcodeRowHtml(vb){
  vb = vb || {vendor:'',code:''};
  return `<div class="bcrow vendor"><select class="vb_vendor"><option value="">เลือกผู้จำหน่าย</option>${suppliersList().map(s=>`<option value="${escapeHtml(s.name)}" ${vb.vendor===s.name?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}</select><input class="vb_code" value="${escapeHtml(vb.code||'')}" placeholder="เลขบาร์โค้ดของ vendor"><button class="bc_del" title="ลบ">×</button></div>`;
}

function comboSelect(id, list, selected, placeholder){
  return `<select id="${escapeHtml(id)}" class="combo-select" data-combo="1">
    <option value="">${escapeHtml(placeholder)}</option>
    ${list.map(x=>`<option value="${escapeHtml(x)}" ${selected===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}
    <option value="__add__">+ เพิ่มใหม่...</option>
    <option value="__manage__">🗑 จัดการ / ลบชื่อ...</option>
  </select>`;
}

function unitRowHtml(u, mainUnit, siblingNames){
  mainUnit = mainUnit || 'หน่วยหลัก';
  // ตัวเลือกหน่วยฐาน: หน่วยหลัก + หน่วยอื่นที่ประกาศไว้ (ยกเว้นตัวเอง)
  const baseOpts = [mainUnit, ...siblingNames.filter(n=>n && n!==u.sub)];
  const curBase = u.base || mainUnit;
  return `<div class="unitrow" data-i="0">
    <div class="unitrow-eq">1
      <select class="u_sub combo-select" data-combo="1"><option value="">ระบุหน่วย</option>${units.map(x=>`<option value="${escapeHtml(x)}" ${u.sub===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}<option value="__add__">+ เพิ่มใหม่...</option><option value="__manage__">🗑 จัดการ / ลบชื่อ...</option></select>
      <span class="u_eq">=</span>
      <input class="u_per" type="number" value="${escapeHtml(u.per??u.factor??'')}" placeholder="จำนวน" title="จำนวนต่อ 1 หน่วยนี้" style="width:80px;">
      <select class="u_base">${baseOpts.map(b=>`<option value="${escapeHtml(b)}" ${curBase===b?'selected':''}>${escapeHtml(b)}</option>`).join('')}</select>
    </div>
    <input class="u_price" type="number" value="${escapeHtml(u.price??'')}" placeholder="ขาย">
    ${isLevel2User()?`<input class="u_cost" type="hidden" value="${escapeHtml(u.cost??'')}">`:`<input class="u_cost" type="number" value="${escapeHtml(u.cost??'')}" placeholder="ทุน">`}
    <input class="u_stock" type="hidden" value="${escapeHtml(u.stock===''||u.stock===undefined||u.stock===null?'':(Math.round(u.stock*100)/100))}" readonly>
    <input class="u_barcode" value="${escapeHtml(u.barcode||'')}" placeholder="เลขบาร์โค้ด">
    <button class="u_del" title="ลบ">×</button>
  </div>`;
}

// อ่านค่าแถวหน่วยจาก DOM ปัจจุบัน
function collectUnitRowsFromDOM({preserveInput=false}={}){
  const number=input=>preserveInput?input.value:(Number(input.value)||0);
  return Array.from(document.querySelectorAll('#unitRows .unitrow')).map(r=>({
    sub: r.querySelector('.u_sub').value,
    per: number(r.querySelector('.u_per')),
    base: r.querySelector('.u_base').value,
    price: number(r.querySelector('.u_price')),
    cost: number(r.querySelector('.u_cost')),
    stock: parseFloat(r.querySelector('.u_stock')?.value)||0,
    barcode: r.querySelector('.u_barcode').value.trim(),
  }));
}

// วาดแถวหน่วยใหม่ (ให้ base dropdown อัปเดตตามหน่วยที่ประกาศ) โดยคงค่าที่กรอกไว้
function refreshUnitRows(){
  const rowsEl = document.getElementById('unitRows'); if(!rowsEl) return;
  const mainUnit = (document.getElementById('f_unit')||{}).value || 'หน่วยหลัก';
  const mainStock = Number(document.getElementById('f_stock')?.value)||0;
  const rawData = collectUnitRowsFromDOM({preserveInput:true});
  const data = computeUnitRowsWithStock(rawData, mainUnit, mainStock);
  const names = data.map(d=>d.sub);
  rowsEl.innerHTML = data.map(u=>unitRowHtml(u, mainUnit, names)).join('');
  bindUnitRowEvents();
  refreshExtraBarcodeUnitOptions();
}

// คำนวณ factor สุทธิเทียบหน่วยหลัก จากโซ่ base (เช่น ลัง→กล่อง→แผง)
function resolveNetFactor(unitName, rows, mainUnit, seen){
  if(unitName===mainUnit) return 1;
  seen = seen || new Set();
  if(seen.has(unitName)) return 0; // กันลูป
  seen.add(unitName);
  const r = rows.find(x=>x.sub===unitName);
  if(!r || !r.per) return 0;
  return r.per * resolveNetFactor(r.base||mainUnit, rows, mainUnit, seen);
}
// จำนวนคงเหลือของหน่วยหนึ่ง คำนวณจากจำนวนคงเหลือหน่วยหลัก (mainStock) หาร factor สุทธิของหน่วยนั้น
function stockForUnitRow(unitName, rows, mainUnit, mainStock){
  if(unitName===mainUnit) return mainStock;
  const nf = resolveNetFactor(unitName, rows, mainUnit);
  return nf>0 ? mainStock/nf : '';
}
// คัดลอกแถวหน่วย (กันการแก้ข้อมูลจริงของสินค้าโดยไม่ตั้งใจ) แล้วเติมจำนวนคงเหลือต่อหน่วยให้แต่ละแถว
function computeUnitRowsWithStock(rows, mainUnit, mainStock){
  const copies = rows.map(r=>({...r}));
  copies.forEach(r=>{ r.stock = stockForUnitRow(r.sub, copies, mainUnit, mainStock); });
  return copies;
}

function unusedProductUnitLocalBlockers(product){
  if(!product) return ['ไม่พบสินค้า'];
  const blockers=productDeletionLocalBlockers(product.id);
  if(Number(product.stock)!==0&&Number.isFinite(Number(product.stock))) blockers.push('จำนวนคงเหลือสินค้า');
  if(product.unitChangeHistory?.length) blockers.push('ประวัติเปลี่ยนหน่วยหลัก');
  if(productDirtyOperations.has(String(product.id))) blockers.push('สินค้ายังรอซิงก์');
  return blockers;
}
async function refreshUnusedProductUnitAccess(){
  const select=document.getElementById('f_unit');
  const action=document.getElementById('changeBaseUnitBtn');
  const hint=document.getElementById('directUnitEditHint');
  const id=editingProductId;
  if(!select||id==='new'||id===null) return;
  const product=products.find(p=>p.id===id);
  select.disabled=true;
  delete select.dataset.directUnitEdit;
  if(action){ action.hidden=false; action.style.display=''; }
  if(!canEditMobilePrice()||!product) return;
  const blockers=unusedProductUnitLocalBlockers(product);
  if(blockers.length){ if(hint) hint.textContent='ใช้ปุ่มเปลี่ยนหน่วยหลัก: '+blockers.join(', '); return; }
  if(!sb||navigator.onLine===false){ if(hint) hint.textContent='เชื่อมต่ออินเทอร์เน็ตเพื่อตรวจว่าแก้หน่วยได้หรือไม่'; return; }
  if(hint) hint.textContent='กำลังตรวจประวัติการใช้สินค้า...';
  const revision=Number(product._revision)||0;
  try{
    const {data,error}=await sb.rpc('get_product_unit_edit_status',{p_product_id:Number(id)});
    if(!select.isConnected||editingProductId!==id) return;
    if(error||!data) throw error||new Error('ตรวจสอบไม่สำเร็จ');
    const current=products.find(p=>p.id===id);
    if(Number(data.revision)!==revision||Number(current?._revision)!==revision||data.unit!==current?.unit){
      if(hint) hint.textContent='โหลดข้อมูลล่าสุดก่อนแก้หน่วยหลัก'; return;
    }
    const local=unusedProductUnitLocalBlockers(current);
    if(data.canEdit===true&&!local.length){
      select.disabled=false;
      select.dataset.directUnitEdit=String(id);
      select.dataset.previousUnit=select.value;
      if(action){ action.hidden=true; action.style.display='none'; }
      if(hint) hint.textContent='ยังไม่เคยใช้งาน แก้หน่วยหลักได้โดยตรง';
    }else if(hint) hint.textContent='ใช้ปุ่มเปลี่ยนหน่วยหลัก: '+[...(data.blockers||[]),...local].join(', ');
  }catch(_error){
    if(select.isConnected&&editingProductId===id&&hint) hint.textContent='ตรวจประวัติไม่ได้ ยังไม่อนุญาตให้แก้หน่วยโดยตรง';
  }
}
function remapUnusedProductUnitInputs(select){
  if(!select.dataset.directUnitEdit) return;
  const previous=select.dataset.previousUnit,newUnit=select.value;
  if(!newUnit||newUnit.startsWith('__')||previous===newUnit) return;
  // This corrects the label, not the quantity represented by each unit.
  document.querySelectorAll('#unitRows .u_base,#extraBarcodeRows .eb_unit').forEach(control=>{
    for(const option of control.options) if(option.value===previous){ option.value=newUnit; option.textContent=newUnit; }
  });
  if(mobileProductEditor){
    mobileProductEditor.draft.extraBarcodeUnits=(mobileProductEditor.draft.extraBarcodeUnits||[]).map(unit=>unit===previous?newUnit:unit);
  }
  select.dataset.previousUnit=newUnit;
}
function baseUnitChangeRound(value){ return Math.round((Number(value)||0)*1000000)/1000000; }
function buildProductBaseUnitChange(product,options={}){
  if(!product) return {error:'ไม่พบสินค้า'};
  const oldUnit=String(product.unit||'').trim(),newUnit=String(options.newUnit||'').trim();
  const conversion=Number(options.conversion);
  const newPrice=Number(options.newPrice),newCost=Number(options.newCost);
  const newBarcode=String(options.newBarcode||'').trim();
  if(!oldUnit||!newUnit) return {error:'กรุณาระบุหน่วยเดิมและหน่วยใหม่'};
  if(oldUnit===newUnit) return {error:'หน่วยใหม่ต้องไม่ซ้ำกับหน่วยเดิม'};
  if((product.units||[]).some(unit=>String(unit.sub||'').trim()===newUnit)) return {error:'หน่วยใหม่นี้มีอยู่ในรายการหน่วยสินค้าแล้ว'};
  if(!Number.isFinite(conversion)||conversion<=0||conversion>1000000) return {error:'อัตราแปลงต้องมากกว่า 0 และไม่เกิน 1,000,000'};
  if(!Number.isFinite(newPrice)||newPrice<0) return {error:'กรุณาระบุราคาขายของหน่วยใหม่ให้ถูกต้อง'};
  if(!Number.isFinite(newCost)||newCost<0) return {error:'กรุณาระบุทุนของหน่วยใหม่ให้ถูกต้อง'};
  if(newBarcode&&newBarcode===String(product.barcode||'').trim()) return {error:`บาร์โค้ดเดิมจะย้ายไปอยู่กับหน่วย ${oldUnit} กรุณาใช้เลขอื่นสำหรับ ${newUnit}`};
  const rawRows=[{
    sub:oldUnit,per:conversion,base:newUnit,price:Number(product.price)||0,cost:Number(product.cost)||0,barcode:String(product.barcode||'').trim()
  },...(product.units||[]).map(unit=>({
    ...unit,
    per:Number(unit.per)>0?Number(unit.per):(Number(unit.factor)>0?Number(unit.factor):0),
    base:String(unit.base||oldUnit).trim()||oldUnit,
  }))];
  const convertedUnits=rawRows.map(unit=>({
    ...unit,
    factor:baseUnitChangeRound(resolveNetFactor(unit.sub,rawRows,newUnit)),
  }));
  if(convertedUnits.some(unit=>!unit.sub||!Number.isFinite(unit.factor)||unit.factor<=0)) return {error:'โครงสร้างหน่วยสินค้าเดิมไม่สมบูรณ์ กรุณาตรวจจำนวนและหน่วยอ้างอิงก่อนเปลี่ยน'};
  const changedAt=String(options.changedAt||new Date().toISOString());
  const changedBy=String(options.changedBy||'').trim();
  const history=[...(Array.isArray(product.unitChangeHistory)?product.unitChangeHistory:[]),{
    oldUnit,newUnit,conversion,changedAt,changedBy,
  }];
  const linkedExtraUnits=extraBarcodeEntries(product).map(entry=>entry.unit||oldUnit);
  return {
    conversion,oldUnit,newUnit,
    product:{...product,unit:newUnit,price:newPrice,cost:newCost,barcode:newBarcode,extraBarcodeUnits:linkedExtraUnits,multiunit:true,units:convertedUnits,unitChangeHistory:history},
  };
}
function baseUnitChangeStockPreview(productId,conversion,warehouseList=warehouses,balanceRows=inventoryBalanceRows){
  const factor=Number(conversion)>0?Number(conversion):0;
  return (warehouseList||[]).map(warehouse=>{
    const balance=(balanceRows||[]).find(row=>Number(row.product_id)===Number(productId)&&Number(row.warehouse_id)===Number(warehouse.id));
    const before=Number(balance?.stock)||0;
    return {warehouseId:Number(warehouse.id),warehouseName:warehouse.name||'-',before,after:baseUnitChangeRound(before*factor)};
  });
}
function productBaseUnitChangeBlockers(productId){
  const id=Number(productId);
  const hasItem=items=>(items||[]).some(item=>Number(item?.productId??item?.pid)===id);
  const blockers=[];
  if(hasItem(cart)) blockers.push('บิลขายที่กำลังเปิดอยู่');
  const held=salesHistory.filter(sale=>sale?.status==='hold'&&hasItem(sale.items));
  if(held.length) blockers.push(`บิลพักไว้ ${held.length} รายการ`);
  const receipts=goodsReceipts.filter(doc=>doc?.stockApplied!==true&&hasItem(doc.items));
  if(receipts.length) blockers.push(`ใบรับสินค้าที่ยังไม่ลงสต๊อก ${receipts.length} รายการ`);
  const returns=productReturns.filter(doc=>doc?.stockApplied!==true&&doc?.status!=='คืนเรียบร้อย'&&hasItem(doc.items));
  if(returns.length) blockers.push(`ใบคืนสินค้าที่ยังไม่ลงสต๊อก ${returns.length} รายการ`);
  // เอกสารโอนรุ่นเก่าไม่มี stockApplied แต่สถานะ “บันทึกแล้ว” หมายถึงลงสต๊อกแล้ว
  // ส่วนเอกสารรุ่นใหม่ที่ RPC ล้มเหลวจะบันทึก stockApplied=false ไว้อย่างชัดเจน
  const pendingTransfers=transfers.filter(doc=>doc?.stockApplied===false&&hasItem(doc.items));
  if(pendingTransfers.length) blockers.push(`ใบโอนสินค้าที่ยังไม่ลงสต๊อก ${pendingTransfers.length} รายการ`);
  const exchanges=productExchanges.filter(doc=>doc?.incomingApplied!==true&&doc?.status!=='รับสินค้ากลับแล้ว'&&(hasItem(doc.outgoingItems)||hasItem(doc.incomingItems)));
  if(exchanges.length) blockers.push(`ใบเปลี่ยนสินค้าที่ยังไม่เสร็จ ${exchanges.length} รายการ`);
  return blockers;
}
function openProductBaseUnitChangeModal(){
  if(mobileProductEditor){
    if(!canEditMobilePrice()||mobileProductEditor.saving||!mobileRequireOnline('เปลี่ยนหน่วยหลัก')) return;
    if(mobileProductEditor.changed){ showToast('กรุณาบันทึกข้อมูลสินค้าที่แก้ไขก่อน แล้วเปิดมาเปลี่ยนหน่วยหลัก','danger-top'); return; }
    if(productDirtyOperations.has(String(editingProductId))){ showToast('กรุณารอให้สินค้านี้ซิงก์สำเร็จก่อนเปลี่ยนหน่วยหลัก','danger-top'); return; }
  }
  if(editingProductId==='new'||editingProductId===null) return;
  const product=products.find(item=>Number(item.id)===Number(editingProductId));
  if(!product) return;
  const blockers=productBaseUnitChangeBlockers(product.id);
  if(blockers.length){
    showToast(`ยังเปลี่ยนหน่วยหลักไม่ได้: ${blockers.join(', ')}`,'danger');
    return;
  }
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  if(mobileProductEditor) overlay.classList.add('mobile-base-unit-overlay');
  overlay.innerHTML=`<div class="modal" style="width:720px;max-height:92vh;"><div class="modal-head"><h3>เปลี่ยนหน่วยหลัก</h3><button class="modal-close" type="button">×</button></div><div class="modal-sub">${escapeHtml(product.name)} · หน่วยเดิม <b>${escapeHtml(product.unit||'-')}</b></div><form id="baseUnitChangeForm" style="overflow-y:auto;"><div style="padding:0 18px 18px;"><div style="padding:11px 13px;border:1px solid #F0D39D;border-radius:9px;background:#FFF8E8;color:#7B5716;font-size:12.5px;margin-bottom:14px;">บิลและเอกสารที่ลงสต๊อกแล้วจะคงข้อมูลเดิม ระบบจะแปลงเฉพาะสต๊อกปัจจุบันของทุกคลัง</div><div class="formgrid3"><div class="field"><label>หน่วยเล็กสุดใหม่ <span class="req">*</span></label><input id="baseUnitNewName" list="baseUnitNameList" autocomplete="off" placeholder="เช่น เม็ด"><datalist id="baseUnitNameList">${units.filter(unit=>unit!==product.unit).map(unit=>`<option value="${escapeHtml(unit)}">`).join('')}</datalist></div><div class="field"><label>1 ${escapeHtml(product.unit)} เท่ากับกี่หน่วยใหม่ <span class="req">*</span></label><input id="baseUnitConversion" type="number" min="0.000001" max="1000000" step="any" value="1"></div><div class="field"><label>บาร์โค้ดหน่วยใหม่</label><input id="baseUnitNewBarcode" autocomplete="off" placeholder="เว้นว่างได้"></div><div class="field"><label>ราคาขายต่อหน่วยใหม่ <span class="req">*</span></label><input id="baseUnitNewPrice" type="number" min="0" step="0.01" value="${Number(product.price)||0}"></div><div class="field"><label>ทุนต่อหน่วยใหม่ <span class="req">*</span></label><input id="baseUnitNewCost" type="number" min="0" step="0.01" value="${Number(product.cost)||0}"></div><div class="field"><label>บาร์โค้ดเดิม</label><input value="${escapeHtml(product.barcode||'-')}" disabled><small style="color:var(--text-muted);">จะย้ายไปผูกกับหน่วย ${escapeHtml(product.unit)}</small></div></div><div style="font-size:13px;font-weight:700;margin:18px 0 8px;">ตัวอย่างสต๊อกหลังเปลี่ยน</div><div id="baseUnitStockPreview"></div></div><div class="payment-actions" style="padding:14px 18px;border-top:1px solid var(--border);"><button class="btn ghost" type="button" id="cancelBaseUnitChange">ยกเลิก</button><button class="btn primary" type="submit" id="confirmBaseUnitChange">ยืนยันเปลี่ยนหน่วยหลัก</button></div></form></div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#cancelBaseUnitChange').onclick=close;
  const conversionInput=overlay.querySelector('#baseUnitConversion');
  const priceInput=overlay.querySelector('#baseUnitNewPrice');
  const costInput=overlay.querySelector('#baseUnitNewCost');
  let priceEdited=false,costEdited=false;
  priceInput.addEventListener('input',()=>{ priceEdited=true; });
  costInput.addEventListener('input',()=>{ costEdited=true; });
  const updatePreview=()=>{
    const conversion=Number(conversionInput.value);
    if(!priceEdited&&conversion>0) priceInput.value=String(baseUnitChangeRound((Number(product.price)||0)/conversion));
    if(!costEdited&&conversion>0) costInput.value=String(baseUnitChangeRound((Number(product.cost)||0)/conversion));
    const newUnit=overlay.querySelector('#baseUnitNewName').value.trim()||'หน่วยใหม่';
    const rows=baseUnitChangeStockPreview(product.id,conversion);
    overlay.querySelector('#baseUnitStockPreview').innerHTML=`<table class="grid-table"><thead><tr><th>คลังสินค้า</th><th>ก่อนเปลี่ยน</th><th>หลังเปลี่ยน</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escapeHtml(row.warehouseName)}</td><td class="mono num">${row.before} ${escapeHtml(product.unit)}</td><td class="mono num">${conversion>0?`${row.after} ${escapeHtml(newUnit)}`:'-'}</td></tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:var(--text-muted);">ยังไม่มีคลังสินค้า</td></tr>'}</tbody></table>`;
  };
  conversionInput.addEventListener('input',updatePreview);
  overlay.querySelector('#baseUnitNewName').addEventListener('input',updatePreview);
  updatePreview();
  overlay.querySelector('#baseUnitChangeForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=overlay.querySelector('#confirmBaseUnitChange');
    const requestedBarcode=overlay.querySelector('#baseUnitNewBarcode').value.trim();
    const barcodeConflict=requestedBarcode&&barcodePrintBarcodeOwners().find(owner=>String(owner.code||'').toLowerCase()===requestedBarcode.toLowerCase());
    if(barcodeConflict){
      const conflictProduct=products.find(item=>Number(item.id)===Number(barcodeConflict.pid));
      showToast(`บาร์โค้ด ${requestedBarcode} ถูกใช้กับ ${conflictProduct?.name||'สินค้าอื่น'} แล้ว`,'danger');
      return;
    }
    const change=buildProductBaseUnitChange(product,{
      newUnit:overlay.querySelector('#baseUnitNewName').value,
      conversion:conversionInput.value,
      newPrice:priceInput.value,
      newCost:costInput.value,
      newBarcode:requestedBarcode,
      changedAt:new Date().toISOString(),
      changedBy:[currentProfile?.firstName,currentProfile?.lastName].filter(Boolean).join(' ')||currentProfile?.username||'',
    });
    if(change.error){ showToast(change.error,'danger'); return; }
    if(!confirm(`ยืนยันเปลี่ยนหน่วยหลักจาก ${change.oldUnit} เป็น ${change.newUnit}\n1 ${change.oldUnit} = ${change.conversion} ${change.newUnit}\nสต๊อกทุกคลังจะถูกแปลงพร้อมกันและย้อนกลับอัตโนมัติไม่ได้`)) return;
    button.disabled=true; button.textContent='กำลังเปลี่ยนหน่วย...';
    try{
      const metadata=productMetadataToRow(change.product);
      const data=await runStockOperation('change_product_base_unit',{
        productId:product.id,expectedOldUnit:change.oldUnit,newUnit:change.newUnit,
        conversionFactor:change.conversion,productData:metadata.data,price:change.product.price,cost:change.product.cost,
      });
      Object.assign(product,change.product);
      (data?.balances||[]).forEach(balance=>updateInventoryBalanceLocal(product.id,balance.warehouseId,balance.stock,balance.expiry));
      applyActiveWarehouseInventory();
      if(mobileProductEditor){
        // Read the committed revision so a subsequent mobile edit is not stale.
        const {data:latest,error}=await sb.from('products').select('*').eq('id',product.id).maybeSingle();
        if(!error&&latest) Object.assign(product,rowToProduct(latest),{stock:product.stock,expiry:product.expiry});
      }
      addUnitIfNew(change.newUnit); addUnitIfNew(change.oldUnit);
      refreshCategoryBrandUnitLists();
      const dirtyOperation=productDirtyOperations.get(String(product.id));
      const productCacheSaved=dirtyOperation
        ?await clearAcknowledgedProductDirtyOperations([product.id],new Map([[String(product.id),dirtyOperation]]))
        :await persistProductsToIndexedDB(products,true);
      if(productCacheSaved) seedTableSnapshot('products',products,productMetadataToRow);
      else seedProductSyncSnapshot(products,productDirtyOperations);
      persistWorkspaceData();
      close();
      if(mobileProductEditor){
        mobileProductEditor=null; editingProductId=null;
        mobileSelectPriceProduct(product,change.newUnit);
      }
      showToast(`เปลี่ยนหน่วยหลักเป็น ${change.newUnit} และแปลงสต๊อกทุกคลังแล้ว`);
      render();
    }catch(error){
      console.error('change product base unit',error);
      showToast(error?.message||'เปลี่ยนหน่วยหลักไม่สำเร็จ กรุณาลองอีกครั้ง','danger');
      button.disabled=false; button.textContent='ยืนยันเปลี่ยนหน่วยหลัก';
    }
  });
}


function renderProductForm(options={}){
  const mobile=options.mobile===true;
  const isNew = editingProductId==='new';
  const canViewCost=!isLevel2User();
  const p = mobile?mobileProductEditor.draft:(isNew ? {name:'',sku:'',category:'',unit:'',barcode:'',price:'',cost:'',stock:'',threshold:5,expiry:'',wh:1,type:'stock',desc:'',active:true} : products.find(x=>x.id===editingProductId));
  const mainUnitSelect=comboSelect('f_unit', units, p.unit, 'ระบุหน่วยสินค้า');
  const renderedMainUnitSelect=isNew?mainUnitSelect:mainUnitSelect.replace('<select ','<select disabled ');
  return `
    ${mobile?`<div class="mobile-product-heading"><h1>${isNew?'เพิ่มสินค้า':'แก้ไขสินค้า'}</h1><span>ข้อมูลสินค้าใช้ร่วมกับหน้าคอม</span></div>`:`<div class="pagehead"><div><div class="breadcrumb">รายการสินค้า › ${isNew?'เพิ่มสินค้า':'แก้ไขสินค้า'}</div></div></div>`}

    <div class="panel product-status-panel ${isProductActive(p)?'':'inactive'}"><div class="paneltoggle"><div><h3>สถานะสินค้า</h3><div class="psub" style="margin:0;">ปิดใช้งานเมื่อไม่ต้องการขายหรือเลือกสินค้านี้ในเอกสารใหม่ รายงานและประวัติเดิมยังคงอยู่</div></div><label class="switch" title="เปิดหรือปิดใช้งานสินค้า"><input type="checkbox" id="f_active" ${isProductActive(p)?'checked':''}><span class="slider"></span></label></div></div>

    <div class="panel"><h3 class="prodform-gap">หมวดสินค้า</h3>
      <div class="prodrow r3 product-category-grid">
        <div class="field"><label>หมวดสินค้าหลัก</label>${comboSelect('f_category', categories, p.category, 'ระบุหมวดสินค้า')}</div>
        <div class="field"><label>ยี่ห้อ/แบรนด์</label>${comboSelect('f_brand', brands, p.brand||'ทั่วไป', 'ระบุยี่ห้อ/แบรนด์')}</div>
        <div class="field"><label>ภาษีมูลค่าเพิ่ม (VAT)</label>${isBusinessVatRegistered()?`<select id="f_vat"><option value="incl" ${(p.vat||'incl')==='incl'?'selected':''}>VAT 7% — ราคาขายรวม VAT แล้ว</option><option value="excl" ${p.vat==='excl'?'selected':''}>VAT 7% — ราคาขายยังไม่รวม VAT</option><option value="none" ${p.vat==='none'?'selected':''}>ยกเว้น VAT</option></select>`:`<input id="f_vat" type="hidden" value="${normalizeProductVatMode(p.vat)}"><input value="ไม่คิด VAT — กิจการยังไม่จด VAT" readonly>`}</div>
      </div>
    </div>

    <div class="panel"><h3 class="prodform-gap">ข้อมูลสินค้า</h3>
      <div class="prodform">
        <div class="prodrow product-identity-grid">
          <div class="field"><label>รหัสสินค้า (SKU)</label><input id="f_sku" value="${escapeHtml(p.sku||'')}"></div>
          <div class="field"><label>ชื่อสินค้า <span class="req">*</span></label><input id="f_name" value="${escapeHtml(p.name)}"></div>
        </div>
        <div class="prodrow r1">
          <div class="field"><label>รายละเอียดเพิ่มเติม</label><textarea id="f_desc" rows="2">${escapeHtml(p.desc||'')}</textarea></div>
        </div>
      </div>
    </div>

    <div class="panel product-pricing-panel ${canViewCost?'':'no-cost'}">
      <div class="product-main-unit-grid ${isNew?'':'has-base-unit-action'}">
        <div class="field"><label>หน่วยสินค้าหลัก <span class="req">*</span></label>${renderedMainUnitSelect}</div>
        <div class="field"><label>ราคาขาย <span class="req">*</span></label><input id="f_price" class="no-spin" type="number" value="${escapeHtml(p.price)}" placeholder="0.00"></div>
        ${canViewCost?`<div class="field"><label>ราคาทุน</label><input id="f_cost" class="no-spin" type="number" value="${escapeHtml(p.cost!==undefined?p.cost:'')}" placeholder="0.00"></div>`:`<input id="f_cost" type="hidden" value="${escapeHtml(p.cost!==undefined?p.cost:'')}">`}
        <input id="f_stock" type="hidden" value="${escapeHtml(Number(p.stock)||0)}" readonly>
        <div class="field"><label>เลขบาร์โค้ด</label><input id="f_barcode" value="${escapeHtml(p.barcode)}"></div>
        ${isNew?'':'<button class="btn primary small product-base-unit-action" type="button" id="changeBaseUnitBtn" title="เปลี่ยนหน่วยหลัก" aria-label="เปลี่ยนหน่วยหลัก"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/></svg></button>'}
      </div>
      ${isNew?'':'<small id="directUnitEditHint" style="display:block;margin-top:8px;color:var(--text-muted)"></small>'}
      <div class="paneltoggle product-extra-unit-toggle"><div><h3 style="font-size:14px;">หน่วยสินค้าเพิ่มเติม <span class="psub" style="font-weight:400;">• ตัวอย่าง: 1 กล่อง = 10 แผง, 1 ลัง = 10 กล่อง</span></h3></div>
      <label class="switch"><input type="checkbox" id="f_multiunit" ${(isNew&&!mobile?true:p.multiunit)?'checked':''}><span class="slider"></span></label></div>
      <div id="multiunitBody" style="${(isNew&&!mobile?true:p.multiunit)?'':'display:none;'}margin-top:14px;">
        <div id="unitRows">${(()=>{ const rawRows=(p.units&&p.units.length?p.units:[{sub:'',per:'',base:'',price:'',cost:'',barcode:''}]); const rows=computeUnitRowsWithStock(rawRows, p.unit, Number(p.stock)||0); const names=rows.map(r=>r.sub); return rows.map(u=>unitRowHtml(u, p.unit, names)).join(''); })()}</div>
        <button class="btn ghost small" id="addUnitBtn" style="margin-top:8px;">+ เพิ่มหน่วยสินค้า</button>
      </div>
    </div>

    ${mobile?'':`<div class="barcode-cols">
    <div class="panel"><div class="paneltoggle"><div><h3>บาร์โค้ดเพิ่มเติม <span class="psub" style="font-weight:400;">• เผื่อสินค้าเปลี่ยนเลขบาร์โค้ดในล็อตใหม่ — ยิงเลขไหนก็เจอสินค้าตัวเดียวกัน</span></h3></div>
      <label class="switch"><input type="checkbox" id="f_extrabc_toggle" ${(p.extraBarcodes&&p.extraBarcodes.length)?'checked':''}><span class="slider"></span></label></div>
      <div id="extraBcBody" style="${(p.extraBarcodes&&p.extraBarcodes.length)?'':'display:none;'}margin-top:14px;">
        <div id="extraBarcodeRows">${(p.extraBarcodes&&p.extraBarcodes.length?extraBarcodeEntries(p):[{code:'',unit:p.unit||''}]).map(entry=>extraBarcodeRowHtml(entry,extraBarcodeAvailableUnits(p),p.unit)).join('')}</div>
        <button class="btn ghost small" id="addExtraBarcodeBtn" style="margin-top:8px;">+ เพิ่มบาร์โค้ด</button>
      </div>
    </div>

    <div class="panel"><div class="paneltoggle"><div><h3>บาร์โค้ดผู้จำหน่าย <span class="psub" style="font-weight:400;">• เผื่อผู้จำหน่ายแต่ละเจ้ามีเลขบาร์โค้ดของตัวเอง — ยิงแล้วก็เจอสินค้าตัวนี้</span></h3></div>
      <label class="switch"><input type="checkbox" id="f_vendorbc_toggle" ${(p.vendorBarcodes&&p.vendorBarcodes.length)?'checked':''}><span class="slider"></span></label></div>
      <div id="vendorBcBody" style="${(p.vendorBarcodes&&p.vendorBarcodes.length)?'':'display:none;'}margin-top:14px;">
        <div id="vendorBarcodeRows">${(p.vendorBarcodes&&p.vendorBarcodes.length?p.vendorBarcodes:[{vendor:'',code:''}]).map(vb=>vendorBarcodeRowHtml(vb)).join('')}</div>
        <button class="btn ghost small" id="addVendorBarcodeBtn" style="margin-top:8px;">+ เพิ่มบาร์โค้ดผู้จำหน่าย</button>
      </div>
    </div>
    </div>`}

    <div class="product-form-actions ${mobile?'mobile-product-form-actions':'form-final-actions'}">
      ${!mobile&&!isNew&&loggedInUser()?.owner===true&&Number(loggedInUser()?.level)===1?'<button class="btn product-delete-btn" id="deleteProductBtn" type="button">ลบสินค้า</button>':''}
      <button class="btn ghost" id="cancelProductBtn">ยกเลิก</button>
      <button class="btn primary" id="saveProductBtn">บันทึก</button>
    </div>
  `;
}
