const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const {transformSync}=require('esbuild');

test('admin reset endpoint routes by shop and requires an owner, scope and password',async()=>{
  const source=fs.readFileSync('supabase/functions/admin-users/index.ts','utf8').replace(/^import .*supabase-js.*$/m,'');
  const requests=[],deletions=[];
  let owner=true,handler;
  const admin={
    auth:{getUser:async()=>({data:{user:{id:'owner',email:'owner@example.test'}}}),
      admin:{listUsers:async()=>({data:{users:[{id:'owner'}]}}),deleteUser:async id=>{deletions.push(id);return {};}}},
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:{owner,level:owner?1:2}})})})}),
    rpc:async(name,args)=>{requests.push([name,args]);return {data:{ok:true}};}
  };
  const verifier={auth:{signInWithPassword:async({password})=>({data:{user:password==='correct'?{}:null},error:null}),signOut:async()=>{}}};
  vm.runInNewContext(transformSync(source,{loader:'ts'}).code,{
    Request,Response,crypto:{randomUUID},console,
    Deno:{env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'service':'public'},serve:fn=>{handler=fn;}},
    createClient:(_url,key)=>key==='service'?admin:verifier
  });
  const call=async body=>handler(new Request('https://example.test/',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({
    action:'reset-store',mode:'documents',phrase:'ล้างเอกสารและสต๊อก',password:'correct',...body
  })}));
  assert.equal((await call({})).status,400);
  assert.equal((await call({warehouseId:2,allWarehouses:false,password:'wrong'})).status,403);
  owner=false;assert.equal((await call({warehouseId:2,allWarehouses:false})).status,403);owner=true;
  assert.equal((await call({mode:'factory',phrase:'คืนค่าโรงงาน',allWarehouses:false})).status,400);
  assert.deepEqual(requests,[]);
  assert.equal((await call({warehouseId:2,allWarehouses:false})).status,200);
  assert.equal(requests[0][0],'admin_reset_shop_documents');assert.equal(requests[0][1].p_warehouse_id,2);
  assert.deepEqual(deletions,[]);
  assert.equal((await call({mode:'factory',phrase:'คืนค่าโรงงาน',allWarehouses:true})).status,200);
  assert.deepEqual(requests.map(([name])=>name),['admin_reset_shop_documents','admin_prepare_owner_bootstrap_token','admin_reset_store_data']);
  assert.deepEqual(deletions,['owner']);
});
