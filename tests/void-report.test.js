const assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function context(){
  const c=vm.createContext({console,Date,Intl,Map,Set,Number,String,JSON,Promise,TODAY_STR:'2026-10-30',salesHistory:[],cart:[],currentProfile:{id:'owner'},
    voidReportFilter:{from:'2026-10-30',to:'2026-10-30',warehouse:'all',method:'all',search:'',page:1},reportWarehouseIds:()=>[1],
    maxArrayValue:()=>1000,DOC_TABLES:[],resetDocumentLoadStates:()=>{},onDemandTabErrors:new Map(),onDemandTabJobs:new Map()});
  vm.runInContext(read('src/sync/read-signatures.js')+'\n'+read('src/data/pagination.js')+'\n'+read('src/sync/sales-history.js')+'\n'+read('src/reports/void-sales.js')+'\n'+read('src/inventory/movement.js'),c);
  const documents=read('src/sync/documents.js');vm.runInContext(documents.slice(documents.indexOf('function mergeRowsById('),documents.indexOf('\n}',documents.indexOf('function mergeRowsById('))+2),c);
  return c;
}
const cancelled={id:'OLD',ref:'RE-OLD',status:'void',date:'2026-09-01',time:'2026-09-01 09:10',warehouseId:1,total:200,payMethod:'โอนธนาคาร',voidRefundMethod:'เงินสด',voidedAt:'2026-10-29 18:30:00.123456+00',voidReason:'ผิดรายการ',voidedByName:'เจ้าของ',items:[{productId:1,name:'เดิม',qty:2,unit:'แผง',tracksStock:true}]};
test('cancellation time uses Bangkok day for PostgreSQL and ISO timestamps',()=>{
  const c=context();
  assert.equal(c.saleVoidDateTime(cancelled).date,'2026-10-30');assert.equal(c.saleVoidDateTime(cancelled).time,'01:30');
  assert.equal(c.saleVoidDateTime({voidedAt:'2026-10-29T18:30:00Z'}).date,'2026-10-30');
  assert.equal(c.saleVoidDateTime({voidedAt:'2026-10-30 01:30:00'}).time,'01:30');
  assert.equal(c.saleVoidDateTime({voidedAt:'bad'}).date,'');assert.equal(c.saleVoidDateTime({}).date,'');
});
test('report filters cancellation date, permission and search; obsolete refund filter cannot hide bills',()=>{
  const c=context();c.salesHistory=[cancelled,{...cancelled,id:'other-wh',warehouseId:2},{...cancelled,id:'done',status:'done'},{...cancelled,id:'old',voidedAt:'2026-09-01T01:00:00Z'}];
  assert.deepEqual(Array.from(c.voidReportRows(),s=>s.id),['OLD']);
  c.voidReportFilter.method='โอนธนาคาร';assert.equal(c.voidReportRows().length,1);
  c.voidReportFilter.method='เงินสด';c.voidReportFilter.search='ผิดรายการ';assert.equal(c.voidReportRows().length,1);
});
test('void movement keeps sale outflow and cancellation inflow on their own dates, including retired products',()=>{
  const c=context();const rows=c.collectInventoryMovements({sales:[{...cancelled,items:[...cancelled.items,{productId:2,name:'บริการ',qty:1,tracksStock:false},{productId:3,name:'กำหนดเอง',qty:1,custom:true}]},{...cancelled,id:'held',status:'hold'}],products:[],warehouses:[{id:1,name:'คลังเดิม'}]});
  assert.equal(rows.length,2);
  assert.deepEqual(Array.from(rows,r=>[r.date,r.type,r.direction,r.qty,r.warehouseId]),[['2026-10-30','คืนสต๊อกจากยกเลิกบิล','เข้า',2,1],['2026-09-01','ขาย','ออก',2,1]]);
  assert.equal(c.filterInventoryMovements(rows,{type:'all'}, {from:'2026-10-30',to:'2026-10-30'}).length,1);
});
test('range loader includes older sales cancelled now, merges once, caches separately and blocks incomplete totals',async()=>{
  const c=context(),queries=[];
  c.sb={from:table=>{const query={table,filters:[],select(){return this;},order(){return this;},eq(...args){this.filters.push(['eq',...args]);return this;},gte(...args){this.filters.push(['gte',...args]);return this;},lte(...args){this.filters.push(['lte',...args]);return this;},lt(...args){this.filters.push(['lt',...args]);return this;}};return query;}};
  let truncated=false;
  c.fetchBoundedRows=async build=>{const query=build();queries.push(query);return {data:query.filters.some(f=>f[2]==='void')?[{id:cancelled.id,sale_date:cancelled.date,status:'void',data:cancelled}]:[],truncated:query.filters.some(f=>f[2]==='void')&&truncated};};
  const range={from:'2026-10-30',to:'2026-10-30'},options={...range,includeHolds:false,includeRecent:false};
  await c.loadSalesHistoryFromSupabase(options);assert.equal(c.salesRequestLoaded({range,includeVoids:true}),false);
  await c.loadSalesHistoryFromSupabase({...options,includeVoids:true});assert.equal(c.salesHistory.length,1);assert.equal(c.salesHistory[0].id,'OLD');
  assert.equal(c.salesRequestLoaded({range,includeVoids:true}),true);
  assert.ok(queries.some(q=>q.filters.some(f=>f[1]==='data->>voidedAt'&&f[2]==='2026-10-29')));
  const count=queries.length;await c.loadSalesHistoryFromSupabase({...options,includeVoids:true});assert.equal(queries.length,count);
  truncated=true;await c.loadSalesHistoryFromSupabase({...options,includeVoids:true,force:true});assert.equal(c.salesRequestTruncated({range,includeVoids:true}),true);
  c.fetchAllRows=c.fetchBoundedRows;truncated=false;
  await c.loadSalesHistoryFromSupabase({...options,completeRange:true});assert.equal(c.salesRequestTruncated({range,includeVoids:true}),true,'ordinary sale refresh cannot mark truncated void history complete');
  await c.loadSalesHistoryFromSupabase({...options,includeVoids:true,completeRange:true});assert.equal(c.salesRequestTruncated({range,includeVoids:true}),false);assert.equal(c.salesHistory.length,1);
  c.resetSalesLoadState();queries.length=0;
  await c.loadSalesHistoryFromSupabase({...options,includeVoids:true,voidsOnly:true});
  assert.equal(queries.length,1,'void report fetches only cancellations, not every sale in the month');
  assert.equal(c.salesRequestLoaded({range,includeVoids:true,voidsOnly:true}),true);
  assert.equal(c.salesRequestLoaded({range}),false,'cancellation-only cache cannot stand in for ordinary sales');
  assert.equal(c.salesRequestLoaded({range,includeVoids:true}),false,'movement also needs the original sale outflows');
});
