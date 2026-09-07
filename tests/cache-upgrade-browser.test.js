const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=source.indexOf('function openProductCacheDb(');
const code=source.slice(start,source.indexOf('async function loadProductCacheFromIndexedDB(',start));
const server=http.createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Cache upgrade test</title><main>Cache test</main>'));
const executable=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync)||chromium.executablePath();
let browser;
async function install(page,version){
  await page.addScriptTag({content:`let productCacheDbPromise=null;
    const PRODUCT_CACHE_DB_NAME='pepos-upgrade-regression',PRODUCT_CACHE_DB_VERSION=${version};
    const PRODUCT_CACHE_PRODUCTS_STORE='products',PRODUCT_CACHE_META_STORE='meta',PRODUCT_CACHE_WORKSPACE_STORE='workspace';
    const notices=[];function showToast(message){notices.push(message);}
    ${code}
    window.cacheResult='pending';openProductCacheDb().then(db=>{window.cacheResult='ready';window.cacheConnection=db;},error=>{window.cacheResult=error.message;});`});
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:executable});
  const context=await browser.newContext();const old=await context.newPage(),next=await context.newPage();
  const url=`http://127.0.0.1:${server.address().port}/`;
  await old.goto(url);await next.goto(url);
  await old.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('pepos-upgrade-regression',1);
    request.onsuccess=()=>{window.oldConnection=request.result;resolve();};request.onerror=()=>reject(request.error);
  }));
  await install(next,2);
  await next.waitForFunction(()=>notices.length===1);
  assert.equal(await next.evaluate(()=>window.cacheResult),'pending');
  await old.evaluate(()=>window.oldConnection.close());
  await next.waitForFunction(()=>window.cacheResult==='ready');
  assert.equal(await next.evaluate(()=>window.cacheConnection.version),2);
  const latest=await context.newPage();await latest.goto(url);await install(latest,3);
  await latest.waitForFunction(()=>window.cacheResult==='ready');
  assert.equal(await latest.evaluate(()=>window.cacheConnection.version),3);
  assert.equal(await next.evaluate(()=>productCacheDbPromise),null,'versionchange must release the older app connection');
  console.log('cache upgrade browser tests passed (blocked upgrade and automatic versionchange close)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
