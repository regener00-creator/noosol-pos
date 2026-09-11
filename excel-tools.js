// Excel import/export feature bundle. Loaded only when an Excel action is used.
async function downloadContactImportTemplate(){
  try{ await ensureXlsxLoaded(); }catch(error){ console.warn('load xlsx',error); }
  const example=[{
    'รหัสผู้ติดต่อ':'C0001','ประเภทผู้ติดต่อ':'นิติบุคคล','ประเภท':'ลูกค้า','ชื่อธุรกิจ / ชื่อ':'บริษัท ตัวอย่าง จำกัด',
    'เลขผู้เสียภาษี':'0105551234567','เครดิต (วัน)':30,'ที่อยู่':'','รหัสไปรษณีย์':'',
    'ชื่อผู้ติดต่อ':'คุณตัวอย่าง','อีเมล':'','เบอร์มือถือ':'081-234-5678',
    'ธนาคาร':'','ชื่อบัญชี':'','เลขที่บัญชี':'','ประเภทบัญชี':'','โน๊ต':''
  }];
  if(window.XLSX){
    const sheet=XLSX.utils.json_to_sheet(example);
    sheet['!cols']=Object.keys(example[0]).map(header=>({wch:Math.max(14,Math.min(28,header.length+5))}));
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,sheet,'สมุดรายชื่อ');
    const instructions=[
      ['หัวข้อ','วิธีกรอก'],
      ['รหัสผู้ติดต่อ','ถ้ากรอกและตรงกับรายชื่อเดิมในระบบ จะอัปเดตรายชื่อนั้นแทนการสร้างใหม่ (เว้นว่างได้)'],
      ['ชื่อธุรกิจ / ชื่อ','จำเป็นต้องกรอก ถ้าไม่กรอกรหัสผู้ติดต่อ ระบบจะจับคู่จากชื่อที่ตรงกันเป๊ะแทน'],
      ['ประเภทผู้ติดต่อ','กรอก นิติบุคคล หรือ บุคคลธรรมดา (ไม่บังคับ ค่าเริ่มต้น นิติบุคคล)'],
      ['ประเภท','กรอก ลูกค้า, ผู้จำหน่าย หรือ ทั้งคู่ (ไม่บังคับ ค่าเริ่มต้น ลูกค้า)'],
      ['ประเภทบัญชี','กรอก ออมทรัพย์ หรือ กระแสรายวัน (ไม่บังคับ)'],
      ['ข้อสำคัญ','อย่าเปลี่ยนชื่อหัวคอลัมน์ในแถวแรก'],
    ];
    const instructionSheet=XLSX.utils.aoa_to_sheet(instructions);
    instructionSheet['!cols']=[{wch:20},{wch:80}];
    XLSX.utils.book_append_sheet(workbook,instructionSheet,'วิธีกรอก');
    XLSX.writeFile(workbook,'PEPOS-ตัวอย่างนำเข้าสมุดรายชื่อ.xlsx');
    return;
  }
  const headers=Object.keys(example[0]);
  const csv='\uFEFF'+headers.join(',')+'\n'+headers.map(key=>`"${String(example[0][key]).replace(/"/g,'""')}"`).join(',');
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  link.download='PEPOS-ตัวอย่างนำเข้าสมุดรายชื่อ.csv';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
function contactImportTypes(value){
  const text=String(value||'').trim().toLowerCase();
  const types=[];
  if(text.includes('ลูกค้า')||text.includes('customer')) types.push('customer');
  if(text.includes('จำหน่าย')||text.includes('supplier')||text.includes('vendor')) types.push('supplier');
  if(text.includes('ทั้งคู่')||text.includes('both')){ if(!types.includes('customer')) types.push('customer'); if(!types.includes('supplier')) types.push('supplier'); }
  return types.length?types:['customer'];
}
function contactImportEntity(value){
  const text=String(value||'').trim().toLowerCase();
  if(text.includes('บุคคลธรรมดา')||text.includes('individual')) return 'individual';
  return 'juristic';
}
function contactImportAccType(value){
  const text=String(value||'').trim().toLowerCase();
  if(text.includes('กระแส')||text.includes('current')) return 'current';
  if(text.includes('ออม')||text.includes('saving')) return 'saving';
  return '';
}
async function importContactsFromExcel(file){
  try{ await ensureXlsxLoaded(); }catch(error){ showToast(error.message||'ไม่สามารถโหลดระบบอ่าน Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'); return; }
  let workbook;
  try{ workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}); }
  catch(error){ showToast('ไม่สามารถอ่านไฟล์ Excel นี้ได้'); return; }
  const firstSheet=workbook.Sheets[workbook.SheetNames[0]];
  const sourceRows=XLSX.utils.sheet_to_json(firstSheet,{defval:'',raw:true});
  if(!sourceRows.length){ showToast('ไม่พบข้อมูลในไฟล์'); return; }

  const toCreate=[];
  const toUpdate=[];
  const skipped=[];
  const seenInFile=new Set(); // guard against two rows in the same file matching the same existing contact

  sourceRows.forEach((row,index)=>{
    const line=index+2;
    const name=String(productImportValue(row,['ชื่อธุรกิจ / ชื่อ','ชื่อธุรกิจ','ชื่อ','รายชื่อ','name'])).trim();
    if(!name){ skipped.push(`แถว ${line}: ไม่มีชื่อธุรกิจ / ชื่อ`); return; }
    const code=String(productImportValue(row,['รหัสผู้ติดต่อ','รหัส','code'])).trim();
    const data={
      name,
      types:contactImportTypes(productImportValue(row,['ประเภท','type'])),
      entity:contactImportEntity(productImportValue(row,['ประเภทผู้ติดต่อ','entity'])),
      code,
      taxId:String(productImportValue(row,['เลขผู้เสียภาษี','taxid'])).trim(),
      creditDays:productImportNumber(productImportValue(row,['เครดิต (วัน)','เครดิต','creditdays']),'')||'',
      address:String(productImportValue(row,['ที่อยู่','address'])).trim(),
      postcode:String(productImportValue(row,['รหัสไปรษณีย์','postcode'])).trim(),
      contactName:String(productImportValue(row,['ชื่อผู้ติดต่อ','contactname'])).trim(),
      email:String(productImportValue(row,['อีเมล','email'])).trim(),
      phone:String(productImportValue(row,['เบอร์มือถือ','เบอร์โทร','phone'])).trim(),
      bank:String(productImportValue(row,['ธนาคาร','bank'])).trim(),
      bankName:String(productImportValue(row,['ชื่อบัญชี','bankname'])).trim(),
      bankAcc:String(productImportValue(row,['เลขที่บัญชี','bankacc'])).trim(),
      accType:contactImportAccType(productImportValue(row,['ประเภทบัญชี','acctype'])),
      note:String(productImportValue(row,['โน๊ต','หมายเหตุ','note'])).trim(),
    };
    let existing=null;
    const systemId=productImportNumber(productImportValue(row,['รหัสอ้างอิงระบบ','systemid']),NaN);
    if(Number.isFinite(systemId)) existing=contacts.find(c=>c.id===systemId);
    if(!existing&&code) existing=contacts.find(c=>String(c.code||'').trim().toLowerCase()===code.toLowerCase());
    if(!existing) existing=contacts.find(c=>String(c.name||'').trim().toLowerCase()===name.toLowerCase());
    if(existing){
      if(seenInFile.has(existing.id)){ skipped.push(`แถว ${line}: ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน (${name})`); return; }
      seenInFile.add(existing.id);
      toUpdate.push({existing,data});
    }else{
      toCreate.push(data);
    }
  });

  if(!toCreate.length&&!toUpdate.length){
    alert(`ไม่สามารถนำเข้าข้อมูลได้\n\n${skipped.slice(0,8).join('\n')}${skipped.length>8?`\nและอีก ${skipped.length-8} รายการ`:''}`);
    return;
  }
  const confirmation=`พบข้อมูล ${sourceRows.length} แถว\nจะเพิ่มรายชื่อใหม่ ${toCreate.length} รายการ\nจะอัปเดตรายชื่อเดิม ${toUpdate.length} รายการ${skipped.length?`\nข้าม ${skipped.length} แถวที่ข้อมูลไม่ครบ`:''}\n\nยืนยันนำเข้าหรือไม่?`;
  if(!confirm(confirmation)) return;

  toUpdate.forEach(({existing,data})=>Object.assign(existing,data));
  toCreate.forEach(data=>contacts.push({id:generateClientRecordId(contacts),...data}));
  persistContacts();
  showToast(`นำเข้าสมุดรายชื่อสำเร็จ · เพิ่มใหม่ ${toCreate.length} · อัปเดต ${toUpdate.length}${skipped.length?` · ข้าม ${skipped.length}`:''}`);
  render();
}

