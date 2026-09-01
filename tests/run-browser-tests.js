const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tests = fs.readdirSync(__dirname)
  .filter((name) => name.endsWith('-browser.test.js'))
  .sort();

let failed = false;
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { stdio: 'inherit' });
  if ((result.status ?? 1) !== 0) failed = true;
}
if (failed) process.exit(1);
console.log(`browser tests passed (${tests.length} files)`);
