const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();

const syncStart = html.indexOf('async function upsertAndPrune(');
const syncEnd = html.indexOf('async function syncProductsIncrementally(', syncStart);
const genericSync = html.slice(syncStart, syncEnd);
assert.ok(syncStart >= 0 && syncEnd > syncStart);
assert.doesNotMatch(genericSync, /select\('id'\)/, 'incremental sync must not prune against every remote id');
assert.match(genericSync, /const deleted=\[\.\.\.previous\.keys\(\)\]/, 'deletes must come only from the device baseline');
assert.match(genericSync, /insertRevisionedRows\(table,inserts,toRow,acknowledge\)/);
assert.match(genericSync, /updateRevisionedRows\(table,updates,toRow,acknowledge\)/);
assert.match(genericSync, /deleteRevisionedRows\(table,deleted,previous,/);
assert.doesNotMatch(genericSync, /\.upsert\(/, 'shared master data must not overwrite an existing id');

const productMetaStart = html.indexOf('function productMetadataToRow(');
const productMetaEnd = html.indexOf('function rowToProduct(', productMetaStart);
const productMeta = html.slice(productMetaStart, productMetaEnd);
assert.match(productMeta, /additionalData\(p,PRODUCT_DUPLICATE_DATA_KEYS\)/);
assert.doesNotMatch(productMeta, /stock:Number\(p\.stock\)/);
const productSyncStart = html.indexOf('async function updateProductMetadataInChunks(');
const productSyncEnd = html.indexOf('// Sync only rows changed', productSyncStart);
const productMetadataUpdate = html.slice(productSyncStart, productSyncEnd);
assert.match(productMetadataUpdate, /from\('products'\)\.update\(changes\)\.eq\('id',id\)/);
assert.doesNotMatch(productMetadataUpdate, /\.upsert\(/, 'existing product metadata must not upsert a missing stock column');

assert.match(html, /const PRODUCT_MANIFEST_STORAGE_KEY='pepos_product_manifest_v6'/, 'repair release must invalidate unsafe sequence cursors');
assert.match(html, /const PRODUCT_MANIFEST_VERSION=6/);
assert.match(html,/function fetchProductRevisionManifest\(\)/);
assert.doesNotMatch(html,/\.gt\('change_id',cursor\)/,'commit order must not be inferred from sequence values');
assert.match(html,/productDirtyOperations\.has\(String\(row\.id\)\)/,'dirty local products must survive remote changes');
const coreLoadStart = html.indexOf('async function loadCoreDataFromSupabase(');
const coreLoadEnd = html.indexOf('// ----- Sales history sync', coreLoadStart);
const coreLoad = html.slice(coreLoadStart, coreLoadEnd);
assert.match(coreLoad, /loadProductRowsFromSupabase\(\)/);
assert.doesNotMatch(coreLoad, /from\('products'\)\.select\('\*'\)/, 'normal core load must use the product manifest cache');
assert.match(coreLoad, /products=prodRows\|\|\[\]/, 'normalized product objects must be assigned without a second mapping pass');
assert.match(coreLoad, /seedProductSyncSnapshot\(products,productDirtyOperations\)/, 'dirty products must not be seeded as synchronized');
assert.match(coreLoad, /if\(productDirtyOperations\.size\) scheduleSupabaseCoreSync\(\)/, 'dirty products recovered on boot must retry upload');
assert.doesNotMatch(coreLoad, /products=\(prodRows\|\|\[\]\)\.map\(rowToProduct\)/, 'double mapping strips JSON-only barcode metadata');

const contactImportStart = html.indexOf('async function importContactsFromExcel(');
const productImportStart = html.indexOf('async function importProductsFromExcel(', contactImportStart);
const productImportEnd = html.indexOf('function exportProductsToExcel(', productImportStart);
assert.doesNotMatch(html.slice(contactImportStart, productImportStart), /setProductStockOnSupabase/);
assert.doesNotMatch(html.slice(productImportStart, productImportEnd), /setProductStockOnSupabase/);
assert.match(html.slice(productImportStart, productImportEnd), /applyImportedInventoryTargets\(importStockTargets\)/);
assert.match(html, /post_inventory_count_adjustment_with_shortages/);

const dateStart = html.indexOf('function currentLocalDate(');
const dateEnd = html.indexOf('function fmtDateShort(', dateStart);
const dateCode = html.slice(dateStart, dateEnd);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${dateCode}; this.currentDateStr=currentDateStr; this.daysUntil=daysUntil;`, sandbox);
const today = sandbox.currentDateStr();
assert.equal(sandbox.daysUntil(today), 0);
const tomorrowDate = new Date();
tomorrowDate.setDate(tomorrowDate.getDate() + 1);
const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth()+1).padStart(2,'0')}-${String(tomorrowDate.getDate()).padStart(2,'0')}`;
assert.equal(sandbox.daysUntil(tomorrow), 1);

console.log('sync safety tests passed');
