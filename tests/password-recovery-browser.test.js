const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.join(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
  const file=path.join(root,pathname==='/'?'index.html':pathname.replace(/^\//,''));
  if(!file.startsWith(root)||!fs.existsSync(file)){ response.writeHead(404).end(); return; }
  response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});
let browser;
const executable=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync)||chromium.executablePath();

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:executable});
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{}})}})};`}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.click('#recoverOwnerPasswordBtn');
  const dialog=page.locator('#ownerPasswordRecoveryForm');
  await dialog.waitFor({state:'visible'});
  assert.ok(await page.locator('.owner-password-recovery-overlay').evaluate(element=>Number(getComputedStyle(element).zIndex)>Number(getComputedStyle(document.querySelector('#loginScreen')).zIndex)),'recovery overlay must appear above login screen');
  assert.ok(await dialog.locator('.form-grid').evaluate(element=>parseFloat(getComputedStyle(element).paddingLeft)>=18),'recovery fields must have horizontal spacing from the dialog edge');
  await page.click('.owner-password-recovery-overlay .recovery-cancel');
  assert.equal(await page.locator('#ownerPasswordRecoveryForm').count(),0,'cancel must close recovery dialog');
  await page.evaluate(()=>{
    callEdgeFunction=async(name,payload)=>name==='owner-recovery'&&payload.action==='question'?{question:'คำถามทดสอบ'}:{};
    recoverOwnerPassword();
  });
  await page.fill('#recoveryUsername','owner');
  await page.click('#recoveryContinueButton');
  await page.locator('#recoveryAnswer').waitFor({state:'visible'});
  assert.equal(await page.locator('#ownerPasswordRecoveryForm .password-eye-btn').count(),3,'answer and both new password fields must have visibility buttons');
  await page.fill('#recoveryAnswer','secret');
  await page.click('[data-toggle-password="recoveryAnswer"]');
  assert.equal(await page.locator('#recoveryAnswer').getAttribute('type'),'text','answer visibility button must reveal the answer');
  assert.match(await page.locator('[data-toggle-password="recoveryAnswer"]').getAttribute('aria-label'),/ซ่อนคำตอบ/);
  await page.click('.owner-password-recovery-overlay .recovery-cancel');
  await page.evaluate(()=>{
    window.recoveryWrites=[];
    callEdgeFunction=async(name,payload)=>{window.recoveryWrites.push({name,payload});return {};};
    openOwnerRecoverySetupModal();
  });
  await page.fill('#requiredRecoveryQuestion','คำถามทดสอบ');
  await page.fill('#requiredRecoveryAnswer','abc');
  await page.click('#ownerRecoverySetupForm button[type="submit"]');
  assert.match(await page.locator('#requiredRecoveryError').innerText(),/อย่างน้อย 4 ตัว/);
  assert.equal(await page.evaluate(()=>window.recoveryWrites.length),0,'three characters must not be submitted');
  await page.fill('#requiredRecoveryAnswer','abcd');
  await page.click('#ownerRecoverySetupForm button[type="submit"]');
  await page.waitForFunction(()=>window.recoveryWrites.length===1);
  assert.equal(await page.locator('#ownerRecoverySetupForm').count(),0,'four characters must save and close the form');
  assert.deepEqual(errors,[]);
  console.log('password recovery browser tests passed');
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(async()=>{ await browser?.close(); server.close(); });
