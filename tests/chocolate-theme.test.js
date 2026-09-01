const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = require("./load-app-source")();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const icon = fs.readFileSync(path.join(root, 'pwa-icon.svg'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.match(html, /<meta name="theme-color" content="#4F4038">/);
assert.match(html, /--bg:#F7F5F3; --surface:#FFFFFF; --border:#E2DBD7;/);
assert.match(html, /--sidebar:#4F4038; --sidebar-hover:#3F332C;/);
assert.match(html, /--primary:#4F4038; --primary-dark:#322821; --primary-soft:#EEE9E6;/);
assert.doesNotMatch(html, /#2091D2|#1A76AE|#166D9F|#E5F4FB/i);
assert.doesNotMatch(html, /#715750|#5A3F32/i);
assert.equal(manifest.background_color, '#F7F5F3');
assert.equal(manifest.theme_color, '#4F4038');
assert.match(icon, /fill="#4F4038"/);
assert.match(serviceWorker, /CACHE_NAME='pepos-mobile-v14'/);

console.log('chocolate theme tests passed');
