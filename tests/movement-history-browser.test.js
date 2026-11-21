const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const assets=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(assets,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(assets+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
    browser=await chromium.launch({headless:true,executablePath});
    const page=await browser.newPage();
    await installIsolatedBrowser(page);
    await page.goto('http://127.0.0.1:'+server.address().port);
    await waitForIsolatedBootstrap(page);
    await page.evaluate(async()=>{
      await ensurePageCodeLoaded('inventorymovement');
      document.querySelectorAll('.login-screen').forEach(el=>el.style.display='none');
      warehouses=[{id:1,name:'A'},{id:2,name:'B'}];
      currentTab='inventorymovement';
      render=()=>{document.getElementById('main').innerHTML=renderInventoryMovement();attachEvents();};
      inventoryMovementFilter.period='today';
      sb.rpc=async(name,args)=>{
        if(name==='report_posted_adjustments')return {data:[{line_id:args.p_store,document_id:'count-'+args.p_store,document_no:'SAME',warehouse_id:args.p_store,
          movement_date:TODAY_STR,movement_time:'10:30',product_id:500,product_name:'Product '+args.p_store,unit_name:'box',difference:-3}]};
        throw Error('Incorrect document lookup');
      };
    });
    for(const store of [1,2]){
      await page.evaluate(async store=>{
        activeWarehouseId=store;currentProfile={id:'test',owner:true,level:1};
        await loadMovementAdjustments(movementAdjustmentRequest(inventoryMovementDateRange()),{});
        render();
      },store);
      const rows=page.locator('[data-movement-group]');
      assert.equal(await rows.count(),1);
      assert.match(await rows.textContent(),new RegExp('Product '+store));
      assert.equal(await page.getByRole('button',{name:/ดูประวัติ/}).count(),0);
      assert.deepEqual(await page.locator('.movement-report-table th').allTextContents(),['วันที่','เวลา','รายการ','บิล','สินค้า','เข้า-ออก']);
      assert.deepEqual((await rows.locator('td').allTextContents()).slice(1,4),['10:30','ปรับสต็อก','▶SAME']);
      await rows.click();
      assert.equal(await rows.getAttribute('aria-expanded'),'true');
      assert.match(await page.locator('.movement-detail-product').textContent(),new RegExp('Product '+store));
      await rows.press('Enter');
      assert.equal(await rows.getAttribute('aria-expanded'),'false');
      await page.evaluate(()=>{
        warehouseAccessRows=[{warehouse_id:activeWarehouseId,can_sell:true}];
        currentProfile.owner=false;render();
      });
      assert.equal(await rows.count(),1);
      assert.equal(await page.getByRole('button',{name:/ดูประวัติ/}).count(),0);
    }
    console.log('Both stores passed movement report column and expansion checks');
  }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
