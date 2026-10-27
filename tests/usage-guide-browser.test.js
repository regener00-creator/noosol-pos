const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..',process.env.PEPOS_TEST_STATIC==='1'?'public':'');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
  if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});

let browser;
const browserExecutable = [
  process.env.PEPOS_BROWSER_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบหน้าเว็บ');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route(url=>url.pathname==='/vendor/supabase.js'||(url.hostname==='cdn.jsdelivr.net'&&url.pathname.startsWith('/npm/@supabase/')), route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const query=new Proxy({}, {get(_target,property){
        if(property==='then') return resolve=>resolve({data:null,error:null});
        return ()=>query;
      }});
      window.supabase={createClient:()=>new Proxy({
        auth:{
          getSession:async()=>({data:{session:null}}),
          onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
          signOut:async()=>({error:null})
        }
      }, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof ensurePageCodeLoaded === 'function');
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
    currentProfile={id:'usage-test',owner:true,level:1,firstName:'ทดสอบ'};
    activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ'}];products=[];
    renderLoginState=()=>true;
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    document.getElementById('appRoot').style.display='';
    renderSidebar();
  });
  await page.locator('.navbtn[data-tab="usage"]').click();
  await page.waitForSelector('.usage-guide-page');
  const articleCount=await page.locator('[data-usage-article]').count();
  assert.ok(articleCount>=37,'all pages and related workflows are documented');
  assert.equal(await page.locator('#usageGuideCount').textContent(),`พบ ${articleCount} หัวข้อ`);
  const search=page.locator('#usageGuideSearch');
  await search.fill('ส่งไปเปลี่ยนแล้ว');
  assert.equal(await page.locator('[data-usage-article="productexchange"]').count(),1,'search includes steps inside articles');
  assert.equal(await page.locator('[data-usage-article="productexchange"]').getAttribute('open'),'');
  assert.equal(await search.evaluate(el=>el===document.activeElement),true,'typing keeps search focus');
  await search.fill('lot รับเข้า');
  assert.equal(await page.locator('[data-usage-article="goodsreceipt"]').count(),1,'English search is case-insensitive and supports multiple words');
  await page.locator('.usage-guide-search [data-usage-reset]').click();
  await page.locator('[data-usage-group="รายงาน"]').click();
  assert.equal(await page.locator('[data-usage-article]').count(),8);
  assert.equal(await page.locator('[data-usage-group="รายงาน"]').getAttribute('aria-pressed'),'true');
  await search.fill('คำค้นที่ไม่มีอยู่xyz');
  assert.equal(await page.locator('.usage-guide-empty').isVisible(),true);
  await page.locator('.usage-guide-empty [data-usage-reset]').click();
  assert.equal(await page.locator('[data-usage-article]').count(),articleCount);
  await search.fill('"><img src=x onerror=alert(1)>');
  assert.equal(await page.locator('.usage-guide-page img').count(),0,'search text never becomes HTML');
  await page.locator('.usage-guide-search [data-usage-reset]').click();
  await page.locator('[data-usage-group="คลังและสินค้า"]').click();
  const category=page.locator('[data-usage-article="settingscategories"]');
  await category.locator('summary').click();
  assert.equal(await category.locator('ol').isVisible(),true,'each topic expands to numbered steps');
  await page.screenshot({path:path.join(os.tmpdir(),'sapuri-usage-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>render());
  assert.equal(await page.evaluate(()=>currentTab),'usage','mobile renderer keeps the guide open');
  assert.equal(await page.locator('#usageGuideMobileBack').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'guide fits mobile without horizontal scrolling');
  await page.screenshot({path:path.join(os.tmpdir(),'sapuri-usage-mobile.png'),fullPage:true});
  await page.locator('#usageGuideMobileBack').click();
  assert.equal(await page.evaluate(()=>currentTab),'mobiletools');
  await page.locator('[data-open-usage-guide]').click();
  await page.waitForSelector('.usage-guide-page');
  assert.equal(await page.evaluate(()=>currentTab),'usage','mobile help button returns to the guide');
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{
    currentProfile={id:'usage-staff',owner:false,level:2,firstName:'พนักงาน'};
    pagePermissionRows=[{page_key:'dashboard',can_view:true}];
    render();
  });
  assert.equal(await page.locator('.navbtn[data-tab="usage"]').isVisible(),true,'staff can read help independently of task permissions');
  assert.equal(await page.locator('.navbtn[data-tab="settingsusers"]').count(),0,'help access does not grant administrator permissions');
  await page.evaluate(()=>{allWarehousesMode=true;render();});
  assert.equal(await page.evaluate(()=>currentTab),'usage','help remains accessible in the all-warehouses view');
  assert.deepEqual(errors,[]);
  console.log(`Usage guide passed: ${articleCount} topics, search, filters, keyboard focus, desktop/mobile navigation and access`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
