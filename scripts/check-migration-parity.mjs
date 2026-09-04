import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const migrationDirectory=path.join(root,'supabase','migrations');
const migrationPattern=/^(\d{14})_[a-z0-9_]+\.sql$/;
const files=fs.readdirSync(migrationDirectory).filter(name=>name.endsWith('.sql')).sort();
const invalid=files.filter(name=>!migrationPattern.test(name));
if(invalid.length) throw new Error(`ชื่อไฟล์ Migration ไม่ถูกต้อง: ${invalid.join(', ')}`);
const local=files.map(name=>name.match(migrationPattern)[1]);
const duplicates=local.filter((version,index)=>local.indexOf(version)!==index);
if(duplicates.length) throw new Error(`เลข Migration ซ้ำ: ${[...new Set(duplicates)].join(', ')}`);

const requireLive=process.argv.includes('--require-live');
const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
if(!databaseUrl){
  if(requireLive) throw new Error('ต้องตั้ง GitHub secret SUPABASE_DB_URL เพื่อเทียบ Migration กับ Supabase');
  console.log(`Migration ใน GitHub ถูกต้อง ${local.length} รายการ (ไม่ได้ตรวจ Supabase เพราะไม่มี SUPABASE_DB_URL)`);
  process.exit(0);
}

const result=spawnSync('supabase',['migration','list','--db-url',databaseUrl],{
  cwd:root,encoding:'utf8',shell:process.platform==='win32',env:{...process.env,SUPABASE_DB_URL:''}
});
if(result.error) throw result.error;
if(result.status!==0) throw new Error(String(result.stderr||result.stdout||'ตรวจ Migration บน Supabase ไม่สำเร็จ').trim());

const remote=[];
for(const line of String(result.stdout||'').split(/\r?\n/)){
  const columns=line.split('|').map(value=>value.trim());
  if(columns.length<2) continue;
  const localVersion=/^\d{14}$/.test(columns[0])?columns[0]:'';
  const remoteVersion=/^\d{14}$/.test(columns[1])?columns[1]:'';
  if(localVersion&&remoteVersion&&localVersion!==remoteVersion){
    throw new Error(`ลำดับ Migration ไม่ตรงกัน: GitHub ${localVersion}, Supabase ${remoteVersion}`);
  }
  if(remoteVersion) remote.push(remoteVersion);
}
if(!remote.length) throw new Error('อ่านรายการ Migration จาก Supabase ไม่ได้');
const missingRemote=local.filter(version=>!remote.includes(version));
const missingLocal=remote.filter(version=>!local.includes(version));
if(missingRemote.length||missingLocal.length){
  throw new Error([
    missingRemote.length?`มีใน GitHub แต่ไม่มีใน Supabase: ${missingRemote.join(', ')}`:'',
    missingLocal.length?`มีใน Supabase แต่ไม่มีใน GitHub: ${missingLocal.join(', ')}`:''
  ].filter(Boolean).join('\n'));
}
console.log(`Migration ตรงกันครบ ${local.length} รายการ`);
