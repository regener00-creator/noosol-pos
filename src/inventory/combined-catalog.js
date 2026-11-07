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
// A manual unit choice belongs to this user's combined view, across both pages.
const combinedUnitFallback=new Map();
const combinedUnitWrites=new Map(),combinedUnitEdits=new Map();
let combinedUnitVersion=0;
function combinedUnitPreferenceKey(id,actor=currentProfile.id){
  return `pepos_combined_unit_v1:${actor}:${id}`;
}
function readCombinedValue(key){
  if(combinedUnitFallback.has(key))return combinedUnitFallback.get(key);
  try{return localStorage.getItem(key);}catch{return null;}
}
function cacheCombinedValue(key,name){
  try{
    if(name===null)localStorage.removeItem(key);else localStorage.setItem(key,name);
    combinedUnitFallback.delete(key);
  }catch{combinedUnitFallback.set(key,name);}
}
function flushCombinedUnit(actor,id){
  const key=combinedUnitPreferenceKey(id,actor);
  if(combinedUnitWrites.has(key))return combinedUnitWrites.get(key);
  const pending=key+':pending';
  const task=Promise.resolve().then(async()=>{
    while(currentProfile?.id===actor&&navigator.onLine){
      const name=readCombinedValue(pending);
      if(!name)break;
      const {error}=await sb.from('combined_catalog_unit_preferences').upsert({user_id:actor,product_id:id,unit_name:name},{onConflict:'user_id,product_id'});
      if(error)throw error;
      if(readCombinedValue(pending)===name)cacheCombinedValue(pending,null);
    }
  }).catch(()=>{if(currentProfile?.id===actor)showToast('ยังซิงก์หน่วยไม่ได้ เก็บไว้บนเครื่องแล้ว ระบบจะลองใหม่เมื่อเปิดคลังรวมหรือต่ออินเทอร์เน็ต');})
    .finally(()=>combinedUnitWrites.delete(key));
  combinedUnitWrites.set(key,task);
  return task;
}
function rememberCombinedUnit(id,name){
  const actor=currentProfile.id,key=combinedUnitPreferenceKey(id,actor);
  combinedUnitEdits.set(key,++combinedUnitVersion);
  cacheCombinedValue(key,name);cacheCombinedValue(key+':pending',name);
  if(navigator.onLine)void flushCombinedUnit(actor,id);
  else showToast('จำหน่วยไว้บนเครื่องแล้ว จะซิงก์กับบัญชีเมื่อกลับมาออนไลน์');
}
function localCombinedUnitIds(actor){
  const prefix=combinedUnitPreferenceKey('',actor),keys=new Set(combinedUnitFallback.keys());
  try{for(let i=0;i<localStorage.length;i++)keys.add(localStorage.key(i));}catch{}
  return new Set([...keys].filter(key=>key?.startsWith(prefix)).map(key=>Number(key.slice(prefix.length).split(':')[0])).filter(Number.isSafeInteger));
}
function retryCombinedUnitWrites(){
  const actor=currentProfile?.id;
  if(!actor)return;
  for(const id of localCombinedUnitIds(actor)){
    if(readCombinedValue(combinedUnitPreferenceKey(id,actor)+':pending'))void flushCombinedUnit(actor,id);
  }
}
async function refreshCombinedUnits(page,rows,draw){
  const actor=currentProfile?.id;
  if(!actor||!navigator.onLine)return;
  const version=combinedUnitVersion;
  const pendingAtRead=new Set(combinedUnitWrites.keys());
  const prefix=combinedUnitPreferenceKey('',actor);
  const isCurrent=()=>page.isConnected&&currentProfile?.id===actor;
  const table='combined_catalog_unit_preferences';
  const fetchPreferences=()=>fetchAllRows(()=>sb.from(table).select('product_id,unit_name').eq('user_id',actor).order('product_id'));
  try{
    let result=await fetchPreferences();
    if(result.error)throw result.error;
    if(!isCurrent())return;
    const remoteIds=new Set(result.data.map(row=>Number(row.product_id)));
    const legacy=[];
    const localIds=localCombinedUnitIds(actor);
    for(const row of rows){
      const id=Number(row.members[0].product.id);
      if(!localIds.has(id))continue;
      const key=prefix+id;
      if(readCombinedValue(key+':pending')){pendingAtRead.add(key);void flushCombinedUnit(actor,id);continue;}
      if(!remoteIds.has(id)){
        const name=readCombinedValue(key);
        if(name&&row.options.some(option=>option.name===name))legacy.push({user_id:actor,product_id:id,unit_name:name});
      }
    }
    // Import old device-only choices once. A choice already saved by another device wins.
    for(let i=0;i<legacy.length;i+=200){
      if(!isCurrent())return;
      const {error}=await sb.from(table).upsert(legacy.slice(i,i+200),{onConflict:'user_id,product_id',ignoreDuplicates:true});
      if(error)throw error;
    }
    if(legacy.length)result=await fetchPreferences();
    if(result.error)throw result.error;
    if(!isCurrent())return;
    let changed=false;
    for(const {product_id,unit_name} of result.data){
      const key=prefix+product_id;
      if(pendingAtRead.has(key)||(combinedUnitEdits.get(key)||0)>version||readCombinedValue(key+':pending')||readCombinedValue(key)===unit_name)continue;
      cacheCombinedValue(key,unit_name);changed=true;
    }
    if(changed)draw();
  }catch{if(isCurrent())showToast('โหลดหน่วยที่บันทึกกับบัญชีไม่ได้ กำลังใช้หน่วยที่จำไว้บนเครื่อง');}
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
      const preferred=readCombinedValue(combinedUnitPreferenceKey(id));
      const option=row.options.find(item=>item.name===preferred)||
        (term&&row.options.find(item=>barcodeMatches(item,term)))||row.options[0];
      const control=row.options.length===1?`<span class="prod-unit-fixed">${escapeHtml(option.name)}</span>`:
        `<select class="prod-unit-select" data-combined-unit="${id}" aria-label="หน่วยของ ${escapeHtml(row.name)}">${row.options.map(item=>`<option value="${escapeHtml(item.name)}" ${item===option?'selected':''}>${escapeHtml(describeValues(item,entry=>entry.label))}</option>`).join('')}</select>`;
      const cells=shops.map(shop=>{
        const entry=option.shops.get(Number(shop.id));
        if(stockOnly)return `<td>${entry?inspectionListAmount(warehouseStock(entry.product.id,shop.id)/entry.unit.factor):'—'}</td>`;
        return `<td class="combined-amount">${entry?fmtMoney(entry.unit.price):'—'}</td><td class="combined-amount">${entry?fmtMoney(entry.unit.cost):'—'}</td>`;
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
    rememberCombinedUnit(id,select.value);draw();
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
  let refreshing=false;
  page.refreshCombinedUnits=async()=>{
    if(refreshing)return;
    refreshing=true;
    try{await refreshCombinedUnits(page,rows,draw);}finally{refreshing=false;}
  };
  void page.refreshCombinedUnits();
}
