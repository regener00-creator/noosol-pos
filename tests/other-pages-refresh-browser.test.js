const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,'../public');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.PEPOS_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];
  await installIsolatedBrowser(page);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    currentProfile={id:'refresh-owner',owner:true,level:1};activeWarehouseId=1;warehouses=[{id:1,name:'Test',active:true}];
    renderLoginState=()=>true;isMobileDeviceMode=()=>false;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    representativeManagedProductIndexLoaded=true;representativeManagedProductIndexLoadedAt=Date.now();
    products=Array.from({length:20},(_,i)=>({id:i+1,sku:String(i+1).padStart(3,'0'),name:`Product ${i+1}`,unit:'Pcs',price:100,cost:60,stock:3,units:[],active:true,_revision:1,category:'ยา'}));
    rebuildProductLookupMaps();productDirtyOperations.clear();searchQuery='Product';selectedGroup=null;editingProductId=null;currentTab='products';
    window.remoteRows=products.map(p=>({...productMetadataToRow(p),revision:p._revision}));
    sb.rpc=async()=>({data:null,error:null});
    fetchProductRevisionManifest=async()=>({data:window.remoteRows.map(row=>({id:row.id,revision:row.revision}))});
    fetchProductRowsByIds=async ids=>({data:window.remoteRows.filter(row=>ids.includes(row.id))});
    persistProductChangesToIndexedDB=async()=>true;
    window.receiveProducts=async()=>{productReviewRefreshAt=0;await refreshProductReviewColors();};
    render();
  });
  await page.waitForSelector('.product-list-page');
  await page.evaluate(()=>{window.productPageNode=document.querySelector('.product-list-page');window.searchNode=document.getElementById('search');window.tableNode=document.querySelector('.table-pane');});
  await page.locator('#search').focus();
  await page.evaluate(async()=>{window.remoteRows[19].price=200;window.remoteRows[19].revision++;await window.receiveProducts();});
  assert.equal(await page.evaluate(()=>window.tableNode===document.querySelector('.table-pane')),true,'off-page product change must not replace visible results');
  await page.evaluate(async()=>{window.remoteRows[0].revision++;await window.receiveProducts();});
  assert.equal(await page.evaluate(()=>window.tableNode===document.querySelector('.table-pane')),true,'revision-only change keeps table');
  await page.evaluate(async()=>{
    const scroll=document.querySelector('.product-table-scroll');scroll.scrollTop=75;window.savedTop=scroll.scrollTop;
    window.remoteRows[0].price=120;window.remoteRows[0].revision++;await window.receiveProducts();
  });
  assert.equal(await page.locator('[data-pid="1"][data-field="price"]').inputValue(),'120');
  assert.equal(await page.evaluate(()=>window.productPageNode.isConnected&&window.searchNode===document.activeElement),true,'visible updates retain the page and search focus');
  assert.equal(await page.evaluate(()=>document.querySelector('.product-table-scroll').scrollTop===window.savedTop),true,'keep product table scroll');
  await page.evaluate(async()=>{
    const modal=document.createElement('div');modal.id='testModal';modal.className='modal-overlay';document.body.append(modal);
    window.remoteRows[0].price=140;window.remoteRows[0].revision++;await window.receiveProducts();
  });
  assert.equal(await page.locator('[data-pid="1"][data-field="price"]').inputValue(),'120','modal blocks automatic update');
  await page.evaluate(async()=>{document.getElementById('testModal').remove();await window.receiveProducts();});
  assert.equal(await page.locator('[data-pid="1"][data-field="price"]').inputValue(),'140');
  // Late network completion must not replace an inline edit or another warehouse.
  await page.evaluate(()=>{
    fetchProductRowsByIds=()=>new Promise(resolve=>window.resolveProductRows=resolve);
    window.remoteRows[0].revision++;productReviewRefreshAt=0;window.inflightProduct=refreshProductReviewColors();
  });
  await page.waitForFunction(()=>typeof window.resolveProductRows==='function');
  await page.locator('[data-pid="1"][data-field="price"]').focus();
  await page.evaluate(async()=>{window.resolveProductRows({data:[{...window.remoteRows[0],price:999}]});await window.inflightProduct;});
  assert.equal(await page.locator('[data-pid="1"][data-field="price"]').inputValue(),'140','in-flight update cannot overwrite the focused editor');
  await page.evaluate(async()=>{
    document.activeElement.blur();productReviewRefreshAt=0;window.inflightProduct=refreshProductReviewColors();
    await Promise.resolve();await Promise.resolve();activeWarehouseId=2;
    window.resolveProductRows({data:[{...window.remoteRows[0],price:999}]});await window.inflightProduct;
    activeWarehouseId=1;
  });
  assert.equal(await page.evaluate(()=>products[0].price),140,'late response from a previous warehouse is discarded');
  // The representative lookup also uses the partial refresh and waits for edits.
  await page.evaluate(()=>{
    window.productBeforeRepresentative=renderProducts();representativeManagedProductIds.add(1);
    document.querySelector('[data-pid="1"][data-field="price"]').focus();
    refreshProductListFromBackground(window.productBeforeRepresentative);
  });
  assert.equal(await page.locator('[data-product-representative-history="1"]').count(),0);
  await page.evaluate(()=>{document.activeElement.blur();applyPendingProductListRefresh();});
  assert.equal(await page.locator('[data-product-representative-history="1"]').count(),1);
  assert.equal(await page.evaluate(()=>window.productPageNode.isConnected),true);
  // Mobile uses the actual rendering and refresh function with isolated reads.
  await page.evaluate(()=>{
    isMobileDeviceMode=()=>true;currentTab='mobiletools';mobileToolMode='price';mobileSelectPriceProduct(products[0]);
    window.mobileReads=0;
    loadProductRowsFromSupabase=async()=>{window.mobileReads++;return {data:products.map(p=>({...p}))};};
    loadInventoryBalancesFromSupabase=async()=>true;loadInventoryLotsFromSupabase=async()=>true;loadInspectionListsFromSupabase=async()=>true;
    render();
  });
  await page.waitForSelector('.mobile-tools-page');
  await page.evaluate(()=>{window.mobilePageNode=document.querySelector('.mobile-tools-page');window.mobileResultNode=document.getElementById('mobilePriceResult');window.mobileInputNode=document.getElementById('mobilePriceInput');});
  await page.waitForTimeout(100);
  await page.evaluate(()=>refreshMobileToolsData(null,{silent:true}));
  assert.equal(await page.evaluate(()=>window.mobilePageNode.isConnected&&window.mobileResultNode.isConnected),true,'unchanged mobile refresh keeps DOM even though status timestamp changes');
  await page.evaluate(async()=>{
    loadProductRowsFromSupabase=async()=>({data:products.map(p=>p.id===1?{...p,price:180}:p)});
    await refreshMobileToolsData(null,{silent:true});
  });
  assert.equal(await page.locator('#mobilePriceEditSale').inputValue(),'180');
  assert.equal(await page.evaluate(()=>window.mobilePageNode.isConnected&&window.mobileInputNode.isConnected),true,'mobile price changes update only result card');
  await page.evaluate(()=>{
    loadProductRowsFromSupabase=()=>new Promise(resolve=>window.resolveMobileProducts=resolve);
    window.inflightMobile=refreshMobileToolsData(null,{silent:true});
  });
  await page.waitForFunction(()=>typeof window.resolveMobileProducts==='function');
  await page.locator('#mobilePriceEditSale').fill('185');
  await page.evaluate(async()=>{window.resolveMobileProducts({data:products.map(p=>({...p,price:190}))});await window.inflightMobile;});
  assert.equal(await page.locator('#mobilePriceEditSale').inputValue(),'185','keep a quick-price draft entered while loading');
  await page.evaluate(()=>{document.activeElement.blur();applyPendingMobileToolsRefresh();});
  assert.equal(await page.locator('#mobilePriceEditSale').inputValue(),'185','unsaved draft remains protected after blur');
  await page.evaluate(()=>{document.getElementById('mobilePriceSaveChanges').hidden=true;applyPendingMobileToolsRefresh();});
  assert.equal(await page.locator('#mobilePriceEditSale').inputValue(),'190','apply deferred data after editing ends');
  await page.locator('#mobilePriceEditSale').fill('195');
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));
  });
  assert.equal(await page.locator('#mobilePriceEditSale').inputValue(),'195');
  assert.equal(await page.locator('#mobilePriceSaveChanges').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.mobilePageNode.isConnected),true,'offline event must not redraw the page');
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
    setMobileDataStatus('online');updateMobileToolsConnectionUi();refreshMobileToolsOnResume();
  });
  assert.equal(await page.locator('#mobilePriceSaveChanges').isEnabled(),true);
  assert.equal(await page.locator('#mobilePriceEditSale').inputValue(),'195','reconnect retains draft');
  await page.evaluate(()=>{
    window.dispatchEvent(new Event('beforeinstallprompt',{cancelable:true}));
  });
  assert.equal(await page.locator('#mobileInstallApp').innerText(),'ติดตั้งแอป');
  assert.equal(await page.locator('#mobilePriceEditSale').inputValue(),'195','install availability does not reset a draft');
  assert.equal(await page.evaluate(()=>window.mobilePageNode.isConnected),true);
  await page.evaluate(async()=>{
    document.getElementById('mobilePriceSaveChanges').hidden=true;document.activeElement.blur();
    loadProductRowsFromSupabase=async()=>{throw new Error('offline test');};
    window.failedRefresh=await refreshMobileToolsData(null,{silent:true});
  });
  assert.equal(await page.evaluate(()=>window.failedRefresh),false);
  assert.equal(await page.locator('#mobilePriceEditSale').inputValue(),'195','failed refresh preserves visible result');
  await page.evaluate(()=>{
    loadProductRowsFromSupabase=()=>new Promise(resolve=>window.resolveMobileProducts=resolve);
  });
  await page.evaluate(()=>{
    document.getElementById('mobilePriceSaveChanges').hidden=true;document.activeElement.blur();
    window.inflightMobile=refreshMobileToolsData(null,{silent:true});
  });
  await page.waitForTimeout(20);
  await page.evaluate(async()=>{
    currentTab='notes';document.getElementById('main').innerHTML='<div id="notesUnchanged">NOTE</div>';
    window.resolveMobileProducts({data:products});await window.inflightMobile;
  });
  assert.equal(await page.locator('#notesUnchanged').count(),1,'late mobile refresh cannot render another page');
  await page.evaluate(()=>{
    currentTab='mobiletools';mobileToolMode='inventory';mobileInventoryStep='inspection';inspectionLists=[];
    loadProductRowsFromSupabase=async()=>({data:products});loadInspectionListsFromSupabase=async()=>{};
    render();window.inventoryPageNode=document.querySelector('.mobile-tools-page');window.inventoryPanel=document.querySelector('.mobile-inventory-workflow');
  });
  await page.evaluate(()=>refreshMobileToolsData(null,{silent:true}));
  assert.equal(await page.evaluate(()=>window.inventoryPanel.isConnected),true,'unchanged inspection lists keep the panel');
  await page.evaluate(async()=>{
    loadInspectionListsFromSupabase=async()=>{inspectionLists=[{id:'inspection-new',name:'New inspection',warehouseId:1,items:[],updatedAt:'2026-10-31'}];};
    await refreshMobileToolsData(null,{silent:true});
  });
  assert.match(await page.locator('.mobile-inventory-workflow').innerText(),/New inspection/,'changed inspection list becomes visible');
  assert.deepEqual(errors,[]);
  console.log('Other pages: product revision/visible changes, partial updates, focus/scroll, dialogs, stale warehouse responses, representative lookup, mobile resume/reconnect and unsaved drafts passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
