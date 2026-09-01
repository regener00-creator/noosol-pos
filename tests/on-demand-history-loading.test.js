const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = require('./load-app-source')();

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

const coreLoader = section('async function loadCoreDataFromSupabase(){', '// ----- Sales history sync -----');
assert.doesNotMatch(coreLoader, /DOC_TABLES\.map/,
  'login core loader must not fetch every document table');
assert.doesNotMatch(coreLoader, /sb\.from\('sales'\)/,
  'login core loader must not fetch the complete sales table');

const salesLoader = section('async function loadSalesHistoryFromSupabase(options={}){', 'async function loadAllSalesForBackup');
assert.match(salesLoader, /\.gte\('sale_date',range\.from\)\.lte\('sale_date',range\.to\)/,
  'sales windows must be filtered by date on the server');
assert.match(salesLoader, /fetchBoundedRows\(buildRangeQuery/,
  'normal sales reads must use bounded server-side pages');
assert.match(salesLoader, /\.eq\('status','hold'\)/,
  'POS must load every held order independently from the normal date window');
assert.match(salesLoader, /\.eq\('status','done'\)[\s\S]*\.limit\(8\)/,
  'dashboard must retain a small latest-completed-sales query outside the month window');

const documentLoader = section('async function loadDocumentTableFromSupabase(', 'async function loadAllDocumentsForBackup');
assert.match(documentLoader, /fetchBoundedRows\(buildQuery/,
  'normal document reads must use bounded server-side pages');
assert.match(documentLoader, /data->>date/,
  'document report windows must be filtered by their stored date on the server');
assert.match(documentLoader, /const snapshot=new Map\(syncedTableRows\[table\]\|\|\[\]\)/,
  'partial document hydration must preserve the observed-id sync snapshot');

const syncLoader = section('async function syncCoreDataToSupabase(){', '// Stock never travels through product metadata sync.');
assert.match(syncLoader, /if\(documentLoadStates\[table\]\?\.loaded\) await syncRevisionedDocuments/,
  'unopened document tables must never be compared with empty local arrays');

const backup = section('async function storeBackupDataSnapshot(){', 'function storeBackupFileName(){');
assert.match(backup, /loadAllSalesForBackup\(\)/,
  'backup must fully hydrate sales before taking its snapshot');
assert.match(backup, /loadAllDocumentsForBackup\(\)/,
  'backup must fully hydrate documents before taking its snapshot');

assert.match(source, /loadCompleteSalesRangeBtn/,
  'truncated report windows must offer an explicit complete-range load');
assert.match(source, /loadAllOnDemandDocsBtn/,
  'truncated document lists must offer an explicit older-document load');
assert.match(source, /async function findSaleByIdentifier/,
  'historical receipt lookups must be able to query outside the cached date window');
assert.match(source, /rreceivable:\['invoices_ar','credit_notes'\],rtax:\['goods_receipts'\]/,
  'VAT and receivable reports must hydrate every document family they aggregate');
assert.match(source, /ON_DEMAND_AGGREGATE_TABS=new Set\(\[[^\]]*'rreceivable'/,
  'receivable totals must block instead of rendering a truncated document set');
assert.match(source, /clearLoadedHistoryMemory\(\)/,
  'logout/reset paths must clear partial history from the previous session');

const helperSource = section('async function fetchBoundedRows(', '// Product reads use a lightweight manifest');
const helperContext = {};
vm.createContext(helperContext);
vm.runInContext(`${helperSource}; this.fetchBoundedRows=fetchBoundedRows;`, helperContext);

async function boundedResult(rowCount) {
  const rows = Array.from({length: rowCount}, (_, id) => ({id}));
  return helperContext.fetchBoundedRows(
    () => ({range: async (from, to) => ({data: rows.slice(from, to + 1), error: null})}),
    {pageSize: 2, maxRows: 4}
  );
}

(async () => {
  const exact = await boundedResult(4);
  assert.equal(exact.data.length, 4);
  assert.equal(exact.truncated, false, 'an exact max-sized result must not show a false truncation warning');

  const over = await boundedResult(5);
  assert.equal(over.data.length, 4);
  assert.equal(over.truncated, true, 'one row beyond the cap must surface truncation');

  console.log('on-demand history loading tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
