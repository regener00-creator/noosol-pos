const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,'../public');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://localhost').pathname.slice(1)||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');fs.createReadStream(file).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.PEPOS_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  await installIsolatedBrowser(page);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await waitForIsolatedBootstrap(page);
  await page.evaluate(()=>{
    currentProfile={id:'knowledge-owner',owner:true,level:1,firstName:'ทดสอบ'};activeWarehouseId=1;warehouses=[{id:1,name:'คลังทดสอบ',active:true}];
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});isMobileDeviceMode=()=>false;
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.style.display='none');
    window.knowledgeStored=null;window.knowledgeWrites=[];window.knowledgeFail=false;
    const originalFrom=sb.from;
    sb.from=table=>table==='settings'?{select:()=>({eq:()=>({maybeSingle:async()=>({data:window.knowledgeStored===null?null:{value:window.knowledgeStored},error:window.knowledgeFail?{message:'ทดสอบออฟไลน์'}:null})})})}:originalFrom(table);
    sb.rpc=async(name,args)=>{
      if(name==='owner_set_setting'){
        if(window.knowledgeFail)return {error:{message:'ทดสอบออฟไลน์'}};
        const assertOwner=currentProfile.owner===true;
        if(!assertOwner)return {error:{message:'owner access required'}};
        window.knowledgeStored=stableJsonValue(args.p_value);window.knowledgeWrites.push(args);return {data:{value:window.knowledgeStored},error:null};
      }
      return {data:[],error:null};
    };
    currentTab='knowledge';render();
  });
  await page.locator('#editKnowledge').waitFor();
  assert.equal(await page.locator('.navbtn[data-tab="notes"] + .navbtn[data-tab="knowledge"]').count(),1);
  assert.deepEqual(await page.locator('[data-knowledge-index]').allTextContents(),['ตั้งค่าเครื่องพิมพ์ใบเสร็จอย่างย่อ','POS - เทคนิคต่างๆ']);
  assert.match(await page.locator('.knowledge-content').innerText(),/SAPURI-POS-Setup-Windows-v2.1.rar/);
  await page.locator('[data-knowledge-index="1"]').click();assert.match(await page.locator('.knowledge-content').innerText(),/CAPLOCK/);
  await page.locator('#knowledgeSearch').fill('VOZY');assert.equal(await page.locator('[data-knowledge-index]:visible').count(),1);
  await page.locator('#knowledgeSearch').fill('');
  await page.locator('#addKnowledge').click();
  await page.locator('#knowledgeTitle').fill('หัวข้อใหม่');await page.locator('#knowledgeContent').fill('ข้อความของร้าน\nบรรทัดถัดไป');
  await page.locator('#knowledgeEditorForm [type="submit"]').click();await page.locator('.knowledge-editor-overlay').waitFor({state:'detached'});
  assert.equal(await page.locator('.knowledge-detail h2').innerText(),'หัวข้อใหม่');
  assert.equal(await page.evaluate(()=>window.knowledgeWrites.length),1);
  await page.locator('#editKnowledge').click();await page.locator('#knowledgeContent').fill('<img src=x onerror="window.unsafe=true">\nแก้ไขแล้ว');
  await page.locator('#knowledgeEditorForm [type="submit"]').click();await page.locator('.knowledge-editor-overlay').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.knowledgeWrites.length),2,'JSONB key order must not cause a false conflict');
  assert.equal(await page.locator('.knowledge-content img').count(),0);assert.equal(await page.evaluate(()=>!!window.unsafe),false);
  await page.locator('#reloadKnowledge').click();await page.locator('#editKnowledge:not([disabled])').waitFor();
  assert.match(await page.locator('.knowledge-content').innerText(),/แก้ไขแล้ว/);
  await page.locator('#editKnowledge').click();await page.locator('#knowledgeContent').fill('ต้องเก็บฉบับร่าง');
  await page.evaluate(()=>window.knowledgeFail=true);
  await page.locator('#knowledgeEditorForm [type="submit"]').click();await page.locator('#knowledgeFeedback').getByText('ทดสอบออฟไลน์').waitFor();
  assert.equal(await page.locator('#knowledgeContent').inputValue(),'ต้องเก็บฉบับร่าง');
  await page.evaluate(()=>{window.knowledgeFail=false;window.knowledgeStored.articles[0].title='แก้จากเครื่องอื่น';});
  await page.locator('#knowledgeEditorForm [type="submit"]').click();await page.locator('#knowledgeFeedback').getByText(/เครื่องอื่น/).waitFor();
  assert.equal(await page.evaluate(()=>window.knowledgeWrites.length),2);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#cancelKnowledge').click();
  await page.locator('#reloadKnowledge').click();await page.locator('#editKnowledge:not([disabled])').waitFor();
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#deleteKnowledge').click();assert.equal(await page.locator('[data-knowledge-index]').count(),3);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#deleteKnowledge').click();await page.waitForFunction(()=>document.querySelectorAll('[data-knowledge-index]').length===2);
  await page.setViewportSize({width:600,height:900});
  assert.equal(await page.locator('.knowledge-layout').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.setViewportSize({width:1440,height:1000});
  fs.mkdirSync(path.resolve(__dirname,'../outputs'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../outputs/knowledge-page.png')});
  // A staff account can read but cannot open the editor or write.
  await page.evaluate(()=>{currentProfile={id:'knowledge-staff',owner:false,level:2};render();});
  await page.locator('.knowledge-detail h2').waitFor();
  assert.equal(await page.locator('#addKnowledge,#editKnowledge,#deleteKnowledge').count(),0);
  await page.evaluate(()=>openKnowledgeEditor());assert.equal(await page.locator('.knowledge-editor-overlay').count(),0);
  assert.deepEqual(errors,[]);console.log('Knowledge: menu, seed text, search, create/edit/reload, XSS, errors/conflict, delete, responsive and read-only staff passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