async function exportContactsToExcel(){
  try{ await ensureXlsxLoaded(); }catch(error){ showToast(error.message||'ไม่สามารถโหลดระบบส่งออก Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'); return; }
  const selectedContacts=contacts.filter(c=>c.types?.includes(currentTab==='customers'?'customer':'supplier'));
  if(!selectedContacts.length){ showToast('ยังไม่มีข้อมูลให้ส่งออก'); return; }
  const typeLabel=c=>{ const isCust=c.types?.includes('customer'),isSupp=c.types?.includes('supplier'); if(isCust&&isSupp) return 'ทั้งคู่'; if(isSupp) return 'ผู้จำหน่าย'; return 'ลูกค้า'; };
  const rows=selectedContacts.map(c=>({
    'รหัสอ้างอิงระบบ':c.id,
    'รหัสผู้ติดต่อ':c.code||'',
    'ประเภทผู้ติดต่อ':c.entity==='individual'?'บุคคลธรรมดา':'นิติบุคคล',
    'ประเภท':typeLabel(c),
    'ชื่อธุรกิจ / ชื่อ':c.name||'',
    'เลขผู้เสียภาษี':c.taxId||'',
    'เครดิต (วัน)':c.creditDays||'',
    'ที่อยู่':c.address||'',
    'รหัสไปรษณีย์':c.postcode||'',
    'ชื่อผู้ติดต่อ':c.contactName||'',
    'อีเมล':c.email||'',
    'เบอร์มือถือ':c.phone||'',
    'ธนาคาร':c.bank||'',
    'ชื่อบัญชี':c.bankName||'',
    'เลขที่บัญชี':c.bankAcc||'',
    'ประเภทบัญชี':c.accType==='current'?'กระแสรายวัน':(c.accType==='saving'?'ออมทรัพย์':''),
    'โน๊ต':c.note||'',
  }));
  const sheet=XLSX.utils.json_to_sheet(rows);
  sheet['!cols']=Object.keys(rows[0]).map(header=>({wch:Math.max(14,Math.min(28,header.length+5))}));
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,sheet,'สมุดรายชื่อ');
  XLSX.writeFile(workbook,`PEPOS-สมุดรายชื่อ-${TODAY_STR}.xlsx`);
  showToast(`ส่งออกสมุดรายชื่อ ${rows.length} รายการแล้ว`);
}

