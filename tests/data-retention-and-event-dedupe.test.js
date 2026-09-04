const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const migrationName = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .find((name) => name.endsWith('_bounded_retention_and_event_dedupe.sql'));

assert.ok(migrationName, 'bounded retention migration must exist');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', migrationName),
  'utf8',
);
const optimizedMigrationName=fs.readdirSync(path.join(root,'supabase','migrations')).find(name=>name.endsWith('_optimize_rpc_and_representative_history.sql'));
assert.ok(optimizedMigrationName,'RPC retirement migration must exist');
const optimizedMigration=fs.readFileSync(path.join(root,'supabase','migrations',optimizedMigrationName),'utf8');

assert.match(migration, /create extension if not exists pg_cron with schema pg_catalog/i);
assert.match(migration, /create or replace function private\.run_data_retention/i);
assert.match(migration, /greatest\(1, least\(coalesce\(p_batch_size, 500\), 5000\)\)/i);
assert.match(migration, /for update skip locked/gi);
assert.match(migration, /insert into private\.audit_logs_archive/i);
assert.match(migration, /delete from public\.audit_logs/i);
assert.match(migration, /delete from public\.print_events/i);
assert.match(migration, /delete from public\.sync_events/i);
assert.match(migration, /delete from private\.operation_ledger/i);
assert.match(migration, /delete from cron\.job_run_details/i);
assert.match(migration, /print_events_printed_at_idx/i);
assert.match(migration, /sync_events_occurred_at_idx/i);
assert.match(migration, /cron\.schedule\([\s\S]*'pepos-bounded-data-retention'/i);
assert.match(migration, /'17 17 \* \* \*'/i);
assert.doesNotMatch(migration, /(?:insert|update)\s+cron\.job/i);

assert.match(migration, /print_events_metadata_bounded/i);
assert.match(migration, /sync_events_context_bounded/i);
assert.match(migration, /octet_length\(v_metadata::text\) > 16384/i);
assert.match(migration, /octet_length\(v_context::text\) > 16384/i);
assert.match(migration, /jsonb_typeof\(v_metadata\) <> 'object'/i);
assert.match(migration, /jsonb_typeof\(v_context\) <> 'object'/i);

assert.match(migration, /create or replace function private\.sync_event_dedupe_key/i);
assert.match(migration, /add column if not exists occurrence_count bigint/i);
assert.match(migration, /create unique index if not exists sync_events_open_dedupe_idx/i);
assert.match(migration, /on conflict \(actor_id, dedupe_key\)[\s\S]*do update/i);
assert.match(migration, /occurrence_count\s*=\s*existing\.occurrence_count \+ 1/i);
assert.match(migration, /create or replace function public\.resolve_sync_event/i);
assert.match(migration, /event\.actor_id = v_actor[\s\S]*private\.is_current_owner\(\)/i);
assert.match(migration, /set status = 'resolved',[\s\S]*resolved_at = clock_timestamp\(\)/i);
assert.match(migration, /create or replace function public\.resolve_own_sync_events/i);
assert.match(migration, /event\.actor_id = v_actor[\s\S]*event\.device_id = v_device_id/i);
assert.match(migration, /event\.occurred_at <= coalesce\(p_through, clock_timestamp\(\)\)/i);
assert.match(migration, /event\.occurred_at < timestamptz '2026-09-01 15:36:01\+00'/i);
assert.match(migration, /'operation_ledger', 2555/i);
assert.match(migration, /coalesce\(v_days, 2555\)/i);
assert.match(migration, /operation_ledger_completed_idx/i);
assert.match(migration, /ledger\.completed_at is not null[\s\S]*ledger\.completed_at < v_cutoff/i);
assert.match(migration, /function private\.run_data_retention[\s\S]*security invoker/i);
assert.match(migration, /revoke all on function private\.run_data_retention\(integer\)[\s\S]*service_role/i);
assert.match(optimizedMigration,/drop function if exists public\.resolve_sync_event\(uuid\)/i);

assert.doesNotMatch(migration, /vacuum\s+full/i);
assert.doesNotMatch(migration, /\bcluster\s+public\.products/i);
assert.doesNotMatch(migration, /delete\s+from\s+public\.products/i);
assert.doesNotMatch(migration, /drop\s+index[^;]*idx_products_name/i);

assert.match(app, /sb\.rpc\('resolve_own_sync_events',\{p_device_id:currentDeviceId\(\),p_through:/,
  'a successful device sync must close its older open sync events');
assert.match(app, /await resolveOwnSyncEventsThrough\(syncAttemptStartedAt\);[\s\S]{0,100}setSyncUiState\('synced',0\)/,
  'sync events must resolve only after the full sync attempt succeeds');

console.log('bounded retention and event dedupe tests passed');
