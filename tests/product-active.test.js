const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const html = require("./load-app-source")();
const migration=fs.readFileSync('supabase/migrations/20260828071028_inactive_products.sql','utf8');

function extractFunction(name){
  const start=html.indexOf(`function ${name}(`);
  assert(start>=0,`missing ${name}`);
  let brace=html.indexOf('{',start),depth=0;
  for(let index=brace;index<html.length;index++){
    if(html[index]==='{') depth++;
    if(html[index]==='}'&&--depth===0) return html.slice(start,index+1);
  }
  throw new Error(`unterminated ${name}`);
}

const sandbox={products:[{id:1,name:'เดิม'},{id:2,name:'ปิด',active:false},{id:3,name:'เปิด',active:true}]};
vm.createContext(sandbox);
vm.runInContext(`${extractFunction('isProductActive')}\n${extractFunction('activeProducts')}`,sandbox);

assert.equal(sandbox.isProductActive({}),true,'legacy product defaults to active');
assert.equal(sandbox.isProductActive({active:true}),true);
assert.equal(sandbox.isProductActive({active:false}),false);
assert.deepEqual(Array.from(sandbox.activeProducts().map(product=>product.id)),[1,3]);

assert(html.includes('id="f_active"'));
assert(html.includes("active: g('f_active') ? g('f_active').checked"));
assert(/function documentProductPool\(\)\{\r?\n  return activeProducts\(\);/.test(html));
assert(html.includes('const matches = activeProducts().filter'));
assert(html.includes('product-status-badge">ปิดใช้งาน'));
assert(migration.includes('prevent_inactive_product_sale_item'));
assert(migration.includes("product.data ->> 'active'"));
assert(migration.includes('before insert or update of product_id on public.sale_items'));

console.log('product active tests passed');
