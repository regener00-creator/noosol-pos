const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tests = fs.readdirSync(__dirname)
  .filter((name) => name.endsWith('-browser.test.js'))
  .sort();

let failed = false;
if(process.platform==='win32'&&!process.env.PEPOS_BROWSER_EXECUTABLE){
  const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));
  if(executable) process.env.PEPOS_BROWSER_EXECUTABLE=executable;
}
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { stdio: 'inherit' });
  if ((result.status ?? 1) !== 0) failed = true;
}
if (failed) process.exit(1);
console.log(`browser tests passed (${tests.length} files)`);
