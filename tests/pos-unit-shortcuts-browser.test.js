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
    currentProfile={id:'unit-shortcut-test',owner:true,level:1,firstName:'ทดสอบ'};
    warehouses=[{id:1,name:'คลังทดสอบ',active:true}];activeWarehouseId=1;
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});isMobileDeviceMode=()=>false;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    currentCashShift={id:'unit-shift',shiftNo:'CS-TEST',openingCash:0,openedByName:'ทดสอบ'};
    products=[{id:101,sku:'D-001',name:'Decolgen prin (4 tablets)',unit:'ซอง',barcode:'SACHET-101',price:10,cost:5,stock:1000,active:true,
      units:[{sub:'กล่อง',factor:25,price:220,cost:125,barcode:'BOX-101'},{sub:'ลัง',factor:250,price:2000,cost:1250,barcode:'CASE-101'}]},
      {id:102,sku:'TWO',name:'สินค้ารายการที่สอง',unit:'ขวด',price:50,cost:20,stock:100,active:true,units:[{sub:'แพ็ก',factor:6,price:280,cost:120}]}];
    contacts=[];promotions=[];saleMember=null;cart=[];favorites=[];currentTab='checkout';searchQuery='';
    addToCart(101,'กล่อง',1);render();
  });
  assert.deepEqual(await page.locator('.line-unit[data-line="1"] option').allTextContents(),['ซอง','กล่อง = 25 ซอง','ลัง = 10 กล่อง']);
  assert.deepEqual(await page.locator('.line-unit[data-line="1"] option').evaluateAll(options=>options.map(option=>option.value)),['ซอง','กล่อง','ลัง']);
  const line=()=>page.evaluate(()=>({unit:cart[0].unit,price:cart[0].price,factor:cart[0].factor,cost:cart[0].cost,qty:cart[0].qty}));
  await page.locator('#search').focus();await page.keyboard.press('CapsLock');
  assert.deepEqual(await line(),{unit:'ลัง',price:2000,factor:250,cost:1250,qty:1});
  assert.deepEqual(await page.locator('#posUnitCycleMenu [role="option"]').allTextContents(),['ซอง','กล่อง = 25 ซอง','ลัง = 10 กล่อง']);
  assert.equal(await page.locator('#posUnitCycleMenu [aria-selected="true"]').innerText(),'ลัง = 10 กล่อง');
  assert.equal(await page.locator('#search').evaluate(el=>el===document.activeElement),true);
  assert.match(await page.locator('.pos-table tbody').innerText(),/CASE-101/);
  const output=path.resolve(__dirname,'../outputs');fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,'pos-caps-lock-units.png'),fullPage:true});
  await page.keyboard.press('CapsLock');assert.equal((await line()).unit,'ซอง');
  await page.keyboard.press('CapsLock');assert.equal((await line()).unit,'กล่อง');
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'CapsLock',repeat:true,bubbles:true})));
  assert.equal((await line()).unit,'กล่อง','holding Caps Lock cannot cycle repeatedly');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#posUnitCycleMenu').count(),0);
  await page.locator('.line-qty').fill('4');await page.keyboard.press('CapsLock');
  assert.deepEqual(await line(),{unit:'ลัง',price:2000,factor:250,cost:1250,qty:4});
  await page.locator('[data-pos-cycle-unit="ซอง"]').click();assert.equal((await line()).unit,'ซอง');
  await page.evaluate(()=>{addToCart(102,'ขวด',1);render();});
  await page.locator('#search').focus();await page.keyboard.press('CapsLock');
  assert.equal(await page.evaluate(()=>cart[1].unit),'แพ็ก','latest added product is targeted');
  await page.locator('[data-pos-cart-line="1"] .pos-item-name-content').click();await page.keyboard.press('CapsLock');
  assert.equal((await line()).unit,'กล่อง','clicking an earlier row targets that product');
  assert.equal(await page.evaluate(()=>cart[1].unit),'แพ็ก');
  await page.evaluate(()=>{addToCart(101,'กล่อง',1);render();});
  await page.locator('#search').focus();await page.keyboard.press('CapsLock');
  assert.equal((await line()).unit,'ลัง','scanning a merged earlier line targets that line');
  await page.evaluate(()=>{
    contacts=[{id:7,name:'ลูกค้าราคาพิเศษ',types:['customer'],customerPrices:[{id:'special-case',productId:101,unit:'ลัง',price:1900}]}];
    saleMember=customerSaleSnapshot(contacts[0]);
  });
  await page.locator('.line-unit[data-line="1"]').selectOption('กล่อง');
  await page.locator('#search').focus();await page.keyboard.press('CapsLock');
  assert.equal((await line()).price,1900,'unit shortcut keeps customer prices');
  await page.evaluate(()=>openPaymentModal());
  const beforeModal=await line();await page.keyboard.press('CapsLock');
  assert.deepEqual(await line(),beforeModal,'payment dialog blocks the shortcut');
  await page.locator('.checkout-pay-modal .modal-close').focus();
  await page.keyboard.press('Control');
  assert.ok(await page.locator('.checkout-pay-modal .modal-close').evaluate(el=>el===document.activeElement));
  await page.locator('.checkout-pay-modal .modal-close').click();
  await page.evaluate(()=>addBlankCustomCartLine());
  await page.keyboard.press('CapsLock');assert.deepEqual(await line(),beforeModal,'typing a custom item cannot change another line');
  await page.evaluate(()=>{currentTab='products';render();});
  await page.keyboard.press('CapsLock');assert.deepEqual(await line(),beforeModal,'other pages cannot change POS units');
  await page.evaluate(()=>{currentTab='checkout';cart=[];render();});
  await page.locator('#search').focus();await page.keyboard.press('CapsLock');assert.equal(await page.locator('#posUnitCycleMenu').count(),0);
  const focusIs=selector=>page.evaluate(selector=>document.activeElement.matches(selector),selector);
  for(const key of ['Tab','Enter']){
    await page.keyboard.press(key);
    assert.ok(await focusIs('#search'),'empty cart keeps the scanner ready');
  }
  await page.locator('#search').fill('CASE-101');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>cart.length),1,'Enter still scans a product');
  await page.locator('.line-qty').fill('5');
  await page.keyboard.press('Control+c');
  assert.ok(await focusIs('.line-qty'),'Ctrl+C keeps focus in the original field');
  await page.keyboard.press('Control');
  assert.ok(await focusIs('#search'),'Ctrl alone focuses the current scanner after cart rendering');
  assert.equal(await page.evaluate(()=>cart[0].qty),5);
  await page.keyboard.press('Tab');assert.ok(await focusIs('.line-unit'));
  await page.keyboard.press('ArrowUp');assert.ok(await focusIs('.line-unit'),'unit change preserves focus after render');
  await page.keyboard.press('Enter');assert.ok(await focusIs('.line-qty'));
  await page.locator('.line-qty').fill('7');await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>cart[0].qty),7);assert.ok(await focusIs('#search'));
  await page.evaluate(()=>{products[1].units=[];addToCart(102,'ขวด',1);render();});
  await page.locator('.pos-table tr:last-child .line-qty').focus();
  await page.keyboard.press('Enter');assert.ok(await focusIs('#search'));
  for(const key of ['Enter','Tab']){
    await page.keyboard.press(key);assert.ok(await focusIs('.pos-table tr:first-child .line-unit'));
    await page.keyboard.press(key);assert.ok(await focusIs('.pos-table tr:first-child .line-qty'));
    await page.keyboard.press(key);assert.ok(await focusIs('.pos-table tr:last-child .line-qty'),'fixed unit is skipped');
    await page.keyboard.press(key);assert.ok(await focusIs('#search'));
  }
  await page.keyboard.press('Shift+Tab');assert.ok(await focusIs('.pos-table tr:last-child .line-qty'));
  await page.keyboard.press('Shift+Tab');assert.ok(await focusIs('.pos-table tr:first-child .line-qty'));
  await page.keyboard.press('Shift+Tab');assert.ok(await focusIs('.pos-table tr:first-child .line-unit'));
  await page.keyboard.press('Shift+Tab');assert.ok(await focusIs('#search'));
  await page.keyboard.press('Shift+Tab');assert.ok(await focusIs('.pos-table tr:last-child .line-qty'));
  await page.evaluate(()=>{
    products.push({...products[0],id:103,name:'สินค้ารายการที่สาม'});
    addToCart(103,'ซอง',1);render();
  });
  const thirdRow=page.locator('.pos-table [data-pos-cart-line]').nth(2);
  await thirdRow.locator('.line-unit').focus();await page.keyboard.press('CapsLock');
  assert.equal(await thirdRow.locator('.line-unit').inputValue(),'กล่อง');
  await page.keyboard.press('Enter');
  assert.ok(await thirdRow.locator('.line-qty').evaluate(el=>el===document.activeElement));
  assert.equal(await page.locator('#posUnitCycleMenu').count(),0);
  await page.locator('#search').focus();
  await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>posSmallestUnitOnce),true,'Home shortcut is preserved');
  const ids=()=>page.evaluate(()=>cart.map(line=>line.lineId));
  const beforeDelete=await ids();
  const thirdQuantity=thirdRow.locator('.line-qty');
  const cellPosition=()=>page.evaluate(()=>{
    const cell=document.activeElement.closest('td');
    return cell&&[cell.parentElement.sectionRowIndex,cell.cellIndex];
  });
  await thirdQuantity.fill('4');
  await page.keyboard.press('Control+ArrowUp');
  assert.deepEqual(await cellPosition(),[1,5]);
  assert.equal(await page.evaluate(()=>cart[2].qty),4,'moving commits the edited quantity');
  await page.keyboard.press('Control+ArrowLeft');
  assert.deepEqual(await cellPosition(),[1,4],'a fixed unit remains a navigable column');
  await page.keyboard.press('Control+ArrowDown');
  assert.ok(await thirdRow.locator('.line-unit').evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Control+ArrowRight');
  assert.ok(await thirdQuantity.evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Control+ArrowDown');
  assert.deepEqual(await cellPosition(),[2,5],'bottom edge stays in the current cell');
  await thirdRow.locator('td').nth(1).click();
  await page.keyboard.press('Control+ArrowUp');
  assert.deepEqual(await cellPosition(),[1,1],'navigation can start from a clicked barcode');
  await thirdQuantity.fill('1');
  await thirdQuantity.focus();
  for(const [key,qty] of [['ArrowUp',2],['ArrowUp',3],['ArrowDown',2],['ArrowDown',1],['ArrowDown',1]]){
    await page.keyboard.press(key);
    assert.ok(await thirdQuantity.evaluate(el=>el===document.activeElement),'arrow keys keep focus on the same cart line');
    assert.equal(await thirdQuantity.inputValue(),String(qty));
    assert.equal(await page.evaluate(()=>cart[2].qty),qty);
  }
  async function checkRemoval(trigger,accept){
    let message='';
    page.once('dialog',async dialog=>{
      message=dialog.message();
      if(accept) await dialog.accept(); else await dialog.dismiss();
    });
    await trigger();
    assert.match(message,/ลบรายการที่ 3 “สินค้ารายการที่สาม”/);
    assert.deepEqual(await ids(),accept?beforeDelete.slice(0,2):beforeDelete);
  }
  const pressDelete=()=>page.keyboard.press('Delete');
  const clickTrash=()=>thirdRow.locator('.pos-del').click();
  await thirdQuantity.fill('12');
  await checkRemoval(pressDelete,false);
  assert.equal(await thirdQuantity.inputValue(),'12');
  await checkRemoval(clickTrash,false);
  assert.equal(await thirdQuantity.inputValue(),'12');
  await thirdQuantity.press('Tab');
  const firstQuantity=page.locator('.line-qty').first();
  await firstQuantity.fill('9');
  await checkRemoval(clickTrash,true);
  assert.equal(await page.evaluate(()=>cart[0].qty),9);
  await page.evaluate(()=>{addToCart(103,'ซอง',1);render();});
  await thirdQuantity.focus();
  await checkRemoval(pressDelete,true);
  await page.evaluate(()=>{
    products=[
      {id:201,name:'RON Alpha',sku:'RON-A',unit:'แผง',price:20,cost:10,stock:100,active:true,units:[{sub:'กล่อง',factor:10,price:190,cost:100}]},
      {id:202,name:'RON Beta',sku:'RON-B',unit:'ขวด',price:30,cost:15,stock:100,active:true,units:[]},
      {id:203,name:'RON Gamma',sku:'RON-C',unit:'แผง',price:40,cost:20,stock:100,active:true,units:[]}
    ];
    cart=[];saleMember=null;promotions=[];pendingQty=1;searchQuery='';posSmallestUnitOnce=false;render();
  });
  const search=page.locator('#search');
  const result=id=>page.locator(`.pos-result[data-id="${id}"]`);
  // A keystroke immediately after input must use the new results, even during debounce.
  await search.evaluate(el=>{
    el.value='RON';el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  });
  assert.ok(await focusIs('.pos-result[data-id="201"]'));
  assert.ok(await result(201).evaluate(el=>getComputedStyle(el).outlineStyle==='solid'));
  await page.keyboard.press('ArrowDown');assert.ok(await focusIs('.pos-result[data-id="202"]'));
  await page.keyboard.press('ArrowUp');assert.ok(await focusIs('.pos-result[data-id="201"]'));
  await page.keyboard.press('Tab');assert.ok(await focusIs('.pos-result[data-id="202"]'));
  await page.keyboard.press('Shift+Tab');assert.ok(await focusIs('.pos-result[data-id="201"]'));
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>cart[0].pid),201);
  assert.ok(await focusIs('.line-unit'));
  assert.equal(await search.inputValue(),'');
  assert.equal(await page.locator('.pos-results').count(),0);
  await page.keyboard.press('Enter');assert.ok(await focusIs('.line-qty'));
  await page.keyboard.press('Tab');assert.ok(await focusIs('#search'));
  await page.keyboard.press('Tab');assert.ok(await focusIs('.line-unit'),'empty search still enters cart fields');
  await search.fill('RON');await page.keyboard.press('Tab');await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>cart.map(x=>x.pid)),[201,202]);
  assert.ok(await focusIs('.pos-table tr:last-child .line-qty'),'fixed unit goes directly to quantity');
  await search.fill('RON');await page.keyboard.press('Tab');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>cart[0].qty),2);
  assert.ok(await focusIs('.pos-table tr:first-child .line-unit'),'merging an earlier line focuses that line');
  await search.fill('RON');await page.keyboard.press('Shift+Tab');
  assert.ok(await focusIs('.pos-result[data-id="203"]'));
  await page.keyboard.press('Escape');
  assert.ok(await focusIs('#search'));assert.equal(await search.inputValue(),'');
  assert.equal(await page.locator('.pos-results').count(),0);
  await search.fill('NOT-A-MATCH');await page.keyboard.press('Tab');
  assert.ok(await focusIs('#search'));assert.equal(await page.evaluate(()=>cart.length),2);
  await search.fill('RON');
  await search.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
  assert.equal(await page.evaluate(()=>cart[0].qty),2,'IME confirmation does not add a product');
  await page.keyboard.press('Escape');
  await search.fill('*3');await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await search.fill('RON');await page.keyboard.press('Tab');await page.keyboard.press('Tab');
  assert.equal(await page.locator('.pos-results').count(),1,'smallest-unit status cannot leave duplicate result lists');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>cart[1].qty),4,'selected product uses the preset quantity');
  assert.equal(await page.evaluate(()=>posSmallestUnitOnce),false);
  assert.ok(await focusIs('.pos-table tr:last-child .line-qty'));
  assert.deepEqual(errors,[]);
  console.log('Caps Lock: unit cycle, popup, price/cost/factor/barcode, quantity, selected/latest/merged line, customer prices, modal/input/page guards and Home passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
