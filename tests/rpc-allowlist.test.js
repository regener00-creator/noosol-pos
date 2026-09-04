const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const allowlist=JSON.parse(fs.readFileSync(path.join(root,'supabase','rpc-allowlist.json'),'utf8'));
const migrationName=fs.readdirSync(path.join(root,'supabase','migrations')).find(name=>name.endsWith('_optimize_rpc_and_representative_history.sql'));
assert.ok(migrationName,'ต้องมี Migration สำหรับ RPC allowlist');
const migration=fs.readFileSync(path.join(root,'supabase','migrations',migrationName),'utf8');

const allowedNames=new Set([...allowlist.anon,...allowlist.authenticated].map(signature=>signature.slice(0,signature.indexOf('('))));
const appRpcNames=[...app.matchAll(/sb\.rpc\('([^']+)'/g)].map(match=>match[1]);
for(const rpcName of appRpcNames) assert.ok(allowedNames.has(rpcName),`RPC ${rpcName} ที่แอปเรียกต้องอยู่ใน allowlist`);

assert.deepEqual([...allowlist.anon],['has_any_owner()']);
assert.equal(new Set(allowlist.authenticated).size,allowlist.authenticated.length,'allowlist ต้องไม่มีรายการซ้ำ');
assert.match(migration,/revoke execute on all functions in schema public from public,anon,authenticated/);
assert.match(migration,/alter default privileges for role postgres in schema public[\s\S]*revoke execute on functions from public/);
for(const retired of ['get_central_audit_logs(integer,integer)','resolve_sync_event(uuid)','save_representative_activity(','complete_sale(uuid,text,bigint,jsonb,jsonb)']){
  assert.match(migration,new RegExp(`drop function if exists public\\.${retired.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`),`ต้องลบ RPC เก่า ${retired}`);
}
assert.doesNotMatch(app,/sb\.rpc\('(get_central_audit_logs|resolve_sync_event|save_representative_activity)'/);

console.log('RPC allowlist tests passed');
