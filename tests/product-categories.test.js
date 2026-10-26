const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('src/products/category-settings.js','utf8');
function fixture(){
  const calls=[];
  const context=vm.createContext({products:[],currentProfile:{id:'owner',owner:true},navigator:{onLine:true},
    captureWorkspaceRead:()=>1,isWorkspaceReadCurrent:()=>true,
    refreshCategoryBrandUnitLists(){},persistWorkspaceData(){},
    sb:{rpc:async(name,args)=>{calls.push({name,args});return {error:null};}},
    escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')});
  vm.runInContext(source,context);
  return {context,calls,run:code=>vm.runInContext(code,context)};
}
test('shared subcategory is filtered by main category and blank subcategory means General',()=>{
  const {run}=fixture();
  run(`productCategorySettings={categories:['ยา','อาหารเสริม','เครื่องสำอาง'],subcategories:[{name:'ยาคุม',categories:['ยา']},{name:'BLACKMORES',categories:['ยา','อาหารเสริม']}]}`);
  assert.equal(run(`productCategoryValidationError('ยา','BLACKMORES')`),'');
  assert.equal(run(`productCategoryValidationError('อาหารเสริม','BLACKMORES')`),'');
  assert.notEqual(run(`productCategoryValidationError('อาหารเสริม','ยาคุม')`),'');
  assert.equal(run(`productCategoryValidationError('ยา','')`),'');
  for(const value of ['', ' ', 'ไม่ทราบหมวดหมู่', '__add__','ไม่มี']) assert.notEqual(run(`productCategoryValidationError(${JSON.stringify(value)},'ทั่วไป')`),'');
  assert.equal(run(`JSON.stringify(productSubcategoryNames('เครื่องสำอาง'))`),'["ทั่วไป"]');
});
test('legacy products seed their existing relationships without moving or editing products',()=>{
  const {context,run}=fixture();
  context.products=[{category:'ยา',brand:'ยาคุม'},{category:'อาหารเสริม',brand:'BLACKMORES'},{category:'',brand:''},{category:'ยา',brand:''}];
  const before=JSON.stringify(context.products);
  assert.equal(run(`JSON.stringify(effectiveProductCategorySettings().categories)`),'["ยา","อาหารเสริม"]');
  assert.equal(run(`JSON.stringify(productSubcategoryNames('ยา'))`),'["ทั่วไป","ยาคุม"]');
  assert.equal(JSON.stringify(context.products),before);
});
test('configured empty groups, shared names and HTML characters survive normalization safely',()=>{
  const {run}=fixture();
  run(`productCategorySettings={categories:['ยา','ยา','อาหารเสริม','<ใหม่>','__proto__'],subcategories:[{name:'BLACKMORES',categories:['ยา','ไม่มี']},{name:'BLACKMORES',categories:['อาหารเสริม']},{name:'ทั่วไป',categories:['ยา']}]}`);
  assert.equal(run(`JSON.stringify(effectiveProductCategorySettings().categories)`),'["ยา","อาหารเสริม","<ใหม่>"]');
  assert.equal(run(`effectiveProductCategorySettings().subcategories.length`),1);
  assert.match(run(`productCategorySelects({category:'<ใหม่>'}).main`),/&lt;ใหม่>/);
  assert.match(run(`productCategorySelects({}).main`),/required/);
});
test('settings save uses owner RPC and only changes local state after successful acknowledgement',async()=>{
  const {context,run,calls}=fixture();
  run('productCategorySettingsLoaded=true');
  await run(`saveProductCategorySettings({categories:['ยา'],subcategories:[]})`);
  assert.equal(calls[0].name,'owner_set_setting');
  assert.equal(calls[0].args.p_key,'product_categories');
  assert.equal(run('productCategorySettings.categories[0]'),'ยา');
  context.sb.rpc=async()=>({error:new Error('offline')});
  await assert.rejects(run(`saveProductCategorySettings({categories:['อาหารเสริม'],subcategories:[]})`),/offline/);
  assert.equal(run('productCategorySettings.categories[0]'),'ยา');
  context.currentProfile.owner=false;
  await assert.rejects(run(`saveProductCategorySettings({categories:[],subcategories:[]})`),/เจ้าของร้าน/);
});
test('reload reads shared settings and rejects stale workspace responses',async()=>{
  const {context,run}=fixture();
  let resolve;
  context.sb.from=table=>{assert.equal(table,'settings');return {select:()=>({eq:(key,value)=>{assert.equal(value,'product_categories');return {maybeSingle:()=>new Promise(done=>{resolve=done;})};}})};};
  const pending=run('loadProductCategorySettingsFromSupabase()');
  resolve({data:{value:{categories:['ยา'],subcategories:[]}},error:null});
  assert.equal(await pending,true);
  assert.equal(run('productCategorySettingsLoaded'),true);
  const stale=run('loadProductCategorySettingsFromSupabase()');
  context.isWorkspaceReadCurrent=()=>false;
  resolve({data:{value:{categories:['อื่น'],subcategories:[]}},error:null});
  assert.equal(await stale,false);
  assert.equal(run('productCategorySettings.categories[0]'),'ยา');
});
