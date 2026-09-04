const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260825042037_favorite_units.sql'), 'utf8');
const context = {};
vm.createContext(context);

function loadFunctionBlock(name, nextName) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `ไม่พบช่วงฟังก์ชัน ${name}`);
  vm.runInContext(html.slice(start, end), context);
}

loadFunctionBlock('productUnitCost', 'addToCart');
loadFunctionBlock('addToCart', 'addCustomCartLine');
loadFunctionBlock('productUnitOptions', 'favoriteProductId');
loadFunctionBlock('favoriteProductId', 'favoriteSelectedUnit');
loadFunctionBlock('favoriteSelectedUnit', 'favoriteEntryForProduct');
loadFunctionBlock('favoriteEntryForProduct', 'normalizeFavorites');
loadFunctionBlock('normalizeFavorites', 'favoriteHasProduct');
loadFunctionBlock('fmtFavoritePrice', 'escapeHtml');

const product = {
  id: 101,
  name: 'Decolgen prin',
  unit: 'เม็ด',
  barcode: '885-TABLET',
  price: 5,
  cost: 3,
  units: [
    {sub:'ซอง',factor:4,price:20,cost:12,barcode:'885-SACHET'},
    {sub:'กล่อง',factor:40,price:190,cost:110,barcode:'885-BOX'},
  ],
};

assert.deepEqual(
  JSON.parse(JSON.stringify(context.normalizeFavorites([101], [product]))),
  [{pid:101,unit:'เม็ด'}],
  'สินค้าโปรดรูปแบบเก่าต้องใช้หน่วยหลักเดิมได้',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.normalizeFavorites([{pid:101,unit:'กล่อง'},101], [product]))),
  [{pid:101,unit:'กล่อง'}],
  'หนึ่งสินค้าต้องมีสินค้าโปรดเพียงหนึ่งหน่วยและคงหน่วยที่เลือก',
);
assert.equal(context.favoriteSelectedUnit({pid:101,unit:'หน่วยที่ถูกลบ'},product),'เม็ด');
assert.deepEqual(JSON.parse(JSON.stringify(context.favoriteEntryForProduct(product,'ซอง'))),{pid:101,unit:'ซอง'});
assert.equal(context.fmtFavoritePrice(180),'180');
assert.equal(context.fmtFavoritePrice(180.5),'180.5');

Object.assign(context,{products:[product],cart:[],lineCounter:1});
context.addToCart(101,'กล่อง',2);
assert.deepEqual(JSON.parse(JSON.stringify(context.cart)),[{
  lineId:1,pid:101,name:'Decolgen prin',unit:'กล่อง',unitName:'กล่อง',price:190,regularPrice:190,cost:110,factor:40,qty:2,priceSource:'standard',customerPriceRuleId:null,
}]);

assert.match(html,/data-unit="\$\{escapeHtml\(item\.unit\)\}"/);
assert.match(html,/addToCart\(pid, consumePosSaleUnit\(product,el\.dataset\.unit\|\|null\), pendingQty\)/);
assert.match(html,/\$\{escapeHtml\(item\.unit\)\} - \$\{fmtFavoritePrice\(item\.price\)\}/);
assert.match(html,/data-fav-result-unit/);
assert.match(migration,/add column if not exists unit text not null default ''/);
assert.match(migration,/add column if not exists position integer not null default 0/);
assert.match(migration,/using \(\(select auth\.uid\(\)\)=user_id\)/);

console.log('favorite unit tests passed');
