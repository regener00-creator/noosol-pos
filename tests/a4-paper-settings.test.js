const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const entries=new Map(),c=vm.createContext({localStorage:{getItem:key=>entries.get(key)||null}});
vm.runInContext(fs.readFileSync('src/settings/paper.js','utf8'),c);
const plain=x=>JSON.parse(JSON.stringify(x));
test('A4 preferences preserve document defaults until explicitly saved',()=>{
 assert.equal(c.readA4PaperSettings(),null);
 entries.set('pepos_a4_paper_v1','invalid');assert.equal(c.readA4PaperSettings(),null);
 entries.set('pepos_a4_paper_v1',JSON.stringify({orientation:'landscape',marginTop:10}));
 assert.equal(c.readA4PaperSettings().marginTop,10);
 assert.equal(c.readA4PaperSettings().marginLeft,15);
});
test('A4 numeric and direction normalization cannot inject CSS or leave negative space',()=>{
 assert.deepEqual(plain(c.normalizeA4PaperSettings({orientation:'evil',marginTop:-1,marginLeft:99,marginBottom:'',marginRight:Infinity})),{orientation:'auto',marginTop:0,marginBottom:15,marginLeft:40,marginRight:15});
 assert.doesNotMatch(c.a4PaperLayoutCss({orientation:'};body{display:none',marginTop:'5;display:none'}),/display:none/);
 assert.match(c.a4PaperLayoutCss({orientation:'auto'},'landscape'),/size:A4 landscape/);
 assert.match(c.a4PaperLayoutCss({orientation:'portrait',marginLeft:12}),/size:A4 portrait/);
});
test('A4 sample is isolated from sales and rendering scripts',()=>{
 const sample=c.a4PaperTestHtml({orientation:'landscape'});
 assert.match(sample,/width:297mm/);assert.match(sample,/ไม่บันทึกยอดขายและไม่ตัดสต๊อก/);
 assert.doesNotMatch(sample,/<script|https:\/\//);
});
