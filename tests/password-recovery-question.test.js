const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'supabase', 'functions', 'admin-users', 'index.ts'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'supabase', 'functions', 'owner-recovery', 'index.ts'), 'utf8');

assert.match(app, /id="new_user_recovery_question"/);
assert.match(app, /id="new_user_recovery_answer"[^>]*type="password"|type="password"[^>]*id="new_user_recovery_answer"/);
assert.match(app, /action:'question',username/);
assert.match(app, /action:'reset',username,answer,password/);
assert.doesNotMatch(app, /กรอกรหัสกู้คืน 24 ตัว/);
assert.doesNotMatch(app, /create-owner-recovery-code/);

assert.match(admin, /hasRecoveryAnswer/);
assert.match(admin, /saveRecoveryChallenge/);
assert.match(admin, /answer_hash/);
assert.doesNotMatch(admin, /createRecoveryCode/);

assert.match(recovery, /action === 'question'/);
assert.match(recovery, /action !== 'reset'/);
assert.match(recovery, /ตอบคำถามผิดหลายครั้ง/);

console.log('password recovery question tests passed');
