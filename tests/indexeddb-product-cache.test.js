const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = require("./load-app-source")();

assert.match(html,/const PRODUCT_CACHE_DB_NAME='pepos-product-cache'/);
assert.match(html,/db\.createObjectStore\(PRODUCT_CACHE_PRODUCTS_STORE,\{keyPath:'id'\}\)/);
assert.match(html,/async function loadProductCacheFromIndexedDB\(\)/);
assert.match(html,/function persistProductsToIndexedDB\(/);
assert.match(html,/const PRODUCT_CACHE_DIRTY_KEY='product-dirty-operations-v1'/);
assert.match(html,/transaction=db\.transaction\(\[PRODUCT_CACHE_PRODUCTS_STORE,PRODUCT_CACHE_META_STORE\],'readwrite'\)/,'product row and dirty state must share one transaction');
assert.match(html,/if\(productRowsPersisted\) await saveProductManifestCache\(manifestRows\)/,'manifest must advance only after product rows are durable');
assert.match(html,/await loadProductCacheFromIndexedDB\(\)/,'cache must hydrate before the authenticated core load');
assert.match(html,/function localWorkspaceSnapshot\(\)[\s\S]*?delete snapshot\.products/);
assert.match(html,/function workspacePersistencePayload\(\)\{\s*return JSON\.stringify\(localWorkspaceSnapshot\(\)\)/);
assert.doesNotMatch(html,/safeLocalStorageSet\(PRODUCT_MANIFEST_STORAGE_KEY/,'product manifest must not be written back to localStorage');
assert.match(html,/function workspaceSnapshot\(\)[\s\S]*?return \{warehouses,products,/,'downloadable backups must still include products');
assert.match(html,/localStorage\.removeItem\(PRODUCT_MANIFEST_STORAGE_KEY\)/,'legacy manifest should be removed after IndexedDB migration');
assert.match(html,/clearProductIndexedCache\(\)/,'controlled reset must clear the IndexedDB product cache');

console.log('IndexedDB product cache tests passed');
