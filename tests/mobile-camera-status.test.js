const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=require('../scripts/app-source.cjs').readApplicationSource();
const source=app.slice(app.indexOf('function closeMobileCameraScanner('),app.indexOf('function inspectionListLocalDateKey('));
function scanner(track,storage=new Map()){
  const message={textContent:''},frames=[],accepted=[],vibrations=[];
  const video={readyState:2,play:async()=>{}};
  const select={disabled:true,replaceChildren(...options){this.options=options;},addEventListener(type,listener){this[type]=listener;}};
  const camera={innerHTML:'',remove(){},scrollIntoView(){},querySelector(selector){return selector==='video'?video:selector==='.mobile-camera-message'?message:selector==='.mobile-camera-lens'?select:{addEventListener(){}};}};
  let time=0,code='';
  class BarcodeDetector{async detect(){return [{rawValue:code}];}}
  const ctx=vm.createContext({console,window:{BarcodeDetector},BarcodeDetector,Option:class{constructor(text,value){Object.assign(this,{text,value});}},
    navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[],getVideoTracks:()=>track?[track]:[]})},vibrate:value=>vibrations.push(value)},
    document:{createElement:()=>camera,getElementById:()=>({replaceChildren(){},setAttribute(){}})},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    Date:{now:()=>time+=1000},requestAnimationFrame:callback=>frames.push(callback),
    closeMobileCameraScanner(){},playMobileScanErrorSound(){},showToast(){},openMobileBrowserHelp(){},mobileCameraSession:null,mobileZxingLoadPromise:null,APP_ASSET_VERSION:'test',
    onCode:value=>{accepted.push(value);return value==='found';}
  });
  vm.runInContext(source,ctx);
  return {ctx,camera,message,select,accepted,vibrations,scan:async value=>{code=value;await frames.shift()();}};
}
test('price-camera status stays branded at startup, readiness, accepted and rejected scans',async()=>{
  const s=scanner();
  assert.equal(await vm.runInContext("openMobileCameraScanner(onCode,{continuous:true,hostId:'mobilePriceCameraSlot'})",s.ctx),true);
  assert.match(s.camera.innerHTML,/<div class="mobile-camera-message">P R A N C - H I B E S<\/div>/);
  assert.equal(s.message.textContent,'P R A N C - H I B E S');
  assert.equal(s.select.disabled,true);
  assert.match(s.camera.innerHTML,/mobile-camera-lens"[^>]* disabled><option[^>]*>กล้องปัจจุบัน \(ยังไม่มีเลนส์อื่นให้เลือก\)/);
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
test('scanner uses the widest exposed zoom and still scans if the camera declines',async()=>{
  for(const mode of ['supported','declined','already-wide']){
    const requested=[];
    let zoom=mode==='already-wide'?0.5:3;
    const s=scanner({
      getCapabilities:()=>({zoom:{min:0.5,max:5}}),
      getSettings:()=>({zoom}),
      applyConstraints:async constraints=>{
        requested.push(constraints.advanced[0].zoom);
        if(mode==='declined') throw new Error('zoom unavailable');
        zoom=constraints.advanced[0].zoom;
      }
    });
    assert.equal(await vm.runInContext("openMobileCameraScanner(onCode,{continuous:true,hostId:'mobilePriceCameraSlot'})",s.ctx),true);
    assert.deepEqual(requested,mode==='already-wide'?[]:mode==='declined'?[0.5,1]:[0.5]);
    await s.scan('found');
    assert.deepEqual(s.accepted,['found']);
  }
});
test('price and inventory restore the locally selected lens, and ignore rejected zoom changes',async()=>{
  const storage=new Map();
  let zoom=1,ignore=false;
  const track={getCapabilities:()=>({zoom:{min:0.5,max:4,step:0.1}}),getSettings:()=>({zoom}),
    applyConstraints:async constraints=>{if(!ignore) zoom=constraints.advanced[0].zoom;}};
  for(const [host,initial,choice] of [['mobilePriceCameraSlot','wide','main'],['mobileInspectionCameraSlot','main','wide'],['mobileStockCameraSlot','wide','main']]){
    const s=scanner(track,storage);
    await s.ctx.openMobileCameraScanner(s.ctx.onCode,{hostId:host,continuous:true});
    assert.equal(s.select.disabled,false);
    assert.equal(s.select.value,initial);
    s.select.value=choice;
    ignore=true;
    await s.select.change();
    assert.equal(s.select.value,initial);
    s.select.value=choice;
    ignore=false;
    await s.select.change();
    assert.equal(zoom,choice==='wide'?0.5:1);
    assert.equal(s.select.value,choice);
    await s.scan('found');
    assert.deepEqual(s.accepted,['found']);
  }
});
test('separate rear lenses switch by device ID, release the previous camera and recover when unavailable',async()=>{
  const storage=new Map(),s=scanner(null,storage);
  const media=s.ctx.navigator.mediaDevices;
  let live='',wideAvailable=true;
  media.enumerateDevices=async()=>[
    {kind:'videoinput',deviceId:'front',label:'Front Ultra Wide'},
    {kind:'videoinput',deviceId:'back',label:'Back Camera'},
    {kind:'videoinput',deviceId:'ultra',label:'Back Ultra Wide Camera'}
  ];
  media.getUserMedia=async({video})=>{
    assert.equal(live,'','Release the current camera before switching on mobile');
    const id=video.deviceId?.exact||'back';
    if(id==='ultra'&&!wideAvailable) throw new Error('lens unavailable');
    live=id;
    const track={getSettings:()=>({deviceId:id,facingMode:'environment'}),stop:()=>{live='';}};
    return {getTracks:()=>[track],getVideoTracks:()=>[track]};
  };
  const open=hostId=>s.ctx.openMobileCameraScanner(s.ctx.onCode,{hostId,continuous:true});
  await open('mobilePriceCameraSlot');
  assert.equal(live,'ultra');
  s.select.value='main';
  await s.select.change();
  assert.equal(live,'back');
  await open('mobileInspectionCameraSlot');
  assert.equal(live,'back');
  assert.equal(s.select.value,'main');
  wideAvailable=false;
  s.select.value='wide';
  await s.select.change();
  assert.equal(live,'back');
  assert.equal(storage.get('sapuri.mobile.scannerLens'),'main');
  s.ctx.closeMobileCameraScanner();
  assert.equal(live,'');
});
test('numbered rear cameras can be selected and restored across scanner pages without guessing 0.5x',async()=>{
  const storage=new Map(),s=scanner(null,storage);
  let active;
  s.ctx.navigator.mediaDevices.getUserMedia=async({video})=>{
    active=video.deviceId?.exact||'back';
    const track={getSettings:()=>({deviceId:active,facingMode:'environment',zoom:1}),getCapabilities:()=>({zoom:{min:1,max:4}}),stop(){}};
    return {getTracks:()=>[track],getVideoTracks:()=>[track]};
  };
  s.ctx.navigator.mediaDevices.enumerateDevices=async()=>[
    {kind:'videoinput',deviceId:'back',label:'Camera 0 facing back'},
    {kind:'videoinput',deviceId:'back2',label:'Camera 2 facing back'},
    {kind:'videoinput',deviceId:'front',label:'Front Ultra Wide Camera'}
  ];
  await s.ctx.openMobileCameraScanner(s.ctx.onCode,{hostId:'mobileStockCameraSlot',continuous:true});
  assert.equal(s.select.disabled,false);
  assert.deepEqual(s.select.options.map(option=>option.text),['กล้องหลัง 1','กล้องหลัง 2']);
  assert.equal(s.select.value,'camera:back');
  await s.scan('found');
  assert.deepEqual(s.accepted,['found']);
  s.select.value='camera:back2';
  await s.select.change();
  assert.equal(active,'back2');
  assert.equal(storage.get('sapuri.mobile.scannerLens'),'camera:back2');
  await s.ctx.openMobileCameraScanner(s.ctx.onCode,{hostId:'mobilePriceCameraSlot',continuous:true});
  assert.equal(s.select.value,'camera:back2');
  assert.equal(active,'back2');
});
test('declining zoom permission still opens the regular camera and decodes a barcode',async()=>{
  const s=scanner(),media=s.ctx.navigator.mediaDevices,requests=[];
  media.getSupportedConstraints=()=>({zoom:true});
  media.getUserMedia=async({video})=>{
    requests.push(video.zoom?.ideal);
    if(video.zoom) throw Object.assign(new Error('Permission denied'),{name:'NotAllowedError'});
    return {getTracks:()=>[]};
  };
  assert.ok(await s.ctx.openMobileCameraScanner(s.ctx.onCode,{hostId:'mobilePriceCameraSlot',continuous:true}));
  assert.deepEqual(requests,[0.5,undefined]);
  assert.equal(s.select.disabled,true);
  await s.scan('found');
  assert.deepEqual(s.accepted,['found']);
});
test('iPad path loads ZXing fallback, requests camera and scans without native BarcodeDetector',async()=>{
  const message={textContent:''},accepted=[],vibrations=[];
  const video={readyState:2,play:async()=>{}};
  const camera={innerHTML:'',scrollIntoView(){},querySelector(selector){return selector==='video'?video:selector==='.mobile-camera-message'?message:{addEventListener(){}};}};
  let callback=null,stopped=false,cameraRequests=0;
  class BrowserMultiFormatReader{
    async decodeFromVideoElement(_video,fn){ callback=fn; return {stop(){stopped=true;}}; }
  }
  const ctx=vm.createContext({console,window:{ZXingBrowser:{BrowserMultiFormatReader}},
    navigator:{mediaDevices:{getUserMedia:async()=>{cameraRequests++;return {getTracks:()=>[]};}},vibrate:value=>vibrations.push(value)},
    document:{createElement:()=>camera,getElementById:()=>({replaceChildren(){},setAttribute(){}})},
    Date,requestAnimationFrame(){},closeMobileCameraScanner(){},playMobileScanErrorSound(){},showToast(){},openMobileBrowserHelp(){throw new Error('must not open browser-help loop');},
    mobileCameraSession:null,mobileZxingLoadPromise:null,APP_ASSET_VERSION:'test',onCode:value=>{accepted.push(value);return true;}
  });
  vm.runInContext(source,ctx);
  assert.equal(await vm.runInContext("openMobileCameraScanner(onCode,{continuous:true,hostId:'mobileInspectionCameraSlot'})",ctx),true);
  assert.equal(cameraRequests,1,'fallback must request the real iPad camera permission');
  callback({getText:()=> '8850000000001'},null,{stop(){stopped=true;}});
  assert.deepEqual(accepted,['8850000000001']);
  assert.equal(vibrations[0],80);
  assert.equal(stopped,false,'continuous scanner remains open');
});
