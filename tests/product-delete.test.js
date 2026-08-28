const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const html=fs.readFileSync('index.html','utf8');
const migration=fs.readFileSync('supabase/migrations/0048_delete_unused_products.sql','utf8');

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

const sandbox={
  cart:[],salesHistory:[],quotations:[],invoicesAR:[],creditNotes:[],purchaseOrders:[],goodsReceipts:[],
  productExchanges:[],purchaseOrdersFull:[],productReturns:[],transfers:[],standaloneTaxInvoices:[],
  inspectionLists:[],promotions:[],inventoryBalanceRows:[],inventoryLotRows:[],
};
vm.createContext(sandbox);
vm.runInContext(`${extractFunction('valueReferencesProduct')}\n${extractFunction('productDeletionLocalBlockers')}`,sandbox);

assert.equal(sandbox.valueReferencesProduct({items:[{productId:42}]},42),true);
assert.equal(sandbox.valueReferencesProduct({nested:{pid:'42'}},42),true);
assert.equal(sandbox.valueReferencesProduct({bgdBuyProductId:42},42),true);
assert.equal(sandbox.valueReferencesProduct({items:[{productId:41}]},42),false);
assert.deepEqual(Array.from(sandbox.productDeletionLocalBlockers(42)),[]);

sandbox.inventoryBalanceRows=[{product_id:42,stock:1}];
assert.deepEqual(Array.from(sandbox.productDeletionLocalBlockers(42)),['จำนวนคงเหลือในคลัง']);
sandbox.inventoryBalanceRows=[];
sandbox.salesHistory=[{items:[{productId:42}]}];
assert.deepEqual(Array.from(sandbox.productDeletionLocalBlockers(42)),['ประวัติการขาย']);
sandbox.salesHistory=[];
sandbox.promotions=[{buy:{productId:42}}];
assert.deepEqual(Array.from(sandbox.productDeletionLocalBlockers(42)),['โปรโมชั่น']);

assert(html.includes('id="deleteProductBtn"'));
assert(html.includes("sb.rpc('delete_unused_product'"));
assert(migration.includes('private.is_current_owner()'));
assert(migration.includes('public.sale_items'));
assert(migration.includes('public.inventory_lots'));
assert(migration.includes('public.inventory_count_adjustment_lines'));
assert(migration.includes('revoke all on function public.delete_unused_product(bigint) from public,anon'));
console.log('product delete tests passed');
