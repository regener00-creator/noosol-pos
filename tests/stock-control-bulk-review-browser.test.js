const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,process.env.PEPOS_TEST_BUILT?'../public':'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&fs.existsSync(file))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  await installIsolatedBrowser(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    currentProfile={id:'bulk-review-test',owner:true,level:1,firstName:'ทดสอบ'};
    warehouses=[{id:1,name:'คลังทดสอบ',active:true},{id:2,name:'คลังอื่น',active:true}];activeWarehouseId=1;
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});isMobileDeviceMode=()=>false;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    products=Array.from({length:12},(_,i)=>({id:i+1,sku:String(50000+i),name:`สินค้าผิดปกติ ${i+1}`,unit:'กล่อง',stock:-2,units:[],active:true}));
    products.push({id:99,sku:'EXISTING',name:'รายการที่กรอกไว้',unit:'กล่อง',stock:5,units:[],active:true});
    products[1].units=[{sub:'ลัง',factor:10}];
    for(const product of products.filter(p=>p.id===11||p.id===12)){
      product.unit='ซอง';product.units=[{sub:'กล่อง',factor:25},{sub:'ลัง',factor:500}];
      product.stock=product.id===11?1105:-1105;
    }
    warehouseStock=id=>products.find(product=>product.id===Number(id))?.stock||0;
    inventoryLotRows=[{id:101,product_id:1,warehouse_id:1,quantity_base:1,status:'active',expiry_date:'2020-01-01'},
      {id:111,product_id:12,warehouse_id:1,internal_code:'LOT-A',quantity_base:1000,status:'active'},
      {id:112,product_id:12,warehouse_id:1,internal_code:'LOT-B',quantity_base:105,status:'active'},
      {id:199,product_id:99,warehouse_id:1,quantity_base:5,status:'active',expiry_date:'2035-01-01'}];
    rebuildInventoryLotMap();
    stockEditItems=[99,1];stockEditDraftStocks={99:7,1:4,2:0};stockEditPage=3;
    window.bulkReviewRpcCalls=0;
    sb.rpc=()=>{window.bulkReviewRpcCalls++;throw new Error('Opening review must not change stock');};
    currentTab='stockcontrol';stockControlMode='anomalies';render();
  });
  const rows=page.locator('[data-stock-control-anomaly-select]');
  await rows.first().waitFor();
  await page.evaluate(()=>{
    inspectionLists=[
      {id:'pending-here',name:'ตรวจวันนี้',warehouseId:1,items:[]},
      {id:'saved-here',name:'ตรวจเมื่อวาน',warehouseId:1,items:[],stockAdjustedAt:'2026-11-12'},
      {id:'saved-elsewhere',name:'ตรวจคลังอื่น',warehouseId:2,items:[],stockAdjustedAt:'2026-11-12'}
    ];
  });
  await page.locator('[data-stock-control-mode="count"]').click();
  const statusFilter=page.locator('#inspectionListStatusFilter');
  const statusBox=await statusFilter.boundingBox();
  const countTabBox=await page.locator('[data-stock-control-mode="count"]').boundingBox();
  const tabBarBox=await page.locator('.stock-control-tabs').boundingBox();
  assert.ok(Math.abs((statusBox.y+statusBox.height/2)-(countTabBox.y+countTabBox.height/2))<2);
  assert.ok(Math.abs((tabBarBox.x+tabBarBox.width)-(statusBox.x+statusBox.width))<10);
  const visibleLists=()=>page.locator('[data-inspection-list-select]').evaluateAll(inputs=>inputs.map(input=>input.dataset.inspectionListSelect).sort());
  assert.equal(await statusFilter.inputValue(),'all');
  assert.deepEqual(await visibleLists(),['pending-here','saved-here']);
  await statusFilter.selectOption('pending');
  assert.deepEqual(await visibleLists(),['pending-here']);
  await page.locator('#inspectionListSelectAll').check();
  assert.deepEqual(await page.evaluate(()=>[...inspectionListOverviewSelectedIds]),['pending-here']);
  await statusFilter.selectOption('completed');
  assert.deepEqual(await visibleLists(),['saved-here']);
  assert.equal(await page.locator('#deleteSelectedInspectionListsBtn').count(),0);
  await page.locator('[data-inspection-overview-sort="status"]').click();
  assert.equal(await statusFilter.inputValue(),'completed');
  await page.evaluate(()=>{inspectionLists=inspectionLists.filter(list=>list.id!=='saved-here');render();});
  assert.deepEqual(await visibleLists(),[]);
  assert.match(await page.locator('.inspection-list-overview-table tbody').innerText(),/ไม่พบรายการตรวจสินค้าที่มีสถานะนี้/);
  await statusFilter.selectOption('all');
  assert.deepEqual(await visibleLists(),['pending-here']);
  await page.locator('[data-stock-control-mode="lots"]').click();
  const lotRow=page.locator('tr').filter({has:page.locator('[data-stock-lot-reallocation="12"]')});
  assert.equal(await lotRow.locator('td').nth(2).innerText(),'2 ลัง 4 กล่อง 5 ซอง');
  assert.equal(await lotRow.locator('td').nth(3).innerText(),'2 LOT');
  await page.locator('[data-stock-control-mode="anomalies"]').click();
  await page.setViewportSize({width:2100,height:960});
  const widths=await page.locator('.stock-control-page').evaluate(el=>[
    el.clientWidth,el.querySelector('.stock-control-tabs').getBoundingClientRect().width,
    el.querySelector('.stock-control-content > .rpt').getBoundingClientRect().width
  ]);
  assert.ok(widths[0]>1400 && widths.every(width=>Math.abs(width-widths[0])<2),'Count controls and report use the full branch workspace');
  await page.setViewportSize({width:1440,height:960});
  assert.equal(await rows.count(),13);
  for(const [id,expected] of [[11,'2 ลัง 4 กล่อง 5 ซอง'],[12,'-2 ลัง 4 กล่อง 5 ซอง']]){
    const row=page.locator('tr').filter({has:page.locator(`[data-stock-control-review="${id}"]`)});
    assert.equal(await row.locator('td').nth(5).innerText(),expected);
  }
  assert.equal(await page.locator('#stockControlReviewAll').innerText(),'เปิดตรวจนับทั้งหมด (12)');
  assert.equal(await page.locator('#stockControlReviewSelected').isDisabled(),true);
  const firstProduct=page.locator('[data-stock-control-anomaly-select="1"]');
  await firstProduct.first().check();
  assert.equal(await firstProduct.last().isChecked(),true,'duplicate anomaly rows select the same product');
  assert.equal(await page.locator('#stockControlReviewSelected').innerText(),'เปิดตรวจนับที่เลือก (1)');
  assert.equal(await page.locator('#stockControlAnomalySelectAll').evaluate(el=>el.indeterminate),true);
  await firstProduct.last().uncheck();
  assert.equal(await firstProduct.first().isChecked(),false);
  await page.locator('#stockControlAnomalySelectAll').check();
  assert.equal(await page.locator('#stockControlReviewSelected').innerText(),'เปิดตรวจนับที่เลือก (12)');
  await page.locator('#stockControlAnomalySelectAll').uncheck();
  await firstProduct.first().check();
  await page.locator('[data-stock-control-anomaly-select="2"]').check();
  const output=path.resolve(__dirname,'../outputs');fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,'stock-control-bulk-review.png'),fullPage:true});
  await page.locator('#stockControlReviewSelected').click();
  await page.locator('[data-stock-edit-row="2"]').waitFor();
  assert.deepEqual(await page.evaluate(()=>stockEditItems),[1,2,99]);
  assert.deepEqual(await page.evaluate(()=>stockEditDraftStocks),{1:4,2:0,99:7});
  assert.equal(await page.locator('[data-stock-edit-amount="1"]').inputValue(),'4');
  assert.equal(await page.locator('[data-count-part="2"][data-unit="กล่อง"]').inputValue(),'0');
  const focused=selector=>page.locator(selector).evaluate(el=>el===document.activeElement);
  await page.locator('[data-stock-edit-amount="1"]').fill('1');
  await page.keyboard.press('Tab');
  assert.ok(await focused('[data-count-part="2"][data-unit="ลัง"]'),'Balanced LOT skips to the next product');
  await page.keyboard.press('Tab');
  assert.ok(await focused('[data-count-part="2"][data-unit="กล่อง"]'));
  await page.locator('[data-count-part="2"][data-unit="กล่อง"]').fill('3');
  await page.keyboard.press('Tab');
  assert.ok(await focused('[data-stock-edit-lot="2"]'),'Edited count opens the newly required LOT control');
  await page.keyboard.press('Tab');
  assert.ok(await focused('[data-stock-edit-new-lot="2"]'));
  await page.keyboard.press('Tab');
  assert.ok(await focused('[data-stock-edit-new-expiry="2"]'));
  await page.keyboard.press('Tab');
  assert.ok(await focused('[data-stock-edit-amount="99"]'));
  await page.keyboard.press('Shift+Tab');
  assert.ok(await focused('[data-stock-edit-new-expiry="2"]'));
  assert.equal(await page.evaluate(()=>stockEditDraftStocks[2]),3);
  for(const key of ['Tab','Enter']){
    await page.locator('[data-stock-edit-lot="99"]').press(key);
    assert.ok(await focused('[data-stock-edit-amount="1"]'),key+' wraps to the first count');
    await page.keyboard.press('Shift+'+key);
    assert.ok(await focused('[data-stock-edit-lot="99"]'),'Reverse navigation wraps to the last LOT');
  }
  const lastCount=page.locator('[data-stock-edit-amount="99"]');
  await lastCount.fill('5');
  await lastCount.press('Enter');
  assert.ok(await focused('[data-stock-edit-amount="1"]'),'Enter wraps after editing away the last LOT');
  await lastCount.fill('7');
  await lastCount.press('Enter');
  assert.ok(await focused('[data-stock-edit-lot="99"]'),'Enter reaches the newly displayed LOT');
  await page.locator('[data-stock-control-mode="anomalies"]').click();
  await page.locator('[data-stock-control-review="3"]').click();
  assert.deepEqual(await page.evaluate(()=>stockEditItems),[3,1,2,99],'single review still works');
  const negativeCount=page.locator('[data-stock-edit-amount="3"]');
  assert.equal(await negativeCount.inputValue(),'-2');
  for(const key of ['ArrowUp','ArrowDown']){
    await negativeCount.press(key);
    assert.equal(await negativeCount.inputValue(),'-2','An arrow must not change a negative count to zero');
    assert.ok(await focused('[data-stock-edit-amount="3"]'));
  }
  await page.locator('[data-stock-control-mode="anomalies"]').click();
  await page.locator('#stockControlReviewAll').click();
  assert.deepEqual(await page.evaluate(()=>stockEditItems),[1,2,3,4,5,6,7,8,9,10,11,12,99]);
  assert.equal(await page.locator('[data-stock-edit-row]').count(),10);
  await page.locator('[data-stock-edit-page="next"]').click();
  assert.equal(await page.locator('[data-stock-edit-row]').count(),3);
  assert.equal(await page.evaluate(()=>stockEditDraftStocks[99]),7);
  assert.equal(await page.evaluate(()=>window.bulkReviewRpcCalls),0);
  await page.locator('[data-stock-control-mode="anomalies"]').click();
  await page.locator('#stockControlAnomalySelectAll').check();
  await page.evaluate(()=>{products=products.filter(product=>product.id!==1);render();});
  assert.equal(await page.locator('#stockControlReviewSelected').innerText(),'เปิดตรวจนับที่เลือก (11)','stale products are removed from the selection');
  await page.evaluate(()=>{resetWarehouseScopedUiState('2');activeWarehouseId=2;stockControlMode='anomalies';render();});
  assert.equal(await page.evaluate(()=>stockControlAnomalySelectedIds.size),0,'selection is cleared when changing warehouse');
  await page.evaluate(()=>{products=[];inventoryLotRows=[];render();});
  assert.equal(await page.locator('#stockControlReviewAll').count(),0);
  assert.equal(await page.locator('#stockControlAnomalySelectAll').isDisabled(),true);
  await page.evaluate(()=>{
    products=[{id:55,name:'Decolgen',unit:'ซอง',stock:204,units:[{sub:'กล่อง',factor:25},{sub:'ลัง',factor:500}]}];
    stockEditItems=[55];stockControlMode='adjust';render();
  });
  const box=page.locator('[data-count-part="55"][data-unit="กล่อง"]');
  const sachet=page.locator('[data-count-part="55"][data-unit="ซอง"]');
  const total=page.locator('.stock-count-parts output');
  const systemStock=page.locator('[data-stock-edit-row="55"] td').nth(2);
  const categoryBox=await page.locator('#stockEditCategorySelect').boundingBox();
  const searchBox=await page.locator('#stockEditInput').boundingBox();
  assert.ok(searchBox.x>categoryBox.x&&Math.abs(searchBox.y+searchBox.height/2-categoryBox.y-categoryBox.height/2)<1);
  assert.equal(await systemStock.innerText(),'8 กล่อง 4 ซอง');
  assert.equal(await box.inputValue(),'');
  await box.fill('8');
  assert.equal(await total.isVisible(),false);
  assert.equal(await page.evaluate(()=>stockEditDraftStocks[55]),200);
  await sachet.fill('4');
  assert.equal(await total.isVisible(),false);
  await sachet.fill('5');
  assert.equal(await systemStock.innerText(),'8 กล่อง 4 ซอง');
  assert.equal(await page.locator('[data-stock-count-difference]').innerText(),'+1 ซอง');
  const positiveColors=el=>[getComputedStyle(el).color,getComputedStyle(el).backgroundColor];
  const greenOnTransparent=['rgb(35, 131, 68)','rgba(0, 0, 0, 0)'];
  assert.deepEqual(await page.locator('[data-stock-count-difference] .in').evaluate(positiveColors),greenOnTransparent);
  await box.fill('10');await sachet.fill('7');
  assert.equal(await page.locator('[data-stock-count-difference]').innerText(),'+2 กล่อง 3 ซอง');
  const fitsOnOneLine=badge=>{
    const range=document.createRange();range.selectNodeContents(badge);
    return range.getClientRects().length===1&&badge.getBoundingClientRect().width<=badge.parentElement.clientWidth;
  };
  assert.ok(await page.locator('[data-stock-count-difference] span').evaluate(fitsOnOneLine));
  await box.fill('6');await sachet.fill('1');
  assert.equal(await page.locator('[data-stock-count-difference]').innerText(),'-2 กล่อง 3 ซอง');
  await box.fill('8');await sachet.fill('5');
  assert.deepEqual(await page.evaluate(()=>stockEditAdjustmentLines().map(({productId,expectedStock,targetStock})=>[productId,expectedStock,targetStock])),[[55,204,205]]);
  await page.evaluate(()=>{
    const extra=Array.from({length:10},(_,i)=>({id:60+i,name:'รายการ '+i,unit:'ชิ้น',stock:1,units:[]}));
    products.push(...extra);stockEditItems.push(...extra.map(product=>product.id));render();
  });
  const singleField=await page.locator('[data-stock-edit-amount="60"]').boundingBox();
  const multiField=await box.boundingBox();
  const gaps=await page.locator('#stockEditTbody label:has(input[data-count-part]),#stockEditTbody label.stock-count-single').evaluateAll(labels=>
    labels.map(label=>label.querySelector('input').getBoundingClientRect().left-label.querySelector('span').getBoundingClientRect().right));
  assert.ok(gaps.length>3&&gaps.every(gap=>gap>=4&&gap<=6),'each desktop unit sits next to its quantity input');
  assert.ok(Math.abs(singleField.x-multiField.x)<1&&Math.abs(singleField.width-multiField.width)<1,'single and multi-unit quantity fields line up');
  const lotField=await page.locator('[data-stock-edit-new-lot="55"]').boundingBox();
  const expiryField=await page.locator('[data-stock-edit-new-expiry="55"]').boundingBox();
  assert.ok(Math.abs(lotField.y-expiryField.y)<1&&lotField.x+lotField.width<=expiryField.x,'new LOT number and expiry share a row');
  await page.locator('[data-stock-edit-page="next"]').click();
  await page.locator('[data-stock-edit-page="prev"]').click();
  assert.equal(await box.inputValue(),'8');assert.equal(await sachet.inputValue(),'5');
  await sachet.fill('-1');assert.equal(await page.locator('#confirmStockEditBtn').isDisabled(),true);
  assert.equal(await total.innerText(),'กรุณากรอกจำนวนตั้งแต่ 0 ขึ้นไป');
  await sachet.fill('5');assert.equal(await page.locator('#confirmStockEditBtn').isEnabled(),true);
  await page.setViewportSize({width:390,height:844});
  const searchFits=await page.locator('#stockEditInput').evaluate(input=>{
    const field=input.getBoundingClientRect(),toolbar=input.closest('.rpt-filters').getBoundingClientRect();
    return field.width>0&&field.left>=toolbar.left-1&&field.right<=toolbar.right+1;
  });
  assert.ok(searchFits);
  await page.evaluate(()=>{isMobileDeviceMode=()=>true;currentTab='mobiletools';mobileToolMode='inventory';mobileInventoryStep='stock';render();});
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    const headers=page.locator('[data-mobile-stock-item="55"] .mobile-stock-info-row label');
    assert.deepEqual(await headers.allTextContents(),['สินค้า','ในระบบ','ต่าง']);
    const tops=await headers.evaluateAll(labels=>labels.map(label=>label.getBoundingClientRect().top));
    assert.ok(Math.max(...tops)-Math.min(...tops)<1);
    const single=await page.locator('[data-mobile-stock-amount="60"]').boundingBox();
    const [carton,multi,bag]=await Promise.all([
      page.locator('[data-count-part="55"][data-unit="ลัง"]').boundingBox(),box.boundingBox(),sachet.boundingBox()
    ]);
    assert.equal(await page.locator('[data-mobile-stock-item="60"] .stock-count-single span').innerText(),'ชิ้น');
    assert.ok(Math.abs(single.x-carton.x)<1&&Math.abs(single.width-carton.width)<1,'mobile single unit aligns with first unit at '+width+'px');
    assert.ok(carton.x+carton.width<=multi.x&&multi.x+multi.width<=bag.x);
    assert.ok(Math.abs(carton.y-multi.y)<1&&Math.abs(multi.y-bag.y)<1,'all three units remain on one line at '+width+'px');
  }
  assert.equal(await total.isVisible(),false);
  assert.equal(await box.inputValue(),'8');assert.equal(await sachet.inputValue(),'5');
  assert.equal(await page.locator('[data-mobile-stock-item="55"] .mobile-stock-field').filter({has:page.getByText('ในระบบ',{exact:true})}).locator('b').innerText(),'8 กล่อง 4 ซอง');
  assert.deepEqual(await page.locator('[data-mobile-stock-difference="55"] .in').evaluate(positiveColors),greenOnTransparent);
  await box.fill('');await sachet.fill('');assert.equal(await page.evaluate(()=>Object.hasOwn(stockEditDraftStocks,55)),false);
  const lotPanel=page.locator('[data-mobile-stock-lot-host="55"]');
  assert.equal(await lotPanel.isVisible(),false);
  await sachet.fill('-1');assert.equal(await total.innerText(),'กรุณากรอกจำนวนตั้งแต่ 0 ขึ้นไป');
  await sachet.fill('0');assert.equal(await total.isVisible(),false);assert.equal(await page.evaluate(()=>stockEditDraftStocks[55]),0);
  assert.equal(await lotPanel.isVisible(),true);
  assert.equal(await page.locator('[data-mobile-stock-difference="55"]').innerText(),'-8 กล่อง 4 ซอง');
  assert.ok(await page.locator('[data-mobile-stock-difference="55"] span').evaluate(fitsOnOneLine));
  assert.equal(await page.evaluate(()=>window.bulkReviewRpcCalls),0);
  assert.deepEqual(errors,[]);
  console.log('bulk review: selection, duplicate anomalies, all products, pagination, draft preservation, warehouse reset, no stock writes passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