const SALES_REP_EXCEL_HEADERS=['รหัสอ้างอิงระบบ','ชื่อผู้แทน','เบอร์โทร','ไลน์','บริษัท','ข้อมูลเพิ่มเติม'];
const SALES_REP_EXPORT_HEADERS=[...SALES_REP_EXCEL_HEADERS,'จำนวนสินค้าที่ดูแล','จำนวน NOTE'];
const SALES_REP_NOTE_EXCEL_HEADERS=['รหัสอ้างอิงผู้แทน','ชื่อผู้แทน','ลำดับ NOTE','รหัสอ้างอิง NOTE','วันที่ NOTE','ชื่อ NOTE','เนื้อหา NOTE','ซ่อนจาก LEVEL 2','สร้างเมื่อ','แก้ไขล่าสุด'];
const SALES_REP_PRODUCT_EXCEL_HEADERS=['รหัสอ้างอิงผู้แทน','ชื่อผู้แทน','รหัสอ้างอิงสินค้า','รหัสสินค้า (SKU)','เลขบาร์โค้ด','ชื่อสินค้า'];
function salesRepresentativeToExcelRow(representative){
  const values={
    'รหัสอ้างอิงระบบ':representative.id??'',
    'ชื่อผู้แทน':representative.name||'',
    'เบอร์โทร':representative.phone||'',
    'ไลน์':representative.line||'',
    'บริษัท':representative.company||'',
    'ข้อมูลเพิ่มเติม':representative.note||'',
  };
  const row={};
  SALES_REP_EXCEL_HEADERS.forEach(header=>{ row[header]=values[header]; });
  return row;
}
function salesRepresentativeExcelDate(value,{dateOnly=false}={}){
  const text=String(value||'').trim();
  if(!text) return '';
  const date=new Date(dateOnly&&/^\d{4}-\d{2}-\d{2}$/.test(text)?`${text}T00:00:00`:text);
  return Number.isNaN(date.getTime())?'':date;
}
function salesRepresentativeExportRows(representatives,assignments,notes,catalog){
  const representativeList=Array.isArray(representatives)?representatives:[];
  const assignmentList=Array.isArray(assignments)?assignments:[];
  const noteList=Array.isArray(notes)?notes:[];
  const productList=Array.isArray(catalog)?catalog:[];
  const representativesById=new Map(representativeList.map(representative=>[Number(representative.id),representative]));
  const productsById=new Map(productList.map(product=>[Number(product.id),product]));
  const productCounts=new Map(),noteCounts=new Map();
  assignmentList.forEach(assignment=>{
    const representativeId=Number(assignment.representativeId);
    if(representativesById.has(representativeId)) productCounts.set(representativeId,(productCounts.get(representativeId)||0)+1);
  });
  noteList.forEach(note=>{
    const representativeId=Number(note.representativeId);
    if(representativesById.has(representativeId)) noteCounts.set(representativeId,(noteCounts.get(representativeId)||0)+1);
  });
  const representativeRows=representativeList.map(representative=>({
    ...salesRepresentativeToExcelRow(representative),
    'จำนวนสินค้าที่ดูแล':productCounts.get(Number(representative.id))||0,
    'จำนวน NOTE':noteCounts.get(Number(representative.id))||0,
  }));
  const productRows=assignmentList.map(assignment=>{
    const representative=representativesById.get(Number(assignment.representativeId));
    if(!representative) return null;
    const product=productsById.get(Number(assignment.productId))||{};
    return {
      'รหัสอ้างอิงผู้แทน':representative.id??'',
      'ชื่อผู้แทน':representative.name||'',
      'รหัสอ้างอิงสินค้า':assignment.productId??'',
      'รหัสสินค้า (SKU)':product.sku||'',
      'เลขบาร์โค้ด':product.barcode||'',
      'ชื่อสินค้า':product.name||'',
    };
  }).filter(Boolean).sort((a,b)=>String(a['ชื่อผู้แทน']).localeCompare(String(b['ชื่อผู้แทน']),'th')||String(a['ชื่อสินค้า']).localeCompare(String(b['ชื่อสินค้า']),'th'));
  const noteNumbers=new Map();
  const noteRows=[...noteList].filter(note=>representativesById.has(Number(note.representativeId))).sort((a,b)=>{
    const representativeA=representativesById.get(Number(a.representativeId));
    const representativeB=representativesById.get(Number(b.representativeId));
    return String(representativeA?.name||'').localeCompare(String(representativeB?.name||''),'th')
      ||String(b.eventDate||'').localeCompare(String(a.eventDate||''))
      ||String(b.updatedAt||'').localeCompare(String(a.updatedAt||''));
  }).map(note=>{
    const representativeId=Number(note.representativeId);
    const representative=representativesById.get(representativeId);
    const noteNumber=(noteNumbers.get(representativeId)||0)+1;
    noteNumbers.set(representativeId,noteNumber);
    return {
      'รหัสอ้างอิงผู้แทน':representative.id??'',
      'ชื่อผู้แทน':representative.name||'',
      'ลำดับ NOTE':noteNumber,
      'รหัสอ้างอิง NOTE':note.id||'',
      'วันที่ NOTE':salesRepresentativeExcelDate(note.eventDate,{dateOnly:true}),
      'ชื่อ NOTE':note.title||'',
      'เนื้อหา NOTE':notePlainText(note.contentHtml||''),
      'ซ่อนจาก LEVEL 2':note.hiddenFromLevel2?'ใช่':'ไม่',
      'สร้างเมื่อ':salesRepresentativeExcelDate(note.createdAt),
      'แก้ไขล่าสุด':salesRepresentativeExcelDate(note.updatedAt),
    };
  });
  return {representativeRows,noteRows,productRows};
}
function salesRepresentativeExcelSheet(rows,headers,widths,dateFormats={}){
  const sheet=XLSX.utils.json_to_sheet(rows,{header:headers,cellDates:true});
  sheet['!cols']=widths.map(wch=>({wch}));
  const endRow=Math.max(0,rows.length),endColumn=Math.max(0,headers.length-1);
  sheet['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:endRow,c:endColumn}})};
  Object.entries(dateFormats).forEach(([header,format])=>{
    const column=headers.indexOf(header);
    if(column<0) return;
    for(let row=1;row<=endRow;row++){
      const cell=sheet[XLSX.utils.encode_cell({r:row,c:column})];
      if(cell&&cell.v instanceof Date) cell.z=format;
    }
  });
  return sheet;
}
async function loadSalesRepresentativeExcelDetails(){
  const [assignmentResult,noteResult]=await Promise.all([
    fetchAllRows(()=>sb.from('sales_representative_products').select('representative_id,product_id,created_at,updated_at').order('representative_id').order('product_id')),
    fetchAllRows(()=>sb.from('notes').select(NOTE_ROW_SELECT).not('activity_type','is',null).order('event_date',{ascending:false}).order('updated_at',{ascending:false}))
  ]);
  if(assignmentResult.error) throw assignmentResult.error;
  if(noteResult.error) throw noteResult.error;
  return {
    assignments:(assignmentResult.data||[]).map(row=>({representativeId:Number(row.representative_id),productId:Number(row.product_id),createdAt:row.created_at||'',updatedAt:row.updated_at||''})),
    notes:(noteResult.data||[]).map(mapNoteRow),
  };
}
async function downloadSalesRepresentativeImportTemplate(){
  try{ await ensureXlsxLoaded(); }catch(error){ console.warn('load xlsx',error); }
  const example=[salesRepresentativeToExcelRow({id:'',name:'คุณตัวอย่าง ใจดี',phone:'081-234-5678',line:'example.line',company:'บริษัท ตัวอย่าง จำกัด',note:'ผู้แทนเขตกรุงเทพฯ'})];
  if(window.XLSX){
    const sheet=XLSX.utils.json_to_sheet(example);
    sheet['!cols']=[{wch:18},{wch:28},{wch:18},{wch:22},{wch:32},{wch:42}];
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,sheet,'รายชื่อผู้แทน');
    const instructions=[
      ['หัวข้อ','วิธีกรอก'],
      ['รหัสอ้างอิงระบบ','รายชื่อใหม่ปล่อยว่างได้ หากเป็นไฟล์ที่ส่งออกจากระบบให้คงค่านี้ไว้เพื่ออัปเดตรายชื่อเดิม'],
      ['ชื่อผู้แทน','จำเป็นต้องกรอก หากไม่มีรหัสอ้างอิงระบบ ระบบจะจับคู่จากชื่อที่ตรงกัน'],
      ['เบอร์โทร / ไลน์ / บริษัท / ข้อมูลเพิ่มเติม','กรอกได้ตามต้องการ'],
      ['ข้อสำคัญ','อย่าเปลี่ยนชื่อหัวคอลัมน์ในแถวแรก'],
    ];
    const instructionSheet=XLSX.utils.aoa_to_sheet(instructions);
    instructionSheet['!cols']=[{wch:28},{wch:90}];
    XLSX.utils.book_append_sheet(workbook,instructionSheet,'วิธีกรอก');
    XLSX.writeFile(workbook,'PEPOS-คู่มือนำเข้ารายชื่อผู้แทน.xlsx');
    return;
  }
  const csv='\uFEFF'+SALES_REP_EXCEL_HEADERS.join(',')+'\n'+SALES_REP_EXCEL_HEADERS.map(header=>`"${String(example[0][header]).replace(/"/g,'""')}"`).join(',');
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  link.download='PEPOS-คู่มือนำเข้ารายชื่อผู้แทน.csv';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
async function importSalesRepresentativesFromExcel(file){
  try{ await ensureXlsxLoaded(); }catch(error){ showToast(error.message||'ไม่สามารถโหลดระบบอ่าน Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'); return; }
  let workbook;
  try{ workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}); }
  catch(error){ showToast('ไม่สามารถอ่านไฟล์ Excel นี้ได้'); return; }
  const firstSheet=workbook.Sheets[workbook.SheetNames[0]];
  const sourceRows=XLSX.utils.sheet_to_json(firstSheet,{defval:'',raw:true});
  if(!sourceRows.length){ showToast('ไม่พบรายชื่อผู้แทนในไฟล์'); return; }

  const toCreate=[];
  const toUpdate=[];
  const skipped=[];
  const seenInFile=new Set();
  sourceRows.forEach((row,index)=>{
    const line=index+2;
    const name=String(productImportValue(row,['ชื่อผู้แทน','ชื่อ','name'])).trim();
    if(!name){ skipped.push(`แถว ${line}: ไม่มีชื่อผู้แทน`); return; }
    const normalizedName=name.toLowerCase();
    const legacyCode=String(productImportValue(row,['รหัสผู้ติดต่อ','รหัส','code'])).trim();
    const data={
      name,
      phone:String(productImportValue(row,['เบอร์โทร','เบอร์มือถือ','phone'])).trim(),
      line:String(productImportValue(row,['ไลน์','line','lineid'])).trim(),
      company:String(productImportValue(row,['บริษัท','company'])).trim(),
      note:String(productImportValue(row,['ข้อมูลเพิ่มเติม','หมายเหตุ','โน๊ต','note'])).trim(),
    };
    let existing=null;
    const systemId=productImportNumber(productImportValue(row,['รหัสอ้างอิงระบบ','systemid']),NaN);
    if(Number.isFinite(systemId)) existing=salesRepresentatives.find(representative=>representative.id===systemId)||null;
    if(!existing&&legacyCode) existing=salesRepresentatives.find(representative=>String(representative.code||'').trim().toLowerCase()===legacyCode.toLowerCase())||null;
    if(!existing) existing=salesRepresentatives.find(representative=>String(representative.name||'').trim().toLowerCase()===normalizedName)||null;
    const fileKey=existing?`id:${existing.id}`:(legacyCode?`code:${legacyCode.toLowerCase()}`:`name:${normalizedName}`);
    if(seenInFile.has(fileKey)){ skipped.push(`แถว ${line}: ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน (${name})`); return; }
    seenInFile.add(fileKey);
    if(existing) toUpdate.push({existing,data}); else toCreate.push(data);
  });
  if(!toCreate.length&&!toUpdate.length){
    alert(`ไม่สามารถนำเข้ารายชื่อผู้แทนได้\n\n${skipped.slice(0,8).join('\n')}${skipped.length>8?`\nและอีก ${skipped.length-8} รายการ`:''}`);
    return;
  }
  const confirmation=`พบข้อมูล ${sourceRows.length} แถว\nจะเพิ่มรายชื่อใหม่ ${toCreate.length} รายการ\nจะอัปเดตรายชื่อเดิม ${toUpdate.length} รายการ${skipped.length?`\nข้าม ${skipped.length} แถวที่ข้อมูลไม่ครบหรือซ้ำ`:''}\n\nยืนยันนำเข้าหรือไม่?`;
  if(!confirm(confirmation)) return;
  toUpdate.forEach(({existing,data})=>{
    const oldName=existing.name;
    Object.assign(existing,data);
    if(oldName!==data.name){
      purchaseOrders.forEach(document=>{ if(document.supplier===oldName) document.supplier=data.name; });
      if(poDraft?.supplier===oldName) poDraft.supplier=data.name;
    }
  });
  toCreate.forEach(data=>salesRepresentatives.push({id:generateClientRecordId(salesRepresentatives),...data}));
  persistWorkspaceData();
  showToast(`นำเข้ารายชื่อผู้แทนสำเร็จ · เพิ่มใหม่ ${toCreate.length} · อัปเดต ${toUpdate.length}${skipped.length?` · ข้าม ${skipped.length}`:''}`);
  render();
}
async function exportSalesRepresentativesToExcel(){
  const button=document.getElementById('exportSalesRepsBtn');
  const originalLabel=button?.textContent||'ส่งออก Excel';
  if(button){ button.disabled=true; button.textContent='กำลังเตรียม Excel…'; }
  try{
    await ensureXlsxLoaded();
    if(!salesRepresentatives.length){ showToast('ยังไม่มีรายชื่อผู้แทนให้ส่งออก'); return; }
    const details=await loadSalesRepresentativeExcelDetails();
    const {representativeRows,noteRows,productRows}=salesRepresentativeExportRows(salesRepresentatives,details.assignments,details.notes,products);
    const workbook=XLSX.utils.book_new();
    const representativeSheet=salesRepresentativeExcelSheet(representativeRows,SALES_REP_EXPORT_HEADERS,[18,28,18,22,32,42,20,16]);
    XLSX.utils.book_append_sheet(workbook,representativeSheet,'รายชื่อผู้แทน');
    const noteSheet=salesRepresentativeExcelSheet(noteRows,SALES_REP_NOTE_EXCEL_HEADERS,[20,28,14,38,16,34,70,20,22,22],{'วันที่ NOTE':'dd/mm/yyyy','สร้างเมื่อ':'dd/mm/yyyy hh:mm','แก้ไขล่าสุด':'dd/mm/yyyy hh:mm'});
    noteSheet['!rows']=[{hpt:24},...noteRows.map(()=>({hpt:42}))];
    XLSX.utils.book_append_sheet(workbook,noteSheet,'NOTE ผู้แทน');
    const productSheet=salesRepresentativeExcelSheet(productRows,SALES_REP_PRODUCT_EXCEL_HEADERS,[20,28,20,20,22,42]);
    XLSX.utils.book_append_sheet(workbook,productSheet,'สินค้าที่ดูแล');
    XLSX.writeFile(workbook,`PEPOS-ข้อมูลผู้แทน-${TODAY_STR}.xlsx`,{cellDates:true});
    showToast(`ส่งออกผู้แทน ${representativeRows.length} รายการ · NOTE ${noteRows.length} รายการ · สินค้าที่ดูแล ${productRows.length} รายการแล้ว`);
  }catch(error){
    console.warn('export sales representatives',error);
    showToast(error?.message||'ส่งออกข้อมูลผู้แทนไม่สำเร็จ กรุณาลองใหม่');
  }finally{
    if(button){ button.disabled=false; button.textContent=originalLabel; }
  }
}

