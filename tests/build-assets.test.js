const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

test('build minifies app assets and injects one matching content version', async () => {
  const buildModule = await import(pathToFileURL(path.join(root, 'scripts', 'build-static.mjs')).href);
  const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const stylesSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const indexTemplate = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const workerTemplate = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const input = { appSource, stylesSource, indexTemplate, workerTemplate, versionInputs: [Buffer.from('static-assets-v1')] };
  const built = await buildModule.prepareTextAssets(input);

  assert.ok(Buffer.byteLength(built.appCode) < Buffer.byteLength(appSource), 'deploy app.js must be smaller than source');
  assert.ok(Buffer.byteLength(built.stylesCode) < Buffer.byteLength(stylesSource), 'deploy styles.css must be smaller than source');
  assert.match(built.assetVersion, /^[a-f0-9]{16}$/);
  assert.doesNotMatch(built.indexHtml, /__PEPOS_ASSET_VERSION__/);
  assert.doesNotMatch(built.workerCode, /__PEPOS_ASSET_VERSION__/);

  const htmlAppVersion = built.indexHtml.match(/\/app\.js\?v=([a-f0-9]{16})/)?.[1];
  const htmlCssVersion = built.indexHtml.match(/\/styles\.css\?v=([a-f0-9]{16})/)?.[1];
  const workerVersion = built.workerCode.match(/const ASSET_VERSION='([a-f0-9]{16})'/)?.[1];
  assert.equal(htmlAppVersion, built.assetVersion);
  assert.equal(htmlCssVersion, built.assetVersion);
  assert.equal(workerVersion, built.assetVersion);

  assert.match(built.appCode, /updateContactEntityLabels/, 'minification must preserve function names called by generated inline HTML');
  assert.doesNotThrow(() => new vm.Script(built.appCode), 'minified JavaScript must remain syntactically valid');

  const changed = await buildModule.prepareTextAssets({ ...input, versionInputs: [Buffer.from('static-assets-v2')] });
  assert.notEqual(changed.assetVersion, built.assetVersion, 'any versioned asset change must rotate the cache version');
});
