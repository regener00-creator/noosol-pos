// Supabase/PostgREST caps SELECT results at a fixed row count per request
// (1,000 by default) unless the query is explicitly paginated with
// .range(). Every "fetch every row" query in this app was a plain
// select('*') with no range -- silently invisible until a table actually
// grew past that cap. Confirmed the hard way: products (2,800+ real rows)
// loaded into the app as only its first 1,000. This helper pages through
// in fixed-size chunks and concatenates the results, so callers always get
// every row regardless of table size. Pass a function that builds a FRESH
// query each call (not a query object itself), since .range() is chained
// onto a new builder per page.
async function fetchAllRows(buildQuery){
  const pageSize=1000;
  let from=0,allRows=[];
  while(true){
    const {data,error}=await buildQuery().range(from,from+pageSize-1);
    if(error) return {data:null,error};
    allRows=allRows.concat(data||[]);
    if(!data||data.length<pageSize) break;
    from+=pageSize;
  }
  return {data:allRows,error:null};
}

// Bounded server-side paging for history/document screens. Unlike
// fetchAllRows(), this helper deliberately stops at maxRows so opening a page
// cannot download an unbounded table into the browser. Callers also apply a
// date range whenever the table has a queryable date field.
async function fetchBoundedRows(buildQuery,{pageSize=250,maxRows=5000}={}){
  const safePageSize=Math.max(1,Math.min(1000,Number(pageSize)||250));
  const safeMaxRows=Math.max(safePageSize,Number(maxRows)||safePageSize);
  let from=0,allRows=[];
  while(allRows.length<safeMaxRows){
    const remaining=safeMaxRows-allRows.length;
    const take=Math.min(safePageSize,remaining);
    const probeExtra=remaining<=safePageSize?1:0;
    const {data,error}=await buildQuery().range(from,from+take+probeExtra-1);
    if(error) return {data:null,error,truncated:false};
    const page=data||[];
    if(page.length>take) return {data:allRows.concat(page.slice(0,take)),error:null,truncated:true};
    allRows=allRows.concat(page);
    if(page.length<take+probeExtra) return {data:allRows,error:null,truncated:false};
    from+=take;
  }
  return {data:allRows,error:null,truncated:false};
}
function normalizedServerDate(value){
  const date=String(value||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'';
}
function serverDateRange(from,to){
  const start=normalizedServerDate(from),end=normalizedServerDate(to);
  if(!start||!end) return null;
  return start<=end?{from:start,to:end}:{from:end,to:start};
}
function rangeCoveredBy(loadedRanges,range){
  if(!range) return false;
  return (loadedRanges||[]).some(item=>item.from<=range.from&&item.to>=range.to);
}
function rangeOverlapsAny(loadedRanges,range){
  if(!range) return false;
  return (loadedRanges||[]).some(item=>item.from<=range.to&&item.to>=range.from);
}
function rememberLoadedRange(loadedRanges,range){
  if(!range) return loadedRanges||[];
  const ranges=[...(loadedRanges||[]),range].sort((a,b)=>a.from.localeCompare(b.from));
  return ranges.reduce((merged,item)=>{
    const last=merged[merged.length-1];
    if(last&&item.from<=last.to){ if(item.to>last.to) last.to=item.to; }
    else merged.push({...item});
    return merged;
  },[]);
}
function offsetServerDate(value,days){
  const [year,month,date]=String(value||'').split('-').map(Number);
  const utc=new Date(Date.UTC(year,month-1,date));
  utc.setUTCDate(utc.getUTCDate()+Number(days||0));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth()+1).padStart(2,'0')}-${String(utc.getUTCDate()).padStart(2,'0')}`;
}
function forgetLoadedRange(loadedRanges,range){
  if(!range) return loadedRanges||[];
  return (loadedRanges||[]).flatMap(item=>{
    if(range.to<item.from||range.from>item.to) return [{...item}];
    const remaining=[];
    if(range.from>item.from) remaining.push({from:item.from,to:offsetServerDate(range.from,-1)});
    if(range.to<item.to) remaining.push({from:offsetServerDate(range.to,1),to:item.to});
    return remaining;
  });
}
