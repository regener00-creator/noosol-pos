const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..',process.env.PEPOS_TEST_STATIC==='1'?'public':'');
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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file)) || chromium.executablePath();

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert.ok(browserExecutable, 'ไม่พบ Chrome หรือ Edge สำหรับทดสอบหน้าเว็บ');
  browser = await chromium.launch({headless:true,executablePath:browserExecutable});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const query=new Proxy({}, {get(_target,property){
        if(property==='then') return resolve=>resolve({data:null,error:null});
        return ()=>query;
      }});
      window.supabase={createClient:()=>new Proxy({
        auth:{
          getSession:async()=>({data:{session:null}}),
          onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
          signOut:async()=>({error:null})
        }
      }, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof ensurePageCodeLoaded === 'function');
  await page.evaluate(async()=>{await ensurePageCodeLoaded('settingscategories');await ensurePageCodeLoaded('products');});
  await page.waitForTimeout(500);

  await page.evaluate(()=>{
    currentProfile={id:'category-test',owner:true,level:1};
    products=[{id:1,name:'เดิม',category:'ยา',brand:'ยาคุม',unit:'กล่อง',price:20,stock:0,units:[]}];
    productCategorySettings={categories:['ยา','อาหารเสริม'],subcategories:[]};
    productCategorySettingsLoaded=true;
    window.testCategoryStore=JSON.parse(JSON.stringify(productCategorySettings));
    window.testCategoryFail=false;
    sb.rpc=async(name,args)=>{
      if(name==='owner_set_setting'){
        if(window.testCategoryFail)return {error:{message:'เครือข่ายขัดข้อง'}};
        window.testCategoryStore=JSON.parse(JSON.stringify(args.p_value));
      }
      return {error:null};
    };
    sb.from=()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{value:window.testCategoryStore},error:null})})})});
    persistWorkspaceData=()=>Promise.resolve(true);
    currentTab='settingscategories';
    render=()=>{document.getElementById('main').innerHTML=renderProductCategorySettings();attachEvents();};
    render();
    document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
    document.getElementById('appRoot').style.display='';
  });
  await page.locator('[data-category-edit="sub"][data-name=""]').click();
  await page.locator('#categorySettingsName').fill('BLACKMORES');
  await page.locator('[name="categoryParent"][value="ยา"]').check();
  await page.locator('[name="categoryParent"][value="อาหารเสริม"]').check();
  await page.locator('#saveCategorySettings').click();
  await page.waitForFunction(()=>!document.querySelector('#categorySettingsForm'));
  assert.equal(await page.evaluate(()=>testCategoryStore.subcategories.find(row=>row.name==='BLACKMORES').categories.length),2);
  await page.locator('[data-category-edit="main"][data-name=""]').click();
  assert.equal(await page.locator('#categorySettingsName').count(),1,JSON.stringify({errors,state:await page.evaluate(()=>({tab:currentTab,owner:currentProfile?.owner,loaded:productCategorySettingsLoaded,loading:productCategorySettingsLoading,filter:productCategoryFilter}))}));
  await page.locator('#categorySettingsName').fill('เครื่องสำอาง');
  await page.evaluate(()=>window.testCategoryFail=true);
  await page.locator('#saveCategorySettings').click();
  await page.waitForFunction(()=>document.querySelector('#categorySettingsFeedback').textContent.includes('ลองใหม่'));
  assert.equal(await page.evaluate(()=>productCategorySettings.categories.includes('เครื่องสำอาง')),false);
  await page.evaluate(()=>window.testCategoryFail=false);
  await page.locator('#saveCategorySettings').click();
  await page.waitForFunction(()=>!document.querySelector('#categorySettingsForm'));
  assert.equal(await page.locator('[data-category-filter=""]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-category-filter="ยา"]').click();
  assert.equal(await page.locator('[data-category-filter="ยา"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.product-category-filter-card.is-selected').count(),1);
  assert.equal(await page.locator('[data-category-edit="sub"][data-name="ยาคุม"]').count(),1);
  assert.equal(await page.locator('[data-category-edit="sub"][data-name="BLACKMORES"]').count(),1);
  await page.locator('[data-category-filter="อาหารเสริม"]').click();
  assert.equal(await page.locator('[data-category-edit="sub"][data-name="ยาคุม"]').count(),0);
  assert.equal(await page.locator('[data-category-edit="sub"][data-name="BLACKMORES"]').count(),1);
  await page.locator('[data-category-edit="main"][data-name="ยา"]').click();
  assert.equal(await page.evaluate(()=>productCategoryFilter),'อาหารเสริม','edit icon must not change the filter');
  await page.locator('#cancelCategorySettings').click();
  await page.locator('[data-category-edit="sub"][data-name="BLACKMORES"]').click();
  assert.equal(await page.locator('[name="categoryParent"][value="ยา"]').isChecked(),true,'edit keeps existing parent assignments');
  assert.equal(await page.locator('[name="categoryParent"][value="อาหารเสริม"]').isChecked(),true);
  await page.locator('#cancelCategorySettings').click();
  await page.locator('[data-category-edit="sub"][data-name=""]').click();
  assert.equal(await page.locator('[name="categoryParent"][value="อาหารเสริม"]').isChecked(),true,'new subcategory defaults to selected main category');
  assert.equal(await page.locator('[name="categoryParent"][value="ยา"]').isChecked(),false);
  await page.locator('#categorySettingsName').fill('วิตามิน');
  await page.locator('#saveCategorySettings').click();
  await page.waitForFunction(()=>!document.querySelector('#categorySettingsForm'));
  assert.deepEqual(await page.evaluate(()=>testCategoryStore.subcategories.find(row=>row.name==='วิตามิน').categories),['อาหารเสริม']);
  assert.equal(await page.locator('[data-category-filter="อาหารเสริม"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-category-filter="เครื่องสำอาง"]').click();
  assert.equal(await page.locator('.product-category-grid-list').nth(1).locator('.manage-item').count(),1,'empty group still shows General');
  assert.equal(await page.locator('.product-category-grid-list').nth(1).getByText('ทั่วไป',{exact:true}).count(),1);
  await page.locator('[data-category-filter="ยา"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-category-filter="ยา"]').getAttribute('aria-pressed'),'true');
  await page.screenshot({path:path.join(os.tmpdir(),'sapuri-category-filter.png'),fullPage:true});
  await page.locator('[data-category-filter=""]').click();
  assert.equal(await page.locator('[data-category-edit="sub"][data-name="ยาคุม"]').count(),1);
  assert.equal(await page.locator('[data-category-edit="sub"][data-name="วิตามิน"]').count(),1);
  await page.locator('[data-category-edit="sub"][data-name=""]').click();
  assert.equal(await page.locator('[name="categoryParent"]:checked').count(),0,'All does not preselect a parent');
  await page.locator('#cancelCategorySettings').click();
  await page.locator('[data-category-edit="sub"][data-name="ยาคุม"]').click();
  assert.equal(await page.locator('[name="categoryParent"][value="ยา"]').isDisabled(),true);
  await page.locator('#cancelCategorySettings').click();
  await page.evaluate(()=>{productCategorySettings={categories:[],subcategories:[]};});
  await page.locator('#reloadProductCategories').click();
  await page.waitForFunction(()=>productCategorySettings.categories.includes('เครื่องสำอาง'));
  await page.screenshot({path:path.join(os.tmpdir(),'sapuri-category-settings.png'),fullPage:true});
  await page.evaluate(()=>{
    editingProductId='new';currentTab='products';
    document.getElementById('main').innerHTML=renderProductForm();attachEvents();
  });
  assert.equal(await page.locator('#f_category').inputValue(),'');
  assert.equal(await page.locator('#f_brand').inputValue(),'ทั่วไป');
  await page.locator('#f_category').selectOption('ยา');
  assert.equal(await page.locator('#f_brand option[value="ยาคุม"]').count(),1);
  await page.locator('#f_brand').selectOption('BLACKMORES');
  await page.locator('#f_category').selectOption('อาหารเสริม');
  assert.equal(await page.locator('#f_brand').inputValue(),'BLACKMORES');
  assert.equal(await page.locator('#f_brand option[value="ยาคุม"]').count(),0);
  await page.locator('#f_category').selectOption('เครื่องสำอาง');
  assert.equal(await page.locator('#f_brand').inputValue(),'ทั่วไป');
  await page.locator('#f_category').selectOption('');
  await page.locator('#f_name').fill('สินค้าทดสอบ');
  await page.evaluate(()=>{window.lastCategoryToast='';showToast=message=>{window.lastCategoryToast=message;};});
  await page.locator('#saveProductBtn').click();
  assert.match(await page.evaluate(()=>lastCategoryToast),/เลือกหมวดสินค้าหลัก/);
  assert.equal(await page.evaluate(()=>products.length),1);
  await page.evaluate(()=>{
    selectedGroup={cat:'ยา',brand:'ทั่วไป'};editingProductId=null;
    products.push({id:2,name:'ไม่มีหมวดย่อย',category:'ยา',brand:'',unit:'กล่อง',price:10,units:[]});
    document.getElementById('main').innerHTML=renderProducts();attachEvents();
  });
  assert.equal(await page.locator('[data-product-category="เครื่องสำอาง"]').count(),1);
  assert.equal(await page.locator('[data-product-brand="ทั่วไป"]').count(),1);
  assert.equal(await page.locator('.prodtable input[data-field="name"][value="ไม่มีหมวดย่อย"]').count(),1);
  assert.equal(await page.locator('.prodtable input[data-field="name"][value="เดิม"]').count(),0);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
    mobileProductEditor={draft:{name:'ทดสอบ',category:'ยา',brand:'BLACKMORES',unit:'กล่อง',price:1,units:[]},token:'test'};
    editingProductId='new';
    document.getElementById('main').innerHTML=renderProductForm({mobile:true});
    attachProductCategorySelectEvents();
  });
  await page.locator('#f_category').selectOption('เครื่องสำอาง');
  assert.equal(await page.locator('#f_brand').inputValue(),'ทั่วไป');
  const geometry=await page.evaluate(()=>{const a=document.querySelector('#f_category').getBoundingClientRect(),b=document.querySelector('#f_brand').getBoundingClientRect();return {stacked:b.top>a.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.equal(geometry.stacked,true);
  await page.screenshot({path:path.join(os.tmpdir(),'sapuri-category-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Category settings, multi-parent choices, retry, reload and required product category passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
