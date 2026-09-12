const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const sell=app.slice(app.indexOf('function sellQuotationAtPos('),app.indexOf('function emptyCustomerContactDraft('));
function context(items){
  const ctx={quotations:[{id:'Q-TEST',customer:'Test',customerInfo:{id:8},items,discount:5}],cart:[],lineCounter:1,
    products:[{id:7,name:'Product',unit:'box',price:180}],isProductActive:()=>true,
    productUnitOptions:p=>[{name:p.unit,price:p.price,cost:20,factor:10}],confirm:()=>true,
    customersList:()=>[{id:8,name:'Test'}],customerSaleSnapshot:c=>c,customerDefaultDocument:()=>'',
    showToast:()=>{},render:()=>{}};
  vm.createContext(ctx);vm.runInContext(sell,ctx);return ctx;
}
test('quotation POS preserves distinct source lines and quoted prices, including zero',()=>{
  const ctx=context([160,150,0].map(price=>({productId:7,name:'Product',unit:'box',price,qty:2})));
  ctx.sellQuotationAtPos('Q-TEST');
  assert.deepEqual(Array.from(ctx.cart,l=>l.price),[160,150,0]);
  assert.deepEqual(Array.from(ctx.cart,l=>l.sourceQuotationLineIndex),[0,1,2]);
  assert.ok(ctx.cart.every(l=>l.sourceQuotationId==='Q-TEST'&&l.priceSource==='quotation'&&l.factor===10));
  assert.equal(ctx.saleSourceQuotationId,'Q-TEST');assert.equal(ctx.saleMember.id,8);
  assert.equal(ctx.saleDiscount,5);assert.equal(ctx.currentTab,'checkout');
  // Held carts serialize the complete cart; index zero must survive too.
  assert.equal(JSON.parse(JSON.stringify(ctx.cart))[0].sourceQuotationLineIndex,0);
});
test('legacy name-only quotations work; a missing explicit product cannot fall back to a namesake',()=>{
  const legacy=context([{name:'Product',unit:'box',price:150,qty:1}]);legacy.sellQuotationAtPos('Q-TEST');
  assert.equal(legacy.cart.length,1);
  const missing=context([{productId:999,name:'Product',unit:'box',price:150,qty:1}]);missing.sellQuotationAtPos('Q-TEST');
  assert.equal(missing.cart.length,0);
});
test('checkout sends quotation line identity to the atomic server and explains stale quotes',()=>{
  assert.match(app,/sourceQuotationLineIndex:l\.sourceQuotationLineIndex\?\?null/);
  assert.match(app,/sourceQuotationLineIndex:item\.sourceQuotationLineIndex/);
  assert.match(app,/lowerMessage\.includes\('quotation'\)\?'ข้อมูลใบเสนอราคา/);
  const dir=path.join(__dirname,'..','supabase','migrations');
  const sql=fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(n=>n.endsWith('_allow_verified_quotation_prices.sql'))),'utf8');
  assert.match(sql,/from public\.quotations q where q\.id = v_id for share/);
  assert.match(sql,/v_customer_id is distinct from.*customerId/);
  assert.match(sql,/line\.ord = v_index \+ 1/);
  assert.match(sql,/v_prices <> 1/);
  assert.match(sql,/revoke all on function private\.resolve_quotation_price/);
  assert.match(sql,/quotation price cannot be combined with a promotion/);
  assert.match(sql,/quotation requires a catalog product/);
  assert.ok(sql.indexOf('v_expected_price := private.resolve_quotation_price(')<sql.lastIndexOf('if v_price = 0 and v_expected_price > 0 then'));
  assert.match(sql,/complete_sale quotation price guard does not match the expected version/);
});
