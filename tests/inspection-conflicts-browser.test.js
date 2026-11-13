const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {installIsolatedBrowser,waitForIsolatedBootstrap}=require('./isolated-browser');
const root=path.resolve(__dirname,'../public');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const rows=new Map(),writes=[];
let browser,holdWrite,releaseWrite;
async function request({id,op,revision,patch}){
  if(op!=='read'){
    writes.push([id,op]);
    if(holdWrite)await new Promise(resolve=>{releaseWrite=resolve;});
  }
  const row=rows.get(id);
  if(op==='read')return row||null;
  if(!row||row.revision!==revision)return null;
  if(op==='delete'){rows.delete(id);return row;}
  assert.equal(op,'update');
  const saved={...row,...patch,revision:revision+1};
  rows.set(id,saved);return saved;
}
async function setup(page){
  await installIsolatedBrowser(page);
  await page.exposeFunction('inspectionRequest',request);
  await page.goto('http://127.0.0.1:'+server.address().port);
  await waitForIsolatedBootstrap(page);
  await page.evaluate(async records=>{
    await ensurePageCodeLoaded('stockcontrol');
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(el=>el.remove());
    document.getElementById('appRoot').hidden=false;
    currentProfile={id:'fixture-owner',owner:true,level:1,firstName:'เจ้าของ'};
    warehouses=[{id:1,name:'พระยาสุเรนทร์'},{id:2,name:'พรชัย'}];
    currentTab='stockcontrol';stockControlMode='count';activeWarehouseId=1;
    renderLoginState=()=>true;ensureOnDemandDataForTab=()=>({status:'ready'});isMobileDeviceMode=()=>false;
    clearTimeout(supabaseCoreSyncTimer);scheduleSupabaseCoreSync=()=>{};
    products=[1,2].map(wh=>({id:wh,wh,sku:String(wh),name:'สินค้า '+wh,unit:'กล่อง',stock:13*wh,units:[]}));
    inventoryBalanceRows=products.map(p=>({warehouse_id:p.wh,product_id:p.id,stock:p.stock}));rebuildInventoryBalanceMap();
    inventoryLotRows=products.map(p=>({warehouse_id:p.wh,product_id:p.id,id:p.id,quantity_base:p.stock,status:'active'}));rebuildInventoryLotMap();
    inspectionLists=records.map(rowToInspectionList);
    syncedTableRows.inspection_lists=tableSnapshot(inspectionLists,inspectionListToRow);
    sb.rpc=name=>{throw Error('Unexpected RPC '+name);};
    sb.from=table=>{
      if(table!=='inspection_lists')throw Error('Unexpected table '+table);
      const args={op:'read'};
      return {update(patch){Object.assign(args,{op:'update',patch});return this;},delete(){args.op='delete';return this;},
        select(){return this;},eq(k,v){args[k]=v;return this;},async maybeSingle(){return {data:await window.inspectionRequest(args),error:null};}};
    };
    render();
  },[...rows.values()]);
}
const edit=(page,id)=>page.locator('[data-open-inspection-list="'+id+'"]').click();
const save=async(page,name)=>{await page.locator('#inspectionListName').fill(name);await page.locator('#saveInspectionListBtn').click();};
const remove=async(page,id)=>{page.once('dialog',dialog=>dialog.accept());await page.locator('[data-delete-inspection-list="'+id+'"]').click();};
const toast=(page,text)=>page.locator('#toast').filter({hasText:text}).waitFor();
async function run(){
  for(const wh of [1,2])for(const type of ['edit','remove','done']){
    const id=type+wh;
    rows.set(id,{id,revision:1,data:{warehouseId:wh,name:id,items:[{pid:wh,unit:'กล่อง'}],createdAt:'2026-11-01T01:00:00Z',
      updatedAt:'2026-11-01T01:00:00Z',stockAdjustedAt:type==='done'?'2026-11-01T02:00:00Z':''}});
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executablePath=[process.env.PEPOS_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))||chromium.executablePath();
  browser=await chromium.launch({headless:true,executablePath});
  const a=await browser.newPage(),b=await browser.newPage();
  await setup(a);await setup(b);
  const actionCell=a.locator('.inspection-list-overview-action').filter({has:a.locator('[data-open-inspection-list]')}).first();
  assert.ok(await actionCell.evaluate(cell=>{
    const bounds=cell.getBoundingClientRect(),buttons=[...cell.querySelectorAll('button')];
    return buttons.length===3&&buttons.every(button=>{
      const box=button.getBoundingClientRect(),icon=button.querySelector('svg').getBoundingClientRect();
      return box.width===36&&box.height===36&&icon.width===18&&icon.height===18&&box.left>=bounds.left&&box.right<=bounds.right;
    });
  }));
  await a.evaluate(()=>openStockEditInspectionListPicker());
  const picker=a.locator('.stock-edit-import-modal');
  assert.ok(await picker.locator('.stock-edit-import-row').first().evaluate(card=>
    [...card.children].every(line=>getComputedStyle(line).textAlign==='center')));
  await picker.getByRole('button',{name:'ยกเลิก'}).click();
  for(const wh of [1,2]){
    for(const page of [a,b])await page.evaluate(wh=>{activeWarehouseId=wh;render();},wh);
    const id='edit'+wh;
    await edit(a,id);await edit(b,id);
    holdWrite=true;
    await save(a,'ชื่อจากเครื่องแรก');
    await a.waitForFunction(()=>document.querySelector('#inspectionListName')!==null);
    assert.equal(rows.get(id).revision,1);
    assert.doesNotMatch(await a.locator('#toast').innerText(),/บันทึกรายการตรวจสินค้าแล้ว/);
    assert.ok(releaseWrite);holdWrite=false;releaseWrite();releaseWrite=null;
    await toast(a,'บันทึกรายการตรวจสินค้าแล้ว');
    await save(b,'ชื่อที่ล้าสมัย');await toast(b,'เปลี่ยนจากเครื่องอื่น');
    await edit(b,id);assert.equal(await b.locator('#inspectionListName').inputValue(),'ชื่อจากเครื่องแรก');
    await b.locator('#cancelInspectionListBtn').click();
    await edit(a,id);await save(a,'ชื่อล่าสุด');await toast(a,'บันทึกรายการตรวจสินค้าแล้ว');
    await remove(b,id);
    await b.waitForFunction(id=>inspectionLists.find(row=>row.id===id)?.name==='ชื่อล่าสุด',id);
    assert.equal(rows.get(id).data.name,'ชื่อล่าสุด');
    await edit(b,'remove'+wh);await remove(a,'remove'+wh);await toast(a,'ลบรายการตรวจสินค้าแล้ว');
    await save(b,'ลบแล้ว');await toast(b,'ไม่พบรายการนี้บนเซิร์ฟเวอร์');
    assert.equal(await b.locator('[data-open-inspection-list="remove'+wh+'"]').count(),0);
    holdWrite=true;await remove(a,'done'+wh);
    assert.equal(await a.locator('[data-delete-inspection-list="done'+wh+'"]').count(),1);
    assert.ok(releaseWrite);holdWrite=false;releaseWrite();releaseWrite=null;
    await a.waitForFunction(id=>!inspectionLists.some(row=>row.id===id),'done'+wh);
    await remove(b,'done'+wh);await b.waitForFunction(id=>!inspectionLists.some(row=>row.id===id),'done'+wh);
    assert.match(await b.locator('#toast').innerText(),/ไม่พบรายการนี้บนเซิร์ฟเวอร์/);
    for(const page of [a,b])assert.deepEqual(await page.evaluate(()=>[warehouseStock(1,1),warehouseStock(2,2),...inventoryLotRows.map(l=>l.quantity_base)]),[13,26,13,26]);
    console.log('Confirmed edit/edit, edit/delete, delete/edit and delete/delete in warehouse',wh);
  }
  assert.equal(writes.length,16);
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
