const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = require('./load-app-source')();
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260904151421_representative_product_activity_notes.sql'), 'utf8');
const historyRender = html.slice(html.indexOf('function renderRepresentativeHistory(){'),html.indexOf('function syncRepresentativeActivityDraftFromForm(){'));

assert.match(migration, /alter table public\.notes[\s\S]*representative_id bigint[\s\S]*product_id bigint[\s\S]*activity_type text/);
assert.match(migration, /references public\.sales_representatives\(id\) on delete set null/);
assert.match(migration, /references public\.products\(id\) on delete set null/);
assert.match(migration, /notes_representative_activity_idx/);
assert.match(migration, /notes_product_activity_idx/);
assert.match(migration, /grant insert \(representative_id,product_id,activity_type/);
assert.match(migration, /create trigger audit_notes_changes/);

assert.match(html, /function renderRepresentativeHistory\(\)/);
assert.match(html, /function renderRepresentativeHistoryOverview\(\)/);
assert.match(html, /function loadRepresentativeActivityHistory\(/);
assert.match(html, /function representativeDocumentActivities\(/);
assert.match(html, /\['purchase_orders','goods_receipts','purchase_orders_full','product_returns'\]/);
assert.match(html, /companyMatches\.length===1\?companyMatches\[0\]:null/, 'must not guess a representative when several people share one company');
assert.match(html, /data-representative-history=/);
assert.match(html, /data-product-representative-history=/);
assert.match(html, /\['representativehistory','ประวัติผู้แทน'/);
assert.match(html, /representativehistory: renderRepresentativeHistoryOverview/);
assert.match(historyRender, /class="representative-history-filter representative-history-filter-minimal panel"/);
assert.match(historyRender, /id="representativeHistoryTypeFilter"/);
assert.match(historyRender, /id="searchRepresentativeHistoryBtn"/);
assert.doesNotMatch(historyRender, /representativeHistoryRepresentativeFilter|representativeHistoryProductFilter|representativeHistoryFromFilter|representativeHistoryToFilter|representativeHistoryReminderFilter|clearRepresentativeHistoryFiltersBtn|reloadRepresentativeHistoryBtn|representative-history-result-count/);
assert.match(html, /\.representative-activity-timeline\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(html, /data-open-representative-history=/);
assert.match(html, /data-open-product-history=/);
assert.match(html, /บันทึกรายการนี้จะแสดงในหน้า NOTE และ Timeline/);
assert.match(html, /activity_type:draft\.activityType\|\|'general'/);
assert.match(html, /notes:'NOTE \/ ประวัติผู้แทน'/);

console.log('representative activity history tests passed');
