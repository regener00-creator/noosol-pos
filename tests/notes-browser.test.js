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
  const page = await browser.newPage({viewport:{width:1366,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const query=new Proxy({}, {get(_target,property){
        if(property==='then') return resolve=>resolve({data:[],error:null});
        return ()=>query;
      }});
      window.supabase={createClient:()=>new Proxy({
        auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}
      }, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof renderNotes === 'function');

  await page.evaluate(() => {
    currentProfile={id:'owner-test',level:1,owner:true,firstName:'เจ้าของ'};
    warehouses=[{id:1,name:'คลังทดสอบ'}]; activeWarehouseId=1; warehouseAccessRows=[];
    notesLoaded=true;
    notes=[
      {id:'note-1',title:'โน้ตทดสอบ',contentHtml:'ข้อความ <b>สำคัญ</b>',hiddenFromLevel2:true,createdBy:'owner-test',updatedAt:'2026-09-01T15:00:00Z'},
      {id:'representative-note',title:'NOTE ผู้แทนที่ต้องไม่แสดง',contentHtml:'ข้อมูลผู้แทน',hiddenFromLevel2:false,representativeId:10,activityType:'general',createdBy:'owner-test',updatedAt:'2026-09-02T15:00:00Z'}
    ];
    editingNoteId='note-1';
    noteDraft=noteDraftFromRow(notes[0]);
    currentTab='notes';
    document.getElementById('main').innerHTML=renderNotes();
    attachNoteEvents();
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(screen=>{screen.style.display='none';});
  });

  assert.equal(await page.locator('.notes-page-head h1').textContent(), 'NOTE');
  assert.equal(await page.locator('#noteTitle').inputValue(), 'โน้ตทดสอบ');
  assert.equal(await page.locator('#noteHiddenFromLevel2').isChecked(), true);
  assert.equal(await page.locator('[data-note-command]').count(), 3);
  assert.equal(await page.locator('[data-note-color]').count(), 8);
  assert.equal(await page.locator('.note-list-item').count(),1);
  assert.doesNotMatch(await page.locator('.note-list-panel').textContent(),/NOTE ผู้แทนที่ต้องไม่แสดง/);

  await page.locator('#addNoteBtn').click();
  await page.locator('#noteTitle').fill('หลายรูปแบบ');
  await page.locator('#noteContentEditor').fill('แดงน้ำเงิน');
  await page.evaluate(() => {
    const editor=document.getElementById('noteContentEditor');
    const text=editor.firstChild;
    const selection=getSelection();
    const range=document.createRange();
    range.setStart(text,0); range.setEnd(text,3);
    selection.removeAllRanges(); selection.addRange(range);
  });
  await page.locator('[data-note-color="#B42318"]').click();
  await page.evaluate(() => {
    const editor=document.getElementById('noteContentEditor');
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);
    let node; let target=null;
    while((node=walker.nextNode())) if(node.nodeValue.includes('น้ำเงิน')){ target=node; break; }
    const selection=getSelection(); const range=document.createRange();
    range.selectNodeContents(target); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.locator('[data-note-color="#3448A3"]').click();
  await page.locator('[data-note-command="bold"]').click();
  const richHtml = await page.locator('#noteContentEditor').evaluate(element => element.innerHTML);
  assert.match(richHtml, /(font|span)/i, 'ต้องใช้สีได้มากกว่าหนึ่งช่วงในโน้ตเดียว');
  assert.match(richHtml, /(b|strong)/i, 'ต้องทำตัวหนากับข้อความที่เลือกได้');

  const sanitized = await page.evaluate(() => sanitizeNoteHtml('<img src=x onerror=alert(1)><script>alert(1)</script><b>ปลอดภัย</b><span style="color:#B42318;position:fixed">สี</span>'));
  assert.doesNotMatch(sanitized, /(img|script|onerror|position)/i);
  assert.match(sanitized, /<b>ปลอดภัย<\/b>/);
  assert.match(sanitized, /color/);

  const level2State = await page.evaluate(() => {
    currentProfile={id:'level2-test',level:2,owner:false,firstName:'พนักงาน'};
    pagePermissionRows=[{page_key:'notes',warehouse_id:null,can_view:true,can_create:true,can_edit:true,can_delete:true}];
    notes=[{id:'public-note',title:'โน้ตทั่วไป',contentHtml:'อ่านได้',hiddenFromLevel2:false,createdBy:'level2-test',updatedAt:'2026-09-01T15:00:00Z'}];
    editingNoteId='public-note'; noteDraft=noteDraftFromRow(notes[0]); noteDraftDirty=false;
    document.getElementById('main').innerHTML=renderNotes(); attachNoteEvents();
    return {hiddenToggle:document.querySelectorAll('#noteHiddenFromLevel2').length,editable:document.getElementById('noteContentEditor').contentEditable,canDelete:!!document.getElementById('deleteNoteBtn')};
  });
  assert.deepEqual(level2State,{hiddenToggle:0,editable:'true',canDelete:true});
  assert.deepEqual(errors, []);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
});
