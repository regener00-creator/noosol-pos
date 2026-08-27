const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function printShortReceipt(');
const end = html.indexOf('\nasync function doCheckout', start);
const receiptCode = html.slice(start, end);

assert.ok(start >= 0 && end > start, 'printShortReceipt must exist');
assert.match(receiptCode, /grid-template-columns:minmax\(0,1fr\) 19mm/, 'receipt item must reserve only name and amount columns');
assert.doesNotMatch(receiptCode, /<span>\$\{index\+1\}<\/span>/, 'receipt items must not display a leading sequence number');

console.log('short receipt layout tests passed');
