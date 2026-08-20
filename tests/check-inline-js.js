const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
const inline = scripts.map(match => match[1]).filter(source => source.trim()).join('\n');
const tempFile = path.join(os.tmpdir(), `pepos-inline-${process.pid}.js`);
fs.writeFileSync(tempFile, inline, 'utf8');
const result = spawnSync(process.execPath, ['--check', tempFile], { encoding: 'utf8' });
try { fs.unlinkSync(tempFile); } catch (_) {}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
