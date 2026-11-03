// Windows-only integration: the testing build renders PDFs instead of spooling
// paper. Production has no test/export endpoint or fake-printer option.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(root,'outputs/direct-print-test-'));
const token=randomBytes(32).toString('hex'),port=17840,origin='https://pepo-pharmacy.vercel.app';
fs.writeFileSync(path.join(folder,'paired.json'),JSON.stringify([token]));
let helper;
async function request(endpoint,data={},headers={}){
  const response=await fetch(`http://127.0.0.1:${port}${endpoint}`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  return {status:response.status,body:await response.json()};
}
async function start(){
  helper=spawn(path.join(root,'outputs/SAPURI-Print-Test/SAPURI-Print.exe'),['--test-server',folder,String(port)],{windowsHide:true});
  for(let i=0;i<80;i++){try{if((await request('/status')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,200));}
  throw new Error('Test bridge did not start');
}
async function wait(id){
  for(let i=0;i<100;i++){const result=await request('/job',{id});if(!['queued','printing'].includes(result.body.state))return result.body;await new Promise(r=>setTimeout(r,300));}
  throw new Error('Native rendering timed out');
}
(async()=>{
  await start();
  assert.equal((await request('/printers')).body.printers.length,3);
  assert.equal((await request('/printers',{}, {Origin:'https://evil.example'})).status,403);
  assert.equal((await request('/printers',{}, {Authorization:'Bearer '+'0'.repeat(64)})).status,403);
  assert.equal((await request('/printers',{}, {Origin:'null'})).status,403);
  assert.equal(await new Promise((resolve,reject)=>{const r=require('node:http').request({hostname:'127.0.0.1',port,path:'/printers',method:'POST',headers:{Host:'evil.example:'+port,Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':2}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end('{}');}),403);
  const headers=await fetch(`http://127.0.0.1:${port}/print`,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(headers.status,204);assert.equal(headers.headers.get('Access-Control-Allow-Origin'),origin);
  const a4={id:randomBytes(16).toString('hex'),kind:'a4',width:210,height:297,html:'<!doctype html><html><head><style>@page{size:A4;margin:15mm}body{font-family:Sarabun}</style></head><body><h1>SAPURI A4 ทดสอบ</h1><p>ไม่ใช่รายการขาย</p><script>document.body.innerHTML="SCRIPT_EXECUTED"</script></body></html>'};
  assert.match((await request('/print',a4)).body.error,/ยังไม่ได้เลือก/);
  assert.equal((await request('/settings',{kind:'a4',printer:'Unknown'})).status,400);
  for(const [kind,printer] of Object.entries({receipt:'Test Receipt',a4:'Test A4',barcode:'Test Barcode'}))assert.equal((await request('/settings',{kind,printer})).status,200);
  const receipt={...a4,id:randomBytes(16).toString('hex'),kind:'receipt',width:80,height:200,html:'<!doctype html><html><head><style>@page{size:auto;margin:0}body{margin:0;font-family:Sarabun}.receipt{width:80mm;box-sizing:border-box;padding:4mm;font-weight:600}small{font-size:9pt}</style></head><body><main class="receipt"><h2>SAPURI RECEIPT</h2><p>ทดสอบใบเสร็จ</p><small>2 กล่อง × 125.00</small><p>250.00 บาท</p></main></body></html>'};
  const barcode={...a4,id:randomBytes(16).toString('hex'),kind:'barcode',width:50,height:30,html:'<!doctype html><html><head><style>@page{size:50mm 30mm;margin:0}body{margin:0;font-family:"Noto Sans Thai"}.label{width:50mm;height:30mm;page-break-after:always}.label:last-child{page-break-after:auto}</style></head><body><div class="label">BARCODE หนึ่ง<svg width="130" height="30"><path d="M0 0h3v30H0zM8 0h5v30H8zM18 0h2v30h-2z"/></svg></div><div class="label">BARCODE สอง</div></body></html>'};
  for(const doc of [a4,receipt,barcode]){
    assert.equal((await request('/print',doc)).status,200);
    const result=await wait(doc.id);assert.equal(result.state,'sent',result.message);
    const pdf=path.join(folder,'exports',doc.id+'.pdf');assert.ok(fs.statSync(pdf).size>1000);
    const pdfSource=fs.readFileSync(pdf).toString('latin1'),boxes=[...pdfSource.matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g)];
    assert.equal(boxes.length,doc.kind==='barcode'?2:1,'paper pagination matches the document');
    assert.ok(Math.abs(Number(boxes[0][1])*25.4/72-doc.width)<0.5,'physical paper width');
    if(doc.kind!=='receipt')assert.ok(Math.abs(Number(boxes[0][2])*25.4/72-doc.height)<0.5,'physical paper height');
    else assert.ok(Number(boxes[0][2])*25.4/72<100,'receipt ends at content instead of the placeholder roll length');
    const meta=JSON.parse(fs.readFileSync(path.join(folder,'exports',doc.id+'.json')));
    assert.equal(meta.printer,({a4:'Test A4',receipt:'Test Receipt',barcode:'Test Barcode'})[doc.kind]);
    const timestamp=fs.statSync(pdf).mtimeMs;
    assert.equal((await request('/print',doc)).body.state,'sent');
    assert.equal(fs.statSync(pdf).mtimeMs,timestamp,'duplicate id must not render or spool again');
    assert.equal((await request('/print',{...doc,html:doc.html+'changed'})).status,400);
  }
  assert.equal((await request('/print',{...a4,id:randomBytes(16).toString('hex'),width:100})).status,400);
  if(process.argv.includes('--app-fixtures')){
    for(const fixture of JSON.parse(fs.readFileSync(path.join(root,'outputs/direct-printer-app-fixtures.json')))){
      fixture.id=randomBytes(16).toString('hex');assert.equal((await request('/print',fixture)).status,200);
      const result=await wait(fixture.id);assert.equal(result.state,'sent',result.message);
      console.log('Rendered application '+fixture.kind+' fixture: '+fixture.id+'.pdf');
    }
  }
  helper.kill();await new Promise(r=>setTimeout(r,500));
  const journal=JSON.parse(fs.readFileSync(path.join(folder,'jobs.json')));journal[a4.id].state='printing';fs.writeFileSync(path.join(folder,'jobs.json'),JSON.stringify(journal));
  await start();assert.equal((await request('/print',a4)).body.state,'unknown','uncertain work must never reprint after restart');
  assert.equal((await request('/status')).body.settings.barcode.printer,'Test Barcode','routes survive restart');
  console.log('Native printing integration passed (three routed PDFs, no paper printed). Artifacts: '+folder);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>helper?.kill());
