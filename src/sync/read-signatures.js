// Signatures are only hints for already-loaded request windows. Never use a
// signature alone as proof of loaded coverage, and never persist it to disk.
const dataReadSignatures=new Map();
const dataSignatureJobs=new Map();
let dataSignatureUnavailableUntil=0;
async function readVisibleDataSignature(table){
  if(Date.now()<dataSignatureUnavailableUntil||typeof sb?.rpc!=='function') return null;
  const context=captureWorkspaceRead(),key=`${context.actor}:${context.generation}:${table}`;
  if(dataSignatureJobs.has(key)) return dataSignatureJobs.get(key);
  const job=(async()=>{
    try{
      const result=await sb.rpc('get_visible_data_signature',{p_table:table});
      if(!isWorkspaceReadCurrent(context)) return null;
      if(result.error){
        // Rolling deployment/older server: use the normal read path.
        if(['PGRST202','42883'].includes(String(result.error.code))) dataSignatureUnavailableUntil=Date.now()+300000;
        return null;
      }
      return typeof result.data==='string'&&/^[a-f0-9]{32}$/.test(result.data)?result.data:null;
    }catch(_error){return null;}
    finally{dataSignatureJobs.delete(key);}
  })();
  dataSignatureJobs.set(key,job);
  return job;
}
function reuseDataReadSignature(key,signature,freshRecords){
  const previous=dataReadSignatures.get(key);
  if(!signature||previous?.signature!==signature||!freshRecords.includes(previous.marker)||!isWorkspaceReadCurrent(previous.marker.context)) return false;
  previous.marker.at=Date.now();
  return true;
}
function rememberDataReadSignature(key,signature,marker){
  dataReadSignatures.delete(key);
  if(signature&&marker) dataReadSignatures.set(key,{signature,marker});
  while(dataReadSignatures.size>64) dataReadSignatures.delete(dataReadSignatures.keys().next().value);
}
