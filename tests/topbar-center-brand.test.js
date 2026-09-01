const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = require("./load-app-source")();

assert.match(html, /class="topbar-center-brand" aria-label="PRANC-HIBES">P R A N C - H I B E S<\/div>/, 'TOPBAR บนคอมต้องแสดงข้อความกึ่งกลาง');
assert.match(html, /\.topbar\{position:relative;/, 'TOPBAR ต้องเป็นกรอบอ้างอิงตำแหน่งกึ่งกลาง');
assert.match(html, /\.topbar-center-brand\{[^}]*position:absolute;[^}]*left:50%;[^}]*top:50%;[^}]*translate\(-50%,-50%\)/, 'ข้อความต้องอยู่กึ่งกลางจริงโดยไม่ขึ้นกับปุ่มซ้ายหรือขวา');
assert.match(html, /body\.mobile-device-mode \.sidebar,body\.mobile-device-mode \.topbar\{display:none!important;/, 'โหมดมือถือต้องซ่อน TOPBAR และข้อความนี้ทั้งหมด');

console.log('topbar center brand tests passed');
