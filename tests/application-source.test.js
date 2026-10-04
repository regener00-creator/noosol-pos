const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {Script}=require('node:vm');
const {sourceFiles,readApplicationSource,projectRoot}=require('../scripts/app-source.cjs');

test('source manifest owns every application file exactly once, preserving one shared script',()=>{
  const files=sourceFiles();
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):entry.name.endsWith('.js')?[path.relative(projectRoot,path.join(dir,entry.name)).replaceAll('\\','/')]:[]);
  assert.deepEqual([...files].sort(),walk(path.join(projectRoot,'src')).sort());
  assert.equal(files[0],'src/platform/client.js');
  assert.equal(files.at(-1),'src/platform/bootstrap.js');
  const source=readApplicationSource();
  assert.doesNotThrow(()=>new Script(source));
  assert.equal((source.match(/window\.peposBootstrapReady=/g)||[]).length,1);
  assert.equal((source.match(/^function attachEvents\(/gm)||[]).length,1);
  assert.equal((source.match(/^async function doCheckout\(/gm)||[]).length,1);
  assert.ok(source.indexOf('let currentProfile=')<source.indexOf('window.peposBootstrapReady='));
  // The original monolith is an ignored development artifact, not a second source of truth.
  assert.match(fs.readFileSync(path.join(projectRoot,'.gitignore'),'utf8'),/^\/app\.js$/m);
  assert.match(fs.readFileSync(path.join(projectRoot,'scripts/build-static.mjs'),'utf8'),/applicationSources\.readApplicationSource\(\)/);
});

test('source manifest fails closed on duplicate files, path traversal and missing input',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pepos-source-test-'));
  try {
    fs.mkdirSync(path.join(dir,'src'));
    for(const files of [[],['../secret.js'],['src/../outside.js'],['src/a/b.js','src/a/b.js']]){
      fs.writeFileSync(path.join(dir,'src/source-manifest.json'),JSON.stringify(files));
      assert.throws(()=>sourceFiles(dir));
    }
    fs.writeFileSync(path.join(dir,'src/source-manifest.json'),'["src/missing/file.js"]');
    assert.throws(()=>readApplicationSource(dir),/ENOENT/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
