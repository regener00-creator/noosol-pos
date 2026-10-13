const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/ui/theme.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const initial=html.match(/<script>\s*\/\/ Apply before first paint;[\s\S]*?<\/script>/)[0].replace(/<\/?script>/g,'');
test('theme initializes before paint, validates saved preference, and tolerates blocked storage',()=>{
  for(const saved of [null,'classic','mac','bad',new Error('blocked')]){
    const ctx={document:{documentElement:{dataset:{}}},localStorage:{getItem(){if(saved instanceof Error)throw saved;return saved;}}};
    vm.runInNewContext(initial,ctx);
    assert.equal(ctx.document.documentElement.dataset.sapuriTheme,saved==='classic'?'classic':'mac');
  }
});
test('theme persistence is isolated and failures still apply appearance without rendering drafts',()=>{
  const calls=[],buttons=['mac','classic'].map(value=>({dataset:{sapuriThemeChoice:value},setAttribute:(...args)=>calls.push([value,...args])}));
  const ctx={document:{documentElement:{dataset:{}},querySelector:()=>null,querySelectorAll:()=>buttons,addEventListener(){}},window:{addEventListener(){}},localStorage:{setItem:(...args)=>calls.push(args)},toast:message=>calls.push(message)};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  ctx.applySapuriTheme('classic',true);
  assert.equal(ctx.document.documentElement.dataset.sapuriTheme,'classic');
  assert.ok(calls.some(x=>x[0]==='sapuri_ui_theme_v1'&&x[1]==='classic'));
  ctx.localStorage.setItem=()=>{throw new Error('quota');};
  assert.doesNotThrow(()=>ctx.applySapuriTheme('mac',true));
  assert.equal(ctx.document.documentElement.dataset.sapuriTheme,'mac');
  assert.equal(typeof calls.at(-1),'string');
  assert.doesNotMatch(source.replace(/\/\/[^\n]*/g,''),/\b(?:sb|render|persist|saveState)\s*[.(]/);
});
