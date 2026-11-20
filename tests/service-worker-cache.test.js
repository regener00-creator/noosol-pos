const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const assetToken = '__PEPOS_ASSET_VERSION__';

assert.equal((worker.match(new RegExp(assetToken, 'g')) || []).length, 1, 'service worker must define the build token once');
assert.equal((index.match(new RegExp(assetToken, 'g')) || []).length, 5, 'HTML versions domain, app, base/theme CSS and manifest; production bundles domain and theme');
assert.match(worker, /const ASSET_VERSION='__PEPOS_ASSET_VERSION__';/);
assert.match(worker, /const CACHE_NAME=`pepos-mobile-\$\{ASSET_VERSION\}`;/);
assert.match(worker, /`\/styles\.css\?v=\$\{ASSET_VERSION\}`/);
assert.match(worker, /`\/app\.js\?v=\$\{ASSET_VERSION\}`/);
assert.match(index, /\/styles\.css\?v=__PEPOS_ASSET_VERSION__/);
assert.match(index, /\/app\.js\?v=__PEPOS_ASSET_VERSION__/);
assert.match(index, /\/manifest\.webmanifest\?v=__PEPOS_ASSET_VERSION__/);
assert.match(
  worker,
  /const STATIC_ASSETS=\[[^\]]*'\/sapuri-pharmacy-logo\.webp'[^\]]*\];/s,
  'medicine-label printing must have its logo available offline'
);
assert.match(
  worker,
  /const STATIC_ASSETS=\[[^\]]*'\/sapuri-brand-screen\.webp'[^\]]*\];/s,
  'SAPURI brand logo must be available offline'
);
assert.match(worker, /'\/sapuri-app-icon-192\.png'/);
assert.match(worker, /'\/sapuri-app-icon-512\.png'/);
assert.match(worker, /vendor\\\/zxing-browser\\\.min\\\.js/,'iPad barcode fallback must be cacheable after its first load');
assert.match(worker, /key\.startsWith\('pepos-mobile-'\)&&key!==CACHE_NAME/,'do not delete another applications cache');
assert.match(worker, /request\.mode==='navigate'/);
assert.ok((worker.match(/event\.waitUntil\(/g) || []).length >= 3, 'ทุก cache.put ระหว่าง fetch ต้องต่ออายุ service worker lifecycle');
require('node:test')('offline navigation uses the installed release after an update',async()=>{
  const handlers={},origin='https://test.local',matches=[];
  let online=true;
  const ctx=require('node:vm').createContext({
    URL,self:{location:{origin},addEventListener:(name,fn)=>{handlers[name]=fn;}},
    caches:{match:(path,{cacheName}={})=>{matches.push([path,cacheName]);return cacheName==='pepos-mobile-new'?'installed shell':'old shell';}},
    fetch:async()=>{if(online)return 'next release';throw Error('offline');}
  });
  require('node:vm').runInContext(worker.replace(assetToken,'new'),ctx);
  const navigate=()=>new Promise(resolve=>handlers.fetch({request:{url:origin+'/',method:'GET',mode:'navigate'},respondWith:resolve}));
  assert.equal(await navigate(),'next release');
  online=false;
  assert.equal(await navigate(),'installed shell');
  assert.deepEqual(matches,[['/index.html','pepos-mobile-new']]);
});

console.log('service worker cache tests passed');
