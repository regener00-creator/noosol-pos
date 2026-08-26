const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0039_central_audit_log.sql'), 'utf8');
const compactMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0040_compact_central_audit_payloads.sql'), 'utf8');
const indexMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0041_trim_central_audit_indexes.sql'), 'utf8');

assert.match(migration,/create table if not exists public\.audit_logs/);
assert.match(migration,/alter table public\.audit_logs enable row level security/);
assert.match(migration,/create policy audit_logs_owner_read/);
assert.match(migration,/private\.is_current_owner\(\)/);
assert.match(migration,/revoke all on public\.audit_logs from public,anon,authenticated/);
assert.match(migration,/revoke execute on function public\.get_central_audit_logs\(integer,integer\) from public,anon/);
assert.match(migration,/current_setting\('pepos\.maintenance_reset',true\)='on'/);
assert.doesNotMatch(migration,/delete from public\.audit_logs/,'store reset must preserve existing audit history');
assert.match(migration,/from public\.inventory_count_adjustments/);
assert.match(migration,/from public\.product_unit_changes/);
assert.match(migration,/from private\.inventory_lot_detail_audit/);
assert.match(migration,/where m\.reference_type='lot_reallocation'/);
assert.match(compactMigration,/private\.audit_changed_values/);
assert.match(compactMigration,/private\.audit_identity_snapshot/);
assert.match(compactMigration,/jsonb_object_keys\(v_before\|\|v_after\)/);
assert.match(indexMigration,/drop index if exists public\.idx_audit_logs_entity_occurred/);

assert.match(html,/\['auditlog','Audit Log'/);
assert.match(html,/auditlog: renderAuditLog/);
assert.match(html,/sb\.rpc\('get_central_audit_logs'/);
assert.match(html,/\(tab==='settingsusers'\|\|tab==='auditlog'\)&&user\.owner!==true/);

console.log('central audit log tests passed');
