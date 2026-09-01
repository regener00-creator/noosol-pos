const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const worker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

assert.match(worker, /const CACHE_NAME='pepos-mobile-v12';/);
assert.match(
  worker,
  /const APP_SHELL=\[[^\]]*'\/sapuri-pharmacy-logo\.png'[^\]]*\];/s,
  'medicine-label printing must have its logo available offline'
);
assert.match(worker, /keys\.filter\(key=>key!==CACHE_NAME\)\.map\(key=>caches\.delete\(key\)\)/);
assert.match(worker, /request\.mode==='navigate'/);
assert.match(worker, /\.catch\(\(\)=>caches\.match\('\/index\.html'\)\)/);

console.log('service worker cache tests passed');
