const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('./load-app-source')();
function section(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a);return source.slice(a,b);
}
function setup(old=null){
  const ctx=vm.createContext({
    quotations:old?[structuredClone(old)]:[],editingQuotationId:old?old.id:'new',
    taxInvoiceDraft:{number:old?.id||'Q-NEW',date:'2026-09-12',name:'Customer',items:[{name:'Product',qty:2,price:120,pid:1}],note:'edited'},
    products:[{id:1,name:'Product'}],businessSettings:{},
    syncPOFromDOM:()=>{},syncTaxInvoiceDraftFromDOM:()=>{},showToast:()=>{},render:()=>{},
    isBusinessVatRegistered:()=>false,documentItemVatMode:()=> 'none',
    calculateDocumentTaxSummary:()=>({total:240}),businessDocumentSnapshot:()=>({name:'Current shop'}),
    addDaysToDate:date=>date,persistQuotations:()=>{},
    Map,Number,String,JSON,Object,structuredClone,
  });
  vm.runInContext(section('function docToRow(','function rowToDoc(')+section('function saveQuotation(','function deleteQuotation('),ctx);
  return ctx;
}
test('editing a quotation retains its revision, provenance and document links',()=>{
  const ctx=setup({id:'Q1',_revision:7,createdByUserId:'owner',status:'ขายแล้ว',saleId:'S1',soldAt:'yesterday',businessSnapshot:{name:'Original shop'},items:[],total:120});
  ctx.saveQuotation();const saved=ctx.quotations[0];
  assert.equal(saved._revision,7);
  assert.equal(saved.createdByUserId,'owner');assert.equal(saved.saleId,'S1');assert.equal(saved.soldAt,'yesterday');
  assert.equal(saved.status,'ขายแล้ว');assert.equal(saved.businessSnapshot.name,'Original shop');
  assert.equal(saved.total,240);assert.equal(saved.items[0].qty,2);
  assert.equal(ctx.docToRow(saved).revision,7);
  assert.equal(ctx.docToRow(saved).data._revision,undefined);
  assert.equal(ctx.docToRow(saved).data.createdByUserId,undefined);
});
test('edited quotation sends the original expected revision, not a duplicate-create revision zero',async()=>{
  const ctx=setup({id:'Q1',_revision:7,items:[],total:120});ctx.saveQuotation();let sent;
  Object.assign(ctx,{
    workspaceRecoveryTables:()=>[['quotations',()=>ctx.quotations]],
    syncedTableRows:{quotations:new Map()},workspaceRecoveryEntries:new Map(),
    ensureWorkspaceRecoveryDurable:async()=>{},sha256Hex:async()=> 'hash',
    beginDurableOperation:async()=>({requestId:'request'}),finishDurableOperation:async()=>{},
    sb:{rpc:async(name,args)=>{sent=args;return {data:{revision:8},error:null};}},
  });
  vm.runInContext(section('async function saveRevisionedDocument(','async function syncRevisionedDocuments('),ctx);
  await ctx.saveRevisionedDocument('quotations',ctx.quotations[0]);
  assert.equal(sent.p_expected_revision,7);assert.equal(sent.p_data.total,240);
  assert.equal(ctx.quotations[0]._revision,8);assert.equal(ctx.workspaceRecoveryEntries.size,0);
});
test('new quotations still start at revision zero',()=>{
  const ctx=setup();ctx.saveQuotation();assert.equal(ctx.docToRow(ctx.quotations[0]).revision,0);
  assert.equal(ctx.quotations[0].status,'รอตอบรับ');
});
test('production document lists start empty without hard-coded sample documents',()=>{
  for(const name of ['quotations','invoicesAR','creditNotes','purchaseOrders','goodsReceipts','transfers']){
    assert.match(source,new RegExp(`let ${name} = \\[\\];`));
  }
  for(const id of ['QT-0021','IV-0087','IV-0088','CN-0005','PO-0031','GR-0030','TR-0009']) assert.ok(!source.includes(`id:'${id}'`));
});
