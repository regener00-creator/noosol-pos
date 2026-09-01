const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const assetToken = '__PEPOS_ASSET_VERSION__';

assert.equal((worker.match(new RegExp(assetToken, 'g')) || []).length, 1, 'service worker must define the build token once');
assert.equal((index.match(new RegExp(assetToken, 'g')) || []).length, 2, 'HTML must version both app.js and styles.css');
assert.match(worker, /const ASSET_VERSION='__PEPOS_ASSET_VERSION__';/);
assert.match(worker, /const CACHE_NAME=`pepos-mobile-\$\{ASSET_VERSION\}`;/);
assert.match(worker, /`\/styles\.css\?v=\$\{ASSET_VERSION\}`/);
assert.match(worker, /`\/app\.js\?v=\$\{ASSET_VERSION\}`/);
assert.match(index, /\/styles\.css\?v=__PEPOS_ASSET_VERSION__/);
assert.match(index, /\/app\.js\?v=__PEPOS_ASSET_VERSION__/);
assert.match(
  worker,
  /const APP_SHELL=\[[^\]]*'\/sapuri-pharmacy-logo\.png'[^\]]*\];/s,
  'medicine-label printing must have its logo available offline'
);
assert.match(worker, /keys\.filter\(key=>key!==CACHE_NAME\)\.map\(key=>caches\.delete\(key\)\)/);
assert.match(worker, /request\.mode==='navigate'/);
assert.match(worker, /\.catch\(\(\)=>caches\.match\('\/index\.html'\)\)/);
assert.ok((worker.match(/event\.waitUntil\(/g) || []).length >= 3, 'ทุก cache.put ระหว่าง fetch ต้องต่ออายุ service worker lifecycle');
assert.match(worker, /cacheUpdate:response\.ok[\s\S]{0,140}cache\.put\(cacheKey,response\.clone\(\)\)/);
assert.match(worker, /event\.respondWith\(network\.then\(result=>result\.response\)\.catch\(\(\)=>caches\.match\(request\)\)\)/, 'ไฟล์โปรแกรมต้องตรวจเวอร์ชันออนไลน์ก่อนใช้แคชเก่า');

console.log('service worker cache tests passed');
