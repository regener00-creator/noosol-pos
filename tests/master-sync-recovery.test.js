const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('./load-app-source')();
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const clone=structuredClone;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
  const rows=new Map(),calls=[];
  const c=vm.createContext({console:{warn(){}},Map,Set,JSON,Date,Number,String,Array,Promise,Object,Error,structuredClone,
    currentProfile:{id:'owner',owner:true},workspaceRecoveryActorId:'owner',workspaceRecoveryEntries:new Map(),syncedTableRows:{contacts:new Map()},
    contacts:[],salesRepresentatives:[],inspectionLists:[],DOC_TABLES:[],SYNC_TABLE_LABELS:{contacts:'สมุดรายชื่อ'},
    additionalData:(item,omit)=>Object.fromEntries(Object.entries(item).filter(([key])=>!omit.includes(key))),
    generateProductCreateToken:()=> 'create-token',ensureWorkspaceRecoveryDurable:async()=>true,
    tableSnapshot:(items,toRow)=>new Map(items.map(item=>[String(item.id),JSON.stringify(toRow(item))])),
    noteCoreSyncFailure:(error,detail)=>{c.failure={error,...detail};return false;},
  });
  c.workspaceRecoveryTables=()=>[['contacts',()=>c.contacts,value=>{c.contacts=value;},c.contactToRow]];
  c.sb={from(table){
    const filters=[],query={op:'select',table};
    const chain={
      insert(items){query.op='insert';query.items=clone(items);return chain;},
      update(value){query.op='update';query.value=clone(value);return chain;},
      delete(){query.op='delete';return chain;},select(){return chain;},
      eq(key,value){filters.push(row=>String(row[key])===String(value));return chain;},
      in(key,values){filters.push(row=>values.map(String).includes(String(row[key])));return chain;},
      maybeSingle(){query.single=true;return chain;},
      then(resolve,reject){return Promise.resolve().then(async()=>{
        calls.push({...query});
        if(c.beforeRequest) await c.beforeRequest(query);
        if(c.requestError?.(query)) return {data:null,error:c.requestError(query)};
        if(query.op==='insert'){
          if(query.items.some(row=>rows.has(String(row.id)))) return {data:null,error:{code:'23505',message:'contacts_pkey'}};
          const inserted=query.items.map(row=>({...row,revision:1}));
          inserted.forEach(row=>rows.set(String(row.id),row));return {data:clone(inserted),error:null};
        }
        const matched=[...rows.values()].filter(row=>filters.every(filter=>filter(row)));
        if(query.op==='delete') matched.forEach(row=>rows.delete(String(row.id)));
        if(query.op==='update') matched.forEach(row=>{Object.assign(row,query.value);row.revision++;});
        return {data:query.single?clone(matched[0]||null):clone(matched),error:null};
      }).then(resolve,reject);}
    };return chain;
  }};
  vm.runInContext(section('function contactToRow(','// Supabase/PostgREST')+
    section('function cloneSyncRecords(','async function upsertRowsInChunks(')+
    section('function canonicalProductInsertValue(','function productInsertMetadataRow(')+
    section('function revisionConflictError(','async function syncWarehousesIncrementally(')+
    section('function currentWorkspacePendingChanges(','async function ensureWorkspaceRecoveryDurable(')+
    section('async function persistContactImmediately(','let contactFilter'),c);
  const add=(id,name='old',revision=1)=>{
    const item={id,name,types:['supplier'],phone:'',_revision:revision};
    c.contacts.push(item);const row=clone(c.contactToRow(item));rows.set(String(id),row);c.syncedTableRows.contacts.set(String(id),JSON.stringify(row));return item;
  };
  return {c,rows,calls,add,sync:()=>c.upsertAndPrune('contacts',c.contacts,c.contactToRow)};
}

test('already deleted contacts are acknowledged; newer remote revisions are never force-deleted',async()=>{
  const {c,rows,add,sync}=setup();add(1);add(2);rows.delete('1');rows.get('2').revision=2;c.contacts=[];
  assert.equal(await sync(),false);
  assert.equal(c.syncedTableRows.contacts.has('1'),false);
  assert.equal(rows.has('2'),true);assert.equal(c.failure.error.code,'REVISION_CONFLICT');
  assert.deepEqual(Array.from(c.currentWorkspacePendingChanges(),entry=>entry.id),['2']);
});

test('failed verification reads never acknowledge a pending deletion',async()=>{
  const {c,rows,add,sync}=setup();add(1);rows.delete('1');c.contacts=[];
  c.requestError=query=>query.op==='select'?{code:'401',message:'expired token'}:null;
  assert.equal(await sync(),false);assert.equal(c.syncedTableRows.contacts.has('1'),true);
  assert.equal(c.failure.error.code,'401');
});

