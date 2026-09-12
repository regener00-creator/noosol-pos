const ASSET_VERSION='__PEPOS_ASSET_VERSION__';
const CACHE_NAME=`pepos-mobile-${ASSET_VERSION}`;
const APP_SHELL=['/','/index.html',`/styles.css?v=${ASSET_VERSION}`,`/app.js?v=${ASSET_VERSION}`,'/manifest.webmanifest','/sapuri-app-icon-192.png','/sapuri-app-icon-512.png','/sapuri-pharmacy-logo.webp','/sapuri-brand-logo.webp'];
const TRUSTED_CDN_HOSTS=new Set(['cdn.jsdelivr.net']);
const MAX_RUNTIME_CACHE_ENTRIES=80;
function isCacheableAsset(url){
  if(url.origin!==self.location.origin) return TRUSTED_CDN_HOSTS.has(url.hostname)&&/^\/npm\/(?:@supabase\/supabase-js|xlsx|jsbarcode)@\d/.test(url.pathname);
  return /^\/(?:app\.js|styles\.css|page-[a-z]+\.js|excel-tools\.js|manifest\.webmanifest|sapuri-[a-z0-9-]+\.(?:png|webp)|fonts\/[a-zA-Z0-9_.-]+\.(?:woff2?|ttf)|sounds\/[a-zA-Z0-9_.-]+\.(?:mp3|wav))$/.test(url.pathname);
}
async function trimRuntimeCache(cache){
  const protectedUrls=new Set(APP_SHELL.map(path=>new URL(path,self.location.origin).href));
  const keys=(await cache.keys()).filter(request=>!protectedUrls.has(request.url));
  await Promise.all(keys.slice(0,Math.max(0,keys.length-MAX_RUNTIME_CACHE_ENTRIES)).map(request=>cache.delete(request)));
}

function fetchAndPrepareCacheUpdate(request,cacheKey=request){
  return fetch(request).then(response=>({
    response,
    cacheUpdate:response.ok
      ?caches.open(CACHE_NAME).then(async cache=>{ await cache.put(cacheKey,response.clone()); await trimRuntimeCache(cache); })
      :Promise.resolve(),
  }));
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pepos-mobile-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin){
    if(!isCacheableAsset(url)) return;
    const cacheFirst=caches.match(request).then(cached=>cached
      ?{response:cached,cacheUpdate:Promise.resolve()}
      :fetchAndPrepareCacheUpdate(request));
    event.waitUntil(cacheFirst.then(result=>result.cacheUpdate).catch(()=>undefined));
    event.respondWith(cacheFirst.then(result=>result.response));
    return;
  }
  if(request.mode==='navigate'){
    const network=fetchAndPrepareCacheUpdate(request,'/index.html');
    event.waitUntil(network.then(result=>result.cacheUpdate).catch(()=>undefined));
    event.respondWith(network.then(result=>result.response).catch(()=>caches.match('/index.html')));
    return;
  }
  if(!isCacheableAsset(url)) return;
  const network=fetchAndPrepareCacheUpdate(request);
  event.waitUntil(network.then(result=>result.cacheUpdate).catch(()=>undefined));
  event.respondWith(network.then(result=>result.response).catch(()=>caches.match(request)));
});
