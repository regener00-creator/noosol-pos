const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const icon = fs.readFileSync(path.join(root, 'pwa-icon.svg'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.match(html, /<meta name="theme-color" content="#715750">/);
assert.match(html, /--bg:#F7F3F1; --surface:#FFFFFF; --border:#E3D9D5;/);
assert.match(html, /--sidebar:#715750; --sidebar-hover:#59423A;/);
assert.match(html, /--primary:#715750; --primary-dark:#4D3731; --primary-soft:#F0E8E5;/);
assert.doesNotMatch(html, /#2091D2|#1A76AE|#166D9F|#E5F4FB/i);
assert.equal(manifest.background_color, '#F7F3F1');
assert.equal(manifest.theme_color, '#715750');
assert.match(icon, /fill="#715750"/);
assert.match(serviceWorker, /CACHE_NAME='pepos-mobile-v8'/);

console.log('chocolate theme tests passed');
