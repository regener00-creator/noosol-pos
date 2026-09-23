const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('./load-app-source')();
const context={};vm.createContext(context);
for(const name of ['customerReturnAvailable','customerReturnRefund','cashShiftSummary','saleTaxSummary','rprofitCollect']){
  const fn=source.match(new RegExp('^function '+name+'\\([^\\n]*\\)\\{[\\s\\S]*?^\\}','m'));
  assert.ok(fn,name);vm.runInContext(fn[0],context);
}
const discounted={status:'done',items:[{qty:3,price:1,lineTotalGross:3}],discount:2};
assert.equal(context.customerReturnRefund(discounted,[{itemIndex:0,qty:1}]),.33);
discounted.customerReturnQuantities={0:1};assert.equal(context.customerReturnRefund(discounted,[{itemIndex:0,qty:1}]),.34);
discounted.customerReturnQuantities={0:2};assert.equal(context.customerReturnRefund(discounted,[{itemIndex:0,qty:1}]),.33);
const small={items:[{qty:1,price:.01},{qty:1,price:.01},{qty:1,price:.01}],discount:.02};
assert.equal(context.customerReturnRefund(small,[0,1,2].map(itemIndex=>({itemIndex,qty:1}))),.01,'all returned lines never exceed rounded bill');
discounted.customerReturnQuantities={0:3};assert.equal(context.customerReturnAvailable(discounted),false);
assert.equal(context.customerReturnAvailable({...discounted,customerReturnQuantities:{0:1}}),true);
assert.equal(context.customerReturnAvailable({...discounted,customerReturn:true}),false);
const returned={status:'done',date:'2026-09-23',cashShiftId:'s',customerReturn:true,items:[{qty:-1,price:100,lineTotal:-90,lineTotalGross:-90,cost:40,costTotal:-40}],total:-90,payMethod:'เงินสด',taxSummary:{subtotal:-90,total:-90,beforeVat:-90,vat:0}};
assert.equal(context.saleTaxSummary(returned).total,-90);
const summary=context.cashShiftSummary({id:'s',openingCash:1000},[returned,{cashShiftId:'s',total:150,payMethod:'เงินสด'}]);
assert.equal(summary.grossSales,150);assert.equal(summary.refunds,90);assert.equal(summary.expectedCash,1060);
Object.assign(context,{products:[],salesHistory:[returned],rprofitFilter:{applied:true,pay:'all',wh:'all'},rprofitPeriodRange:()=>({from:'2026-09-23',to:'2026-09-23'}),normalizeProductVatMode:x=>x,VAT_RATE:.07});
let report=context.rprofitCollect();assert.equal(report.revenue,-90);assert.equal(report.cost,-40);assert.equal(report.profit,-50);
returned.items[0].costTotal=0;report=context.rprofitCollect();assert.equal(report.profit,-90,'damaged return does not reverse the original cost');
console.log('Customer return amounts, cent rounding, permissions, signed tax/profit and shift models passed');
