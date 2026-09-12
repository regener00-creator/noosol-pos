const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('./load-app-source')();
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const toRow=row=>({id:row.id,name:row.name,revision:row._revision||0,data:row.data||{}});
function setup(){
  const ctx=vm.createContext({Map,Set,JSON,Object,String,Array,Number,structuredClone,Error,console,
    currentProfile:{id:'a'},workspaceRecoveryActorId:'a',workspaceRecoveryEntries:new Map(),syncedTableRows:{},contacts:[],salesRepresentatives:[],docs:[],contactToRow:toRow,salesRepToRow:toRow,docToRow:toRow});
  ctx.DOC_TABLES=[['quotations',()=>ctx.docs,rows=>ctx.docs=rows]];
  vm.runInContext(section('function workspaceRecoveryTables(','function renderWorkspaceRecoveryPanel(')+section('function currentWorkspacePendingChanges(','async function ensureWorkspaceRecoveryDurable('),ctx);
  return ctx;
}
test('remote refresh preserves pending creates, edits and deletions and their original revisions',()=>{
  const c=setup();const original={id:1,name:'old',_revision:2},deleted={id:2,name:'delete',_revision:1};
  c.contacts=[{...original,name:'unsent'},{id:3,name:'new',_revision:0}];
  c.syncedTableRows.contacts=new Map([['1',JSON.stringify(toRow(original))],['2',JSON.stringify(toRow(deleted))]]);
  const pending=c.currentWorkspacePendingChanges();assert.equal(pending.length,3);
  const remote=[{...original,name:'other device',_revision:3},deleted,{id:4,name:'remote new',_revision:1}];
  c.contacts=c.mergeWorkspaceRemoteRows('contacts',c.contacts,remote,toRow,{replace:true});
  assert.deepEqual(Array.from(c.contacts,row=>[row.id,row.name]),[[1,'unsent'],[4,'remote new'],[3,'new']]);
  assert.equal(JSON.parse(c.syncedTableRows.contacts.get('1')).revision,2,'keep revision 2 to detect conflict, never silently rebase');
  assert.equal(c.currentWorkspacePendingChanges().length,3);
  const saved=structuredClone([...c.workspaceRecoveryEntries.values()]);
  const restored=setup();restored.workspaceRecoveryEntries=new Map(saved.map(e=>[`${e.table}:${e.id}`,e]));
  restored.contacts=restored.mergeWorkspaceRemoteRows('contacts',[],remote,toRow,{replace:true});
  assert.equal(restored.contacts.find(row=>row.id===1).name,'unsent');
  assert.equal(restored.contacts.some(row=>row.id===2),false);
});
test('detached document draft cannot be replaced by its old list row before the durable write',()=>{
  const c=setup(),old={id:'Q1',name:'old',_revision:1};c.docs=[old];c.syncedTableRows.quotations=new Map([['Q1',JSON.stringify(toRow(old))]]);
  c.workspaceRecoveryEntries.set('quotations:Q1',{table:'quotations',id:'Q1',baseline:JSON.stringify(toRow(old)),record:{...old,name:'draft'},detached:true});
  assert.equal(c.currentWorkspacePendingChanges()[0].record.name,'draft');
  c.docs=c.mergeWorkspaceRemoteRows('quotations',c.docs,[old],toRow,{replace:true});
  assert.equal(c.docs[0].name,'draft');c.docs[0].name='newer draft';
  assert.equal(c.currentWorkspacePendingChanges()[0].record.name,'newer draft');
});
test('legacy cache reconciles unchanged records but never silently discards unknown edits',()=>{
  const c=setup(),a={id:1,name:'same',_revision:1},b={id:2,name:'local edit',_revision:1};
  c.workspaceRecoveryEntries=new Map([a,b].map(row=>[`contacts:${row.id}`,{table:'contacts',id:String(row.id),record:row,baseline:JSON.stringify(toRow(row)),legacy:true}]));
  c.contacts=c.mergeWorkspaceRemoteRows('contacts',[],[{...a,_revision:2},{...b,name:'server'}],toRow,{replace:true});
  assert.equal(c.workspaceRecoveryEntries.has('contacts:1'),false);
  assert.equal(c.workspaceRecoveryEntries.has('contacts:2'),true);
  assert.equal(c.contacts[1].name,'local edit');
});
test('different signed-in user never collects the previous users pending work',()=>{
  const c=setup();c.workspaceRecoveryEntries.set('contacts:1',{table:'contacts',id:'1',record:{id:1}});c.currentProfile={id:'b'};
  assert.equal(c.currentWorkspacePendingChanges().length,0);assert.equal(c.workspaceRecoveryEntries.size,1);
});
test('local history cache caps clean rows but retains every pending document',()=>{
  const c=setup();c.docs=Array.from({length:150},(_,i)=>({id:String(i),name:'old',_revision:1}));
  c.syncedTableRows.quotations=new Map(c.docs.map(row=>[row.id,JSON.stringify(toRow(row))]));c.docs[149].name='pending';
  Object.assign(c,{WORKSPACE_DOCUMENT_CACHE_LIMIT:100,cloneSyncRecords:structuredClone,workspaceSnapshot:()=>({quotations:c.docs,products:[1],salesHistory:[2]})});
  vm.runInContext(section('function localWorkspaceSnapshot(','function workspaceRecoveryTables('),c);
  const snapshot=c.localWorkspaceSnapshot();assert.equal(snapshot.quotations.length,101);assert.equal(snapshot._pendingWorkspaceChanges.length,1);
  assert.equal(snapshot.products,undefined);assert.equal(snapshot.salesHistory,undefined);
  c.docs[149].name='later';assert.equal(snapshot.quotations[100].name,'pending','snapshot must be detached');
});
test('failed durable workspace write stops the caller',async()=>{
  const c=setup();Object.assign(c,{localWorkspaceSnapshot:()=>({}),workspacePersistTimer:null,clearTimeout:()=>{},flushWorkspaceCacheToIndexedDB:async()=>false});
  vm.runInContext(section('async function ensureWorkspaceRecoveryDurable(','async function loadWorkspaceRecoveryForUser('),c);
  await assert.rejects(c.ensureWorkspaceRecoveryDurable(),error=>error.code==='LOCAL_STORAGE_UNAVAILABLE');
});
test('a repeated document revision conflict is paused until the payload changes',async()=>{
  const c=setup();let calls=0;
  Object.assign(c,{tableSnapshot:rows=>new Map(rows.map(row=>[row.id,JSON.stringify(toRow(row))])),cloneSyncRecords:structuredClone,syncAcknowledgement:()=>()=>{},saveRevisionedDocument:async()=>{calls++;const e=new Error('conflict');e.code='REVISION_CONFLICT';throw e;}});
  vm.runInContext(section('async function syncRevisionedDocuments(','const MEDICINE_LABEL_DURATION_OPTIONS='),c);
  const docs=[{id:'Q1',name:'first',_revision:1}];
  await assert.rejects(c.syncRevisionedDocuments('quotations',docs));
  await assert.rejects(c.syncRevisionedDocuments('quotations',docs),e=>e.syncPaused===true);assert.equal(calls,1);
  docs[0].name='changed';await assert.rejects(c.syncRevisionedDocuments('quotations',docs));assert.equal(calls,2);
});
test('contact acknowledgement copies the central code without losing edits made in flight',()=>{
  const c=setup();c.contacts=[{id:1,name:'new edit',code:'',_autoCode:true}];
  vm.runInContext(section('function syncAcknowledgement(','async function upsertRowsInChunks('),c);
  const mapper=row=>({...toRow(row),data:{code:row.code}});
  c.syncAcknowledgement('contacts',c.contacts,mapper)({id:1,name:'sent name',code:'C0101',_revision:1});
  assert.equal(c.contacts[0].code,'C0101');assert.equal(c.contacts[0]._autoCode,undefined);assert.equal(c.contacts[0].name,'new edit');
  assert.equal(JSON.parse(c.syncedTableRows.contacts.get('1')).name,'sent name');
});
test('saving a detached sync payload does not hide newer live edits from crash recovery',async()=>{
  const c=setup();let release;
  c.docs=[{id:'Q1',name:'first edit',_revision:1}];c.syncedTableRows.quotations=new Map([['Q1',JSON.stringify(toRow({...c.docs[0],name:'original'}))]]);
  Object.assign(c,{ensureWorkspaceRecoveryDurable:async()=>true,sha256Hex:async()=> 'hash',beginDurableOperation:async()=>({requestId:'request'}),finishDurableOperation:async()=>{},reportClientEvent:()=>{},sb:{rpc:()=>new Promise(resolve=>release=()=>resolve({data:{revision:2},error:null}))}});
  vm.runInContext(section('async function saveRevisionedDocument(','async function syncRevisionedDocuments('),c);
  const saving=c.saveRevisionedDocument('quotations',structuredClone(c.docs[0]));
  await new Promise(resolve=>setImmediate(resolve));c.docs[0].name='newer edit while request is pending';
  assert.equal(c.currentWorkspacePendingChanges()[0].record.name,'newer edit while request is pending');
  release();await saving;
});
