const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0045_sale_completion_time.sql'), 'utf8');
const stockPosting = migration.indexOf('v_posting:=public.post_sale_inventory_lots');
const completionClock = migration.indexOf('v_now:=clock_timestamp()');
const reference = migration.indexOf('v_sale_ref:=private.next_sale_reference');

assert.ok(stockPosting >= 0, 'ต้องลงสต๊อกผ่านระบบ LOT ก่อนบันทึกการขาย');
assert.ok(completionClock > stockPosting, 'เวลาขายต้องถูกจับหลังลงสต๊อกสำเร็จ');
assert.ok(reference > completionClock, 'เลขบิลและวันที่ต้องใช้วันที่ ณ เวลาที่ชำระสำเร็จ');
assert.match(migration, /to_char\(v_now at time zone 'Asia\/Bangkok','YYYY-MM-DD HH24:MI:SS'\)/);
assert.match(migration, /v_sale_id,v_sale_ref,v_sale_date,v_now/);
assert.match(migration, /security definer set search_path=''/);
assert.match(migration, /revoke execute on function public\.complete_sale\(uuid,text,bigint,jsonb,jsonb\) from public,anon/);
assert.match(migration, /grant execute on function public\.complete_sale\(uuid,text,bigint,jsonb,jsonb\) to authenticated/);

console.log('sale completion time tests passed');
