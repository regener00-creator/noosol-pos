const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:950},serviceWorkers:'block'});
  page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('purchaseorder');
    renderLoginState=()=>true;renderSidebar=()=>{};ensureOnDemandDataForTab=()=>({status:'ready'});
    isMobileDeviceMode=()=>false;canAccessTab=()=>true;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    document.getElementById('appRoot').hidden=false;
    currentProfile={id:'test',owner:true,level:1};warehouses=[{id:1,name:'Test'}];activeWarehouseId=1;
    notesLoaded=true;notes=[];contacts=[{id:1,name:'ลูกค้าทดสอบ',phone:'0812345678',types:['customer']}];products=[];
    currentTab='notes';render();
  });
  assert.equal(await page.locator('.notes-page-head h1').textContent(),'NOTE • พื้นที่จดบันทึกสำหรับร้าน');
  assert.equal(await page.locator('.notes-page-head p').count(),0);
  fs.mkdirSync(path.join(root,'outputs'),{recursive:true});
  await page.screenshot({path:path.join(root,'outputs/ui-copy-notes.png')});
  await page.evaluate(()=>{currentTab='cashshift';currentCashShift=null;cashShifts=[];render();});
  assert.equal(await page.locator('.cash-shift-money-field span').textContent(),'เงินทอนตั้งต้น');
  await page.locator('#cashShiftOpeningCash').fill('1234.50');
  assert.equal(await page.locator('#cashShiftOpeningCash').inputValue(),'1234.50');
  for(const selector of ['.cash-shift-money-field','#cashShiftOpeningCash']) assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).textAlign),'center');
  await page.screenshot({path:path.join(root,'outputs/ui-copy-cashshift.png')});
  await page.evaluate(()=>{currentTab='history';salesHistory=[];document.getElementById('main').innerHTML=renderHistory();});
  const alignments=await page.locator('.history-table thead th').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).textAlign));
  assert.ok(alignments.length>0&&alignments.every(value=>value==='center'));
  for(const tab of ['purchaseorder','goodsreceipt','productreturn','quotation']){
    const html=await page.evaluate(tab=>{currentTab=tab;return documentProductScannerHtml();},tab);
    assert.ok(!html.includes('สแกนซ้ำเพื่อเพิ่มจำนวนในรายการเดิม'),tab);
    assert.ok(html.includes('docProductScanner')&&html.includes('docScanResults'));
  }
  await page.evaluate(()=>{currentTab='productexchange';editingProductExchangeId='new';productExchangeDraft=null;render();});
  const titles=await page.locator('.product-exchange-section-head h2').allTextContents();
  assert.deepEqual(titles,['สินค้าที่ส่งเปลี่ยน • ตัดออกจากสต๊อกเมื่อยืนยัน “ส่งไปเปลี่ยนแล้ว”','สินค้าที่ได้รับกลับ • รับคืนไม่ครบหรือรับเป็นสินค้าคนละตัวได้ · ระบบเพิ่มเฉพาะรายการและจำนวนที่ระบุ']);
  await page.screenshot({path:path.join(root,'outputs/ui-copy-exchange.png')});
  await page.evaluate(()=>{currentTab='checkout';openPOSCustomerPicker();});
  assert.equal(await page.locator('#posCustomerPickerTitle').textContent(),'เลือกสมาชิก');
  assert.equal(await page.locator('#posCustomerPickerSearch').getAttribute('placeholder'),'ค้นหาชื่อ-เบอร์โทร');
  assert.ok(!(await page.locator('.pos-customer-picker-modal').textContent()).includes('เลือกลูกค้าเพื่อใช้ราคาพิเศษ'));
  await page.locator('#posCustomerPickerSearch').fill('081234');
  assert.match(await page.locator('.pos-customer-picker-modal').textContent(),/ลูกค้าทดสอบ/);
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.ok(!source.includes('เว้นว่างช่องใดช่องหนึ่งหรือทั้งคู่ได้ = ไม่จำกัดช่วงเวลานั้น'));
  assert.ok(!source.includes('โปรโมชั่นจะมีผลเฉพาะตอนขายด้วยหน่วยนี้เท่านั้น'));
  assert.deepEqual(errors,[]);
  console.log('UI text/alignment passed: NOTE, cash input, history headers, four scanners, exchange headings, member search and promotion hints');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
