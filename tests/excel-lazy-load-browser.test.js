const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.join(__dirname,'..');
let styledWriterCode;
let writerRequests=0;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
  if(pathname==='/vendor/product-excel-writer.js'){
    writerRequests++;
    response.writeHead(200,{'Content-Type':'text/javascript'}).end(styledWriterCode); return;
  }
  const file=path.join(root,pathname==='/'?'index.html':pathname.replace(/^\//,''));
  if(!file.startsWith(root)||!fs.existsSync(file)){ response.writeHead(404).end(); return; }
  response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});
let browser;
const executable=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync)||chromium.executablePath();
(async()=>{
  styledWriterCode=await (await import('../scripts/build-static.mjs')).buildProductExcelWriter();
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
  assert.equal(writerRequests,0,'styled writer must not load at startup or when merely opening Excel tools');
  await page.evaluate(()=>{
    window.XLSX={existingReader:true};
    products=[
      {id:1,sku:'001',name:'สินค้าปกติ',barcode:'000123',price:10,unit:'กล่อง'},
      {id:2,sku:'002',name:'สินค้ารอข้อมูล',dataReviewStatus:'pending',price:20,unit:'กล่อง'},
      {id:3,sku:'003',name:'สินค้าครบถ้วน',dataReviewStatus:'complete',price:30,unit:'กล่อง'},
    ];
    document.body.insertAdjacentHTML('beforeend','<button id="export-test" style="position:fixed;z-index:99999;top:0;left:0">ส่งออก Excel</button>');
    document.querySelector('#export-test').onclick=()=>invokeExcelTool('exportProductsToExcel');
  });
  const downloadPromise=page.waitForEvent('download');
  await page.click('#export-test');
  const download=await downloadPromise;
  assert.match(download.suggestedFilename(),/รายการสินค้า.*\.xlsx$/);
  const chunks=[];
  for await(const chunk of await download.createReadStream()) chunks.push(chunk);
  const writer=require('xlsx-js-style');
  const saved=writer.read(Buffer.concat(chunks),{type:'buffer',cellStyles:true}).Sheets['สินค้า'];
  assert.equal(saved.C1.v,'สถานะสินค้า');
  assert.equal(saved.C2.v,'สีปกติ - ยังไม่กำหนดสถานะ');
  assert.equal(saved.A2.s.patternType,'none');
  assert.equal(saved.A3.s.fgColor.rgb,'FFF8E1');
  assert.equal(saved.A4.s.fgColor.rgb,'EFF9F1');
  assert.equal(saved.I2.v,'000123','download must retain barcode leading zeroes');
  assert.equal(await page.evaluate(()=>window.XLSX.existingReader),true,'styled writer must not replace the import reader');
  await page.evaluate(()=>ensureProductExcelWriterLoaded());
  assert.equal(writerRequests,1,'repeat exports reuse the writer');
  assert.deepEqual(errors,[]);
  console.log('Excel lazy-load browser tests passed');
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(async()=>{ await browser?.close(); server.close(); });
