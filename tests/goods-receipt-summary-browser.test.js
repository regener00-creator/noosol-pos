const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,process.env.PEPOS_TEST_BUILT?'../public':'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&fs.existsSync(file))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  await installIsolatedBrowser(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await waitForIsolatedBootstrap(page);

  await page.evaluate(()=>{
    currentProfile={id:'receipt-summary-test',owner:true,level:1,firstName:'ทดสอบ'};
    warehouses=[{id:1,name:'คลังทดสอบ',active:true}];activeWarehouseId=1;
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});isMobileDeviceMode=()=>false;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    products=[{id:101,name:'สินค้า A',sku:'A',unit:'กระปุก',price:600,cost:500,stock:0,active:true,units:[]},{id:102,name:'ของแถม',sku:'B',unit:'กระปุก',price:0,cost:0,stock:0,active:true,units:[]}];
    contacts=[];currentTab='goodsreceipt';editingGRId='new';
    grDraft={id:'RI-SUMMARY-TEST',supplier:'',date:TODAY_STR,warehouseId:1,credit:0,taxMode:'incl',discount:0,note:'',items:[{productId:101,name:'สินค้า A',qty:62,unit:'กระปุก',price:0},{productId:102,name:'ของแถม',qty:1,unit:'กระปุก',price:0}]};
    render=()=>{document.getElementById('main').innerHTML=renderPOForm('gr');prepareScrollableTables();attachEvents();};render();
  });
  const assertTotals=async({subtotal,vat,beforeVat,total})=>{
    assert.equal(await page.locator('[data-po-summary="subtotal"]').innerText(),subtotal);
    assert.equal(await page.locator('[data-po-summary="total"]').innerText(),total);
    assert.equal(await page.locator('.po-total-amt').innerText(),total);
    assert.deepEqual(await page.locator('[data-po-tax-summary] .mono').allTextContents(),[beforeVat,vat]);
    const labels=await page.locator('.po-foot-right .sumrow > span:first-child').allTextContents();
    assert.deepEqual(labels,['ยอดรวมสินค้า ก่อน VAT','ส่วนลด','ยอดหลังหักส่วนลด ก่อน VAT',labels[3],'ยอดชำระสุทธิ']);
    assert.ok(['VAT','VAT 7%'].includes(labels[3]));
  };
  await page.locator('.poi_price').first().fill('579.5');
  await assertTotals({subtotal:'33,578.50',vat:'2,350.50',beforeVat:'33,578.50',total:'35,929.00'});
  assert.equal(await page.evaluate(()=>grDraft.items[0].qty*grDraft.items[0].price),35929,'draft and visible summary agree');
  await page.evaluate(()=>{window.activeReceiptPrice=document.querySelector('.poi_price');});
  await page.locator('.poi_price').first().fill('107');
  await page.locator('.poi_qty').first().fill('3');
  await assertTotals({subtotal:'300.00',vat:'21.00',beforeVat:'300.00',total:'321.00'});
  assert.equal(await page.evaluate(()=>window.activeReceiptPrice===document.querySelector('.poi_price')),true,'editing a row must preserve input nodes');
  await page.locator('#po_discount').fill('100');await page.locator('#po_discount').press('Tab');
  await assertTotals({subtotal:'300.00',vat:'14.00',beforeVat:'200.00',total:'214.00'});
  await page.locator('#po_discount').fill('0');await page.locator('#po_discount').press('Tab');
  await page.locator('#po_tax_mode').selectOption('excl');await page.locator('.poi_price').first().fill('100');
  await assertTotals({subtotal:'300.00',vat:'21.00',beforeVat:'300.00',total:'321.00'});
  await page.locator('#po_tax_mode').selectOption('none');
  await assertTotals({subtotal:'300.00',vat:'0.00',beforeVat:'300.00',total:'300.00'});
  await page.locator('.poi_price').nth(1).fill('10');
  await assertTotals({subtotal:'310.00',vat:'0.00',beforeVat:'310.00',total:'310.00'});
  await page.locator('.poi_del').first().click();
  await assertTotals({subtotal:'10.00',vat:'0.00',beforeVat:'10.00',total:'10.00'});
  await page.locator('.poi_qty').fill('2');
  await assertTotals({subtotal:'20.00',vat:'0.00',beforeVat:'20.00',total:'20.00'});
  await page.locator('.poi_qty').fill('1');
  await page.locator('.poi_price').fill('1000');
  await page.locator('#po_tax_mode').selectOption('excl');
  await page.locator('#po_discount').fill('100');await page.locator('#po_discount').press('Tab');
  await assertTotals({subtotal:'1,000.00',vat:'63.00',beforeVat:'900.00',total:'963.00'});
  await page.locator('#po_tax_mode').selectOption('incl');await page.locator('.poi_price').fill('1070');
  await assertTotals({subtotal:'1,000.00',vat:'63.00',beforeVat:'900.00',total:'963.00'});
  await page.locator('#po_tax_mode').selectOption('none');await page.locator('.poi_price').fill('1000');
  await assertTotals({subtotal:'1,000.00',vat:'0.00',beforeVat:'900.00',total:'900.00'});
  await page.locator('#po_tax_mode').selectOption('excl');
  await page.evaluate(()=>{
    document.getElementById('po_supplier').value='ผู้จำหน่ายทดสอบ';
    window.savedReceipt=null;saveRevisionedDocument=async(table,record)=>{if(table!=='goods_receipts') throw Error('unexpected table');window.savedReceipt=JSON.parse(JSON.stringify(record));};
    seedTableSnapshot=()=>{};persistWorkspaceData=()=>{};
  });
  assert.equal(await page.evaluate(()=>savePO(true)),'RI-SUMMARY-TEST');
  assert.deepEqual(await page.evaluate(()=>({discount:window.savedReceipt.discount,total:window.savedReceipt.total,tax:window.savedReceipt.taxSummary})),{discount:100,total:963,tax:{registered:true,subtotal:1000,discount:100,beforeVat:900,vat:63,total:963,discountBeforeVat:true}});
  await page.locator('.poi_price').fill('208366.5');
  await page.locator('#po_discount').fill('2083');
  assert.equal(await page.locator('#po_discount').inputValue(),'2,083');
  assert.equal(await page.evaluate(()=>grDraft.discount),2083);
  await page.locator('#po_discount').press('End');await page.keyboard.type('.67');
  assert.equal(await page.locator('#po_discount').inputValue(),'2,083.67');
  await assertTotals({subtotal:'208,366.50',vat:'14,439.80',beforeVat:'206,282.83',total:'220,722.63'});
  await page.locator('#po_discount').press('Tab');
  assert.equal(await page.locator('#po_discount').inputValue(),'2,083.67');
  await page.evaluate(()=>savePO(true));assert.equal(await page.evaluate(()=>window.savedReceipt.discount),2083.67);
  const checkPrint=async(values)=>{
    const [preview]=await Promise.all([page.waitForEvent('popup'),page.evaluate(()=>printPO('RI-SUMMARY-TEST','gr'))]);
    await preview.locator('.goods-receipt-print-totals').waitFor();
    const labels=await preview.locator('.goods-receipt-print-totals > div > span').allTextContents();
    assert.deepEqual(labels,['ยอดรวมสินค้า ก่อน VAT','ส่วนลด','ยอดหลังหักส่วนลด ก่อน VAT',labels[3],'ยอดชำระสุทธิ']);
    assert.ok(['VAT','VAT 7%'].includes(labels[3]));
    assert.deepEqual(await preview.locator('.goods-receipt-print-totals b').allTextContents(),values.map(value=>value+' บาท'));
    await preview.evaluate(()=>{window.print=()=>{window.testPrintCalled=true;};});
    await preview.locator('#confirmDocumentPrint').click();
    assert.equal(await preview.locator('.goods-receipt-print-totals').count(),2,'original and copy both keep five lines');
    await preview.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'sapuri-receipt-print-five-lines.png'),fullPage:true});
    await preview.close();
  };
  await checkPrint(['208,366.50','2,083.67','206,282.83','14,439.80','220,722.63']);
  for(const [mode,price,discount,values] of [
    ['incl','1070','100',['1,000.00','100.00','900.00','63.00','963.00']],
    ['none','1000','100',['1,000.00','100.00','900.00','0.00','900.00']],
    ['excl','1000','0',['1,000.00','0.00','1,000.00','70.00','1,070.00']]
  ]){
    await page.locator('#po_tax_mode').selectOption(mode);await page.locator('.poi_price').fill(price);
    await page.locator('#po_discount').fill(discount);await page.locator('#po_discount').press('Tab');
    await page.evaluate(()=>savePO(true));await checkPrint(values);
  }
  assert.deepEqual(errors,[]);
  console.log('Goods receipt live summary: screenshot amount, price/quantity edits, free item, discount, VAT included/excluded/none and deletion passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
