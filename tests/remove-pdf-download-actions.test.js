const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = require("./load-app-source")();

assert.doesNotMatch(html, /ดาวน์โหลด\s*PDF/i, 'must not show a Download PDF action');
assert.doesNotMatch(html, /แชร์ใบเสร็จรับเงิน\s*\(PDF\)/i, 'must not show a PDF receipt sharing action');
assert.doesNotMatch(html, /id=["'](?:docBulkPdf|downloadTransferFormBtn|pdfHistoricalReceiptBtn|pdfA4CashReceiptBtn|shareShortReceiptBtn)["']/i, 'must not render removed PDF buttons');
assert.doesNotMatch(html, /item\('download'\s*,/, 'document action menus must not contain a download action');

console.log('remove-pdf-download-actions tests passed');
