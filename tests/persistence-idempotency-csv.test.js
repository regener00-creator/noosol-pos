const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();

function section(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return html.slice(start, end);
}

const inlineProductEdit = section("document.querySelectorAll('.prod-inline-edit')", "document.querySelectorAll('.prod-unit-select')");
assert.match(inlineProductEdit, /await persistWorkspaceData\(\{productChanges:\{updatedIds:\[pid\]\}\}\)/);

const markPaid = section("document.querySelectorAll('[data-act=\"markpaid\"]')", "document.querySelectorAll('[data-act=\"receivepo\"]')");
assert.match(markPaid, /inv\.paid=true; persistWorkspaceData\(\)/);

const statusHandlers = section("document.querySelectorAll('.doc-status-select')", "document.querySelectorAll('.doc-list thead .doc-check')");
assert.match(statusHandlers, /doc\.status=sel\.value; persistWorkspaceData\(\)/);

const poRepresentativeSave = section('function savePORepresentativeFromPO(){', 'function savePOSupplierFromPO(){');
assert.match(poRepresentativeSave, /persistWorkspaceData\(\);\s*render\(\)/);
const poSupplierSave = section('function savePOSupplierFromPO(){', 'function recalcPORow(');
assert.match(poSupplierSave, /persistWorkspaceData\(\)/);
const representativeSave = section('function saveSalesRepresentative(){', 'function deleteSalesRepresentative(');
assert.match(representativeSave, /persistWorkspaceData\(\)/);
const representativeDelete = section('function deleteSalesRepresentative(', '// ===== ระบบโปรโมชั่น');
assert.match(representativeDelete, /salesRepresentatives=salesRepresentatives\.filter[\s\S]*persistWorkspaceData\(\)/);

