const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..'),app=require('./load-app-source')();
test('replacement RPCs use terminal conflicts and retain security checks',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20260912084207_non_retryable_revision_conflicts.sql'),'utf8');
  assert.doesNotMatch(sql,/errcode\s*=\s*'40001'/i);
  assert.equal((sql.match(/errcode\s*=\s*'PT409'/gi)||[]).length,4);
  assert.match(sql,/private\.is_current_owner\(\)/);assert.match(sql,/auth\.uid\(\)/);
  assert.match(sql,/SECURITY DEFINER/i);assert.match(sql,/SET search_path TO ''/);
});
test('contact code allocation is central, unique, and does not truncate long sequences',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20260912085150_server_assigned_contact_codes.sql'),'utf8');
  assert.match(sql,/create unique index.*contacts_code_unique/i);assert.match(sql,/upper\(btrim\(data->>'code'\)\)/i);
  assert.match(sql,/nextval\('private.contact_code_sequence'/);assert.match(sql,/greatest\(4,length\(v_number\)\)/);
  assert.match(sql,/revoke all on sequence[\s\S]*from public,\s*anon,\s*authenticated/i);
});
test('old purchase-order runtime is gone but read-only historical backup stays',()=>{
  assert.doesNotMatch(app,/\bpo2\b|\bpurchaseorder2\b|let purchaseOrdersFull/);
  assert.match(app,/sb\.from\('purchase_orders_full'\)\.select\('\*'\)\.order\('id'\)/);
  assert.match(app,/data\.purchaseOrdersFull=\(legacy\.data\|\|\[\]\)\.map\(rowToDoc\)/);
});
test('service worker caches only assets and caps runtime entries without removing shell files',async()=>{
  const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const ctx=vm.createContext({URL,Set,Promise,self:{location:{origin:'https://test.local'},addEventListener:()=>{}}});vm.runInContext(worker,ctx);
  const allowed=url=>ctx.isCacheableAsset(new URL(url,'https://test.local'));
  assert.equal(allowed('/api/customers'),false);assert.equal(allowed('/private-document.pdf'),false);
  assert.equal(allowed('/page-documents.js?v=1'),true);assert.equal(allowed('/sapuri-brand-logo.webp'),true);
  assert.equal(allowed('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0'),true);
  assert.equal(allowed('https://cdn.jsdelivr.net/npm/arbitrary-package@1/index.js'),false);
  const removed=[];const keys=[{url:'https://test.local/index.html'},...Array.from({length:90},(_,i)=>({url:`https://test.local/page-documents.js?v=${i}`}))];
  await ctx.trimRuntimeCache({keys:async()=>keys,delete:async request=>removed.push(request.url)});
  assert.equal(removed.length,10);assert.equal(removed.includes('https://test.local/index.html'),false);
});
test('deployed lossless assets are smaller than originals and original art is retained',()=>{
  for(const name of ['sapuri-brand-logo','sapuri-pharmacy-logo']){
    assert.ok(fs.statSync(path.join(root,`${name}.webp`)).size<fs.statSync(path.join(root,`${name}.png`)).size*0.8);
  }
});
