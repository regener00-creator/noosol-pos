// Only pair two store records when their name and a unit barcode agree unambiguously.
function combinedCatalogRows(catalog){
  const index=new Map();
  const records=catalog.map(product=>{
    const name=String(product.name||'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
    const units=productUnitOptions(product);
    const keys=units.filter(unit=>name&&String(unit.barcode||'').trim()).map(unit=>
      JSON.stringify([name,String(unit.name||'').trim(),String(unit.barcode).trim().toLowerCase()]));
    const record={product,units,keys,barcodes:productBarcodeCodes(product),warehouse:Number(product.wh)||1};
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
  return `<section class="rpt combined-catalog" aria-label="${stockOnly?'สินค้าคงเหลือ':'ราคาสินค้า'}" data-combined-stock="${stockOnly}">
    <div class="tree-pane"><div class="product-group-header"><span class="product-group-title">กลุ่มสินค้า</span><span class="product-group-separator">:</span><div class="product-group-categories" data-combined-categories role="group" aria-label="หมวดหลัก"></div></div>
    <div class="product-group-brands" data-combined-brands role="group" aria-label="หมวดย่อย"></div></div>
    <div class="product-list-search combined-search-group"><select class="rpt-select" data-combined-search-field aria-label="ค้นหาตาม"><option value="all">ค้นหาทุกช่อง</option><option value="barcode">บาร์โค้ด</option><option value="name">ชื่อสินค้า</option></select><input data-combined-search placeholder="ค้นหาจาก ชื่อ / รหัส / บาร์โค้ด" aria-label="ค้นหาสินค้า">
    <div class="product-review-filters combined-legend" role="group" aria-label="กรองสินค้าตามร้าน">${['','พระยาสุเรนทร์','พรชัย'].map(shop=>`<button type="button" class="product-review-filter" data-exclusive-shop="${shop}" aria-pressed="false"><span class="product-review-filter-dot" aria-hidden="true"></span>${shop||'ทั้งหมด'}</button>`).join('')}</div></div>
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
const combinedShopFilters=new Map();
function attachCombinedCatalog(page){
  const shops=accessibleWarehouses().slice().sort((a,b)=>a.id-b.id);
  const rows=combinedCatalogRows(products);
  const categories=page.querySelector('[data-combined-categories]'),brands=page.querySelector('[data-combined-brands]');
  const search=page.querySelector('[data-combined-search]');
  const searchField=page.querySelector('[data-combined-search-field]');
  const stockOnly=page.dataset.combinedStock==='true';
  const storeButtons=page.querySelectorAll('[data-exclusive-shop]');
  const shopNames=new Map(shops.map(shop=>[Number(shop.id),shop.name]));
  const exclusiveShop=row=>row.members.length===1?shopNames.get(row.members[0].warehouse):'';
  const actor=currentProfile.id;
  const pageSize=10;
  const {tree}=buildGroupTree();
  const categoryNames=productGroupCategoryNames(tree);
  let category='',brand='';
  const mainCategory=p=>String(p.category||'').trim()||'ไม่ทราบหมวดหมู่';
  const subCategory=p=>p.brand||'ทั่วไป';
  function drawGroups(){
    const catCounts=new Map(),brandCounts=new Map(),shop=combinedShopFilters.get(actor);
    for(const row of rows){
      if(shop&&exclusiveShop(row)!==shop)continue;
      const cats=new Set(),subs=new Set();
      for(const {product} of row.members){
        const name=mainCategory(product);
        cats.add(name);
        if(name===category)subs.add(subCategory(product));
      }
      for(const name of cats)catCounts.set(name,(catCounts.get(name)||0)+1);
      for(const name of subs)brandCounts.set(name,(brandCounts.get(name)||0)+1);
    }
    function buttons(names,kind,selected,counts){
      return names.map(name=>`<button type="button" class="product-group-${kind}${name===selected?' active':''}" data-combined-${kind}="${escapeHtml(name)}" aria-pressed="${name===selected}"><span>${escapeHtml(name)}</span><span class="product-group-${kind}-count">${counts.get(name)||0}</span></button>`).join('');
    }
    categories.innerHTML=buttons(categoryNames,'category',category,catCounts);
    brands.innerHTML=category?buttons([...tree[category]].sort((a,b)=>a.localeCompare(b,'th')),'brand',brand,brandCounts):'<div class="product-group-empty">เลือกกลุ่มสินค้าหลักเพื่อแสดงหมวดสินค้าย่อย</div>';
  }
  let pageNo=1;
  const pager=page.querySelector('[data-combined-pager]');
  const results=page.querySelector('[data-combined-results]');
  const barcodeMatches=(option,term)=>[...option.shops.values()].some(({unit})=>String(unit.barcode||'').toLowerCase().includes(term));
  function matchesSearch(row,term){
    if(!term)return true;
    const field=searchField.value;
    return row.members.some(({product,barcodes})=>
      (field!=='barcode'&&String(product.name||'').toLowerCase().includes(term))||
      (field!=='name'&&barcodes.some(code=>code.includes(term)))||
      (field==='all'&&String(product.sku||'').toLowerCase().includes(term)));
  }
  function describeValues(option,getValue){
    const values=shops.filter(shop=>option.shops.has(Number(shop.id))).map(shop=>({shop,value:getValue(option.shops.get(Number(shop.id)))}));
    if(new Set(values.map(entry=>entry.value)).size===1)return values[0].value;
    return values.map(({shop,value})=>`${shop.name}: ${value}`).join(' / ');
  }
  function draw(){
    const shopFilter=combinedShopFilters.get(actor)||'';
    storeButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.exclusiveShop===shopFilter)));
    const term=search.value.trim().toLowerCase();
    const matches=rows.filter(row=>(!shopFilter||exclusiveShop(row)===shopFilter)&&row.members.some(({product})=>(!category||category===mainCategory(product))&&(!brand||brand===subCategory(product)))&&
      matchesSearch(row,term));
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));
    pageNo=Math.min(pageNo,pages);
    const headers=shops.map(shop=>stockOnly?`<th>คงเหลือ · ${escapeHtml(shop.name)}</th>`:`<th>ราคาขาย · ${escapeHtml(shop.name)}</th><th>ทุน · ${escapeHtml(shop.name)}</th>`).join('');
    const body=matches.slice((pageNo-1)*pageSize,pageNo*pageSize).map(row=>{
      const id=row.members[0].product.id;
      const preferred=readCombinedValue(combinedUnitPreferenceKey(id));
      const option=row.options.find(item=>item.name===preferred)||
        (term&&searchField.value!=='name'&&row.options.find(item=>barcodeMatches(item,term)))||row.options[0];
      const control=row.options.length===1?`<span class="prod-unit-fixed">${escapeHtml(option.name)}</span>`:
        `<select class="prod-unit-select" data-combined-unit="${id}" aria-label="หน่วยของ ${escapeHtml(row.name)}">${row.options.map(item=>`<option value="${escapeHtml(item.name)}" ${item===option?'selected':''}>${escapeHtml(describeValues(item,entry=>entry.label))}</option>`).join('')}</select>`;
      const cells=shops.map(shop=>{
        const entry=option.shops.get(Number(shop.id));
        if(stockOnly)return `<td class="combined-amount">${entry?inspectionListAmount(warehouseStock(entry.product.id,shop.id)/entry.unit.factor):'—'}</td>`;
        return `<td class="combined-amount">${entry?fmtMoney(entry.unit.price):'—'}</td><td class="combined-amount">${entry?fmtMoney(entry.unit.cost):'—'}</td>`;
      }).join('');
      const only=exclusiveShop(row);
      const color=only==='พรชัย'?'only-phonchai':only==='พระยาสุเรนทร์'?'only-phraya':'';
      return `<tr class="${color}"><td class="combined-barcode">${escapeHtml(describeValues(option,entry=>String(entry.unit.barcode||'—')))}</td><td>${escapeHtml(row.name)}</td><td><div class="combined-unit-cell">${control}</div></td>${cells}</tr>`;
    }).join('');
    const columns=3+shops.length*(stockOnly?1:2);
    results.innerHTML=`<table class="grid-table doc-head-blue"><thead><tr><th class="combined-barcode">บาร์โค้ด</th><th>สินค้า</th><th>หน่วย</th>${headers}</tr></thead><tbody>${body||`<tr><td colspan="${columns}">ไม่พบสินค้า</td></tr>`}</tbody></table>`;
    pager.innerHTML=pagerHtml(pageNo,pages,'combined-page');
  }
  for(const [host,kind] of [[categories,'category'],[brands,'brand']]){
    const attr='data-combined-'+kind;
    host.onclick=event=>{
      const button=event.target.closest(`[${attr}]`);
      if(!button)return;
      const name=button.getAttribute(attr);
      if(kind==='category'){category=category===name?'':name;brand='';}
      else brand=brand===name?'':name;
      pageNo=1;drawGroups();draw();
      host.querySelector(`[${attr}="${CSS.escape(name)}"]`)?.focus({preventScroll:true});
    };
  }
  search.oninput=()=>{pageNo=1;draw();};
  searchField.onchange=()=>{
    search.placeholder={all:'ค้นหาจาก ชื่อ / รหัส / บาร์โค้ด',barcode:'พิมพ์หรือสแกนบาร์โค้ด',name:'ค้นหาชื่อสินค้า'}[searchField.value];
    pageNo=1;draw();search.focus();
  };
  storeButtons.forEach(button=>button.onclick=()=>{
    const shop=button.dataset.exclusiveShop;
    if(!shop||combinedShopFilters.get(actor)===shop)combinedShopFilters.delete(actor);
    else combinedShopFilters.set(actor,shop);
    pageNo=1;drawGroups();draw();
  });
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
  drawGroups();draw();
  let refreshing=false;
  page.refreshCombinedUnits=async()=>{
    if(refreshing)return;
    refreshing=true;
    try{await refreshCombinedUnits(page,rows,draw);}finally{refreshing=false;}
  };
  void page.refreshCombinedUnits();
}
