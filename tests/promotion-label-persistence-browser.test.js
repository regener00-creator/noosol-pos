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
  const templateAction=async id=>{await page.locator('#priceLabelTemplateMenu summary').click();await page.locator('#'+id).click();};
  const submitTemplateName=async name=>{await page.locator('#priceLabelTemplateNameInput').fill(name);await page.locator('#savePriceLabelNameBtn').click();};
  page.on('pageerror',error=>errors.push(error.message));
  await installIsolatedBrowser(page);await page.goto(`http://127.0.0.1:${server.address().port}/`);await waitForIsolatedBootstrap(page);
  const fixture=async()=>page.evaluate(async()=>{
    await ensurePageCodeLoaded('barcodeprint');
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());document.getElementById('appRoot').hidden=false;
    currentProfile={id:'test-owner',owner:true,level:1,firstName:'Owner'};renderLoginState=()=>true;
    activeWarehouseId=1;currentTab='barcodeprint';products=[];barcodePrintItems=[];barcodePrintShowMenu=true;
    window.testNotices=[];window.testWriteCalls=[];showToast=message=>testNotices.push(message);scheduleSupabaseCoreSync=()=>{};
    businessSettings=JSON.parse(sessionStorage.getItem('test-promotion-settings')||JSON.stringify({...DEFAULT_BUSINESS_SETTINGS,priceLabelTemplates:{},priceLabelTemplateLibraries:{}}));
    persistWorkspaceData=()=>{sessionStorage.setItem('test-promotion-settings',JSON.stringify(businessSettings));return Promise.resolve(true);};
    syncBusinessSettingsToSupabase=async()=>true;
    sb.rpc=async(name)=>{if(name==='update_store_label_settings')return {error:null};testWriteCalls.push(name);throw new Error('Standalone promotion must not call a stock/barcode RPC');};
    window.confirm=()=>true;
    const nativeOpen=window.open.bind(window);window.open=(...args)=>{const popup=nativeOpen(...args);if(popup)popup.print=()=>{};return popup;};
    render();
  });

  const out=path.join(root,'outputs/promotion-label-regression');fs.mkdirSync(out,{recursive:true});
  const measure=host=>[...host.querySelectorAll('[data-promotion-content]')].map(text=>{
    const box=text.parentElement.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(text);const r=range.getBoundingClientRect();
    return {text:text.textContent,clipped:r.top<box.top-1||r.bottom>box.bottom+1||r.left<box.left-1||r.right>box.right+1};
  });
  const results=[];
  for(const store of [1,2]){
    await page.reload();await waitForIsolatedBootstrap(page);await fixture();
    await page.evaluate(store=>{
      activeWarehouseId=store;businessSettings={...DEFAULT_BUSINESS_SETTINGS};warehouseBusinessProfiles={2:{}};
      window.testRemote={1:{},2:{}};window.testFail=false;window.testDelay=false;window.testRpcCount=0;
      persistWorkspaceData=()=>Promise.resolve(true);
      sb.rpc=async(name,args)=>{
        if(name!=='update_store_label_settings')throw Error('Unexpected RPC');testRpcCount++;
        if(testDelay)await new Promise(resolve=>window.releaseTestSave=resolve);
        if(testFail)return {error:{message:'Connection test failure'}};
        const data=testRemote[args.p_warehouse_id];
        for(const [key,value] of Object.entries(args.p_patch))data[key]=args.p_size?{...data[key],[args.p_size]:structuredClone(value)}:structuredClone(value);
        return {data:null,error:null};
      };render();
    },store);
    await page.locator('[data-barcode-print-mode="promotion"]').click();
    await page.locator('#promotionLabelSize').selectOption('a4-poster-landscape');
    await page.evaluate(()=>openPriceLabelDesigner(promotionTemplateSize(),{kind:'promotion',onClose:()=>render()}));
    await page.locator('[data-price-label-custom-value]').fill('โปรโมชั่นพิเศษ');await page.locator('[data-price-label-custom-value]').press('Tab');
    await page.locator('[data-price-label-tab="custom:promotion-detail"]').click();
    const detail='ซื้อ 1 แถม 1\nราคาพิเศษ 150 บาท\nเฉพาะวันนี้เท่านั้น\nสินค้ามีจำนวนจำกัด';
    await page.locator('[data-price-label-custom-value]').fill(detail);await page.locator('[data-price-label-custom-value]').press('Tab');
    await page.waitForFunction(()=>document.fonts.check('16px "Google Sans"'));
    assert.ok((await page.locator('#priceLabelDesignerCanvas').evaluate(measure)).every(x=>!x.clipped),'Designer fits all four lines');
    await page.evaluate(()=>{testDelay=true;testNotices=[];});
    await page.locator('#savePriceLabelDesignerBtn').click();await submitTemplateName('ร้าน '+store+' แนวนอน');
    await page.waitForFunction(()=>typeof releaseTestSave==='function');
    assert.equal(await page.locator('#savePriceLabelNameBtn').isDisabled(),true);
    assert.equal(await page.evaluate(()=>testNotices.some(x=>x.includes('แล้ว'))),false,'No success before acknowledgement');
    assert.equal(await page.evaluate(()=>getPriceLabelTemplateLibrary('a4-poster-landscape','promotion').templates.length),0,'No optimistic template commit');
    await page.evaluate(()=>{testDelay=false;releaseTestSave();});
    await page.waitForSelector('#promotionLabelSize');await page.evaluate(()=>labelSettingsSave);
    const remote=await page.evaluate(()=>testRemote),saved=await page.evaluate(()=>getPriceLabelTemplate('a4-poster-landscape','promotion'));
    assert.ok(remote[store].promotionLabelTemplates);assert.equal(Object.keys(remote[store===1?2:1]).length,0);
    assert.equal(await page.evaluate(()=>testRpcCount),1);
    await page.reload();await waitForIsolatedBootstrap(page);await fixture();
    await page.evaluate(({store,remote})=>{activeWarehouseId=store;businessSettings={...DEFAULT_BUSINESS_SETTINGS,...remote[1]};warehouseBusinessProfiles={2:remote[2]};render();},{store,remote});
    await page.locator('[data-barcode-print-mode="promotion"]').click();
    assert.equal(await page.locator('#promotionLabelSize').inputValue(),'a4-poster-landscape','Restore paper size without selecting again');
    assert.deepEqual(await page.evaluate(()=>getPriceLabelTemplate('a4-poster-landscape','promotion')),saved);
    // Different stores keep independent paper choices on this browser.
    await page.evaluate(store=>{activeWarehouseId=store===1?2:1;rememberPromotionPrintSize('80x50');activeWarehouseId=store;render();},store);
    assert.equal(await page.locator('#promotionLabelSize').inputValue(),'a4-poster-landscape');
    await page.locator('#promotionLabelQuantity').fill('2');
    const [popup]=await Promise.all([page.waitForEvent('popup'),page.locator('#promotionLabelPrintBtn').click()]);
    await popup.waitForSelector('.label');await popup.waitForFunction(()=>document.querySelector('[data-promotion-text]')?.dataset.fitted==='true');
    await popup.emulateMedia({media:'print'});
    const printText=await popup.locator('body').evaluate(measure);assert.ok(printText.every(x=>!x.clipped),'Printed text fits');
    assert.equal(printText[1].text,detail);
    const pdf=await popup.pdf({preferCSSPageSize:true,printBackground:true}),pdfText=pdf.toString('latin1');
    assert.equal((pdfText.match(/\/Type \/Page\b/g)||[]).length,2);
    const media=pdfText.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);assert.ok(media&&Math.abs(+media[1]-841.89)<2&&Math.abs(+media[2]-595.28)<2);
    fs.writeFileSync(path.join(out,'store-'+store+'.pdf'),pdf);
    await popup.locator('.label').first().screenshot({path:path.join(out,'store-'+store+'.png')});await popup.close();
    // A rejected edit remains editable and never replaces acknowledged data.
    await page.evaluate(()=>{testNotices=[];sb.rpc=async()=>({error:{message:'Connection test failure'}});openPriceLabelDesigner(promotionTemplateSize(),{kind:'promotion',onClose:()=>render()});});
    await page.locator('[data-price-label-custom-value]').fill('แก้แล้วลองบันทึกใหม่');await page.locator('[data-price-label-custom-value]').press('Tab');
    await page.locator('#savePriceLabelDesignerBtn').click();await page.waitForFunction(()=>testNotices.some(x=>x.includes('ไม่สำเร็จ')));
    assert.equal(await page.locator('[data-price-label-custom-value]').inputValue(),'แก้แล้วลองบันทึกใหม่');
    assert.equal(await page.evaluate(()=>testNotices.some(x=>x.includes('แล้ว'))),false);
    assert.deepEqual(await page.evaluate(()=>getPriceLabelTemplate('a4-poster-landscape','promotion')),saved);
    await page.evaluate(()=>{sb.rpc=async()=>({error:null});testNotices=[];});
    await page.locator('#savePriceLabelDesignerBtn').click();await page.waitForSelector('#promotionLabelSize');
    assert.ok(await page.evaluate(()=>testNotices.some(x=>x.includes('แล้ว'))));
    results.push({store,roundTrip:true,serverAcknowledgement:true,retry:true,printText,pages:2});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  console.log('Both stores passed: remembered landscape, identical acknowledged templates, delayed/failed/retried saves, multiline fit, two landscape PDF pages');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
