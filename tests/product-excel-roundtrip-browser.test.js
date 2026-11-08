const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const localRequire=createRequire(path.join(root,'package.json'));
const {chromium}=localRequire('playwright');
const Excel=localRequire('exceljs');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require(path.join(root,'tests/isolated-browser'));
const results=[];
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'public','.'+new URL(req.url,'http://localhost').pathname);
  const target=file===path.join(root,'public')?path.join(file,'index.html'):file;
  if(!target.startsWith(path.join(root,'public'))||!fs.existsSync(target)) return res.writeHead(404).end();
  res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(target).pipe(res);
});
let browser,page;
const baseProduct={id:9007199254740001,sku:'00123',name:'ยาทดสอบ',unit:'ซอง',price:15.25,cost:8.5,barcode:'0001234500001',vat:'incl',category:'ยา',brand:'ทั่วไป',wh:1,stock:20,expiry:'2027-12-31',desc:'รายละเอียดเดิม',active:true,type:'stock',dataReviewStatus:'pending',extraBarcodes:['0001234590001'],extraBarcodeUnits:['กล่อง'],vendorBarcodes:[{vendor:'บริษัททดสอบ',code:'0001234580001'}],multiunit:true,units:[{sub:'กล่อง',per:10,base:'ซอง',factor:10,price:140,cost:80,barcode:'0001234500010'},{sub:'ลัง',per:12,base:'กล่อง',factor:120,price:1500,cost:900,barcode:'0001234500120'}]};
async function fixture(rows=[baseProduct]){
  await page.evaluate(rows=>{
    products=structuredClone(rows); otherWarehouseProducts=[]; window.auditOriginal=structuredClone(rows);
    currentProfile={id:'test-owner',owner:true,level:1,firstName:'ทดสอบ'};
    warehouses=[{id:1,name:'คลังทดสอบ',active:true},{id:2,name:'อีกคลัง',active:true}];activeWarehouseId=1;allWarehousesMode=false;
    contacts=[];categories=['ยา'];brands=['ทั่วไป'];units=['ซอง','กล่อง','ลัง'];nextProductSkuNumber=100001;
    inventoryBalanceRows=rows.map(p=>({product_id:p.id,warehouse_id:1,stock:p.stock||0,expiry:p.expiry||''}));rebuildInventoryBalanceMap();
    loadWarehouseInventoryFromSupabase=async()=>true;
    loadServerBarcodeOwners=async()=>[];
    window.auditMessages=[];window.auditSaves=[];window.auditStocks=[];window.auditAllows=true;
    persistWorkspaceData=async options=>{auditSaves.push({options,products:structuredClone(products)});return true;};
    persistContacts=()=>{};
    window.auditSyncMode='success';window.auditStockFail=false;window.auditStockFailAfter=Infinity;
    syncUiLastError=null;
    syncedTableRows.products=new Map();
    syncCoreDataToSupabase=async()=>{
      const saved=window.auditSyncMode==='pending'?[]:window.auditSyncMode==='partial'?products.slice(0,1):products;
      seedTableSnapshot('products',saved,productMetadataToRow);
      syncUiState=saved.length===products.length?'synced':'error';
      if(syncUiState==='error') syncUiLastError={message:'ทดสอบซิงก์ไม่สำเร็จ'};
    };
    runStockOperation=async(name,args)=>{
      auditStocks.push({name,args});
      if(auditStockFail||auditStocks.length>auditStockFailAfter)throw new Error('ทดสอบปรับสต๊อกไม่สำเร็จ');
      if(args.lines.some(l=>warehouseStock(l.productId,args.warehouseId)!==l.expectedStock))throw new Error('สต๊อกเปลี่ยนระหว่างตรวจรายการ');
      return {balances:args.lines.map(l=>({productId:l.productId,warehouseId:args.warehouseId,stock:l.targetStock}))};
    };
    currentPharmacistName=()=> 'ทดสอบ';
    window.confirm=message=>{auditMessages.push({type:'confirm',message});return auditAllows;};
    window.alert=message=>auditMessages.push({type:'alert',message});
    showToast=message=>auditMessages.push({type:'toast',message});
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});isMobileDeviceMode=()=>false;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    currentTab='products';rebuildProductLookupMaps();render();
  },rows);
}
async function exported(expectedFilename){
  // Chrome throttles repeated automated downloads; each scenario still uses the real export button.
  await new Promise(resolve=>setTimeout(resolve,1200));
  const pending=page.waitForEvent('download');
  await page.locator('#exportProductsBtn').click();
  const download=await pending,parts=[];
  if(expectedFilename)assert.equal(download.suggestedFilename(),expectedFilename);
  for await(const chunk of await download.createReadStream())parts.push(chunk);
  const book=new Excel.Workbook();await book.xlsx.load(Buffer.concat(parts));return book;
}
function cell(book,row,name){const sheet=book.worksheets[0];return sheet.getCell(row,sheet.getRow(1).values.indexOf(name));}
async function imported(book,{stock=false,cancel=false,beforeConfirm=null,inspect=null,crossFields=null}={}){
  const buffer=await book.xlsx.writeBuffer();
  await page.evaluate(()=>{window.auditDone=false;const original=window.importProductsFromExcel;window.importProductsFromExcel=async file=>{try{return await original(file);}finally{auditDone=true;window.importProductsFromExcel=original;}};});
  await page.locator('#productImportFile').setInputFiles({name:'edited.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(buffer)});
  await page.locator('#productImportConfirm').waitFor();
  assert.equal(await page.locator('#productImportStock').isChecked(),false);
  if(stock) await page.locator('#productImportStock').check();
  if(crossFields){
    await page.locator('#productImportUpdateExisting').check();
    for(const field of crossFields)await page.locator(`[data-product-import-field="${field}"]`).check();
  }
  const preview=await page.locator('.product-import-body').innerText();
  if(inspect) await inspect(preview);
  if(beforeConfirm) await beforeConfirm();
  if(cancel||await page.locator('#productImportConfirm').isDisabled()){
    await page.locator('#productImportCancel').click();
  }else{
    await page.locator('#productImportConfirm').click();
    await page.waitForFunction(()=>window.auditDone||document.querySelector('#productImportTitle')?.textContent==='ผลการนำเข้าสินค้า');
    if(await page.locator('#productImportTitle').count()){
      var report=await page.locator('.product-import-body').innerText();
      await page.locator('#productImportCancel').click();
    }
  }
  await page.waitForFunction(()=>auditDone);
  return {...await page.evaluate(()=>({products:JSON.parse(JSON.stringify(products)),messages:auditMessages,saves:auditSaves,stocks:auditStocks})),preview,report};
}
async function scenario(name,work){if(process.argv[2]&&!new RegExp(process.argv[2]).test(name))return;try{const details=await work();results.push({name,result:'PASS',details});}catch(error){results.push({name,result:'FAIL',error:error.message});}console.log(JSON.stringify(results.at(-1)));}
(async()=>{
  execFileSync(process.execPath,[path.join(root,'scripts/build-static.mjs')],{cwd:root,stdio:'pipe'});
  const readerFile=path.join(root,'outputs/product-excel-audit/xlsx.full.min.js');
  if(!fs.existsSync(readerFile)){
    const response=await fetch('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    if(!response.ok)throw new Error('Cannot load pinned XLSX reader for round-trip test');
    fs.mkdirSync(path.dirname(readerFile),{recursive:true});fs.writeFileSync(readerFile,await response.text());
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=process.env.PEPOS_BROWSER_EXECUTABLE||(process.platform==='win32'?['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync):undefined);
  browser=await chromium.launch({headless:true,executablePath});
  page=await browser.newPage();await installIsolatedBrowser(page);
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'outputs/product-excel-audit/xlsx.full.min.js'),'utf8')}));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>ensurePageCodeLoaded('products'));
  await scenario('Export filename identifies the selected warehouse in both stores',async()=>{
    await fixture();
    const names=['พระยาสุเรนทร์','พรชัย'];
    const date=await page.evaluate(names=>{
      warehouses.forEach((w,i)=>{w.name=names[i];});
      setWarehouseProductCatalog([products[0],{...products[0],id:2,wh:2,name:'สินค้าพรชัย'}]);
      return TODAY_STR;
    },names);
    for(const [i,name] of names.entries()){
      await page.evaluate(id=>{activeWarehouseId=id;setWarehouseProductCatalog(completeProductCatalog());render();},i+1);
      const book=await exported(`PEPOS-รายการสินค้า-${name}-${date}.xlsx`);
      assert.equal(cell(book,2,'คลังสินค้า').value,name);
      assert.equal(cell(book,2,'ชื่อสินค้า').value,i===0?baseProduct.name:'สินค้าพรชัย');
    }
  });
  await scenario('Unedited real XLSX round trip preserves complete catalog fields',async()=>{
    await fixture();const out=await imported(await exported());
    assert.match(out.preview,/คลังของไฟล์ Excel\s+คลังทดสอบ\s+คลังปลายทาง\s+คลังทดสอบ/);
    assert.doesNotMatch(out.preview,/นำเข้าข้ามคลัง/);
    assert.equal(out.saves.length,1);
    for(const key of ['id','sku','name','unit','price','cost','barcode','vat','category','brand','desc','units','extraBarcodes','extraBarcodeUnits','vendorBarcodes','dataReviewStatus'])assert.deepEqual(out.products[0][key],baseProduct[key],key);
    assert.equal(out.stocks.length,0);assert.match(out.report,/สำเร็จ 1 รายการ/);
  });
  await scenario('Price edit on old export leaves newer stock intact by default',async()=>{
    await fixture();const book=await exported();cell(book,2,'ราคาขาย (หน่วยหลัก)').value=22;
    await page.evaluate(()=>{inventoryBalanceRows[0].stock=17;rebuildInventoryBalanceMap();products[0].stock=17;});
    const out=await imported(book);assert.equal(out.stocks.length,0);assert.equal(out.products[0].price,22);assert.match(out.preview,/15.25 → 22/);
  });
  await scenario('Stock requires opt-in and shows current warehouse quantities',async()=>{
    await fixture();const book=await exported();cell(book,2,'จำนวนคงเหลือ (หน่วยหลัก)').value=25;
    const out=await imported(book,{stock:true});assert.match(out.preview,/คลังทดสอบ · 20 → 25/);assert.equal(out.stocks[0].args.lines[0].targetStock,25);assert.match(out.report,/ปรับสต๊อกแล้ว/);
    cell(book,2,'จำนวนคงเหลือ (หน่วยหลัก)').value=0;
    assert.equal((await imported(book,{stock:true})).stocks.at(-1).args.lines[0].targetStock,0);
  });
  await scenario('Blank stock preserves the selected warehouse balance',async()=>{
    await fixture();const book=await exported();cell(book,2,'จำนวนคงเหลือ (หน่วยหลัก)').value='';
    const out=await imported(book,{stock:true});assert.equal(out.stocks.length,0);assert.match(out.preview,/คงสต๊อกเดิม/);
  });
  await scenario('Cross-store Excel copies catalog into destination and preserves both stores on repeat',async()=>{
    const source={...baseProduct,units:baseProduct.units.map((u,i)=>i===1?{...u,barcode:'P00000000010'}:u)};
    await fixture([source]);const book=await exported();
    await page.evaluate(()=>{activeWarehouseId=2;setWarehouseProductCatalog(completeProductCatalog());render();});
    const out=await imported(book,{stock:true});
    assert.match(out.preview,/คลังของไฟล์ Excel\s+คลังทดสอบ\s+คลังปลายทาง\s+อีกคลัง/);
    assert.match(out.preview,/นำเข้าข้ามคลัง/);
    assert.match(out.preview,/เพิ่มใหม่ 1 · อัปเดต 0 · ข้าม 0/);assert.match(out.preview,/เพิ่มสินค้าใหม่ใน อีกคลัง/);
    assert.match(out.preview,/เว้นบาร์โค้ดที่ระบบออกให้ร้านต้นทาง/);assert.match(out.report,/สำเร็จ 1 รายการ/);
    const copy=out.products[0];assert.notEqual(copy.id,source.id);assert.equal(copy.wh,2);
    for(const key of ['sku','barcode','price','cost','name','extraBarcodes','vendorBarcodes'])assert.deepEqual(copy[key],source[key],key);
    assert.equal(copy.units[0].barcode,source.units[0].barcode);assert.equal(copy.units[1].barcode,'');
    assert.equal(copy.stock,0);assert.equal(copy.expiry,'');assert.equal(out.stocks.length,0);
    await page.evaluate(()=>{products[0].price=72;products[0].cost=42;});
    for(const sku of [source.sku,'DIFFERENT-SKU']){
      cell(book,2,'รหัสสินค้า').value=sku;
      const repeat=await imported(book,{stock:true});assert.match(repeat.preview,/เพิ่มใหม่ 0 · อัปเดต 0 · ข้าม 1/);
      assert.equal(repeat.products.length,1);assert.equal(repeat.products[0].price,72);assert.equal(repeat.products[0].cost,42);assert.equal(repeat.saves.length,1);
    }
    assert.deepEqual(await page.evaluate(()=>otherWarehouseProducts),[source]);
  });
  await scenario('Cross-store Excel strips shop labels in both directions and keeps ordinary barcodes',async()=>{
    for(const [from,to,prefix] of [[1,2,'AP'],[2,1,'BP']]){
      const code=n=>prefix+String(n).padStart(11,'0');
      const source={...baseProduct,wh:from,barcode:code(1),extraBarcodes:[code(2),'EXTRA-KEEP'],extraBarcodeUnits:['ลัง','กล่อง'],
        vendorBarcodes:[{vendor:'ผู้ขาย',code:code(3)},...baseProduct.vendorBarcodes],
        units:baseProduct.units.map((unit,index)=>index===1?{...unit,barcode:code(4)}:unit)};
      await fixture([source]);
      const switchStore=id=>page.evaluate(id=>{activeWarehouseId=id;setWarehouseProductCatalog(completeProductCatalog());render();},id);
      await switchStore(from);
      const book=await exported();
      await switchStore(to);
      const out=await imported(book);
      assert.match(out.report,/สำเร็จ 1 รายการ/);
      const [copy]=out.products;
      assert.equal(copy.wh,to);assert.equal(copy.barcode,'');assert.equal(copy.units[1].barcode,'');
      assert.deepEqual(copy.extraBarcodes,['EXTRA-KEEP']);assert.deepEqual(copy.extraBarcodeUnits,['กล่อง']);
      assert.ok(copy.vendorBarcodes.every(v=>!v.code.startsWith(prefix)));
      assert.equal(copy.units[0].barcode,baseProduct.units[0].barcode);
      assert.deepEqual(await page.evaluate(()=>otherWarehouseProducts),[source]);
    }
  });
  await scenario('Cross-store owner can update only selected fields in either direction',async()=>{
    for(const [from,to] of [[1,2],[2,1]]){
      const label=(id,n)=>(id===1?'AP':'BP')+String(n).padStart(11,'0');
      const source={...baseProduct,wh:from,name:'Decolgen',barcode:label(from,9)};
      const dest={...baseProduct,id:2051,wh:to,sku:'DST-1',name:'ดีคอเจ่น',barcode:label(to,11),stock:35,price:25,cost:12,
        category:'อื่น',brand:'อื่น',extraBarcodes:['ALT-DST'],extraBarcodeUnits:['กล่อง'],vendorBarcodes:[],
        units:[{...baseProduct.units[0],per:25,factor:25,price:375,cost:225},
          {sub:'แพ็ก',base:'ซอง',per:2,factor:2,price:48,cost:22,barcode:label(to,12)}]};
      await fixture([source,dest]);
      const switchStore=id=>page.evaluate(id=>{activeWarehouseId=id;setWarehouseProductCatalog(completeProductCatalog());render();},id);
      await switchStore(from);const book=await exported();await switchStore(to);
      const noFields=await imported(book,{crossFields:[]});
      assert.equal(noFields.saves.length,0);assert.deepEqual(noFields.products,[dest]);
      const conflict=await imported(book,{crossFields:['name'],beforeConfirm:()=>page.evaluate(()=>{
        loadServerBarcodeOwners=async()=>[{barcode:'0001234500010',product_id:999}];
      })});
      assert.equal(conflict.saves.length,0);assert.match(conflict.messages.at(-1).message,/ตรงกับสินค้าอื่นบนเซิร์ฟเวอร์/);
      await page.evaluate(()=>{loadServerBarcodeOwners=async()=>[];});
      const nameOnly=await imported(book,{stock:true,crossFields:['name']});
      assert.match(nameOnly.preview,/ดีคอเจ่น → Decolgen/);assert.match(nameOnly.report,/สำเร็จ 1 รายการ/);
      assert.deepEqual(nameOnly.products[0],{...dest,name:'Decolgen'});
      assert.equal(nameOnly.stocks.length,0);
      const pricesOnly=await imported(book,{crossFields:['price']});
      assert.match(pricesOnly.preview,/รอตรวจสอบ/);assert.equal(pricesOnly.saves.length,1);
      const updated=await imported(book,{crossFields:['category','units','price','cost'],stock:true});
      const p=updated.products[0];assert.match(updated.preview,/25 ซอง → 10 ซอง/);
      assert.match(updated.report,/สำเร็จ 1 รายการ/);
      for(const field of ['id','sku','wh','barcode','stock','unit','extraBarcodes','vendorBarcodes','expiry'])assert.deepEqual(p[field],dest[field],field);
      for(const field of ['price','cost','category','brand'])assert.equal(p[field],source[field],field);
      assert.deepEqual(p.units[0],baseProduct.units[0]);assert.deepEqual(p.units[1],dest.units[1]);
      assert.deepEqual(p.units[2],{...baseProduct.units[1],barcode:''});
      assert.equal(updated.stocks.length,0);assert.deepEqual(await page.evaluate(()=>otherWarehouseProducts),[source]);
      const repeat=await imported(book,{crossFields:['name','category','units','price','cost']});
      assert.equal(repeat.saves.length,2);assert.match(repeat.preview,/อัปเดต 0 · ข้าม 0 · คงข้อมูลปลายทาง 1 รายการ/);
    }
  });
  await scenario('Cross-store duplicate references and conflicting keys go to review',async()=>{
    const source={...baseProduct,wh:1};
    const dst={...baseProduct,id:501,wh:2,name:'ปลายทาง'};
    const other={...dst,id:502,sku:'DIFF',barcode:'OTHER',units:[],extraBarcodes:[],extraBarcodeUnits:[],vendorBarcodes:[]};
    await fixture([source,dst,other]);await page.evaluate(()=>{setWarehouseProductCatalog(completeProductCatalog());render();});
    const book=await exported(),sheet=book.worksheets[0];
    sheet.addRow(sheet.getRow(2).values);sheet.addRow(sheet.getRow(2).values);
    cell(book,4,'รหัสสินค้า').value='DIFF';
    await page.evaluate(()=>{activeWarehouseId=2;setWarehouseProductCatalog(completeProductCatalog());render();});
    const out=await imported(book,{crossFields:['name']});
    assert.match(out.preview,/รอตรวจสอบ 3 รายการ/);
    assert.equal(out.saves.length,0);assert.deepEqual(out.products,[dst,other]);
  });
  await scenario('Cross-store keeps the destination base, uses its pack conversion, and restricts opt-in to owners',async()=>{
    const src={...baseProduct,wh:1};
    const dest={...src,id:9052,wh:2,name:'ดีคอเจ่น',unit:'หลอด',stock:8,price:50,cost:25,barcode:'BP00000000001',
      units:[{sub:'ซอง',per:2,base:'หลอด',factor:2,price:67,cost:30,barcode:baseProduct.barcode}],extraBarcodes:[],extraBarcodeUnits:[],vendorBarcodes:[]};
    await fixture([src,dest]);await page.evaluate(()=>{setWarehouseProductCatalog(completeProductCatalog());render();});
    const book=await exported();
    await page.evaluate(()=>{activeWarehouseId=2;setWarehouseProductCatalog(completeProductCatalog());render();currentProfile.owner=false;});
    const staff=await imported(book,{inspect:async()=>assert.equal(await page.locator('#productImportUpdateExisting').count(),0)});
    assert.equal(staff.saves.length,0);
    await page.evaluate(()=>{currentProfile.owner=true;});
    const out=await imported(book,{crossFields:['units','price'],stock:true});
    assert.match(out.preview,/คงหน่วยหลักปลายทาง “หลอด”/);
    assert.match(out.report,/สำเร็จ 1 รายการ/);
    const [p]=out.products;
    assert.equal(p.unit,'หลอด');assert.equal(p.barcode,dest.barcode);assert.equal(p.price,50);assert.equal(p.stock,8);
    assert.deepEqual(p.units.map(row=>row.factor),[2,20,240]);
    assert.equal(p.units[0].price,src.price);assert.equal(p.units[0].cost,30);
    assert.equal(p.units[1].price,140);assert.equal(p.units[1].cost,500);assert.equal(out.stocks.length,0);
  });
  await scenario('Finish a no-write cross-store review and show the protected base on page one',async()=>{
    const src=Array.from({length:52},(_,i)=>({...baseProduct,id:i+1,sku:String(i+10000),name:'สินค้า '+i,
      barcode:'BAR'+i,units:[],multiunit:false,extraBarcodes:[],extraBarcodeUnits:[],vendorBarcodes:[]}));
    src[51].name='Decolgen';
    const dest=src.map(p=>({...p,id:p.id+100,wh:2}));
    dest[51]={...dest[51],unit:'หลอด',barcode:'BP00000000001',multiunit:true,
      units:[{sub:'ซอง',base:'หลอด',per:1,factor:1,price:src[51].price,cost:src[51].cost,barcode:src[51].barcode}]};
    await fixture([...src,...dest]);await page.evaluate(()=>{setWarehouseProductCatalog(completeProductCatalog());render();});
    const book=await exported();
    await page.evaluate(()=>{activeWarehouseId=2;setWarehouseProductCatalog(completeProductCatalog());render();});
    const fields=['name','category','units','price','cost'];
    const out=await imported(book,{crossFields:fields,inspect:async preview=>{
      assert.match(preview,/คงข้อมูลปลายทาง 1 รายการ · ตรงกัน 51 รายการ/);
      assert.match(await page.locator('#productImportRows tr').first().innerText(),/Decolgen[\s\S]*คงหน่วยหลักปลายทาง “หลอด”/);
      assert.equal(await page.locator('#productImportConfirm').textContent(),'เสร็จสิ้นการตรวจสอบ');
      assert.equal(await page.locator('#productImportConfirm').isEnabled(),true);
    }});
    assert.equal(out.saves.length,0);assert.equal(out.stocks.length,0);assert.deepEqual(out.products,dest);
    cell(book,2,'ราคาขาย (หน่วยหลัก)').value=30;
    const changed=await imported(book,{crossFields:fields,inspect:async()=>{
      assert.equal(await page.locator('#productImportConfirm').textContent(),'ยืนยันนำเข้า');
    }});
    assert.match(changed.report,/สำเร็จ 1 รายการ/);assert.equal(changed.saves.length,1);
    assert.equal(changed.products[0].price,30);assert.deepEqual(changed.products[51],dest[51]);
  });
  await scenario('Same-store Excel rejects a foreign shop label before saving',async()=>{
    await fixture();const book=await exported();
    cell(book,2,'บาร์โค้ดหน่วยเพิ่มเติม 1').value='bp00000000012';
    const out=await imported(book);
    assert.match(out.preview,/BP00000000012.*พรชัย.*AP/);
    assert.equal(out.saves.length,0);assert.equal(out.stocks.length,0);
    assert.deepEqual(out.products[0].units,baseProduct.units);
  });
  await scenario('Cross-store preview supports a 2934-row catalog',async()=>{
    const rows=Array.from({length:2934},(_,i)=>({...baseProduct,id:i+1,sku:'SKU'+i,barcode:'000'+i,units:[],multiunit:false,extraBarcodes:[],extraBarcodeUnits:[],vendorBarcodes:[]}));
    await fixture(rows);const book=await exported();
    await page.evaluate(()=>{activeWarehouseId=2;setWarehouseProductCatalog(completeProductCatalog());render();});
    const out=await imported(book,{cancel:true});assert.match(out.preview,/เพิ่มใหม่ 2934 · อัปเดต 0 · ข้าม 0/);assert.equal(out.saves.length,0);
  });
  await scenario('Review lists source warehouses for mixed rows and identifies missing warehouse data',async()=>{
    await fixture();const book=await exported(),sheet=book.worksheets[0];
    for(const [i,warehouse] of ['2','', '1'].entries()){
      sheet.addRow(sheet.getRow(2).values);
      cell(book,i+3,'คลังสินค้า').value=warehouse;
    }
    await imported(book,{cancel:true,inspect:async()=>{
      assert.deepEqual(await page.locator('.product-import-warehouses dd').allTextContents(),['คลังทดสอบ · อีกคลัง · ไม่ระบุในไฟล์','คลังทดสอบ']);
    }});
    cell(book,1,'คลังสินค้า').value='legacy';
    await imported(book,{cancel:true,inspect:async()=>{
      assert.deepEqual(await page.locator('.product-import-warehouses dd').allTextContents(),['ไม่ระบุในไฟล์','คลังทดสอบ']);
    }});
  });
  await scenario('Invalid warehouse is reported with source row and no fallback',async()=>{
    await fixture();const book=await exported();cell(book,2,'คลังสินค้า').value='สะกดผิด';
    const out=await imported(book,{stock:true});assert.equal(out.saves.length,0);assert.equal(out.stocks.length,0);assert.match(out.preview,/แถว 2.*ยาทดสอบ.*ไม่พบคลัง/);
  });
  await scenario('Server barcode conflict identifies the Excel row and product',async()=>{
    await fixture();const book=await exported();
    await page.evaluate(()=>{loadServerBarcodeOwners=async()=>[{product_id:123,barcode:products[0].barcode,product_name:'สินค้าอื่น'}];});
    const out=await imported(book);assert.equal(out.saves.length,0);assert.match(out.preview,/แถว 2: ยาทดสอบ/);
  });
  await scenario('Invalid quantity blocks stock but allows metadata-only import',async()=>{
    await fixture();const book=await exported();cell(book,2,'จำนวนคงเหลือ (หน่วยหลัก)').value='สิบ';
    const rejected=await imported(book,{stock:true});assert.equal(rejected.saves.length,0);assert.match(rejected.preview,/จำนวนคงเหลือต้องเป็นตัวเลข/);
    const accepted=await imported(book);assert.equal(accepted.saves.length,1);assert.equal(accepted.stocks.length,0);
  });
  await scenario('Legacy expiry edits are explicitly reported as display-only',async()=>{
    await fixture();const book=await exported();cell(book,2,'วันหมดอายุ (สำหรับดูข้อมูล)').value='31/12/2028';
    cell(book,1,'วันหมดอายุ (สำหรับดูข้อมูล)').value='วันหมดอายุ';
    const out=await imported(book);assert.match(out.preview,/ค่าที่แก้ในไฟล์จะไม่ถูกบันทึก/);assert.match(out.report,/แก้ไขผ่าน LOT/);assert.equal(out.products[0].expiry,baseProduct.expiry);assert.equal(out.stocks.length,0);
  });
  await scenario('More than ten units, extra and supplier barcodes survive a real file round trip',async()=>{
    const p={...baseProduct,units:Array.from({length:11},(_,i)=>({sub:'แพ็ก'+i,per:i+2,base:'ซอง',factor:i+2,price:0,cost:0,barcode:'UNIT-'+i})),extraBarcodes:Array.from({length:11},(_,i)=>'EXTRA-'+i),extraBarcodeUnits:Array(11).fill('ซอง'),vendorBarcodes:Array.from({length:11},(_,i)=>({vendor:'บริษัท'+i,code:'VENDOR-'+i}))};
    await fixture([p]);const out=await imported(await exported());
    for(const key of ['units','extraBarcodes','extraBarcodeUnits','vendorBarcodes'])assert.deepEqual(out.products[0][key],p[key]);
  });
  await scenario('New product, exact large ID, leading zeros and reimport without duplication',async()=>{
    await fixture();const book=await exported();book.worksheets[0].addRow(['','สินค้าใหม่','สีเหลือง','ยา','ทั่วไป','Pcs',20,10,'0000000000002','ราคารวม VAT แล้ว','คลังทดสอบ',0]);
    const out=await imported(book);assert.equal(out.products.length,2);assert.equal(out.products[0].id,baseProduct.id);assert.equal(out.products[0].barcode,baseProduct.barcode);assert.ok(out.products[1].sku);assert.equal(out.products[1].dataReviewStatus,'pending');
    assert.equal((await imported(await exported())).products.length,2);
  });
  await scenario('Summary paginates all rows and reports every rejected row',async()=>{
    const rows=Array.from({length:60},(_,i)=>({...baseProduct,id:i+1,sku:'S'+i,name:'สินค้า'+i,barcode:'B'+i,units:[],extraBarcodes:[],extraBarcodeUnits:[],vendorBarcodes:[]}));
    await fixture(rows);const book=await exported();cell(book,61,'ราคาขาย (หน่วยหลัก)').value=-1;
    const out=await imported(book,{cancel:true,inspect:async()=>{
      assert.equal(await page.locator('#productImportRows tr').count(),50);
      await page.locator('#productImportNext').click();assert.equal(await page.locator('#productImportRows tr').count(),10);
      assert.match(await page.locator('#productImportRows').innerText(),/แถว 61/);
      await page.screenshot({path:path.join(root,'outputs/product-excel-audit/preview.png'),fullPage:true});
    }});assert.equal(out.saves.length,0);
  });
  await scenario('Partial sync reports each row separately and stocks only acknowledged products',async()=>{
    const other={...baseProduct,id:2,sku:'TWO',name:'สินค้าสอง',barcode:'TWO',units:[],extraBarcodes:[],extraBarcodeUnits:[],vendorBarcodes:[]};
    await fixture([baseProduct,other]);const book=await exported();cell(book,2,'จำนวนคงเหลือ (หน่วยหลัก)').value=21;cell(book,3,'จำนวนคงเหลือ (หน่วยหลัก)').value=22;
    await page.evaluate(()=>auditSyncMode='partial');const out=await imported(book,{stock:true});
    assert.match(out.report,/สำเร็จ 1 รายการ · รอซิงก์ 1 รายการ/);assert.equal(out.stocks[0].args.lines.length,1);assert.equal(out.stocks[0].args.lines[0].productId,baseProduct.id);
  });
  await scenario('Stock operation failure is not reported as total success',async()=>{
    await fixture();const book=await exported();cell(book,2,'จำนวนคงเหลือ (หน่วยหลัก)').value=21;
    await page.evaluate(()=>auditStockFail=true);const out=await imported(book,{stock:true});
    assert.match(out.report,/ไม่สำเร็จ 1 รายการ/);assert.match(out.report,/บันทึกข้อมูลสินค้าบนเซิร์ฟเวอร์แล้ว/);assert.match(out.report,/ทดสอบปรับสต๊อกไม่สำเร็จ/);
  });
  await scenario('Stock change while preview is open is rejected by expected balance check',async()=>{
    await fixture();const book=await exported();cell(book,2,'จำนวนคงเหลือ (หน่วยหลัก)').value=25;
    const out=await imported(book,{stock:true,beforeConfirm:()=>page.evaluate(()=>{inventoryBalanceRows[0].stock=19;rebuildInventoryBalanceMap();})});
    assert.match(out.report,/สต๊อกเปลี่ยนระหว่างตรวจรายการ/);assert.equal(out.stocks[0].args.lines[0].expectedStock,20);
  });
  await scenario('Catalog change during preview requires a fresh review',async()=>{
    await fixture();const out=await imported(await exported(),{beforeConfirm:()=>page.evaluate(()=>{products[0].name='แก้จากอีกเครื่อง';})});
    assert.equal(out.saves.length,0);assert.match(out.messages.at(-1).message,/ข้อมูลสินค้าเปลี่ยน/);
  });
  await scenario('Offline sync and local save failures report actionable results',async()=>{
    await fixture();const book=await exported();cell(book,2,'ราคาขาย (หน่วยหลัก)').value=99;
    await page.evaluate(()=>auditSyncMode='pending');
    const pending=await imported(book);assert.match(pending.report,/รอซิงก์ 1 รายการ/);assert.equal(pending.stocks.length,0);
    await fixture();await page.evaluate(()=>{persistWorkspaceData=async()=>false;});
    const failed=await imported(book);assert.match(failed.report,/ไม่สำเร็จ 1 รายการ/);assert.match(failed.report,/อย่าเพิ่งปิดโปรแกรม/);
  });
  await scenario('Partial stock batch failure reports the first 500 rows as applied',async()=>{
    const rows=Array.from({length:501},(_,i)=>({...baseProduct,id:i+1,sku:'B'+i,name:'สินค้า'+i,barcode:'B'+i,units:[],extraBarcodes:[],extraBarcodeUnits:[],vendorBarcodes:[]}));
    await fixture(rows);const book=await exported();
    for(let row=2;row<=502;row++)cell(book,row,'จำนวนคงเหลือ (หน่วยหลัก)').value=21;
    await page.evaluate(()=>auditStockFailAfter=1);
    const out=await imported(book,{stock:true});
    assert.equal(out.stocks.length,2);assert.match(out.report,/สำเร็จ 500 รายการ · รอซิงก์ 0 รายการ · ไม่สำเร็จ 1 รายการ/);
  });
  assert.deepEqual(errors,[]);
  assert.equal(results.filter(row=>row.result!=='PASS').length,0,JSON.stringify(results.filter(row=>row.result!=='PASS')));
})().catch(error=>{results.push({name:'harness',result:'ERROR',error:error.stack});console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(root,'outputs/product-excel-audit/results.json'),JSON.stringify(results,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve));});
