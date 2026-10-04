import assert from 'node:assert/strict';
export async function run({client}){
  const q=(sql,args)=>client.query(sql,args);
  const owner='11111111-1111-4111-8111-111111111111';
  await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await q('begin');
  try{
    const units=[{sub:'box',base:'tablet',per:10,factor:10,price:0,cost:30},{sub:'case',base:'box',per:12,factor:120,price:900,cost:300}];
    await q('insert into public.products(id,name,unit,price,cost,data) values(94001,$1,$2,5,3,$3)',['Validation','tablet',{barcode:'CATALOG-94001',units}]);
    const reject=async(sql,args,hint='INVALID_PRODUCT_DATA')=>{
      await q('savepoint invalid_catalog');
      await assert.rejects(q(sql,args),error=>error.hint===hint);
      await q('rollback to savepoint invalid_catalog');
    };
    for(const price of [-1,'NaN','Infinity']) await reject('update public.products set price=$1 where id=94001',[price]);
    for(const patch of [{sub:''},{sub:'tablet'},{per:0},{per:-1},{per:null},{factor:0},{factor:20},{base:'missing'},{base:'case'},{cost:-1}]){
      await reject("update public.products set data=jsonb_set(data,'{units}',$1) where id=94001",[JSON.stringify([{...units[0],...patch},units[1]])]);
    }
    await reject("update public.products set data=jsonb_set(data,'{units}',$1) where id=94001",[JSON.stringify([units[0],units[0]])]);
    await reject("update public.products set data=jsonb_set(data,'{extraBarcodes}','[\"catalog-94001\"]') where id=94001",[],'DUPLICATE_PRODUCT_BARCODE');
    // Test with actual client privileges: private helpers must work, not be bypassed.
    await q('set local role authenticated');
    await q('update public.products set price=0 where id=94001');
    await reject('update public.products set price=-1 where id=94001');
    const before=(await q('select public.get_product_catalog_signature() s')).rows[0].s;
    await q('update public.products set price=1 where id=94001');
    assert.notEqual((await q('select public.get_product_catalog_signature() s')).rows[0].s,before);
    await q('reset role');
    // Nested products, promotions, leading zero ids: compare with the previous implementation.
    for(const data of [{items:[{pid:'00094001'}]},{nested:{productId:94001}},{bgdBuyProductId:94001,bgdGetProductId:1},{pid:'not-an-id'},{product_id:94001},null]){
      const result=(await q('select private.jsonb_references_product($1,94001) old,private.document_product_ids($1) @> array[\'94001\'] optimized',[data])).rows[0];
      assert.equal(result.optimized,result.old);
    }
    // Local-only benchmark. No fixtures are sent to the live database.
    await q("insert into public.quotations(id,data) select 'CATALOG-BENCH-'||i,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('pid',i))) from generate_series(100000,104999) i");
    await q('analyze public.quotations');
    const beforePlan=(await q("explain (analyze,format json) select 1 from public.quotations where private.jsonb_references_product(data,104999)")).rows[0]['QUERY PLAN'][0];
    const afterPlan=(await q("explain (analyze,format json) select 1 from public.quotations where private.document_product_ids(data) @> array['104999']")).rows[0]['QUERY PLAN'][0];
    assert.match(JSON.stringify(afterPlan),/quotations_product_refs_idx/);
    console.log('DB benchmark 5000 documents: recursive '+beforePlan['Execution Time']+' ms; indexed '+afterPlan['Execution Time']+' ms');
    console.log('DB: shared catalog guards, authenticated writes, nested reference parity, signature invalidation and indexed search passed');
  }finally{await q('rollback');}
}
