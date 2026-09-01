const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260901162028_shared_notes.sql'), 'utf8');
const indexMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260901163257_notes_fk_indexes.sql'), 'utf8');

const nav = app.slice(app.indexOf('const NAV = ['), app.indexOf('function renderSidebar()'));
const checkoutNav = nav.indexOf("['checkout','POS'");
const noteNav = nav.indexOf("['notes','NOTE'");
const cashShiftNav = nav.indexOf("['cashshift','เปิด-ปิดระบบชำระ'");
assert.ok(checkoutNav >= 0 && noteNav > checkoutNav && noteNav < cashShiftNav, 'NOTE ต้องอยู่ใต้ POS และก่อนเมนูเปิด-ปิดระบบชำระ');

assert.match(app, /\['checkout','ขายสินค้า'\],\['notes','NOTE'\]/, 'NOTE ต้องอยู่ในตัวเลือกสิทธิ์รายหน้า');
assert.match(app, /dashboard: renderDashboard, checkout: renderCheckout, notes: renderNotes/, 'NOTE ต้องมี renderer ของตัวเอง');
assert.match(app, /function sanitizeNoteHtml\([\s\S]*blocked=new Set\(\['script','style','iframe','object','embed','svg','math','link','meta'\]\)/, 'HTML ของโน้ตต้องลบ element ที่ไม่ปลอดภัย');
assert.match(app, /data-note-command="bold"[\s\S]*data-note-command="underline"[\s\S]*data-note-command="strikeThrough"/, 'ตัวแก้ไขต้องมีตัวหนา ขีดเส้นใต้ และขีดฆ่า');
assert.match(app, /data-note-color=/, 'ตัวแก้ไขต้องมีปุ่มเลือกสีข้อความ');
assert.match(app, /id="noteHiddenFromLevel2"/, 'เจ้าของต้องมีตัวเลือกซ่อนโน้ตจาก LEVEL 2');
assert.match(app, /loggedInUser\(\)\?\.owner===true\?`<label class="note-visibility-option"/, 'ตัวเลือกซ่อนต้องแสดงเฉพาะเจ้าของร้าน');

assert.match(migration, /create table if not exists public\.notes/i);
assert.match(migration, /alter table public\.notes enable row level security/i);
assert.match(migration, /hidden_from_level2 is false[\s\S]*can_current_user_page\('notes', null, 'view'\)/i, 'RLS ต้องกรองโน้ตลับก่อนส่งให้ LEVEL 2');
assert.match(migration, /created_by = \(select auth\.uid\(\)\)[\s\S]*can_current_user_page\('notes', null, 'edit'\)/i, 'พนักงานต้องแก้ได้เฉพาะโน้ตของตัวเองตามสิทธิ์');
assert.match(migration, /'dashboard','checkout','notes','cashshift'/, 'server allow-list ต้องรองรับสิทธิ์หน้า NOTE');
assert.match(migration, /select profile\.id, 'notes', null, true, true, true, true/, 'LEVEL 2 เดิมต้องได้รับสิทธิ์ NOTE ตามค่าเริ่มต้น');
assert.match(migration, /char_length\(content_html\) <= 100000/, 'ฐานข้อมูลต้องจำกัดขนาดโน้ต');
assert.match(indexMigration, /notes_created_by_idx[\s\S]*public\.notes\(created_by\)/i);
assert.match(indexMigration, /notes_updated_by_idx[\s\S]*public\.notes\(updated_by\)/i);

assert.match(css, /\.notes-layout\{display:grid;grid-template-columns:/);
assert.match(css, /\.note-content-editor/);

console.log('notes tests passed');
