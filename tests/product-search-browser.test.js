const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
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
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบช่องค้นหาสินค้า');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
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
  await page.waitForFunction(() => typeof renderProducts === 'function' && typeof attachEvents === 'function');
  await page.evaluate(() => {
    document.querySelectorAll('.login-screen').forEach(screen => { screen.style.display='none'; });
    renderLoginState=()=>true;
    renderSidebar=()=>{};
    currentProfile={id:'owner-search-test',owner:true,level:1,firstName:'เจ้าของ'};
    products=[
      {id:9101,sku:'D-001',name:'Decolgen prin (4 tablets)',category:'ยา',brand:'ทั่วไป',unit:'กล่อง',barcode:'8850000000001',price:180,cost:120,stock:10,units:[{sub:'ลัง',factor:30,price:5000,cost:3500,barcode:'CASE-D-001'}],extraBarcodes:[],vendorBarcodes:[],active:true},
      {id:9102,sku:'P-001',name:'Paracetamol 500 mg',category:'ยา',brand:'ทั่วไป',unit:'กล่อง',barcode:'8850000000002',price:50,cost:30,stock:20,units:[],extraBarcodes:[],vendorBarcodes:[],active:true},
    ];
    inventoryLots=[];
    currentTab='products';
    editingProductId=null;
    selectedGroup=null;
    searchQuery='';
    productPage=1;
    rebuildProductLookupMaps();
    document.getElementById('main').innerHTML=renderProducts();
    attachEvents();
  });

  const search=page.locator('.product-list-search #search');
  await search.focus();
  await page.keyboard.type('Decolgen', {delay:20});
  await page.waitForTimeout(220);
  assert.equal(await search.inputValue(), 'Decolgen', 'ช่องค้นหาต้องรับตัวอักษรต่อเนื่องได้ครบ');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'search', 'ช่องค้นหาต้องคงโฟกัสหลังกรองข้อมูล');
  assert.equal(await page.locator('.prodtable tbody tr').count(), 1, 'ผลการค้นหาต้องเหลือสินค้าที่ตรงกันหนึ่งรายการ');
  assert.equal(await page.locator('.prodtable .prod-inline-name').inputValue(), 'Decolgen prin (4 tablets)');
  assert.equal(await page.locator('.prodtable .prod-unit-barcode').inputValue(), '8850000000001', 'ค่าเริ่มต้นต้องแสดงบาร์โค้ดหน่วยหลัก');
  await page.locator('.prodtable .prod-unit-select').selectOption('ลัง');
  assert.equal(await page.locator('.prodtable .prod-unit-barcode').inputValue(), 'CASE-D-001', 'เมื่อเปลี่ยนหน่วยต้องเปลี่ยนบาร์โค้ดตามหน่วยทันที');
  await page.locator('.prodtable .prod-unit-barcode').fill('CASE-D-NEW');
  await page.locator('.prodtable .prod-unit-barcode').press('Enter');
  await page.waitForTimeout(220);
  assert.equal(await page.evaluate(() => products.find(product=>product.id===9101).units[0].barcode), 'CASE-D-NEW', 'ต้องบันทึกบาร์โค้ดลงหน่วยเพิ่มเติมที่เลือก');
  assert.equal(await page.locator('.prodtable .prod-unit-barcode').inputValue(), 'CASE-D-NEW');
  await page.locator('.prodtable .prod-unit-barcode').fill('8850000000002');
  await page.locator('.prodtable .prod-unit-barcode').press('Tab');
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => products.find(product=>product.id===9101).units[0].barcode), 'CASE-D-NEW', 'บาร์โค้ดซ้ำกับสินค้าอื่นต้องไม่ถูกบันทึก');
  assert.equal(await page.locator('.prodtable .prod-unit-barcode').inputValue(), 'CASE-D-NEW', 'เมื่อเลขซ้ำ ช่องต้องคืนค่าเดิม');
  await page.locator('.prodtable .prod-unit-select').selectOption('กล่อง');
  await page.locator('.prodtable .prod-unit-barcode').fill('8850000000099');
  await page.locator('.prodtable .prod-unit-barcode').press('Tab');
  await page.waitForTimeout(220);
  assert.equal(await page.evaluate(() => products.find(product=>product.id===9101).barcode), '8850000000099', 'ต้องแก้บาร์โค้ดหน่วยหลักจากรายการสินค้าได้');

  await search.fill('');
  await page.waitForTimeout(220);
  await search.focus();
  await page.keyboard.type('D-001', {delay:170});
  await page.waitForTimeout(220);
  assert.equal(await search.inputValue(), 'D-001', 'แม้พิมพ์ช้าและตารางกรองระหว่างตัวอักษร ช่องค้นหาต้องรับข้อความได้ครบ');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'search');
  assert.equal(await page.locator('.prodtable .prod-inline-name').inputValue(), 'Decolgen prin (4 tablets)');
  await page.evaluate(() => {
    editingProductId=9101;
    document.getElementById('main').innerHTML=renderProductForm();
    attachEvents();
  });
  assert.equal(await page.locator('#f_scan_default_unit').count(), 0, 'ต้องไม่มีตัวเลือกบังคับเปลี่ยนหน่วยเมื่อยิงบาร์โค้ด');
  assert.deepEqual(errors, [], `พบ JavaScript error: ${errors.join(' | ')}`);
  console.log('product search browser tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode=1;
}).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
