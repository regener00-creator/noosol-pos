const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const icon = fs.readFileSync(path.join(root, 'pwa-icon.svg'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.match(html, /<meta name="theme-color" content="#5A3F32">/);
assert.match(html, /--bg:#F8F4F2; --surface:#FFFFFF; --border:#E5DAD5;/);
assert.match(html, /--sidebar:#5A3F32; --sidebar-hover:#493126;/);
assert.match(html, /--primary:#5A3F32; --primary-dark:#3F2A22; --primary-soft:#EFE5E1;/);
assert.doesNotMatch(html, /#2091D2|#1A76AE|#166D9F|#E5F4FB/i);
assert.doesNotMatch(html, /#715750/i);
assert.equal(manifest.background_color, '#F8F4F2');
assert.equal(manifest.theme_color, '#5A3F32');
assert.match(icon, /fill="#5A3F32"/);
assert.match(serviceWorker, /CACHE_NAME='pepos-mobile-v9'/);

console.log('chocolate theme tests passed');
