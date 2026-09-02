const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260902103032_allow_controlled_full_table_reset_where_clauses.sql'),
  'utf8',
);

assert.match(migration, /admin_reset_store_data_core_20260831\(text,uuid,text\)/i);
assert.match(migration, /restore_store_backup_atomic\(jsonb\)/i);
assert.match(migration, /restore_store_inventory_backup\(jsonb,jsonb\)/i);
assert.match(migration, /delete from \\1 where true/i);
assert.match(migration, /\\1 where true/i);
assert.doesNotMatch(migration, /set safeupdate\.enabled|alter role|alter database/i);
assert.match(migration, /revoke all on function public\.admin_reset_store_data_core_20260831/i);
assert.match(migration, /grant execute on function public\.admin_reset_store_data\(text, uuid, text\)\s+to service_role/i);
assert.match(migration, /grant execute on function public\.restore_store_backup_atomic\(jsonb\)\s+to authenticated/i);
assert.match(migration, /unsafe DELETE remains/i);

console.log('controlled full-table reset safeupdate tests passed');
