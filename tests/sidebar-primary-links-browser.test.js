const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const nav=source.slice(source.indexOf('const NAV = ['),source.indexOf('let sidebarRenderSignature='));
const groups=new Function(`${nav};return NAV;`)();
const links=groups.flatMap(group=>group.items).filter(([tab])=>['dashboard','checkout','products'].includes(tab));
assert.deepEqual(links.map(([tab,label])=>[tab,label]),[['dashboard','DASHBOARD'],['checkout','POS'],['products','PRODUCT']]);
let browser;
(async()=>{
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&fs.existsSync(file))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const page=await browser.newPage({viewport:{width:1100,height:700}});
  await page.setContent('<div class="sidebar" id="sidebar"></div>');
  await page.addStyleTag({content:fs.readFileSync(path.join(root,process.env.PEPOS_TEST_BUILT?'public/styles.css':'styles.css'),'utf8')});
  await page.evaluate(items=>{
    for(const [tab,label,icon] of items){
      const button=document.createElement('button');button.className='navbtn';button.dataset.tab=tab;
      button.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${icon}</svg>`;
      button.append(document.createTextNode(label));document.getElementById('sidebar').append(button);
    }
  },links);
  for(const active of [false,true]){
    await page.locator('.navbtn').evaluateAll((buttons,selected)=>buttons.forEach(button=>button.classList.toggle('active',selected)),active);
    await page.waitForFunction(selected=>getComputedStyle(document.querySelector('[data-tab="products"]')).backgroundColor===(selected?'rgb(63, 51, 44)':'rgb(255, 255, 255)'),active);
    const styles=await page.locator('.navbtn').evaluateAll(buttons=>buttons.map(button=>{
      const style=getComputedStyle(button);return [style.backgroundColor,style.color,style.fontWeight,style.borderRadius,style.padding];
    }));
    assert.deepEqual(styles[2],styles[0]);assert.deepEqual(styles[2],styles[1]);
    assert.equal(styles[2][0],active?'rgb(63, 51, 44)':'rgb(255, 255, 255)');
  }
  console.log('sidebar PRODUCT matches DASHBOARD and POS in normal and active states');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();});
