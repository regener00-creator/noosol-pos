const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testsDirectory = __dirname;
const testFiles = fs.readdirSync(testsDirectory)
  .filter(name => name.endsWith('.test.js') && !name.endsWith('-browser.test.js'))
  .sort()
  .map(name => path.join(testsDirectory, name));

if (testFiles.length === 0) {
  console.error('No dependency-free Node tests were found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
