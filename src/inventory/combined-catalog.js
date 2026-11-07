// Only pair two store records when their name and a unit barcode agree unambiguously.
function combinedCatalogRows(catalog){
  const index=new Map();
  const records=catalog.map(product=>{
    const name=String(product.name||'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
    const units=productUnitOptions(product);
    const keys=units.filter(unit=>name&&String(unit.barcode||'').trim()).map(unit=>
      JSON.stringify([name,String(unit.name||'').trim(),String(unit.barcode).trim().toLowerCase()]));
    const record={product,units,keys,warehouse:Number(product.wh)||1};
    for(const key of keys){
      if(!index.has(key))index.set(key,[]);
      index.get(key).push(record);
    }
    return record;
  });
  const partners=new Map();
  for(const record of records){
    const candidates=new Set(record.keys.flatMap(key=>index.get(key)).filter(other=>other.warehouse!==record.warehouse));
    if(candidates.size===1)partners.set(record,[...candidates][0]);
  }
  const rows=[],seen=new Set();
  for(const record of records){
    if(seen.has(record))continue;
    const partner=partners.get(record);
    const members=partners.get(partner)===record?[record,partner]:[record];
    members.sort((a,b)=>a.warehouse-b.warehouse);
    const options=new Map();
    for(const member of members){
      seen.add(member);
      const labels=new Map(productUnitConversionRows(member.product).map(row=>[row.largerUnit,`${row.largerUnit} = ${productUnitConversionAmount(row.quantity)} ${row.smallerUnit}`]));
      for(const unit of member.units){
        if(!options.has(unit.name))options.set(unit.name,{name:unit.name,shops:new Map()});
        options.get(unit.name).shops.set(member.warehouse,{product:member.product,unit,label:labels.get(unit.name)||unit.name});
      }
    }
    rows.push({name:members[0].product.name,members,options:[...options.values()]});
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name,'th')||a.members[0].product.id-b.members[0].product.id);
}
function renderCombinedCatalog(stockOnly){
  if(stockOnly&&reportWarehouseIds().some(id=>!loadedInventoryBalanceWarehouseIds.has(id))){
    return '<section class="rpt"><p role="status">กำลังตรวจยอดคงเหลือของแต่ละคลัง</p><button type="button" class="btn ghost" id="combinedReloadBalances">โหลดสินค้าคงเหลือ</button></section>';
  }
  const heading=stockOnly?'สินค้าคงเหลือ':'PRODUCT';
  return `<section class="rpt combined-catalog" data-combined-stock="${stockOnly}"><div class="pagehead"><h1>${heading} · คลังรวม</h1><span data-combined-count aria-live="polite"></span></div>
    <div class="rpt-filters"><select class="rpt-select" data-combined-category aria-label="หมวดหลัก"></select><select class="rpt-select" data-combined-brand aria-label="หมวดย่อย"></select><div class="combined-search-group"><input data-combined-search class="barcode-print-search" placeholder="ค้นหาชื่อสินค้า หรือบาร์โค้ด" aria-label="ค้นหาสินค้า">
    ${stockOnly?'':'<div class="combined-legend"><span>สีส้ม · เฉพาะพรชัย</span><span>สีม่วง · เฉพาะพระยาสุเรนทร์</span></div>'}</div></div>
    <div class="seamless-table-wrap" data-combined-results></div><div data-combined-pager></div></section>`;
}
function attachCombinedCatalog(page){
  const shops=accessibleWarehouses().slice().sort((a,b)=>a.id-b.id);
  const rows=combinedCatalogRows(products);
  const cat=page.querySelector('[data-combined-category]'),brand=page.querySelector('[data-combined-brand]');
  const search=page.querySelector('[data-combined-search]');
  const stockOnly=page.dataset.combinedStock==='true';
  const pageSize=10;
  const options=(values,title)=>`<option value="">${title}: ทั้งหมด</option>`+[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th')).map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  const configured=effectiveProductCategorySettings();
  cat.innerHTML=options(configured.categories,'หมวดหลัก');
  const updateBrands=()=>{
    const names=configured.subcategories.filter(sub=>!cat.value||sub.categories.includes(cat.value)).map(sub=>sub.name);
    brand.innerHTML=options(names,'หมวดย่อย');
  };
  updateBrands();
  let pageNo=1;
  const pager=page.querySelector('[data-combined-pager]');
  const results=page.querySelector('[data-combined-results]');
  const selectedUnits=new Map();
  const barcodeMatches=(option,term)=>[...option.shops.values()].some(({unit})=>String(unit.barcode||'').toLowerCase().includes(term));
  function describeValues(option,getValue){
    const values=shops.filter(shop=>option.shops.has(Number(shop.id))).map(shop=>({shop,value:getValue(option.shops.get(Number(shop.id)))}));
    if(new Set(values.map(entry=>entry.value)).size===1)return values[0].value;
    return values.map(({shop,value})=>`${shop.name}: ${value}`).join(' / ');
  }
  function draw(){
    const term=search.value.trim().toLowerCase();
    const matches=rows.filter(row=>row.members.some(({product})=>(!cat.value||cat.value===product.category)&&(!brand.value||brand.value===product.brand))&&
      (!term||row.name.toLowerCase().includes(term)||row.options.some(option=>barcodeMatches(option,term))));
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));
    pageNo=Math.min(pageNo,pages);
    const headers=shops.map(shop=>stockOnly?`<th>คงเหลือ · ${escapeHtml(shop.name)}</th>`:`<th>ราคาขาย · ${escapeHtml(shop.name)}</th><th>ทุน · ${escapeHtml(shop.name)}</th>`).join('');
    const body=matches.slice((pageNo-1)*pageSize,pageNo*pageSize).map(row=>{
      const id=row.members[0].product.id;
      const selected=selectedUnits.get(id)??(term?row.options.findIndex(option=>barcodeMatches(option,term)):-1);
      const option=row.options[selected]||row.options[0];
      const control=row.options.length===1?`<span class="prod-unit-fixed">${escapeHtml(option.name)}</span>`:
        `<select class="prod-unit-select" data-combined-unit="${id}" aria-label="หน่วยของ ${escapeHtml(row.name)}">${row.options.map((item,i)=>`<option value="${i}" ${item===option?'selected':''}>${escapeHtml(describeValues(item,entry=>entry.label))}</option>`).join('')}</select>`;
      const cells=shops.map(shop=>{
        const entry=option.shops.get(Number(shop.id));
        if(stockOnly)return `<td>${entry?inspectionListAmount(warehouseStock(entry.product.id,shop.id)/entry.unit.factor):'—'}</td>`;
        return `<td>${entry?fmtMoney(entry.unit.price):'—'}</td><td>${entry?fmtMoney(entry.unit.cost):'—'}</td>`;
      }).join('');
      const only=!stockOnly&&row.members.length===1?shops.find(shop=>Number(shop.id)===row.members[0].warehouse)?.name:'';
      const color=only==='พรชัย'?'only-phonchai':only==='พระยาสุเรนทร์'?'only-phraya':'';
      return `<tr class="${color}">${stockOnly?`<td>${escapeHtml(describeValues(option,entry=>String(entry.unit.barcode||'—')))}</td>`:''}<td>${escapeHtml(row.name)}</td><td><div class="combined-unit-cell">${control}</div></td>${cells}</tr>`;
    }).join('');
    const columns=(stockOnly?3:2)+shops.length*(stockOnly?1:2);
    results.innerHTML=`<table class="grid-table doc-head-blue"><thead><tr>${stockOnly?'<th>บาร์โค้ด</th>':''}<th>สินค้า</th><th>หน่วย</th>${headers}</tr></thead><tbody>${body||`<tr><td colspan="${columns}">ไม่พบสินค้า</td></tr>`}</tbody></table>`;
    page.querySelector('[data-combined-count]').textContent=`${matches.length} รายการ · หน้า ${pageNo} / ${pages}`;
    pager.innerHTML=pagerHtml(pageNo,pages,'combined-page');
  }
  cat.onchange=()=>{updateBrands();pageNo=1;draw();};
  brand.onchange=()=>{pageNo=1;draw();};
  search.oninput=()=>{pageNo=1;draw();};
  results.onchange=event=>{
    const select=event.target.closest('[data-combined-unit]');
    if(!select)return;
    const id=Number(select.dataset.combinedUnit);
    selectedUnits.set(id,Number(select.value));draw();
    results.querySelector(`[data-combined-unit="${id}"]`)?.focus({preventScroll:true});
  };
  pager.onclick=event=>{
    const button=event.target.closest('[data-combined-page]');
    if(!button||button.disabled)return;
    const value=button.dataset.combinedPage;
    pageNo=value==='prev'?pageNo-1:value==='next'?pageNo+1:Number(value);
    draw();
    (pager.querySelector(`[data-combined-page="${value}"]:not(:disabled)`)||pager.querySelector('.active'))?.focus({preventScroll:true});
  };
  draw();
}
