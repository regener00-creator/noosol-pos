const {test}=require('node:test');
const assert=require('node:assert/strict');
const {productStructureValidationError:validate}=require('../product-domain');
const product={name:'Test',unit:'tablet',price:10,cost:5,units:[{sub:'box',base:'tablet',per:10,factor:10,price:0,cost:40},{sub:'case',base:'box',per:12,factor:120,price:900,cost:450}]};
test('shared product validation accepts chains, fractional conversions and explicit zero prices',()=>{
  assert.equal(validate(product),'');
  assert.equal(validate({...product,units:[{sub:'half',base:'tablet',per:0.5,factor:0.5,price:0,cost:0}]}),'');
});
test('shared validation rejects negative/nonfinite prices, duplicate names and malformed quantities',()=>{
  for(const price of [-1,NaN,Infinity,'',null]) assert.ok(validate({...product,price}));
  for(const patch of [{sub:'tablet'},{per:''},{per:0},{per:-1},{factor:0},{factor:20},{base:'missing'},{price:-1}]) assert.ok(validate({...product,units:[{...product.units[0],...patch}]}));
  assert.ok(validate({...product,units:[product.units[0],product.units[0]]}));
  assert.ok(validate({...product,units:[{...product.units[0],base:'case'},product.units[1]]}));
  assert.ok(validate({...product,units:{}}));
});
