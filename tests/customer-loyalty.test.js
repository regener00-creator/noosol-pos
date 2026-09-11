const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/migrations',fs.readdirSync(path.join(root,'supabase/migrations')).find(n=>n.endsWith('_customer_loyalty_points.sql'))),'utf8');
const fn=name=>source.match(new RegExp(`^function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?^\\}`,'m'))[0];
test('points cap, minimum, integer currency discount and customer isolation',()=>{
  const ctx=vm.createContext({saleLoyaltySelection:{customerId:1,points:100},activeSaleCustomer:()=>({id:1}),applyPromotions:()=>({}),cart:[],saleDiscount:0,cartTaxSummary:()=>({total:1000})});
  vm.runInContext(fn('loyaltyRedemptionLimit')+'\n'+fn('effectiveLoyaltyRedemption'),ctx);
  assert.equal(ctx.loyaltyRedemptionLimit(999.99,200),0);
  assert.equal(ctx.loyaltyRedemptionLimit(1000,200),200);
  assert.equal(ctx.loyaltyRedemptionLimit(1000.99,2000),1000);
  assert.equal(ctx.effectiveLoyaltyRedemption(),100);
  ctx.cartTaxSummary=()=>({total:999});assert.equal(ctx.effectiveLoyaltyRedemption(),0);
  ctx.cartTaxSummary=()=>({total:1000});ctx.activeSaleCustomer=()=>({id:2});assert.equal(ctx.effectiveLoyaltyRedemption(),0);
});
test('points are validated server-side and committed atomically with stock',()=>{
  assert.match(sql,/p_sale:=p_sale-'loyalty'/);
  assert.match(sql,/for update;[\s\S]*v_now:=clock_timestamp\(\);[\s\S]*v_state:=private.customer_loyalty_snapshot/);
  assert.match(sql,/floor\(\(p_sale->>'total'\)::numeric\/50\)/);
  assert.match(sql,/LOYALTY_CYCLE_CHANGED/);assert.match(sql,/LOYALTY_MINIMUM_1000/);assert.match(sql,/LOYALTY_INSUFFICIENT_POINTS/);
  assert.match(sql,/v_sale_data := private.finalize_sale_loyalty\(v_sale_data\)/);
  assert.match(sql,/where status='done' and data \? 'loyalty'/);
  assert.match(sql,/new.status='void'/);
});
test('points persist with ambiguous retry, not a separately charged payment',()=>{
  assert.match(fn('checkoutUiSnapshot'),/saleLoyaltySelection/);
  assert.match(fn('restorePendingCheckoutUi'),/snapshot.saleLoyaltySelection/);
  assert.match(source,/Number\(saleDiscount\)\+loyaltyRedeemed,vatRegistered/);
  assert.match(source,/saleDraft.loyaltyPeriodStart=loyaltyRedeemed\?saleLoyaltySelection\?\.periodStart:null/);
});
test('expiry warning uses calendar month thresholds and loyalty anniversary stays anchored',()=>{
  const ctx=vm.createContext({currentDateStr:()=> '2026-09-11',Date,Intl});
  vm.runInContext(fn('loyaltyExpiryWarning')+'\n'+fn('customerLoyaltyExpiryFromJoinedAt'),ctx);
  assert.equal(ctx.loyaltyExpiryWarning('2026-12-11').months,3);
  assert.equal(ctx.loyaltyExpiryWarning('2026-11-11').months,2);
  assert.equal(ctx.loyaltyExpiryWarning('2026-10-11').months,1);
  assert.equal(ctx.loyaltyExpiryWarning('2026-12-12'),null);
  assert.equal(ctx.customerLoyaltyExpiryFromJoinedAt('2025-09-12T00:00:00+07:00','2026-09-11'),'2026-09-12');
  assert.equal(ctx.customerLoyaltyExpiryFromJoinedAt('2024-02-29T00:00:00+07:00','2025-01-01'),'2025-02-28');
});
