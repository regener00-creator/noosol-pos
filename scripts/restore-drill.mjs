import { createClient } from '@supabase/supabase-js';
import { verifyShopRestore } from './verify-shop-restore.mjs';

const required = ['RESTORE_TEST_SUPABASE_URL', 'RESTORE_TEST_SUPABASE_KEY', 'RESTORE_TEST_OWNER_EMAIL', 'RESTORE_TEST_OWNER_PASSWORD', 'RESTORE_DRILL_BACKUP_BASE64'];
for (const name of required) if (!process.env[name]) throw new Error(`Missing required secret: ${name}`);
const url = process.env.RESTORE_TEST_SUPABASE_URL;
if (url.includes('tgwqmpvdjyxwivjxceoq')) throw new Error('Safety stop: restore drill must never target the Production project');

const payload = JSON.parse(Buffer.from(process.env.RESTORE_DRILL_BACKUP_BASE64, 'base64').toString('utf8'));

const client = createClient(url, process.env.RESTORE_TEST_SUPABASE_KEY, { auth: { persistSession: false } });
const { error: signInError } = await client.auth.signInWithPassword({ email: process.env.RESTORE_TEST_OWNER_EMAIL, password: process.env.RESTORE_TEST_OWNER_PASSWORD });
if (signInError) throw signInError;
try {
  console.log(JSON.stringify(await verifyShopRestore(client, payload)));
} finally {
  await client.auth.signOut();
}
