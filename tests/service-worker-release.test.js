const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8');
function setup(){
  const origin='https://test.invalid',stores=new Map(),events={},requests=[];
  const key=request=>new URL(typeof request==='string'?request:request.url,origin).href;
  const cache=name=>{
    if(!stores.has(name)) stores.set(name,new Map());
    const rows=stores.get(name);
    return {put:async(req,res)=>rows.set(key(req),res),delete:async req=>rows.delete(key(req)),
      keys:async()=>[...rows.keys()].map(url=>({url})),addAll:async urls=>{for(const url of urls) rows.set(key(url),{body:'old-release',ok:true});}};
  };
  const caches={open:async name=>cache(name),keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),
    match:async request=>{for(const rows of stores.values()) if(rows.has(key(request))) return rows.get(key(request));}};
  const ctx=vm.createContext({URL,Set,Promise,caches,self:{location:{origin},skipWaiting:async()=>{},clients:{claim:async()=>{}},addEventListener:(name,fn)=>events[name]=fn},
    fetch:async req=>{requests.push(key(req));return {body:'new-release',ok:true,clone(){return this;}};}});
  vm.runInContext(source.replace('__PEPOS_ASSET_VERSION__','new-release'),ctx);
  return {ctx,events,stores,requests,cache,key};
}
async function dispatchFetch(c,url){
  const pending=[];let response;
  c.events.fetch({request:{url:'https://test.invalid'+url,method:'GET',mode:'cors'},waitUntil:p=>pending.push(p),respondWith:p=>response=p});
  const result=await response;await Promise.all(pending);return result;
}
test('install precaches every lazy page and activation retains two bounded previous releases',async()=>{
  const c=setup();let pending;
  for(const name of ['other-app','pepos-mobile-ancient','pepos-mobile-older','pepos-mobile-old']) c.cache(name);
  c.events.install({waitUntil:p=>pending=p});await pending;
  const current=c.stores.get('pepos-mobile-new-release');
  for(const group of ['reports','documents','settings','catalog']) assert.ok(current.has(c.key('/page-'+group+'.js?v=new-release')));
  c.events.activate({waitUntil:p=>pending=p});await pending;
  assert.equal(c.stores.has('other-app'),true);assert.equal(c.stores.has('pepos-mobile-ancient'),false);
  assert.equal(c.stores.has('pepos-mobile-old'),true);assert.equal(c.stores.has('pepos-mobile-older'),true);
});
test('an old open tab receives its cached report chunk rather than code from the new deployment',async()=>{
  const c=setup();await c.cache('pepos-mobile-old').put('/page-reports.js?v=old',{body:'old-report',ok:true});
  const response=await dispatchFetch(c,'/page-reports.js?v=old');
  assert.equal(response.body,'old-report');assert.equal(c.requests.length,0);
});
test('a missing old-version URL must not poison the cache with new deployment bytes',async()=>{
  const c=setup();const response=await dispatchFetch(c,'/page-reports.js?v=old');
  assert.equal(response.body,'new-release');assert.equal(c.stores.size,0);
  await dispatchFetch(c,'/page-reports.js?v=new-release');
  assert.ok(c.stores.get('pepos-mobile-new-release').has(c.key('/page-reports.js?v=new-release')));
});
