const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('../scripts/app-source.cjs').writeDevelopmentApp();
// Several browser tests serve the deployment folder. A fresh checkout has no build yet.
const build = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/build-static.mjs')], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const tests = fs.readdirSync(__dirname)
  .filter((name) => name.endsWith('-browser.test.js'))
  .sort();

let failed = false;
if(!process.env.PEPOS_BROWSER_EXECUTABLE){
  const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));
  process.env.PEPOS_BROWSER_EXECUTABLE=executable||require('playwright').chromium.executablePath();
}
for (const test of tests) {
  const args=test==='tax-report-pagination-browser.test.js'?['--built']:[];
  const result = spawnSync(process.execPath, [path.join(__dirname, test),...args], { stdio: 'inherit' });
  if ((result.status ?? 1) !== 0) failed = true;
}
if (failed) process.exit(1);
console.log(`browser tests passed (${tests.length} files)`);
