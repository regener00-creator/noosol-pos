const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = require('./load-app-source')();
const start = html.indexOf('function customerDefaultDocument(');
const end = html.indexOf('function addToCart(', start);
assert.ok(start >= 0 && end > start, 'customer pricing helpers must exist');

const contacts=[];
const context = {
  saleMember: null,
  contacts,
  products: [],
  customersList(){ return contacts.filter(contact => contact.types.includes('customer')); },
  productUnitOptions(product){
    return [{name:product.unit, price:product.price}, ...(product.units || []).map(unit => ({name:unit.sub, price:unit.price}))];
  },
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const product = {id:101, name:'Decolgen', unit:'ซอง', price:8, units:[{sub:'กล่อง',price:180}]};
const customer = {id:7, name:'ลูกค้า A', types:['customer'], defaultDocument:'cash_bill', customerPrices:[{id:'a-box',productId:101,unit:'กล่อง',price:160}]};
contacts.push(customer);
context.saleMember = context.customerSaleSnapshot(customer);
const line = {pid:101,unit:'กล่อง',price:180,priceSource:'standard'};
context.applySalePriceToLine(line,product,'กล่อง');
assert.equal(line.price,160);
assert.equal(line.regularPrice,180);
assert.equal(line.priceSource,'customer');
assert.equal(line.customerPriceRuleId,'a-box');
assert.equal(context.customerDefaultDocument(customer),'cash_bill');

context.saleMember = null;
context.applySalePriceToLine(line,product,'กล่อง',{preserveQuotation:false});
assert.equal(line.price,180);
assert.equal(line.priceSource,'standard');

assert.match(html, /if\(line\.priceSource==='customer'\|\|line\.priceSource==='quotation'\) return null;/, 'special and quotation prices must not stack promotions');
assert.match(html, /regularPrice:Number\(l\.regularPrice\?\?l\.price\)\|\|0,priceSource:l\.priceSource\|\|'standard'/, 'sale items must snapshot both regular and actual price sources');
assert.match(html, /data-sell-quotation=/, 'quotation list must offer sending the document to POS');
assert.match(html, /sourceQuotationId:saleSourceQuotationId\|\|null/, 'completed sale must keep the source quotation reference');

console.log('customer pricing and quotation POS tests passed');
