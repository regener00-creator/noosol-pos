const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-static.mjs'), 'utf8');
const fontFiles = [
  'line-seed-sans-th-regular.woff2',
  'line-seed-sans-th-bold.woff2',
  'line-seed-sans-th-extra-bold.woff2',
];

assert.match(app, /const labelHtml=g\.section==='ขาย'\?`<span class="sales-nav-label">\$\{label\}<\/span>`:label;/);
assert.match(css, /\.sales-nav-label\{font-family:'LINE Seed Sans TH','Sarabun',sans-serif;\}/);
assert.doesNotMatch(css, /\.dashboard-page[^}]*LINE Seed Sans TH/);
assert.doesNotMatch(css, /\.notes-page[^}]*LINE Seed Sans TH/);
assert.equal((css.match(/@font-face\{font-family:'LINE Seed Sans TH'/g) || []).length, 3);

for (const name of fontFiles) {
  assert.ok(fs.statSync(path.join(root, name)).size > 10000, `${name} must be a real web font`);
  assert.match(css, new RegExp(name.replaceAll('.', '\\.')));
  assert.match(worker, new RegExp(`/${name.replaceAll('.', '\\.')}`));
  assert.match(buildScript, new RegExp(`'${name.replaceAll('.', '\\.')}'`));
}

assert.doesNotMatch(css, /body\{[^}]*LINE Seed Sans TH/, 'ฟอนต์ทดลองต้องไม่กระทบทั้งระบบ');

console.log('sidebar sales labels LINE Seed Sans TH tests passed');
