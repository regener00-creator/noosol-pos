const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg'};
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบตัวออกแบบป้ายราคา');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const query=new Proxy({}, {get(_target,property){
        if(property==='then') return resolve=>resolve({data:null,error:null});
        return ()=>query;
      }});
      window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}}, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof openPriceLabelDesigner === 'function');
  await page.evaluate(() => {
    document.querySelectorAll('.login-screen').forEach(screen => { screen.style.display='none'; });
    currentProfile={id:'owner-test',owner:true,firstName:'เจ้าของ',lastName:'ร้าน'};
    products=[{id:9001,sku:'P-9001',name:'Decolgen prin (4 tablets)',unit:'กล่อง',barcode:'8851824336354',price:180,units:[],extraBarcodes:[],vendorBarcodes:[]}];
    barcodePrintItems=[{pid:9001,unit:'กล่อง',barcode:'8851824336354',qty:1}];
    barcodePrintLabelSize='50x30';
    // Keep background data sync from changing fixtures while PDF pagination is checked.
    clearTimeout(supabaseCoreSyncTimer);
    scheduleSupabaseCoreSync=()=>{};
    businessSettings={...businessSettings,priceLabelTemplates:{},priceLabelTemplateLibraries:{}};
    render=()=>{main.innerHTML=renderBarcodePrint();attachEvents();};
    render();
  });

  assert.equal(await page.locator('[data-barcode-print-mode]').count(),2);
  assert.equal(await page.locator('#barcodePrintSearch').count(),0);
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    const cards=await page.locator('.barcode-print-mode-card').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,viewport:innerWidth};}));
    assert.ok(cards.every(card=>card.left>=0&&card.right<=card.viewport));
    assert.equal(cards[0].top===cards[1].top,width===1280,'Two columns on desktop, stacked on mobile');
  }
  await page.setViewportSize({width:1280,height:900});
  await page.locator('[data-barcode-print-mode="new"]').click();
  assert.match(await page.locator('.barcode-print-page h1').textContent(),/พิมพ์ป้ายราคาใหม่/);
  assert.equal(await page.locator('#barcodePrintLabelType').count(),0);
  assert.equal(await page.locator('#barcodePrintLabelSize').inputValue(),'50x30');
  await page.locator('#barcodePrintLabelSize').selectOption('a4-50x30');
  await page.locator('#savePriceLabelDefaultBtn').click();
  assert.equal(await page.evaluate(()=>readPriceLabelDefaultSize()),'a4-50x30');
  assert.match(await page.locator('.page-title-meta').textContent(),/50 × 30 มม\./);
  assert.equal(await page.locator('#openPriceLabelDesignerBtn').isVisible(), true);
  await page.locator('#openPriceLabelDesignerBtn').click();
  assert.equal(await page.locator('.price-label-designer-modal').isVisible(), true);
  assert.equal(await page.locator('[data-price-label-tab]').count(), 5);
  assert.equal(await page.locator('.price-label-design-element').count(), 5);
  for(const field of ['name','unit','price','barcode','code']){
    await page.locator(`[data-price-label-toggle="${field}"]`).uncheck();
    assert.equal(await page.locator(`#priceLabelDesignerCanvas [data-price-label-element="${field}"]`).count(),0);
  }
  assert.equal(await page.locator('.price-label-design-element').count(),0);
  for(const field of ['name','unit','price','barcode','code']){
    await page.locator(`[data-price-label-toggle="${field}"]`).check();
    assert.equal(await page.locator(`#priceLabelDesignerCanvas [data-price-label-element="${field}"]`).isVisible(),true);
  }
  assert.match(await page.locator('.price-label-safety-note').textContent(), /24 × 6 มม\./);
  assert.match(await page.locator('.price-label-safety-note').textContent(), /32 × 8 มม\./);
  const ratio = await page.locator('#priceLabelDesignerCanvas').evaluate(element => {
    const rect=element.getBoundingClientRect();
    return rect.width/rect.height;
  });
  assert.ok(Math.abs(ratio-(5/3))<0.02, 'พื้นที่ออกแบบต้องเป็นสัดส่วน 50 × 30 มม.');

  await page.locator('#priceLabelPresetSelect').selectOption('center');
  await page.locator('[data-price-label-tab="price"]').click();
  const priceX = page.locator('[data-price-label-field="x"]');
  await priceX.fill('7');
  await priceX.press('Tab');
  const fontSize = page.locator('[data-price-label-field="fontSize"]');
  await fontSize.fill('96');
  await fontSize.press('Tab');
  assert.equal(await fontSize.inputValue(),'96');
  const previewTypography = await page.locator('[data-price-label-element="price"]').evaluate((element) => {
    const canvas=element.closest('#priceLabelDesignerCanvas');
    return {fontSize:parseFloat(getComputedStyle(element).fontSize),canvasWidth:canvas.getBoundingClientRect().width};
  });
  const expectedPreviewFontSize=96*previewTypography.canvasWidth*25.4/(72*50);
  assert.ok(Math.abs(previewTypography.fontSize-expectedPreviewFontSize)<1, 'ขนาดตัวอักษรในตัวออกแบบต้องตรงตามสเกลกระดาษจริง');
  assert.deepEqual(await page.locator('[data-price-label-color]').evaluateAll(elements => elements.map(element => element.value)), ['#000000','#e60012']);
  await page.locator('[data-price-label-color][value="#000000"]').evaluate(element => { element.checked=true; element.dispatchEvent(new Event('change',{bubbles:true})); });
  assert.equal((await page.locator('.price-label-reverse-toggle').textContent()).trim(),'REVERSE TYPE');
  await page.locator('[data-price-label-reverse]').evaluate(element => { element.checked=true; element.dispatchEvent(new Event('change',{bubbles:true})); });
  await page.locator('#addPriceLabelCustomTextBtn').click();
  assert.equal(await page.locator('[data-price-label-tab]').count(), 6);
  const customToggle=page.locator('[data-price-label-toggle^="custom:"]');
  await customToggle.uncheck();
  assert.equal(await page.locator('#priceLabelDesignerCanvas [data-price-label-element^="custom:"]').count(),0);
  await customToggle.check();
  await page.locator('[data-price-label-custom-value]').fill('SALE -15%');
  await page.locator('[data-price-label-custom-value]').press('Tab');
  await page.locator('[data-price-label-color][value="#e60012"]').evaluate(element => { element.checked=true; element.dispatchEvent(new Event('change',{bubbles:true})); });
  await page.locator('[data-price-label-reverse]').evaluate(element => { element.checked=true; element.dispatchEvent(new Event('change',{bubbles:true})); });
  await page.locator('[data-price-label-tab="barcode"]').click();
  const barcodeWidth = page.locator('[data-price-label-field="width"]');
  await barcodeWidth.fill('10');
  await barcodeWidth.press('Tab');
  assert.ok(Number(await barcodeWidth.inputValue())>=48, 'ป้าย 50 มม. ต้องบังคับบาร์โค้ดกว้างอย่างน้อย 24 มม.');
  assert.ok((await page.locator('.price-label-barcode-limit').getAttribute('class')).includes('warning'));
  await page.locator('[data-price-label-tab="unit"]').click();
  await page.locator('[data-price-label-visible]').uncheck();
  assert.equal(await page.locator('[data-price-label-toggle="unit"]').isChecked(),false);
  assert.equal(await page.locator('#priceLabelDesignerCanvas [data-price-label-element="unit"]').count(),0);
  await page.locator('[data-price-label-toggle="unit"]').check();
  assert.equal(await page.locator('[data-price-label-visible]').isChecked(),true);
  await page.locator('[data-price-label-toggle="unit"]').uncheck();
  assert.equal(await page.locator('[data-price-label-visible]').isChecked(),false);
  assert.ok((await page.locator('[data-price-label-tab="unit"]').getAttribute('class')).includes('off'));
  await page.locator('#priceLabelTemplateNameInput').fill('แม่แบบแดง');
  await page.locator('#saveAsNewPriceLabelTemplateBtn').click();
  await page.locator('#priceLabelTemplateNameInput').fill('แม่แบบสำเนา');
  await page.locator('#saveAsNewPriceLabelTemplateBtn').click();
  assert.equal(await page.locator('#savedPriceLabelTemplateSelect option').count(),2);
  const libraryBeforeUse = await page.evaluate(() => businessSettings.priceLabelTemplateLibraries['50x30']);
  assert.equal(libraryBeforeUse.templates.length,2);
  assert.equal(libraryBeforeUse.activeId,libraryBeforeUse.templates[0].id);
  await page.locator('#savedPriceLabelTemplateSelect').selectOption(libraryBeforeUse.templates[0].id);
  await page.locator('#savePriceLabelDesignerBtn').click();
  await page.waitForSelector('.price-label-designer-modal',{state:'detached'});

  const saved = await page.evaluate(() => businessSettings.priceLabelTemplates['50x30']);
  assert.equal(saved.preset,'custom');
  assert.equal(saved.elements.price.x,7);
  assert.equal(saved.elements.price.fontSize,96);
  assert.equal(saved.elements.price.color,'#000000');
  assert.equal(saved.elements.price.reverse,true);
  assert.equal(saved.elements.unit.visible,false);
  const printedFields=await page.evaluate(()=>{
    const markup=priceLabelRegularHtml({unit:'กล่อง',barcode:'8851824336354'},products[0],{price:180},'50x30');
    const root=document.createElement('div');root.innerHTML=markup;
    return [...root.querySelectorAll('[data-price-label-element]')].map(el=>el.dataset.priceLabelElement);
  });
  assert.deepEqual(printedFields,['name','price','barcode','code'],'printing omits the same field hidden in the designer');
  assert.ok(saved.elements.barcode.width>=48);
  assert.equal(saved.customTexts.length,1);
  assert.equal(saved.customTexts[0].text,'SALE -15%');
  assert.equal(saved.customTexts[0].color,'#e60012');
  assert.equal(saved.customTexts[0].reverse,true);
  const savedLibrary = await page.evaluate(() => businessSettings.priceLabelTemplateLibraries['50x30']);
  assert.equal(savedLibrary.templates.length,2);
  assert.equal(savedLibrary.activeId,savedLibrary.templates[0].id);

  await page.locator('#openPriceLabelDesignerBtn').click();
  assert.equal(await page.locator('#savedPriceLabelTemplateSelect option').count(),2);
  assert.equal(await page.locator('[data-price-label-toggle="unit"]').isChecked(),false);
  assert.equal(await page.locator('#priceLabelDesignerCanvas [data-price-label-element="unit"]').count(),0);
  await page.locator('[data-price-label-tab="price"]').click();
  assert.equal(await page.locator('[data-price-label-field="x"]').inputValue(),'7');
  assert.equal(await page.locator('[data-price-label-color][value="#000000"]').isChecked(),true);
  assert.equal(await page.locator('[data-price-label-reverse]').isChecked(),true);
  await page.locator('[data-price-label-tab]').filter({hasText:'ข้อความ 1'}).click();
  assert.equal(await page.locator('[data-price-label-custom-value]').inputValue(),'SALE -15%');

  await page.locator('.price-label-designer-modal .modal-close').click();
  await page.evaluate(() => {
    currentTab='barcodeprint';
    products=[
      {id:9101,sku:'FULL',name:'ทดสอบครบแล้ว',category:'ยา',brand:'แบรนด์',unit:'กล่อง',barcode:'FULL-001',units:[]},
      {id:9102,sku:'EMPTY',name:'ทดสอบไม่มีบาร์โค้ด',category:'ยา',brand:'แบรนด์',unit:'กล่อง',barcode:'',units:[]},
      {id:9103,sku:'MIXED',name:'ทดสอบขาดบางหน่วย',category:'ยา',brand:'แบรนด์',unit:'กล่อง',barcode:'MAIN-003',units:[{sub:'แผง',barcode:''}]},
      {id:9104,sku:'INACTIVE',name:'ทดสอบเลิกใช้',category:'ยา',brand:'แบรนด์',unit:'กล่อง',barcode:'',active:false,units:[]},
    ];
    categories=['ยา']; brands=['แบรนด์'];
    barcodePrintItems=[{pid:9101,unit:'กล่อง',barcode:'FULL-001',qty:1}];
    barcodePrintCatFilter={category:'',brand:''};
    barcodePrintSearchQuery='';
    // Keep this fixture isolated from login and remote-data routing.
    render=()=>{main.innerHTML=renderBarcodePrint();attachEvents();};
    render();
  });
  assert.equal(await page.locator('[data-barcode-print-row]').count(),0,'Old queued barcoded units are removed on render');
  await page.locator('#barcodePrintSearch').fill('ทดสอบ');
  assert.equal(await page.locator('[data-barcode-print-result]').count(),2);
  await page.locator('#barcodePrintSearch').fill('FULL');
  await page.locator('#barcodePrintSearch').press('Enter');
  assert.equal(await page.evaluate(()=>barcodePrintItems.length),0,'Enter must not bypass the missing-barcode filter');
  await page.locator('#barcodePrintSearch').fill('EMPTY');
  await page.locator('#barcodePrintSearch').press('Enter');
  assert.deepEqual(await page.evaluate(()=>barcodePrintItems.map(item=>item.pid)),[9102]);
  await page.locator('#barcodePrintCategorySelect').selectOption('ยา');
  assert.match(await page.locator('#barcodePrintAddCategoryBtn').textContent(),/\(2\)/);
  await page.locator('#barcodePrintAddCategoryBtn').click();
  assert.equal(await page.locator('#barcodePickList input').count(),2);
  await page.locator('#barcodePickAllBtn').click();
  assert.equal(await page.locator('#barcodePickList input:checked').count(),2);
  await page.locator('#barcodePickNoneBtn').click();
  assert.equal(await page.locator('#barcodePickList input:checked').count(),1,'Clear preserves the disabled item already in the queue');
  await page.addStyleTag({content:'.btn{transition:none!important}'});
  await page.mouse.move(0,0);
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    const buttons=await page.evaluate(()=>{
      const all=document.getElementById('barcodePickAllBtn');
      const none=document.getElementById('barcodePickNoneBtn');
      return {all:all.getBoundingClientRect().x,none:none.getBoundingClientRect().x,background:getComputedStyle(all).backgroundColor,color:getComputedStyle(all).color};
    });
    assert.ok(buttons.none<buttons.all,'ไม่เลือกเลย must be left of เลือกทั้งหมด');
    assert.equal(buttons.background,'rgb(79, 64, 56)');
    assert.equal(buttons.color,'rgb(255, 255, 255)');
  }
  await page.locator('#barcodePickCancelBtn').click();
  await page.locator('#barcodePrintAddMissingBtn').click();
  assert.equal(await page.locator('#barcodePickList input').count(),2);
  await page.locator('#barcodePickCancelBtn').click();
  await page.setViewportSize({width:1280,height:900});
  await page.locator('#barcodePrintSearch').fill('MIXED');
  await page.locator('#barcodePrintSearch').press('Enter');
  assert.equal(await page.locator('[data-barcode-print-row="1"] select').count(),0,'One printable unit is plain text without a dropdown');
  assert.equal(await page.locator('[data-barcode-print-row="1"] .barcode-print-unit-label').textContent(),'แผง');
  await page.evaluate(()=>{
    products.find(product=>product.id===9103).units.push({sub:'ลัง',barcode:''});
    render();
  });
  assert.deepEqual(await page.locator('[data-barcode-print-unit="1"] option').allTextContents(),['แผง','ลัง']);
  await page.locator('[data-barcode-print-unit="1"]').evaluate(select=>{
    select.add(new Option('กล่อง','กล่อง')); select.value='กล่อง';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  assert.equal(await page.locator('[data-barcode-print-unit="1"]').inputValue(),'แผง','A forged or stale unit cannot select an existing barcode');
  assert.deepEqual(await page.locator('[data-barcode-print-unit="1"] option').allTextContents(),['แผง','ลัง']);
  await page.evaluate(()=>{
    products.find(product=>product.id===9103).units[0].barcode='CREATED-ELSEWHERE';
    render();
  });
  assert.deepEqual(await page.evaluate(()=>barcodePrintItems.map(item=>item.pid)),[9102],'A unit assigned a barcode after selection is removed');

  // Reprints use existing unit codes without changing products or allocating numbers.
  await page.context().route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  await page.context().addInitScript(()=>{window.print=()=>{};});
  const beforeReprint=await page.evaluate(()=>{
    localStorage.setItem(A4_PAPER_STORAGE_KEY,JSON.stringify({orientation:'landscape',marginTop:40,marginBottom:40,marginLeft:40,marginRight:40}));
    window.reprintRpcCalls=[];
    window.issuedFixture=[{pid:9101,barcode:'FULL-001'},{pid:9103,barcode:'CREATED-ELSEWHERE'},{pid:9103,barcode:'CHANGED'}];
    sb.rpc=async(name)=>{if(name==='system_issued_label_codes') return {data:window.issuedFixture,error:null};window.reprintRpcCalls.push(name);throw new Error('Reprint must not call a write RPC');};
    products.push({id:9105,sku:'MANUAL',name:'Imported internal-looking barcode',category:'ยา',brand:'แบรนด์',unit:'กล่อง',barcode:'P00000000099',units:[]});
    return JSON.stringify({products,barcodePrintItems});
  });
  await page.locator('#barcodePrintMenuBtn').click();
  await page.locator('[data-barcode-print-mode="reprint"]').click();
  assert.equal(await page.locator('#openBarcodeReprintBtn').count(),0);
  assert.equal(await page.locator('#barcodePrintMenuBtn').isVisible(),true);
  assert.equal(await page.locator('#savePrintBarcodeBtn').isDisabled(),true);
  assert.equal(await page.locator('#barcodePrintLabelSize').inputValue(),'50x30','New-label default does not overwrite repeat default');
  await page.locator('#barcodePrintLabelSize').selectOption('a4-50x30');
  await page.locator('#savePriceLabelDefaultBtn').click();
  await page.locator('#barcodePrintSearch').fill('EMPTY');
  assert.equal(await page.locator('[data-barcode-print-result]').count(),0);
  await page.locator('#barcodePrintSearch').fill('FULL');
  await page.locator('#barcodePrintSearch').press('Enter');
  assert.equal(await page.locator('[data-barcode-print-code="0"]').inputValue(),'FULL-001');
  assert.equal(await page.locator('[data-barcode-print-code="0"]').getAttribute('readonly'),'');
  assert.equal(await page.locator('[data-barcode-print-unit="0"]').count(),0);
  await page.locator('#barcodePrintCategorySelect').selectOption('ยา');
  await page.locator('#barcodePrintAddCategoryBtn').click();
  assert.equal(await page.locator('#barcodePickList input').count(),2,'Only active products with existing unit codes are offered');
  assert.equal(await page.locator('#barcodePickList input:disabled').count(),1,'Already queued product is not added twice');
  await page.locator('#barcodePickAllBtn').click();
  await page.locator('#barcodePickNoneBtn').click();
  assert.equal(await page.locator('#barcodePickList input:checked:not(:disabled)').count(),0);
  await page.locator('#barcodePickAllBtn').click();
  await page.locator('#barcodePickAddBtn').click();
  assert.equal(await page.locator('[data-barcode-print-row]').count(),2);
  assert.equal(await page.locator('[data-barcode-print-unit="1"]').count(),0,'Manufacturer barcode unit is excluded');
  assert.equal(await page.locator('[data-barcode-print-code="1"]').inputValue(),'CREATED-ELSEWHERE');
  await page.locator('[data-barcode-print-qty="0"]').fill('35');
  await page.locator('[data-barcode-print-qty="1"]').fill('2');
  const [printed]=await Promise.all([page.waitForEvent('popup'),page.locator('#savePrintBarcodeBtn').click()]);
  await printed.waitForSelector('.label');
  assert.equal(await printed.locator('.label').count(),37);
  assert.equal(await printed.locator('.label-sheet').count(),2);
  assert.equal(await printed.locator('.label-cut-cell').count(),72);
  assert.equal(await printed.locator('.label-sheet').nth(0).locator('.label').count(),36);
  assert.equal(await printed.locator('.label-sheet').nth(1).locator('.label').count(),1);
  assert.equal(await printed.locator('[data-price-label-element="unit"]').count(),0,'Uses the saved 50 × 30 template visibility');
  assert.match(await printed.locator('body').textContent(),/SALE -15%/);
  const geometry=await printed.locator('.label-sheet').first().evaluate(sheet=>{
    const cells=Array.from(sheet.querySelectorAll('.label-cut-cell')).map(cell=>{const r=cell.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
    return {cells,cut:getComputedStyle(sheet.querySelector('.label-cut-cell'),'::after').borderTopStyle};
  });
  assert.ok(Math.abs(geometry.cells[0].w-50*96/25.4)<0.1);
  assert.ok(Math.abs(geometry.cells[0].h-30*96/25.4)<0.1);
  assert.equal(new Set(geometry.cells.map(cell=>cell.x)).size,4);
  assert.equal(new Set(geometry.cells.map(cell=>cell.y)).size,9);
  assert.equal(geometry.cut,'solid');
  const route=await printed.evaluate(()=>opener.directPrinterLayout(document));
  assert.equal(route.kind,'a4','A4 labels use the configured A4 printer');
  assert.equal(route.width,210);
  assert.equal(route.height,297);
  assert.equal(await printed.locator('#a4PaperLayout').count(),0,'Report margin preferences must not resize the 50 × 30 label grid');
  const pdf=await printed.pdf({preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,2,'37 labels produce two physical A4 pages without extra blank pages');
  assert.match(await printed.locator('body').textContent(),/FULL-001/);
  assert.equal(await printed.locator('[data-price-label-element="code"]').filter({hasText:'FULL-001'}).count(),35);
  assert.equal(await printed.locator('[data-price-label-element="code"]').filter({hasText:'CREATED-ELSEWHERE'}).count(),2);
  await printed.close();
  await page.locator('[data-barcode-print-remove="0"]').click();
  await page.locator('[data-barcode-print-qty="0"]').fill('0');
  await page.locator('#savePrintBarcodeBtn').click();
  assert.match(await page.locator('#toast').textContent(),/จำนวนป้าย/);
  await page.locator('[data-barcode-print-qty="0"]').fill('2');
  await page.locator('#barcodePrintLabelSize').selectOption('40x30');
  const [subunitPrint]=await Promise.all([page.waitForEvent('popup'),page.locator('#savePrintBarcodeBtn').click()]);
  await subunitPrint.waitForSelector('.label');
  assert.equal(await subunitPrint.locator('.label').count(),2);
  assert.match(await subunitPrint.locator('body').textContent(),/CREATED-ELSEWHERE/);
  assert.match(await subunitPrint.locator('head').textContent(),/@page\{size:40mm 30mm/);
  await subunitPrint.close();
  assert.deepEqual(await page.evaluate(()=>window.reprintRpcCalls),[],'Batch reprinting never calls the allocator or any RPC');
  await page.locator('#barcodePrintMenuBtn').click();
  await page.locator('[data-barcode-print-mode="new"]').click();
  assert.equal(await page.evaluate(()=>JSON.stringify({products,barcodePrintItems})),beforeReprint,'Switching back restores the new-label queue and leaves products untouched');
  await page.locator('#barcodePrintMenuBtn').click();
  await page.locator('[data-barcode-print-mode="reprint"]').click();
  assert.equal(await page.locator('[data-barcode-print-code="0"]').inputValue(),'CREATED-ELSEWHERE','Reprint queue is retained');
  await page.evaluate(()=>{products.find(product=>product.id===9103).units[0].barcode='CHANGED';});
  await page.locator('#savePrintBarcodeBtn').click();
  assert.match(await page.locator('#toast').textContent(),/มีการเปลี่ยนแปลง/);
  assert.equal(await page.locator('[data-barcode-print-code="0"]').inputValue(),'CHANGED');
  await page.evaluate(()=>{renderSidebar();document.querySelector('.navbtn[data-tab="barcodeprint"]').click();});
  assert.equal(await page.locator('[data-barcode-print-mode]').count(),2,'Opening the sidebar item always returns to the two choices');
  await page.locator('[data-barcode-print-mode="reprint"]').click();
  assert.equal(await page.locator('[data-barcode-print-code="0"]').inputValue(),'CHANGED','Reopening the same mode keeps its queue');
  await page.locator('#barcodePrintMenuBtn').click();
  await page.evaluate(()=>{
    const original=sb.rpc;let fail=true;
    sb.rpc=async(...args)=>{if(args[0]==='system_issued_label_codes'&&fail){fail=false;return {data:null,error:{message:'offline'}};}return original(...args);};
  });
  await page.locator('[data-barcode-print-mode="reprint"]').click();
  await page.locator('#barcodeIssuedRetryBtn').waitFor();
  assert.equal(await page.locator('#barcodePrintSearch').count(),0,'History errors never fall back to all barcodes');
  await page.locator('#barcodeIssuedRetryBtn').click();
  assert.equal(await page.locator('[data-barcode-print-code="0"]').inputValue(),'CHANGED','Retry preserves the queue');
  await page.locator('#barcodePrintLabelSize').selectOption('60x40');
  await page.locator('#savePriceLabelDefaultBtn').click();
  await page.locator('#barcodePrintMenuBtn').click();
  await page.locator('[data-barcode-print-mode="new"]').click();
  assert.equal(await page.locator('#barcodePrintLabelSize').inputValue(),'a4-50x30','Default saved from reprint leaves new-label default unchanged');
  await page.reload();
  await page.waitForFunction(()=>typeof readPriceLabelDefaultSize==='function');
  assert.equal(await page.evaluate(()=>readPriceLabelDefaultSize('new')),'a4-50x30','New default persists after reload');
  assert.equal(await page.evaluate(()=>readPriceLabelDefaultSize('reprint')),'60x40','Repeat default persists independently after reload');
  assert.deepEqual(errors, []);
  console.log('price label designer browser tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
