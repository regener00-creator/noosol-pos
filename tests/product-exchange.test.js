const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0009_product_exchanges.sql'), 'utf8');
const context = {};
vm.createContext(context);

const helpersStart = html.indexOf("const PRODUCT_EXCHANGE_STATUSES=");
const helpersEnd = html.indexOf('function currentDocKind(', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'ไม่พบ logic เอกสารเปลี่ยนสินค้า');
vm.runInContext(html.slice(helpersStart, helpersEnd), context);

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

assert.ok(html.indexOf("['productexchange','เปลี่ยนสินค้า'") > html.indexOf("['goodsreceipt','รับเข้าสินค้า'"), 'เมนูเปลี่ยนสินค้าต้องอยู่ใต้รับเข้าสินค้า');
assert.match(html, /productexchange:\s*renderProductExchange/);
assert.match(html, /\['product_exchanges', \(\)=>productExchanges/);
assert.match(html, /id="confirmExchangeSentBtn"/);
assert.match(html, /id="confirmExchangeReceivedBtn"/);
assert.match(html, /คัดลอกจากสินค้าที่ส่งไป/);
assert.match(html, /การลบเอกสารจะไม่ย้อนหรือเปลี่ยนแปลงสต๊อกที่ลงไปแล้ว/);

assert.match(migration, /create table if not exists public\.product_exchanges/);
assert.match(migration, /enable row level security/);
assert.match(migration, /create or replace function public\.apply_product_exchange_status/);
assert.match(migration, /where id = v_pid and coalesce\(stock,0\) >= v_qty/);
assert.match(migration, /revoke execute on function public\.apply_product_exchange_status\(text,text\) from public, anon/);

console.log('product exchange tests passed');
