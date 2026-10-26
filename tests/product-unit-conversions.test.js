const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = require('./load-app-source')();
const optionsStart = source.indexOf('function productUnitOptions(');
const barcodeStart = source.indexOf('function productBarcodeForUnit(', optionsStart);
assert.ok(optionsStart >= 0 && barcodeStart > optionsStart, 'ไม่พบฟังก์ชันคำนวณหน่วยสินค้า');

const context = {
  productUnitCost:(product,unitName,factor)=>unitName===product.unit?Number(product.cost)||0:(Number(product.cost)||0)*factor,
};
vm.createContext(context);
vm.runInContext(source.slice(optionsStart, barcodeStart), context);

const legacyProduct = {
  unit:'ซอง', price:10, cost:5,
  units:[
    {sub:'ลัง',factor:250,price:2000,cost:1250},
    {sub:'กล่อง',factor:25,price:220,cost:125},
  ],
};
assert.deepEqual(
  JSON.parse(JSON.stringify(context.productUnitConversionRows(legacyProduct))),
  [
    {largerUnit:'กล่อง',smallerUnit:'ซอง',quantity:25},
    {largerUnit:'ลัง',smallerUnit:'กล่อง',quantity:10},
  ],
  'ต้องเทียบหน่วยใหญ่กับหน่วยเล็กที่อยู่ติดกัน ไม่เทียบทุกหน่วยกับหน่วยหลัก',
);

const largeMainUnit = {
  unit:'กล่อง', price:100, cost:60,
  units:[
    {sub:'เม็ด',factor:0.01,price:1,cost:0.6},
    {sub:'แผง',factor:0.1,price:10,cost:6},
  ],
};
assert.deepEqual(
  JSON.parse(JSON.stringify(context.productUnitConversionRows(largeMainUnit))),
  [
    {largerUnit:'แผง',smallerUnit:'เม็ด',quantity:10},
    {largerUnit:'กล่อง',smallerUnit:'แผง',quantity:10},
  ],
  'ต้องรองรับสินค้าที่หน่วยหลักเป็นหน่วยใหญ่',
);

assert.deepEqual(JSON.parse(JSON.stringify(context.productUnitConversionRows({unit:'ขวด',price:10,cost:5,units:[]}))),[]);
assert.equal(context.productUnitConversionAmount(12.5),'12.5');

console.log('product unit conversion tests passed');
