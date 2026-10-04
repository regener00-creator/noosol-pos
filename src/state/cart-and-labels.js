let cart = []; // แต่ละบิลเป็น array ของบรรทัด: {lineId, pid, unit, unitName, price, cost, factor, qty}
let pendingQty = 1; // จำนวนที่ล็อกไว้ล่วงหน้า (พิมพ์ *10 ในช่องค้นหา)
const POS_SMALLEST_UNIT_COMMAND='PEPOS-CMD-SMALLEST';
let posSmallestUnitOnce=false;
let lineCounter = 1;
const MEDICINE_LABEL_SIZE_STORAGE_KEY='pepos_medicine_label_size';
const MEDICINE_LABEL_LOGO_PATH='sapuri-pharmacy-logo.webp';
const MEDICINE_LABEL_SIZES={
  '80x50':{width:80,height:50,label:'80 × 50 มม. (แนะนำ)'},
  '60x40':{width:60,height:40,label:'60 × 40 มม. (กะทัดรัด)'},
};
const MEDICINE_LABEL_DOSE_UNITS=['เม็ด','แคปซูล','ช้อนชา','ช้อนโต๊ะ','มิลลิลิตร','หยด','ซอง','พัฟ','ครั้ง'];
const MEDICINE_LABEL_TIME_OPTIONS=[
  {value:'morning',label:'เช้า'},
  {value:'noon',label:'กลางวัน'},
  {value:'evening',label:'เย็น'},
  {value:'bedtime',label:'ก่อนนอน'},
];
const MEDICINE_LABEL_MEAL_OPTIONS=[
  {value:'before',label:'ก่อนอาหาร'},
  {value:'after',label:'หลังอาหาร'},
  {value:'with_food',label:'พร้อมอาหาร'},
  {value:'empty_stomach',label:'ขณะท้องว่าง'},
];
async function saveRevisionedDocument(table,doc,{remove=false,expectedRevision=null}={}){
  const row=docToRow(doc),revision=expectedRevision===null?row.revision:Number(expectedRevision)||0;
  const recoveryKey=`${table}:${row.id}`;
  const live=workspaceRecoveryTables().find(([name])=>name===table)?.[1]().find(item=>String(item.id)===String(row.id));
  const detached=!remove&&(!live||JSON.stringify(docToRow(live))!==JSON.stringify(row));
  workspaceRecoveryEntries.set(recoveryKey,{table,id:String(row.id),baseline:syncedTableRows[table]?.get(String(row.id))||null,record:remove?null:structuredClone(doc),detached});
  await ensureWorkspaceRecoveryDurable();
  const requestPayload={table,id:String(row.id||''),data:row.data,revision,remove:!!remove};
  const payloadHash=await sha256Hex({operation:'save_revisioned_document',...requestPayload});
  const request=await beginDurableOperation('save_revisioned_document',payloadHash),requestId=request.requestId;
  const {data,error}=await sb.rpc('save_revisioned_document',{p_request_id:requestId,p_table:table,p_id:String(row.id||''),p_data:row.data,p_expected_revision:revision,p_delete:!!remove});
  if(error){
    if(String(error.message||'').includes('REVISION_CONFLICT')||['40001','PT409'].includes(String(error.code||''))){
      const conflict=new Error('เอกสารนี้ถูกแก้ไขจากอีกเครื่องแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง'); conflict.code='REVISION_CONFLICT'; conflict.recordId=String(row.id||'');
      reportClientEvent({operation:'save_revisioned_document',tableName:table,recordId:conflict.recordId,errorCode:conflict.code,message:conflict.message,context:{expectedRevision:revision,payloadHash}});
      conflict.syncEventReported=true;
      throw conflict;
    }
    reportClientEvent({operation:'save_revisioned_document',tableName:table,recordId:String(row.id||''),errorCode:error.code||'',message:error.message||'Document sync failed',context:{expectedRevision:revision,payloadHash}});
    error.syncEventReported=true;
    throw error;
  }
  await finishDurableOperation(request);
  if(!remove&&doc) doc._revision=Number(data?.revision)||revision||1;
  workspaceRecoveryEntries.delete(recoveryKey);
  return data;
}
async function syncRevisionedDocuments(table,localArray){
  const previous=syncedTableRows[table]||new Map();
  const current=tableSnapshot(localArray,docToRow);
  const changed=cloneSyncRecords((localArray||[]).filter(doc=>previous.get(String(doc.id))!==JSON.stringify(docToRow(doc))));
  const acknowledge=syncAcknowledgement(table,localArray,docToRow);
  const deleted=[...previous.keys()].filter(id=>!current.has(id));
  const paused=typeof persistentSyncPauseMap==='function'?persistentSyncPauseMap(syncRevisionedDocuments,'documents'):(syncRevisionedDocuments.paused||=new Map());
  let firstError=null;
  const retainError=(error,id)=>{error.recordId=String(id);if(!firstError||firstError.syncPaused&&!error.syncPaused)firstError=error;};
  for(const doc of changed){
    const key=`${table}:${doc.id}`,fingerprint=JSON.stringify(docToRow(doc));
    if(paused.get(key)===fingerprint){ const error=new Error('เอกสารนี้รอตรวจสอบข้อมูลที่ชนกัน การแก้ไขยังเก็บไว้ในเครื่อง'); error.code='REVISION_CONFLICT'; error.syncPaused=true; retainError(error,doc.id); continue; }
    try{ await saveRevisionedDocument(table,doc); acknowledge(doc); paused.delete(key); }
    catch(error){ if(error.code==='REVISION_CONFLICT') paused.set(key,fingerprint); retainError(error,doc.id); }
  }
  for(const id of deleted){
    const previousRow=JSON.parse(previous.get(String(id))||'{}');
    const key=`${table}:${id}`,fingerprint=`delete:${previousRow.revision}`;
    if(paused.get(key)===fingerprint){ const error=new Error('รายการลบนี้รอตรวจสอบข้อมูลที่ชนกัน'); error.code='REVISION_CONFLICT'; error.syncPaused=true; retainError(error,id); continue; }
    try{ await saveRevisionedDocument(table,{id,_revision:Number(previousRow.revision)||0},{remove:true,expectedRevision:Number(previousRow.revision)||0}); paused.delete(key); }
    catch(error){ if(error.code==='REVISION_CONFLICT') paused.set(key,fingerprint); retainError(error,id); continue; }
    syncedTableRows[table].delete(id);
    workspaceRecoveryEntries.delete(`${table}:${id}`);
    await ensureWorkspaceRecoveryDurable();
  }
  if(firstError) throw firstError;
  return true;
}
const MEDICINE_LABEL_DURATION_OPTIONS=[
  {value:'days',label:'กำหนดจำนวนวัน'},
  {value:'as_needed',label:'ใช้เมื่อมีอาการ'},
  {value:'until_recovered',label:'จนกว่าอาการจะหาย'},
];
const MEDICINE_LABEL_WARNING_PRESETS=['อาจทำให้ง่วง ห้ามขับรถหรือใช้เครื่องจักร','รับประทานยานี้ติดต่อกันจนหมด','เขย่าขวดก่อนใช้','เก็บยาในตู้เย็น ห้ามแช่แข็ง'];
let medicineLabelSize=(()=>{ try{ const saved=localStorage.getItem(MEDICINE_LABEL_SIZE_STORAGE_KEY); return MEDICINE_LABEL_SIZES[saved]?saved:'80x50'; }catch(_error){ return '80x50'; } })();
let medicineLabelDoseUnitSyncPromise=Promise.resolve();
let medicineLabelWarningPresetSyncPromise=Promise.resolve();
function normalizeMedicineLabelDoseUnits(values){
  const result=[],seen=new Set();
  (Array.isArray(values)?values:[]).forEach(value=>{
    const unit=String(value||'').trim().replace(/\s+/g,' ').slice(0,40),key=unit.toLocaleLowerCase('th-TH');
    if(!unit||seen.has(key)) return;
    seen.add(key); result.push(unit);
  });
  return result;
}
function getMedicineLabelDoseUnits(){
  const saved=normalizeMedicineLabelDoseUnits(businessSettings?.medicineLabelDoseUnits);
  return saved.length?saved:[...MEDICINE_LABEL_DOSE_UNITS];
}
function saveMedicineLabelDoseUnits(values){
  const normalized=normalizeMedicineLabelDoseUnits(values);
  if(!normalized.length) return getMedicineLabelDoseUnits();
  businessSettings={...businessSettings,medicineLabelDoseUnits:normalized};
  persistWorkspaceData();
  medicineLabelDoseUnitSyncPromise=medicineLabelDoseUnitSyncPromise.then(()=>syncBusinessSettingsToSupabase(),()=>syncBusinessSettingsToSupabase());
  return [...normalized];
}
function normalizeMedicineLabelWarningPresets(values){
  const result=[],seen=new Set();
  (Array.isArray(values)?values:[]).forEach(value=>{
    const warning=String(value||'').trim().replace(/\s+/g,' ').slice(0,180),key=warning.toLocaleLowerCase('th-TH');
    if(!warning||seen.has(key)) return;
    seen.add(key); result.push(warning);
  });
  return result;
}
function getMedicineLabelWarningPresets(){
  return Array.isArray(businessSettings?.medicineLabelWarningPresets)
    ?normalizeMedicineLabelWarningPresets(businessSettings.medicineLabelWarningPresets)
    :[...MEDICINE_LABEL_WARNING_PRESETS];
}
function saveMedicineLabelWarningPresets(values){
  const normalized=normalizeMedicineLabelWarningPresets(values);
  businessSettings={...businessSettings,medicineLabelWarningPresets:normalized};
  persistWorkspaceData();
  medicineLabelWarningPresetSyncPromise=medicineLabelWarningPresetSyncPromise.then(()=>syncBusinessSettingsToSupabase(),()=>syncBusinessSettingsToSupabase());
  return [...normalized];
}
function medicineLabelMemberName(member=saleMember){
  if(!member) return '';
  return String(typeof member==='object'?(member.name||''):member).trim();
}
function currentPharmacistName(){
  const profile=currentProfile||currentUserProfile||{};
  return [profile.firstName,profile.lastName].filter(Boolean).join(' ').trim()||String(profile.username||'').trim();
}
function medicineLabelLegacyDoseParts(directions){
  const text=String(directions||'').trim();
  const dose=text.match(/ครั้งละ\s*([0-9]+(?:\.[0-9]+)?|[0-9]+\/[0-9]+)\s*([^\s]+)/);
  const duration=text.match(/(?:เป็นเวลา|ติดต่อกัน|จำนวน)\s*([0-9]+)\s*วัน/);
  return {doseAmount:dose?.[1]||'',doseUnit:dose?.[2]||'',durationDays:duration?.[1]||''};
}
function medicineLabelMealTiming(value,directions=''){
  const explicit=String(value??'').trim();
  if([...MEDICINE_LABEL_MEAL_OPTIONS.map(option=>option.value),'none'].includes(explicit)) return explicit;
  const text=String(directions||'');
  if(text.includes('ก่อนอาหาร')) return 'before';
  if(text.includes('หลังอาหาร')) return 'after';
  if(text.includes('พร้อมอาหาร')) return 'with_food';
  if(text.includes('ขณะท้องว่าง')) return 'empty_stomach';
  return 'none';
}
function medicineLabelInterval(value,unit,directions=''){
  const explicit=String(value??'').trim(),number=Number(explicit),explicitUnit=String(unit||'').trim();
  if(explicit&&Number.isInteger(number)&&number>=1&&['hours','minutes'].includes(explicitUnit)) return {value:String(number),unit:explicitUnit};
  const matched=String(directions||'').match(/ทุก\s*([0-9]+)\s*(ชั่วโมง|ชม\.?|นาที)/);
  const legacy=Number(matched?.[1]),legacyUnit=matched?.[2]?.startsWith('นาที')?'minutes':'hours';
  return Number.isInteger(legacy)&&legacy>=1?{value:String(legacy),unit:legacyUnit}:{value:'',unit:'hours'};
}
function medicineLabelIntervalText(value){
  const interval=medicineLabelInterval(value?.intervalValue??value?.intervalHours,value?.intervalUnit||(value?.intervalHours?'hours':''),value?.directions);
  return interval.value?`ทุก ${interval.value} ${interval.unit==='minutes'?'นาที':'ชั่วโมง'}`:'';
}
function medicineLabelDoseTimes(value,directions=''){
  const allowed=new Set(MEDICINE_LABEL_TIME_OPTIONS.map(option=>option.value));
  if(Array.isArray(value)) return [...new Set(value.map(item=>String(item||'').trim()).filter(item=>allowed.has(item)))];
  const text=String(directions||'');
  return MEDICINE_LABEL_TIME_OPTIONS.filter(option=>text.includes(option.label)).map(option=>option.value);
}
function medicineLabelDurationMode(value,durationDays='',directions=''){
  const explicit=String(value??'').trim();
  if(MEDICINE_LABEL_DURATION_OPTIONS.some(option=>option.value===explicit)) return explicit;
  const text=String(directions||'');
  if(text.includes('จนกว่าอาการจะหาย')) return 'until_recovered';
  if(text.includes('ใช้เมื่อมีอาการ')) return 'as_needed';
  return 'days';
}
function medicineLabelDurationText(value){
  const durationDays=String(value?.durationDays||'').trim();
  const mode=medicineLabelDurationMode(value?.durationMode,durationDays,value?.directions);
  if(mode==='as_needed') return 'ใช้เมื่อมีอาการ';
  if(mode==='until_recovered') return 'จนกว่าอาการจะหาย';
  return durationDays?`${durationDays} วัน`:'';
}
function medicineLabelDirectionsFromParts(value){
  const amount=String(value?.doseAmount||'').trim(),unit=String(value?.doseUnit||'').trim(),duration=String(value?.durationDays||'').trim();
  const times=medicineLabelDoseTimes(value?.doseTimes,value?.directions);
  const interval=medicineLabelInterval(value?.intervalValue??value?.intervalHours,value?.intervalUnit||(value?.intervalHours?'hours':''),value?.directions),intervalText=medicineLabelIntervalText({...value,intervalValue:interval.value,intervalUnit:interval.unit});
  const durationMode=medicineLabelDurationMode(value?.durationMode,duration,value?.directions),durationText=medicineLabelDurationText({...value,durationMode,durationDays:duration});
  if(!amount||!unit||!durationText||(!times.length&&!interval.value)) return String(value?.directions||'').trim();
  const meal=medicineLabelMealTiming(value?.mealTiming,value?.directions);
  const mealText=MEDICINE_LABEL_MEAL_OPTIONS.find(option=>option.value===meal)?.label||'';
  const timeText=MEDICINE_LABEL_TIME_OPTIONS.filter(option=>times.includes(option.value)).map(option=>option.label).join(' ');
  const durationDirection=durationMode==='days'?`เป็นเวลา ${durationText}`:durationText;
  return [`รับประทานครั้งละ ${amount} ${unit}`,mealText,intervalText,timeText,durationDirection].filter(Boolean).join(' ');
}
function normalizeDispensingLabel(value){
  if(!value||value.enabled===false) return null;
  const legacyDirections=String(value.directions||'').trim(),legacy=medicineLabelLegacyDoseParts(legacyDirections);
  const doseAmount=String(value.doseAmount??legacy.doseAmount).trim(),doseUnit=String(value.doseUnit??legacy.doseUnit).trim(),rawDurationDays=String(value.durationDays??legacy.durationDays).trim();
  const durationMode=medicineLabelDurationMode(value.durationMode,rawDurationDays,legacyDirections),durationDays=durationMode==='days'?rawDurationDays:'';
  const mealTiming=medicineLabelMealTiming(value.mealTiming,legacyDirections),interval=medicineLabelInterval(value.intervalValue??value.intervalHours,value.intervalUnit||(value.intervalHours?'hours':''),legacyDirections),doseTimes=medicineLabelDoseTimes(value.doseTimes,legacyDirections);
  const directions=medicineLabelDirectionsFromParts({doseAmount,doseUnit,durationMode,durationDays,mealTiming,intervalValue:interval.value,intervalUnit:interval.unit,doseTimes,directions:legacyDirections});
  const label={
    enabled:true,
    drugName:String(value.drugName||'').trim(),
    patientName:String(value.patientName||'').trim(),
    indication:String(value.indication||'').trim(),
    doseAmount,
    doseUnit,
    durationMode,
    durationDays,
    mealTiming,
    intervalValue:interval.value,
    intervalUnit:interval.unit,
    doseTimes,
    directions,
    warning:String(value.warning||'').trim(),
    pharmacistName:String(value.pharmacistName||'').trim(),
  };
  return label.drugName&&label.patientName&&label.indication&&label.directions&&label.pharmacistName?label:null;
}
function medicineLabelSummary(value){
  const label=normalizeDispensingLabel(value);
  return label?`${label.patientName} · ${label.directions}`:'';
}
function medicineLabelsForSale(sale){
  return (sale?.items||[]).filter(item=>normalizeDispensingLabel(item?.dispensingLabel));
}
function setMedicineLabelSize(value){
  medicineLabelSize=MEDICINE_LABEL_SIZES[value]?value:'80x50';
  try{ localStorage.setItem(MEDICINE_LABEL_SIZE_STORAGE_KEY,medicineLabelSize); }catch(_error){}
  return medicineLabelSize;
}
