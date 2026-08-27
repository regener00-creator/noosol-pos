const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
  if (!file.startsWith(root) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});

let browser;

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
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
  await page.waitForFunction(() => typeof renderBusinessSettings === 'function');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    currentProfile={id:'browser-test',level:1,owner:true,firstName:'ทดสอบ'};
    businessSettings={...DEFAULT_BUSINESS_SETTINGS,name:'ร้าน <ทดสอบ>',vat:'ยังไม่จดภาษีมูลค่าเพิ่ม',branch:'head'};
    currentTab='settingsbusiness';
    document.getElementById('main').innerHTML=renderBusinessSettings();
    attachEvents();
    syncTopbarFormActions();
    document.querySelectorAll('.login-screen').forEach(screen=>{screen.style.display='none';});
  });

  assert.equal(await page.locator('#set_business_name').inputValue(), 'ร้าน <ทดสอบ>');
  assert.equal(await page.locator('#businessVatDateRow').isHidden(), true);
  assert.equal(await page.locator('#businessTaxBranchRow').isHidden(), true);
  assert.equal(await page.locator('#topbarFormActions #saveBusinessSettingsBtn').count(), 1);
  assert.equal(await page.locator('#main #saveBusinessSettingsBtn').count(), 0);

  await page.locator('#set_business_vat').selectOption('จดภาษีมูลค่าเพิ่มแล้ว');
  assert.equal(await page.locator('#businessVatDateRow').isVisible(), true);
  assert.equal(await page.locator('#businessTaxBranchRow').isVisible(), true);
  await page.locator('input[name="set_branch"][value="branch"]').check({force:true});
  assert.equal(await page.locator('#businessBranchFields').isVisible(), true);

  await page.screenshot({path:path.join(os.tmpdir(),'pepos-business-settings-browser.png'),fullPage:true});
  assert.deepEqual(errors, []);
  console.log('business settings browser tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
