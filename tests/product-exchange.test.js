const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260822035255_product_exchanges.sql'), 'utf8');
const context = {};
vm.createContext(context);

const helpersStart = html.indexOf("const PRODUCT_EXCHANGE_STATUSES=");
const helpersEnd = html.indexOf('function currentDocKind(', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'ไม่พบ logic เอกสารเปลี่ยนสินค้า');
vm.runInContext(html.slice(helpersStart, helpersEnd), context);

const previewStart = html.indexOf('function productExchangeItemsPreview(');
const previewEnd = html.indexOf('function productExchangePreview(', previewStart);
assert.ok(previewStart >= 0 && previewEnd > previewStart, 'ไม่พบตัวแสดงรายการเปลี่ยนสินค้า');
context.escapeHtml = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
vm.runInContext(html.slice(previewStart, previewEnd), context);
assert.match(
  context.productExchangeItemsPreview([{name:'Decolgen prin (4 tablets)',qty:1,unit:'ซอง'}]),
  /Decolgen prin \(4 tablets\) ×1 ซอง/
);

assert.equal(context.productExchangeItemBaseQty({qty:10,factor:1}), 10);
assert.equal(context.productExchangeItemBaseQty({qty:2,factor:5}), 10);
assert.equal(context.productExchangeItemBaseQty({qty:'1.5',factor:'12'}), 18);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.productExchangeTransitionPlan({status:'ร่าง',outgoingApplied:false,incomingApplied:false}, 'ส่งไปเปลี่ยนแล้ว'))),
  {allowed:true,status:'ส่งไปเปลี่ยนแล้ว',applyOutgoing:true,applyIncoming:false}
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.productExchangeTransitionPlan({status:'ส่งไปเปลี่ยนแล้ว',outgoingApplied:true,incomingApplied:false}, 'รับสินค้ากลับแล้ว'))),
  {allowed:true,status:'รับสินค้ากลับแล้ว',applyOutgoing:false,applyIncoming:true}
);
assert.equal(context.productExchangeTransitionPlan({status:'รับสินค้ากลับแล้ว',outgoingApplied:true,incomingApplied:true}, 'รับสินค้ากลับแล้ว').allowed, false);
assert.equal(context.productExchangeTransitionPlan({status:'ส่งไปเปลี่ยนแล้ว',outgoingApplied:true,incomingApplied:false}, 'ร่าง').allowed, false);

const partialReconciliation = context.productExchangeReconciliation({
  outgoingItems:[
    {pid:1,name:'Ranidine',qty:1,unit:'กล่อง',factor:1},
    {pid:2,name:'Lotemo Kids',qty:1,unit:'ขวด',factor:1},
    {pid:3,name:'Decolgen',qty:1,unit:'แผง',factor:1},
  ],
  incomingItems:[
    {pid:2,name:'Lotemo Kids',qty:1,unit:'ขวด',factor:1},
    {pid:3,name:'Decolgen',qty:1,unit:'แผง',factor:1},
  ],
});
assert.equal(partialReconciliation.fullyReturned, false);
assert.deepEqual(JSON.parse(JSON.stringify(partialReconciliation.unreturnedItems.map(item=>item.pid))), [1]);
assert.equal(partialReconciliation.unreturnedItems[0].qty, 1);

const completeReconciliation = context.productExchangeReconciliation({
  outgoingItems:[{pid:1,qty:3,unit:'กล่อง',factor:1}],
  incomingItems:[{pid:1,qty:3,unit:'กล่อง',factor:1}],
});
assert.equal(completeReconciliation.fullyReturned, true);
assert.equal(completeReconciliation.unreturnedItems.length, 0);

const differentProductReconciliation = context.productExchangeReconciliation({
  outgoingItems:[{pid:1,name:'Ranidine',qty:3,unit:'กล่อง',factor:1}],
  incomingItems:[{pid:4,name:'สินค้าอื่น',qty:2,unit:'ชิ้น',factor:1}],
});
assert.deepEqual(JSON.parse(JSON.stringify(differentProductReconciliation.unreturnedItems.map(item=>[item.pid,item.qty]))), [[1,3]]);
assert.deepEqual(JSON.parse(JSON.stringify(differentProductReconciliation.replacementItems.map(item=>item.pid))), [4]);

