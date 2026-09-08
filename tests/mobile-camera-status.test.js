const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const source=app.slice(app.indexOf('async function openMobileCameraScanner('),app.indexOf('function inspectionListLocalDateKey('));
function scanner(){
  const message={textContent:''},frames=[],accepted=[],vibrations=[];
  const video={readyState:2,play:async()=>{}};
  const camera={innerHTML:'',scrollIntoView(){},querySelector(selector){return selector==='video'?video:selector==='.mobile-camera-message'?message:{addEventListener(){}};}};
  let time=0,code='';
  class BarcodeDetector{async detect(){return [{rawValue:code}];}}
  const ctx=vm.createContext({console,window:{BarcodeDetector},BarcodeDetector,
    navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[]})},vibrate:value=>vibrations.push(value)},
    document:{createElement:()=>camera,getElementById:()=>({replaceChildren(){},setAttribute(){}})},
    Date:{now:()=>time+=1000},requestAnimationFrame:callback=>frames.push(callback),
    closeMobileCameraScanner(){},playMobileScanErrorSound(){},showToast(){},openMobileBrowserHelp(){},mobileCameraSession:null,
    onCode:value=>{accepted.push(value);return value==='found';}
  });
  vm.runInContext(source,ctx);
  return {ctx,camera,message,accepted,vibrations,scan:async value=>{code=value;await frames.shift()();}};
}
test('price-camera status stays branded at startup, readiness, accepted and rejected scans',async()=>{
  const s=scanner();
  assert.equal(await vm.runInContext("openMobileCameraScanner(onCode,{continuous:true,hostId:'mobilePriceCameraSlot'})",s.ctx),true);
  assert.match(s.camera.innerHTML,/<div class="mobile-camera-message">P R A N C - H I B E S<\/div>/);
  assert.equal(s.message.textContent,'P R A N C - H I B E S');
  await s.scan('found');assert.equal(s.message.textContent,'P R A N C - H I B E S');
  await s.scan('missing');assert.equal(s.message.textContent,'P R A N C - H I B E S');
  assert.deepEqual(s.accepted,['found','missing']);
  assert.equal(s.vibrations[0],80);assert.deepEqual(Array.from(s.vibrations[1]),[40,50,40]);
});
test('inventory camera retains its scan feedback',async()=>{
  const s=scanner();
  await vm.runInContext("openMobileCameraScanner(onCode,{continuous:true,hostId:'mobileInspectionCameraSlot'})",s.ctx);
  await s.scan('missing');assert.match(s.message.textContent,/ยังไม่เพิ่ม: missing/);
  await s.scan('found');assert.match(s.message.textContent,/สแกนแล้ว: found/);
});
