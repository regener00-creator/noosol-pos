const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = require("./load-app-source")();

assert.equal((html.match(/class="brand sidebar-user"/g)||[]).length,1,'sidebar user block must remain unique');
assert.match(html,/\.sidebar-user::before\{[^}]*top:-48px;[^}]*height:48px;[^}]*background:var\(--sidebar\);[^}]*\}/,'sidebar user block must cover the gap above it with an opaque sidebar background');
assert.match(html,/\.sidebar-user-text\{[^}]*position:relative;[^}]*z-index:1;/,'user text must remain above the cover background');

console.log('sidebar user background tests passed');
