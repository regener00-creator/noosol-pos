const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context={
  cart:[{lineId:1,pid:10,unit:'กล่อง',unitName:'กล่อง',price:220,qty:2}],
  products:[{id:10}],posActiveLineId:1,
  productUnitOptions:()=>[{name:'ซอง',factor:1,cost:5},{name:'กล่อง',factor:25,cost:125},{name:'ลัง',factor:250,cost:1250}],
  applySalePriceToLine:(line,product,unit)=>{line.price={ซอง:10,กล่อง:220,ลัง:2000}[unit];line.regularPrice=line.price;},
  render:()=>{},document:{getElementById:()=>null},
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/pos/unit-shortcuts.js'),'utf8'),context);
context.showPosUnitCycleMenu=()=>{};
assert.equal(context.cyclePosCartLineUnit(null),true);
assert.equal(context.cart[0].unit,'ลัง');
assert.equal(context.cart[0].price,2000);
assert.equal(context.cart[0].factor,250);
assert.equal(context.cart[0].cost,1250);
assert.equal(context.cart[0].qty,2);
context.cyclePosCartLineUnit(null);
assert.equal(context.cart[0].unit,'ซอง');
context.cyclePosCartLineUnit(null);
assert.equal(context.cart[0].unit,'กล่อง');
assert.equal(context.setPosCartLineUnit(1,'ไม่มีหน่วยนี้'),false);
context.cart[0].custom=true;
assert.equal(context.cyclePosCartLineUnit(null),false);
context.cart[0].custom=false;context.cart[0].autoFreeFromPromo=true;
assert.equal(context.setPosCartLineUnit(1,'ลัง'),false);
context.cart=[];
assert.equal(context.cyclePosCartLineUnit(null),false);
console.log('POS unit shortcut cycle and protected lines passed');
