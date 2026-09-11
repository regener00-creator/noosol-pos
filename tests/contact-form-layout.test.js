const assert = require('node:assert/strict');
const source = require('./load-app-source')();

const formStart = source.indexOf('function contactEditorFieldsHtml(c,fixedType=\'\')');
const formEnd = source.indexOf('function renderCustomerPricingForm()', formStart);
const form = source.slice(formStart, formEnd);
const saveStart = source.indexOf('function saveContactEditorData(');
const saveEnd = source.indexOf('async function saveCustomerPricing()', saveStart);
const save = source.slice(saveStart, saveEnd);

assert.ok(formStart >= 0 && formEnd > formStart, 'contact editor form must exist');
assert.match(form, /normalizedFixedType=[\s\S]*c_fixed_type[\s\S]*<label>ประเภท<\/label>[\s\S]*<label>ประเภทผู้ติดต่อ<\/label>/);
assert.match(form, /contact-editor-identity-row[\s\S]*<label>รหัสผู้ติดต่อ<\/label>[\s\S]*<label>ชื่อ-นามสกุล[\s\S]*c_taxid_label[\s\S]*เลขผู้เสียภาษี[\s\S]*เลขบัตรประชาชน[\s\S]*<label>เครดิต<\/label>/);
assert.match(form, /hideCode=normalizedFixedType==='customer'\|\|currentTab==='customers'/);
assert.match(form, /\$\{hideCode\?'':`<div class="contact-editor-field"><label>รหัสผู้ติดต่อ<\/label>/);
assert.match(form, /contact-editor-identity-row-customer-new[\s\S]*contact-editor-identity-row-customer-edit/);
assert.match(form, /isNewCustomer\?'':`<div class="contact-editor-field"><label>เครดิต<\/label>/);
assert.match(source, /emptyCustomerContactDraft\(type='customer'\)[\s\S]*normalizedType==='customer'\?'individual':'juristic'/);
assert.match(form, /contact-editor-wide"><label>ที่อยู่<\/label>/);
assert.match(form, /<label>อีเมล์<\/label>[\s\S]*<label>ไลน์<\/label>[\s\S]*<label>เบอร์โทร<\/label>/);
assert.match(form, /contact-editor-wide"><label>เพิ่มเติม<\/label>/);
assert.doesNotMatch(form, /รหัสไปรษณีย์|<label>ชื่อผู้ติดต่อ<\/label>|ข้อมูลธนาคาร|<label>ธนาคาร<\/label>|ชื่อบัญชี|เลขที่บัญชี|ประเภทบัญชี/);
assert.doesNotMatch(form, /c_postcode|c_contactname|c_bank|c_bankname|c_bankacc|c_acctype/);
assert.match(source, /openPOSCustomerCreateModal\(\)[\s\S]*contactEditorFieldsHtml\(emptyCustomerContactDraft\(\),'customer'\)/);
assert.match(source, /function renderContactForm\(\)[\s\S]*fixedType=isNew\?\(currentTab==='customers'\?'customer':'supplier'\):''[\s\S]*contactEditorFieldsHtml\(c,fixedType\)/);
assert.match(save, /const fixedType=g\('c_fixed_type'\)\?\.value\|\|'';[\s\S]*\['customer','supplier'\]\.includes\(fixedType\)\?\[fixedType\]:\[\]/);
assert.match(save, /recordId=contactId==='new'\?generateClientRecordId\(contacts\)[\s\S]*const codeInput=g\('c_code'\)[\s\S]*contactId==='new'&&fixedType==='customer'\?`C-\$\{Number\(recordId\)\.toString\(36\)\.toUpperCase\(\)\}`/);
assert.match(save, /creditDays: g\('c_credit'\)\?/);
assert.match(save, /line: g\('c_line'\)\.value\.trim\(\)/);
assert.doesNotMatch(save, /g\('c_postcode'\)|g\('c_contactname'\)|g\('c_bank'\)|g\('c_bankname'\)|g\('c_bankacc'\)/);

console.log('contact form layout tests passed');
