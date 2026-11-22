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
  page.on('pageerror',error=>errors.push(error.message));
  await installIsolatedBrowser(page);
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());
    document.getElementById('appRoot').hidden=false;
    renderLoginState=()=>true;
  });
  for(const store of [1,2]){
    for(const width of [360,390,430]){
      await page.setViewportSize({width,height:844});
      await page.evaluate(store=>{
        activeWarehouseId=store;
        currentProfile={id:'test-owner',owner:true,level:1};
        currentTab='barcodeprint';
        mobileToolMode='price';
        render();
      },store);
      assert.equal(await page.evaluate(()=>currentTab),'mobiletools');
      assert.equal(await page.locator('#mobilePriceInput').isVisible(),true);
      assert.equal(await page.getByRole('button',{name:/ป้ายโปรโมชั่น/}).count(),0);
      await page.locator('[data-mobile-tool="inventory"]').click();
      assert.equal(await page.locator('.mobile-inventory-steps').isVisible(),true);
      assert.equal(await page.getByRole('button',{name:/ป้ายโปรโมชั่น/}).count(),0);
      await page.locator('[data-mobile-tool="price"]').click();
      assert.equal(await page.locator('#mobilePriceInput').isVisible(),true);
    }
  }
  assert.deepEqual(errors,[]);
  console.log('Mobile price and inventory menus verified without promotion labels in both stores');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
