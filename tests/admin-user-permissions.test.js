const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/admin-users/index.ts'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'supabase/functions/bootstrap-owner/index.ts'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260831185553_security_integrity_and_scale_hardening.sql'),
  'utf8'
);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

const createRpc = section(
  migration,
  'create or replace function public.admin_create_staff_profile_access(',
  'create or replace function public.admin_update_staff_profile_access('
);
const updateRpc = section(
  migration,
  'create or replace function public.admin_update_staff_profile_access(',
  'revoke all on function public.admin_create_staff_profile_access('
);
const conflictUpdate = section(
  updateRpc,
  'on conflict (user_id, warehouse_id) do update',
  'delete from public.profile_warehouse_access access'
);

// The database owns the staff profile + assignment transaction.
assert.match(createRpc, /language plpgsql[\s\S]*security definer[\s\S]*set search_path = ''/i);
assert.match(updateRpc, /language plpgsql[\s\S]*security definer[\s\S]*set search_path = ''/i);
assert.match(createRpc, /perform private\.acquire_store_mutation_gate\(\)/i);
assert.match(updateRpc, /select \* into v_target[\s\S]*for update/i);
assert.match(updateRpc, /v_target\.owner or v_target\.level = 1/i);
assert.ok(
  updateRpc.indexOf('v_ids := private.validate_staff_warehouse_ids(v_ids)')
    < updateRpc.indexOf('perform access.warehouse_id'),
  'warehouses must be locked before access rows to match FK-cascade lock order'
);
assert.match(migration, /staff must have at least one warehouse/i);
assert.match(migration, /warehouse ids must be distinct/i);
assert.match(migration, /where warehouse\.id = v_warehouse_id[\s\S]*for key share/i);

// Level 2 receives goods. Downgrading to Level 3/4 rewrites the retained rows
// to false, while the unrelated explicit stock-management bit is preserved.
assert.match(createRpc, /select p_user_id, requested\.id, true, false, p_level = 2/i);
assert.match(updateRpc, /select p_user_id, requested\.id, true, false, v_level = 2/i);
assert.match(conflictUpdate, /can_receive_goods = excluded\.can_receive_goods/i);
assert.doesNotMatch(conflictUpdate, /can_manage_stock\s*=/i);
assert.match(
  updateRpc,
  /delete from public\.profile_warehouse_access access[\s\S]*access\.user_id = p_user_id[\s\S]*not \(access\.warehouse_id = any\(v_ids\)\)/i
);

// Only service_role may invoke these privileged endpoints.
for (const signature of [
  /admin_create_staff_profile_access\([\s\S]*?\) from public, anon, authenticated, service_role;[\s\S]*?admin_create_staff_profile_access\([\s\S]*?\) to service_role;/i,
  /admin_update_staff_profile_access\([\s\S]*?\) from public, anon, authenticated, service_role;[\s\S]*?admin_update_staff_profile_access\([\s\S]*?\) to service_role;/i,
]) assert.match(migration, signature);