function productImportHeader(value){
  return String(value||'').trim().toLowerCase().replace(/[\s_\-()（）]/g,'');
}
// productImportValue() gets called MANY times per row (up to 80-100+ for a
// product row with several extra units/barcodes), and used to rebuild the
// whole normalized-header map from `row` on every single call. For a
// large import (e.g. importing thousands of products) that meant hundreds
// of thousands of redundant object rebuilds, blocking the tab for several
// seconds. `row` is a stable object reference for the whole time one row
// is being processed, so a WeakMap keyed on it lets every call for the
// SAME row reuse one cached normalization instead of rebuilding it --
// no changes needed at any call site, since they all already pass the
// same row object through for every field they read off it.
const _importRowNormalizeCache=new WeakMap();
function productImportValue(row,aliases){
  let normalized=_importRowNormalizeCache.get(row);
  if(!normalized){
    normalized={};
    Object.entries(row||{}).forEach(([key,value])=>{ normalized[productImportHeader(key)]=value; });
    _importRowNormalizeCache.set(row,normalized);
  }
  for(const alias of aliases){
    const key=productImportHeader(alias);
    if(Object.prototype.hasOwnProperty.call(normalized,key)) return normalized[key];
  }
  return '';
}
function productImportNumber(value,fallback=0){
  const number=Number(String(value??'').replace(/,/g,'').trim());
  return Number.isFinite(number)?number:fallback;
}
function productImportDate(value){
  if(value===null||value===undefined||value==='') return '';
  if(typeof value==='number'&&window.XLSX?.SSF?.parse_date_code){
    const parsed=XLSX.SSF.parse_date_code(value);
    if(parsed) return `${String(parsed.y).padStart(4,'0')}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
  }
  if(value instanceof Date&&!Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  const text=String(value).trim();
  let match=text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if(match) return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
  match=text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if(match) return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  return '';
}
const PRODUCT_EXCEL_MIN_REPEAT_COLUMNS=2;
const PRODUCT_EXCEL_MAX_REPEAT_COLUMNS=10;
function productExcelColumnCounts(productRows=[]){
  const bounded=value=>Math.min(PRODUCT_EXCEL_MAX_REPEAT_COLUMNS,Math.max(PRODUCT_EXCEL_MIN_REPEAT_COLUMNS,value));
  const longest=selector=>productRows.reduce((maximum,product)=>Math.max(maximum,selector(product)),0);
  return {
    extraBarcodes:bounded(longest(product=>(product.extraBarcodes||[]).length)),
    vendors:bounded(longest(product=>(product.vendorBarcodes||[]).length)),
    units:bounded(longest(product=>(product.units||[]).length)),
  };
}
function productExcelHeaders(counts){
  const headers=['รหัสสินค้า','ชื่อสินค้า','หมวดสินค้า','ยี่ห้อ / หมวดย่อย','หน่วยหลัก','ราคาขาย (หน่วยหลัก)','ราคาทุน (หน่วยหลัก)','บาร์โค้ดหลัก','ภาษีมูลค่าเพิ่ม','คลังสินค้า','จำนวนคงเหลือ (หน่วยหลัก)','วันหมดอายุ','รายละเอียด'];
  for(let number=1;number<=counts.units;number++){
    headers.push(`หน่วยเพิ่มเติม ${number}`,`จำนวนบรรจุ ${number}`,`เทียบกับหน่วย ${number}`,`ราคาขายหน่วยเพิ่มเติม ${number}`,`ราคาทุนหน่วยเพิ่มเติม ${number}`,`บาร์โค้ดหน่วยเพิ่มเติม ${number}`);
  }
  for(let number=1;number<=counts.extraBarcodes;number++) headers.push(`หน่วยของบาร์โค้ดสำรอง ${number}`,`บาร์โค้ดสำรอง ${number}`);
  for(let number=1;number<=counts.vendors;number++) headers.push(`ชื่อผู้จำหน่าย ${number}`,`บาร์โค้ดผู้จำหน่าย ${number}`);
  headers.push('รหัสอ้างอิงระบบ (ห้ามแก้)');
  return headers;
}
function productExcelColumnWidth(header){
  if(header==='ชื่อสินค้า'||header==='รายละเอียด') return {wch:34};
  if(/บาร์โค้ด|รหัสอ้างอิงระบบ|ชื่อผู้จำหน่าย/.test(header)) return {wch:24};
  if(/หมวด|หน่วย|ราคา|จำนวน|ภาษี|คลัง/.test(header)) return {wch:20};
  return {wch:16};
}
function productToExcelRow(product,counts,warehouseRows=warehouses){
  const productRows=typeof products!=='undefined'&&Array.isArray(products)?products:[];
  const selectedWarehouseId=typeof activeWarehouseId!=='undefined'?Number(activeWarehouseId):Number(product.wh);
  const storedProduct=productRows.some(item=>Number(item.id)===Number(product.id));
  const inventoryReady=storedProduct&&typeof warehouseStock==='function'&&typeof warehouseExpiry==='function';
  const exportStock=inventoryReady?warehouseStock(product.id,selectedWarehouseId):(Number(product.stock)||0);
  const exportExpiry=inventoryReady?warehouseExpiry(product.id,selectedWarehouseId):(product.expiry||'');
  const values={
    'รหัสสินค้า':product.sku||'',
    'ชื่อสินค้า':product.name||'',
    'หมวดสินค้า':product.category||'',
    'ยี่ห้อ / หมวดย่อย':product.brand||'',
    'หน่วยหลัก':product.unit||'',
    'ราคาขาย (หน่วยหลัก)':product.price||0,
    'ราคาทุน (หน่วยหลัก)':product.cost||0,
    'บาร์โค้ดหลัก':product.barcode||'',
    'ภาษีมูลค่าเพิ่ม':productVatModeLabel(product.vat),
    'คลังสินค้า':warehouseRows.find(warehouse=>Number(warehouse.id)===Number(selectedWarehouseId||product.wh))?.name||'',
    'จำนวนคงเหลือ (หน่วยหลัก)':exportStock,
    'วันหมดอายุ':exportExpiry?fmtDateShort(exportExpiry):'',
    'รายละเอียด':product.desc||'',
  };
  for(let number=1;number<=counts.units;number++){
    const unit=(product.units||[])[number-1];
    values[`หน่วยเพิ่มเติม ${number}`]=unit?.sub||'';
    values[`จำนวนบรรจุ ${number}`]=unit?.per||'';
    values[`เทียบกับหน่วย ${number}`]=unit?.base||'';
    values[`ราคาขายหน่วยเพิ่มเติม ${number}`]=unit?.price||'';
    values[`ราคาทุนหน่วยเพิ่มเติม ${number}`]=unit?.cost||'';
    values[`บาร์โค้ดหน่วยเพิ่มเติม ${number}`]=unit?.barcode||'';
  }
  const extraEntries=extraBarcodeEntries(product);
  for(let number=1;number<=counts.extraBarcodes;number++){
    const entry=extraEntries[number-1];
    values[`หน่วยของบาร์โค้ดสำรอง ${number}`]=entry?.unit||product.unit||'';
    values[`บาร์โค้ดสำรอง ${number}`]=entry?.code||'';
  }
  for(let number=1;number<=counts.vendors;number++){
    const vendor=(product.vendorBarcodes||[])[number-1];
    values[`ชื่อผู้จำหน่าย ${number}`]=vendor?.vendor&&vendor.vendor!=='ไม่ระบุ'?vendor.vendor:'';
    values[`บาร์โค้ดผู้จำหน่าย ${number}`]=vendor?.code||'';
  }
  // Preserve 16-digit safe-integer ids when Excel opens and saves the file.
  values['รหัสอ้างอิงระบบ (ห้ามแก้)']=product.id===null||product.id===undefined?'':String(product.id);
  const row={};
  productExcelHeaders(counts).forEach(header=>{ row[header]=values[header]??''; });
  return row;
}
async function downloadProductImportTemplate(){
  try{ await ensureXlsxLoaded(); }catch(error){ console.warn('load xlsx',error); }
  const counts=productExcelColumnCounts(products);
  const example=[productToExcelRow({
    id:'',sku:'P0001',name:'พาราเซตามอล 500mg',barcode:'8850000100019',extraBarcodes:['8850000100018'],extraBarcodeUnits:['แผง'],
    vendorBarcodes:[{vendor:'บริษัท ตัวอย่าง จำกัด',code:'VENDOR-PARA-01'}],category:'ยาสามัญประจำบ้าน',brand:'ทั่วไป',unit:'แผง',
    price:15,cost:9,vat:'incl',stock:120,expiry:'2027-12-31',wh:warehouses[0]?.id,desc:'',
    units:[
      {sub:'กล่อง',per:10,base:'แผง',price:140,cost:90,barcode:'8850000100026'},
      {sub:'ลัง',per:10,base:'กล่อง',price:1350,cost:880,barcode:'8850000100033'},
    ],
  },counts)];
  if(window.XLSX){
    const sheet=XLSX.utils.json_to_sheet(example);
    sheet['!cols']=Object.keys(example[0]).map(productExcelColumnWidth);
    sheet['!autofilter']={ref:sheet['!ref']};
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,sheet,'สินค้า');
    const instructions=[
      ['หัวข้อ','วิธีกรอก'],
      ['รหัสอ้างอิงระบบ (ห้ามแก้)','สินค้าใหม่ปล่อยว่างได้ หากเป็นไฟล์ที่ส่งออกจากระบบให้คงค่านี้ไว้เพื่ออัปเดตสินค้ารายการเดิม'],
      ['บาร์โค้ดหลัก','ตั้งรูปแบบเซลล์เป็นข้อความ (Text) เพื่อป้องกันเลข 0 ด้านหน้าหาย'],
      ['บาร์โค้ดสำรอง','กรอกหน่วยและเลขบาร์โค้ดเป็นคู่หมายเลขเดียวกัน เช่น หน่วยของบาร์โค้ดสำรอง 1 คู่กับ บาร์โค้ดสำรอง 1'],
      ['บาร์โค้ดผู้จำหน่าย','กรอกชื่อผู้จำหน่ายและบาร์โค้ดในหมายเลขชุดเดียวกัน เช่น ชื่อผู้จำหน่าย 1 คู่กับ บาร์โค้ดผู้จำหน่าย 1'],
      ['หน่วยเพิ่มเติม','กรอกเป็นชุดหมายเลขเดียวกัน เช่น หน่วยเพิ่มเติม 1 พร้อมจำนวนบรรจุ 1 เทียบกับหน่วย 1 ราคา ทุน และบาร์โค้ด'],
      ['ตัวอย่างหน่วย','1 กล่อง = 10 แผง: หน่วยเพิ่มเติม=กล่อง, จำนวนบรรจุ=10, เทียบกับหน่วย=แผง'],
      ['หน่วยลำดับถัดไป','1 ลัง = 10 กล่อง: หน่วยเพิ่มเติม=ลัง, จำนวนบรรจุ=10, เทียบกับหน่วย=กล่อง'],
      ['ภาษีมูลค่าเพิ่ม','กรอก ราคารวม VAT แล้ว, ราคายังไม่รวม VAT หรือ ไม่มี VAT'],
      ['วันหมดอายุ','กรอกแบบ วัน/เดือน/ปี เช่น 31/12/2027'],
      ['ข้อสำคัญ','อย่าเปลี่ยนชื่อหัวคอลัมน์ในแถวแรก'],
    ];
    const instructionSheet=XLSX.utils.aoa_to_sheet(instructions);
    instructionSheet['!cols']=[{wch:24},{wch:90}];
    XLSX.utils.book_append_sheet(workbook,instructionSheet,'วิธีกรอก');
    XLSX.writeFile(workbook,'PEPOS-ตัวอย่างนำเข้าสินค้า.xlsx');
    return;
  }
  const headers=Object.keys(example[0]);
  const csv='\uFEFF'+headers.join(',')+'\n'+headers.map(key=>`"${String(example[0][key]).replace(/"/g,'""')}"`).join(',');
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  link.download='PEPOS-ตัวอย่างนำเข้าสินค้า.csv';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
async function applyImportedInventoryTargets(targets){
  const grouped=new Map();
  (targets||[]).forEach(target=>{
    const warehouseId=Number(target.warehouseId)||Number(activeWarehouseId);
    const expectedStock=Number(target.expectedStock)||0;
    const targetStock=Number(target.targetStock)||0;
    if(!warehouseId||targetStock===expectedStock) return;
    const rows=grouped.get(warehouseId)||[];
    rows.push({
      productId:Number(target.productId),expectedStock,targetStock,
      unitName:String(target.unitName||''),selectedLotId:null,
      lotNumber:'',expiry:String(target.expiry||''),
    });
    grouped.set(warehouseId,rows);
  });
  for(const [warehouseId,rows] of grouped){
    for(let index=0;index<rows.length;index+=500){
      const data=await runStockOperation('post_inventory_count_adjustment_with_shortages',{
        warehouseId,reason:'นำเข้าสินค้า Excel',note:'ปรับยอดจากไฟล์นำเข้า',sourceInspectionId:null,
        lines:rows.slice(index,index+500),
      });
      (data?.balances||[]).forEach(balance=>updateInventoryBalanceLocal(balance.productId,balance.warehouseId,balance.stock));
    }
  }
  if(grouped.size) await loadWarehouseInventoryFromSupabase([...grouped.keys()],{force:true});
  return grouped.size;
}

