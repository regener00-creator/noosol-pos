const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const assetRoot=process.argv.includes('--built')?path.join(root,'public'):root;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(assetRoot,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(assetRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[
    process.env.PEPOS_BROWSER_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',r=>r.fulfill({contentType:'text/javascript',body:`
    const query=new Proxy({}, {get(_t,p){if(p==='then')return resolve=>resolve({data:null,error:null});return ()=>query;}});
    window.customerRpc=async()=>({data:null,error:null});
    window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:(name,args)=>({abortSignal:()=>window.customerRpc(name,args)})},{get(t,p){return p in t?t[p]:()=>query;}})};
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof render==='function');
  await page.evaluate(async()=>{
    await ensurePageCodeLoaded('customers');
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    renderLoginState=()=>true;persistContacts=()=>{};
    currentProfile={id:'test-owner',owner:true,level:1,firstName:'ทดสอบ'};
    activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ'}];
    currentDateStr=()=> '2026-09-11';
    contacts=Array.from({length:13},(_,i)=>({id:i+1,code:String(i+1).padStart(3,'0'),name:i<2?'ลูกค้าชื่อเหมือนกัน':'ลูกค้า '+(i+1),types:['customer'],phone:'0812345678',line:'line-'+(i+1),email:''}));
    contacts.push({id:90,code:'090',name:'ผู้จำหน่ายเท่านั้น',types:['supplier']},{id:91,code:'091',name:'ทั้งสองประเภท',types:['supplier','customer']});
    products=[];searchQuery='';contactSort={key:'code',dir:1};currentTab='customers';editingContactId=null;editingCustomerPriceContactId=null;
    window.billFixtures=Array.from({length:12},(_,i)=>({id:'B'+String(i).padStart(2,'0'),ref:'RE-'+i,customerId:'1',date:'2026-09-01',status:'done',total:7500,items:[{name:'Decolgen',qty:25,unit:'กล่อง',price:300}]}));
    window.billFixtures.push({id:'V',customerId:'1',date:'2026-09-02',status:'void',total:100000,items:[]},{id:'OLD',member:{id:'1'},date:'2025-02-01',status:'done',total:5000,items:[{name:'สินค้าเก่า',qty:1,unit:'กล่อง',price:5000}]},{id:'SPECIAL',customerId:'2',date:'2026-09-01',status:'done',total:450000,items:[]});
    window.rpcCalls=[];window.rpcDelay=0;window.failHistory=false;
    window.customerRpc=async(name,p)=>{
      if(name==='get_customer_loyalty')return {error:null,data:p.p_customer_ids.map(id=>({customerId:id,balance:Number(id)*25,expiresAt:'2099-09-03T00:00:00+07:00'}))};
      if(name!=='get_customer_purchase_history')return {data:null,error:null};
      window.rpcCalls.push(p);
      await new Promise(resolve=>setTimeout(resolve,window.rpcDelay));
      if(window.failHistory)return {data:null,error:{message:'offline test'}};
      const linked=id=>window.billFixtures.filter(b=>(b.customerId||b.member?.id)===id);
      const inPeriod=b=>b.date.slice(0,4)===String(p.p_year)&&(p.p_month===null||Number(b.date.slice(5,7))===p.p_month);
      const summaries=p.p_customer_ids.map(id=>{
        const bills=linked(id).filter(b=>b.status==='done'),sum=list=>list.reduce((n,b)=>n+b.total,0),period=bills.filter(inPeriod);
        return {customerId:id,lifetimeTotal:sum(bills),currentYearTotal:sum(bills.filter(b=>b.date.startsWith('2026-'))),periodTotal:sum(period),periodBills:period.length};
      });
      const bills=p.p_include_bills?linked(p.p_customer_ids[0]).filter(inPeriod).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)):[];
      const page=Math.min(p.p_page,Math.max(1,Math.ceil(bills.length/10)));
      return {error:null,data:{asOf:'2026-09-11',currentYear:2026,elapsedMonths:9,summaries,totalBills:bills.length,page,bills:bills.slice((page-1)*10,page*10)}};
    };
    render();
  });
  await page.locator('.customer-tier-regular').first().waitFor();
  await page.locator('[data-customer-loyalty-balance="1"]').filter({hasText:'25 แต้ม'}).waitFor();
  assert.equal(await page.locator('.contact-summary-table tbody tr').count(),10);
  assert.deepEqual(await page.locator('.contact-summary-table thead th').evaluateAll(nodes=>nodes.map(node=>node.textContent.replace(/[▲▼]/g,'').trim())),['รหัสผู้ติดต่อ','ชื่อ','เบอร์โทร','ไลน์','แต้มคงเหลือ','ระดับลูกค้า','ยอดซื้อเฉลี่ยต่อเดือน','']);
  const firstCustomerCells=await page.locator('.contact-summary-table tbody tr').first().locator('td').allTextContents();
  assert.deepEqual(firstCustomerCells.slice(0,7),['001','ลูกค้าชื่อเหมือนกัน','0812345678','line-1','25 แต้ม','ลูกค้าประจำ','10,000.00 บาท']);
  assert.equal(await page.locator('.contact-summary-table tbody tr').first().locator('td').nth(1).evaluate(cell=>getComputedStyle(cell).textAlign),'center');
  assert.deepEqual(await page.locator('.contact-summary-table tbody tr').first().locator('.contact-action-icons button').evaluateAll(buttons=>buttons.map(button=>button.title)),['ประวัติการซื้อ','ราคาพิเศษ','แก้ไข','ลบ']);
  assert.deepEqual(await page.locator('.navbtn').evaluateAll(nodes=>nodes.filter(n=>['contacts','representativehistory','customers'].includes(n.dataset.tab)).map(n=>n.dataset.tab)),['contacts','representativehistory','customers']);
  assert.equal(await page.locator('.contact-summary-table tbody tr').first().locator('td').nth(1).locator('button').count(),0,'customer name is plain text');
  assert.equal(await page.locator('[data-customer-history="1"]').getAttribute('title'),'ประวัติการซื้อ');
  assert.equal(await page.locator('[data-customer-history="1"] svg').count(),1,'purchase history action uses an icon');
  assert.equal(await page.locator('[data-customer-history="1"]').locator('xpath=ancestor::tr').locator('.customer-tier').textContent(),'ลูกค้าประจำ');
  assert.equal(await page.locator('[data-customer-history="2"]').locator('xpath=ancestor::tr').locator('.customer-tier').textContent(),'ลูกค้าพิเศษ');
  await page.locator('[data-customer-history="1"]').click();
  await page.locator('.customer-purchase-cards strong').first().filter({hasText:'95,000.00'}).waitFor();
  assert.equal(await page.locator('.customer-purchase-table tbody tr').count(),10);
  assert.match(await page.locator('.customer-purchase-cards').innerText(),/90,000.00/);
  assert.equal(await page.locator('.customer-void').count(),1);
  await page.locator('.customer-purchase-items summary').nth(1).click();
  assert.match(await page.locator('.customer-purchase-items details[open]').innerText(),/Decolgen/);
  await page.locator('[data-customerhistorypage="next"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.customer-purchase-table tbody tr').length===3);
  await page.locator('#customerHistoryMode').selectOption('year');
  await page.locator('#customerHistoryYear').fill('2025');
  await page.locator('#applyCustomerHistory').click();
  await page.getByText('OLD',{exact:true}).waitFor();
  assert.equal(await page.locator('.customer-tier').textContent(),'ลูกค้าประจำ');
  assert.match(await page.locator('.customer-purchase-cards').innerText(),/5,000.00/);
  await page.locator('#customerHistoryYear').fill('2024');
  await page.locator('#applyCustomerHistory').click();
  await page.getByText('ไม่มีบิลในช่วงที่เลือก',{exact:true}).waitFor();
  await page.locator('#customerHistoryYear').fill('2026');
  await page.locator('#applyCustomerHistory').click();
  await page.locator('.customer-void').waitFor();
  fs.mkdirSync(path.join(root,'outputs'),{recursive:true});
  await page.screenshot({path:path.join(root,'outputs/customer-purchase-history.png'),fullPage:true});
  // A failed load is not a zero purchase / general tier.
  await page.evaluate(()=>window.failHistory=true);
  await page.locator('#refreshCustomerPurchases').click();
  await page.locator('[role="alert"]').waitFor();
  assert.equal(await page.locator('.customer-tier').count(),0);
  await page.evaluate(()=>window.failHistory=false);
  await page.locator('#refreshCustomerPurchases').click();
  await page.locator('.customer-tier-regular').waitFor();
  await page.locator('#closeCustomerHistory').click();
  await page.locator('.customer-tier-special').waitFor();
  // Async summaries cannot steal focus while the user types a search.
  await page.evaluate(()=>window.rpcDelay=200);
  await page.locator('#refreshCustomerPurchases').click();
  await page.locator('#search').fill('ลูกค้า');
  await page.waitForFunction(()=>customerPurchaseState?.loading===false);
  assert.equal(await page.locator('#search').inputValue(),'ลูกค้า');
  assert.equal(await page.locator('#search').evaluate(el=>el===document.activeElement),true);
  // A delayed customer response cannot overwrite the supplier screen.
  await page.locator('#refreshCustomerPurchases').click();
  await page.locator('.navbtn[data-tab="contacts"]').click();
  await page.waitForFunction(()=>customerPurchaseState===null);
  assert.equal(await page.locator('.contact-summary-table tbody tr').count(),2);
  assert.equal(await page.locator('.customer-tier').count(),0);
  await page.locator('#newContactBtn').click();
  assert.equal(await page.locator('#c_type_supplier').count(),0);
  assert.equal(await page.locator('#c_type_customer').count(),0);
  assert.equal(await page.locator('#c_fixed_type').inputValue(),'supplier');
  assert.equal(await page.locator('#c_taxid_label').textContent(),'เลขผู้เสียภาษี');
  const supplierIdentityLayout=await page.locator('#c_code,#c_name,#c_taxid,#c_credit').evaluateAll(inputs=>inputs.map(input=>({left:Math.round(input.getBoundingClientRect().left),top:Math.round(input.getBoundingClientRect().top)})));
  assert.equal(new Set(supplierIdentityLayout.map(item=>item.top)).size,1);
  assert.deepEqual(supplierIdentityLayout.map(item=>item.left),[...supplierIdentityLayout].sort((a,b)=>a.left-b.left).map(item=>item.left));
  await page.locator('#c_name').fill('ผู้จำหน่ายใหม่');
  await page.locator('#saveContactBtn').click();
  assert.deepEqual(await page.evaluate(()=>contacts.find(contact=>contact.name==='ผู้จำหน่ายใหม่')?.types),['supplier']);
  assert.deepEqual(errors,[]);
  console.log('Customer purchase history browser checks passed (navigation, tiers, periods, paging, errors, focus, shared contacts)');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
