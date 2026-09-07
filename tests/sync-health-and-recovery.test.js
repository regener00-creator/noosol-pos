const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'supabase','functions','admin-users','index.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20260907072135_optimize_client_sync_and_health_alerts.sql'),'utf8');

assert.match(app,/PENDING_CLIENT_EVENTS_KEY/);
assert.match(app,/async function flushPendingClientEvents\(\)/);
assert.match(app,/window\.addEventListener\('online',[\s\S]*flushPendingClientEvents\(\)/);
assert.match(app,/from\('products'\)\.select\('id,revision'\)/);
assert.match(app,/fetchProductRevisionManifest\(\)/);
assert.match(app,/owner_resolve_sync_event/);
assert.match(app,/get_owner_database_health/);
assert.match(app,/id="recoveryNewPassword"[^>]*type="password"/);
assert.match(app,/async function enforceOwnerRecoverySetup\(\)/);
assert.match(admin,/action === 'recovery-status'/);
assert.match(admin,/action === 'save-own-recovery'/);
assert.match(migration,/create table if not exists public\.product_change_log/);
assert.match(migration,/create trigger products_capture_change/);
assert.match(migration,/100 \* 1024 \* 1024/);
assert.match(migration,/250 \* 1024 \* 1024/);
assert.match(migration,/grant select on table public\.product_change_log to authenticated/);

console.log('sync health and recovery tests passed');
