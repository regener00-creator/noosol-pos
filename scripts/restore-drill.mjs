import { createClient } from '@supabase/supabase-js';

const required = ['RESTORE_TEST_SUPABASE_URL', 'RESTORE_TEST_SUPABASE_KEY', 'RESTORE_TEST_OWNER_EMAIL', 'RESTORE_TEST_OWNER_PASSWORD', 'RESTORE_DRILL_BACKUP_BASE64'];
for (const name of required) if (!process.env[name]) throw new Error(`Missing required secret: ${name}`);
const url = process.env.RESTORE_TEST_SUPABASE_URL;
if (url.includes('tgwqmpvdjyxwivjxceoq')) throw new Error('Safety stop: restore drill must never target the Production project');

const payload = JSON.parse(Buffer.from(process.env.RESTORE_DRILL_BACKUP_BASE64, 'base64').toString('utf8'));
if (payload?.format !== 'pepos-pharmacy-store-backup' || Number(payload?.version) !== 3) throw new Error('A complete version 3 backup is required');

const client = createClient(url, process.env.RESTORE_TEST_SUPABASE_KEY, { auth: { persistSession: false } });
const { error: signInError } = await client.auth.signInWithPassword({ email: process.env.RESTORE_TEST_OWNER_EMAIL, password: process.env.RESTORE_TEST_OWNER_PASSWORD });
if (signInError) throw signInError;
const { data: restoreResult, error: restoreError } = await client.rpc('restore_store_backup_atomic', { p_backup: payload });
if (restoreError) throw restoreError;

const { data: restored, error: exportError } = await client.rpc('export_store_backup');
if (exportError) throw exportError;
let verifiedTables = 0;
for (const [name, expected] of Object.entries(payload.manifest || {})) {
  // Audit/print/idempotency history is merged, never truncated by a restore.
  if (expected.scope !== 'replace') continue;
  const actual = restored?.manifest?.[name];
  if (!actual || actual.rows !== expected.rows || actual.md5 !== expected.md5) throw new Error(`Restore verification mismatch: ${name}`);
  verifiedTables++;
}
if (!verifiedTables || !restoreResult?.ok) throw new Error('Restore did not verify any complete tables');

await client.auth.signOut();
console.log(JSON.stringify({ ok: true, epoch: restoreResult?.epoch || null, verifiedTables }));
