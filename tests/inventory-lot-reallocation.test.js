const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '0038_inventory_lot_reallocation.sql'), 'utf8');

assert.match(html, /data-stock-control-mode="lots"/);
assert.match(html, /ปรับจำนวนแยกตาม LOT/);
assert.match(html, /sb\.rpc\('reallocate_inventory_lots'/);
assert.match(html, /currentProfile\?\.owner!==true/);
assert.match(html, /id="stockLotReallocationUnit"/);

const helperStart = html.indexOf('function stockLotReallocationPayload(');
const helperEnd = html.indexOf('function stockLotReallocationDifferenceHtml(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const context = {
  inventoryMovementRound: value => Math.round((Number(value) || 0) * 1000000) / 1000000,
  productUnitOptions: product => [
    {name:product.unit,factor:1},
    ...(product.units || []).map(unit => ({name:unit.sub,factor:unit.factor})),
  ],
};
vm.createContext(context);
vm.runInContext(html.slice(helperStart, helperEnd), context);

const groups = [
  {key:'A',quantityBase:400,rows:[{id:1,quantity_base:400}]},
  {key:'B',quantityBase:50,rows:[{id:2,quantity_base:50}]},
  {key:'C',quantityBase:250,rows:[{id:3,quantity_base:100},{id:4,quantity_base:150}]},
];
const summary = context.stockLotReallocationSummary(groups, {A:400,B:75,C:225});
assert.equal(summary.oldTotal, 700);
assert.equal(summary.newTotal, 700);
assert.equal(summary.balanced, true);
assert.equal(summary.changedCount, 2);
assert.deepEqual(
  JSON.parse(JSON.stringify(summary.payload)),
  [
    {lotId:1,expectedQuantity:400,newQuantity:400},
    {lotId:2,expectedQuantity:50,newQuantity:75},
    {lotId:3,expectedQuantity:100,newQuantity:100},
    {lotId:4,expectedQuantity:150,newQuantity:125},
  ]
);

const boxSummary = context.stockLotReallocationSummary(groups, {A:16,B:3,C:9}, 25);
assert.equal(boxSummary.oldTotal, 700);
assert.equal(boxSummary.newTotal, 700);
assert.equal(boxSummary.balanced, true);
assert.deepEqual(JSON.parse(JSON.stringify(boxSummary.payload)), JSON.parse(JSON.stringify(summary.payload)));
assert.equal(context.stockLotReallocationDisplayQuantity(725, 25), 29);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.stockLotReallocationUnitOptions({unit:'ซอง',units:[{sub:'กล่อง',factor:25},{sub:'ลัง',factor:2500}]}))),
  [{name:'ซอง',factor:1},{name:'กล่อง',factor:25},{name:'ลัง',factor:2500}]
);

const wrongTotal = context.stockLotReallocationSummary(groups, {A:400,B:75,C:250});
assert.equal(wrongTotal.newTotal, 725);
assert.equal(wrongTotal.balanced, false);

const invalid = context.stockLotReallocationSummary(groups, {A:400,B:-1,C:301});
assert.equal(invalid.valid, false);
assert.equal(invalid.balanced, false);

assert.match(migration, /create or replace function public\.reallocate_inventory_lots/);
assert.match(migration, /if not \(select private\.is_current_owner\(\)\) then raise exception 'owner access required'/);
assert.match(migration, /order by lot\.id\s+for update/);
assert.match(migration, /Lot quantity changed before confirmation/);
assert.match(migration, /new Lot total must equal current stock/);
assert.match(migration, /warehouse balance does not match Lot total/);
assert.match(migration, /'lot_reallocation_in'/);
assert.match(migration, /'lot_reallocation_out'/);
assert.match(migration, /private\.refresh_inventory_balance_from_lots/);
assert.match(migration, /revoke execute on function public\.reallocate_inventory_lots\(bigint,bigint,text,jsonb\) from public,anon,authenticated/);
assert.match(migration, /grant execute on function public\.reallocate_inventory_lots\(bigint,bigint,text,jsonb\) to authenticated/);

console.log('inventory Lot reallocation tests passed');
