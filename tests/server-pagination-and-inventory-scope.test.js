const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const migrationName=fs.readdirSync(path.join(root,'supabase','migrations')).find(name=>name.endsWith('_optimize_rpc_and_representative_history.sql'));
assert.ok(migrationName,'ต้องมี Migration สำหรับ pagination');
const migration=fs.readFileSync(path.join(root,'supabase','migrations',migrationName),'utf8');

const coreStart=app.indexOf('async function loadCoreDataFromSupabase(){');
const coreEnd=app.indexOf('// ----- Sales history sync -----',coreStart);
const core=app.slice(coreStart,coreEnd);
assert.doesNotMatch(core,/sb\.from\('inventory_balances'\)/,'หน้าแรกต้องไม่โหลดสต๊อกทุกคลังโดยตรง');
assert.doesNotMatch(core,/sb\.from\('inventory_lots'\)/,'หน้าแรกต้องไม่โหลด LOT ทุกคลังโดยตรง');
assert.match(core,/loadWarehouseInventoryFromSupabase\(inventoryScopeWarehouseIds\(\),\{force:true\}\)/);

const balanceStart=app.indexOf('async function loadInventoryBalancesFromSupabase(');
const balanceEnd=app.indexOf('async function loadWarehouseInventoryFromSupabase(',balanceStart);
const inventoryLoaders=app.slice(balanceStart,balanceEnd);
assert.match(inventoryLoaders,/\.in\('warehouse_id',targets\)/g,'inventory queries ต้องกรองคลังที่ Supabase');
assert.match(app,/loadWarehouseInventoryFromSupabase\(\[activeWarehouseId\]\)/,'สลับคลังแล้วต้อง lazy-load คลังใหม่');
assert.match(app,/resetLoadedInventoryScopes\(\)/,'ออกจากระบบแล้วต้องล้างขอบเขตคลังที่โหลดไว้');

for(const rpc of ['get_notes_page','get_representative_page','get_representative_note_cards','get_representative_notes_page']){
  assert.match(migration,new RegExp(`create or replace function public\\.${rpc}\\(`));
  assert.match(app,new RegExp(`sb\\.rpc\\('${rpc}'`));
}
assert.match(migration,/\(note\.updated_at,note\.id\) < \(p_cursor_updated_at,p_cursor_id\)/);
assert.match(app,/sb\.rpc\('get_representative_note_metadata'/);
assert.match(migration,/lower\(coalesce\(representative\.name,''\)\),representative\.id[\s\S]*> \(p_cursor_name,p_cursor_id\)/);
assert.match(app,/fetched\.slice\(0,NOTE_PAGE_SIZE\)/);
assert.match(app,/fetched\.slice\(0,REPRESENTATIVE_HISTORY_PAGE_SIZE\)/);
assert.match(app,/id="loadMoreRepresentativeHistoryBtn"/);
assert.match(app,/id="loadMoreRepresentativeNotesBtn"/);

console.log('server pagination and inventory scope tests passed');
