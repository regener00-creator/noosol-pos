const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'public');
const server=http.createServer((req,res)=>{
  const file=path.join(publicRoot,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');
  if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream'));fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  execFileSync(process.execPath,[path.join(root,'scripts/build-static.mjs')],{cwd:root,stdio:'pipe'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&fs.existsSync(file))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const sharedPreferences=new Map();
  async function setupDevice(page){
    await installIsolatedBrowser(page);await page.goto(`http://127.0.0.1:${server.address().port}/`);await waitForIsolatedBootstrap(page);
    await page.exposeFunction('requestUnits',({rows,ignore,actor})=>{
      if(rows){
        for(const row of [].concat(rows)){
          const key=row.user_id+':'+row.product_id;
          if(!ignore||!sharedPreferences.has(key))sharedPreferences.set(key,row);
        }
        return {error:null};
      }
      return {data:[...sharedPreferences.values()].filter(row=>row.user_id===actor),error:null};
    });
    await page.evaluate(async()=>{
    await ensurePageCodeLoaded('barcodeprint');await ensurePageCodeLoaded('products');await ensurePageCodeLoaded('rinventory');
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());document.getElementById('appRoot').hidden=false;
    currentProfile={id:'test-owner',owner:true,level:1};renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});
    const originalFrom=sb.from.bind(sb);
    sb.from=table=>{
      if(table!=='combined_catalog_unit_preferences')return originalFrom(table);
      const query={select(){return this;},eq(_field,actor){this.actor=actor;return this;},order(){return this;},range(){return window.requestUnits({actor:this.actor});},
        upsert(rows,options){return window.requestUnits({rows,ignore:options.ignoreDuplicates});}};
      return query;
    };
    loadWarehouseInventoryFromSupabase=async()=>true;loadCashShiftsFromSupabase=async()=>{};saveOfflinePosSnapshot=async()=>{};
    warehouses=[{id:1,name:'พระยาสุเรนทร์'},{id:2,name:'พรชัย'}];
    const item=(id,wh,name,barcode,price,cost)=>({id,wh,name,barcode,sku:'SKU'+id,price,cost,category:'ยา',brand:'ทั่วไป',unit:'ซอง',units:[],active:true});
    const rows=[item(11,1,'Decolgen','0001',40,22),item(12,2,'Decolgen','0001',45,28),item(13,2,'พรชัยเท่านั้น','0022',33,11),item(14,1,'พระยาสุเรนทร์เท่านั้น','0033',17,9)];
    rows[0].units=[{sub:'กล่อง',factor:5,price:180,cost:110,barcode:'0055'}];
    rows[0].extraBarcodes=['ALT-019'];
    rows[1].vendorBarcodes=[{code:'VENDOR-007'}];
    rows[1].units=[{sub:'กล่อง',factor:10,price:399,cost:270,barcode:'0044'},{sub:'ลัง',factor:20,price:700,cost:540,barcode:'0066'}];
    currentTab='products';activeWarehouseId=1;allWarehousesMode=false;setWarehouseProductCatalog(rows);
    contacts=[{id:901,name:'ชื่อเหมือนกัน',phone:'0801111111',types:['customer','supplier']},
      {id:902,warehouseId:2,name:'ชื่อเหมือนกัน',phone:'0801111111',types:['customer','supplier']}];
    salesRepresentatives=[{id:21,name:'ผู้แทนเดิม'},{id:22,name:'ผู้แทนพรชัย',warehouseId:2}];
    loadedInventoryBalanceWarehouseIds=new Set([1,2]);inventoryBalanceRows=[{product_id:11,warehouse_id:1,stock:0},{product_id:12,warehouse_id:2,stock:17}];rebuildInventoryBalanceMap();
    selectActiveWarehouse(1);render();
    });
  }
  await setupDevice(page);
  await page.evaluate(()=>{searchQuery='Decolgen';render();});
  const regularRowHeight=await page.locator('.prodtable tbody tr').first().evaluate(el=>el.getBoundingClientRect().height);
  for(const [wh,id,price,cost] of [[1,11,40,22],[2,12,45,28]]){
    const result=await page.evaluate(({wh})=>{
      selectActiveWarehouse(wh);const found=findProductByExactCode('0001');addToCart(found.product.id,found.unitName,1);
      return {id:found.product.id,price:cart[0].price,cost:cart[0].cost,wrong:products.some(product=>product.wh!==wh),all:completeProductCatalog().length};
    },{wh});assert.deepEqual(result,{id,price,cost,wrong:false,all:4});
    assert.deepEqual(await page.evaluate(()=>[customersList().map(c=>c.id),suppliersList().map(c=>c.id),duplicateCustomerPhone('080-111-1111')?.id]),[[900+wh],[900+wh],900+wh]);
    assert.deepEqual(await page.evaluate(()=>storeRepresentatives().map(r=>r.id)),[20+wh]);
    assert.equal(await page.locator('.navbtn[data-tab="warehouse"]').count(),0);
    await page.locator('.navbtn[data-tab="settingssystem"]').click();
    await page.locator('#openDocumentResetBtn').waitFor();assert.equal(await page.locator('#openFactoryResetBtn').count(),0);
    await page.locator('#openDocumentResetBtn').click();
    assert.match(await page.locator('#storeResetTitle').innerText(),new RegExp(wh===1?'พระยาสุเรนทร์':'พรชัย'));
    await page.locator('#cancelStoreResetBtn').click();
    await page.locator('.navbtn[data-tab="products"]').click();
  }
  await page.evaluate(()=>{localStorage.setItem(combinedUnitPreferenceKey(11),'ซอง');selectActiveWarehouse('all');render();});
  await page.waitForFunction(async()=>(await window.requestUnits({actor:currentProfile.id})).data.some(row=>row.product_id===11&&row.unit_name==='ซอง'));
  const nav=await page.locator('.navbtn').evaluateAll(buttons=>buttons.map(b=>b.dataset.tab).sort());
  assert.deepEqual(nav,['products','rinventory','warehouse']);
  await page.locator('.navbtn[data-tab="warehouse"]').click();
  await page.locator('#openFactoryResetBtn').waitFor();assert.equal(await page.locator('#openDocumentResetBtn').count(),0);
  await page.locator('#openFactoryResetBtn').click();await page.locator('#cancelStoreResetBtn').click();
  await page.locator('.navbtn[data-tab="products"]').click();
  assert.equal(await page.locator('#sidebar .navsection').count(),0);
  const navColor=tab=>page.locator(`.navbtn[data-tab="${tab}"]`).evaluate(el=>getComputedStyle(el).backgroundColor);
  const activeColor=await navColor('products'),idleColor=await navColor('rinventory');
  assert.equal((await page.locator('.navbtn[data-tab="products"]').innerText()).trim(),'ราคาสินค้า');
  async function checkStoreFilter(){
    assert.equal(await page.locator('.combined-catalog > :first-child').getAttribute('class'),'tree-pane');
    const all=page.getByRole('button',{name:'ทั้งหมด',exact:true});
    assert.equal(await all.getAttribute('aria-pressed'),'true');
    const orange=page.getByRole('button',{name:'พรชัย',exact:true});
    const purple=page.getByRole('button',{name:'พระยาสุเรนทร์',exact:true});
    const search=page.locator('[data-combined-search]'),rows=page.locator('[data-combined-results] tbody tr');
    const medicine=page.locator('[data-combined-category="ยา"]');
    await medicine.click();
    const general=page.locator('[data-combined-brand="ทั่วไป"]');
    await general.click();
    assert.equal(await page.getByRole('combobox',{name:'ค้นหาตาม'}).count(),0);
    await search.fill('decol');
    assert.match(await rows.innerText(),/Decolgen/);
    for(const code of ['0044','alt-019','vendor-007']){
      await search.fill(code);
      assert.equal(await rows.count(),1);
      assert.match(await rows.innerText(),/Decolgen/);
    }
    await search.fill('SKU12');
    assert.match(await rows.innerText(),/Decolgen/);
    await search.fill('');
    await orange.click();
    assert.equal(await orange.getAttribute('aria-pressed'),'true');
    assert.equal(await rows.count(),1);
    assert.match(await rows.innerText(),/พรชัยเท่านั้น/);
    assert.equal(await general.locator('.product-group-brand-count').innerText(),'1');
    await all.click();
    assert.equal(await all.getAttribute('aria-pressed'),'true');
    await medicine.click();
    await orange.click();
    await search.fill('เท่านั้น');
    await purple.click();
    assert.equal(await orange.getAttribute('aria-pressed'),'false');
    assert.equal(await rows.count(),1);
    assert.match(await rows.innerText(),/พระยาสุเรนทร์เท่านั้น/);
    await search.fill('0001');
    assert.match(await rows.innerText(),/ไม่พบสินค้า/);
    await purple.click();
    assert.match(await rows.innerText(),/Decolgen/);
    const barcode=page.locator('table .combined-barcode');
    assert.deepEqual(await barcode.evaluateAll(cells=>cells.map(cell=>getComputedStyle(cell).textAlign)),['center','center']);
    await search.fill('');
  }
  await checkStoreFilter();
  const orangeFilter=page.getByRole('button',{name:'พรชัย',exact:true});
  const purpleFilter=page.getByRole('button',{name:'พระยาสุเรนทร์',exact:true});
  const matchingRows=page.locator('[data-combined-results] tbody tr');
  await orangeFilter.click();
  await page.locator('.navbtn[data-tab="rinventory"]').click();
  assert.equal(await navColor('products'),idleColor);
  assert.equal(await navColor('rinventory'),activeColor);
  assert.equal(await orangeFilter.getAttribute('aria-pressed'),'true');
  assert.equal(await matchingRows.count(),1);
  assert.match(await matchingRows.innerText(),/พรชัยเท่านั้น/);
  await purpleFilter.click();
  await page.locator('.navbtn[data-tab="products"]').click();
  assert.equal(await purpleFilter.getAttribute('aria-pressed'),'true');
  assert.equal(await matchingRows.count(),1);
  assert.match(await matchingRows.innerText(),/พระยาสุเรนทร์เท่านั้น/);
  await purpleFilter.click();
  await page.locator('.navbtn[data-tab="rinventory"]').click();
  assert.equal(await purpleFilter.getAttribute('aria-pressed'),'false');
  assert.equal(await matchingRows.count(),3);
  await page.locator('.navbtn[data-tab="products"]').click();
  await page.evaluate(()=>ensurePageCodeLoaded('representativehistory'));
  assert.deepEqual(await page.evaluate(()=>[canEditNote({createdBy:currentProfile.id}),canDeleteNote({createdBy:currentProfile.id})]),[false,false]);
  const dec=page.locator('[data-combined-results] tr').filter({hasText:'Decolgen'}).filter({hasText:'ซอง'});
  assert.equal(await dec.count(),1);
  assert.equal(await dec.locator('select option:checked').innerText(),'ซอง');
  assert.deepEqual(await dec.locator('.combined-amount').allTextContents(),['40.00','22.00','45.00','28.00']);
  assert.deepEqual(await dec.locator('.combined-amount').evaluateAll(cells=>cells.map(cell=>getComputedStyle(cell).textAlign)),Array(4).fill('center'));
  await dec.locator('select').selectOption('กล่อง');
  assert.match(await dec.locator('td.combined-barcode').innerText(),/พระยาสุเรนทร์: 0055.*พรชัย: 0044/);
  assert.deepEqual(await dec.locator('.combined-amount').allTextContents(),['180.00','110.00','399.00','270.00']);
  await dec.locator('select').selectOption('ลัง');
  assert.deepEqual(await dec.locator('.combined-amount').allTextContents(),['—','—','700.00','540.00']);
  await dec.locator('select').selectOption('กล่อง');
  assert.ok(Math.abs((await dec.boundingBox()).height-regularRowHeight)<=1,`Single-store row ${regularRowHeight}, combined ${(await dec.boundingBox()).height}`);
  assert.equal(await page.locator('.only-phonchai').count(),1);assert.equal(await page.locator('.only-phraya').count(),1);
  const collision=await page.evaluate(()=>combinedCatalogRows([{...products.find(p=>p.id===11),name:'Drug one'},{...products.find(p=>p.id===12),name:'Drug two',units:[]}]).length);
  assert.equal(collision,2,'Unrelated products that reuse a barcode do not merge');
  await page.locator('[data-combined-search]').fill('0022');assert.equal(await page.locator('[data-combined-results] tbody tr').count(),1);
  await page.setViewportSize({width:2300,height:1100});
  const searchBounds=await page.locator('[data-combined-search]').boundingBox(),legend=await page.locator('.combined-legend').boundingBox();
  assert.ok(legend.x>=searchBounds.x+searchBounds.width&&Math.abs(legend.y+legend.height/2-searchBounds.y-searchBounds.height/2)<2);
  async function assertUsesPageWidth(){
    const width=await page.locator('.combined-catalog').evaluate(el=>({width:el.clientWidth,available:el.parentElement.clientWidth-parseFloat(getComputedStyle(el.parentElement).paddingLeft)-parseFloat(getComputedStyle(el.parentElement).paddingRight)}));
    assert.ok(width.available>1400&&Math.abs(width.available-width.width)<=2,JSON.stringify(width));
  }
  await assertUsesPageWidth();
  await page.evaluate(()=>{
    const more=Array.from({length:51},(_,i)=>({...products.find(p=>p.id===11),id:301+i,name:'Pagination '+String(i).padStart(2,'0'),barcode:String(51-i),extraBarcodes:[],units:[]}));
    setWarehouseProductCatalog([...completeProductCatalog(),...more]);render();
  });
  async function checkPagination(){
    await page.locator('[data-combined-search]').fill('Pagination');
    const pager=page.locator('[data-combined-pager]'),rows=page.locator('[data-combined-results] tbody tr');
    const currentTab=await page.locator('.navbtn.active').getAttribute('data-tab');
    async function checkSharedSort(field,direction,value){
      const otherTab=currentTab==='products'?'rinventory':'products';
      for(const tab of [otherTab,currentTab]){
        await page.locator(`.navbtn[data-tab="${tab}"]`).click();
        await page.locator('[data-combined-search]').fill('Pagination');
        const header=page.locator(`th[aria-sort="${direction}"] [data-combined-sort="${field}"]`);
        assert.equal(await header.innerText(),field==='barcode'?'บาร์โค้ด':'สินค้า');
        assert.equal(await rows.first().locator('td').nth(field==='barcode'?0:1).innerText(),value);
      }
    }
    if(await page.locator('th[aria-sort="descending"] [data-combined-sort="name"]').count())await page.locator('[data-combined-sort="name"]').click();
    assert.equal(await rows.count(),10);
    assert.deepEqual(await pager.locator('button').allTextContents(),['«','‹','1','2','3','4','5','›','»']);
    assert.ok(await pager.getByTitle('ก่อนหน้า').isDisabled());
    const firstPosition=await pager.boundingBox();
    await pager.getByTitle('ถัดไป').click();
    assert.match(await rows.first().innerText(),/Pagination 10/);
    await pager.getByRole('button',{name:'4',exact:true}).click();
    assert.match(await rows.first().innerText(),/Pagination 30/);
    await pager.getByTitle('หน้าสุดท้าย').click();
    assert.ok(await pager.getByTitle('ถัดไป').isDisabled());
    assert.equal(await rows.count(),1);
    assert.match(await rows.first().innerText(),/Pagination 50/);
    const lastPosition=await pager.boundingBox(), mainBounds=await page.locator('#main').boundingBox();
    assert.ok(Math.abs(firstPosition.y-lastPosition.y)<=1);
    assert.ok(Math.abs(mainBounds.y+mainBounds.height-lastPosition.y-lastPosition.height)<40,'pager stays at the bottom of the page');
    await pager.getByTitle('ก่อนหน้า').click();
    assert.match(await rows.first().innerText(),/Pagination 40/);
    await pager.getByTitle('หน้าแรก').click();
    assert.ok(await pager.getByTitle('หน้าแรก').isDisabled());
    await pager.getByTitle('หน้าสุดท้าย').click();
    const barcode=page.getByRole('button',{name:'บาร์โค้ด',exact:true});
    const name=page.getByRole('button',{name:'สินค้า',exact:true});
    await barcode.click();
    assert.ok(await pager.getByTitle('หน้าแรก').isDisabled());
    assert.deepEqual(await rows.locator('td:first-child').allTextContents(),Array.from({length:10},(_,i)=>String(i+1)));
    await checkSharedSort('barcode','ascending','1');
    await barcode.click();
    assert.equal(await rows.first().locator('td:first-child').innerText(),'51');
    await checkSharedSort('barcode','descending','51');
    await name.click();
    assert.equal(await rows.first().locator('td:nth-child(2)').innerText(),'Pagination 00');
    await checkSharedSort('name','ascending','Pagination 00');
    await name.click();
    assert.equal(await rows.first().locator('td:nth-child(2)').innerText(),'Pagination 50');
    await checkSharedSort('name','descending','Pagination 50');
    await page.locator('[data-combined-search]').fill('Pagination 50');
    assert.equal(await pager.locator('button').count(),0);
    assert.equal(await rows.count(),1);
  }
  await checkPagination();
  await page.locator('.navbtn[data-tab="rinventory"]').click();
  await checkStoreFilter();
  assert.deepEqual(await page.locator('[data-combined-search] + .combined-legend button').allTextContents(),['ทั้งหมด','พระยาสุเรนทร์','พรชัย']);
  await checkPagination();
  await page.locator('[data-combined-search]').fill('0001');
  const stock=page.locator('[data-combined-results] tbody tr').filter({hasText:'Decolgen'});
  assert.equal(await stock.getAttribute('class'),'');
  assert.equal(await stock.locator('select').inputValue(),'กล่อง','Stock uses the unit chosen in PRODUCT even when searching the base barcode');
  assert.deepEqual((await stock.locator('td').allTextContents()).slice(3),['0','1.7']);
  assert.deepEqual(await stock.locator('td').evaluateAll(cells=>cells.slice(3).map(cell=>getComputedStyle(cell).textAlign)),['center','center']);
  assert.ok(Math.abs((await stock.boundingBox()).height-regularRowHeight)<=1);
  await page.locator('[data-combined-search]').fill('0044');
  const boxes=page.locator('[data-combined-results] tbody tr');
  assert.match(await boxes.locator('td').first().innerText(),/0055.*0044/);
  assert.deepEqual((await boxes.locator('td').allTextContents()).slice(3),['0','1.7']);
  await boxes.locator('select').selectOption('ซอง');
  assert.deepEqual((await boxes.locator('td').allTextContents()).slice(3),['0','17']);
  await boxes.locator('select').selectOption('ลัง');
  await assertUsesPageWidth();
  await page.locator('[data-combined-search]').fill('0022');
  assert.deepEqual(await page.locator('[data-combined-results] tr').filter({hasText:'0022'}).locator('td').allTextContents(),['0022','พรชัยเท่านั้น','ซอง','—','0']);
  const storeColors=cell=>[getComputedStyle(cell).color,getComputedStyle(cell).backgroundColor];
  assert.deepEqual(await page.locator('.only-phonchai td').first().evaluate(storeColors),['rgb(173, 81, 11)','rgba(0, 0, 0, 0)']);
  await page.locator('[data-combined-search]').fill('0033');
  assert.deepEqual(await page.locator('.only-phraya td').first().evaluate(storeColors),['rgb(121, 70, 164)','rgba(0, 0, 0, 0)']);
  await page.locator('.navbtn[data-tab="products"]').click();
  await page.locator('[data-combined-search]').fill('Decolgen');
  assert.equal(await dec.locator('select').inputValue(),'ลัง','PRODUCT uses the last unit chosen in stock');
  assert.deepEqual(await dec.locator('.combined-amount').allTextContents(),['—','—','700.00','540.00']);
  await page.evaluate(()=>{selectActiveWarehouse(2);currentTab='transfer';render();});
  await page.waitForFunction(()=>combinedUnitWrites.size===0);
  const second=await browser.newPage();
  await setupDevice(second);
  await second.evaluate(()=>{selectActiveWarehouse('all');currentTab='rinventory';render();});
  await second.waitForFunction(()=>document.querySelector('[data-combined-unit="11"]')?.value==='ลัง');
  await second.context().setOffline(true);
  await second.locator('[data-combined-unit="11"]').selectOption('กล่อง');
  assert.equal(sharedPreferences.get('test-owner:11').unit_name,'ลัง');
  await second.context().setOffline(false);
  await second.waitForFunction(async()=>(await window.requestUnits({actor:currentProfile.id})).data.some(row=>row.product_id===11&&row.unit_name==='กล่อง'));
  await second.waitForFunction(()=>combinedUnitWrites.size===0);
  await page.evaluate(()=>{selectActiveWarehouse('all');currentTab='products';render();});
  await page.locator('[data-combined-search]').fill('Decolgen');
  await page.waitForFunction(()=>document.querySelector('[data-combined-unit="11"]')?.value==='กล่อง');
  await second.close();
  await page.evaluate(()=>{selectActiveWarehouse(2);currentTab='transfer';render();});
  assert.equal(await page.locator('.navbtn[data-tab="transfer"]').count(),0);assert.notEqual(await page.evaluate(()=>currentTab),'transfer');
  const switchResult=await page.evaluate(async()=>{
    await ensurePageCodeLoaded('notes');
    const original=sb.from.bind(sb);
    sb.from=table=>table==='settings'?{select:()=>({in:async(_key,keys)=>({data:keys.map(key=>({key,value:{categories:[key==='product_categories'?'หมวดเดิม':'หมวดพรชัย']}}))})})}:original(table);
    let delayed;
    sb.rpc=(name,args)=>({select:()=>args.p_warehouse_id===1?new Promise(done=>{delayed=done;}):Promise.resolve({data:[{id:'B',title:'NOTE พรชัย'}]})});
    selectActiveWarehouse(1);await loadProductCategorySettingsFromSupabase();
    const first=productCategorySettings.categories.slice();
    const pending=loadNotes();
    editingNoteId='new';noteDraft={title:'ร่างของพระยาสุเรนทร์'};noteDraftDirty=true;
    selectActiveWarehouse(2);
    await Promise.all([loadProductCategorySettingsFromSupabase(),loadNotes()]);
    delayed({data:[{id:'A',title:'NOTE พระยาสุเรนทร์'}]});
    await pending;
    return {first,second:productCategorySettings.categories,notes:notes.map(n=>n.title),draft:noteDraft};
  });
  assert.deepEqual(switchResult,{first:['หมวดเดิม'],second:['หมวดพรชัย'],notes:['NOTE พรชัย'],draft:null});
  assert.deepEqual(errors,[]);
  console.log('Store switching, POS scan/price/cost, combined menu, barcode/unit matching, exclusive colors and separate stock passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
