const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, process.env.PEPOS_TEST_BUILT ? '../public' : '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer((req,res)=>{
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.resolve(root,pathname==='/'?'index.html':pathname.slice(1));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&fs.existsSync(file))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://**/*',route=>{
    if(route.request().url().includes('/npm/@supabase/')) return route.fulfill({contentType:'text/javascript',body:`(()=>{const query=new Proxy({}, {get(t,p){if(p==='then')return resolve=>resolve({data:null,error:null});return ()=>query;}});window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get(t,p){return p in t?t[p]:()=>query;}})};})();`});
    return route.fulfill({contentType:'text/css',body:''});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof renderCheckout==='function');
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    currentProfile={id:'test-owner',owner:true,level:1,firstName:'ทดสอบ'};
    currentTab='checkout'; searchQuery=''; showFavorites=false; saleMember=null; saleDiscount=0;
    currentCashShift={id:'test-shift',shiftNo:'TEST',openingCash:0,openedByName:'ทดสอบ'};
    contacts=[];
    products=[{id:1,name:'Decolgen prin (4 tablets) ชื่อสินค้าสำหรับทดสอบ',sku:'10001',barcode:'8850000000001',unit:'แผง',price:20,cost:10,active:true,category:'ยา',brand:'ทดสอบ',units:[{sub:'กล่อง',factor:10,price:180,cost:100,barcode:'8850000000002'}]}];
    promotions=[{id:1,name:'ซื้อครบ 3 แผง 50 บาท',active:true,type:'bundle',scope:'product',productId:1,unit:'แผง',bundleQty:3,bundlePrice:50}];
    cart=[{lineId:1,pid:1,name:products[0].name,unit:'แผง',qty:1,price:20,cost:10,factor:1,priceSource:'standard'}];
    render=()=>{reconcileAutoFreeLines();document.getElementById('main').innerHTML=renderCheckout();prepareScrollableTables();attachEvents();};
    render();
  });
  const pending=()=>page.locator('.pos-promo-pending-row');
  assert.equal(await pending().count(),1,'quantity below first bundle must be blue');
  assert.equal(await page.locator('[data-line-total]').first().evaluate(el=>getComputedStyle(el).fontWeight),'700','each POS line total is bold');
  const colors=await pending().evaluate(row=>[row.cells[0],row.cells[1],row.querySelector('.pos-item-name-content'),row.cells[3],row.querySelector('.pos-promo-tag'),row.querySelector('.line-unit'),row.querySelector('.line-qty'),row.cells[6]].map(el=>getComputedStyle(el).color));
  assert.equal(new Set(colors).size,1,'all product data including quantity and unit must share the warning color');
  assert.equal(colors[0],'rgb(22, 133, 192)','pending color must be blue in the active theme');
  assert.equal(await page.locator('#holdBtn').textContent(),'พัก');
  assert.deepEqual(await page.locator('#holdBtn').evaluate(el=>{const style=getComputedStyle(el);return [style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth];}),['0px','0px','0px','0px'],'hold button has no border');
  for(const width of [1920,1440,1280]){
    await page.setViewportSize({width,height:1000});
    const layout=await page.evaluate(()=>{
      const table=document.querySelector('.pos-table');
      const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {top:r.top,width:r.width,height:r.height,right:r.right};};
      return {hold:rect('holdBtn'),clear:rect('clearBillBtn'),pay:rect('checkoutBtn'),columns:[3,4,6].map(index=>[getComputedStyle(table.tHead.rows[0].cells[index]).textAlign,getComputedStyle(table.tBodies[0].rows[0].cells[index]).textAlign]),nameWidth:table.tHead.rows[0].cells[2].getBoundingClientRect().width};
    });
    assert.ok(Math.abs(layout.hold.top-layout.pay.top)<1&&Math.abs(layout.clear.top-layout.pay.top)<1,`three footer actions share one row at ${width}px`);
    assert.ok(layout.pay.width>layout.hold.width&&layout.pay.width>layout.clear.width,'checkout is the largest button');
    assert.ok(Math.abs(layout.hold.width-layout.clear.width)<1&&Math.abs(layout.hold.height-layout.clear.height)<1,'hold and trash buttons have equal dimensions');
    assert.ok(layout.pay.right<layout.hold.right&&layout.hold.right<layout.clear.right,'checkout, hold and delete are ordered from left to right');
    assert.deepEqual(layout.columns,[['center','center'],['center','center'],['center','center']]);
    assert.ok(layout.nameWidth>150,`name must have usable space at ${width}px: ${layout.nameWidth}`);
  }
  await page.setViewportSize({width:1920,height:1080});
  if(process.env.PEPOS_TEST_SCREENSHOT) await page.screenshot({path:process.env.PEPOS_TEST_SCREENSHOT,fullPage:true});
  await page.locator('.line-qty').fill('3');
  await page.locator('.line-qty').press('Enter');
  assert.equal(await pending().count(),0,'reaching the first bundle removes warning');
  assert.equal(await page.locator('[data-line-total="1"]').textContent(),'50.00');
  await page.locator('.line-qty').fill('4');
  await page.locator('.line-qty').press('Enter');
  assert.equal(await pending().count(),0,'an extra remainder must not invalidate an earned promotion');
  await page.locator('.line-qty').fill('1');
  await page.locator('.line-qty').press('Enter');
  assert.equal(await pending().count(),1);
  await page.locator('.line-unit').selectOption('กล่อง');
  assert.equal(await pending().count(),0,'a different unit must not show this promotion');
  await page.evaluate(()=>{
    cart[0].unit='แผง';cart[0].price=20;
    promotions=[{id:2,active:true,scope:'buygetdiff',name:'ซื้อ 2 แถม 1',bgdBuyProductId:1,bgdBuyUnit:'แผง',bgdBuyQty:2,bgdGetProductId:1,bgdGetUnit:'แผง',bgdGetQty:1}];render();
  });
  assert.equal(await pending().count(),1,'buy-and-get promotion must also warn below the threshold');
  await page.locator('.line-qty').fill('2');
  await page.locator('.line-qty').press('Enter');
  assert.equal(await pending().count(),0);
  assert.equal(await page.locator('.pos-autofree-row').count(),1,'qualifying still adds the free product');
  for(const priceSource of ['customer','quotation']){
    await page.evaluate(source=>{cart=cart.filter(line=>!line.autoFreeFromPromo);cart[0].qty=1;cart[0].priceSource=source;render();},priceSource);
    assert.equal(await pending().count(),0,'special prices do not stack promotions');
  }
  await page.evaluate(()=>{cart[0].priceSource='standard';promotions[0].active=false;render();});
  assert.equal(await pending().count(),0,'inactive promotions do not warn');
  await page.evaluate(()=>{
    window.__holdCalls=[];
    window.__holdSnapshot=()=>JSON.stringify({cart,saleRef,saleDiscount,saleMember,saleSourceQuotationId,pendingQty,salesHistory,holdOrderInFlight});
    salesHistory=[];saleDiscount=3;pendingQty=2;saleSourceQuotationId='QT-TEST';
    sb.rpc=async(name,args)=>{
      if(name!=='save_held_sale') throw new Error('Unexpected RPC: '+name);
      window.__holdCalls.push(args.p_sale);
      return {data:{sale:{...args.p_sale,id:'HELD-'+window.__holdCalls.length}},error:null};
    };
  });
  const beforeCancel=await page.evaluate(()=>window.__holdSnapshot());
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('#holdBtn').click();
  assert.equal(await page.evaluate(()=>window.__holdSnapshot()),beforeCancel,'Cancel must preserve cart, reference, discounts, history and other sale state');
  assert.equal(await page.evaluate(()=>window.__holdCalls.length),0,'Cancel must not send a save request');
  page.once('dialog',dialog=>dialog.accept('  ลูกค้าเสื้อแดง  '));
  await page.locator('#holdBtn').click();
  await page.waitForFunction(()=>salesHistory.length===1&&!holdOrderInFlight);
  assert.equal(await page.evaluate(()=>window.__holdCalls.length),1,'OK saves exactly once');
  assert.equal(await page.evaluate(()=>salesHistory[0].name),'ลูกค้าเสื้อแดง');
  assert.equal(await page.evaluate(()=>cart.length),0);
  await page.evaluate(()=>{cart=JSON.parse(JSON.stringify(salesHistory[0].cartSnapshot));render();});
  page.once('dialog',dialog=>dialog.accept(''));
  await page.locator('#holdBtn').click();
  await page.waitForFunction(()=>salesHistory.length===2&&!holdOrderInFlight);
  assert.equal(await page.evaluate(()=>salesHistory[0].name),'(ไม่มีชื่อ)','explicit OK with an empty name remains allowed');
  assert.equal(await page.evaluate(()=>window.__holdCalls.length),2);
  await page.evaluate(()=>{
    promotions[0].active=true;
    const main={lineId:2,pid:1,name:products[0].name,unit:'แผง',qty:2,price:20,cost:10,factor:1,priceSource:'standard'};
    cart=[{lineId:1,custom:true,name:'ก่อนสินค้าเข้าโปร',unit:'ชิ้น',qty:1,price:10,factor:1},main,{lineId:3,custom:true,name:'หลังสินค้าเข้าโปร',unit:'ชิ้น',qty:1,price:15,factor:1}];
    saleSourceQuotationId=null;saleDiscount=0;saleMember=null;pendingQty=1;
    render();
  });
  const giftRow=page.locator('.pos-autofree-row');
  assert.equal(await giftRow.locator('td').first().textContent(),'003','gift immediately follows sale item 002');
  const giftBarcodeStyle=await giftRow.locator('td').nth(1).evaluate(cell=>{const style=getComputedStyle(cell);return {weight:style.fontWeight,align:style.textAlign,padding:style.padding};});
  const mainBarcodeStyle=await page.locator('[data-pos-cart-line="2"] td').nth(1).evaluate(cell=>{const style=getComputedStyle(cell);return {weight:style.fontWeight,align:style.textAlign,padding:style.padding};});
  assert.deepEqual(giftBarcodeStyle,mainBarcodeStyle,'free gift barcode uses the same weight, alignment and padding as ordinary rows');
  const deleteInset=await page.locator('[data-pos-cart-line="2"] .pos-del').evaluate(button=>button.closest('td').getBoundingClientRect().right-button.getBoundingClientRect().right);
  assert.ok(deleteInset>=12,'delete button has breathing room from the right edge');
  await page.evaluate(async()=>{
    readPendingCheckoutRequest=()=>null;offlinePosMode=()=>false;
    checkoutRequestContext=async payload=>({id:'receipt-order-test',payload,payloadHash:'test'});
    clearCheckoutRequestId=async()=>{};refreshDocumentInventory=()=>{};openPostPaymentModal=()=>{};
    updateSaleDocumentMetadata=async()=>{};
    sb.rpc=async(name,args)=>{
      if(name!=='complete_sale') throw new Error('Unexpected RPC: '+name);
      return {data:{sale:{...args.p_sale,id:'RECEIPT-ORDER',ref:'RE-ORDER',date:TODAY_STR,time:'2026-10-27T10:00:00'}},error:null};
    };
    await doCheckout('เงินสด');
  });
  assert.deepEqual(await page.evaluate(()=>salesHistory.find(sale=>sale.id==='RECEIPT-ORDER').items.map(item=>item.lineKey)),['1','2','3','4'],'checkout preserves display sequence in the saved receipt');
  const receiptRows=await page.evaluate(()=>{
    const printDocument=document.implementation.createHTMLDocument('receipt test');
    window.open=()=>({document:printDocument,addEventListener(){},print(){}});
    standardizePrintPreview=()=>{};applyReceiptPrinterLayout=()=>{};
    printShortReceipt('RECEIPT-ORDER');
    return Array.from(printDocument.querySelectorAll('.item'),row=>({name:row.querySelector('b').textContent,amount:row.querySelector('strong').textContent}));
  });
  assert.equal(receiptRows.length,4);
  assert.equal(receiptRows[0].name,'ก่อนสินค้าเข้าโปร');
  assert.equal(receiptRows[1].name,receiptRows[2].name,'receipt gift is printed directly below its qualifying product');
  assert.equal(receiptRows[2].amount,'0.00');
  assert.equal(receiptRows[3].name,'หลังสินค้าเข้าโปร');
  assert.deepEqual(errors,[]);
  console.log('POS footer, blue promotion warnings and hold cancellation browser tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
