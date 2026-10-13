const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,process.env.PEPOS_TEST_BUILT?'../public':'..');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,pathname==='/'?'index.html':pathname.slice(1));
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
  const url=`http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);await waitForIsolatedBootstrap(page);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.sapuriTheme),'mac');
  await page.evaluate(()=>{
    currentProfile={id:'theme-test',owner:true,level:1,firstName:'ทดสอบธีม'};
    warehouses=[{id:1,name:'คลังทดสอบ',active:true}];activeWarehouseId=1;
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});isMobileDeviceMode=()=>false;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    currentTab='dashboard';render();
  });
  await page.locator('.stat').first().waitFor();
  assert.equal(await page.locator('[data-sapuri-theme-choice="mac"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.navbtn.active').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(90, 63, 50)');
  const assertTopbar=async()=>{
    const brand=page.locator('.topbar-center-brand');
    assert.equal(await brand.innerText(),'P R A N C - H I B E S');
    assert.equal(await brand.getAttribute('aria-label'),'PRANC-HIBES');
    assert.ok(await brand.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>0));
    assert.equal(await brand.evaluate(el=>getComputedStyle(el,'::after').content),'none','no CSS text may replace the real title');
  };
  await assertTopbar();
  assert.deepEqual(await page.evaluate(()=>{
    const style=getComputedStyle(document.documentElement);
    return ['--primary','--bg','--surface','--sidebar','--border','--text','--text-muted'].map(key=>style.getPropertyValue(key).trim());
  }),['#5A3F32','#F8F6F2','#FFFFFF','#E9DED3','#D8CBBE','#2E241F','#6F6259']);
  const output=path.resolve(__dirname,'../outputs');fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,'sapuri-mac-dashboard.png'),fullPage:true});
  await page.evaluate(()=>{
    notesLoaded=true;notes=[{id:'theme-note',title:'บันทึกประจำร้าน',contentHtml:'<b>เตรียมร้านก่อนเปิดขาย</b><p>ตรวจสอบสินค้าและป้ายราคาประจำวัน</p>',createdBy:'theme-test',updatedAt:'2026-10-13T00:00:00Z'}];
    editingNoteId='theme-note';noteDraft=noteDraftFromRow(notes[0]);currentTab='notes';render();
  });
  await page.locator('#noteTitle').waitFor();
  await page.screenshot({path:path.join(output,'sapuri-mac-note.png'),fullPage:true});
  await page.locator('#noteTitle').fill('โน้ตที่ยังไม่บันทึก');
  await page.locator('[data-sapuri-theme-choice="classic"]').click();
  await assertTopbar();
  assert.equal(await page.locator('#noteTitle').inputValue(),'โน้ตที่ยังไม่บันทึก');
  await page.locator('[data-sapuri-theme-choice="mac"]').click();
  await assertTopbar();
  await page.evaluate(()=>{
    currentTab='checkout';currentCashShift={id:'theme-shift',shiftNo:'ทดสอบ',openingCash:0,openedByName:'ทดสอบ'};
    products=[{id:101,name:'สินค้าตัวอย่างสำหรับตรวจหน้าตา',sku:'DEMO',unit:'กล่อง',price:180,cost:100,active:true,stock:10,units:[]}];
    cart=[{lineId:1,pid:101,name:products[0].name,unit:'กล่อง',qty:1,price:180,cost:100,factor:1,priceSource:'standard'}];
    saleMember=null;promotions=[];render();
  });
  await page.locator('#checkoutBtn').waitFor();
  for(const width of [1024,1280,1440]){
    await page.setViewportSize({width,height:960});
    assert.ok(await page.locator('.pos-action').evaluateAll(buttons=>buttons.every(button=>button.scrollWidth<=button.clientWidth)),`POS action labels fit ${width}px`);
  }
  await page.screenshot({path:path.join(output,'sapuri-mac-pos.png'),fullPage:true});
  await page.evaluate(()=>{
    cart=[{productId:99,name:'บิลที่ยังไม่บันทึก',qty:2,price:12}];
    noteDraft={title:'ยังไม่บันทึก',contentHtml:'เก็บไว้'};
    const field=document.createElement('input');field.id='themeDraftCheck';field.value='ยังไม่บันทึก';document.querySelector('#main').prepend(field);
    window.themeDraftNode=field;window.themeCart=cart;window.themeNote=noteDraft;
    openDocMenu='theme-test';
  });
  await page.locator('[data-sapuri-theme-choice="classic"]').click();
  assert.equal(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(79, 64, 56)');
  assert.equal(await page.evaluate(()=>localStorage.getItem('sapuri_ui_theme_v1')),'classic');
  assert.equal(await page.evaluate(()=>document.getElementById('themeDraftCheck')===window.themeDraftNode&&cart===window.themeCart&&noteDraft===window.themeNote),true);
  await page.reload();await waitForIsolatedBootstrap(page);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.sapuriTheme),'classic');
  // The theme must have no effect on print typography/tokens.
  await page.emulateMedia({media:'print'});
  const classicPrint=await page.evaluate(()=>[getComputedStyle(document.body).fontFamily,getComputedStyle(document.documentElement).getPropertyValue('--primary')]);
  await page.evaluate(()=>applySapuriTheme('mac'));
  assert.deepEqual(await page.evaluate(()=>[getComputedStyle(document.body).fontFamily,getComputedStyle(document.documentElement).getPropertyValue('--primary')]),classicPrint);
  await page.emulateMedia({media:'screen'});
  for(const width of [390,768,1024,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`login fits ${width}px`);
  }
  assert.deepEqual(errors,[]);
  console.log('SAPURI Mac: default, Classic restore, saved choice, draft/cart identity, print isolation, responsive login, no JS errors passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
