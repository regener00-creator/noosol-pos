const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(){
  const context=vm.createContext({TODAY_STR:'2026-10-27',cart:[],promotions:[],products:[{id:1,name:'Decolgen',unit:'แผง',cost:10},{id:2,name:'Gift',unit:'ขวด',cost:5}],lineCounter:100,productUnitCost:p=>p.cost});
  vm.runInContext(fs.readFileSync('src/promotions/rules-and-view.js','utf8'),context);
  context.promotions=[{id:10,active:true,scope:'buygetdiff',name:'ซื้อ 2 แถม 1',bgdBuyProductId:1,bgdBuyUnit:'แผง',bgdBuyQty:2,bgdGetProductId:2,bgdGetUnit:'ขวด',bgdGetQty:1}];
  context.cart=[{lineId:1,pid:3,unit:'ชิ้น',qty:1},{lineId:2,pid:1,unit:'แผง',qty:4,price:20},{lineId:3,pid:4,unit:'ชิ้น',qty:1}];
  return context;
}
const ids=context=>Array.from(context.cart,line=>line.pid);
test('promotion gift follows row 002 before the next sale item and remains stable on recalculation',()=>{
  const context=fixture();
  for(let repeat=0;repeat<3;repeat++){
    context.reconcileAutoFreeLines();
    assert.deepEqual(ids(context),[3,1,2,4]);
    assert.equal(context.cart[2].autoFreeFromPromo,10);
    assert.equal(context.cart[2].qty,2);
    assert.equal(context.cart[2].price,0);
  }
  context.cart[1].qty=2;context.reconcileAutoFreeLines();
  assert.deepEqual(ids(context),[3,1,2,4]);assert.equal(context.cart[2].qty,1);
  context.cart[1].qty=1;context.reconcileAutoFreeLines();
  assert.deepEqual(ids(context),[3,1,4]);
  context.cart[1].qty=2;context.reconcileAutoFreeLines();
  context.cart=context.cart.filter(line=>line.lineId!==2);context.reconcileAutoFreeLines();
  assert.deepEqual(ids(context),[3,4]);
});
test('different promotions keep each gift next to its own qualifying sale item',()=>{
  const context=fixture();
  context.products.push({id:5,name:'Other gift',unit:'ชิ้น',cost:2});
  context.promotions.unshift({...context.promotions[0],id:11,bgdBuyProductId:4,bgdBuyUnit:'ชิ้น',bgdBuyQty:1,bgdGetProductId:5,bgdGetUnit:'ชิ้น'});
  context.reconcileAutoFreeLines();
  assert.deepEqual(ids(context),[3,1,2,4,5]);
});
test('special prices remain ineligible for free gifts',()=>{
  for(const priceSource of ['customer','quotation']){
    const context=fixture();context.cart[1].priceSource=priceSource;context.reconcileAutoFreeLines();
    assert.deepEqual(ids(context),[3,1,4]);
  }
});
