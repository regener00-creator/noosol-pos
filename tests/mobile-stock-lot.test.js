const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require("./load-app-source")();
const helperStart = html.indexOf('function stockEditAvailableLots(');
const helperEnd = html.indexOf('async function confirmStockEditChanges(', helperStart);
const mobileStart = html.indexOf('function stockEditMobileLotSelectionsReady(');
const mobileEnd = html.indexOf('function refreshMobileStockLotControl(', mobileStart);
const addStart = html.indexOf('function addProductToMobileStockEdit(');
const addEnd = html.indexOf('function prepareMobileScanSound(', addStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'ไม่พบชุดฟังก์ชันสร้าง payload แก้ไขสต๊อก');
assert.ok(mobileStart >= 0 && mobileEnd > mobileStart, 'ไม่พบชุดฟังก์ชันเลือก LOT บนมือถือ');
assert.ok(addStart >= 0 && addEnd > addStart, 'ไม่พบฟังก์ชันเพิ่มสินค้าเข้าแก้ไขสต๊อกบนมือถือ');

const product = {id:10, stock:10, unit:'กล่อง', expiry:'2030-12-31', units:[]};
const context = {
  activeWarehouseId: 1,
  inventoryLotRows: [
    {id:101, product_id:10, warehouse_id:1, manufacturer_lot:'LOT-A', expiry_date:'2027-05-01', quantity_base:6, status:'active'},
    {id:102, product_id:10, warehouse_id:1, manufacturer_lot:'LOT-B', expiry_date:'2028-06-01', quantity_base:4, status:'active'},
    {id:999, product_id:10, warehouse_id:2, manufacturer_lot:'OTHER-WH', expiry_date:'2026-01-01', quantity_base:90, status:'active'},
  ],
  stockEditLotSelections: {},
  stockEditNewLotNumbers: {},
  stockEditNewLotExpiries: {},
  stockEditRowUnitSel: {10:'กล่อง'},
  stockEditDraftStocks: {10:12},
  stockEditPendingChanges: () => [],
  fmtDate: value => value.split('-').reverse().join('-'),
  stockInLargestUnit: value => `${value.stock} ${value.unit}`,
  escapeHtml: value => String(value ?? ''),
  isoToDMY: value => value ? value.split('-').reverse().join('/') : '',
};
vm.createContext(context);
vm.runInContext(html.slice(helperStart, helperEnd), context);
vm.runInContext(html.slice(mobileStart, mobileEnd), context);

const increaseChange = [{product, newStock:12}];
assert.equal(context.stockEditMobileLotSelectionsReady(increaseChange), false, 'เพิ่มสต๊อกต้องยังยืนยันไม่ได้จนกว่าจะเลือก LOT');
const chooseHtml = context.mobileStockEditLotHtml(product);
assert.match(chooseHtml, /เลือก LOT ที่จะเพิ่ม/);
assert.match(chooseHtml, /LOT-A · หมดอายุ 01-05-2027 · เหลือ 6 กล่อง/);
assert.doesNotMatch(chooseHtml, /OTHER-WH/);
assert.equal(context.stockEditLotSelections[10], 'choose');

context.stockEditLotSelections[10] = 'lot:102';
assert.equal(context.stockEditMobileLotSelectionsReady(increaseChange), true);
const existingLotLine = context.stockEditAdjustmentLines(increaseChange)[0];
assert.equal(existingLotLine.selectedLotId, 102);
assert.equal(existingLotLine.lotNumber, '');

context.stockEditLotSelections[10] = 'new';
context.stockEditNewLotNumbers[10] = 'LOT-C';
context.stockEditNewLotExpiries[10] = '2029-07-05';
assert.equal(context.stockEditMobileLotSelectionsReady(increaseChange), true);
const newLotHtml = context.mobileStockEditLotHtml(product);
assert.match(newLotHtml, /data-mobile-stock-new-lot="10"/);
assert.match(newLotHtml, /value="05-07-2029"/);
const newLotLine = context.stockEditAdjustmentLines(increaseChange)[0];
assert.equal(newLotLine.selectedLotId, null);
assert.equal(newLotLine.lotNumber, 'LOT-C');
assert.equal(newLotLine.expiry, '2029-07-05');

context.stockEditDraftStocks[10] = 7;
context.stockEditLotSelections = {};
const decreaseChange = [{product, newStock:7}];
const decreaseHtml = context.mobileStockEditLotHtml(product);
assert.match(decreaseHtml, /อัตโนมัติ FEFO — เริ่ม LOT-A/);
assert.match(decreaseHtml, /LOT ที่ลดจำนวน/);
assert.equal(context.stockEditLotSelections[10], 'auto');
assert.equal(context.stockEditMobileLotSelectionsReady(decreaseChange), true);
const autoFefoLine = context.stockEditAdjustmentLines(decreaseChange)[0];
assert.equal(autoFefoLine.selectedLotId, null, 'ค่า auto ต้องให้ RPC ตัดตาม FEFO');

context.stockEditLotSelections[10] = 'lot:102';
const selectedDecreaseLine = context.stockEditAdjustmentLines(decreaseChange)[0];
assert.equal(selectedDecreaseLine.selectedLotId, 102, 'ผู้ใช้ต้องระบุ LOT ที่ต้องการลดก่อนได้');

const addContext = {
  stockEditItems: [],
  stockEditRowUnitSel: {},
  stockEditDraftStocks: {},
  mobileStockQuery: '8850000000000',
  mobileStockLastProductId: null,
  inspectionListUnitOptions: item => [{name:item.unit}],
  stockEditRequiresReconciliation: item => item.id===10,
  render: () => {},
};
vm.createContext(addContext);
vm.runInContext(html.slice(addStart, addEnd), addContext);
addContext.addProductToMobileStockEdit({id:10,stock:720,unit:'กล่อง'});
assert.equal(addContext.stockEditDraftStocks[10], 720, 'สินค้าที่สต๊อกกับ LOT ไม่ตรงกันต้องสร้างรายการรอยืนยัน');
addContext.stockEditDraftStocks[10]=719;
addContext.addProductToMobileStockEdit({id:10,stock:720,unit:'กล่อง'});
assert.equal(addContext.stockEditDraftStocks[10], 719, 'การยิงซ้ำต้องไม่เขียนทับจำนวนที่ผู้ใช้แก้ไว้แล้ว');
addContext.addProductToMobileStockEdit({id:11,stock:50,unit:'ขวด'});
assert.equal(Object.prototype.hasOwnProperty.call(addContext.stockEditDraftStocks,11), false, 'สินค้าที่สต๊อกกับ LOT ตรงกันต้องไม่สร้างรายการแก้ไขเปล่า');

assert.match(html, /stockEditNewLotExpiries\[Number\(expiryInput\.dataset\.mobileStockNewExpiry\)\]=iso\|\|''/);
assert.match(html, /data-mobile-stock-new-expiry\]\.invalid/);
assert.match(html, /delete stockEditLotSelections\[productId\]/);
assert.match(html, /if\(!stockEditMobileLotSelectionsReady\(\)\)/);

console.log('mobile stock LOT tests passed');
