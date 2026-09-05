const assert = require('node:assert/strict');
const source = require('./load-app-source')();

const formStart = source.indexOf('function renderContactForm()');
const formEnd = source.indexOf('function renderCustomerPricingForm()', formStart);
const form = source.slice(formStart, formEnd);
const saveStart = source.indexOf('function saveContact()');
const saveEnd = source.indexOf('async function saveCustomerPricing()', saveStart);
const save = source.slice(saveStart, saveEnd);

assert.ok(formStart >= 0 && formEnd > formStart, 'contact editor form must exist');
assert.match(form, /<label>ประเภท<\/label>[\s\S]*<label>ประเภทผู้ติดต่อ<\/label>/);
assert.match(form, /<label>รหัสผู้ติดต่อ<\/label>[\s\S]*<label>เครดิต<\/label>/);
assert.match(form, /<label>ชื่อ-นามสกุล[\s\S]*<label>เลขบัตรประชาชน<\/label>/);
assert.match(form, /contact-editor-wide"><label>ที่อยู่<\/label>/);
assert.match(form, /<label>อีเมล์<\/label>[\s\S]*<label>ไลน์<\/label>[\s\S]*<label>เบอร์โทร<\/label>/);
assert.match(form, /contact-editor-wide"><label>เพิ่มเติม<\/label>/);
assert.doesNotMatch(form, /รหัสไปรษณีย์|<label>ชื่อผู้ติดต่อ<\/label>|ข้อมูลธนาคาร|<label>ธนาคาร<\/label>|ชื่อบัญชี|เลขที่บัญชี|ประเภทบัญชี/);
assert.doesNotMatch(form, /c_postcode|c_contactname|c_bank|c_bankname|c_bankacc|c_acctype/);
assert.match(save, /line: g\('c_line'\)\.value\.trim\(\)/);
assert.doesNotMatch(save, /g\('c_postcode'\)|g\('c_contactname'\)|g\('c_bank'\)|g\('c_bankname'\)|g\('c_bankacc'\)/);

console.log('contact form layout tests passed');
