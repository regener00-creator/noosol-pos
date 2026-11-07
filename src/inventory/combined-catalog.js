// Compare physical units, not SKUs or names. A missing barcode cannot identify another store's product.
function combinedCatalogRows(catalog){
  const groups=new Map();
  for(const product of catalog){
    for(const unit of productUnitOptions(product)){
      const code=String(unit.barcode||'').trim();
      const name=String(product.name||'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
      const key=JSON.stringify(code&&name?[code.toLowerCase(),name,unit.name.trim()]:[null,product.id,unit.name]);
      if(!groups.has(key))groups.set(key,{name:product.name,unit:unit.name,code,shops:new Map()});
      groups.get(key).shops.set(Number(product.wh)||1,{product,unit});
    }
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'th')||a.unit.localeCompare(b.unit,'th'));
}
function renderCombinedCatalog(stockOnly){
  if(stockOnly&&reportWarehouseIds().some(id=>!loadedInventoryBalanceWarehouseIds.has(id))){
    return '<section class="rpt"><p role="status">กำลังตรวจยอดคงเหลือของแต่ละคลัง</p><button type="button" class="btn ghost" id="combinedReloadBalances">โหลดสินค้าคงเหลือ</button></section>';
  }
  const heading=stockOnly?'สินค้าคงเหลือ':'PRODUCT';
  return `<section class="rpt combined-catalog" data-combined-stock="${stockOnly}"><div class="pagehead"><h1>${heading} · คลังรวม</h1></div>
    <div class="rpt-filters"><select class="rpt-select" data-combined-category aria-label="หมวดหลัก"></select><select class="rpt-select" data-combined-brand aria-label="หมวดย่อย"></select><input data-combined-search class="barcode-print-search" placeholder="ค้นหาชื่อสินค้า หรือบาร์โค้ด" aria-label="ค้นหาสินค้า"></div>
    ${stockOnly?'':'<div class="combined-legend"><span>สีส้ม · เฉพาะพรชัย</span><span>สีม่วง · เฉพาะพระยาสุเรนทร์</span></div>'}
    <div class="seamless-table-wrap" data-combined-results></div><div class="combined-pager"><button class="btn ghost small" data-combined-prev>ก่อนหน้า</button><span data-combined-count></span><button class="btn ghost small" data-combined-next>ถัดไป</button></div></section>`;
}
function attachCombinedCatalog(page){
  const shops=accessibleWarehouses().slice().sort((a,b)=>a.id-b.id);
  const rows=combinedCatalogRows(products);
  const cat=page.querySelector('[data-combined-category]'),brand=page.querySelector('[data-combined-brand]');
  const search=page.querySelector('[data-combined-search]');
  const stockOnly=page.dataset.combinedStock==='true';
  const pageSize=stockOnly?50:10;
  const options=(values,title)=>`<option value="">${title}: ทั้งหมด</option>`+[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th')).map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  const configured=effectiveProductCategorySettings();
  cat.innerHTML=options(configured.categories,'หมวดหลัก');
  const updateBrands=()=>{
    const names=configured.subcategories.filter(sub=>!cat.value||sub.categories.includes(cat.value)).map(sub=>sub.name);
    brand.innerHTML=options(names,'หมวดย่อย');
  };
  updateBrands();
  let pageNo=1;
  const prev=page.querySelector('[data-combined-prev]'),next=page.querySelector('[data-combined-next]');
  function draw(){
    const term=search.value.trim().toLowerCase();
    const matches=rows.filter(row=>[...row.shops.values()].some(({product})=>(!cat.value||cat.value===product.category)&&(!brand.value||brand.value===product.brand)&&(!term||product.name.toLowerCase().includes(term)||row.code.toLowerCase().includes(term))));
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));
    pageNo=Math.min(pageNo,pages);
    const headers=shops.map(shop=>stockOnly?`<th>คงเหลือ · ${escapeHtml(shop.name)}</th>`:`<th>ราคาขาย · ${escapeHtml(shop.name)}</th><th>ทุน · ${escapeHtml(shop.name)}</th>`).join('');
    const body=matches.slice((pageNo-1)*pageSize,pageNo*pageSize).map(row=>{
      const cells=shops.map(shop=>{
        const entry=row.shops.get(Number(shop.id));
        if(stockOnly)return `<td>${entry?inspectionListAmount(warehouseStock(entry.product.id,shop.id)/entry.unit.factor):'—'}</td>`;
        return `<td>${entry?fmtMoney(entry.unit.price):'—'}</td><td>${entry?fmtMoney(entry.unit.cost):'—'}</td>`;
      }).join('');
      const only=!stockOnly&&row.shops.size===1?shops.find(shop=>row.shops.has(Number(shop.id)))?.name:'';
      const color=only==='พรชัย'?'only-phonchai':only==='พระยาสุเรนทร์'?'only-phraya':'';
      return `<tr class="${color}">${stockOnly?`<td>${escapeHtml(row.code||'—')}</td>`:''}<td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.unit)}</td>${cells}</tr>`;
    }).join('');
    const columns=(stockOnly?3:2)+shops.length*(stockOnly?1:2);
    page.querySelector('[data-combined-results]').innerHTML=`<table class="grid-table doc-head-blue"><thead><tr>${stockOnly?'<th>บาร์โค้ด</th>':''}<th>สินค้า</th><th>หน่วย</th>${headers}</tr></thead><tbody>${body||`<tr><td colspan="${columns}">ไม่พบสินค้า</td></tr>`}</tbody></table>`;
    page.querySelector('[data-combined-count]').textContent=`${matches.length} รายการ · หน้า ${pageNo} / ${pages}`;
    prev.disabled=pageNo<=1;next.disabled=pageNo>=pages;
  }
  cat.onchange=()=>{updateBrands();pageNo=1;draw();};
  brand.onchange=search.oninput=()=>{pageNo=1;draw();};
  prev.onclick=()=>{pageNo--;draw();};next.onclick=()=>{pageNo++;draw();};
  draw();
}
