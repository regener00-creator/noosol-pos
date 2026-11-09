const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.join(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
  const file=path.join(root,pathname==='/'?'index.html':pathname.replace(/^\//,''));
  if(!file.startsWith(root)||!fs.existsSync(file)){ response.writeHead(404).end(); return; }
  response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});
let browser;
const executable=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync)||chromium.executablePath();

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:executable});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{}})}})};`}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.locator('#loginPassword').fill('secret123');
  await page.locator('#loginPassword').focus();

  await page.evaluate(()=>renderLoginState());
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'loginPassword','login rendering must not steal focus from the password field');

  await page.setViewportSize({width:390,height:540});
  await page.waitForTimeout(260);
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'loginPassword','iPhone keyboard resize must not move focus back to the user ID field');
  assert.equal(await page.locator('#loginPassword').inputValue(),'secret123','password text must remain intact after the viewport resize');
  await page.evaluate(()=>{
    sb.auth.signInWithPassword=async()=>({error:null});
    loadCurrentProfile=async()=>{currentProfile={id:'mobile-user',username:'staff',firstName:'กรธวัช',lastName:'จันทรวารี',level:2};};
    loadWorkspaceFromSupabase=async()=>{
      warehouses=[{id:1,name:'พระยาสุเรนทร์'},{id:2,name:'พรชัย'},{id:3,name:'คลังอื่น'}];
      warehouseAccessRows=[{warehouse_id:1},{warehouse_id:2}];
      localStorage.setItem(activeWarehouseStorageKey(),'2');
      restoreActiveWarehouseSelection();
    };
    rememberOfflineLogin=saveOfflinePosSnapshot=loadOfflineSales=syncOfflineSales=async()=>{};
    loadWarehouseInventoryFromSupabase=loadCashShiftsFromSupabase=loadBusinessSettingsFromSupabase=loadProductCategorySettingsFromSupabase=loadFavoritesFromSupabase=loadDocumentPrefixesFromSupabase=async()=>true;
    enforceOwnerRecoverySetup=checkOwnerDatabaseHealth=async()=>{};
    ensureOnDemandDataForTab=()=>({status:'ready'});
  });
  await page.locator('#loginUserId').fill('staff');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.locator('#warehouseChoiceScreen').waitFor({state:'visible'});
  assert.equal(await page.locator('#appRoot').isHidden(),true);
  const choice=page.locator('#warehouseChoiceSelect');
  assert.equal(await choice.inputValue(),'');
  assert.deepEqual(await choice.locator('option').evaluateAll(items=>items.map(o=>o.value)),['','1','2']);
  await choice.selectOption('1');
  await page.locator('#warehouseChoiceForm [type="submit"]').click();
  await page.locator('.mobile-warehouse-title').waitFor();
  assert.match(await page.locator('.mobile-warehouse-title').innerText(),/^SAPURI • คลังพระยาสุเรนทร์/);
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    const size=await page.locator('.mobile-warehouse-title').evaluate(title=>({
      text:title.scrollWidth,width:title.clientWidth,height:title.clientHeight,line:parseFloat(getComputedStyle(title).lineHeight)
    }));
    assert.ok(size.text<=size.width && size.height<=Math.ceil(size.line),`Warehouse heading at ${width}px: ${JSON.stringify(size)}`);
  }
  assert.equal(await page.locator('#mobileToolsLogout').innerText(),'LOGOUT');
  assert.equal(await page.locator('#mobileToolsRefresh').count(),0);
  assert.equal(await page.locator('.mobile-user-line').innerText(),'กรธวัช จันทรวารี');
  const dot=page.locator('#mobileDataStatus');
  assert.equal(await dot.innerText(),'');
  assert.equal(await dot.getAttribute('aria-label'),'ออนไลน์');
  assert.equal(await dot.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(53, 168, 84)');
  assert.deepEqual(errors,[]);
  console.log('mobile login focus browser test passed');
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(async()=>{ await browser?.close(); server.close(); });
