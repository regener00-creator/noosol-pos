const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function section(start,end){ return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))); }
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
  const calls=[];
  let response=async()=>({data:[],error:null});
  const ctx=vm.createContext({console,Map,Set,Promise,Number,currentProfile:{id:'owner'},activeWarehouseId:1,
    inventoryBalanceRows:[],inventoryLotRows:[],loadedInventoryBalanceWarehouseIds:new Set(),loadedInventoryLotWarehouseIds:new Set(),inventoryWarehouseLoadPromises:new Map(),
    isAllWarehousesMode:()=>false,normalizeInventoryLotRow:row=>row,rebuildInventoryBalanceMap(){},rebuildInventoryLotMap(){},applyActiveWarehouseInventory(){},
    sb:{from(table){const filters={table};const query={select:()=>query,in:(key,values)=>{filters[key]=[...values];return query;},gt:()=>query,order:()=>query};query.filters=filters;return query;}},
    fetchAllRows:async factory=>{const query=factory();calls.push(query.filters);return response(query.filters);}
  });
  vm.runInContext(section('function normalizedInventoryWarehouseIds(','function activeWarehouseStorageKey('),ctx);
  return {ctx,calls,respond:fn=>{response=fn;}};
}
test('targeted refresh removes exhausted lots but keeps unrelated products and warehouses',async()=>{
  const {ctx,calls}=setup();
  ctx.inventoryLotRows=[{id:1,product_id:10,warehouse_id:1},{id:2,product_id:11,warehouse_id:1},{id:3,product_id:10,warehouse_id:2}];
  await vm.runInContext('loadInventoryLotsFromSupabase({warehouseIds:[1],productIds:[10]})',ctx);
  assert.deepEqual(Array.from(ctx.inventoryLotRows,row=>row.id),[2,3]);
  assert.deepEqual(calls[0].product_id,[10]);assert.deepEqual(calls[0].warehouse_id,[1]);
  assert.equal(ctx.loadedInventoryLotWarehouseIds.size,0,'partial read never marks a whole warehouse loaded');
});
test('targeted balances refresh only selected products; empty scope does not query',async()=>{
  const {ctx,calls,respond}=setup();
  ctx.inventoryBalanceRows=[{product_id:10,warehouse_id:1,stock:8},{product_id:11,warehouse_id:1,stock:20}];
  respond(async()=>({data:[{product_id:10,warehouse_id:1,stock:-1}],error:null}));
  await vm.runInContext('loadInventoryBalancesFromSupabase({warehouseIds:[1],productIds:[10,10]})',ctx);
  assert.equal(ctx.inventoryBalanceRows.find(row=>row.product_id===11).stock,20);
  assert.equal(ctx.inventoryBalanceRows.find(row=>row.product_id===10).stock,-1);
  await vm.runInContext('loadInventoryBalancesFromSupabase({productIds:[]})',ctx);
  assert.equal(calls.length,1);
});
test('full read completes before a queued targeted refresh, preventing stale overwrite',async()=>{
  const {ctx,calls,respond}=setup();let release;
  respond(async filters=>filters.product_id?{data:[{product_id:10,warehouse_id:1,stock:7}],error:null}:new Promise(resolve=>release=resolve));
  const full=vm.runInContext('loadInventoryBalancesFromSupabase({warehouseIds:[1]})',ctx);await tick();
  const targeted=vm.runInContext('loadInventoryBalancesFromSupabase({warehouseIds:[1],productIds:[10]})',ctx);await tick();
  assert.equal(calls.length,1);
  release({data:[{product_id:10,warehouse_id:1,stock:10}],error:null});
  await Promise.all([full,targeted]);assert.equal(ctx.inventoryBalanceRows[0].stock,7);
});
test('failed read preserves cache; response from an invalidated session is ignored',async()=>{
  const {ctx,respond}=setup();let release;
  ctx.inventoryBalanceRows=[{product_id:10,warehouse_id:1,stock:20}];
  respond(async()=>({data:null,error:new Error('offline')}));
  assert.equal(await vm.runInContext('loadInventoryBalancesFromSupabase({productIds:[10]})',ctx),false);
  assert.equal(ctx.inventoryBalanceRows[0].stock,20);
  respond(()=>new Promise(resolve=>release=resolve));
  const pending=vm.runInContext('loadInventoryBalancesFromSupabase()',ctx);await tick();
  vm.runInContext('resetLoadedInventoryScopes()',ctx);
  release({data:[{product_id:10,warehouse_id:1,stock:999}],error:null});
  assert.equal(await pending,false);assert.equal(ctx.inventoryBalanceRows[0].stock,20);
});
test('large product scopes are bounded into batches and never fall back to all products',async()=>{
  const {ctx,calls}=setup();ctx.ids=Array.from({length:405},(_,i)=>i+1);
  await vm.runInContext('loadInventoryBalancesFromSupabase({productIds:ids})',ctx);
  assert.deepEqual(calls.map(call=>call.product_id.length),[200,200,5]);
});
test('dirty acknowledgement serializes only acknowledged products and keeps edits made while saving',async()=>{
  let release;const serialized=[];let saved;
  const ctx=vm.createContext({console,Map,Set,JSON,products:Array.from({length:2867},(_,i)=>({id:i+1,name:'old'})),productDirtyOperations:new Map([['7','update']]),
    normalizeProductDirtyOperations:value=>new Map(value),productMetadataToRow:row=>{serialized.push(row.id);return row;},
    tableSnapshot:(rows,toRow)=>new Map(rows.map(row=>[String(row.id),JSON.stringify(toRow(row))])),
    persistProductChangesToIndexedDB:async(changes,dirty)=>{saved={changes,dirty};await new Promise(resolve=>release=resolve);return true;}
  });
  vm.runInContext(section('async function clearAcknowledgedProductDirtyOperations(','async function refreshDocumentInventory('),ctx);
  const pending=vm.runInContext("clearAcknowledgedProductDirtyOperations(['7'],new Map([['7','update']]))",ctx);
  ctx.products[6].name='changed-during-write';release();await pending;
  assert.deepEqual(serialized,[7,7]);assert.deepEqual(Array.from(saved.changes.updatedIds),['7']);
  assert.equal(ctx.productDirtyOperations.get('7'),'update');
});