assert.match(edge, /admin\.rpc\('admin_create_staff_access_v2'/);
assert.match(edge, /admin\.rpc\('admin_update_staff_access_v2'/);
assert.doesNotMatch(edge, /syncStaffWarehouseAccess|restoreWarehouseAccess/);

// Both potentially unbounded list inputs are read in deterministic fixed-size
// pages and stop only when a short page is returned.
const profilePager = section(edge, 'async function listAllProfiles(', 'async function listAllWarehouseAccess(');
const accessPager = section(edge, 'async function listAllWarehouseAccess(', 'async function listAllPagePermissions(');
assert.match(profilePager, /\.order\('owner',[\s\S]*\.order\('id'\)[\s\S]*\.range\(from, from \+ PROFILE_PAGE_SIZE - 1\)/);
assert.match(profilePager, /batch\.length < PROFILE_PAGE_SIZE/);
assert.match(accessPager, /\.order\('user_id'\)[\s\S]*\.order\('warehouse_id'\)[\s\S]*\.range\(from, from \+ WAREHOUSE_ACCESS_PAGE_SIZE - 1\)/);
assert.match(accessPager, /batch\.length < WAREHOUSE_ACCESS_PAGE_SIZE/);

// Account deletion fails closed, refuses owners/open shifts, and only calls
// Auth after all checked reads succeeded. A database trigger closes the race.
const deleteAction = section(edge, "if (action === 'delete')", "return json({ error: 'unknown action'");
const targetErrorAt = deleteAction.indexOf('if (targetError)');
const missingTargetAt = deleteAction.indexOf('if (!target)');
const ownerGuardAt = deleteAction.indexOf('if (target.owner)');
const shiftErrorAt = deleteAction.indexOf('if (openShiftError)');
const authDeleteAt = deleteAction.indexOf('admin.auth.admin.deleteUser(id)');
assert.ok(targetErrorAt >= 0 && missingTargetAt > targetErrorAt && ownerGuardAt > missingTargetAt);
assert.ok(shiftErrorAt > ownerGuardAt && authDeleteAt > shiftErrorAt);
assert.match(deleteAction, /status', 'open'/);
assert.match(deleteAction, /กรุณาปิดกะก่อนลบผู้ใช้งาน/);
assert.match(migration, /create trigger prevent_profile_delete_with_open_shift[\s\S]*before delete on public\.profiles/i);
assert.match(migration, /cannot delete a profile with an open cash shift/i);

// Historical actor references survive Auth/profile deletion.
for (const expected of [
  /product_unit_changes[\s\S]*foreign key \(changed_by\) references auth\.users\(id\) on delete set null/i,
  /product_exchanges[\s\S]*foreign key \(created_by\) references auth\.users\(id\) on delete set null/i,
  /inspection_lists[\s\S]*foreign key \(created_by\) references auth\.users\(id\) on delete set null/i,
  /cash_shifts[\s\S]*foreign key \(opened_by\) references public\.profiles\(id\) on delete set null[\s\S]*foreign key \(closed_by\) references public\.profiles\(id\) on delete set null/i,
]) assert.match(migration, expected);
assert.match(migration, /pepos\.staff_identity_delete/);
assert.match(migration, /to_jsonb\(new\) - 'opened_by' - 'closed_by'/);
assert.match(migration, /old\.status = 'closed'/);

// Create cleanup is checked twice and exposes an operational warning if Auth
// cannot be removed. Password-first updates never perform a risky rollback.
const cleanupHelper = section(edge, 'async function deleteAuthUserWithRetry(', 'async function verifyCurrentPassword(');
assert.match(cleanupHelper, /attempt < 2/);
assert.match(cleanupHelper, /return \{ ok: false, error:/);
const createAction = section(edge, "if (action === 'create')", "if (action === 'update')");
assert.match(createAction, /body\.level === undefined \? 2 : Number\(body\.level\)/);
assert.match(createAction, /!\[2, 3, 4\]\.includes\(level\)/);
assert.match(createAction, /deleteAuthUserWithRetry\(admin, created\.user\.id\)/);
assert.match(createAction, /สร้างบัญชี Auth แล้วแต่ลบคืนไม่สำเร็จ/);
const updateAction = section(edge, "if (action === 'update')", "if (action === 'delete')");
assert.ok(
  updateAction.indexOf('admin.auth.admin.updateUserById') < updateAction.indexOf("admin.rpc('admin_update_staff_access_v2'"),
  'password must be changed before the transactional profile/access RPC'
);
assert.match(updateAction, /Password สำเร็จแล้ว แต่ข้อมูลผู้ใช้งานและสิทธิ์คลังไม่ได้เปลี่ยน/);
assert.doesNotMatch(updateAction, /restoreWarehouseAccess|previousAccess|rollbackErrors/);

const bootstrapCleanup = section(bootstrap, 'async function cleanupCreatedOwner(', 'function cleanupMessage(');
assert.match(bootstrapCleanup, /attempt < 2/);
assert.match(bootstrapCleanup, /profile_warehouse_access/);
assert.match(bootstrapCleanup, /from\('profiles'\)\.delete\(\)/);
assert.match(bootstrapCleanup, /from\('warehouses'\)\.delete\(\)/);
assert.match(bootstrap, /กู้คืนการสร้างเจ้าของร้านไม่ครบ/);
assert.ok((bootstrap.match(/cleanupCreatedOwner\(/g) || []).length >= 5);

console.log('admin user permission tests passed');
