const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function setup(){
  const calls=[];
  const ctx=vm.createContext({products:[{id:1,name:'Existing',sku:'P1',unit:'box',barcode:'000123',active:false,units:[{barcode:'CASE',sub:'case'}],extraBarcodes:['EXTRA',{code:'LEGACY',unit:'box'}],vendorBarcodes:[{code:'VENDOR'}]}],navigator:{onLine:true},sb:{rpc:async(name,args)=>{calls.push({name,args});return {data:[],error:null};}}});
  vm.runInContext(part('function extraBarcodeEntries(','function extraBarcodeAvailableUnits(')+part('function barcodePrintBarcodeOwners(','function generateInternalBarcode('),ctx);
  return {ctx,calls};
}
test('all barcode sources share one normalized namespace; leading zeroes and blank codes are safe',()=>{
  const {ctx}=setup();
  assert.deepEqual(Array.from(ctx.productBarcodeCodes(ctx.products[0])),['000123','case','extra','legacy','vendor']);
  for(const barcode of ['000123','CASE','\u2003ExTrA\u2003','legacy','VENDOR']) assert.match(ctx.productBarcodeValidationError({barcode}),/มีอยู่ในสินค้าอื่นแล้ว/);
  assert.equal(ctx.productBarcodeValidationError({barcode:'123'}),'');
  assert.equal(ctx.productBarcodeValidationError({barcode:'   '}),'');
  assert.equal(ctx.productBarcodeValidationError(ctx.products[0],1),'');
  for(const product of [{units:[{barcode:'000123'}]},{extraBarcodes:[{code:'000123'}]},{vendorBarcodes:[{code:'000123'}]}]) assert.ok(ctx.productBarcodeValidationError(product));
});
test('server preflight blocks a stale client and fails closed without mutating data',async()=>{
  const {ctx}=setup();
  ctx.sb.rpc=async()=>({data:[{barcode:'remote-only',product_id:2,name:'Other device',sku:'P2'}]});
  await assert.rejects(ctx.assertProductBarcodesAvailable({barcode:'REMOTE-ONLY'}),/Other device/);
  ctx.sb.rpc=async()=>({error:{message:'offline'}});
  await assert.rejects(ctx.assertProductBarcodesAvailable({barcode:'new'}),/ยังไม่ได้บันทึก/);
  ctx.navigator.onLine=false;
  await assert.rejects(ctx.assertProductBarcodesAvailable({barcode:'new'}),/เชื่อมต่ออินเทอร์เน็ต/);
  await ctx.assertProductBarcodesAvailable({...ctx.products[0],price:999},ctx.products[0]);
  assert.equal(ctx.products.length,1);
});
test('remote preflight checks batches and own product identity correctly',async()=>{
  const {ctx,calls}=setup();
  await ctx.loadServerBarcodeOwners(Array.from({length:2201},(_,i)=>String(i)));
  assert.equal(calls.length,3);
  assert.ok(calls.every(c=>c.name==='find_product_barcode_owners'&&c.args.p_codes.length<=1000));
  ctx.sb.rpc=async()=>({data:[{barcode:'new',product_id:1}]});
  await ctx.assertProductBarcodesAvailable({...ctx.products[0],barcode:'new'},ctx.products[0]);
});
test('a database uniqueness rejection is readable and pauses unchanged insert retries',async()=>{
  const calls=[];
  const ctx=vm.createContext({sb:{from:()=>({insert:async rows=>{calls.push(rows);return {error:{code:'23505',hint:'DUPLICATE_PRODUCT_BARCODE',message:'บาร์โค้ด duplicate มีอยู่ในสินค้าอื่นแล้ว',details:JSON.stringify({productId:10,barcode:'duplicate'})}};}})}});
  vm.runInContext(part('function productCreateTokenFromRow(','async function updateProductMetadataInChunks('),ctx);
  const row={id:10,name:'Draft',data:{barcode:'duplicate'}};
  const first=await ctx.insertRowsInChunks('products',[row]);
  assert.equal(first.code,'DUPLICATE_PRODUCT_BARCODE');assert.equal(first.productId,10);
  const next=await ctx.insertRowsInChunks('products',[row]);
  assert.equal(next.syncPaused,true);assert.equal(next.code,'DUPLICATE_PRODUCT_BARCODE');
  assert.equal(calls.length,1,'no pointless repeated INSERT for an unchanged duplicate');
});

test('duplicate metadata edits pause, keep the draft and resume after correction',async()=>{
  let writes=0,acked=0;
  const ctx=vm.createContext({productMetadataToRow:p=>({...p}),syncedTableRows:{products:new Map()},sb:{from(){
    const q={update(){writes++;return q;},eq(){return q;},select(){return q;},async maybeSingle(){return {error:{code:'23505',hint:'DUPLICATE_PRODUCT_BARCODE',message:'Duplicate barcode'}};}};return q;
  }}});
  vm.runInContext(part('function productBarcodeConstraintError(','async function verifyProductInsertChunk(')+part('async function updateProductMetadataInChunks(','function revisionConflictError('),ctx);
  const draft={id:12,revision:2,data:{barcode:'duplicate'}};
  const first=await ctx.updateProductMetadataInChunks([draft],()=>acked++);
  assert.equal(first.code,'DUPLICATE_PRODUCT_BARCODE');assert.equal(first.productId,12);
  const second=await ctx.updateProductMetadataInChunks([draft]);
  assert.equal(second.syncPaused,true);assert.equal(writes,1);assert.equal(acked,0);
  assert.equal(draft.data.barcode,'duplicate');
  draft.data.barcode='corrected';await ctx.updateProductMetadataInChunks([draft]);
  assert.equal(writes,2,'changed draft retries instead of staying permanently paused');
});
