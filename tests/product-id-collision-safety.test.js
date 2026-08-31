const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function section(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return html.slice(start, end);
}

const helperSource = section('const PRODUCT_ID_RANDOM_BASE=', 'function standardizePrintPreview(');
const generatedLowWords = [7, 8];
let cryptoCalls = 0;
const helperSandbox = {
  products: [{id:0x10000000000000 + 7, sku:'P0113'}],
  crypto: {
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
    getRandomValues(words) {
      cryptoCalls++;
      words[0] = 0;
      words[1] = generatedLowWords.shift();
      return words;
    },
  },
  console,
};
vm.createContext(helperSandbox);
vm.runInContext(`${helperSource}; this.generateClientProductId=generateClientProductId; this.generateProductCreateToken=generateProductCreateToken; this.allocateReadableProductSku=allocateReadableProductSku;`, helperSandbox);

const generatedId = helperSandbox.generateClientProductId();
assert.equal(generatedId, 0x10000000000000 + 8, 'a local collision must be retried');
assert.equal(cryptoCalls, 2, 'Web Crypto must be the primary source');
assert.ok(Number.isSafeInteger(generatedId) && generatedId > 0, 'product id must be a positive JS-safe bigint value');
assert.ok(generatedId >= 0x10000000000000, 'random ids must not overlap legacy sequential ids');
assert.equal(helperSandbox.generateProductCreateToken(), '11111111-2222-4333-8444-555555555555');

const skuAllocation = helperSandbox.allocateReadableProductSku(['P0113', 'p0114', 'CUSTOM'], 113);
assert.deepEqual(JSON.parse(JSON.stringify(skuAllocation)), {sku:'P0115', nextSequence:116});
assert.notEqual(skuAllocation.sku, String(generatedId), 'readable SKU sequence must be independent from the random database id');

const fallbackSandbox = {
  products: [],
  crypto: null,
  Math: Object.assign(Object.create(Math), {random: () => 0.25}),
  Date: {now: () => 1234567890},
};
vm.createContext(fallbackSandbox);
vm.runInContext(`${helperSource}; this.generateClientProductId=generateClientProductId;`, fallbackSandbox);
const fallbackId = fallbackSandbox.generateClientProductId();
assert.ok(Number.isSafeInteger(fallbackId) && fallbackId > 0, 'fallback id must also remain positive and JS-safe');

