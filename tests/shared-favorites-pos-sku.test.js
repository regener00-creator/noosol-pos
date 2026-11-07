const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = require("./load-app-source")();
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260827034723_shared_favorites.sql'), 'utf8');

assert.match(html, /upsert\(rows,\{onConflict:'product_id'\}\)/);
assert.match(html, /previous\.map\(entry=>entry\.pid\)\.filter\(id=>storeIds\.has\(id\)/);
assert.doesNotMatch(html, /from\('favorites'\)\.select\('product_id'\)\.eq\('user_id'/);
assert.match(html, /from\('favorites'\)\.delete\(\)\.in\('product_id',del\)/);
assert.match(html, /products!inner\(warehouse_id\)[\s\S]*?query\.eq\('products.warehouse_id',context.store\)/);

assert.match(migration, /primary key \(product_id\)/i);
assert.match(migration, /create policy favorites_shared_rows[\s\S]*for all to authenticated[\s\S]*using \(true\)/i);
assert.match(migration, /with check \(\(select auth\.uid\(\)\)=user_id\)/i);
assert.match(migration, /duplicate_rank>1/);

assert.match(html, /<th>รายการที่<\/th><th>บาร์โค้ดสินค้า<\/th><th>ชื่อ<\/th>/);
assert.match(html, /<col class="pt-idx"><col class="pt-barcode"><col class="pt-name">/);
assert.match(html, /<td class="mono">\$\{escapeHtml\(productBarcodeForUnit\(p,line\.unit\)\|\|'-'\)\}<\/td>/);
assert.match(html, /colspan="8" class="pos-empty"/);

console.log('shared favorites and POS SKU tests passed');
require('node:test')('saving favorites updates and removes only products of the selected store',async()=>{
  const start=html.indexOf('async function syncFavoritesToSupabase()'),end=html.indexOf('async function loadFavoritesFromSupabase()',start);
  for(const [store,local,other] of [[1,100,200],[2,200,100]]){
    const upserts=[],deletes=[];
    const context={currentProfile:{id:'owner'},activeWarehouseId:store,products:[{id:local},{id:local+1}],favorites:[{pid:local+1},{pid:other}],
      captureStoreView:()=>({store}),isAllWarehousesMode:()=>false,isStoreViewCurrent:()=>true,normalizeFavorites:rows=>rows,
      lastSyncedSnapshot:{favorites:JSON.stringify([{pid:local},{pid:other}])},
      sb:{from:()=>({upsert:async rows=>{upserts.push(...rows);return {};},delete:()=>({in:async(_column,ids)=>{deletes.push(...ids);return {};}})})}};
    await require('node:vm').runInNewContext(html.slice(start,end)+'\nsyncFavoritesToSupabase()',context);
    assert.deepEqual(upserts.map(row=>row.product_id),[local+1]);
    assert.deepEqual(deletes,[local]);
  }
});
