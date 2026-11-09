import assert from 'node:assert/strict';

export async function run({client,connect}){
  const id=991049;
  await client.query("insert into public.warehouses(id,name) values($1,'Short LOT test')",[id]);
  await client.query("insert into public.products(id,warehouse_id,name,sku,unit,data) values($1,$1,'LOT test','SHORT-LOT','box','{}')",[id]);
  const issue=(db,source)=>db.query("select private.create_inventory_lot($1,$1,4,'MANUFACTURER-12345',null,0,'receipt',$2,'1') as id",[id,source]).then(r=>r.rows[0].id);
  const peers=await Promise.all([connect(),connect()]);
  try{
    const [a,b]=await Promise.all(peers.map((db,i)=>issue(db,'short-lot-'+i)));
    const retries=await Promise.all(peers.map(db=>issue(db,'short-lot-retry')));
    assert.equal(retries[0],retries[1]);
    const shortage=()=>client.query('select private.ensure_inventory_shortage_lot($1,$1) as id',[id]).then(r=>r.rows[0].id);
    const short=await shortage();assert.equal(await shortage(),short);
    const {rows}=await client.query('select internal_code,manufacturer_lot from public.inventory_lots where id=any($1::bigint[])',[[a,b,retries[0],short]]);
    assert.equal(new Set(rows.map(row=>row.internal_code)).size,4);
    for(const row of rows)assert.match(row.internal_code,/^[0-9A-F]{6}$/);
    assert.equal(rows.filter(row=>row.manufacturer_lot==='MANUFACTURER-12345').length,3);
    const {rows:[{next}]}=await client.query("select last_value+1 as next from private.inventory_lot_code_number");
    const reserved=Number(next).toString(16).toUpperCase().padStart(6,'0');
    await client.query('insert into public.inventory_lots(product_id,warehouse_id,internal_code) values($1,$1,$2)',[id,reserved]);
    const generated=await issue(client,'short-lot-after-restore');
    const {rows:[row]}=await client.query('select internal_code from public.inventory_lots where id=$1',[generated]);
    assert.notEqual(row.internal_code,reserved);
  }finally{await Promise.all(peers.map(db=>db.end()));}
}