const productPersistence = section('function persistWorkspaceData(options={}){', 'function schedulePersistWorkspaceData(){');
assert.match(productPersistence, /markProductChangesDirty\(productChanges\)/);
assert.match(productPersistence, /persistProductChangesToIndexedDB\(productChanges\)/);
assert.doesNotMatch(html, /setTimeout\([^\n]*persistProductsToIndexedDB[^\n]*1200/);

const manifestLoad = section('async function loadProductRowsFromSupabase(){', '// Content-hash guard:');
assert.match(manifestLoad, /mergeRemoteProductsWithDirtyLocal/);
assert.match(manifestLoad, /if\(productRowsPersisted\) await saveProductManifestCache\(manifestRows\)/);

const checkoutStart = html.indexOf('function readPendingCheckoutRequest(){');
const checkoutEnd = html.indexOf('async function clearLocalStoreCachesForReset()', checkoutStart);
assert.ok(checkoutStart >= 0 && checkoutEnd > checkoutStart, 'checkout request helpers must exist');
const checkoutSource = html.slice(checkoutStart, checkoutEnd);
const checkoutSubmission = section('async function doCheckout(', '// คลิกช่องตัวเลข');
assert.match(checkoutSubmission, /definitiveFailure=!!String\(error\?\.code\|\|''\)\.trim\(\)/,
  'database-declined checkout must release its request id for a corrected payload');
assert.match(checkoutSubmission, /else restorePendingCheckoutUi\(requestContext\)/,
  'network-ambiguous checkout must retain and restore its exact request payload');
let uuidCounter = 0;
const sessionValues = new Map();
const localValues = new Map();
const checkoutSandbox = {
  pendingCheckoutContextMemory: null,
  PENDING_CHECKOUT_REQUEST_KEY: 'pending-checkout-test',
  activeWarehouseId: 1,
  sessionStorage: {
    getItem: key => sessionValues.has(key) ? sessionValues.get(key) : null,
    setItem: (key, value) => sessionValues.set(key, value),
    removeItem: key => sessionValues.delete(key),
  },
  localStorage: {
    getItem: key => localValues.has(key) ? localValues.get(key) : null,
    setItem: (key, value) => localValues.set(key, value),
    removeItem: key => localValues.delete(key),
  },
  crypto: {randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`},
  sha256Hex: async value => JSON.stringify(value),
  cloudClean: value => JSON.parse(JSON.stringify(value)),
  console,
};
vm.createContext(checkoutSandbox);
vm.runInContext(`${checkoutSource}; this.checkoutRequestContext=checkoutRequestContext; this.clearCheckoutRequestId=clearCheckoutRequestId;`, checkoutSandbox);

const csvStart = html.indexOf('function csvSpreadsheetText(');
const csvEnd = html.indexOf('function exportRProductExcel(', csvStart);
assert.ok(csvStart >= 0 && csvEnd > csvStart, 'CSV safety helper must exist');
const csvSandbox = {};
vm.createContext(csvSandbox);
vm.runInContext(`${html.slice(csvStart, csvEnd)}; this.csvSpreadsheetText=csvSpreadsheetText;`, csvSandbox);

async function run() {
  const firstPayload = {warehouseId:1,sale:{payMethod:'เงินสด',total:100},items:[{productId:1,qty:1}]};
  const changedPayload = {warehouseId:1,sale:{payMethod:'โอนธนาคาร',total:200},items:[{productId:2,qty:1}]};
  const first = await checkoutSandbox.checkoutRequestContext(firstPayload, {cart:[{pid:1}],payMethod:'เงินสด'});
  assert.ok(localValues.has('pending-checkout-test'), 'unresolved checkout must survive a tab or browser restart');
  const retryAfterUiChange = await checkoutSandbox.checkoutRequestContext(changedPayload, {cart:[{pid:2}],payMethod:'โอนธนาคาร'});
  assert.equal(retryAfterUiChange.id, first.id, 'a changed cart must not receive a new request id while the outcome is unresolved');
  assert.equal(retryAfterUiChange.payloadMismatch, true);
  assert.deepEqual(JSON.parse(JSON.stringify(retryAfterUiChange.payload)), firstPayload, 'retry must retain the original atomic checkout payload');
  checkoutSandbox.clearCheckoutRequestId(first.id);
  assert.equal(localValues.has('pending-checkout-test'), false, 'acknowledged checkout must clear durable request state');
  const afterAcknowledgement = await checkoutSandbox.checkoutRequestContext(changedPayload, {cart:[{pid:2}]});
  assert.notEqual(afterAcknowledgement.id, first.id, 'only an acknowledged/cleared request may receive a new id');

  assert.equal(csvSandbox.csvSpreadsheetText('ยาพารา'), '"ยาพารา"');
  assert.equal(csvSandbox.csvSpreadsheetText('ข้อความ "ทดสอบ"'), '"ข้อความ ""ทดสอบ"""');
  assert.equal(csvSandbox.csvSpreadsheetText('=HYPERLINK("https://evil")'), '"\'=HYPERLINK(""https://evil"")"');
  assert.equal(csvSandbox.csvSpreadsheetText('  +1+1'), '"\'  +1+1"');
  assert.equal(csvSandbox.csvSpreadsheetText('@SUM(A1:A2)'), '"\'@SUM(A1:A2)"');
  assert.equal(csvSandbox.csvSpreadsheetText('A-B'), '"A-B"');

  const productCsv = section('function exportRProductExcel(){', 'function printRProduct(){');
  const billCsv = section("function exportRBillExcel(filter=rbillFilter", "function printRBill(filter=rbillFilter");
  assert.match(productCsv, /csvSpreadsheetText\(r\.name\)/);
  assert.match(productCsv, /csvSpreadsheetText\(r\.unit\)/);
  assert.match(billCsv, /csvSpreadsheetText\(r\.billId\)/);
  assert.match(billCsv, /csvSpreadsheetText\(billItemsPlainText\(r\.items\)\)/);

  console.log('persistence, checkout idempotency, and CSV safety tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
