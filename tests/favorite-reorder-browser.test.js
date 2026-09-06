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

const browserExecutable = [
  process.env.PEPOS_BROWSER_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless:true, executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1200,height:800}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{ const query=new Proxy({}, {get(_target,property){ if(property==='then') return resolve=>resolve({data:null,error:null}); return ()=>query; }}); window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}}, {get(target,property){return property in target?target[property]:(()=>query);}})}; })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof openManageFavModal === 'function');
  await page.evaluate(() => {
    document.querySelectorAll('.login-screen').forEach(screen=>{ screen.style.display='none'; });
    products=[
      {id:1,name:'สินค้า A',sku:'A',unit:'กล่อง',price:100,cost:50,stock:10,units:[],active:true},
      {id:2,name:'สินค้า B',sku:'B',unit:'กล่อง',price:200,cost:100,stock:10,units:[],active:true},
      {id:3,name:'สินค้า C',sku:'C',unit:'กล่อง',price:300,cost:150,stock:10,units:[],active:true},
    ];
    favorites=[{pid:1,unit:'กล่อง'},{pid:2,unit:'กล่อง'},{pid:3,unit:'กล่อง'}];
    window.__favoriteSyncOrders=[];
    window.__favoriteToast='';
    persistWorkspaceData=()=>{};
    syncFavoritesToSupabase=()=>window.__favoriteSyncOrders.push(favorites.map(entry=>entry.pid));
    showToast=message=>{ window.__favoriteToast=message; };
    render=()=>{ window.__favoriteRenderedOrder=favorites.map(entry=>entry.pid); };
    openManageFavModal();
  });

  const rows = page.locator('.fav-manage-row');
  assert.equal(await rows.count(), 3);
  assert.equal(await page.locator('[data-fav-move]').count(), 0, 'arrow position controls must be removed');
  assert.equal(await rows.first().getAttribute('draggable'), 'true');
  assert.equal(await rows.first().evaluate(element=>getComputedStyle(element).cursor), 'grab');

  const targetBox = await rows.nth(2).boundingBox();
  assert.ok(targetBox, 'last favorite row must be visible');
  await rows.nth(0).dragTo(rows.nth(2), {targetPosition:{x:Math.max(8,targetBox.width/2),y:Math.max(8,targetBox.height-2)}});
  await page.waitForFunction(() => JSON.stringify(favorites.map(entry=>entry.pid)) === '[2,3,1]');
  assert.deepEqual(await page.evaluate(()=>favorites.map(entry=>entry.pid)), [2,3,1]);
  assert.deepEqual(await page.evaluate(()=>window.__favoriteSyncOrders.at(-1)), [2,3,1]);
  assert.equal(await page.evaluate(()=>window.__favoriteToast), 'บันทึกลำดับสินค้าโปรดแล้ว');
  assert.equal(await page.locator('.fav-manage-row.is-dragging').count(), 0);

  await page.locator('[data-fav-product-id="3"]').press('Alt+ArrowUp');
  assert.deepEqual(await page.evaluate(()=>favorites.map(entry=>entry.pid)), [3,2,1], 'keyboard reordering must remain available');
  await page.locator('#favSaveBtn').click();
  assert.equal(await page.locator('#favManageList').count(), 0);
  assert.deepEqual(await page.evaluate(()=>window.__favoriteRenderedOrder), [3,2,1]);
  assert.deepEqual(errors, [], `พบ JavaScript error: ${errors.join(' | ')}`);
  console.log('favorite reorder browser tests passed');
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(async()=>{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
});
