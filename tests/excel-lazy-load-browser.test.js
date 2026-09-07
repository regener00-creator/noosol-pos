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
  const page=await browser.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{}})}})};`}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof ensureExcelToolsLoaded==='function');
  assert.equal(await page.evaluate(()=>typeof window.exportProductsToExcel),'undefined','Excel tools must not load during startup');
  await page.evaluate(()=>ensureExcelToolsLoaded());
  assert.equal(await page.evaluate(()=>typeof window.exportProductsToExcel),'function','Excel tools must become available on demand');
  assert.deepEqual(errors,[]);
  console.log('Excel lazy-load browser tests passed');
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(async()=>{ await browser?.close(); server.close(); });
