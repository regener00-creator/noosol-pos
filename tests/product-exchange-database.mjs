import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Real RPCs, revision checks, posting guards, LOTs and movement ledger.
// This suite runs only against the runner's disposable PostgreSQL cluster.
export async function run({client}){
  const q=(sql,args)=>client.query(sql,args);
  const owner=randomUUID(),staff=randomUUID();
  let id='EX-RECEIPT-TEST';
  await q('begin');
  try{
    await q('insert into auth.users(id) values($1),($2)',[owner,staff]);
    await q(`insert into public.profiles(id,username,owner,level) values
      ($1,'exchange-owner',true,1),($2,'exchange-staff',false,2)`,[owner,staff]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await q(`insert into public.warehouses(id,name,data) values(8300,'Exchange test','{"active":true}');
      insert into public.products(id,name,sku,unit,price,cost,warehouse_id,data)
      values(8300,'Exchange original','EX-8300','box',100,40,8300,'{"active":true}'),
            (8301,'Exchange replacement','EX-8301','box',100,40,8300,'{"active":true}');
      insert into public.inventory_lots(product_id,warehouse_id,internal_code,quantity_base,unit_cost_base)
      values(8300,8300,'EX-ORIGINAL-LOT',10,40);
      update public.inventory_balances set stock=10 where product_id=8300 and warehouse_id=8300;`);
    await q('set local role authenticated');
    const read=async()=>(await q('select * from public.product_exchanges where id=$1',[id])).rows[0];
    const save=async(data,revision,request=randomUUID())=>(await q(
      "select public.save_revisioned_document($1,'product_exchanges',$2,$3,$4,false) result",
      [request,id,data,revision])).rows[0].result;
    const post=async(status,request=randomUUID())=>(await q(
      "select public.run_stock_operation($1,'apply_product_exchange_status',$2) result",
      [request,{exchangeId:id,nextStatus:status}])).rows[0].result;
    const stock=async(pid)=>(await q('select stock::float8 as stock from public.inventory_balances where product_id=$1 and warehouse_id=8300',[pid])).rows[0].stock;
    const movements=async()=>(await q("select movement_type,quantity_delta::float8 as qty from public.inventory_lot_movements where reference_type='product_exchange' and reference_id=$1 order by id",[id])).rows;
    const rejects=async(work,pattern)=>{
      await q('savepoint rejected_exchange');
      await assert.rejects(work,pattern);
      await q('rollback to savepoint rejected_exchange');
    };
    const draft={id,date:'2026-10-20',supplier:'Test supplier',warehouseId:8300,note:'',
      status:'ร่าง',outgoingApplied:false,incomingApplied:false,
      outgoingItems:[{pid:8300,lineId:1,qty:2,factor:1,baseQty:2,unit:'box'}],incomingItems:[]};
    await save(draft,0);
    await post('ส่งไปเปลี่ยนแล้ว');
    const sent=await read();
    assert.equal(sent.data.status,'ส่งไปเปลี่ยนแล้ว');
    assert.equal(await stock(8300),8);
    const outgoing=await movements();
    assert.deepEqual(outgoing,[{movement_type:'exchange_out',qty:-2}]);

    // This is exactly the previously failing step: save incoming lines AFTER
    // the outgoing stage has already posted, before applying incoming stock.
    const incoming={...sent.data,updatedAt:new Date().toISOString(),
      incomingItems:[{pid:8301,lineId:2,qty:1,factor:1,baseQty:1,unit:'box',lotNumber:'RETURN-LOT',expiry:'2028-02-02'}],
      unreturnedItems:[{pid:8300,qty:2,baseQty:2,unit:'box'}]};
    const saved=await save(incoming,sent.revision);
    assert.equal(Number(saved.revision),Number(sent.revision)+1);
    assert.equal(await stock(8300),8);
    assert.equal(await stock(8301),0);
    assert.deepEqual(await movements(),outgoing,'saving a pending receipt cannot move stock');
    await rejects(()=>save(incoming,sent.revision),/REVISION_CONFLICT/);
    for(const field of ['warehouseId','outgoingItems','outgoingApplied','outgoingAppliedAt','incomingApplied','status','supplier','note']){
      const changes={warehouseId:999,outgoingItems:[],outgoingApplied:false,outgoingAppliedAt:'forged',incomingApplied:true,status:'ร่าง',supplier:'changed',note:'changed'};
      await rejects(()=>save({...incoming,[field]:changes[field]},saved.revision),/immutable|cannot|must/);
    }
    await q("select set_config('request.jwt.claim.sub',$1,true)",[staff]);
    await rejects(()=>save(incoming,saved.revision),/owner access required/);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);

    // The stock RPC still validates receipt data and rolls back failed posts.
    const invalid={...incoming,incomingItems:[{...incoming.incomingItems[0],expiry:''}]};
    const invalidSaved=await save(invalid,saved.revision);
    await rejects(()=>post('รับสินค้ากลับแล้ว'),/invalid incoming item/);
    assert.equal(await stock(8301),0);
    assert.deepEqual(await movements(),outgoing);
    await save(incoming,invalidSaved.revision);

    const request=randomUUID();
    const received=await post('รับสินค้ากลับแล้ว',request);
    assert.equal(received.exchange.incomingApplied,true);
    assert.equal(await stock(8300),8);
    assert.equal(await stock(8301),1);
    assert.deepEqual(await post('รับสินค้ากลับแล้ว',request),received,'retry same operation');
    await post('รับสินค้ากลับแล้ว'); // Retry with another request is also safe.
    assert.equal(await stock(8301),1);
    assert.deepEqual(await movements(),[...outgoing,{movement_type:'exchange_in',qty:1}]);
    const lot=(await q("select manufacturer_lot as lot_number,expiry_date::text,quantity_base::float8 as qty from public.inventory_lots where source_type='product_exchange' and source_id=$1",[id])).rows[0];
    assert.deepEqual(lot,{lot_number:'RETURN-LOT',expiry_date:'2028-02-02',qty:1});
    const closed=await read();
    assert.deepEqual(closed.data.outgoingItems,sent.data.outgoingItems);
    await rejects(()=>save({...closed.data,incomingItems:[]},closed.revision),/immutable/);
    await rejects(()=>q("select public.save_revisioned_document($1,'product_exchanges',$2,'{}',$3,true)",[randomUUID(),id,closed.revision]),/cannot be deleted/);
    id='EX-SAME-PRODUCT';
    await save({...draft,id},0);
    await post('ส่งไปเปลี่ยนแล้ว');
    const same=await read();
    await save({...same.data,incomingItems:[{...incoming.incomingItems[0],pid:8300,qty:2,baseQty:2}],unreturnedItems:[]},same.revision);
    await post('รับสินค้ากลับแล้ว');
    assert.equal(await stock(8300),8,'full return of the same product restores its outgoing quantity');
    assert.deepEqual(await movements(),[{movement_type:'exchange_out',qty:-2},{movement_type:'exchange_in',qty:2}]);
    console.log('DB exchange: sent → pending receipt → received, revisions, LOT/stock, retries, permissions and posted history protection passed');
  }finally{
    await q('rollback');
  }
}
