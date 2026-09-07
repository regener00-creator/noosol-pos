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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless:true, executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};'}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof dmyDateFieldHtml === 'function');
  await page.evaluate(() => {
    document.getElementById('main').innerHTML = ['promo_start','promo_end','po_date','transfer_date']
      .map(id => `<label>${id}${dmyDateFieldHtml(id,'2026-09-07')}</label>`).join('');
    document.querySelectorAll('.login-screen').forEach(element => { element.style.display = 'none'; });
    attachEvents();
  });

  for (const id of ['promo_start','promo_end','po_date','transfer_date']) {
    const input = page.locator(`#${id}`);
    assert.equal(await input.isEditable(), true, `${id} ต้องพิมพ์ได้`);
    await input.fill('08092026');
    assert.equal(await input.inputValue(), '08/09/2026', `${id} ต้องรับเลขและจัดรูปแบบอัตโนมัติ`);
    await input.click({position:{x:12,y:12}});
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('dmy-input')), true, `${id} ต้องได้รับโฟกัสเมื่อคลิกช่องข้อความ`);
  }

  assert.equal(await page.locator('.dmy-cal-trigger').count(), 4, 'ทุกช่องต้องมีปุ่มปฏิทินแยกต่างหาก');
  assert.equal(await page.locator('.dmy-native').first().evaluate(element => getComputedStyle(element).pointerEvents), 'none');
  console.log('editable document date browser tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
