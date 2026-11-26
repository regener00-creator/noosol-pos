const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app = require('./load-app-source')();
const migrationName=fs.readdirSync(path.join(root,'supabase','migrations')).find(name=>name.endsWith('_allow_customer_special_prices.sql'));
assert.ok(migrationName,'customer special price migration is required');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', migrationName),
  'utf8',
);

assert.match(app, /async function persistContactImmediately\(contact,\{changes,isCurrent\}=\{\}\)/);
assert.match(app, /updateRevisionedRows\('contacts',sent,contactToRow,acknowledge\)/);
assert.match(app, /insertRevisionedRows\('contacts',sent,contactToRow,acknowledge\)/);
assert.match(app, /const sent=cloneSyncRecords\(\[changes\?\{\.\.\.live,\.\.\.changes\}:live\]\);\s*await ensureWorkspaceRecoveryDurable\(\)/);
assert.doesNotMatch(app, /sb\.from\('contacts'\)\.upsert\(row,\{onConflict:'id'\}\)/);
assert.match(app, /await persistContactImmediately\(customer\)/);
assert.match(app, /save_customer_pricing/);
assert.match(app, /ราคาพิเศษของลูกค้ายังไม่ตรงกับข้อมูลบนระบบ/);

assert.match(migration, /create or replace function private\.resolve_customer_special_price/);
assert.match(migration, /contact\.type in \('customer', 'both'\)/);
assert.match(migration, /rule\.value ->> 'id' = v_rule_id/);
assert.match(migration, /rule\.value ->> 'productId' = p_product_id::text/);
assert.match(migration, /rule\.value ->> 'unit'.*= p_unit_name/);
assert.match(migration, /private\.is_safe_nonnegative_decimal\(rule\.value ->> 'price'\)/);
assert.match(migration, /v_match_count <> 1/);
assert.match(migration, /customer special price cannot be combined with a promotion/);
assert.match(migration, /v_expected_price := private\.resolve_customer_special_price/);
assert.match(migration, /complete_sale price guard does not match the expected version/);
assert.match(migration, /revoke all on function private\.resolve_customer_special_price/);

test('a group move updates the cached contact only after a revisioned save succeeds',async()=>{
  const contact={id:7,name:'PEPO',priceGroupId:'level1',_revision:5};
  let serverError=new Error('test conflict');
  let writes=0;
  const scope=vm.createContext({
    currentProfile:{id:'owner'},contacts:[contact],
    withRevisionedTableLock:async (_table,work)=>work(),
    syncedTableRows:{contacts:new Map()},workspaceRecoveryEntries:new Map(),
    contactToRow:row=>({...row}),
    cloneSyncRecords:structuredClone,
    ensureWorkspaceRecoveryDurable:async()=>{},
    syncAcknowledgement:()=>item=>{contact._revision=item._revision;},
    updateRevisionedRows:async(table,items,_toRow,acknowledge)=>{
      writes++;
      assert.equal(table,'contacts');
      assert.equal(items[0].name,'PEPO');
      assert.equal(items[0]._revision,5);
      assert.equal(items[0].priceGroupId,'level2');
      assert.equal(contact.priceGroupId,'level1');
      if(serverError)return serverError;
      acknowledge({...items[0],_revision:6});
      return null;
    },
    upsertAndPrune:{paused:new Map()}
  });
  vm.runInContext(app.slice(app.indexOf('async function persistContactImmediately('),app.indexOf('let contactFilter')),scope);
  const move=()=>scope.persistContactImmediately(contact,{changes:{priceGroupId:'level2'}});
  await assert.rejects(move,/test conflict/);
  assert.equal(contact.priceGroupId,'level1');
  await assert.rejects(()=>scope.persistContactImmediately(contact,{changes:{priceGroupId:'level2'},isCurrent:()=>false}));
  assert.equal(writes,1);
  serverError=null;
  await move();
  assert.equal(contact.priceGroupId,'level2');
  assert.equal(contact._revision,6);
});
