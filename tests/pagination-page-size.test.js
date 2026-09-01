const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = require("./load-app-source")();

const tenItemConstants = [
  'CONTACTS_PER_PAGE',
  'PRODUCTS_PER_PAGE',
  'INSPECTION_LIST_PAGE_SIZE',
  'STOCK_EDIT_PAGE_SIZE',
  'STOCK_LOT_REALLOCATION_PAGE_SIZE',
  'BARCODE_PRINT_PAGE_SIZE',
  'DOC_LIST_PAGE_SIZE',
  'INVENTORY_MOVEMENT_PAGE_SIZE',
  'HISTORY_PAGE_SIZE',
  'INVENTORY_LOT_HISTORY_PAGE_SIZE',
  'LOWSTOCK_PAGE_SIZE'
];

for (const name of tenItemConstants) {
  assert.match(
    html,
    new RegExp(`const\\s+${name}\\s*=\\s*10\\s*;`),
    `${name} must display or load 10 records per page`
  );
}

assert.match(
  html,
  /const\s+AUDIT_LOG_PAGE_SIZE\s*=\s*20\s*;/,
  'Audit Log must display 20 records per page'
);

console.log('pagination page-size tests passed');