test('one conflict does not block later batches; unchanged conflict is paused',async()=>{
  const {c,rows,calls,add,sync}=setup();for(let id=1;id<=15;id++) add(id).name='new';
  rows.get('1').name='another edit';rows.get('1').revision=2;
  assert.equal(await sync(),false);assert.equal(rows.get('15').name,'new');
  assert.equal(c.contacts[0].name,'new');assert.equal(c.contacts[0]._revision,1);
  const attempts=calls.length;assert.equal(await sync(),false);assert.equal(calls.length,attempts);
  assert.equal(c.failure.error.syncPaused,true);assert.equal(c.currentWorkspacePendingChanges().length,1);
  c.contacts[0].name='changed draft';await sync();assert.ok(calls.length>attempts);
});

test('lost update response is acknowledged by content without another overwrite',async()=>{
  const {c,rows,calls,add,sync}=setup();const item=add(1);item.name='saved';rows.get('1').name='saved';rows.get('1').revision=2;
  assert.equal(await sync(),true);assert.equal(item._revision,2);assert.equal(rows.get('1').revision,2);
  assert.equal(c.currentWorkspacePendingChanges().length,0);assert.equal(calls.filter(q=>q.op==='update').length,1);
});

test('a missing remote contact with a pending edit is not recreated',async()=>{
  const {c,rows,calls,add,sync}=setup();add(1).name='unsent';rows.delete('1');
  assert.equal(await sync(),false);assert.equal(rows.has('1'),false);assert.equal(calls.some(q=>q.op==='insert'),false);
});

test('own insert token recovers a duplicate-ID retry; another token cannot claim the row',async()=>{
  const {c,rows,add}=setup();const item=add(1);item._clientCreateToken='own';rows.set('1',clone(c.contactToRow(item)));item._revision=0;
  const acknowledgements=[];assert.equal(await c.insertRevisionedRows('contacts',[item],c.contactToRow,row=>acknowledgements.push(row)),null);
  assert.equal(acknowledgements.length,1);assert.equal(item._revision,1);
  item._clientCreateToken='different';item._revision=0;
  assert.equal((await c.insertRevisionedRows('contacts',[item],c.contactToRow)).code,'23505');
});

test('phone collisions are preserved while healthy creates continue',async()=>{
  const {c,calls,rows,sync}=setup();c.contacts=[{id:1,name:'duplicate',types:['customer'],phone:'123',_revision:0},{id:2,name:'healthy',types:['supplier'],phone:'',_revision:0}];
  c.requestError=query=>query.op==='insert'&&query.items[0].id===1?{code:'23505',message:'contacts_customer_phone_unique'}:null;
  assert.equal(await sync(),false);assert.equal(rows.has('2'),true);assert.equal(c.failure.error.code,'23505');
  const count=calls.length;await sync();assert.equal(calls.length,count);
});

test('legacy supplier cache is cleared only when real content matches; no writes are sent',async()=>{
  const {c,calls,add,sync}=setup();const item=add(1);item.loyaltyJoinedAt='2026-09-03T04:00:00Z';
  c.syncedTableRows.contacts.set('1',JSON.stringify(c.contactToRow(item)));
  c.workspaceRecoveryEntries.set('contacts:1',{table:'contacts',id:'1',record:item,baseline:JSON.stringify(c.contactToRow(item)),legacy:true});
  assert.equal(await sync(),true);assert.equal(c.currentWorkspacePendingChanges().length,0);
  assert.equal(calls.some(q=>q.op!=='select'),false);
});

test('own customer retry also recovers when the phone index reports the collision',async()=>{
  const {c,rows,add}=setup();const item=add(1);item.types=['customer'];item._clientCreateToken='own';
  rows.set('1',{...clone(c.contactToRow(item)),created_at:'2026-09-14T00:00:00Z'});item._revision=0;
  c.requestError=query=>query.op==='insert'?{code:'23505',message:'contacts_customer_phone_unique'}:null;
  assert.equal(await c.insertRevisionedRows('contacts',[item],c.contactToRow),null);
  assert.equal(item._revision,1);
});

test('legacy cache without a trusted baseline is not blindly inserted',async()=>{
  const {c,calls,sync}=setup();const item={id:123,name:'unknown legacy draft',types:['supplier'],_revision:0};
  c.contacts=[item];c.workspaceRecoveryEntries.set('contacts:123',{table:'contacts',id:'123',record:item,baseline:null,legacy:true});
  assert.equal(await sync(),false);assert.equal(c.currentWorkspacePendingChanges().length,1);
  assert.equal(calls.some(q=>q.op!=='select'),false);
});

test('legacy cache with a real phone edit remains pending and does not pretend to be synced',async()=>{
  const {c,calls,add,sync}=setup();const item=add(1);item.phone='unsent';
  c.syncedTableRows.contacts.set('1',JSON.stringify(c.contactToRow(item)));
  c.workspaceRecoveryEntries.set('contacts:1',{table:'contacts',id:'1',record:item,baseline:JSON.stringify(c.contactToRow(item)),legacy:true});
  assert.equal(await sync(),false);assert.equal(c.currentWorkspacePendingChanges().length,1);
  assert.equal(c.contacts[0].phone,'unsent');assert.equal(calls.some(q=>q.op!=='select'),false);
  const count=calls.length;await sync();assert.equal(calls.length,count,'unchanged legacy conflict does not repeatedly read');
});

