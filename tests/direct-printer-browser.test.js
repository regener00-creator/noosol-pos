const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,process.env.PEPOS_TEST_BUILT?'../public':'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
  res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync)||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.addInitScript(()=>{window.__nativePrints=0;window.print=()=>window.__nativePrints++;try{localStorage.setItem('pepos_direct_printer_token_v1','a'.repeat(64));}catch{}});
  await context.route('https://**/*',route=>{
    const address=new URL(route.request().url());
    if(address.origin==='https://pepo-pharmacy.vercel.app'){
      if(address.pathname==='/sw.js')return route.fulfill({contentType:'text/javascript',body:'// Isolated test: do not cache fixtures.'});
      const file=path.resolve(root,'.'+(address.pathname==='/'?'/index.html':address.pathname));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../vercel.json')));
      const csp=config.headers.find(rule=>rule.source==='/(.*)').headers.find(header=>header.key==='Content-Security-Policy').value;
      return route.fulfill({body:fs.readFileSync(file),contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream',headers:{'Content-Security-Policy':csp}});
    }
    if(route.request().url().includes('/npm/@supabase/'))return route.fulfill({contentType:'text/javascript',body:"const query=new Proxy({}, {get(t,p){if(p==='then')return resolve=>resolve({data:null,error:null});return ()=>query;}});window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get(t,p){return p in t?t[p]:()=>query;}})};"});
    return route.fulfill({contentType:'text/css',body:''});
  });
  const settings={},jobs=new Map(),requests=[];let loseResponse=false,disconnected=false;
  await context.route('http://127.0.0.1:17839/**',async route=>{
    if(disconnected)return route.abort();
    assert.equal(route.request().headers().authorization,'Bearer '+'a'.repeat(64));
    const endpoint=new URL(route.request().url()).pathname,data=route.request().postDataJSON();let response;
    if(endpoint==='/printers')response={settings,printers:['Thermal','Office','Labels','Office New'].map(name=>({name,offline:false,isVirtual:false})).concat({name:'Microsoft Print to PDF',offline:false,isVirtual:true})};
    else if(endpoint==='/settings'){settings[data.kind]={printer:data.printer};response={settings};}
    else if(endpoint==='/print'){
      requests.push(data);
      if(!settings[data.kind])return route.fulfill({status:400,json:{error:'ยังไม่ได้เลือกเครื่องพิมพ์ประเภทนี้'}});
      if(!jobs.has(data.id))jobs.set(data.id,{id:data.id,state:'sent',message:'ส่งงานไปยัง '+settings[data.kind].printer+' แล้ว',printer:settings[data.kind].printer,kind:data.kind});
      if(loseResponse){loseResponse=false;return route.abort();}response=jobs.get(data.id);
    }else if(endpoint==='/job')response=jobs.get(data.id);
    else response={protocol:1,settings};
    await route.fulfill({json:response});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{
    await page.waitForFunction(()=>typeof render==='function'&&systemHasOwner!==null);
    await page.evaluate(async()=>{await ensurePageCodeLoaded('settingsprinter');systemHasOwner=true;currentProfile={id:'test-owner',owner:true,level:1};warehouses=[{id:1,name:'ทดสอบ',active:true}];activeWarehouseId=1;allWarehousesMode=false;currentTab='settingsprinter';recordPrintEvent=async()=>{};render();});
    await page.waitForFunction(()=>document.getElementById('directPrinter_receipt')?.disabled===false);
  };
  await page.goto('https://pepo-pharmacy.vercel.app/');await open();
  assert.match(await page.locator('.receipt-printer-heading').innerText(),/ตั้งค่าการพิมพ์/);
  assert.equal(await page.locator('[data-direct-printer]').count(),3);
  assert.equal(await page.locator('#directPrinter_a4 option[value="Microsoft Print to PDF"]').isDisabled(),true);
  for(const [kind,printer] of Object.entries({receipt:'Thermal',a4:'Office',barcode:'Labels'})){
    await page.locator('#directPrinter_'+kind).selectOption(printer);
    await page.locator(`[data-direct-printer="${kind}"] button[type="submit"]`).click();
    await page.waitForFunction(({kind,printer})=>document.querySelector(`[data-direct-printer="${kind}"] [data-printer-status]`).textContent==='บันทึกแล้ว: '+printer,{kind,printer});
  }
  await page.locator('#barcodePaperSize').selectOption('60x40');await page.locator('#barcodePaperForm button').click();
  const test=async kind=>{
    const opened=context.waitForEvent('page');await page.locator(`[data-test-direct="${kind}"]`).click();const popup=await opened;
    await popup.waitForFunction(()=>document.querySelector('[data-direct-print-status]')?.textContent.startsWith('ส่งงานไปยัง'));
    assert.equal(await popup.evaluate(()=>window.__nativePrints),0,'never use kiosk printer as a fallback');
    const request=requests.at(-1);assert.equal(request.kind,kind);assert.ok(!request.html.includes('<script')&&!request.html.includes('onclick='));
    await popup.close();return request;
  };
  await test('receipt');await test('a4');const label=await test('barcode');assert.equal(label.width,60);assert.equal(label.height,40);
  fs.writeFileSync(path.join(__dirname,'../outputs/direct-printer-app-fixtures.json'),JSON.stringify(requests.slice(0,3)));
  await page.locator('#directPrinter_a4').selectOption('Office New');await page.locator('[data-direct-printer="a4"] button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-direct-printer="a4"] [data-printer-status]').textContent==='บันทึกแล้ว: Office New');
  const changed=await test('a4');assert.equal(jobs.get(changed.id).printer,'Office New');
  await page.reload();await open();assert.equal(await page.locator('#directPrinter_a4').inputValue(),'Office New');assert.equal(await page.locator('#barcodePaperSize').inputValue(),'60x40');
  loseResponse=true;
  const opening=context.waitForEvent('page');await page.locator('[data-test-direct="a4"]').click();const failed=await opening;
  await failed.waitForFunction(()=>document.querySelector('[data-direct-print-status]')?.textContent.includes('ติดต่อ SAPURI Print ไม่ได้'));
  const first=requests.at(-1).id,count=jobs.size;
  await failed.getByRole('button',{name:'พิมพ์',exact:true}).click();
  await failed.waitForFunction(()=>document.querySelector('[data-direct-print-status]')?.textContent.startsWith('ส่งงานไปยัง'));
  assert.equal(requests.at(-1).id,first);assert.equal(jobs.size,count,'lost response does not duplicate accepted job');
  await failed.close();
  disconnected=true;const offlineOpening=context.waitForEvent('page');await page.locator('[data-test-direct="a4"]').click();const offline=await offlineOpening;
  await offline.waitForFunction(()=>document.querySelector('[data-direct-print-status]')?.textContent.includes('ติดต่อ SAPURI Print ไม่ได้'));
  assert.equal(await offline.evaluate(()=>window.__nativePrints),0);assert.equal(offline.isClosed(),false);await offline.close();disconnected=false;
  for(const width of [1440,900,700]){await page.setViewportSize({width,height:1100});assert.equal(await page.locator('.receipt-printer-page').evaluate(el=>el.scrollWidth>el.clientWidth),false);}
  await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(__dirname,'../outputs/printing-settings-v3.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('Direct printer browser integration passed: three routes, changes, persisted settings, no duplicate/fallback prints.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
