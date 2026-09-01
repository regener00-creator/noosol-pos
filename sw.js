const ASSET_VERSION='__PEPOS_ASSET_VERSION__';
const CACHE_NAME=`pepos-mobile-${ASSET_VERSION}`;
const APP_SHELL=['/','/index.html',`/styles.css?v=${ASSET_VERSION}`,`/app.js?v=${ASSET_VERSION}`,'/manifest.webmanifest','/pwa-icon.svg','/pwa-icon-192.png','/pwa-icon-512.png','/sapuri-pharmacy-logo.png'];
const TRUSTED_CDN_HOSTS=new Set(['cdn.jsdelivr.net']);

function fetchAndPrepareCacheUpdate(request,cacheKey=request){
  return fetch(request).then(response=>({
    response,
    cacheUpdate:response.ok
      ?caches.open(CACHE_NAME).then(cache=>cache.put(cacheKey,response.clone()))
      :Promise.resolve(),
  }));
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin){
    if(!TRUSTED_CDN_HOSTS.has(url.hostname)) return;
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
  const network=fetchAndPrepareCacheUpdate(request);
  event.waitUntil(network.then(result=>result.cacheUpdate).catch(()=>undefined));
  event.respondWith(network.then(result=>result.response).catch(()=>caches.match(request)));
});
