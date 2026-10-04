// ----- Sales history sync -----
// Posted sales intentionally keep an immutable document body in `data` for
// reprints, voids, and audits. The flat columns are reporting indexes, while
// the JSON body remains the authoritative historic document and is therefore
// not treated like duplicate mutable master data.
function saleToRow(s){
  let saleTime=null;
  if(s.time){ const d=new Date(String(s.time).replace(' ','T')); if(!isNaN(d.getTime())) saleTime=d.toISOString(); }
  const memberName=s.member?(typeof s.member==='object'?(s.member.name||''):String(s.member)):null;
  return { id:s.id, ref:s.ref||null, sale_date:s.date||null, sale_time:saleTime, cashier:s.cashier||null, member:memberName, status:s.status||'done', pay_method:s.payMethod||null, discount:Number(s.discount)||0, vat:Number(s.vat)||0, fee:Number(s.fee)||0, cost_total:Number(s.costTotal)||0, gross_profit:Number(s.grossProfit)||0, cash_received:Number(s.cashReceived)||0, cash_change:Number(s.cashChange)||0, total:Number(s.total)||0, data:s };
}
function rowToSale(row){
  const fallback={
    id:row.id,ref:row.ref||'',date:row.sale_date||'',time:row.sale_time||'',cashier:row.cashier||'',member:row.member||null,
    status:row.status||'done',payMethod:row.pay_method||'',discount:Number(row.discount)||0,vat:Number(row.vat)||0,
    fee:Number(row.fee)||0,costTotal:Number(row.cost_total)||0,grossProfit:Number(row.gross_profit)||0,
    cashReceived:Number(row.cash_received)||0,cashChange:Number(row.cash_change)||0,total:Number(row.total)||0,
    cashShiftId:row.cash_shift_id||'',voidShiftId:row.void_shift_id||'',
  };
  return {...fallback,...(row.data||{}),id:row.id};
}

const SALES_QUERY_PAGE_SIZE=500;
const SALES_QUERY_MAX_ROWS=5000;
const salesLoadState={loaded:false,full:false,holds:false,recent:false,ranges:[],truncatedRanges:[],holdsTruncated:false};
const salesLoadPromises=new Map();
function resetSalesLoadState(){
  salesLoadState.loaded=false; salesLoadState.full=false; salesLoadState.holds=false; salesLoadState.recent=false; salesLoadState.ranges=[]; salesLoadState.truncatedRanges=[]; salesLoadState.holdsTruncated=false;
  salesLoadPromises.clear();
}
function clearLoadedHistoryMemory(){
  salesHistory=[];
  DOC_TABLES.forEach(([_table,_getArr,setArr])=>setArr([]));
  resetSalesLoadState(); resetDocumentLoadStates();
  onDemandTabErrors.clear(); onDemandTabJobs.clear();
}
function salesRequestLoaded({range=null,includeHolds=false,includeRecent=false,full=false}={}){
  if(salesLoadState.full) return true;
  if(full) return false;
  return (!range||rangeCoveredBy(salesLoadState.ranges,range))&&(!includeHolds||salesLoadState.holds)&&(!includeRecent||salesLoadState.recent);
}
function salesRequestTruncated({range=null,includeHolds=false}={}){
  if(salesLoadState.full) return false;
  return !!(range&&rangeOverlapsAny(salesLoadState.truncatedRanges,range))||!!(includeHolds&&salesLoadState.holdsTruncated);
}
function mergeSalesRows(current,incoming){
  const rows=new Map((current||[]).map(sale=>[String(sale.id),sale]));
  (incoming||[]).forEach(sale=>rows.set(String(sale.id),sale));
  return [...rows.values()].sort((a,b)=>{
    const dateCompare=String(b.date||'').localeCompare(String(a.date||''));
    return dateCompare||String(b.time||b.id||'').localeCompare(String(a.time||a.id||''));
  });
}
async function loadSalesHistoryFromSupabase(options={}){
  const defaultRange=serverDateRange(`${TODAY_STR.slice(0,7)}-01`,TODAY_STR);
  const range=options.full?null:serverDateRange(options.from||defaultRange?.from,options.to||defaultRange?.to);
  const includeHolds=options.includeHolds!==false;
  const includeRecent=options.includeRecent!==false;
  const full=options.full===true;
  const completeRange=options.completeRange===true&&!!range;
  const request={range,includeHolds,includeRecent,full};
  if(!completeRange&&salesRequestLoaded(request)) return true;
  const requestKey=full?'full':`${completeRange?'complete:':''}${range?.from||''}:${range?.to||''}:${includeHolds?'holds':'sales'}:${includeRecent?'recent':'range-only'}`;
  if(salesLoadPromises.has(requestKey)) return salesLoadPromises.get(requestKey);
  const promise=(async()=>{
    try{
      const buildRangeQuery=()=>{
        let query=sb.from('sales').select('*').order('sale_date',{ascending:false}).order('sale_time',{ascending:false});
        if(range) query=query.gte('sale_date',range.from).lte('sale_date',range.to);
        return query;
      };
      const result=full||completeRange
        ?await fetchAllRows(buildRangeQuery)
        :await fetchBoundedRows(buildRangeQuery,{pageSize:SALES_QUERY_PAGE_SIZE,maxRows:SALES_QUERY_MAX_ROWS});
      if(result.error) throw result.error;
      let rows=result.data||[];
      let holdsTruncated=false;
      if(includeRecent&&!full&&!salesLoadState.recent){
        const {data:recentRows,error:recentError}=await sb.from('sales').select('*').eq('status','done').order('sale_date',{ascending:false}).order('sale_time',{ascending:false}).limit(8);
        if(recentError) throw recentError;
        rows=mergeRowsById(rows,recentRows||[]);
        salesLoadState.recent=true;
      }
      if(includeHolds&&!full&&(!salesLoadState.holds||(completeRange&&salesLoadState.holdsTruncated))){
        const heldQuery=()=>sb.from('sales').select('*').eq('status','hold').order('sale_date',{ascending:false}).order('sale_time',{ascending:false});
        const heldResult=completeRange?await fetchAllRows(heldQuery):await fetchBoundedRows(heldQuery,{pageSize:250,maxRows:1000});
        if(heldResult.error) throw heldResult.error;
        rows=mergeRowsById(rows,heldResult.data||[]);
        holdsTruncated=!!heldResult.truncated;
        salesLoadState.holds=true;
        if(completeRange) salesLoadState.holdsTruncated=false;
      }
      const incoming=rows.map(rowToSale);
      salesHistory=full||!salesLoadState.loaded?incoming:mergeSalesRows(salesHistory,incoming);
      salesHistory=mergeSalesRows([],salesHistory);
      salesLoadState.loaded=true;
      salesLoadState.full=full;
      if(range) salesLoadState.ranges=rememberLoadedRange(salesLoadState.ranges,range);
      if(full){ salesLoadState.holds=true; salesLoadState.recent=true; }
      if(full){ salesLoadState.truncatedRanges=[]; salesLoadState.holdsTruncated=false; }
      else if(completeRange){ salesLoadState.truncatedRanges=forgetLoadedRange(salesLoadState.truncatedRanges,range); }
      else{
        if(result.truncated&&range) salesLoadState.truncatedRanges=rememberLoadedRange(salesLoadState.truncatedRanges,range);
        if(holdsTruncated) salesLoadState.holdsTruncated=true;
      }
      invoiceCounter=maxArrayValue(salesHistory,s=>(Number(String(s.id||'').replace(/\D/g,''))||0)+1,1000);
      if(typeof saleRef!=='undefined'&&!cart.length) saleRef=nextSaleRef();
      return true;
    }catch(error){
      console.warn('load sales failed',error);
      throw error;
    }finally{ salesLoadPromises.delete(requestKey); }
  })();
  salesLoadPromises.set(requestKey,promise);
  return promise;
}
async function findSaleByIdentifier(identifier){
  const raw=String(identifier||'').trim();
  if(!raw) return null;
  const needle=raw.toLowerCase();
  const local=salesHistory.find(item=>[item.id,item.ref,item.shortReceiptMeta?.number,item.cashReceiptA4Meta?.number].some(value=>String(value||'').trim().toLowerCase()===needle));
  if(local) return local;
  const candidates=[
    ['id',raw],['id',raw.toUpperCase()],['ref',raw],['ref',raw.toUpperCase()],
    ['data->shortReceiptMeta->>number',raw],['data->cashReceiptA4Meta->>number',raw],
  ];
  for(const [column,value] of candidates){
    const {data,error}=await sb.from('sales').select('*').eq(column,value).limit(1);
    if(error) throw error;
    if(data?.[0]){
      const sale=rowToSale(data[0]);
      salesHistory=mergeSalesRows(salesHistory,[sale]);
      salesLoadState.loaded=true;
      return sale;
    }
  }
  return null;
}