test('immediate contact save and background sync are serialized and share acknowledgements',async()=>{
  const {c,calls,rows,add,sync}=setup();const item=add(1);item.name='new';let release;
  c.beforeRequest=query=>query.op==='update'?new Promise(resolve=>{release=resolve;}):undefined;
  const immediate=c.persistContactImmediately(item);await tick();
  const background=sync();release();await immediate;await background;
  assert.equal(calls.filter(q=>q.op==='update').length,1);assert.equal(rows.get('1').revision,2);
  assert.equal(c.currentWorkspacePendingChanges().length,0);
});

test('background save before immediate save does not create a second update',async()=>{
  const {c,calls,add,sync}=setup();const item=add(1);item.name='new';
  const background=sync(),immediate=c.persistContactImmediately(item);await background;await immediate;
  assert.equal(calls.filter(q=>q.op==='update').length,1);
});

test('late acknowledgement updates the current array and never replaces a newer draft',()=>{
  const {c,add}=setup();const old=add(1);const ack=c.syncAcknowledgement('contacts',c.contacts,c.contactToRow);
  c.contacts=[{...old,name:'newest'}];ack({...old,name:'sent',_revision:2});
  assert.equal(c.contacts[0].name,'newest');assert.equal(c.contacts[0]._revision,2);
  assert.equal(c.currentWorkspacePendingChanges()[0].record.name,'newest');
});

test('contact errors do not expose product overwrite buttons',()=>{
  const c=vm.createContext({products:[{id:92,sku:'92'}]});
  vm.runInContext(section('function syncConflictProductId(','function syncDetailRowsHtml('),c);
  assert.equal(c.syncConflictProductId({table_name:'contacts',record_id:'92',error_code:'REVISION_CONFLICT'}),0);
});

test('definitive phone rejection rolls back only that contact, not other in-flight edits',async()=>{
  const {c,add}=setup();add(1);add(2);let release;
  Object.assign(c,{editingContactId:1,saveContactEditorData:()=>{c.contacts[0].name='rejected';return c.contacts[0];},
    persistContactImmediately:()=>new Promise((_,reject)=>{release=()=>reject({code:'23505'});}),
    isDuplicateCustomerPhoneError:e=>e.code==='23505',persistContacts:()=>{},showToast:()=>{},rememberSyncUiError:()=>{}});
  vm.runInContext(section('async function saveContactFromEditor(','async function saveContact(){'),c);
  const saving=c.saveContactFromEditor(1);c.contacts[1].name='new unrelated edit';release();await saving;
  assert.equal(c.contacts.find(row=>row.id===1).name,'old');assert.equal(c.contacts.find(row=>row.id===2).name,'new unrelated edit');
});

test('network failure preserves the user draft and its recovery entry',async()=>{
  const {c,add}=setup();add(1);
  Object.assign(c,{editingContactId:1,saveContactEditorData:()=>{c.contacts[0].name='unsent';c.currentWorkspacePendingChanges();return c.contacts[0];},
    persistContactImmediately:async()=>{throw new Error('offline');},isDuplicateCustomerPhoneError:()=>false,
    showToast:()=>{},rememberSyncUiError:()=>{}});
  vm.runInContext(section('async function saveContactFromEditor(','async function saveContact(){'),c);
  await c.saveContactFromEditor(1);assert.equal(c.contacts[0].name,'unsent');assert.equal(c.currentWorkspacePendingChanges().length,1);
});

test('core sync continues representatives, documents and counts after a contacts failure',async()=>{
  const calls=[];
  const c=vm.createContext({console,Date,Error,SYNC_TABLE_LABELS:{},currentProfile:{owner:true},currentTab:'contacts',
    coreSyncInFlight:false,coreSyncPending:false,coreSyncFailureDetail:null,currentWorkspacePendingChanges:()=>[],
    adoptRemoteMaintenanceEpoch:async()=>false,loggedInUser:()=>({owner:true}),setSyncUiState:()=>{},
    syncWarehousesIncrementally:async()=>true,syncProductsIncrementally:async()=>true,
    contacts:[],contactToRow:x=>x,salesRepresentatives:[],salesRepToRow:x=>x,
    upsertAndPrune:async table=>{calls.push(table);if(table==='contacts'){c.coreSyncFailureDetail={error:{code:'REVISION_CONFLICT'},tableName:table};return false;}return true;},
    DOC_TABLES:[['quotations',()=>[]]],documentLoadStates:{quotations:{loaded:true}},syncRevisionedDocuments:async table=>{calls.push(table);},
    syncInspectionListsToSupabase:async()=>{calls.push('inspection_lists');return true;},rememberSyncUiError:()=>({}),reportClientEvent:()=>{},flushPendingClientEvents:()=>{},
    resolveOwnSyncEventsThrough:async()=>assert.fail('must not close a genuine unresolved conflict')});
  vm.runInContext(section('async function syncCoreDataToSupabase(','// Stock never travels'),c);
  await c.syncCoreDataToSupabase();assert.deepEqual(calls,['contacts','sales_representatives','quotations','inspection_lists']);
});
