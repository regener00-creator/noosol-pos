const assert = require('node:assert/strict');
const source = require('./load-app-source')();

assert.match(source, /function bindDmyDateFields\(\)[\s\S]*document\.addEventListener\('input'/, 'ต้องมีตัวจัดรูปแบบวันที่ส่วนกลางที่รองรับ popup');
assert.match(source, /function formatDMYInput\(value\)[\s\S]{0,320}replace\(\/\\D\/g,''\)\.slice\(0,8\)/, 'วันที่ต้องรับการพิมพ์ตัวเลข 8 หลัก');
assert.match(source, /\$\{digits\.slice\(0,2\)\}\/\$\{digits\.slice\(2,4\)\}/, 'วันที่ต้องเติมเครื่องหมาย / ให้อัตโนมัติ');
assert.match(source, /const value=formatDMYInput\(txt\.value\)/, 'ช่องวันที่ทั้งหมดต้องใช้ตัวจัดรูปแบบเดียวกัน');
assert.match(source, /bindDmyDateFields\(\);/, 'ต้องเปิดใช้งานตัวจัดรูปแบบวันที่ส่วนกลาง');

const editableDateInputs = [
  'po_supplier_tax_invoice_date',
  'productExchangeDate',
  'mobilePriceEditExpiry',
  'set_business_vat_date',
  'pay_date'
];
for (const id of editableDateInputs) {
  const tag = source.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
  assert.ok(tag, `ไม่พบช่องวันที่ ${id}`);
  assert.match(tag, /class="[^"]*dmy-input/, `${id} ต้องพิมพ์ตัวเลขแบบ วัน\/เดือน\/ปี ได้`);
  assert.match(tag, /inputmode="numeric"/, `${id} ต้องเปิดแป้นตัวเลขบนมือถือ`);
  assert.doesNotMatch(tag, /type="date"/, `${id} ต้องไม่บังคับใช้ช่องปฏิทินอย่างเดียว`);
}

assert.match(source, /class="poi_expiry dmy-input"/, 'วันหมดอายุในใบรับสินค้าต้องพิมพ์ตัวเลขได้');
assert.match(source, /class="product-exchange-expiry dmy-input"/, 'วันหมดอายุในเอกสารแลกสินค้าต้องพิมพ์ตัวเลขได้');
assert.match(source, /class="lot-edit-expiry dmy-input"/, 'วันหมดอายุในรายละเอียด LOT ต้องพิมพ์ตัวเลขได้');
assert.match(source, /class="stock-control-new-lot-input dmy-input"/, 'วันหมดอายุ LOT ใหม่บนคอมพิวเตอร์ต้องพิมพ์ตัวเลขได้');
assert.match(source, /class="dmy-input" data-mobile-stock-new-expiry/, 'วันหมดอายุ LOT ใหม่บนมือถือต้องพิมพ์ตัวเลขได้');
assert.match(source, /const paymentDateInput=[\s\S]{0,180}dmyToISO\(paymentDateInput\.value\)/, 'วันที่ชำระต้องตรวจสอบและบันทึกเป็นวันที่มาตรฐาน');
assert.match(source, /const date=document\.getElementById\('productExchangeDate'\);[\s\S]{0,160}dmyToISO\(raw\)/, 'วันที่เอกสารแลกสินค้าต้องแปลงเป็นวันที่มาตรฐาน');

const visibleNativeDates = [...source.matchAll(/<input[^>]*type="date"[^>]*>/g)]
  .map(match => match[0])
  .filter(tag => !tag.includes('class="dmy-native"'));
assert.deepEqual(visibleNativeDates, [], 'ต้องไม่มีช่องวันที่ที่บังคับเลือกจากปฏิทินเพียงอย่างเดียว');

console.log('editable date input tests passed');