function normalizeCashShiftRow(row){
  if(!row) return null;
  return {
    id:String(row.id||''),shiftNo:String(row.shift_no||''),warehouseId:Number(row.warehouse_id)||0,
    openedBy:String(row.opened_by||''),openedByName:String(row.opened_by_name||''),openedAt:String(row.opened_at||''),
    openingCash:Number(row.opening_cash)||0,status:row.status==='closed'?'closed':'open',
    closedBy:String(row.closed_by||''),closedByName:String(row.closed_by_name||''),closedAt:String(row.closed_at||''),
    grossSales:Number(row.gross_sales)||0,refunds:Number(row.refunds)||0,netSales:Number(row.net_sales)||0,
    cashSales:Number(row.cash_sales)||0,cashRefunds:Number(row.cash_refunds)||0,expectedCash:Number(row.expected_cash)||0,
    countedCash:row.counted_cash===null?null:Number(row.counted_cash)||0,variance:row.variance===null?null:Number(row.variance)||0,
    saleCount:Number(row.sale_count)||0,refundCount:Number(row.refund_count)||0,
    paymentSummary:row.payment_summary&&typeof row.payment_summary==='object'?row.payment_summary:{},closeReason:String(row.close_reason||'')
  };
}
async function loadCashShiftsFromSupabase(){
  if(!currentProfile||!activeWarehouseId||isAllWarehousesMode()){
    cashShifts=[]; currentCashShift=null; return false;
  }
  try{
    const {data,error}=await sb.from('cash_shifts').select('*').eq('warehouse_id',Number(activeWarehouseId)).order('opened_at',{ascending:false}).limit(100);
    if(error) throw error;
    cashShifts=(data||[]).map(normalizeCashShiftRow).filter(Boolean);
    currentCashShift=cashShifts.find(shift=>shift.status==='open'&&shift.openedBy===String(currentProfile.id))||null;
    return true;
  }catch(error){
    console.warn('load cash shifts failed',error);
    cashShifts=[]; currentCashShift=null; return false;
  }
}
async function loadWorkspaceFromSupabase(){
  await loadWorkspaceRecoveryForUser();
  await adoptRemoteMaintenanceEpoch();
  await Promise.all([
    loadCoreDataFromSupabase(),loadSalesHistoryFromSupabase(),loadBusinessSettingsFromSupabase(),
    loadDocumentPrefixesFromSupabase(),loadInspectionListsFromSupabase(),loadPromotionsFromSupabase(),loadFavoritesFromSupabase()
  ]);
  await loadCashShiftsFromSupabase();
  mobileLastRefreshAt=Date.now();
}
