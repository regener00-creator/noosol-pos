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
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];
  const templateAction=async id=>{await page.locator('#priceLabelTemplateMenu summary').click();await page.locator('#'+id).click();};
  const submitTemplateName=async name=>{await page.locator('#priceLabelTemplateNameInput').fill(name);await page.locator('#savePriceLabelNameBtn').click();};
  page.on('pageerror',error=>errors.push(error.message));
  await installIsolatedBrowser(page);await page.goto(`http://127.0.0.1:${server.address().port}/`);await waitForIsolatedBootstrap(page);
  const fixture=async()=>page.evaluate(async()=>{

    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());document.getElementById('appRoot').hidden=false;
    currentProfile={id:'test-owner',owner:true,level:1,firstName:'Owner'};renderLoginState=()=>true;
    activeWarehouseId=1;currentTab='mobiletools';products=[];barcodePrintItems=[];barcodePrintShowMenu=true;
    window.testNotices=[];window.testWriteCalls=[];showToast=message=>testNotices.push(message);scheduleSupabaseCoreSync=()=>{};
    businessSettings=JSON.parse(sessionStorage.getItem('test-promotion-settings')||JSON.stringify({...DEFAULT_BUSINESS_SETTINGS,priceLabelTemplates:{},priceLabelTemplateLibraries:{}}));
    persistWorkspaceData=()=>{sessionStorage.setItem('test-promotion-settings',JSON.stringify(businessSettings));return Promise.resolve(true);};
    syncBusinessSettingsToSupabase=async()=>true;
    sb.rpc=async(name)=>{if(name==='update_store_label_settings')return {error:null};testWriteCalls.push(name);throw new Error('Standalone promotion must not call a stock/barcode RPC');};
    window.confirm=()=>true;
    const nativeOpen=window.open.bind(window);window.open=(...args)=>{const popup=nativeOpen(...args);if(popup)popup.print=()=>{};return popup;};
    render();
  });
  const geometry=async selector=>page.locator(selector).evaluate(host=>{
    const controls=[...host.querySelectorAll('input,select,button,textarea,summary')].filter(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>3&&r.height>3&&s.visibility!=='hidden'&&s.display!=='none'&&el.getClientRects().length;
    });
    const name=el=>el.id||el.getAttribute('aria-label')||el.getAttribute('data-price-label-field')||el.textContent.trim().slice(0,25)||el.outerHTML.slice(0,65);
    const outside=controls.filter(el=>{const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;}).map(name);
    const overlaps=[];
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){
      const a=controls[i].getBoundingClientRect(),b=controls[j].getBoundingClientRect();
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)overlaps.push([name(controls[i]),name(controls[j])]);
    }
    return {outside,overlaps,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth};
  });

  const out=path.join(root,'outputs/mobile-promotion-followup');fs.mkdirSync(out,{recursive:true});
  const results=[];
  const measure=host=>[...host.querySelectorAll('[data-promotion-content]')].map(text=>{
    const r=text.parentElement.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(text);const t=range.getBoundingClientRect();
    return {text:text.textContent,clipped:t.top<r.top-1||t.bottom>r.bottom+1||t.left<r.left-1||t.right>r.right+1};
  });
  for(const store of [1,2])for(const width of [360,390,430]){
    await page.setViewportSize({width,height:844});await page.reload();await waitForIsolatedBootstrap(page);await fixture();
    await page.evaluate(store=>{activeWarehouseId=store;currentTab='mobiletools';businessSettings={...DEFAULT_BUSINESS_SETTINGS};warehouseBusinessProfiles={2:{}};persistWorkspaceData=()=>Promise.resolve(true);render();},store);
    const normal=await page.evaluate(()=>({tab:currentTab,menu:!!document.getElementById('promotionLabelDesignBtn'),text:main.innerText.slice(0,350)}));
    const result={store,width,normal};
    assert.equal(normal.tab,'mobiletools');
    await page.locator('#mobilePromotionLabels').click();
    await page.locator('#promotionLabelDesignBtn').click();
    await page.locator('#priceLabelDesignerSize').selectOption('a4-poster-landscape');
    await page.locator('[data-price-label-custom-value]').fill('โปรโมชั่นพิเศษ');await page.locator('[data-price-label-custom-value]').press('Tab');
    await page.locator('[data-price-label-tab="custom:promotion-detail"]').click();
    await page.locator('[data-price-label-custom-value]').fill('ซื้อ 1 แถม 1\nราคาพิเศษ 150 บาท\nเฉพาะวันนี้เท่านั้น\nสินค้ามีจำนวนจำกัด');await page.locator('[data-price-label-custom-value]').press('Tab');
    result.editorLayout=await geometry('.price-label-designer-content');
    assert.deepEqual(result.editorLayout.outside,[]);assert.deepEqual(result.editorLayout.overlaps,[]);
    result.text=await page.locator('#priceLabelDesignerCanvas').evaluate(measure);
    await page.locator('#priceLabelDesignerCanvas').screenshot({path:path.join(out,store+'-'+width+'-canvas.png')});
    await page.locator('#priceLabelTemplateMenu summary').click();result.menuLayout=await geometry('.price-label-template-menu');await page.locator('#priceLabelTemplateMenu summary').click();
    await page.locator('#savePriceLabelDesignerBtn').click();result.nameDialogLayout=await geometry('#priceLabelNameDialog');await submitTemplateName('มือถือ '+store+' '+width);
    await page.waitForFunction(()=>!document.getElementById('priceLabelNameDialog'));await page.evaluate(()=>labelSettingsSave);
    result.saved=await page.evaluate(()=>testNotices);
    const settings=await page.evaluate(()=>({businessSettings,warehouseBusinessProfiles}));
    const saved=await page.evaluate(()=>getPriceLabelTemplate('a4-poster-landscape','promotion'));
    await page.reload();await waitForIsolatedBootstrap(page);await fixture();
    await page.evaluate(({store,settings})=>{activeWarehouseId=store;businessSettings=settings.businessSettings;warehouseBusinessProfiles=settings.warehouseBusinessProfiles;currentTab='mobiletools';render();},{store,settings});
    result.normalReopen=await page.evaluate(()=>({tab:currentTab,menu:!!document.getElementById('promotionLabelDesignBtn')}));
    await page.locator('#mobilePromotionLabels').click();await page.locator('#promotionLabelDesignBtn').click();
    result.paper=await page.locator('#priceLabelDesignerSize').inputValue();
    result.identical=JSON.stringify(saved)===await page.evaluate(()=>JSON.stringify(getPriceLabelTemplate('a4-poster-landscape','promotion')));
    result.reopenedText=await page.locator('#priceLabelDesignerCanvas').evaluate(measure);
    await page.locator('#cancelPriceLabelDesignerBtn').click();await page.locator('[data-barcode-print-mode="promotion"]').click();
    result.printPageLayout=await geometry('.promotion-print-page');
    result.preview=await page.locator('.promotion-print-preview').evaluate(el=>({width:el.clientWidth,contentWidth:el.scrollWidth,horizontalScroll:el.scrollWidth>el.clientWidth+1}));
    result.previewText=await page.locator('.promotion-print-preview').evaluate(measure);
    assert.equal(result.preview.horizontalScroll,false,'Whole A4 fits screen without horizontal scrolling');
    for(const layout of [result.menuLayout,result.nameDialogLayout,result.printPageLayout]){assert.deepEqual(layout.outside,[]);assert.deepEqual(layout.overlaps,[]);}
    assert.equal(result.paper,'a4-poster-landscape');assert.equal(result.identical,true);
    for(const text of [...result.text,...result.reopenedText,...result.previewText])assert.equal(text.clipped,false,text.text);
    await page.locator('#promotionLabelQuantity').fill('2');
    assert.equal(await page.locator('#promotionLabelQuantity').inputValue(),'2');
    if(width===390){
      const [popup]=await Promise.all([page.waitForEvent('popup'),page.locator('#promotionLabelPrintBtn').click()]);
      await popup.waitForSelector('.label');await popup.waitForFunction(()=>document.querySelector('[data-promotion-text]')?.dataset.fitted==='true');
      const pdf=await popup.pdf({preferCSSPageSize:true,printBackground:true}),text=pdf.toString('latin1');
      const box=text.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
      assert.ok(box&&Math.abs(+box[1]-841.89)<2&&Math.abs(+box[2]-595.28)<2,'Printed page remains full-size A4 landscape');
      assert.equal((text.match(/\/Type \/Page\b/g)||[]).length,2);await popup.close();
    }
    await page.screenshot({path:path.join(out,store+'-'+width+'-print-preview.png'),fullPage:true});
    await page.locator('#barcodePrintMenuBtn').click();await page.locator('#mobilePromotionBack').click();assert.equal(await page.evaluate(()=>currentTab),'mobiletools');
    await page.evaluate(()=>{currentProfile={id:'level2',level:2,owner:false};render();});assert.equal(await page.locator('#mobilePromotionLabels').count(),0,'Existing permissions remain enforced');
    results.push(result);
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));
  assert.deepEqual(errors,[]);console.log('Mobile promotion flow passed for both stores at 360, 390 and 430px: real menu, complete text, no overlaps, saved designs, fitted preview and full-size PDFs');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
