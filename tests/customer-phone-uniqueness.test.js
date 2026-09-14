const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = require('./load-app-source')();

const helperStart = source.indexOf('function normalizedPhoneDigits(');
const helperEnd = source.indexOf('function showToast(', helperStart);
const helpers = source.slice(helperStart, helperEnd);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'customer phone helpers must exist');
assert.match(helpers, /replace\(\/\\D\/g,''\)/, 'phone comparison ignores formatting');
assert.match(helpers, /contactIncludesCustomer\(contact\)/, 'only customer contacts participate in duplicate detection');
assert.match(helpers, /String\(contact\.id\)!==String\(excludedId\)/, 'editing a customer may retain their own phone');

const insertStart = source.indexOf('async function insertRevisionedRows(');
const insertEnd = source.indexOf('async function updateRevisionedRows(', insertStart);
assert.match(source.slice(insertStart, insertEnd), /remote\.data\?\._clientCreateToken[\s\S]*return error/, 'real collisions retain their database error after verifying the attempted ID');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260914041658_unique_customer_phone.sql'), 'utf8');
assert.match(migration, /create unique index if not exists contacts_customer_phone_unique/i);
assert.match(migration, /regexp_replace\(coalesce\(phone, ''\), '\[\^0-9\]', '', 'g'\)/i);
assert.match(migration, /where type in \('customer', 'both'\)/i);
assert.match(migration, /nullif\([\s\S]*\) is not null/i, 'blank legacy phone numbers are excluded from the unique index');

const excel = fs.readFileSync(path.join(__dirname, '..', 'excel-tools.js'), 'utf8');
const importStart = excel.indexOf('async function importContactsFromExcel(');
const importEnd = excel.indexOf('async function exportContactsToExcel()', importStart);
const contactImport = excel.slice(importStart, importEnd);
assert.match(contactImport, /ลูกค้าไม่มีเบอร์โทร/);
assert.match(contactImport, /เบอร์โทรลูกค้าซ้ำ/);

console.log('customer phone uniqueness tests passed');
