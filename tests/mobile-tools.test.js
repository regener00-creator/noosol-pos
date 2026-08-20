const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

assert.match(html, /mobiletools:\s*renderMobileTools/);
assert.match(html, /if\(mobileMode\) currentTab='mobiletools'/);
assert.match(html, /body\.mobile-device-mode \.sidebar,body\.mobile-device-mode \.topbar\{display:none!important/);
assert.match(html, /data-mobile-tool="price"/);
assert.match(html, /data-mobile-tool="inspection"/);
assert.match(html, /openMobileCameraScanner\(mobileHandlePriceCode\)/);
assert.match(html, /openMobileCameraScanner\(mobileHandleInspectionCode\)/);
assert.match(html, /findProductByExactCode\(query\)/);
assert.match(html, /mobileInspectionCheckedSet\(list\.id\)\.add/);
assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
assert.match(html, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.ok(manifest.icons.some(icon => icon.src === '/pwa-icon.svg'));
assert.match(serviceWorker, /request\.mode==='navigate'/);
assert.match(serviceWorker, /fetch\(request\)/);
assert.match(serviceWorker, /caches\.match\('\/index\.html'\)/);

const functionStart = html.indexOf('function mobileProductMatches(');
const functionEnd = html.indexOf('function mobilePriceMatches(', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'ไม่พบฟังก์ชันค้นหาสินค้าสำหรับมือถือ');
const context = {
  matchesBarcode(product, query) {
    return product.barcode === query || (product.units || []).some(unit => unit.barcode === query);
  },
};
vm.createContext(context);
vm.runInContext(html.slice(functionStart, functionEnd), context);
const product = { name: 'Vitamin C 1000', sku: 'P-100', barcode: '885000100', units: [{ barcode: 'BOX-100' }] };
assert.equal(context.mobileProductMatches(product, 'vitamin'), true);
assert.equal(context.mobileProductMatches(product, 'P-100'), true);
assert.equal(context.mobileProductMatches(product, 'BOX-100'), true);
assert.equal(context.mobileProductMatches(product, 'ไม่มี'), false);
assert.equal(context.mobileProductMatches(product, ''), false);

console.log('mobile tools tests passed');
