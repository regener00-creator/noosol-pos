const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.join(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.join(root,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await installIsolatedBrowser(page);await page.goto(`http://127.0.0.1:${server.address().port}/`);await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());document.getElementById('appRoot').hidden=false;
    currentProfile={id:'test-owner',owner:true,level:1,firstName:'Owner'};renderLoginState=()=>true;
    currentTab='products';activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ'}];
    products=[{id:1,sku:'P1',name:'[BP] Restiv (75 ml)',category:'ยา',brand:'ทั่วไป',unit:'ขวด',barcode:'WRONG-MAIN',price:100,cost:50,multiunit:true,units:[{sub:'คู่',per:2,base:'ขวด',factor:2,price:180,barcode:'WRONG-PAIR'}],extraBarcodes:[],vendorBarcodes:[],stock:17}];
    units=['ขวด','คู่'];categories=['ยา'];brands=['ทั่วไป'];rebuildProductLookupMaps();
    window.historyCodes=[{pid:1,barcode:'P00000000010'},{pid:1,barcode:'P00000000011'},{pid:2,barcode:'P00000000012'}];
    window.historyFailure=false;window.historyDelay=false;window.remoteConflict=false;window.acceptRestore=true;window.saved=0;window.messages=[];
    showToast=message=>messages.push(message);window.confirm=()=>acceptRestore;
    scheduleSupabaseCoreSync=()=>{};persistWorkspaceData=async()=>{saved++;return true;};
    sb.rpc=async(name)=>{
      if(name==='system_issued_label_codes'){
        if(historyDelay)await new Promise(resolve=>window.releaseHistory=resolve);
        return historyFailure?{error:{message:'offline'}}:{data:historyCodes,error:null};
      }
      if(name==='find_product_barcode_owners')return {data:remoteConflict?[{product_id:2,barcode:'P00000000010',name:'สินค้าอื่น'}]:[],error:null};
      return {data:[],error:null};
    };
    editingProductId=1;render();
  });
  const open=async()=>{await page.locator('#productBarcodeHistoryBtn').click();await page.locator('[data-restore-code="0"]').waitFor();};
  await page.locator('#f_name').fill('ชื่อที่กำลังแก้ไข');
  await open();assert.equal(await page.locator('[data-restore-code]').count(),2,'only this product history');
  await page.locator('#productBarcodeHistoryUnit').selectOption('1');
  await page.evaluate(()=>acceptRestore=false);await page.locator('[data-restore-code="0"]').click();
  assert.equal(await page.locator('#unitRows .u_barcode').inputValue(),'WRONG-PAIR');
  await page.evaluate(()=>acceptRestore=true);await page.locator('[data-restore-code="0"]').click();
  await page.locator('#productBarcodeHistory').waitFor({state:'detached'});
  assert.equal(await page.locator('#unitRows .u_barcode').inputValue(),'P00000000010');
  assert.equal(await page.locator('#f_name').inputValue(),'ชื่อที่กำลังแก้ไข');
  assert.equal(await page.evaluate(()=>products[0].units[0].barcode),'WRONG-PAIR','draft only until Save');
  await open();await page.locator('[data-restore-code="0"]').click();
  await page.waitForFunction(()=>document.getElementById('productBarcodeHistoryStatus').textContent.includes('ซ้ำกัน'));
  assert.equal(await page.locator('#f_barcode').inputValue(),'WRONG-MAIN','same code cannot belong to two units');
  await page.locator('[data-restore-code="1"]').click();await page.locator('#productBarcodeHistory').waitFor({state:'detached'});
  await page.locator('#saveProductBtn').click();await page.waitForFunction(()=>!saveProduct.saving);
  assert.deepEqual(await page.evaluate(()=>[products[0].barcode,products[0].units[0].barcode,products[0].stock,saved]),['P00000000011','P00000000010',17,1]);
  await page.evaluate(()=>{products[0].barcode='WRONG-MAIN';products[0].units[0].barcode='WRONG-PAIR';editingProductId=1;render();remoteConflict=true;});await open();
  await page.locator('[data-restore-code="0"]').click();
  await page.waitForFunction(()=>document.getElementById('productBarcodeHistoryStatus').textContent.includes('สินค้าอื่น'));
  await page.locator('#productBarcodeHistory .modal-close').click();
  await page.evaluate(()=>{remoteConflict=false;historyFailure=true;});await page.locator('#productBarcodeHistoryBtn').click();
  await page.locator('#productBarcodeHistoryRetry').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-restore-code]').count(),0);
  await page.evaluate(()=>historyFailure=false);await page.locator('#productBarcodeHistoryRetry').click();await page.locator('[data-restore-code="0"]').waitFor();
  await page.locator('#productBarcodeHistory .modal-close').click();
  await page.evaluate(()=>historyCodes=[]);await page.locator('#productBarcodeHistoryBtn').click();
  await page.waitForFunction(()=>document.getElementById('productBarcodeHistoryStatus').textContent.includes('ยังไม่มี'));
  await page.locator('#productBarcodeHistory .modal-close').click();
  await page.evaluate(()=>{historyDelay=true;});await page.locator('#productBarcodeHistoryBtn').click();
  await page.waitForFunction(()=>!!window.releaseHistory);
  await page.locator('#productBarcodeHistory .modal-close').click();
  await page.locator('#cancelProductBtn').click();await page.evaluate(()=>releaseHistory());
  assert.equal(await page.locator('#productBarcodeHistory').count(),0,'late response cannot reopen history');
  await page.evaluate(()=>{currentProfile.owner=false;editingProductId=1;render();});
  assert.equal(await page.locator('#productBarcodeHistoryBtn').count(),0,'history restricted to owner');
  assert.deepEqual(errors,[]);
  console.log('Product barcode history browser passed: restore main/subunit, cancel, save, duplicate, remote conflict, retry, empty, navigation and permissions');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
