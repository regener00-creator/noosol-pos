const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260901083020_security_reliability_hardening.sql'), 'utf8');

assert.match(app, /let syncUiLastError=null;/, 'ต้องเก็บสาเหตุล่าสุดในเครื่อง แม้ส่งเหตุการณ์ขึ้นเซิร์ฟเวอร์ไม่ได้');
assert.match(app, /function rememberSyncUiError\(/);
assert.match(app, /\.from\('sync_events'\)[\s\S]{0,300}\.order\('occurred_at',\{ascending:false\}\)[\s\S]{0,100}\.limit\(30\)/);
assert.match(app, /function openSyncDetailsModal\(/);
assert.match(app, /if\(syncUiState==='error'\|\|syncUiErrorCount>0\|\|!navigator\.onLine\)/);
assert.match(app, /ลองซิงก์ใหม่/);
assert.match(app, /ตัวเลขบนปุ่มคือจำนวนรอบที่ซิงก์ล้มเหลว ไม่ใช่จำนวนรายการข้อมูล/);
assert.match(app, /permission denied\|row-level security\|rls/);
assert.match(app, /revision_conflict\|40001/);
assert.match(styles, /\.sync-detail-modal/);
assert.match(styles, /\.sync-detail-cause/);

assert.match(migration, /alter table public\.sync_events enable row level security/i);
assert.match(migration, /create policy sync_events_read[\s\S]*for select[\s\S]*to authenticated[\s\S]*actor_id = \(select auth\.uid\(\)\)[\s\S]*or \(select private\.is_current_owner\(\)\)/i);
assert.match(migration, /grant select on table public\.sync_events to authenticated/i);
assert.match(migration, /revoke insert, update, delete on table public\.sync_events from authenticated/i);

console.log('sync detail tests passed');
