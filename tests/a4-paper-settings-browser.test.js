const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,process.env.PEPOS_TEST_BUILT?'../public':'..');
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);});
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
 browser=await chromium.launch({headless:true,executablePath});const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];
 await installIsolatedBrowser(page);await context.addInitScript(()=>{window.print=()=>{window.printCalls=(window.printCalls||0)+1;};});
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await waitForIsolatedBootstrap(page);
 const setup=async()=>{await page.evaluate(async()=>{currentProfile={id:'test',owner:true,level:1};warehouses=[{id:1,name:'test',active:true}];activeWarehouseId=1;document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');renderLoginState=()=>true;canAccessTab=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});recordPrintEvent=()=>{window.saleWrites=(window.saleWrites||0)+1;};currentTab='settingsprinter';await ensurePageCodeLoaded(currentTab);render();});await page.locator('#a4PaperForm').waitFor();};
 await setup();assert.equal(await page.locator('[data-tab="settingsprinter"]').innerText(),'ตั้งค่าหน้ากระดาษ');
 await page.locator('#a4_orientation').selectOption('landscape');
 for(const [key,value] of Object.entries({marginTop:10,marginBottom:12,marginLeft:8,marginRight:9})) await page.locator('#a4_'+key).fill(String(value));
 await page.locator('#a4PaperForm button[type=submit]').click();assert.match(await page.locator('#a4PaperStatus').innerText(),/บันทึกแล้ว/);
 const saved=await page.evaluate(()=>localStorage.getItem('pepos_a4_paper_v1'));
 await page.reload();await waitForIsolatedBootstrap(page);await setup();assert.equal(await page.locator('#a4_marginTop').inputValue(),'10');assert.equal(await page.locator('#a4_orientation').inputValue(),'landscape');
 await page.locator('#a4_marginLeft').fill('99');await page.locator('#a4PaperForm button[type=submit]').click();assert.equal(await page.evaluate(()=>localStorage.getItem('pepos_a4_paper_v1')),saved);
 await page.locator('#a4_marginLeft').fill('8');
 // Unsaved test settings, rather than saved landscape settings, drive the sample.
 await page.locator('#a4_orientation').selectOption('portrait');
 const pp=context.waitForEvent('page');await page.locator('#testA4PaperBtn').click();const sample=await pp;await sample.waitForLoadState();
 assert.match(await sample.locator('style').allTextContents().then(s=>s.join('')),/size:A4 portrait/);
 await sample.getByRole('button',{name:'พิมพ์',exact:true}).click();assert.equal(await sample.evaluate(()=>printCalls),1);
 assert.equal(await page.evaluate(()=>window.saleWrites||0),0);assert.equal(await page.evaluate(()=>localStorage.getItem('pepos_receipt_printer_v1')),null);
 await sample.close();
 // Real quotation renderer, including its separate original/copy preview stylesheet.
 const quotationPromise=context.waitForEvent('page');
 await page.evaluate(async()=>{await ensurePageCodeLoaded('quotation');quotations=[{id:'QT-TEST',date:'2026-10-30',customer:{name:'ลูกค้าทดสอบ'},items:[{name:'สินค้าทดสอบ',qty:1,price:100,lineTotal:100,unit:'กล่อง'}],total:100}];printQuotation('QT-TEST');});
 const quote=await quotationPromise;await quote.waitForLoadState();assert.equal(await quote.locator('.a4-configured-page').count(),1);
 assert.ok(Math.abs((await quote.locator('.page').boundingBox()).width-297*96/25.4)<1);
 await quote.locator('#confirmDocumentPrint').click();assert.equal(await quote.locator('.a4-configured-page').count(),2,'copies retain configured layout');
 await quote.emulateMedia({media:'print'});
 const pdf=await quote.pdf({preferCSSPageSize:true});const pdfText=pdf.toString('latin1');
 assert.equal((pdfText.match(/\/Type\s*\/Page\b/g)||[]).length,2,'one physical A4 page per copy, no extra blank pages');
 assert.match(pdfText,/\/MediaBox\s*\[0 0 84[12][.\d]* 59[45][.\d]*\]/,'landscape A4 dimensions');
 await quote.close();
 const taxPromise=context.waitForEvent('page');
 await page.evaluate(()=>{persistStandaloneTaxInvoices=()=>{};standaloneTaxInvoices=[{number:'TAX-TEST',saleDate:'2026-10-30',customer:{name:'ทดสอบ'},items:[{name:'สินค้า',qty:1,price:100,lineTotal:100,unit:'ชิ้น'}],total:100}];printFullTaxInvoice('TAX-TEST');});
 const tax=await taxPromise;await tax.waitForLoadState();await tax.locator('#confirmTaxPrint').click();assert.equal(await tax.locator('.a4-configured-page').count(),2);
 const taxPdf=await tax.pdf({preferCSSPageSize:true});assert.equal((taxPdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,2,'tax invoice copies use the same page settings');await tax.close();
 // Body-based reports keep their landscape default in auto mode. Rolls are untouched.
 assert.deepEqual(await page.evaluate(()=>{
  const iframe=document.createElement('iframe');document.body.appendChild(iframe);const win=iframe.contentWindow;
  win.document.write('<style>@page{size:A4 landscape;margin:14mm}</style><body><h1>รายงาน</h1></body>');win.document.close();applyA4PaperLayout(win,{orientation:'auto'});
  const report=win.document.getElementById('a4PaperLayout').textContent.includes('size:A4 landscape');
  win.document.open();win.document.write('<style>@page{size:80mm auto;margin:0}</style><div class="receipt">ใบเสร็จ</div>');win.document.close();const receipt=applyA4PaperLayout(win);iframe.remove();return [report,receipt];
 }),[true,false]);
 await page.locator('#resetA4PaperBtn').click();assert.equal(await page.locator('#a4_marginTop').inputValue(),'15');assert.equal(await page.evaluate(()=>localStorage.getItem('pepos_a4_paper_v1')),saved);
 await page.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,v){if(key==='pepos_a4_paper_v1')throw Error('full');return window.originalSet.call(this,key,v);};});
 await page.locator('#a4PaperForm button[type=submit]').click();assert.match(await page.locator('#a4PaperStatus').innerText(),/บันทึกไม่สำเร็จ/);await page.evaluate(()=>{Storage.prototype.setItem=window.originalSet;});
 for(const width of [1440,700]){await page.setViewportSize({width,height:1050});assert.equal(await page.locator('.receipt-printer-page').evaluate(el=>el.scrollWidth>el.clientWidth),false);}
 await page.setViewportSize({width:1440,height:1050});fs.mkdirSync(path.join(root,'outputs'),{recursive:true});await page.locator('.a4-paper-settings').screenshot({path:path.join(root,'outputs/a4-paper-settings.png')});
 assert.deepEqual(errors,[]);console.log('A4 settings: save/reload, validation, unsaved sample, receipt isolation, quotation/copies/PDF paper size, landscape reports, reset, storage failure, responsive layout passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
