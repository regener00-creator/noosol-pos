const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const ctx=vm.createContext({});
for(const [start,end] of [
  ['const PRODUCT_DUPLICATE_DATA_KEYS=','function rowToProduct('],
  ['function canonicalProductInsertValue(','function productInsertCollisionError('],
  ['function mobileProductEditSignature(','function captureMobileProductDraft('],
]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),ctx);
const signature=product=>ctx.mobileProductEditSignature(product);
const fixture=()=>({id:1,sku:'A',name:'สินค้า A',unit:'กล่อง',price:100,cost:60,stock:25,expiry:'2027-01-01',_revision:3,barcode:'BASE',active:true,units:[{sub:'ลัง',per:10,base:'กล่อง',factor:10,price:900,cost:600,barcode:'CASE'}],extraBarcodes:['A','B'],extraBarcodeUnits:['กล่อง','ลัง'],vendorBarcodes:[{vendor:'V',code:'V1'}],dataReviewStatus:'pending'});
const reverseKeys=value=>Array.isArray(value)?value.map(reverseKeys):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverseKeys(item)])):value;

test('mobile edit comparison ignores JSON key order, including nested unit metadata',()=>{
  const product=fixture(),reordered=reverseKeys(product);
  assert.notEqual(JSON.stringify(ctx.productMetadataToRow(product)),JSON.stringify(ctx.productMetadataToRow(reordered)),'reproduce the old false conflict');
  assert.equal(signature(product),signature(reordered));
});

test('mobile edit comparison ignores stock-only changes but still protects catalog values',()=>{
  const product=fixture();
  assert.equal(signature(product),signature({...product,stock:20,expiry:'2027-02-01',_catalogExpiry:'2027-02-01',_revision:4}));
  for(const [key,value] of [['name','สินค้า B'],['unit','แผง'],['price',120],['cost',70],['barcode','OTHER'],['active',false],['dataReviewStatus','complete']]){
    assert.notEqual(signature(product),signature({...product,[key]:value}),key+' changes must still conflict');
  }
});

test('mobile edit comparison protects nested values, deletions and array order',()=>{
  const product=fixture();
  for(const [key,value] of [['factor',20],['price',950],['barcode','NEW-CASE']]){
    assert.notEqual(signature(product),signature({...product,units:[{...product.units[0],[key]:value}]}));
  }
  const removed=fixture();delete removed.dataReviewStatus;
  assert.notEqual(signature(product),signature(removed));
  assert.notEqual(signature(product),signature({...product,extraBarcodes:['B','A']}));
  assert.notEqual(signature(product),signature({...product,vendorBarcodes:[{vendor:'V',code:'V2'}]}));
  assert.equal(signature(product),signature({...product,optional:undefined}));
});
