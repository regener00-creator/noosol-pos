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
  res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&fs.existsSync(file))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage();
  await installIsolatedBrowser(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{systemHasOwner=true;currentProfile=null;renderLoginState();});
  const focused=()=>page.evaluate(()=>document.activeElement.id);
  await page.locator('#loginUserId').fill('keyboard-test');
  await page.keyboard.press('Enter');
  assert.equal(await focused(),'loginPassword','login Enter advances without submitting');
  await page.evaluate(()=>{
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    document.getElementById('main').innerHTML='';
    const fixture=document.createElement('div');fixture.id='keyboardFixture';
    document.body.append(fixture);
    window.testSubmits=0;window.testChanges=0;
  });
  const fixture=async html=>page.evaluate(html=>{
    const root=document.getElementById('keyboardFixture');root.innerHTML=html;
    root.querySelectorAll('form').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();window.testSubmits++;}));
  },html);
  await fixture(`<form id="keyboardForm"><input id="first"><input hidden><input style="display:none"><input style="visibility:hidden"><input disabled><fieldset disabled><input></fieldset><input tabindex="-1"><div inert><input></div><input id="second" type="number"><input id="third" type="password"><button id="save">Save</button></form>`);
  await page.locator('#first').fill('ข้อมูล');
  await page.evaluate(()=>document.getElementById('first').addEventListener('change',()=>window.testChanges++));
  await page.keyboard.press('Enter');assert.equal(await focused(),'second');
  assert.equal(await page.evaluate(()=>window.testChanges),1,'Enter commits change exactly once');
  await page.keyboard.press('Enter');assert.equal(await focused(),'third');
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,30)));
  assert.equal(await focused(),'third','delayed number auto-select must not steal focus back');
  await page.keyboard.press('Enter');assert.equal(await focused(),'save');
  assert.equal(await page.evaluate(()=>window.testSubmits),0,'moving focus must not submit');
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.testSubmits),1,'button Enter still activates');
  await page.locator('#first').focus();await page.keyboard.press('Tab');assert.equal(await focused(),'second','Tab unchanged');
  await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'first');
  await fixture('<form><input id="first" tabindex="2"><input id="second" tabindex="1"><input id="third"><button>Save</button></form>');
  await page.locator('#second').focus();await page.keyboard.press('Enter');assert.equal(await focused(),'first');
  await page.keyboard.press('Enter');assert.equal(await focused(),'third');
  await fixture('<input id="outside"><div class="modal-overlay"><div class="modal"><form><input id="first"><input type="radio" name="r"><input type="radio" name="r" checked id="choice"><textarea id="multi"></textarea><div contenteditable="true" id="rich"></div><input id="last"></form></div></div>');
  await page.locator('#first').focus();await page.keyboard.press('Enter');assert.equal(await focused(),'choice');
  await page.locator('#multi').fill('line');await page.keyboard.press('Enter');
  assert.equal(await focused(),'multi');assert.equal(await page.locator('#multi').inputValue(),'line\n');
  await page.locator('#rich').fill('line');await page.keyboard.press('End');await page.keyboard.press('Enter');assert.equal(await focused(),'rich');
  await page.locator('#last').focus();await page.keyboard.press('Enter');assert.equal(await focused(),'last','no modal escape or submit');
  await fixture('<form><input id="first"><input id="second"><input id="third"></form>');
  await page.locator('#first').focus();
  for(const key of ['Shift+Enter','Control+Enter','Alt+Enter','Meta+Enter']){
    await page.keyboard.press(key);assert.equal(await focused(),'first',key+' is not navigation');
  }
  for(const options of [{isComposing:true},{keyCode:229},{repeat:true}]){
    await page.locator('#first').evaluate((el,options)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options})),options);
    assert.equal(await focused(),'first');
  }
  await page.locator('#first').evaluate(el=>el.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();window.testSearch=true;}}));
  await page.keyboard.press('Enter');assert.equal(await focused(),'first');assert.equal(await page.evaluate(()=>window.testSearch),true);
  // Document-level payment handlers are installed after the global listener.
  await page.evaluate(()=>{window.paymentTest=e=>{if(e.key==='Enter')e.preventDefault();};document.addEventListener('keydown',window.paymentTest);});
  await page.locator('#second').focus();await page.keyboard.press('Enter');assert.equal(await focused(),'second');
  await page.evaluate(()=>document.removeEventListener('keydown',window.paymentTest));
  await fixture('<form id="rerenderForm"><input id="first"><input id="second"><button>Save</button></form>');
  await page.locator('#first').evaluate(el=>el.addEventListener('change',()=>{
    document.getElementById('rerenderForm').outerHTML='<form id="rerenderForm"><input id="first"><input id="second"><button>Save</button></form>';
  }));
  await page.locator('#first').fill('commit');await page.keyboard.press('Enter');assert.equal(await focused(),'second','resolve focus after synchronous form render');
  // Real modal with actual form validation and event bindings, not a synthetic submit.
  await page.evaluate(()=>{document.getElementById('keyboardFixture').innerHTML='';openCustomItemModal();});
  await page.locator('#custom_item_name').fill('รายการทดสอบ');await page.keyboard.press('Enter');assert.equal(await focused(),'custom_item_price');
  await page.locator('#custom_item_price').fill('25');await page.keyboard.press('Enter');assert.equal(await focused(),'custom_item_unit');
  await page.keyboard.press('Enter');assert.equal(await focused(),'custom_item_qty');
  await page.keyboard.press('Enter');assert.equal(await focused(),'cancelCustomItemBtn');
  assert.equal(await page.locator('#custom_item_name').inputValue(),'รายการทดสอบ');
  await page.locator('#cancelCustomItemBtn').click();
  // Date controls use editable text; Tab order still includes the calendar button.
  await fixture(await page.evaluate(()=>`<form>${dmyDateFieldHtml('dateTest','2026-10-23')}<input id="afterDate"></form>`));
  await page.locator('#dateTest').fill('24/10/2026');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.className),'dmy-cal-trigger');
  assert.equal(await page.locator('#dateTest').inputValue(),'24/10/2026');
  assert.deepEqual(errors,[]);
  console.log('Enter navigation browser tests passed (login, Tab order, forms, modal, dates, rerender, IME, search/payment, multiline)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
