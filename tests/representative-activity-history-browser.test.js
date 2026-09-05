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
  const page = await browser.newPage({viewport:{width:1600,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**', route => route.fulfill({contentType:'text/javascript',body:'window.XLSX={};'}));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({contentType:'text/javascript',body:`
    (()=>{
      const resultQuery=data=>{
        const query=new Proxy({}, {get(_target,property){
          if(property==='then') return resolve=>resolve({data,error:null});
          return ()=>query;
        }});
        return query;
      };
      const query=resultQuery([]);
      const normalized=value=>String(value||'').trim().toLocaleLowerCase('th-TH');
      const rpc=(name,args={})=>{
        window.__representativeRpcAssignments||=[...(window.representativeProductAssignments||[])];
        window.__representativeRpcNotes||=[...(window.representativeActivityNotes||[])];
        const assignments=window.__representativeRpcAssignments;
        const notes=window.__representativeRpcNotes;
        if(name==='get_representative_page'){
          if(window.__representativeRpcRepresentatives) window.salesRepresentatives=[...window.__representativeRpcRepresentatives];
          if(window.__representativeRpcProducts) window.products=[...window.__representativeRpcProducts];
          const representativeNeedle=normalized(args.p_representative_search);
          const productNeedle=normalized(args.p_product_search);
          const noteNeedle=normalized(args.p_note_search);
          let rows=(window.__representativeRpcRepresentatives||window.salesRepresentatives||[]).filter(representative=>{
            if(args.p_representative_id&&Number(representative.id)!==Number(args.p_representative_id)) return false;
            if(args.p_product_id&&!assignments.some(row=>Number(row.representativeId)===Number(representative.id)&&Number(row.productId)===Number(args.p_product_id))) return false;
            if(representativeNeedle&&!normalized([representative.name,representative.company,representative.code,representative.phone,representative.line].join(' ')).includes(representativeNeedle)) return false;
            if(productNeedle&&!assignments.filter(row=>Number(row.representativeId)===Number(representative.id)).some(row=>{
              const product=(window.products||[]).find(item=>Number(item.id)===Number(row.productId));
              return normalized([product?.name,product?.sku,product?.barcode].join(' ')).includes(productNeedle);
            })) return false;
            if(noteNeedle&&!notes.filter(note=>Number(note.representativeId)===Number(representative.id)).some(note=>normalized([note.title,note.contentHtml].join(' ')).includes(noteNeedle))) return false;
            return true;
          }).map(representative=>({representative_id:representative.id,representative_name:representative.name,sort_name:normalized(representative.name)}));
          rows.sort((a,b)=>a.sort_name.localeCompare(b.sort_name,'th')||a.representative_id-b.representative_id);
          if(args.p_cursor_name!=null) rows=rows.filter(row=>row.sort_name>args.p_cursor_name||(row.sort_name===args.p_cursor_name&&row.representative_id>Number(args.p_cursor_id)));
          return resultQuery(rows.slice(0,Number(args.p_limit||24)+1));
        }
        if(name==='get_representative_note_cards'){
          const ids=new Set((args.p_representative_ids||[]).map(Number)),needle=normalized(args.p_search),limit=Number(args.p_limit_per_representative||3);
          const rows=[];
          ids.forEach(id=>rows.push(...notes.filter(note=>Number(note.representativeId)===id&&(!needle||normalized([note.title,note.contentHtml].join(' ')).includes(needle))).sort((a,b)=>String(b.eventDate||'').localeCompare(String(a.eventDate||''))).slice(0,limit).map(note=>({id:note.id,title:note.title,content_html:note.contentHtml,hidden_from_level2:false,representative_id:note.representativeId,activity_type:note.activityType,event_date:note.eventDate,updated_at:note.updatedAt,representative_activity_items:[]}))));
          return resultQuery(rows);
        }
        if(name==='get_representative_note_metadata'){
          const ids=new Set((args.p_representative_ids||[]).map(Number)),requestedNoteIds=new Set((args.p_note_ids||[]).map(String));
          const rows=[];
          ids.forEach(id=>{
            const ranked=notes.filter(note=>Number(note.representativeId)===id).sort((a,b)=>String(a.createdAt||a.updatedAt||a.eventDate||'').localeCompare(String(b.createdAt||b.updatedAt||b.eventDate||''))||String(a.id).localeCompare(String(b.id)));
            const selected=ranked.map((note,index)=>({note,index})).filter(({note})=>requestedNoteIds.has(String(note.id)));
            if(!selected.length) rows.push({representative_id:id,note_id:null,note_number:null,note_count:ranked.length});
            else selected.forEach(({note,index})=>rows.push({representative_id:id,note_id:note.id,note_number:index+1,note_count:ranked.length}));
          });
          return resultQuery(rows);
        }
        if(name==='get_representative_notes_page'){
          const needle=normalized(args.p_search);
          const rows=notes.filter(note=>Number(note.representativeId)===Number(args.p_representative_id)&&(!needle||normalized([note.title,note.contentHtml].join(' ')).includes(needle))).sort((a,b)=>String(b.eventDate||'').localeCompare(String(a.eventDate||''))).slice(0,Number(args.p_limit||50)+1).map(note=>({id:note.id,title:note.title,content_html:note.contentHtml,hidden_from_level2:false,representative_id:note.representativeId,activity_type:note.activityType,event_date:note.eventDate,updated_at:note.updatedAt,representative_activity_items:[]}));
          return resultQuery(rows);
        }
        return query;
      };
      window.supabase={createClient:()=>new Proxy({
        auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},rpc
      }, {get(target,property){return property in target?target[property]:(()=>query);}})};
    })();
  `}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => typeof renderRepresentativeHistory === 'function');

  await page.evaluate(() => {
    currentProfile={id:'owner-test',level:1,owner:true,firstName:'เจ้าของ'};
    warehouses=[{id:1,name:'คลังทดสอบ'}]; activeWarehouseId=1; warehouseAccessRows=[];
    salesRepresentatives=[
      {id:10,code:'REP-10',name:'PEPO',phone:'081-234-5678',line:'pepo.line',company:'บริษัทตัวแทน A',note:'ดูแลเขตกรุงเทพฯ'},
      {id:11,code:'REP-11',name:'NANA',company:'บริษัทตัวแทน B'},
      {id:12,code:'REP-12',name:'JOJO',company:'บริษัทตัวแทน C'},
      {id:13,code:'REP-13',name:'MAYA',company:'บริษัทตัวแทน D'},
      {id:14,code:'REP-14',name:'RINA',company:'บริษัทตัวแทน E'}
    ];
    products=[
      {id:20,sku:'LIP10',name:'LIPITOR 10 MG',unit:'กล่อง',barcode:'8850000000001',extraBarcodes:[],supplierBarcodes:[]},
      {id:21,sku:'LIP20',name:'LIPITOR 20 MG',unit:'กล่อง',barcode:'8850000000002',extraBarcodes:[],supplierBarcodes:[]},
      {id:22,sku:'LIP30',name:'LIPITOR 30 MG',unit:'กล่อง',barcode:'8850000000003',extraBarcodes:[],supplierBarcodes:[]},
      {id:23,sku:'LIP40',name:'LIPITOR 40 MG',unit:'กล่อง',barcode:'8850000000004',extraBarcodes:[],supplierBarcodes:[]}
    ];
    window.__representativeRpcRepresentatives=[...salesRepresentatives];
    window.__representativeRpcProducts=[...products];
    representativeHistoryContext={representativeId:10,productId:null,originTab:'salesreps'};
    representativeProductAssignments=[
      {representativeId:10,productId:20},{representativeId:10,productId:21},{representativeId:10,productId:22}
    ];
    representativeActivityNotes=[
      {id:'note-1',title:'เล่นรายการทอง',contentHtml:'<p>บลาบลาบลา</p>',hiddenFromLevel2:false,representativeId:10,activityType:'general',eventDate:'2026-09-04',updatedAt:'2026-09-04T10:00:00Z'},
      {id:'note-2',title:'ซื้อครบไปเที่ยวฟรี',contentHtml:'<p>ซื้อครบตามยอดที่กำหนด</p>',hiddenFromLevel2:false,representativeId:10,activityType:'general',eventDate:'2026-09-02',updatedAt:'2026-09-02T10:00:00Z'},
      {id:'note-5',title:'แผนสั่งเดือนหน้า',contentHtml:'<p>เตรียมยอดสั่งซื้อ</p>',hiddenFromLevel2:false,representativeId:10,activityType:'general',eventDate:'2026-09-01',updatedAt:'2026-09-01T09:00:00Z'}
    ];
    representativeNoteMetadata=new Map([['note-1',{number:3,total:3}],['note-2',{number:2,total:3}],['note-5',{number:1,total:3}]]);
    representativeNoteTotals=new Map([[10,3]]);
    representativeActivityLoadedKey=representativeHistoryKey();
    currentTab='salesreps';
    document.getElementById('main').innerHTML=renderSalesRepresentatives();
    attachEvents();
    document.querySelectorAll('.login-screen,.warehouse-choice-screen').forEach(screen=>{screen.style.display='none';});
  });

  assert.equal(await page.locator('.representative-history-page h1').count(),0,'representative detail page must not repeat its heading');
  assert.doesNotMatch(await page.locator('.representative-history-page').textContent(),/ค้นหาผู้แทน สินค้าที่ดูแล และ NOTE ได้จากหน้าเดียว/);
  assert.equal(await page.locator('.representative-profile-panel').count(),1);
  const profileText=await page.locator('.representative-profile-panel').textContent();
  assert.match(profileText,/ชื่อผู้แทน/);
  assert.doesNotMatch(profileText,/^สินค้าที่ดูแล$/m);
  assert.match(profileText,/คลิกเพื่อดูสินค้าที่ผู้แทนดูแล/);
  const profileAlignment=await page.locator('.representative-profile-field').evaluateAll(elements=>elements.map(element=>({textAlign:getComputedStyle(element).textAlign,justifyContent:getComputedStyle(element).justifyContent})));
  assert.ok(profileAlignment.every(style=>style.textAlign==='center'&&style.justifyContent==='center'),'representative profile content must be centered inside every cell');
  assert.doesNotMatch(profileText,/LIPITOR 10 MG/,'profile must not expand managed product names');
  assert.match(profileText,/เบอร์โทร\s*081-234-5678/);
  assert.match(profileText,/ไลน์\s*pepo\.line/);
  assert.match(profileText,/บริษัท\s*บริษัทตัวแทน A/);
  assert.match(profileText,/ข้อมูลเพิ่มเติม\s*ดูแลเขตกรุงเทพฯ/);
  assert.equal(await page.locator('.representative-note-list-item').count(),3);
  assert.match(await page.locator('.representative-note-list-panel').textContent(),/NOTE 3[\s\S]*NOTE 2[\s\S]*NOTE 1/);
  assert.match(await page.locator('.representative-note-list-item').first().textContent(),/NOTE 3 : เล่นรายการทอง[\s\S]*04 \/ 09 \/ 2026/);
  assert.doesNotMatch(await page.locator('.representative-note-list-item').first().textContent(),/วันที่/);
  assert.equal(await page.locator('.representative-note-inline-caption').count(),0,'repeated NOTE title and date caption must be removed from the editor');
  assert.equal((await page.locator('label[for="repActivityTitle"]').textContent()).trim(),'NOTE 3');
  assert.equal(await page.locator('#repActivityTitle').inputValue(),'เล่นรายการทอง');
  assert.equal(await page.locator('#repActivityEventDate').inputValue(),'04/09/2026');
  assert.equal(await page.locator('#repActivityEventDate').getAttribute('placeholder'),'วว/ดด/ปปปป');
  assert.match(await page.locator('#repActivityContentEditor').textContent(),/บลาบลาบลา/);
  assert.equal(await page.locator('[data-edit-representative-activity]').count(),0,'representative NOTE must not show a separate edit button');
  await page.locator('.representative-note-list-item').nth(1).click();
  assert.equal((await page.locator('label[for="repActivityTitle"]').textContent()).trim(),'NOTE 2');
  assert.equal(await page.locator('#repActivityTitle').inputValue(),'ซื้อครบไปเที่ยวฟรี');
  assert.equal(await page.locator('#repActivityEventDate').inputValue(),'02/09/2026');
  await page.locator('#repActivityEventDate').fill('05/10/2026');
  await page.locator('#repActivityEventDate').dispatchEvent('change');
  assert.equal(await page.evaluate(()=>representativeActivityDraft.eventDate),'2026-10-05');
  assert.equal(await page.locator('#repActivityEventDate').inputValue(),'05/10/2026');
  assert.equal(await page.locator('#repActivityContentEditor').getAttribute('contenteditable'),'true');
  assert.match(await page.locator('#repActivityContentEditor').textContent(),/ซื้อครบตามยอดที่กำหนด/);
  await page.locator('#repActivityTitle').fill('ซื้อครบรับของแถม');
  assert.equal(await page.locator('#repActivityTitle').inputValue(),'ซื้อครบรับของแถม');
  assert.equal((await page.locator('label[for="repActivityTitle"]').textContent()).trim(),'NOTE 2','NOTE number must replace the old title label');
  await page.evaluate(()=>{ representativeActivityDraftDirty=false; });
  assert.equal(await page.locator('.representative-history-summary').count(),0,'summary cards must not appear on representative history');
  const workspaceColumns=await page.locator('.representative-note-workspace').evaluate(element=>{
    const [list,detail]=element.children;
    return {listRight:list.getBoundingClientRect().right,detailLeft:detail.getBoundingClientRect().left,listWidth:list.getBoundingClientRect().width,detailWidth:detail.getBoundingClientRect().width};
  });
  assert.ok(workspaceColumns.detailLeft>workspaceColumns.listRight,'NOTE list must be on the left and selected NOTE detail on the right');
  assert.ok(Math.abs((workspaceColumns.listWidth/workspaceColumns.detailWidth)-0.5)<0.04,'NOTE list must use one third and NOTE detail two thirds of the available width');
  assert.equal(await page.locator('.representative-note-search #newRepresentativeActivityBtn').count(),1,'add NOTE button must be next to NOTE search');
  const historyPageWidth=await page.locator('.representative-history-page').evaluate(element=>{
    const parent=element.parentElement;
    const parentStyle=getComputedStyle(parent);
    return {
      actual:Math.round(element.getBoundingClientRect().width),
      available:Math.round(parent.clientWidth-parseFloat(parentStyle.paddingLeft)-parseFloat(parentStyle.paddingRight))
    };
  });
  assert.ok(Math.abs(historyPageWidth.actual-historyPageWidth.available)<=2,'representative history must use the full content width like purchase orders');

  await page.locator('#newRepresentativeActivityBtn').click();
  assert.equal(await page.locator('.representative-note-editor-modal').count(),0);
  assert.equal(await page.locator('.representative-note-inline-editor').count(),1);
  assert.equal((await page.locator('label[for="repActivityTitle"]').textContent()).trim(),'NOTE 4');
  assert.equal(await page.locator('.representative-note-inline-caption').count(),0);
  assert.equal(await page.locator('#repActivityEventDate,#repActivityTitle,#repActivityContentEditor').count(),3);
  assert.equal(await page.locator('.representative-note-toolbar').count(),1);
  assert.equal(await page.locator('[data-representative-note-command]').count(),3);
  assert.equal(await page.locator('[data-representative-note-color]').count(),8);
  assert.equal(await page.locator('#repActivityContent').count(),0,'representative NOTE must use the formatted editor instead of a plain textarea');
  assert.equal(await page.locator('#repActivityRepresentative,#representativeManagedProductSearch,.representative-activity-item-editor').count(),0,'NOTE editor must no longer contain representative or product assignment fields');
  const representativeContentEditor=page.locator('#repActivityContentEditor');
  await representativeContentEditor.fill('ข้อความสำคัญ');
  await representativeContentEditor.selectText();
  await page.locator('[data-representative-note-command="bold"]').click();
  assert.match(await representativeContentEditor.innerHTML(),/<b>ข้อความสำคัญ<\/b>/i,'bold formatting must be applied to representative NOTE content');
  await representativeContentEditor.selectText();
  await page.locator('[data-representative-note-color="#B42318"]').click();
  assert.match(await representativeContentEditor.innerHTML(),/#b42318|rgb\(180,\s*35,\s*24\)/i,'text color must be applied to representative NOTE content');
  await page.evaluate(()=>{ representativeActivityDraftDirty=false; });
  await page.locator('.representative-note-list-item').first().click();

  const managedProductsTrigger=page.locator('[data-manage-representative-products="10"]');
  assert.equal((await managedProductsTrigger.textContent()).trim(),'คลิกเพื่อดูสินค้าที่ผู้แทนดูแล');
  await managedProductsTrigger.click();
  assert.equal(await page.locator('.representative-products-modal').count(),1);
  assert.equal(await page.locator('#representativeProductsSelectedCount').textContent(),'3');
  assert.equal(await page.locator('#representativeProductsSelectedList .representative-product-selected-card').count(),3);
  assert.equal(await page.locator('#representativeProductsSelectedList input').count(),0,'selected product cards must not repeat checkboxes');
  assert.equal(await page.locator('#representativeProductsDropdown:visible').count(),0,'search dropdown must stay closed before typing');
  assert.equal(await page.locator('.representative-products-options').count(),0,'the permanent product list must be removed');
  const selectedListStyle=await page.locator('#representativeProductsSelectedList').evaluate(element=>({border:getComputedStyle(element).borderTopWidth,background:getComputedStyle(element).backgroundColor}));
  assert.equal(selectedListStyle.border,'0px','selected products must not have an outer frame');
  assert.match(selectedListStyle.background,/rgba\(0, 0, 0, 0\)|transparent/,'selected products must not have an outer background');
  await page.locator('#representativeProductsSearch').fill('LIP40');
  assert.equal(await page.locator('#representativeProductsDropdown:visible').count(),1);
  assert.equal(await page.locator('[data-add-representative-product="23"]').count(),1);
  await page.locator('[data-add-representative-product="23"]').click();
  assert.equal(await page.locator('#representativeProductsSelectedCount').textContent(),'4');
  assert.match(await page.locator('#representativeProductsSelectedList').textContent(),/LIPITOR 40 MG/);
  assert.equal(await page.locator('#representativeProductsSearch').inputValue(),'');
  assert.equal(await page.locator('#representativeProductsDropdown:visible').count(),0,'search dropdown must close after selecting a product');
  await page.locator('#cancelRepresentativeProductsEditorBtn').click();

  await page.locator('[data-act="editsalesrep"][data-id="10"]').click();
  assert.equal(await page.locator('.representative-editor-modal').count(),1);
  assert.equal(await page.locator('#sr_name').inputValue(),'PEPO');
  assert.equal(await page.locator('#sr_phone').inputValue(),'081-234-5678');
  await page.locator('#cancelSalesRepBottomBtn').click();

  await page.evaluate(() => {
    currentTab='representativehistory';
    representativeHistoryContext=centralRepresentativeHistoryContext();
    representativeHistoryFilter=emptyRepresentativeHistoryFilter();
    representativeProductAssignments=[
      {representativeId:10,productId:20},{representativeId:10,productId:21},{representativeId:10,productId:22},
      {representativeId:11,productId:20},{representativeId:12,productId:21},
      {representativeId:13,productId:20},{representativeId:14,productId:21}
    ];
    representativeActivityNotes=[...representativeActivityNotes,
      {id:'note-6',title:'ราคาพิเศษรอบใหม่',contentHtml:'<p>ใช้ถึงสิ้นเดือน</p>',hiddenFromLevel2:false,representativeId:10,activityType:'general',eventDate:'2026-09-05',updatedAt:'2026-09-05T10:00:00Z'},
      {id:'note-7',title:'ราคาเปิดร้าน',contentHtml:'<p>ข้อมูลเดิม</p>',hiddenFromLevel2:false,representativeId:10,activityType:'general',eventDate:'2026-08-31',updatedAt:'2026-08-31T10:00:00Z'},
      {id:'note-3',title:'แจ้งรอบส่งสินค้า',contentHtml:'<p>ส่งทุกวันจันทร์</p>',hiddenFromLevel2:false,representativeId:11,activityType:'general',eventDate:'2026-09-03',updatedAt:'2026-09-03T10:00:00Z'},
      {id:'note-4',title:'รายการหน้าฝน',contentHtml:'<p>เริ่มเดือนหน้า</p>',hiddenFromLevel2:false,representativeId:12,activityType:'general',eventDate:'2026-09-01',updatedAt:'2026-09-01T10:00:00Z'}
    ];
    representativeNoteMetadata=new Map();
    representativeNoteTotals=new Map();
    window.__representativeRpcAssignments=[...representativeProductAssignments];
    window.__representativeRpcNotes=[...representativeActivityNotes];
    representativeActivityLoadedKey=representativeHistoryKey();
    document.getElementById('topbarFormActions').innerHTML='';
    document.getElementById('main').innerHTML=renderRepresentativeHistoryOverview();
    attachEvents();
    syncTopbarFormActions();
  });
  assert.equal(await page.locator('.representative-group-card').count(),5);
  assert.equal(await page.locator('[data-representative-card-open="10"] .representative-note-card').count(),3,'overview must show no more than three NOTE cards');
  assert.equal((await page.locator('[data-representative-card-open="10"] .representative-note-overflow').textContent()).trim(),'+2');
  assert.equal(await page.locator('#representativeHistoryRepresentativeSearch,#representativeHistoryProductSearch,#representativeHistoryNoteSearch').count(),3);
  assert.equal(await page.locator('#newSalesRepBtn').count(),1,'central representative history must add representatives directly');
  assert.equal(await page.locator('.topbar-form-actions .representative-topbar-actions').evaluate(element=>getComputedStyle(element).gap),'12px','representative TOPBAR actions must not touch each other');
  await page.locator('#newSalesRepBtn').click();
  assert.equal(await page.locator('.representative-editor-modal').count(),1);
  assert.equal(await page.locator('.representative-editor-actions').evaluate(element=>getComputedStyle(element).gap),'14px','representative editor actions must have comfortable spacing');
  assert.equal(await page.locator('#sr_name').inputValue(),'');
  await page.locator('#cancelSalesRepBottomBtn').click();
  const cardPositions=await page.locator('.representative-group-card').evaluateAll(elements=>elements.map(element=>Math.round(element.getBoundingClientRect().y)));
  assert.equal(new Set(cardPositions.slice(0,3)).size,1,'representative cards must display three per row on desktop');
  assert.ok(cardPositions[3]>cardPositions[0],'the fourth representative card must start the next row');
  assert.equal(cardPositions[3],cardPositions[4],'the fourth and fifth representative cards must share the second row');
  assert.equal(await page.locator('.representative-note-owner').count(),0,'notes must remain inside their representative card');
  assert.match(await page.locator('.representative-note-card').first().textContent(),/NOTE 1 :[\s\S]*\d{2} \/ \d{2} \/ \d{4}/,'overview NOTE date must be on its own spaced date line');
  assert.equal(await page.locator('.representative-note-body').first().evaluate(element=>getComputedStyle(element).webkitLineClamp),'5','overview note details must be limited to five lines');

  await page.locator('#representativeHistoryRepresentativeSearch').fill('NANA');
  await page.locator('#searchRepresentativeHistoryBtn').click();
  await page.waitForFunction(()=>document.querySelectorAll('.representative-group-card').length===1&&document.querySelector('.representative-group-card')?.textContent.includes('NANA'));
  assert.equal(await page.locator('.representative-group-card').count(),1);
  assert.match(await page.locator('.representative-group-card').textContent(),/NANA/);
  await page.locator('#representativeHistoryRepresentativeSearch').fill('');
  await page.locator('#representativeHistoryProductSearch').fill('LIPITOR 30');
  await page.locator('#representativeHistoryProductSearch').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.representative-group-card').length===1&&document.querySelector('.representative-group-card')?.textContent.includes('PEPO'));
  assert.equal(await page.locator('.representative-group-card').count(),1);
  assert.match(await page.locator('.representative-group-card').textContent(),/PEPO/);
  await page.locator('#representativeHistoryProductSearch').fill('');
  await page.locator('#representativeHistoryNoteSearch').fill('หน้าฝน');
  await page.locator('#searchRepresentativeHistoryBtn').click();
  await page.waitForFunction(()=>document.querySelectorAll('.representative-group-card').length===1&&document.querySelector('.representative-group-card')?.textContent.includes('JOJO'));
  assert.equal(await page.locator('.representative-group-card').count(),1);
  assert.match(await page.locator('.representative-group-card').textContent(),/JOJO/);

  await page.locator('#representativeHistoryNoteSearch').fill('');
  await page.locator('#searchRepresentativeHistoryBtn').click();
  await page.waitForFunction(()=>document.querySelectorAll('.representative-group-card').length===5);
  assert.equal(await page.locator('.representative-group-card').count(),5);
  await page.locator('[data-representative-card-open="10"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.representative-profile-panel').length===1);
  assert.equal(await page.locator('.representative-profile-panel').count(),1,'clicking a representative card must open the representative profile');
  assert.equal(await page.locator('.representative-note-workspace').count(),1);
  await page.evaluate(()=>openRepresentativeHistory({productId:20,originTab:'representativehistory'}));
  assert.equal(await page.locator('.representative-history-page h1').textContent(), 'ผู้แทนที่ดูแล LIPITOR 10 MG');
  assert.equal(await page.locator('#closeRepresentativeHistoryBtn').count(),1);
  assert.deepEqual(errors, []);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
});
