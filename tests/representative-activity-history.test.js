const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = require('./load-app-source')();
const baseMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260904151421_representative_product_activity_notes.sql'), 'utf8');
const multiProductMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260904151422_representative_activity_multiple_products.sql'), 'utf8');
const managedProductsMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260904183146_representative_managed_products_and_notes.sql'), 'utf8');
const historyRender = html.slice(html.indexOf('function renderRepresentativeHistory(){'),html.indexOf('function syncRepresentativeActivityDraftFromForm(){'));
const activityForm = html.slice(html.indexOf('function representativeActivityFormHtml(){'),html.indexOf('function representativeActivityCardHtml('));

assert.match(baseMigration, /alter table public\.notes[\s\S]*representative_id bigint[\s\S]*product_id bigint[\s\S]*activity_type text/);
assert.match(baseMigration, /create trigger audit_notes_changes/);
assert.match(multiProductMigration, /create table public\.representative_activity_items/);
assert.match(multiProductMigration, /create or replace function public\.save_representative_activity/);

assert.match(managedProductsMigration, /create table public\.sales_representative_products/);
assert.match(managedProductsMigration, /primary key \(representative_id,product_id\)/);
assert.match(managedProductsMigration, /sales_representative_products_product_rep_idx/);
assert.match(managedProductsMigration, /alter table public\.sales_representative_products enable row level security/);
assert.match(managedProductsMigration, /create policy sales_representative_products_read/);
assert.match(managedProductsMigration, /representative_activity_items item[\s\S]*on conflict \(representative_id,product_id\) do nothing/);
assert.match(managedProductsMigration, /create or replace function public\.save_representative_note/);
assert.match(managedProductsMigration, /security definer[\s\S]*set search_path = ''/);
assert.match(managedProductsMigration, /for update[\s\S]*p_expected_updated_at/);
assert.match(managedProductsMigration, /delete from public\.sales_representative_products[\s\S]*insert into public\.sales_representative_products/);
assert.match(managedProductsMigration, /delete from public\.representative_activity_items/);
assert.match(managedProductsMigration, /revoke all on function public\.save_representative_note/);

assert.match(html, /function renderRepresentativeHistory\(\)/);
assert.match(html, /function renderRepresentativeHistoryOverview\(\)/);
assert.match(html, /function loadRepresentativeActivityHistory\(/);
assert.match(html, /sb\.from\('sales_representative_products'\)/);
assert.match(html, /function representativeHistoryGroups\(\)/);
assert.match(html, /function representativeHistoryGroupHtml\(/);
assert.match(html, /data-representative-history=/);
assert.match(html, /data-product-representative-history=/);
assert.match(html, /\['representativehistory','ประวัติผู้แทน'/);
assert.match(html, /representativehistory: renderRepresentativeHistoryOverview/);

assert.match(historyRender, /id="representativeHistoryRepresentativeSearch"/);
assert.match(historyRender, /id="representativeHistoryProductSearch"/);
assert.match(historyRender, /id="representativeHistoryNoteSearch"/);
assert.match(historyRender, /ค้นหาจาก NOTE/);
assert.doesNotMatch(historyRender, /representativeHistoryTypeFilter|ทุกประเภท|โปรโมชั่นที่ยังใช้ได้|ถึงกำหนดติดตาม/);
assert.match(html, /\.representative-groups-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(html, /\.representative-history-page\{width:100%;max-width:none;margin:0;\}/);
assert.match(html, /data-open-representative-history=/);
assert.match(html, /data-open-product-history=/);
assert.match(html, /รายการสินค้าที่ดูแลมี/);
assert.match(html, /NOTE \$\{index\+1\} :/);

assert.match(activityForm, /กำหนดสินค้าที่ผู้แทนดูแล และเพิ่ม NOTE พร้อมวันที่และหัวข้อ/);
assert.match(activityForm, /ชื่อผู้แทน/);
assert.match(activityForm, /รายการสินค้าที่ดูแล/);
assert.match(activityForm, /NOTE เพิ่มเติม/);
assert.match(activityForm, /id="repActivityEventDate"/);
assert.match(activityForm, /id="repActivityTitle"/);
assert.match(activityForm, /id="repActivityContent"/);
assert.match(activityForm, /id="representativeManagedProductSearch"/);
assert.doesNotMatch(activityForm, /id="addRepresentativeActivityItemBtn"|data-representative-item-field="productSearch"/);
assert.doesNotMatch(activityForm, /repActivityType|repActivityValidFrom|repActivityValidTo|repActivityReminderDate|quotedPrice|minimumQuantity|conditionNote|เริ่มโปรโมชั่น|สิ้นสุดโปรโมชั่น|วันที่ติดตาม/);
assert.match(html, /\.representative-managed-product-selection-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(html, /sb\.rpc\('save_representative_note',rpcPayload\)/);
assert.match(html, /p_product_ids:enteredItems\.map/);
assert.match(html, /notes:'NOTE \/ ประวัติผู้แทน'/);

console.log('representative activity history tests passed');
