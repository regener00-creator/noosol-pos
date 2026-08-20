const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const syncStart = html.indexOf('async function upsertAndPrune(');
const syncEnd = html.indexOf('async function syncProductsIncrementally(', syncStart);
const genericSync = html.slice(syncStart, syncEnd);
assert.ok(syncStart >= 0 && syncEnd > syncStart);
assert.doesNotMatch(genericSync, /select\('id'\)/, 'incremental sync must not prune against every remote id');
assert.match(genericSync, /const deleted=\[\.\.\.previous\.keys\(\)\]/, 'deletes must come only from the device baseline');

const productMetaStart = html.indexOf('function productMetadataToRow(');
const productMetaEnd = html.indexOf('function rowToProduct(', productMetaStart);
const productMeta = html.slice(productMetaStart, productMetaEnd);
assert.match(productMeta, /delete data\.stock/);
assert.doesNotMatch(productMeta, /stock:Number\(p\.stock\)/);
const productSyncStart = html.indexOf('async function updateProductMetadataInChunks(');
const productSyncEnd = html.indexOf('// Sync only rows changed', productSyncStart);
const productMetadataUpdate = html.slice(productSyncStart, productSyncEnd);
assert.match(productMetadataUpdate, /from\('products'\)\.update\(changes\)\.eq\('id',id\)/);
assert.doesNotMatch(productMetadataUpdate, /\.upsert\(/, 'existing product metadata must not upsert a missing stock column');

const contactImportStart = html.indexOf('async function importContactsFromExcel(');
const productImportStart = html.indexOf('async function importProductsFromExcel(', contactImportStart);
const productImportEnd = html.indexOf('function exportProductsToExcel(', productImportStart);
assert.doesNotMatch(html.slice(contactImportStart, productImportStart), /setProductStockOnSupabase/);
assert.match(html.slice(productImportStart, productImportEnd), /setProductStockOnSupabase\(existing\.id,data\.stock\)/);

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
