const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

assert.match(html, /id="recoverOwnerPasswordBtn"[^>]*class="[^"]*login-recover|class="[^"]*login-recover[^"]*"[^>]*id="recoverOwnerPasswordBtn"/, 'ปุ่มลืมรหัสผ่านต้องมีคลาสจัดตำแหน่งเฉพาะ');
assert.match(css, /\.login-recover\{[^}]*display:block[^}]*width:max-content[^}]*margin:18px auto 0/, 'ปุ่มลืมรหัสผ่านต้องอยู่กึ่งกลางและเว้นระยะจากปุ่มเข้าสู่ระบบ');

console.log('login layout tests passed');
