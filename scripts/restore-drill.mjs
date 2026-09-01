import { createClient } from '@supabase/supabase-js';

const required = ['RESTORE_TEST_SUPABASE_URL', 'RESTORE_TEST_SUPABASE_KEY', 'RESTORE_TEST_OWNER_EMAIL', 'RESTORE_TEST_OWNER_PASSWORD', 'RESTORE_DRILL_BACKUP_BASE64'];
for (const name of required) if (!process.env[name]) throw new Error(`Missing required secret: ${name}`);
const url = process.env.RESTORE_TEST_SUPABASE_URL;
if (url.includes('tgwqmpvdjyxwivjxceoq')) throw new Error('Safety stop: restore drill must never target the Production project');

const payload = JSON.parse(Buffer.from(process.env.RESTORE_DRILL_BACKUP_BASE64, 'base64').toString('utf8'));
if (payload?.format !== 'pepos-pharmacy-store-backup' || Number(payload?.version) !== 2) throw new Error('Backup format is not supported');

const client = createClient(url, process.env.RESTORE_TEST_SUPABASE_KEY, { auth: { persistSession: false } });
const { error: signInError } = await client.auth.signInWithPassword({ email: process.env.RESTORE_TEST_OWNER_EMAIL, password: process.env.RESTORE_TEST_OWNER_PASSWORD });
if (signInError) throw signInError;
const { data: restoreResult, error: restoreError } = await client.rpc('restore_store_backup_atomic', { p_backup: payload });
if (restoreError) throw restoreError;

const expectedProducts = Array.isArray(payload?.data?.products) ? payload.data.products.length : 0;
const expectedLots = Array.isArray(payload?.data?.inventoryBackup?.lots) ? payload.data.inventoryBackup.lots.length : 0;
const [{ count: actualProducts, error: productError }, { count: actualLots, error: lotError }] = await Promise.all([
  client.from('products').select('id', { count: 'exact', head: true }),
  client.from('inventory_lots').select('id', { count: 'exact', head: true }),
]);
if (productError) throw productError;
if (lotError) throw lotError;
if (actualProducts !== expectedProducts || actualLots !== expectedLots) throw new Error(`Restore verification mismatch: products ${actualProducts}/${expectedProducts}, lots ${actualLots}/${expectedLots}`);

await client.auth.signOut();
console.log(JSON.stringify({ ok: true, epoch: restoreResult?.epoch || null, products: actualProducts, lots: actualLots }));
