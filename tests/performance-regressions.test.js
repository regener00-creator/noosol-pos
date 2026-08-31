const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const duplicateIndexCleanup = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260831185755_remove_duplicate_cash_shift_index.sql'),
  'utf8'
);

function section(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return html.slice(start, end);
}

const renderSection = section('function render(){', 'function syncTopbarFormActions(');
assert.doesNotMatch(
  renderSection,
  /schedulePersistWorkspaceData\s*\(/,
  'rendering UI must not serialize or synchronize the workspace'
);

const persistSection = section('function persistWorkspaceData(options={}){', 'function schedulePersistWorkspaceData(){');
assert.match(
  persistSection,
  /const workspaceChanged=serialized!==lastPersistedWorkspaceJson/,
  'workspace persistence must detect unchanged lightweight data'
);
assert.match(persistSection,/if\(productChanges\) productCachePromise=persistProductChangesToIndexedDB\(productChanges\)/,'product mutations must persist only changed rows immediately');
assert.match(persistSection,/productCachePromise\.then\(saved=>\{ if\(saved\) scheduleSupabaseCoreSync\(\); \}\)/,'product network sync must wait for its incremental cache write');
assert.match(persistSection,/else if\(workspaceChanged\) scheduleSupabaseCoreSync\(\)/,'unchanged renders must not schedule network work');
assert.doesNotMatch(persistSection,/persistProductsToIndexedDB\(products,true\)/,'single-product edits must not fingerprint the full catalog');

assert.doesNotMatch(
  html,
  /<script\b[^>]*\bsrc=["'][^"']*xlsx(?:\.full)?\.min\.js[^"']*["'][^>]*><\/script>/i,
  'the Excel library must not block login/startup'
);
assert.match(
  html,
  /(?:async\s+)?function\s+ensureXlsxLoaded\s*\(/,
  'Excel actions must load XLSX on demand through ensureXlsxLoaded()'
);

const mobileRefreshSection = section(
  'async function refreshMobileToolsData(button,options={}){',
  'function renderMobileTools('
);
assert.doesNotMatch(
  mobileRefreshSection,
  /loadCoreDataFromSupabase\s*\(/,
  'mobile resume must not reload the complete catalog, contacts, and documents'
);
assert.match(mobileRefreshSection, /loadInventoryBalancesFromSupabase\s*\(/);
assert.match(mobileRefreshSection, /loadInventoryLotsFromSupabase\s*\(/);
assert.match(mobileRefreshSection, /loadInspectionListsFromSupabase\s*\(/);

assert.doesNotMatch(html, /\bsetInterval\s*\(/, 'background work must remain event-driven or debounced');

assert.match(
  duplicateIndexCleanup,
  /drop index if exists public\.idx_cash_shifts_closed_by_fk/i,
  'the duplicate cash-shift actor index must stay removed'
);
assert.doesNotMatch(
  duplicateIndexCleanup,
  /drop index if exists public\.idx_cash_shifts_closed_by\s*;/i,
  'the established cash-shift actor index must remain available'
);

console.log('performance regression tests passed');