const syncSource = section('function productCreateTokenFromRow(', '// Sync only rows changed');
function createSyncSandbox(insertResponses=[],selectResponses=[],updateResponses=[]) {
  const insertCalls=[];
  const selectCalls=[];
  const updateCalls=[];
  const sandbox={
    sb:{
      from(table){
        return {
          insert:async rows=>{
            insertCalls.push({table,rows:JSON.parse(JSON.stringify(rows))});
            return insertResponses.shift()||{error:null};
          },
          select:columns=>({
            in:async(column,ids)=>{
              selectCalls.push({table,columns,column,ids:[...ids]});
              return selectResponses.shift()||{data:[],error:null};
            },
          }),
          upsert:()=>{ throw new Error('product inserts must never upsert'); },
          update:changes=>{
            const filters=[];
            const builder={
              eq(column,value){ filters.push({kind:'eq',column,value}); return builder; },
              contains(column,value){ filters.push({kind:'contains',column,value}); return builder; },
              async select(columns){
                updateCalls.push({table,changes:JSON.parse(JSON.stringify(changes)),filters:JSON.parse(JSON.stringify(filters)),columns});
                const id=filters.find(filter=>filter.kind==='eq'&&filter.column==='id')?.value;
                return updateResponses.shift()||{data:[{id}],error:null};
              },
            };
            return builder;
          },
        };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${syncSource}; this.insertRowsInChunks=insertRowsInChunks;`,sandbox);
  return {sandbox,insertCalls,selectCalls,updateCalls};
}

async function run() {
  const tokenA='create-token-a',tokenB='create-token-b';
  const rowA={id:generatedId,sku:'P0115',name:'local A',category:'ยา',brand:'ทั่วไป',product_type:'stock',warehouse_id:1,stock:10,cost:5,price:12,unit:'กล่อง',data:{_clientCreateToken:tokenA,name:'local A',stock:10}};
  const rowB={id:generatedId+1,data:{_clientCreateToken:tokenB,name:'local B'}};

  const normal=createSyncSandbox([{error:null}]);
  assert.equal(await normal.sandbox.insertRowsInChunks('products',[rowA,rowB]),null);
  assert.deepEqual(normal.insertCalls,[{table:'products',rows:[rowA,rowB]}],'normal create must remain one bulk insert');
  assert.equal(normal.selectCalls.length,0,'successful inserts need no verification read');

  const previousSuccess=createSyncSandbox(
    [{error:{code:'23505',message:'duplicate key'}}],
    [{data:[JSON.parse(JSON.stringify(rowA))],error:null}],
  );
  assert.equal(await previousSuccess.sandbox.insertRowsInChunks('products',[rowA]),null,'same creation token proves an ambiguous earlier insert succeeded');
  assert.equal(previousSuccess.insertCalls.length,1);
  assert.equal(previousSuccess.selectCalls.length,1);
  assert.equal(previousSuccess.updateCalls.length,0,'an exact previous success needs no metadata write');

  const metadataDrift=createSyncSandbox(
    [{error:{code:'23505',message:'duplicate key'}}],
    [{data:[{...rowA,name:'server P0',data:{...rowA.data,name:'server P0',stock:999}}],error:null}],
  );
  assert.equal(await metadataDrift.sandbox.insertRowsInChunks('products',[rowA]),null,'same token may safely finish a later local metadata edit');
  assert.equal(metadataDrift.updateCalls.length,1);
  assert.deepEqual(metadataDrift.updateCalls[0].filters,[
    {kind:'eq',column:'id',value:rowA.id},
    {kind:'contains',column:'data',value:{_clientCreateToken:tokenA}},
  ],'metadata retry update must be guarded by id and creation token');
  assert.ok(!Object.hasOwn(metadataDrift.updateCalls[0].changes,'stock'),'retry reconciliation must never overwrite stock');
  assert.ok(!Object.hasOwn(metadataDrift.updateCalls[0].changes.data,'stock'),'stock must also be removed from JSON metadata');

  const metadataUpdateFailure=createSyncSandbox(
    [{error:{code:'23505',message:'duplicate key'}}],
    [{data:[{...rowA,name:'server P0',data:{...rowA.data,name:'server P0'}}],error:null}],
    [{error:{code:'NETWORK',message:'metadata update ambiguous'}}],
  );
  assert.equal((await metadataUpdateFailure.sandbox.insertRowsInChunks('products',[rowA]))?.code,'NETWORK','failed metadata reconciliation must keep the product dirty');

  const metadataGuardLostRace=createSyncSandbox(
    [{error:{code:'23505',message:'duplicate key'}}],
    [{data:[{...rowA,name:'server P0',data:{...rowA.data,name:'server P0'}}],error:null}],
    [{data:[],error:null}],
  );
  assert.equal((await metadataGuardLostRace.sandbox.insertRowsInChunks('products',[rowA]))?.code,'PRODUCT_ID_COLLISION','zero guarded rows means identity changed and must fail closed');

  const partialRetry=createSyncSandbox(
    [{error:{code:'23505',message:'duplicate key'}},{error:null}],
    [{data:[JSON.parse(JSON.stringify(rowA))],error:null}],
  );
  assert.equal(await partialRetry.sandbox.insertRowsInChunks('products',[rowA,rowB]),null);
  assert.deepEqual(partialRetry.insertCalls,[
    {table:'products',rows:[rowA,rowB]},
    {table:'products',rows:[rowB]},
  ],'partial retry must insert only rows still missing on the server');

  const genuineCollision=createSyncSandbox(
    [{error:{code:'23505',message:'duplicate key'}}],
    [{data:[{id:rowA.id,data:{_clientCreateToken:'different-create-token'}}],error:null}],
  );
  const collisionError=await genuineCollision.sandbox.insertRowsInChunks('products',[rowA]);
  assert.equal(collisionError?.code,'PRODUCT_ID_COLLISION');
  assert.equal(collisionError?.productId,rowA.id);
  assert.equal(genuineCollision.insertCalls.length,1,'a genuine collision must fail closed without overwrite/retry');

  const missingTokenCollision=createSyncSandbox(
    [{error:{code:'23505',message:'duplicate key'}}],
    [{data:[{id:rowA.id,data:{name:'even exact-looking legacy row'}}],error:null}],
  );
  assert.equal((await missingTokenCollision.sandbox.insertRowsInChunks('products',[rowA]))?.code,'PRODUCT_ID_COLLISION','missing token cannot prove retry identity');

  const verificationFailure=createSyncSandbox(
    [{error:{message:'response lost'}}],
    [{data:null,error:{code:'NETWORK',message:'verification unavailable'}}],
  );
  assert.equal((await verificationFailure.sandbox.insertRowsInChunks('products',[rowA]))?.code,'NETWORK','verification failure must remain dirty and fail closed');
  assert.equal(verificationFailure.insertCalls.length,1);

  const insertPreparationSource = section('async function prepareProductInsertCandidatesForSync(', 'async function syncProductsIncrementally(){');
  const legacyProduct={id:generatedId+2,name:'legacy cached product'};
  const preparationSnapshots=[];
  const preparationSandbox={
    products:[legacyProduct],
    productDirtyOperations:new Map(),
    generateProductCreateToken:(()=>{ let sequence=0; return ()=>`legacy-token-${++sequence}`; })(),
    persistProductChangesToIndexedDB:async changes=>{
      preparationSnapshots.push({
        changes:JSON.parse(JSON.stringify(changes)),
        token:legacyProduct._clientCreateToken,
        operation:preparationSandbox.productDirtyOperations.get(String(legacyProduct.id)),
      });
      return preparationSnapshots.length>1;
    },
    console:{warn(){}},
  };
  vm.createContext(preparationSandbox);
  vm.runInContext(`${insertPreparationSource}; this.prepareProductInsertCandidatesForSync=prepareProductInsertCandidatesForSync;`,preparationSandbox);
  const emptyPrevious=new Map();
  assert.equal(await preparationSandbox.prepareProductInsertCandidatesForSync(emptyPrevious),false,'failed legacy token persistence must abort before network sync');
  assert.equal(Object.hasOwn(legacyProduct,'_clientCreateToken'),false,'failed persistence must roll back the in-memory token');
  assert.equal(preparationSandbox.productDirtyOperations.has(String(legacyProduct.id)),false,'failed persistence must roll back the implicit insert operation');
  assert.equal(await preparationSandbox.prepareProductInsertCandidatesForSync(emptyPrevious),true,'a later retry must persist a fresh identity before network sync');
  assert.equal(legacyProduct._clientCreateToken,'legacy-token-2');
  assert.equal(preparationSandbox.productDirtyOperations.get(String(legacyProduct.id)),'insert');
  assert.deepEqual(preparationSnapshots.map(snapshot=>snapshot.operation),['insert','insert']);
  assert.deepEqual(preparationSnapshots.map(snapshot=>snapshot.changes.updatedIds),[[legacyProduct.id],[legacyProduct.id]]);

  const productSync = section('async function syncProductsIncrementally(){', 'let coreSyncInFlight=');
  assert.match(productSync, /insertRowsInChunks\(table,inserted\.map\(productToRow\)\)/);
  assert.doesNotMatch(productSync, /upsertRowsInChunks\(table,inserted/);
  assert.match(insertPreparationSource, /implicitInsertCandidates[\s\S]*!productDirtyOperations\.has\(id\)&&!previous\.has\(id\)/, 'legacy rows classified as new must use the same insert predicate before network sync');
  assert.match(productSync, /if\(!await prepareProductInsertCandidatesForSync\(previous\)\) return false;/, 'no insert request may start until the dirty operation and token are durable');

  const persistence = section('function persistWorkspaceData(options={}){', 'function schedulePersistWorkspaceData(){');
  assert.match(persistence, /productCachePromise\.then\(saved=>\{ if\(saved\) scheduleSupabaseCoreSync\(\); \}\)/, 'product network sync must wait for the durable token/cache write');

  const reconcile = section('function reconcileProductDirtyOperationsWithManifest(', 'function mergeRemoteProductsWithDirtyLocal(');
  assert.doesNotMatch(reconcile, /operation==='insert'[\s\S]*?set\(id,'update'\)/, 'a colliding dirty insert must never become an overwrite-capable update');

  const excelImport = section('async function importProductsFromExcel(', 'async function exportProductsToExcel(');
  assert.match(excelImport, /generateClientProductId\(reservedProductIds\)/);
  assert.match(excelImport, /_clientCreateToken:generateProductCreateToken\(\)/);
  assert.match(excelImport, /allocateReadableProductSku\(skuOwner\.keys\(\),stagedNextProductSkuNumber\)/);
  assert.doesNotMatch(excelImport, /nextProductId|stagedNextProductId/);

  const productSave = section('async function saveProduct(){', 'function valueReferencesProduct(');
  assert.match(productSave, /const id=generateClientProductId\(\)/);
  assert.match(productSave, /_clientCreateToken:generateProductCreateToken\(\)/);
  assert.match(productSave, /allocateReadableProductSku\(products\.map\(product=>product\.sku\),nextProductSkuNumber\)/);
  assert.doesNotMatch(productSave, /nextProductId/);

  console.log('product id collision safety tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