const partialQuantityReconciliation = context.productExchangeReconciliation({
  outgoingItems:[{pid:1,name:'Ranidine',qty:3,unit:'กล่อง',factor:2}],
  incomingItems:[{pid:1,name:'Ranidine',qty:2,unit:'กล่อง',factor:2}],
});
assert.equal(partialQuantityReconciliation.unreturnedItems[0].qty, 1);
assert.equal(partialQuantityReconciliation.unreturnedItems[0].baseQty, 2);

context.products = [
  {id:1,name:'Decolgen',unit:'กล่อง',stock:10,expiry:'2027-07-05'},
  {id:2,name:'สินค้าอื่น',unit:'ชิ้น',stock:3,expiry:'2027-12-01'},
];
const document = {
  outgoingItems:[{pid:1,qty:10,factor:1}],
  incomingItems:[{pid:1,qty:2,factor:5,expiry:'2027-10-10'}]
};
context.applyProductExchangeLocally(document,{applyOutgoing:true,applyIncoming:false});
assert.equal(context.products[0].stock,0);
context.applyProductExchangeLocally(document,{applyOutgoing:false,applyIncoming:true});
assert.equal(context.products[0].stock,10);
assert.equal(context.products[0].expiry,'2027-10-10');

context.products = [
  {id:1,name:'Ranidine',unit:'กล่อง',stock:5,expiry:'2027-01-01'},
  {id:2,name:'Lotemo Kids',unit:'ขวด',stock:5,expiry:'2027-01-01'},
  {id:3,name:'Decolgen',unit:'แผง',stock:5,expiry:'2027-01-01'},
  {id:4,name:'สินค้าทดแทน',unit:'ชิ้น',stock:0,expiry:''},
];
const partialReturnDocument = {
  outgoingItems:[{pid:1,qty:1,factor:1},{pid:2,qty:1,factor:1},{pid:3,qty:1,factor:1}],
  incomingItems:[{pid:2,qty:1,factor:1,expiry:'2028-02-01'},{pid:4,qty:1,factor:1,expiry:'2028-03-01'}],
};
context.applyProductExchangeLocally(partialReturnDocument,{applyOutgoing:true,applyIncoming:false});
context.applyProductExchangeLocally(partialReturnDocument,{applyOutgoing:false,applyIncoming:true});
assert.deepEqual(context.products.map(product=>product.stock), [4,5,4,1]);

const navSource=html.slice(html.indexOf('const NAV = ['),html.indexOf('function renderSidebar'));
assert.ok(navSource.indexOf("['productexchange','เปลี่ยนสินค้า'") > navSource.indexOf("['goodsreceipt','รับเข้าสินค้า'"), 'เมนูเปลี่ยนสินค้าต้องอยู่ใต้รับเข้าสินค้า');
assert.match(html, /productexchange:\s*renderProductExchange/);
assert.match(html, /\['product_exchanges', \(\)=>productExchanges/);
assert.match(html, /id="confirmExchangeSentBtn"/);
assert.match(html, /id="confirmExchangeReceivedBtn"/);
assert.match(html, /คัดลอกจากสินค้าที่ส่งไป/);
assert.match(html, /รับคืนไม่ครบหรือรับเป็นสินค้าคนละตัวได้/);
assert.match(html, /รายการเหล่านี้จะถือว่าถูกตัดออกจากสต๊อกถาวร/);
assert.match(html, /draft\.unreturnedItems=reconciliation\.unreturnedItems/);
assert.match(html, /refusePostedDocumentDeletion\('exchange'/);
assert.match(html, /เคยส่งผลต่อสต๊อกแล้ว กรุณาเก็บไว้เป็นประวัติ/);

assert.match(migration, /create table if not exists public\.product_exchanges/);
assert.match(migration, /enable row level security/);
assert.match(migration, /create or replace function public\.apply_product_exchange_status/);
assert.match(migration, /where id = v_pid and coalesce\(stock,0\) >= v_qty/);
assert.match(migration, /revoke execute on function public\.apply_product_exchange_status\(text,text\) from public, anon/);

console.log('product exchange tests passed');