async function importProductsFromExcel(file){
  try{ await ensureXlsxLoaded(); }catch(error){ showToast(error.message||'ไม่สามารถโหลดระบบอ่าน Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'); return; }
  let workbook;
  try{ workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}); }
  catch(error){ showToast('ไม่สามารถอ่านไฟล์ Excel นี้ได้'); return; }
  const firstSheet=workbook.Sheets[workbook.SheetNames[0]];
  const sourceRows=XLSX.utils.sheet_to_json(firstSheet,{defval:'',raw:true});
  if(!sourceRows.length){ showToast('ไม่พบข้อมูลสินค้าในไฟล์'); return; }
  // Import may target a warehouse other than the currently selected one.
  // Load its authoritative balances first so optimistic stock checks are exact.
  const inventoryReady=await loadWarehouseInventoryFromSupabase(accessibleWarehouses().map(warehouse=>warehouse.id),{force:true});
  if(!inventoryReady){ showToast('โหลดสต๊อกล่าสุดก่อนนำเข้าไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่','danger-top'); return; }

  // Track which product id currently "owns" each sku/barcode, so a row that
  // edits an EXISTING product (matched via รหัสอ้างอิงระบบ or a matching sku)
  // doesn't get flagged as conflicting with itself -- only a genuine clash
  // with a DIFFERENT product blocks the row.
  const skuOwner=new Map();
  products.forEach(p=>{ const s=String(p.sku||'').trim().toLowerCase(); if(s) skuOwner.set(s,p.id); });
  const barcodeOwner=new Map();
  products.forEach(p=>{
    [p.barcode,...(p.extraBarcodes||[]),...(p.vendorBarcodes||[]).map(v=>v.code),...(p.units||[]).map(u=>u.barcode)]
      .map(c=>String(c||'').trim().toLowerCase()).filter(Boolean)
      .forEach(c=>barcodeOwner.set(c,p.id));
  });

  const toCreate=[];
  const toUpdate=[]; // {existing,data}
  const skipped=[];
  const seenInFile=new Set();
  const reservedProductIds=new Set(products.map(product=>String(product.id)));
  let stagedNextProductSkuNumber=nextProductSkuNumber;
  sourceRows.forEach((row,index)=>{
    const line=index+2;
    const name=String(productImportValue(row,['ชื่อสินค้า','สินค้า','name'])).trim();
    const unit=String(productImportValue(row,['หน่วยหลัก','หน่วย','unit'])).trim();
    const priceRaw=productImportValue(row,['ราคาขาย (หน่วยหลัก)','ราคาขาย','ขาย','price']);
    const price=productImportNumber(priceRaw,NaN);
    const sku=String(productImportValue(row,['รหัสสินค้า','sku','code'])).trim();
    const barcode=String(productImportValue(row,['บาร์โค้ดหลัก','บาร์โค้ด','barcode'])).trim();
    const extraBarcodes=[];
    const extraBarcodeUnits=[];
    const vendorBarcodes=[];
    const rawUnitRows=[];
    for(let number=1;number<=10;number++){
      const extraAliases=[`บาร์โค้ดสำรอง ${number}`,`บาร์โค้ดสำรอง${number}`,`บาร์โค้ดเพิ่มเติม ${number}`,`บาร์โค้ดเพิ่มเติม${number}`,`extrabarcode${number}`];
      if(number===1) extraAliases.push('บาร์โค้ดสำรอง','บาร์โค้ดเพิ่มเติม','extrabarcode');
      const extraCode=String(productImportValue(row,extraAliases)).trim();
      if(extraCode){
        const extraUnit=String(productImportValue(row,[`หน่วยของบาร์โค้ดสำรอง ${number}`,`หน่วยของบาร์โค้ดสำรอง${number}`,`หน่วยบาร์โค้ดเพิ่มเติม ${number}`,`หน่วยบาร์โค้ดเพิ่มเติม${number}`,`extrabarcodeunit${number}`])).trim()||unit;
        extraBarcodes.push(extraCode);
        extraBarcodeUnits.push(extraUnit);
      }

      const vendorNameAliases=[`ชื่อผู้จำหน่าย ${number}`,`ชื่อผู้จำหน่าย${number}`,`vendor${number}`];
      const vendorCodeAliases=[`บาร์โค้ดผู้จำหน่าย ${number}`,`บาร์โค้ดผู้จำหน่าย${number}`,`บาร์โค้ด vendor ${number}`,`บาร์โค้ดvendor${number}`,`vendorbarcode${number}`];
      if(number===1){ vendorNameAliases.push('ชื่อผู้จำหน่าย','vendor'); vendorCodeAliases.push('บาร์โค้ด vendor','บาร์โค้ดผู้จำหน่าย','vendorbarcode'); }
      const vendor=String(productImportValue(row,vendorNameAliases)).trim();
      const vendorCode=String(productImportValue(row,vendorCodeAliases)).trim();
      if(vendorCode) vendorBarcodes.push({vendor:vendor||'ไม่ระบุ',code:vendorCode});

      const unitAliases=[`หน่วยเพิ่มเติม ${number}`,`หน่วยเพิ่มเติม${number}`,`หน่วยย่อย ${number}`,`additionalunit${number}`];
      if(number===1) unitAliases.push('หน่วยเพิ่มเติม','หน่วยย่อย','additionalunit');
      const sub=String(productImportValue(row,unitAliases)).trim();
      if(sub){
        const per=productImportNumber(productImportValue(row,[`จำนวนบรรจุ ${number}`,`จำนวนบรรจุ${number}`,`จำนวนต่อหน่วย ${number}`,`จำนวนต่อหน่วย${number}`,`บรรจุ ${number}`,`per${number}`]),0);
        const base=String(productImportValue(row,[`เทียบกับหน่วย ${number}`,`เทียบกับหน่วย${number}`,`อ้างอิงหน่วย ${number}`,`อ้างอิงหน่วย${number}`,`หน่วยฐาน ${number}`,`baseunit${number}`])).trim()||unit;
        const unitPrice=productImportNumber(productImportValue(row,[`ราคาขายหน่วยเพิ่มเติม ${number}`,`ราคาขายหน่วยเพิ่มเติม${number}`,`ราคาขายหน่วย ${number}`,`ราคาขายหน่วย${number}`,`unitprice${number}`]),0);
        const unitCost=productImportNumber(productImportValue(row,[`ราคาทุนหน่วยเพิ่มเติม ${number}`,`ราคาทุนหน่วยเพิ่มเติม${number}`,`ราคาทุนหน่วย ${number}`,`ราคาทุนหน่วย${number}`,`unitcost${number}`]),0);
        const unitBarcode=String(productImportValue(row,[`บาร์โค้ดหน่วยเพิ่มเติม ${number}`,`บาร์โค้ดหน่วยเพิ่มเติม${number}`,`บาร์โค้ดหน่วย ${number}`,`บาร์โค้ดหน่วย${number}`,`unitbarcode${number}`])).trim();
        if(per>0) rawUnitRows.push({sub,per,base,price:unitPrice,cost:unitCost,barcode:unitBarcode});
      }
    }
    if(!name||!unit||!Number.isFinite(price)){ skipped.push(`แถว ${line}: ชื่อสินค้า หน่วย หรือราคาขายไม่ครบ`); return; }

    let existing=null;
    const systemId=productImportNumber(productImportValue(row,['รหัสอ้างอิงระบบ (ห้ามแก้)','รหัสอ้างอิงระบบ','systemid']),NaN);
    if(Number.isFinite(systemId)) existing=products.find(p=>p.id===systemId)||null;
    if(!existing&&sku) existing=products.find(p=>String(p.sku||'').trim().toLowerCase()===sku.toLowerCase())||null;
    if(existing&&seenInFile.has(existing.id)){ skipped.push(`แถว ${line}: ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน (${name})`); return; }

    if(sku){
      const owner=skuOwner.get(sku.toLowerCase());
      if(owner!==undefined&&owner!==existing?.id){ skipped.push(`แถว ${line}: รหัสสินค้า ${sku} ซ้ำกับสินค้าอื่นที่มีอยู่แล้ว`); return; }
    }
    const rowBarcodes=[barcode,...extraBarcodes,...vendorBarcodes.map(item=>item.code),...rawUnitRows.map(item=>item.barcode)].filter(Boolean);
    const normalizedRowBarcodes=rowBarcodes.map(code=>code.toLowerCase());
    const repeatedInRow=normalizedRowBarcodes.find((code,position)=>normalizedRowBarcodes.indexOf(code)!==position);
    if(repeatedInRow){ skipped.push(`แถว ${line}: บาร์โค้ด ${repeatedInRow} ซ้ำกันเองในแถวเดียวกัน`); return; }
    const conflictBarcode=normalizedRowBarcodes.find(code=>{ const owner=barcodeOwner.get(code); return owner!==undefined&&owner!==existing?.id; });
    if(conflictBarcode){ skipped.push(`แถว ${line}: บาร์โค้ด ${conflictBarcode} ซ้ำกับสินค้าอื่นที่มีอยู่แล้ว`); return; }

    const category=String(productImportValue(row,['หมวดสินค้า','หมวดหลัก','category'])).trim()||'ไม่ทราบหมวดหมู่';
    const brand=String(productImportValue(row,['ยี่ห้อ / หมวดย่อย','หมวดย่อย','ยี่ห้อ','brand'])).trim()||'ทั่วไป';
    const warehouseValue=String(productImportValue(row,['คลังสินค้า','คลัง','warehouse'])).trim();
    const warehouse=warehouses.find(item=>String(item.id)===warehouseValue||String(item.name||'').trim().toLowerCase()===warehouseValue.toLowerCase()||String(item.code||'').trim().toLowerCase()===warehouseValue.toLowerCase())||activeWarehouse()||warehouses[0];
    const productUnits=rawUnitRows.map(item=>({...item,factor:resolveNetFactor(item.sub,rawUnitRows,unit)}));
    let finalSku=sku||existing?.sku||'';
    if(!finalSku){
      const allocation=allocateReadableProductSku(skuOwner.keys(),stagedNextProductSkuNumber);
      finalSku=allocation.sku;
      stagedNextProductSkuNumber=allocation.nextSequence;
    }
    stagedNextProductSkuNumber=Math.max(stagedNextProductSkuNumber,productSkuSequenceNumber(finalSku)+1);
    const data={
      name,sku:finalSku,barcode,category,brand,unit,price,
      cost:productImportNumber(productImportValue(row,['ราคาทุน (หน่วยหลัก)','ราคาทุน','ทุน','cost']),existing?.cost||0),
      vat:parseProductVatMode(productImportValue(row,['ภาษีมูลค่าเพิ่ม','vat']),existing?.vat||'incl'),
      stock:productImportNumber(productImportValue(row,['จำนวนคงเหลือ (หน่วยหลัก)','จำนวนคงเหลือ','คงเหลือ','stock']),existing?.stock||0),
      expiry:productImportDate(productImportValue(row,['วันหมดอายุ','expiry','expiredate']))||existing?.expiry||'',
      wh:existing?.wh||warehouse?.id||Number(activeWarehouseId)||1,
      desc:String(productImportValue(row,['รายละเอียด','ข้อมูลเพิ่มเติม','description','desc'])).trim(),
      extraBarcodes,extraBarcodeUnits,vendorBarcodes,multiunit:productUnits.length>0,units:productUnits,
    };

    if(existing){
      seenInFile.add(existing.id);
      skuOwner.set(finalSku.toLowerCase(),existing.id);
      normalizedRowBarcodes.forEach(code=>barcodeOwner.set(code,existing.id));
      toUpdate.push({existing,data,inventoryWarehouseId:warehouse?.id||Number(activeWarehouseId)});
    }else{
      const id=generateClientProductId(reservedProductIds);
      reservedProductIds.add(String(id));
      const product={
        id,...data,
        _clientCreateToken:generateProductCreateToken(),
        type:'stock',hasOpening:false,openingDate:'',openingQty:0,openingCost:0,
        lowAlert:true,lowMode:'default',threshold:DEFAULT_LOW_STOCK_THRESHOLD,
      };
      toCreate.push(product);
      skuOwner.set(finalSku.toLowerCase(),id);
      normalizedRowBarcodes.forEach(code=>barcodeOwner.set(code,id));
    }
  });

  if(!toCreate.length&&!toUpdate.length){
    alert(`ไม่สามารถนำเข้าสินค้าได้\n\n${skipped.slice(0,8).join('\n')}${skipped.length>8?`\nและอีก ${skipped.length-8} รายการ`:''}`);
    return;
  }
  const confirmation=`พบข้อมูล ${sourceRows.length} แถว\nจะเพิ่มสินค้าใหม่ ${toCreate.length} รายการ\nจะอัปเดตสินค้าเดิม ${toUpdate.length} รายการ${skipped.length?`\nข้าม ${skipped.length} รายการที่ข้อมูลไม่ครบหรือซ้ำ`:''}\n\nยืนยันนำเข้าหรือไม่?`;
  if(!confirm(confirmation)) return;
  const importStockTargets=[
    ...toCreate.map(product=>({productId:product.id,warehouseId:Number(product.wh)||Number(activeWarehouseId),expectedStock:0,targetStock:Number(product.stock)||0,unitName:product.unit,expiry:product.expiry||''})),
    ...toUpdate.map(({existing,data,inventoryWarehouseId})=>({productId:existing.id,warehouseId:Number(inventoryWarehouseId)||Number(activeWarehouseId),expectedStock:Number(warehouseStock(existing.id,inventoryWarehouseId))||0,targetStock:Number(data.stock)||0,unitName:data.unit||existing.unit,expiry:data.expiry||''})),
  ];
  nextProductSkuNumber=stagedNextProductSkuNumber;
  let contactsChanged=false;
  [...toCreate,...toUpdate.map(u=>u.data)].forEach(product=>{
    if(!categories.includes(product.category)) categories.push(product.category);
    if(!brands.includes(product.brand)) brands.push(product.brand);
    if(!units.includes(product.unit)) units.push(product.unit);
    (product.units||[]).forEach(item=>{
      if(item.sub&&!units.includes(item.sub)) units.push(item.sub);
    });
    (product.vendorBarcodes||[]).forEach(item=>{
      const vendorName=String(item.vendor||'').trim();
      if(!vendorName||vendorName==='ไม่ระบุ') return;
      const existingContact=contacts.find(contact=>String(contact.name||'').trim().toLowerCase()===vendorName.toLowerCase());
      if(existingContact){
        if(!Array.isArray(existingContact.types)) existingContact.types=[];
        if(!existingContact.types.includes('supplier')){
          existingContact.types.push('supplier');
          contactsChanged=true;
        }
        return;
      }
      contacts.push({
        id:generateClientRecordId(contacts),name:vendorName,entity:'juristic',types:['supplier'],contactName:'',phone:'',email:'',taxId:'',creditDays:'',address:'',bank:'',bankAcc:'',note:'เพิ่มจากการนำเข้าสินค้า Excel'
      });
      contactsChanged=true;
    });
  });
  if(contactsChanged) persistContacts();
  toUpdate.forEach(({existing,data})=>{
    const catalogExpiry=existing._catalogExpiry;
    const currentStock=Number(existing.stock)||0;
    Object.assign(existing,{...data,stock:currentStock,expiry:existing.expiry||''});
    existing._catalogExpiry=catalogExpiry;
  });
  toCreate.forEach(product=>{ product.stock=0; product.expiry=''; });
  products.push(...toCreate);
  rebuildProductLookupMaps();
  productPage=1;
  const productCacheSaved=await persistWorkspaceData({productChanges:{insertedIds:toCreate.map(product=>product.id),updatedIds:toUpdate.map(entry=>entry.existing.id)}});
  if(!productCacheSaved){ showToast('นำเข้าข้อมูลแล้ว แต่เก็บสำเนาสินค้าในเครื่องไม่สำเร็จ กรุณาอย่าเพิ่งปิดหน้านี้','danger-top'); return; }
  await syncCoreDataToSupabase();
  if(syncUiState!=='synced'){
    showToast('บันทึกข้อมูลสินค้าแล้ว แต่ยังไม่ปรับสต๊อก เพราะซิงก์สินค้าไปเซิร์ฟเวอร์ไม่สำเร็จ กรุณากดซิงก์แล้วนำเข้าอีกครั้ง','danger-top');
    render();
    return;
  }
  try{
    await applyImportedInventoryTargets(importStockTargets);
  }catch(error){
    console.error('apply imported inventory targets',error);
    showToast(`นำเข้าข้อมูลสินค้าแล้ว แต่ปรับสต๊อกไม่สำเร็จ: ${error?.message||'กรุณาตรวจสอบรายการในหน้าตรวจนับและปรับสต๊อก'}`,'danger-top');
    render();
    return;
  }
  showToast(`นำเข้าสินค้าสำเร็จ · เพิ่มใหม่ ${toCreate.length} · อัปเดต ${toUpdate.length}${skipped.length?` · ข้าม ${skipped.length}`:''}`);
  render();
}

async function exportProductsToExcel(){
  try{ await ensureXlsxLoaded(); }catch(error){ showToast(error.message||'ไม่สามารถโหลดระบบส่งออก Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'); return; }
  if(!products.length){ showToast('ยังไม่มีข้อมูลให้ส่งออก'); return; }
  const counts=productExcelColumnCounts(products);
  const rows=products.map(product=>productToExcelRow(product,counts));
  const sheet=XLSX.utils.json_to_sheet(rows);
  sheet['!cols']=Object.keys(rows[0]).map(productExcelColumnWidth);
  sheet['!autofilter']={ref:sheet['!ref']};
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,sheet,'สินค้า');
  XLSX.writeFile(workbook,`PEPOS-รายการสินค้า-${TODAY_STR}.xlsx`);
  showToast(`ส่งออกรายการสินค้า ${rows.length} รายการแล้ว`);
}
