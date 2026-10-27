const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(){
  const context=vm.createContext({escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
  vm.runInContext(fs.readFileSync('src/help/usage.js','utf8'),context);
  return {context,run:code=>vm.runInContext(code,context)};
}
test('every sidebar destination has a guide with usable steps and unique identity',()=>{
  const {context,run}=fixture();
  vm.runInContext(fs.readFileSync('src/ui/sidebar.js','utf8'),context);
  const ids=Array.from(context.usageGuideArticles(),article=>article.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const tab of run('NAV.flatMap(group=>group.items.map(item=>item[0]))')){
    if(tab!=='usage') assert.ok(ids.includes(tab),`Missing guide for ${tab}`);
  }
  for(const id of ['settingscategories','mobiletools','medicine','customerreturns','connection']) assert.ok(ids.includes(id));
  for(const article of context.usageGuideArticles()){
    assert.ok(article.title&&article.intro&&article.group);
    assert.ok(article.steps.length>=3&&article.steps.every(step=>step.length>12));
    assert.ok(article.tips.length>0);
  }
});
test('guide search matches Thai steps, case-insensitive English, multiple words and selected groups',()=>{
  const {context,run}=fixture();
  run("usageGuideQuery='ส่งไปเปลี่ยนแล้ว'");
  assert.ok(context.filteredUsageGuideArticles().some(article=>article.id==='productexchange'));
  run("usageGuideQuery='lot รับเข้า'");
  assert.ok(context.filteredUsageGuideArticles().some(article=>article.id==='goodsreceipt'));
  run("usageGuideQuery='';usageGuideGroup='รายงาน'");
  assert.equal(context.filteredUsageGuideArticles().length,8);
  run("usageGuideQuery='คำค้นไม่มีอยู่ในคู่มือxyz'");
  assert.equal(context.filteredUsageGuideArticles().length,0);
  assert.match(context.usageGuideResultsHtml(),/ไม่พบหัวข้อที่ค้นหา/);
});
test('search input is escaped and guide access never grants access to other pages',()=>{
  const {context,run}=fixture();
  run(`usageGuideQuery='\"><img src=x onerror=alert(1)>'`);
  assert.doesNotMatch(context.renderUsageGuide(),/<img/);
  assert.match(context.renderUsageGuide(),/&quot;&gt;|&quot;>/);
  context.isAllWarehousesMode=()=>true;
  context.canPerformPageAction=()=>false;
  vm.runInContext(fs.readFileSync('src/auth/session.js','utf8'),context);
  assert.equal(context.canAccessTab('usage',null),false);
  assert.equal(context.canAccessTab('usage',{owner:false,level:2}),true);
  assert.equal(context.canAccessTab('settingsusers',{owner:false,level:2}),false);
});
