const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-static.mjs'), 'utf8');

assert.match(html, /id="recoverOwnerPasswordBtn"[^>]*class="[^"]*login-recover|class="[^"]*login-recover[^"]*"[^>]*id="recoverOwnerPasswordBtn"/, 'ปุ่มลืมรหัสผ่านต้องมีคลาสจัดตำแหน่งเฉพาะ');
assert.match(css, /\.login-recover\{[^}]*display:block[^}]*width:max-content[^}]*margin:18px auto 0/, 'ปุ่มลืมรหัสผ่านต้องอยู่กึ่งกลางและเว้นระยะจากปุ่มเข้าสู่ระบบ');
assert.equal((html.match(/src="\/sapuri-brand-logo\.png"/g) || []).length, 3, 'หน้าบัญชีและเลือกคลังต้องใช้โลโก้ SAPURI ใหม่');
assert.doesNotMatch(html, /class="rx">Rx<\/span>/, 'ต้องไม่แสดงตรา Rx เดิมในหน้าเข้าสู่ระบบ');
assert.match(html, /<title>SAPURI<\/title>/);
assert.match(html, /<link rel="icon" href="\/sapuri-brand-logo\.png" type="image\/png">/);
assert.match(html, /<meta name="apple-mobile-web-app-title" content="SAPURI">/);
assert.match(html, /<span>SAPURI POS<\/span>/);
assert.doesNotMatch(html, /ร้านยา POS/);
assert.match(app, /document\.title='SAPURI'/);
assert.match(css, /\.login-brand \.brand-logo-frame img\{[^}]*object-fit:cover[^}]*transform:translate\(-50%,-50%\)/, 'โลโก้ต้องจัดกึ่งกลางและไม่ยืดรูป');
assert.match(buildScript, /'sapuri-brand-logo\.png'/, 'ขั้นตอน build ต้องนำโลโก้ใหม่ไปใช้งานจริง');
assert.ok(fs.statSync(path.join(root, 'sapuri-brand-logo.png')).size > 0, 'ต้องมีไฟล์โลโก้ SAPURI ใหม่');

console.log('login layout tests passed');
