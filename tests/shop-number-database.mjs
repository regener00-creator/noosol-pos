import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// This suite owns the disposable database's final fixtures.
export async function run({client,connect}){
  const owner=(await client.query('select id from public.profiles where owner limit 1')).rows[0].id;
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await client.query("insert into public.warehouses(id,name) values(1,'A'),(2,'B') on conflict do nothing");
  const devices=await Promise.all([connect(),connect()]);
  try{
    for(const c of devices) await c.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const issue=async(c,w,kind,id=randomUUID())=>(await c.query('select public.reserve_shop_document_number($1,$2,$3) n',[w,kind,id])).rows[0].n;
    const date=(await client.query("select to_char(now() at time zone 'Asia/Bangkok','YYYYMMDD') d")).rows[0].d;
    for(const [kind,prefix] of Object.entries({inspection:'CHECK',quotation:'QT',shortage:'SH',goodsReceipt:'RI',productReturn:'RT',productExchange:'EX',transfer:'TF',taxInvoice:'INV'})){
      for(const [w,letter] of [[1,'A'],[2,'B']]){
        const token=randomUUID();
        const [first,retry]=await Promise.all(devices.map(c=>issue(c,w,kind,token)));
        assert.equal(first,retry);
        assert.match(first,new RegExp('^'+letter+prefix+date+'[0-9]{4,}$'));
        if(kind==='quotation'){
          const following=await Promise.all(devices.map(c=>issue(c,w,kind)));
          assert.equal(new Set(following).size,2);
          assert.deepEqual(following.map(s=>Number(s.slice(-4))).sort(),[Number(first.slice(-4))+1,Number(first.slice(-4))+2]);
        }
      }
    }
    // Seed an older numeric code in each store; issuance must continue independently.
    const add=async(c,w,id,code)=>(await c.query("insert into public.contacts(id,warehouse_id,name,type,data) values($1,$2,'Number test','both',$3) returning data->>'code' code",[id,w,code?{code}:{_autoCode:true}])).rows[0].code;
    for(const [w,letter] of [[1,'A'],[2,'B']]){
      assert.equal(await add(client,w,7490000+w,'C0156'),letter+'C0156');
      const base=7490020+w*10;
      const codes=await Promise.all(devices.map((c,i)=>add(c,w,base+i)));
      assert.deepEqual(codes.sort(),[letter+'C0157',letter+'C0158']);
      if(!(await client.query("select id from public.cash_shifts where warehouse_id=$1 and opened_by=$2 and status='open'",[w,owner])).rowCount)
        await client.query('select public.open_cash_shift($1,0)',[w]);
      const checkout={total:10,discount:0,fee:0,vat:0,costTotal:10,cashReceived:10,cashChange:0,payMethod:'เงินสด'};
      const items=[{lineKey:'1',custom:true,name:'Test',qty:1,unit:'Pcs',price:10,lineTotal:10,lineTotalGross:10}];
      const posReq=randomUUID();
      const pay=async c=>(await c.query("select public.complete_sale($1,'RE',$2,$3,$4,null) r",[posReq,w,checkout,JSON.stringify(items)])).rows[0].r.sale;
      const receipts=await Promise.all(devices.map(pay));
      assert.equal(receipts[0].id,receipts[1].id);
      assert.match(receipts[0].ref,new RegExp('^'+letter+'RE'));
      await client.query('insert into public.sales(id,ref,status,data) values($1,$2,\'done\',$3)', ['legacy-'+w,'OLD-BILL-'+w,{warehouseId:w}]);
      const update=async(c,key,value)=>(await c.query('select public.update_sale_document_metadata($1,$2) d',['legacy-'+w,{[key]:value}])).rows[0].d[key];
      const [one,two]=await Promise.all(devices.map(c=>update(c,'cashReceiptA4Meta',{number:'guessed'})));
      assert.equal(one.number,two.number);assert.match(one.number,new RegExp('^'+letter+'CB'));
      const tax=await update(client,'fullTaxInvoice',{number:'guessed'});
      assert.match(tax.number,new RegExp('^'+letter+'INV'));assert.notEqual(tax.number,await issue(client,w,'taxInvoice'));
      assert.equal((await update(client,'shortReceiptMeta',{number:'wrong'})).number,'OLD-BILL-'+w);
      const holdReq=randomUUID(),hold={id:'',ref:'wrong',warehouseId:w,holdRequestId:holdReq,status:'hold',items:[{name:'x',qty:1}]};
      const held=await Promise.all(devices.map(c=>c.query('select public.save_held_sale($1) d',[hold])));
      assert.equal(held[0].rows[0].d.id,held[1].rows[0].d.id);
      assert.match(held[0].rows[0].d.ref,new RegExp('^'+letter+'HOLD'));
      const shift=(await client.query('select private.next_cash_shift_number($1,current_date) n',[w])).rows[0].n;
      assert.match(shift,new RegExp('^'+letter+'CS'));
      const backup=(await client.query('select public.export_store_backup($1) b',[w])).rows[0].b;
      assert.equal(backup.shopLetterNumbering,true);
      assert.ok(backup.numberState.counters.length);
      const orderReq=randomUUID();
      const order=await issue(client,w,'quotation',orderReq);
      await client.query('set role authenticated');
      await client.query("insert into public.quotations(id,data) values($1,$2)",[order,{warehouseId:w,date}]);
      await assert.rejects(client.query("insert into public.quotations(id,data) values($1,$2)",['invented-'+w,{warehouseId:w,date}]),/เลขเอกสาร/);
      await assert.rejects(client.query("insert into public.quotations(id,data) values($1,$2)",[await issue(client,w===1?2:1,'quotation'),{warehouseId:w,date}]),/เลขเอกสาร/);
      await client.query('reset role');
      const restored=(await client.query('select public.export_store_backup($1) b',[w])).rows[0].b;
      await client.query('select public.restore_store_backup_atomic($1,$2)',[w,restored]);
      assert.equal(await issue(client,w,'quotation',orderReq),order);
      assert.equal((await client.query('select ref from public.sales where id=$1',['legacy-'+w])).rows[0].ref,'OLD-BILL-'+w);
    }
    console.log('A/B numbering: independent contacts, all draft types, concurrent reservations, retries, holds, shared invoice series and historic receipts passed');
  }finally{await Promise.all(devices.map(c=>c.end()));}
}
