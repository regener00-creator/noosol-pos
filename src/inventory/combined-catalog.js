// Pair store records by unit barcodes. Shop-issued labels belong to one store only.
function combinedCatalogRows(catalog){
  const byBarcode=new Map();
  const records=catalog.map(product=>{
    const units=productUnitOptions(product),barcodes=productBarcodeCodes(product);
    const warehouse=Number(product.wh)||1;
    const labels=new Map(productUnitConversionRows(product).map(row=>[row.largerUnit,`${row.largerUnit} = ${productUnitConversionAmount(row.quantity)} ${row.smallerUnit}`]));
    for(const sub of product.units||[]){
      if(sub.base&&Number(sub.per)>0)labels.set(sub.sub,`${sub.sub} = ${productUnitConversionAmount(Number(sub.per))} ${sub.base}`);
    }
    const entries=units.map(unit=>({warehouse,product,unit,label:labels.get(unit.name)||unit.name,codes:[]}));
    const byUnit=new Map(entries.map(entry=>[entry.unit.name,entry]));
    const unitBarcodes=new Set([...units.map(unit=>unit.barcode),...extraBarcodeEntries(product).map(entry=>entry.code)]
      .map(value=>String(value||'').trim().toLowerCase()).filter(Boolean));
    const record={warehouse,product,units,barcodes,entries,partners:new Map()};
    for(const code of barcodes){
      const normalized=code.toUpperCase();
      const name=systemLabelCode(normalized)?shopLabelUnit(product,normalized):exactBarcodeUnit(product,normalized,units);
      const entry=byUnit.get(name);
      if(!entry)continue;
      entry.codes.push(code);
      if(!unitBarcodes.has(code)||systemLabelCode(normalized))continue;
      if(!byBarcode.has(code))byBarcode.set(code,[]);
      byBarcode.get(code).push({record,entry});
    }
    return record;
  });
  const pairs=[];
  for(const [code,hits] of byBarcode){
    if(hits.length!==2||hits[0].record.warehouse===hits[1].record.warehouse)continue;
    const [left,right]=hits.sort((a,b)=>a.record.warehouse-b.record.warehouse);
    let pair=left.record.partners.get(right.record);
    if(!pair){
      pair={members:[left.record,right.record],links:[]};
      left.record.partners.set(right.record,pair);
      right.record.partners.set(left.record,pair);
      pairs.push(pair);
    }
    let link=pair.links.find(link=>link.left===left.entry&&link.right===right.entry);
    if(!link){link={left:left.entry,right:right.entry,codes:[]};pair.links.push(link);}
    link.codes.push(code);
  }
  const rows=[],used=new Set();
  function addRow(members,groups,partial=false){
    const usedNames=new Set();
    const options=groups.map(entries=>{
      let name=entries[0].unit.name;
      // The other shop can reuse this name for a different barcode pairing.
      while(usedNames.has(name))name=entries[0].warehouse+':'+name;
      usedNames.add(name);
      const shared=entries.length>1?entries[0].codes.filter(code=>{
        const hits=byBarcode.get(code);
        return hits?.length===2&&hits.every(hit=>entries.includes(hit.entry));
      }):[];
      return {name,shared,shops:new Map(entries.map(entry=>[entry.warehouse,entry]))};
    });
    rows.push({name:members[0].product.name,members,options,partial});
  }
  for(const {members,links} of pairs){
    const [left,right]=members;
    const simple=left.partners.size===1&&right.partners.size===1&&
      new Set(links.map(l=>l.left)).size===links.length&&new Set(links.map(l=>l.right)).size===links.length;
    const groups=links.map(link=>[link.left,link.right]);
    for(const group of groups)for(const entry of group)used.add(entry);
    if(simple){
      // Keep the previous same-name unit comparison for the remaining units.
      for(const entry of left.entries){
        if(used.has(entry))continue;
        const match=right.entries.find(other=>!used.has(other)&&other.unit.name===entry.unit.name);
        groups.push(match?[entry,match]:[entry]);
        used.add(entry);if(match)used.add(match);
      }
      for(const entry of right.entries)if(!used.has(entry)){groups.push([entry]);used.add(entry);}
      const order=new Map([...left.entries,...right.entries].map((entry,i)=>[entry,i]));
      const matched=new Set(links.map(link=>link.left));
      groups.sort((a,b)=>Number(matched.has(b[0]))-Number(matched.has(a[0]))||order.get(a[0])-order.get(b[0]));
      addRow(members,groups);
    }else{
      // A product may match multiple records or units in the other shop. Show each
      // proven pairing separately, without attaching unrelated units to that row.
      for(const link of links){
        const membersForCode=members.map((member,i)=>{
          const entry=i?link.right:link.left;
          const barcodes=entry.codes.filter(code=>link.codes.includes(code)||byBarcode.get(code)?.length!==2);
          return {...member,barcodes};
        });
        addRow(membersForCode,[[link.left,link.right]],true);
      }
    }
  }
  for(const record of records){
    const remaining=record.entries.filter(entry=>!used.has(entry));
    if(!remaining.length)continue;
    const partial=record.partners.size>0;
    const member=partial?{...record,barcodes:remaining.flatMap(entry=>entry.codes)}:record;
    addRow([member],remaining.map(entry=>[entry]),partial);
  }
  for(const record of records)record.partners.clear();
  return rows.sort((a,b)=>a.name.localeCompare(b.name,'th')||a.members[0].product.id-b.members[0].product.id);
}
function renderCombinedCatalog(stockOnly){
  if(stockOnly&&reportWarehouseIds().some(id=>!loadedInventoryBalanceWarehouseIds.has(id))){
    return '<section class="rpt"><p role="status">กำลังตรวจยอดคงเหลือของแต่ละคลัง</p><button type="button" class="btn ghost" id="combinedReloadBalances">โหลดสินค้าคงเหลือ</button></section>';
  }
  return `<section class="rpt combined-catalog" aria-label="${stockOnly?'สินค้าคงเหลือ':'ราคาสินค้า'}" data-combined-stock="${stockOnly}">
    <div class="tree-pane"><div class="product-group-header"><span class="product-group-title">กลุ่มสินค้า</span><span class="product-group-separator">:</span><div class="product-group-categories" data-combined-categories role="group" aria-label="หมวดหลัก"></div></div>
    <div class="product-group-brands" data-combined-brands role="group" aria-label="หมวดย่อย"></div></div>
    <div class="product-list-search combined-search-group"><input data-combined-search placeholder="ค้นหาจาก ชื่อ / รหัส / บาร์โค้ด" aria-label="ค้นหาสินค้า">
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
      if(row.options.length<2)continue;
      for(const [index,member] of row.members.entries()){
        const id=Number(member.product.id);
        if(!localIds.has(id))continue;
        const key=prefix+id;
        if(readCombinedValue(key+':pending')){pendingAtRead.add(key);void flushCombinedUnit(actor,id);continue;}
        if(remoteIds.has(id))continue;
        const name=readCombinedValue(key);
        if(name&&row.options.some(option=>(index===0?option.name:option.shops.get(member.warehouse)?.unit.name)===name)){
          legacy.push({user_id:actor,product_id:id,unit_name:name});
          remoteIds.add(id);
        }
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
const combinedSortPreferences=new Map();
function attachCombinedCatalog(page){
  const shops=accessibleWarehouses().slice().sort((a,b)=>a.id-b.id);
  const rows=combinedCatalogRows(products);
  const categories=page.querySelector('[data-combined-categories]'),brands=page.querySelector('[data-combined-brands]');
  const search=page.querySelector('[data-combined-search]');
  const stockOnly=page.dataset.combinedStock==='true';
  const metrics=stockOnly?[['stock','คงเหลือ']]:[['price','ราคาขาย'],['cost','ทุน']];
  const amountColumns=metrics.flatMap(([field])=>shops.map(shop=>({field,shop})));
  const shopHeaders=shops.map(shop=>`<th scope="col">${escapeHtml(shop.name)}</th>`).join('');
  const headers=metrics.map(([,label])=>`<th scope="colgroup" colspan="${shops.length}">${label}</th>`).join('');
  const secondHeaderRow=shopHeaders.repeat(1+metrics.length);
  const storeButtons=page.querySelectorAll('[data-exclusive-shop]');
  const shopNames=new Map(shops.map(shop=>[Number(shop.id),shop.name]));
  const exclusiveShop=row=>!row.partial&&row.members.length===1?shopNames.get(row.members[0].warehouse):'';
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
  const sort=combinedSortPreferences.get(actor)||{field:'',direction:1};
  const compare=new Intl.Collator('th',{numeric:true}).compare;
  const pager=page.querySelector('[data-combined-pager]');
  const results=page.querySelector('[data-combined-results]');
  const manualSearchUnits=new Map();
  const barcodeMatches=(option,term)=>[...option.shops.values()].some(({unit})=>String(unit.barcode||'').toLowerCase().includes(term));
  const knownBarcodes=new Set(rows.flatMap(row=>row.members.flatMap(member=>member.barcodes)));
  function scannedOption(row,member,term){
    const normalized=term.toUpperCase();
    const unit=systemLabelCode(normalized)?shopLabelUnit(member.product,normalized):exactBarcodeUnit(member.product,normalized,member.units);
    return row.options.find(option=>option.shops.get(member.warehouse)?.unit.name===unit);
  }
  function matchesSearch(row,term){
    if(!term)return true;
    if(systemLabelCode(term.toUpperCase()))return row.members.some(member=>member.barcodes.includes(term)&&scannedOption(row,member,term));
    if(knownBarcodes.has(term))return row.members.some(member=>member.barcodes.includes(term));
    return row.members.some(({product,barcodes})=>
      String(product.name||'').toLowerCase().includes(term)||barcodes.some(code=>code.includes(term))||
      String(product.sku||'').toLowerCase().includes(term));
  }
  function displayedUnit(row,term){
    const manual=manualSearchUnits.get(row);
    if(manual)return manual;
    if(knownBarcodes.has(term)){
      const exact=new Set();
      for(const member of row.members){
        if(!member.barcodes.includes(term))continue;
        const option=scannedOption(row,member,term);
        if(!option)return null;
        exact.add(option);
      }
      if(exact.size>1)return null;
      if(exact.size)return [...exact][0];
    }
    for(const [index,member] of row.members.entries()){
      const preferred=readCombinedValue(combinedUnitPreferenceKey(member.product.id));
      if(!preferred)continue;
      const option=row.options.find(item=>index===0?item.name===preferred:item.shops.get(member.warehouse)?.unit.name===preferred);
      if(option)return option;
    }
    return (term&&row.options.find(item=>barcodeMatches(item,term)))||row.options[0];
  }
  function barcodeValues(option,term){
    if(!option)return [term];
    const entries=[...option.shops.values()];
    if(term&&entries.every(entry=>entry.codes.includes(term)))return [search.value.trim()];
    if(option.shared.length){
      const primary=String(entries[0].unit.barcode||'').trim();
      return [option.shared.includes(primary.toLowerCase())?primary:option.shared[0]];
    }
    return entries.map(entry=>String(entry.unit.barcode||'').trim());
  }
  function sortHeader(field,label,span){
    const order=sort.direction===1?'ascending':'descending';
    return `<th ${span} class="${field==='barcode'?'combined-barcode':''}"${field===sort.field?` aria-sort="${order}"`:''}><button type="button" class="doc-sort-btn" data-combined-sort="${field}">${label}</button></th>`;
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
    const unitByRow=new Map();
    if(sort.field==='name')matches.sort((a,b)=>sort.direction*compare(a.name,b.name));
    if(sort.field==='barcode'){
      const codes=new Map();
      for(const row of matches){
        const option=displayedUnit(row,term);
        unitByRow.set(row,option);
        codes.set(row,barcodeValues(option,term).filter(Boolean));
      }
      matches.sort((a,b)=>{
        const left=codes.get(a),right=codes.get(b);
        if(!left.length||!right.length)return Number(!left.length)-Number(!right.length);
        for(let i=0;i<Math.min(left.length,right.length);i++){
          const difference=compare(left[i],right[i]);
          if(difference)return sort.direction*difference;
        }
        return sort.direction*(left.length-right.length);
      });
    }
    const pages=Math.max(1,Math.ceil(matches.length/pageSize));
    pageNo=Math.min(pageNo,pages);
    const body=matches.slice((pageNo-1)*pageSize,pageNo*pageSize).map(row=>{
      const id=row.members[0].product.id;
      const option=unitByRow.get(row)||displayedUnit(row,term);
      const codes=barcodeValues(option,term);
      const barcode=codes.length===1?codes[0]:describeValues(option,entry=>String(entry.unit.barcode||'—'));
      const unitNames=item=>[...new Set([...item.shops.values()].map(entry=>entry.unit.name))].join(' / ');
      const control=row.options.length===1&&option?`<span class="prod-unit-fixed">${escapeHtml(unitNames(option))}</span>`:
        `<select class="prod-unit-select" data-combined-unit="${id}" aria-label="หน่วยของ ${escapeHtml(row.name)}">${option?'':'<option value="" selected disabled>กรุณาเลือกหน่วยสำหรับบาร์โค้ดนี้</option>'}${row.options.map(item=>`<option value="${escapeHtml(item.name)}" ${item===option?'selected':''}>${escapeHtml(unitNames(item))}</option>`).join('')}</select>`;
      const descriptions=shops.map(shop=>{
        const member=row.members.find(member=>member.warehouse===Number(shop.id));
        if(!member)return '<td>—</td>';
        const entry=option?.shops.get(member.warehouse);
        return `<td><span data-combined-product-name>${escapeHtml(member.product.name)}</span> <span class="combined-pack">${escapeHtml(entry?.label||'—')}</span></td>`;
      }).join('');
      const cells=amountColumns.map(({field,shop})=>{
        const entry=option?.shops.get(Number(shop.id));
        let value='—';
        if(entry)value=field==='stock'?inspectionListAmount(warehouseStock(entry.product.id,shop.id)/entry.unit.factor):fmtMoney(entry.unit[field]);
        return `<td class="combined-amount">${value}</td>`;
      }).join('');
      const only=exclusiveShop(row);
      const color=only==='พรชัย'?'only-phonchai':only==='พระยาสุเรนทร์'?'only-phraya':'';
      return `<tr class="${color}"><td class="combined-barcode">${escapeHtml(barcode||'—')}</td>${descriptions}<td><div class="combined-unit-cell">${control}</div></td>${cells}</tr>`;
    }).join('');
    const columns=2+shops.length+amountColumns.length;
    results.innerHTML=`<table class="grid-table doc-head-blue"><thead><tr>${sortHeader('barcode','บาร์โค้ด','rowspan="2"')}${sortHeader('name','สินค้า',`colspan="${shops.length}"`)}<th rowspan="2">หน่วย</th>${headers}</tr><tr>${secondHeaderRow}</tr></thead><tbody>${body||`<tr><td colspan="${columns}">ไม่พบสินค้า</td></tr>`}</tbody></table>`;
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
  search.oninput=()=>{manualSearchUnits.clear();pageNo=1;draw();};
  results.onclick=event=>{
    const button=event.target.closest('[data-combined-sort]');
    if(!button)return;
    const field=button.dataset.combinedSort;
    sort.direction=sort.field===field?-sort.direction:1;
    sort.field=field;combinedSortPreferences.set(actor,sort);pageNo=1;draw();
    results.querySelector(`[data-combined-sort="${field}"]`).focus({preventScroll:true});
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
    if(search.value.trim()){
      const row=rows.find(row=>row.options.length>1&&Number(row.members[0].product.id)===id);
      if(row)manualSearchUnits.set(row,row.options.find(option=>option.name===select.value));
    }
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
