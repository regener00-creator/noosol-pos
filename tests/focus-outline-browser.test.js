const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,'../public');
const server=http.createServer((req,res)=>{const file=path.resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.PEPOS_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],findings=[],coverage=[];
  await installIsolatedBrowser(page);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    currentProfile={id:'focus-test',owner:true,level:1,firstName:'ทดสอบ'};systemUsersLoaded=true;systemUsers=[currentProfile];
    warehouses=[{id:1,name:'คลังทดสอบ',active:true}];activeWarehouseId=1;
    products=[{id:1,sku:'001',barcode:'8850000000001',name:'สินค้าทดสอบ',category:'ยา',unit:'แผง',price:100,cost:50,stock:10,wh:1,active:true,units:[]}];
    contacts=[{id:1,name:'ผู้ติดต่อทดสอบ',type:'both',types:['customer','supplier'],entity:'individual'}];
    renderLoginState=()=>true;canAccessTab=()=>true;isMobileDeviceMode=()=>false;ensureOnDemandDataForTab=()=>({status:'ready'});
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
  });
  const scan=async label=>{
    const result=await page.evaluate(()=>{
      const found=[],nodes=[...document.querySelectorAll('input,select,textarea,[contenteditable="true"]')].filter(el=>!el.disabled&&el.type!=='hidden'&&!el.classList.contains('dmy-native')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
      for(const el of nodes){
        el.scrollIntoView({block:'center',inline:'center'});el.focus({preventScroll:true});
        const s=getComputedStyle(el),r=el.getBoundingClientRect(),ring=Math.max(0,(parseFloat(s.outlineWidth)||0)+(parseFloat(s.outlineOffset)||0));
        if(!ring)continue;
        for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){
          const ps=getComputedStyle(p),pr=p.getBoundingClientRect(),left=pr.left+p.clientLeft,top=pr.top+p.clientTop,right=left+p.clientWidth,bottom=top+p.clientHeight;
          const clipX=/hidden|clip|auto|scroll/.test(ps.overflowX),clipY=/hidden|clip|auto|scroll/.test(ps.overflowY);
          // Only diagnose a clipped focus ring when the control itself fits in view.
          if(r.left<left-.5||r.right>right+.5||r.top<top-.5||r.bottom>bottom+.5)continue;
          const sides=[];
          if(clipX&&r.left-ring<left-.5)sides.push('left');if(clipX&&r.right+ring>right+.5)sides.push('right');
          if(clipY&&r.top-ring<top-.5)sides.push('top');if(clipY&&r.bottom+ring>bottom+.5)sides.push('bottom');
          if(sides.length){found.push({field:el.id||el.className||el.tagName,host:p.id||p.className||p.tagName,sides,ring});break;}
        }
      }
      return {fields:nodes.length,found};
    });
    coverage.push({label,fields:result.fields});findings.push(...result.found.map(row=>({label,...row})));
    if(process.env.PEPOS_CAPTURE_FOCUS&&['mac:POS:cart','mac:medicine-label','mac:inspection:1000'].includes(label)){
      fs.mkdirSync(path.resolve(__dirname,'../outputs'),{recursive:true});
      const selector=label.endsWith('cart')?'#search':label.endsWith('medicine-label')?'.medicine-label-meal-row input':'#inspectionListWarehouse';
      await page.locator(selector).first().focus();
      await page.screenshot({path:path.resolve(__dirname,'../outputs/focus-'+label.replaceAll(':','-')+'.png')});
    }
  };
  for(const theme of ['mac','classic']){
    await page.evaluate(theme=>applySapuriTheme(theme),theme);
    const tabs=await page.evaluate(()=>Object.keys(RENDERERS));
    for(const tab of tabs){
      await page.evaluate(async tab=>{await ensurePageCodeLoaded(tab);currentTab=tab;render();},tab);
      await scan(theme+':'+tab);
    }
    const forms=[['products','editingProductId'],['customers','editingContactId'],['purchaseorder','editingPOId'],['goodsreceipt','editingGRId'],['productreturn','editingReturnId'],['productexchange','editingProductExchangeId'],['quotation','editingQuotationId'],['transfer','editingTransferId'],['promotions','editingPromotionId']];
    for(const [tab,key] of forms){
      await page.evaluate(async({tab,key})=>{await ensurePageCodeLoaded(tab);window.eval(key+"='new'");currentTab=tab;render();},{tab,key});
      await scan(theme+':'+tab+':new');
      await page.evaluate(key=>window.eval(key+'=null'),key);
    }
    await page.evaluate(()=>{currentTab='checkout';cart=[{lineId:501,pid:1,name:'สินค้าทดสอบ',unit:'แผง',qty:1,price:100,cost:50,factor:1}];render();});
    await scan(theme+':POS:cart');
    await page.evaluate(()=>openMedicineLabelEditor(501));await scan(theme+':medicine-label');
    await page.evaluate(()=>document.querySelectorAll('.modal-overlay').forEach(el=>el.remove()));
    await page.evaluate(()=>{currentTab='customers';editingCustomerPriceContactId=1;render();});await scan(theme+':customer-prices');
    await page.evaluate(()=>{editingCustomerPriceContactId=null;currentTab='notes';notesLoaded=true;startNewNote();});await scan(theme+':note-editor');
    await page.evaluate(()=>{currentTab='stockcontrol';stockControlMode='count';openInspectionListEditor();});
    for(const width of [1440,1000,390]){await page.setViewportSize({width,height:1000});await scan(theme+':inspection:'+width);}
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>{editingInspectionListId=null;inspectionListDraft=null;currentTab='barcodeprint';barcodePrintItems=[{pid:1,unit:'แผง',barcode:'8850000000001',qty:1}];render();openPriceLabelDesigner();});await scan(theme+':label-designer');
    await page.evaluate(()=>document.querySelectorAll('.modal-overlay').forEach(el=>el.remove()));
    await page.evaluate(()=>openPOSCustomerCreateModal());await scan(theme+':member-create');
    await page.evaluate(()=>document.querySelectorAll('.modal-overlay').forEach(el=>el.remove()));
    await page.evaluate(()=>openVoidSaleReasonModal({id:'test-sale',ref:'TEST',total:100,payMethod:'เงินสด'},()=>{}));await scan(theme+':cancel-sale');
    await page.evaluate(()=>document.querySelectorAll('.modal-overlay').forEach(el=>el.remove()));
    await page.evaluate(()=>openCustomItemModal());await scan(theme+':custom-item');
    await page.evaluate(()=>document.querySelectorAll('.modal-overlay').forEach(el=>el.remove()));
    await page.evaluate(()=>{currentTab='products';selectedGroup={cat:'ยา'};searchQuery='';render();});await scan(theme+':product-table');
    await page.evaluate(()=>{currentTab='representativehistory';render();});
    await page.locator('#newSalesRepBtn').click();await scan(theme+':representative-create');
    await page.evaluate(()=>{editingSalesRepresentativeId=null;document.querySelectorAll('.modal-overlay').forEach(el=>el.remove());});
    await page.evaluate(()=>openOwnerRecoverySetupModal());await scan(theme+':recovery-setup');
    await page.evaluate(()=>document.querySelectorAll('.modal-overlay').forEach(el=>el.remove()));
    await page.evaluate(()=>{isMobileDeviceMode=()=>true;currentTab='mobiletools';render();});
    await page.setViewportSize({width:390,height:844});await scan(theme+':mobile-tools');
    await page.evaluate(()=>openMobileProductEditor('new'));await scan(theme+':mobile-product');
    await page.evaluate(()=>{editingProductId=null;isMobileDeviceMode=()=>false;currentTab='checkout';render();});
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>{currentTab='checkout';render();openPOSCustomerPicker();});await scan(theme+':member-picker');
    await page.evaluate(()=>document.querySelectorAll('.modal-overlay').forEach(el=>el.remove()));
  }
  fs.mkdirSync(path.resolve(__dirname,'../outputs'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../outputs/focus-outline-audit.json'),JSON.stringify({coverage,findings,errors},null,2));
  console.log(JSON.stringify({screens:coverage.length,fields:coverage.reduce((sum,row)=>sum+row.fields,0),findings},null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(findings,[],'focus outlines must fit inside clipping ancestors');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
