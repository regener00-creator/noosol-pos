const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('./load-app-source')();
const product={id:1,sku:'0001',barcode:'001234567890',name:'Alpha',unit:'เม็ด',price:5,cost:2,units:[{sub:'กล่อง',factor:100},{sub:'แผง',factor:10}]};
const balances={1:237,2:0,3:-12};
const context={
  stockReportItems:[{pid:1,name:'Old name',unit:'เม็ด'},{pid:2,name:'Beta',unit:'ขวด'},{pid:3,name:'Gamma',unit:'เม็ด'}],
  stockReportColumns:{price:true,cost:true},stockReportTableFilter:{name:'',stock:'all'},stockReportSort:{key:'name',dir:1},
  stockReportCatFilter:{wh:'1',category:'',brand:''},activeWarehouseId:1,
  products:[product,{id:2,name:'Beta',unit:'ขวด',price:50,cost:30},{id:3,name:'Gamma',unit:'เม็ด',price:10,cost:3}],
  categories:[],brands:[],
  isLevel2User:()=>false,isAllWarehousesMode:()=>false,
  accessibleWarehouses:()=>[{id:1,name:'สาขา A'},{id:2,name:'สาขา B'}],
  warehouseStock:(pid,wid)=>wid===1?balances[pid]:3,
  reportStock:(pid,wh)=>balances[pid]+(wh==='all'?3:0),
  fmtMoney:value=>(Number(value)||0).toFixed(2),productUnitCost:p=>p.cost,
  escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function stockReportProductMatchesFilter('),source.indexOf('function renderBusinessSettings(')),context);

assert.equal(context.stockReportProductMatchesFilter({wh:2,category:'ยา',brand:'A'},{wh:'1',category:'',brand:''}),true,'warehouse selects balance, never hides catalogue products');
assert.equal(context.stockReportProductMatchesFilter({category:'ยา',brand:'A'},{category:'อาหาร',brand:''}),false);

assert.equal(context.stockReportQuantityText(product,237),'2 กล่อง 3 แผง 7 เม็ด');
assert.equal(context.stockReportQuantityText(product,200),'2 กล่อง');
assert.equal(context.stockReportQuantityText(product,0),'0 เม็ด');
assert.equal(context.stockReportQuantityText(product,-237),'-2 กล่อง -3 แผง -7 เม็ด');
assert.equal(context.stockReportQuantityText(product,237.5),'2 กล่อง 3 แผง 7.5 เม็ด');
assert.equal(context.stockReportQuantityText({unit:'กล่อง',units:[{sub:'เม็ด',factor:.01},{sub:'แผง',factor:.1}]},1.27),'1 กล่อง 2 แผง 7 เม็ด','base unit can be larger than subunits');
assert.equal(context.stockReportQuantityText({unit:'ขวด'},3.25),'3.25 ขวด');
assert.equal(context.stockReportQuantityText({unit:'ขวด',units:[{sub:'ผิด',factor:0},{sub:'ผิด',factor:Infinity}]},3),'3 ขวด');
assert.equal(context.stockReportQuantityText({unit:'กล่อง',units:[{sub:'แผง',factor:.1}]},.3),'3 แผง','no floating-point remainder');
assert.equal(context.stockReportQuantityText(product,NaN),'-');

const ids=()=>Array.from(context.stockReportSortedItems(),row=>row.pid);
assert.deepEqual(ids(),[1,2,3],'uses live product names');
context.stockReportSort={key:'stock',dir:1};assert.deepEqual(ids(),[3,2,1]);
context.stockReportSort.dir=-1;assert.deepEqual(ids(),[1,2,3]);
context.stockReportTableFilter.name=' ALP ';assert.deepEqual(ids(),[1]);
context.stockReportTableFilter.name='';
for(const [mode,expected] of [['positive',[1]],['zero',[2]],['negative',[3]]]){
  context.stockReportTableFilter.stock=mode;assert.deepEqual(ids(),expected);
}
context.stockReportTableFilter={name:'Beta',stock:'positive'};assert.deepEqual(ids(),[],'filters intersect');
assert.match(context.stockReportRowsHtml(),/colspan="7".*ไม่พบสินค้าตามตัวกรอง/);
context.stockReportTableFilter={name:'',stock:'all'};
let headers=context.stockReportHeadersHtml(true);
assert.equal(headers,'<tr><th>รหัสสินค้า</th><th>บาร์โค้ด</th><th>สินค้า</th><th>ขาย</th><th>ทุน</th><th>คงเหลือ</th></tr>');
let rows=context.stockReportRowsHtml();
assert.match(rows,/>0001<\/td>.*>001234567890<\/td>.*>Alpha<\/td>/);
assert.match(rows,/>5.00<small>บาท \/ เม็ด<\/small>/);
assert.match(rows,/>2.00<small>บาท \/ เม็ด<\/small>/);
assert.match(rows,/>2 กล่อง 3 แผง 7 เม็ด<\/td>/);
assert.doesNotMatch(context.stockReportRowsHtml(true),/data-sr-remove/,'print omits interactive controls');
context.stockReportColumns.price=false;context.stockReportColumns.cost=false;
assert.doesNotMatch(context.stockReportHeadersHtml(true),/>ขาย<|>ทุน</);
assert.doesNotMatch(context.stockReportRowsHtml(),/stock-report-price/);
context.stockReportColumns.cost=true;context.isLevel2User=()=>true;
assert.doesNotMatch(context.stockReportHeadersHtml(true),/>ทุน</,'staff cannot reveal costs');
assert.doesNotMatch(context.renderRInventory(),/id="srShowCost"/);
assert.doesNotMatch(context.stockReportRowsHtml(true),/stock-report-price/,'print also honors cost permissions');
context.isLevel2User=()=>false;context.stockReportColumns.price=true;
context.stockReportCatFilter.wh='all';
rows=context.stockReportRowsHtml();headers=context.stockReportHeadersHtml();
assert.match(headers,/colspan="2"/);assert.match(headers,/คลังที่ 1.*สาขา A.*คลังที่ 2.*สาขา B/);
assert.match(rows,/>2 กล่อง 3 แผง 7 เม็ด<\/td><td[^>]*>3 เม็ด<\/td>/,'shows per-warehouse balances');
assert.doesNotMatch(rows,/>2 กล่อง 4 แผง<\/td>/,'does not replace each warehouse with total');
context.stockReportTableFilter.stock='positive';assert.deepEqual(ids(),[1,2],'all-warehouse filter uses total');
context.stockReportTableFilter.name='<script>';assert.match(context.stockReportHeadersHtml(),/value="&lt;script>"/);
assert.deepEqual(context.stockReportItems.map(row=>row.pid),[1,2,3],'filtering and sorting never mutate selections');
assert.match(source,/const rowsHtml=stockReportRowsHtml\(true\)/,'print shares current filtered rows');
assert.match(source,/stockReportHeadersHtml\(true\)/,'print shares visible columns');
console.log('inventory report tests passed: columns, filters, sorting, permissions, warehouse balances, largest units and fractions');
