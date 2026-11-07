// Excel import/export feature bundle. Loaded only when an Excel action is used.
function createTaxReportWorkbook(report,writer){
  if(!['sales','purchases'].includes(report.type)) throw new Error('กรุณาเลือกรายงานที่ต้องการส่งออก');
  const book=new writer.Workbook();
  const definitions=[
    {key:'sales',name:'ภาษีขาย',rows:report.sales,headers:['วันที่','เลขที่บิล','คลังสินค้า','มูลค่าก่อน VAT','VAT','ยอดรวม'],widths:[16,26,24,20,18,20],numeric:4},
    {key:'purchases',name:'ภาษีซื้อ',rows:report.purchases,headers:['วันที่ใบกำกับ','เลขที่ใบกำกับผู้จำหน่าย','ผู้จำหน่าย','เอกสารรับเข้า','สถานะ','มูลค่าก่อน VAT','VAT','ยอดรวม'],widths:[16,28,32,26,30,20,18,20],numeric:6}
  ];
  for(const def of definitions.filter(def=>def.key===report.type)){
    const sheet=book.addWorksheet(def.name),columns=def.headers.length;
    sheet.columns=def.widths.map(width=>({width}));
    for(const text of [`รายงาน${def.name}`,report.business,`เดือน ${report.month} · ทั้งหมด ${def.rows.length} รายการ`]){
      const row=sheet.addRow([String(text||'')]);sheet.mergeCells(row.number,1,row.number,columns);row.height=26;
    }
    sheet.addRow(def.headers);
    def.rows.forEach(values=>{const row=sheet.addRow(values.map((value,index)=>index+1>=def.numeric?Number(value)||0:String(value??'')));row.height=32;});
    const totals=sheet.addRow([def.name==='ภาษีซื้อ'?'รวมรายการที่ข้อมูลครบทั้งเดือน':'รวมทั้งเดือน']);
    sheet.mergeCells(totals.number,1,totals.number,def.numeric-1);
    for(let column=def.numeric;column<=columns;column++){
      const eligible=def.name==='ภาษีซื้อ'?def.rows.filter(row=>row[4]==='ข้อมูลครบ'):def.rows;
      const result=eligible.reduce((sum,row)=>sum+(Number(row[column-1])||0),0);
      const letter=String.fromCharCode(64+column),last=4+def.rows.length;
      totals.getCell(column).value=def.rows.length?{formula:def.name==='ภาษีซื้อ'?`SUMIF(E5:E${last},"ข้อมูลครบ",${letter}5:${letter}${last})`:`SUM(${letter}5:${letter}${last})`,result}:0;
      sheet.getColumn(column).numFmt='#,##0.00';
    }
    sheet.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{cell.font={name:'Sarabun',size:11};cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};}));
    for(const number of [1,4,totals.number]) sheet.getRow(number).eachCell(cell=>{cell.font={name:'Sarabun',size:number===1?16:11,bold:true};});
    sheet.getRow(4).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF4F4038'}};cell.font={name:'Sarabun',size:11,bold:true,color:{argb:'FFFFFFFF'}};});
    sheet.autoFilter={from:{row:4,column:1},to:{row:4,column:columns}};
    sheet.views=[{state:'frozen',ySplit:4}];
    sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:4'};
  }
  return book;
}
async function exportTaxReportToExcel(report){
  if(!['sales','purchases'].includes(report.type)||!canPerformPageAction('export','rtax')||!isWorkspaceReadCurrent(report.context)) return;
  const writer=await ensureProductExcelWriterLoaded(),book=createTaxReportWorkbook(report,writer);
  const buffer=await book.xlsx.writeBuffer();
  if(!isWorkspaceReadCurrent(report.context)) return;
  const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');
  const title=report.type==='sales'?'ภาษีขาย':'ภาษีซื้อ';
  link.href=url;link.download=`SAPURI-รายงาน${title}-${report.month}.xlsx`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  showToast(`ส่งออก${title} ${report[report.type].length} รายการแล้ว`);
}

function createVoidReportWorkbook(report,writer){
  const book=new writer.Workbook(),sheet=book.addWorksheet('บิลยกเลิก');
  sheet.columns=[22,24,16,24,24,50,18,36].map(width=>({width}));
  for(const text of [report.title,report.business,`วันที่ยกเลิก ${fmtDate(report.range.from)} ถึง ${fmtDate(report.range.to)}`,report.filters,`บิลยกเลิก ${report.rows.length} บิล · ยอดคืนรวม ${fmtMoney(report.rows.reduce((sum,row)=>sum+row[6],0))} บาท`]){
    const row=sheet.addRow([String(text||'')]);sheet.mergeCells(row.number,1,row.number,8);row.height=28;
  }
  sheet.addRow(report.headers);
  report.rows.forEach(values=>{const row=sheet.addRow(values.map((value,index)=>index===6?Number(value):String(value??'')));row.height=Math.max(44,Math.min(409,12+16*Math.max(...values.map((value,index)=>String(value??'').split('\n').reduce((lines,line)=>lines+Math.max(1,Math.ceil(line.length/Math.max(8,sheet.columns[index].width-4))),0)))));row.getCell(7).numFmt='#,##0.00';});
  const totalRow=sheet.addRow(['ยอดคืนรวม','','','','','',report.rows.reduce((sum,row)=>sum+row[6],0),'']);totalRow.getCell(7).numFmt='#,##0.00';
  sheet.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{cell.font={name:'Sarabun',size:11};cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};}));
  [1,6,totalRow.number].forEach(number=>sheet.getRow(number).eachCell({includeEmpty:true},cell=>{cell.font={name:'Sarabun',size:number===1?16:11,bold:true};}));
  sheet.getRow(6).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF4F4038'}};cell.font={name:'Sarabun',bold:true,color:{argb:'FFFFFFFF'}};});
  sheet.autoFilter='A6:H6';sheet.views=[{state:'frozen',ySplit:6}];
  sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:6'};
  return book;
}
async function exportVoidReportToExcel(report){
  if(!canPerformPageAction('export','rvoid')){showToast('ไม่มีสิทธิ์ส่งออกข้อมูล','danger-top');return;}
  const writer=await ensureProductExcelWriterLoaded(),book=createVoidReportWorkbook(report,writer);
  const buffer=await book.xlsx.writeBuffer();
  if(!isWorkspaceReadCurrent(report.context)) return;
  const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');
  link.href=url;link.download=`SAPURI-บิลยกเลิก-${report.range.from}-${report.range.to}.xlsx`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  showToast(`ส่งออกบิลยกเลิก ${report.rows.length} รายการแล้ว`);
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
  const warehouseId=Number(activeWarehouseId);
  if(!warehouseId||isAllWarehousesMode())return;
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
  const stagedCustomerPhones=new Set();
  if(warehouseId!==Number(activeWarehouseId)||isAllWarehousesMode())return;
  const localContacts=storeContacts();
  const outsideStoreIds=new Set(contacts.filter(c=>(Number(c.warehouseId)||1)!==warehouseId).map(c=>Number(c.id)));

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
      phone:formatPhoneValue(productImportValue(row,['เบอร์มือถือ','เบอร์โทร','phone'])),
      bank:String(productImportValue(row,['ธนาคาร','bank'])).trim(),
      bankName:String(productImportValue(row,['ชื่อบัญชี','bankname'])).trim(),
      bankAcc:String(productImportValue(row,['เลขที่บัญชี','bankacc'])).trim(),
      accType:contactImportAccType(productImportValue(row,['ประเภทบัญชี','acctype'])),
      note:String(productImportValue(row,['โน๊ต','หมายเหตุ','note'])).trim(),
    };
    let existing=null;
    const systemId=productImportNumber(productImportValue(row,['รหัสอ้างอิงระบบ','systemid']),NaN);
    if(outsideStoreIds.has(systemId)){skipped.push(`แถว ${line} · ${name}: รหัสอ้างอิงเป็นรายชื่อของคลังอื่น`);return;}
    if(Number.isFinite(systemId)) existing=localContacts.find(c=>c.id===systemId);
    if(!existing&&code) existing=localContacts.find(c=>String(c.code||'').trim().toLowerCase()===code.toLowerCase());
    if(!existing) existing=localContacts.find(c=>String(c.name||'').trim().toLowerCase()===name.toLowerCase());
    if(existing){
      if(seenInFile.has(existing.id)){ skipped.push(`แถว ${line}: ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน (${name})`); return; }
      seenInFile.add(existing.id);
    }
    if(data.types.includes('customer')){
      const phoneDigits=normalizedPhoneDigits(data.phone);
      if(!phoneDigits){ skipped.push(`แถว ${line}: ลูกค้าไม่มีเบอร์โทร (${name})`); return; }
      const duplicate=duplicateCustomerPhone(data.phone,existing?.id);
      if(duplicate||stagedCustomerPhones.has(phoneDigits)){
        skipped.push(`แถว ${line}: เบอร์โทรลูกค้าซ้ำ (${data.phone})`); return;
      }
      stagedCustomerPhones.add(phoneDigits);
    }
    if(existing){
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
  toCreate.forEach(data=>contacts.push({id:generateClientRecordId(contacts),warehouseId,...data}));
  persistContacts();
  showToast(`นำเข้าสมุดรายชื่อสำเร็จ · เพิ่มใหม่ ${toCreate.length} · อัปเดต ${toUpdate.length}${skipped.length?` · ข้าม ${skipped.length}`:''}`);
  render();
}

async function exportContactsToExcel(){
  try{ await ensureXlsxLoaded(); }catch(error){ showToast(error.message||'ไม่สามารถโหลดระบบส่งออก Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'); return; }
  const selectedContacts=storeContacts().filter(c=>c.types?.includes(currentTab==='customers'?'customer':'supplier'));
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
async function loadSalesRepresentativeExcelDetails(warehouseId){
  const [assignmentResult,noteResult]=await Promise.all([
    fetchAllRows(()=>sb.from('sales_representative_products').select('representative_id,product_id,created_at,updated_at,sales_representatives!inner(warehouse_id)').eq('sales_representatives.warehouse_id',warehouseId).order('representative_id').order('product_id')),
    fetchAllRows(()=>sb.from('notes').select(NOTE_ROW_SELECT).eq('representative_warehouse_id',warehouseId).not('activity_type','is',null).order('event_date',{ascending:false}).order('updated_at',{ascending:false}).order('id'))
  ]);
  if(assignmentResult.error) throw assignmentResult.error;
  if(noteResult.error) throw noteResult.error;
  return {
    assignments:(assignmentResult.data||[]).map(row=>({representativeId:Number(row.representative_id),productId:Number(row.product_id),createdAt:row.created_at||'',updatedAt:row.updated_at||''})),
    notes:(noteResult.data||[]).map(mapNoteRow),
  };
}
async function importSalesRepresentativesFromExcel(file){
  const warehouseId=Number(activeWarehouseId);
  try{ await ensureXlsxLoaded(); }catch(error){ showToast(error.message||'ไม่สามารถโหลดระบบอ่าน Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'); return; }
  let workbook;
  try{ workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}); }
  catch(error){ showToast('ไม่สามารถอ่านไฟล์ Excel นี้ได้'); return; }
  const firstSheet=workbook.Sheets[workbook.SheetNames[0]];
  const sourceRows=XLSX.utils.sheet_to_json(firstSheet,{defval:'',raw:true});
  if(!sourceRows.length){ showToast('ไม่พบรายชื่อผู้แทนในไฟล์'); return; }
  if(!warehouseId||warehouseId!==Number(activeWarehouseId)||isAllWarehousesMode())return;
  const localReps=storeRepresentatives();
  const outsideIds=new Set(salesRepresentatives.filter(r=>!documentInActiveStore(r)).map(r=>Number(r.id)));

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
    if(outsideIds.has(systemId)){skipped.push(`แถว ${line}: ผู้แทนเป็นของร้านอื่น`);return;}
    if(Number.isFinite(systemId)) existing=localReps.find(representative=>representative.id===systemId)||null;
    if(!existing&&legacyCode) existing=localReps.find(representative=>String(representative.code||'').trim().toLowerCase()===legacyCode.toLowerCase())||null;
    if(!existing) existing=localReps.find(representative=>String(representative.name||'').trim().toLowerCase()===normalizedName)||null;
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
      purchaseOrders.forEach(document=>{ if(documentInActiveStore(document)&&document.supplier===oldName) document.supplier=data.name; });
      if(poDraft?.supplier===oldName) poDraft.supplier=data.name;
    }
  });
  toCreate.forEach(data=>salesRepresentatives.push({id:generateClientRecordId(salesRepresentatives),warehouseId,...data}));
  persistWorkspaceData();
  showToast(`นำเข้ารายชื่อผู้แทนสำเร็จ · เพิ่มใหม่ ${toCreate.length} · อัปเดต ${toUpdate.length}${skipped.length?` · ข้าม ${skipped.length}`:''}`);
  render();
}
async function exportSalesRepresentativesToExcel(){
  const warehouseId=activeWarehouseId;
  const button=document.getElementById('exportSalesRepsBtn');
  const originalLabel=button?.textContent||'ส่งออก Excel';
  if(button){ button.disabled=true; button.textContent='กำลังเตรียม Excel…'; }
  try{
    await ensureXlsxLoaded();
    if(warehouseId!==activeWarehouseId||isAllWarehousesMode())return;
    const representatives=storeRepresentatives();
    if(!representatives.length){ showToast('ยังไม่มีรายชื่อผู้แทนให้ส่งออก'); return; }
    const details=await loadSalesRepresentativeExcelDetails(warehouseId);
    if(warehouseId!==activeWarehouseId||isAllWarehousesMode())return;
    const {representativeRows,noteRows,productRows}=salesRepresentativeExportRows(representatives,details.assignments,details.notes,products);
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
  const text=String(value??'').replace(/,/g,'').trim();
  if(!text) return fallback;
  const number=Number(text);
  return Number.isFinite(number)?number:fallback;
}
function productImportMoney(value,fallback=0){
  return String(value??'').trim()===''?fallback:productImportNumber(value,NaN);
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
// Keep the styled writer isolated from the existing XLSX import/read library.
let productExcelWriterLoadPromise=null;
function ensureProductExcelWriterLoaded(){
  if(window.ProductExcelWriter?.Workbook) return Promise.resolve(window.ProductExcelWriter);
  if(productExcelWriterLoadPromise) return productExcelWriterLoadPromise;
  productExcelWriterLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const timeout=setTimeout(()=>fail(),30000);
    const fail=()=>{ clearTimeout(timeout); script.remove(); reject(new Error('โหลดระบบส่งออก Excel สีไม่สำเร็จ กรุณาลองใหม่')); };
    script.src=`/vendor/product-excel-writer.js${APP_ASSET_VERSION?`?v=${encodeURIComponent(APP_ASSET_VERSION)}`:''}`;
    script.async=true;
    script.onload=()=>{
      clearTimeout(timeout);
      if(window.ProductExcelWriter?.Workbook) resolve(window.ProductExcelWriter);
      else fail();
    };
    script.onerror=fail;
    document.head.appendChild(script);
  }).catch(error=>{ productExcelWriterLoadPromise=null; throw error; });
  return productExcelWriterLoadPromise;
}
const PRODUCT_EXCEL_MIN_REPEAT_COLUMNS=2;
function productExcelColumnCounts(productRows=[]){
  const bounded=value=>Math.max(PRODUCT_EXCEL_MIN_REPEAT_COLUMNS,value);
  const longest=selector=>productRows.reduce((maximum,product)=>Math.max(maximum,selector(product)),0);
  return {
    extraBarcodes:bounded(longest(product=>(product.extraBarcodes||[]).length)),
    vendors:bounded(longest(product=>(product.vendorBarcodes||[]).length)),
    units:bounded(longest(product=>(product.units||[]).length)),
  };
}
function productExcelHeaders(counts){
  const headers=['รหัสสินค้า','ชื่อสินค้า','สถานะสินค้า','หมวดสินค้า','ยี่ห้อ / หมวดย่อย','หน่วยหลัก','ราคาขาย (หน่วยหลัก)','ราคาทุน (หน่วยหลัก)','บาร์โค้ดหลัก','ภาษีมูลค่าเพิ่ม','คลังสินค้า','จำนวนคงเหลือ (หน่วยหลัก)','วันหมดอายุ (สำหรับดูข้อมูล)','รายละเอียด'];
  for(let number=1;number<=counts.units;number++){
    headers.push(`หน่วยเพิ่มเติม ${number}`,`จำนวนบรรจุ ${number}`,`เทียบกับหน่วย ${number}`,`ราคาขายหน่วยเพิ่มเติม ${number}`,`ราคาทุนหน่วยเพิ่มเติม ${number}`,`บาร์โค้ดหน่วยเพิ่มเติม ${number}`);
  }
  for(let number=1;number<=counts.extraBarcodes;number++) headers.push(`หน่วยของบาร์โค้ดสำรอง ${number}`,`บาร์โค้ดสำรอง ${number}`);
  for(let number=1;number<=counts.vendors;number++) headers.push(`ชื่อผู้จำหน่าย ${number}`,`บาร์โค้ดผู้จำหน่าย ${number}`);
  headers.push('รหัสอ้างอิงระบบ (ห้ามแก้)');
  return headers;
}
function productExcelColumnWidth(header){
  if(header==='สถานะสินค้า') return {wch:42};
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
    'สถานะสินค้า':productExcelReviewPresentation(product).label,
    'หมวดสินค้า':product.category||'',
    'ยี่ห้อ / หมวดย่อย':product.brand||'',
    'หน่วยหลัก':product.unit||'',
    'ราคาขาย (หน่วยหลัก)':product.price||0,
    'ราคาทุน (หน่วยหลัก)':product.cost||0,
    'บาร์โค้ดหลัก':product.barcode||'',
    'ภาษีมูลค่าเพิ่ม':productVatModeLabel(product.vat),
    'คลังสินค้า':warehouseRows.find(warehouse=>Number(warehouse.id)===Number(selectedWarehouseId||product.wh))?.name||'',
    'จำนวนคงเหลือ (หน่วยหลัก)':exportStock,
    'วันหมดอายุ (สำหรับดูข้อมูล)':exportExpiry?fmtDateShort(exportExpiry):'',
    'รายละเอียด':product.desc||'',
  };
  for(let number=1;number<=counts.units;number++){
    const unit=(product.units||[])[number-1];
    values[`หน่วยเพิ่มเติม ${number}`]=unit?.sub||'';
    values[`จำนวนบรรจุ ${number}`]=unit?.per||'';
    values[`เทียบกับหน่วย ${number}`]=unit?.base||'';
    values[`ราคาขายหน่วยเพิ่มเติม ${number}`]=unit?.price??'';
    values[`ราคาทุนหน่วยเพิ่มเติม ${number}`]=unit?.cost??'';
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
function productExcelReviewPresentation(product){
  const status=productDataReviewStatus(product);
  if(status==='pending') return {label:'สีเหลือง - กำลังแก้ไข / รอข้อมูล',fill:'FFF8E1'};
  if(status==='complete') return {label:'สีเขียว - ข้อมูลครบถ้วน',fill:'EFF9F1'};
  return {label:'สีปกติ - ยังไม่กำหนดสถานะ',fill:null};
}
function createProductExcelWorkbook(rows,writer){
  const workbook=new writer.Workbook();
  const sheet=workbook.addWorksheet('สินค้า',{views:[{state:'frozen',ySplit:1}]});
  const headers=Object.keys(rows[0]);
  if(headers.length>16384) throw new Error('ข้อมูลมีจำนวนคอลัมน์เกินขีดจำกัด Excel กรุณาส่งออกสินค้าทีละกลุ่ม');
  sheet.columns=headers.map(header=>({header,key:header,width:productExcelColumnWidth(header).wch}));
  sheet.addRows(rows);
  const expiryColumn=headers.indexOf('วันหมดอายุ (สำหรับดูข้อมูล)')+1;
  if(expiryColumn) sheet.getCell(1,expiryColumn).note='สำหรับดูข้อมูลเท่านั้น แก้วันหมดอายุที่ LOT ของสินค้า ระบบไม่นำเข้าวันหมดอายุจากไฟล์นี้';
  sheet.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:headers.length}};
  sheet.eachRow((row,number)=>row.eachCell({includeEmpty:true},cell=>{
    cell.font={name:'Tahoma',size:11,color:{argb:'FF222222'},bold:number===1};
    cell.alignment={vertical:'middle'};
    // Never bake the old status colour into a cell: changing back to normal must clear it.
    if(number===1) cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEEE9E5'}};
  }));
  const statusColumn=sheet.getColumn('สถานะสินค้า').letter;
  const options=['','pending','complete'].map(dataReviewStatus=>productExcelReviewPresentation({dataReviewStatus}));
  for(let row=2;row<=rows.length+1;row++){
    sheet.getCell(`${statusColumn}${row}`).dataValidation={
      type:'list',allowBlank:true,formulae:[`"${options.map(option=>option.label).join(',')}"`],
      showErrorMessage:true,errorStyle:'stop',errorTitle:'สถานะสินค้าไม่ถูกต้อง',
      error:'กรุณาเลือกสีปกติ สีเหลือง หรือสีเขียวจากรายการ',
      showInputMessage:true,promptTitle:'สถานะสินค้า',prompt:'เลือกสถานะเพื่อเปลี่ยนสีทั้งแถว ช่องว่างจะคงสถานะเดิมเมื่อนำเข้า',
    };
  }
  sheet.addConditionalFormatting({
    ref:`A2:${sheet.getColumn(headers.length).letter}${rows.length+1}`,
    rules:options.filter(option=>option.fill).map((option,index)=>({
      type:'expression',priority:index+1,formulae:[`$${statusColumn}2="${option.label}"`],
      // Excel conditional-format DXFs use bgColor for the background, unlike normal cell fills.
      style:{fill:{type:'pattern',pattern:'solid',bgColor:{argb:`FF${option.fill}`}}},
    })),
  });
  return workbook;
}
function parseProductImportReviewStatus(value){
  const text=String(value??'').trim().toLowerCase();
  if(!text) return undefined; // Old files / blank cells preserve the server-backed status.
  const choices=[['normal','สีปกติ',''],['pending','สีเหลือง','pending'],['complete','สีเขียว','complete']];
  for(const [code,colour,status] of choices){
    if([code,colour,productExcelReviewPresentation({dataReviewStatus:status}).label].includes(text)) return status;
  }
  throw new Error('สถานะสินค้าไม่ถูกต้อง กรุณาเลือกสีปกติ สีเหลือง หรือสีเขียว');
}
function productImportReviewFields(status,existing,changedAt,changedBy){
  if(status===undefined||status===productDataReviewStatus(existing)) return {};
  return {
    dataReviewStatus:status,dataReviewUpdatedAt:status?changedAt:'',dataReviewUpdatedBy:status?changedBy:'',
    dataReviewedAt:status==='complete'?changedAt:'',dataReviewedBy:status==='complete'?changedBy:'',
  };
}
function productImportRepeatNumbers(sourceRows){
  const numbers=new Set([1,2]);
  for(const row of sourceRows) for(const header of Object.keys(row)){
    const match=productImportHeader(header).match(/^(?:หน่วยเพิ่มเติม|หน่วยย่อย|additionalunit|จำนวนบรรจุ|จำนวนต่อหน่วย|บรรจุ|per|เทียบกับหน่วย|อ้างอิงหน่วย|หน่วยฐาน|baseunit|ราคาขายหน่วยเพิ่มเติม|ราคาขายหน่วย|unitprice|ราคาทุนหน่วยเพิ่มเติม|ราคาทุนหน่วย|unitcost|บาร์โค้ดหน่วยเพิ่มเติม|บาร์โค้ดหน่วย|unitbarcode|บาร์โค้ดสำรอง|บาร์โค้ดเพิ่มเติม|extrabarcode|หน่วยของบาร์โค้ดสำรอง|หน่วยบาร์โค้ดเพิ่มเติม|extrabarcodeunit|ชื่อผู้จำหน่าย|vendor|บาร์โค้ดผู้จำหน่าย|บาร์โค้ดvendor|vendorbarcode)(\d+)$/);
    if(match&&Number(match[1])<=16384) numbers.add(Number(match[1]));
  }
  return [...numbers].sort((a,b)=>a-b);
}
function productImportChanges(existing,data){
  if(!existing) return 'เพิ่มสินค้าใหม่';
  const counts=productExcelColumnCounts([existing,data]);
  const before=productToExcelRow(existing,counts),after=productToExcelRow({...existing,...data},counts);
  const ignored=new Set(['คลังสินค้า','จำนวนคงเหลือ (หน่วยหลัก)','วันหมดอายุ (สำหรับดูข้อมูล)','รหัสอ้างอิงระบบ (ห้ามแก้)']);
  return Object.keys(after).filter(key=>!ignored.has(key)&&String(before[key])!==String(after[key]))
    .map(key=>`${key} · ${before[key]===''?'ว่าง':before[key]} → ${after[key]===''?'ว่าง':after[key]}`).join('\n')||'ข้อมูลสินค้าตรงกับเดิม';
}
function showProductImportDialog(entries,skipped,{result=false}={}){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='modal-overlay product-import-overlay';
    overlay.innerHTML=`<div class="modal product-import-modal" role="dialog" aria-modal="true" aria-labelledby="productImportTitle">
      <div class="modal-head"><h3 id="productImportTitle">${result?'ผลการนำเข้าสินค้า':'ตรวจสอบก่อนนำเข้าสินค้า'}</h3><button class="modal-close" type="button" aria-label="ปิด">×</button></div>
      <div class="product-import-body">
        <p id="productImportSummary"></p>
        ${result?'':'<label class="product-import-stock-option"><input id="productImportStock" type="checkbox"> ปรับจำนวนคงเหลือด้วย</label><p>ช่องจำนวนว่างจะคงสต๊อกเดิม เลข 0 หมายถึงปรับเป็นศูนย์ ตรวจยอดปัจจุบันและยอดใหม่ก่อนยืนยัน</p>'}
        <p>วันหมดอายุใน Excel เป็นข้อมูลสำหรับดูเท่านั้น ค่าที่แก้ในไฟล์จะไม่ถูกบันทึก กรุณาแก้วันหมดอายุที่ LOT ของสินค้า</p>
        <div class="product-import-table-wrap"><table class="grid-table"><thead><tr><th>แถว</th><th>สินค้า</th><th>รายละเอียด</th><th>สถานะ</th></tr></thead><tbody id="productImportRows"></tbody></table></div>
        <div class="product-import-pages"><button type="button" class="btn ghost" id="productImportPrev">ก่อนหน้า</button><span id="productImportPage"></span><button type="button" class="btn ghost" id="productImportNext">ถัดไป</button></div>
      </div><div class="product-import-footer"><button type="button" class="btn ghost" id="productImportCancel">${result?'ปิด':'ยกเลิก'}</button>${result?'':'<button type="button" class="btn primary" id="productImportConfirm">ยืนยันนำเข้า</button>'}</div></div>`;
    document.body.appendChild(overlay);
    let page=0;
    const stock=overlay.querySelector('#productImportStock');
    const rows=[...entries,...skipped];
    const draw=()=>{
      const enabled=!!stock?.checked;
      const blocked=enabled&&entries.some(entry=>entry.stockError);
      overlay.querySelector('#productImportSummary').textContent=result
        ?['สำเร็จ','รอซิงก์','ไม่สำเร็จ',...(skipped.some(row=>row.status==='ข้าม')?['ข้าม']:[])].map(status=>`${status} ${rows.filter(row=>row.status===status).length} รายการ`).join(' · ')
        :`เพิ่มใหม่ ${entries.filter(entry=>!entry.existing).length} · อัปเดต ${entries.filter(entry=>entry.existing).length} · ข้าม ${skipped.length}${blocked?' · กรุณาแก้แถวที่ปรับสต๊อกไม่ได้ หรือเอาติ๊กปรับสต๊อกออก':''}`;
      overlay.querySelector('#productImportRows').innerHTML=rows.slice(page*50,(page+1)*50).map(entry=>{
        const stockDetail=enabled?(entry.stockError||entry.stockDetail||''):'';
        const detail=result?entry.detail:[entry.detail,stockDetail,entry.expiryNotice].filter(Boolean).join('\n');
        return `<tr><td>${escapeHtml(String(entry.line))}</td><td>${escapeHtml(entry.name)}</td><td class="product-import-detail">${escapeHtml(detail)}</td><td>${escapeHtml(entry.status||(enabled&&entry.stockError?'ปรับสต๊อกไม่ได้':'พร้อมนำเข้า'))}</td></tr>`;
      }).join('');
      overlay.querySelector('#productImportPage').textContent=`${page+1} / ${Math.max(1,Math.ceil(rows.length/50))}`;
      overlay.querySelector('#productImportPrev').disabled=page===0;
      overlay.querySelector('#productImportNext').disabled=(page+1)*50>=rows.length;
      const submit=overlay.querySelector('#productImportConfirm');
      if(submit) submit.disabled=blocked||!entries.length;
    };
    const close=value=>{overlay.remove();resolve(value);};
    overlay.querySelector('.modal-close').onclick=()=>close(null);
    overlay.querySelector('#productImportCancel').onclick=()=>close(null);
    overlay.querySelector('#productImportConfirm')?.addEventListener('click',()=>close({adjustStock:stock.checked}));
    overlay.querySelector('#productImportPrev').onclick=()=>{page--;draw();};
    overlay.querySelector('#productImportNext').onclick=()=>{page++;draw();};
    if(stock) stock.onchange=()=>{page=0;draw();};
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(null);}});
    draw();
    overlay.querySelector('#productImportCancel').focus();
  });
}
async function applyImportedInventoryTargets(targets,onApplied=()=>{}){
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
      onApplied(rows.slice(index,index+500).map(row=>row.productId));
      (data?.balances||[]).forEach(balance=>updateInventoryBalanceLocal(balance.productId,balance.warehouseId,balance.stock));
    }
  }
  if(grouped.size) await loadWarehouseInventoryFromSupabase([...grouped.keys()],{force:true});
  return grouped.size;
}

let productExcelImportBusy=false;
async function importProductsFromExcel(file){
  if(productExcelImportBusy){ showToast('กำลังตรวจสอบหรือนำเข้าไฟล์ กรุณารอให้เสร็จก่อน'); return; }
  productExcelImportBusy=true;
  try{ await performProductExcelImport(file); }
  finally{ productExcelImportBusy=false; }
}
async function performProductExcelImport(file){
  const context=captureWorkspaceRead(),importWarehouseId=activeWarehouseId;
  try{ await ensureXlsxLoaded(); }catch(error){ showToast(error.message||'ไม่สามารถโหลดระบบอ่าน Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'); return; }
  let workbook;
  try{ workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}); }
  catch(error){ showToast('ไม่สามารถอ่านไฟล์ Excel นี้ได้'); return; }
  const firstSheet=workbook.Sheets[workbook.SheetNames[0]];
  const sourceRows=XLSX.utils.sheet_to_json(firstSheet,{defval:'',raw:true});
  if(!sourceRows.length){ showToast('ไม่พบข้อมูลสินค้าในไฟล์'); return; }
  const warehouse=activeWarehouse();
  if(!warehouse||isAllWarehousesMode()||!isWorkspaceReadCurrent(context))return;
  const inventoryReady=await loadWarehouseInventoryFromSupabase([warehouse.id],{force:true});
  if(!inventoryReady){ showToast('โหลดสต๊อกล่าสุดก่อนนำเข้าไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่','danger-top'); return; }
  if(!isWorkspaceReadCurrent(context)) return;

  // Track which product id currently "owns" each sku/barcode, so a row that
  // edits an EXISTING product (matched via รหัสอ้างอิงระบบ or a matching sku)
  // doesn't get flagged as conflicting with itself -- only a genuine clash
  // with a DIFFERENT product blocks the row.
  const skuOwner=new Map();
  products.forEach(p=>{ const s=String(p.sku||'').trim().toLowerCase(); if(s) skuOwner.set(s,p.id); });
  const barcodeOwner=new Map();
  products.forEach(p=>{
    productBarcodeCodes(p).forEach(c=>barcodeOwner.set(c,p.id));
  });

  const toCreate=[];
  const toUpdate=[]; // {existing,data}
  const skipped=[];
  const existingCopies=[];
  const entries=[];
  const repeatNumbers=productImportRepeatNumbers(sourceRows);
  const catalogAtPreview=JSON.stringify(products.map(productMetadataToRow));
  const seenInFile=new Set();
  const fullCatalog=completeProductCatalog();
  const reservedProductIds=new Set(fullCatalog.map(product=>String(product.id)));
  const outsideStoreIds=new Set(fullCatalog.filter(p=>Number(p.wh||1)!==Number(activeWarehouseId)).map(p=>Number(p.id)));
  let stagedNextProductSkuNumber=nextProductSkuNumber;
  sourceRows.forEach((row,index)=>{
    const line=(row.__rowNum__??index+1)+1;
    let reviewStatus;
    try{ reviewStatus=parseProductImportReviewStatus(productImportValue(row,['สถานะสินค้า','dataReviewStatus'])); }
    catch(error){ skipped.push(`แถว ${line}: ${error.message}`); return; }
    const name=String(productImportValue(row,['ชื่อสินค้า','สินค้า','name'])).trim();
    const unit=String(productImportValue(row,['หน่วยหลัก','หน่วย','unit'])).trim();
    const priceRaw=productImportValue(row,['ราคาขาย (หน่วยหลัก)','ราคาขาย','ขาย','price']);
    const price=productImportNumber(priceRaw,NaN);
    const sku=String(productImportValue(row,['รหัสสินค้า','sku','code'])).trim();
    const systemId=productImportNumber(productImportValue(row,['รหัสอ้างอิงระบบ (ห้ามแก้)','รหัสอ้างอิงระบบ','systemid']),NaN);
    const warehouseValue=String(productImportValue(row,['คลังสินค้า','คลัง','warehouse'])).trim().toLowerCase();
    const sourceWarehouse=warehouseValue?warehouses.find(item=>[item.id,item.name,item.code].some(value=>String(value??'').trim().toLowerCase()===warehouseValue)):null;
    if(warehouseValue&&!sourceWarehouse){ skipped.push(`แถว ${line} · ${name}: ไม่พบคลัง “${warehouseValue}”`); return; }
    const crossStore=outsideStoreIds.has(systemId)||(sourceWarehouse&&Number(sourceWarehouse.id)!==Number(importWarehouseId));
    // P + 11 digits is permanently assigned to its original product by the print service.
    let omittedPrintCode=false;
    const importBarcode=value=>{
      const code=String(value??'').trim();
      if(crossStore&&/^P\d{11}$/i.test(code)){omittedPrintCode=true;return '';}
      return code;
    };
    const barcode=importBarcode(productImportValue(row,['บาร์โค้ดหลัก','บาร์โค้ด','barcode']));
    const extraBarcodes=[];
    const extraBarcodeUnits=[];
    const vendorBarcodes=[];
    const rawUnitRows=[];
    let unitImportError='';
    for(const number of repeatNumbers){
      const extraAliases=[`บาร์โค้ดสำรอง ${number}`,`บาร์โค้ดสำรอง${number}`,`บาร์โค้ดเพิ่มเติม ${number}`,`บาร์โค้ดเพิ่มเติม${number}`,`extrabarcode${number}`];
      if(number===1) extraAliases.push('บาร์โค้ดสำรอง','บาร์โค้ดเพิ่มเติม','extrabarcode');
      const extraCode=importBarcode(productImportValue(row,extraAliases));
      if(extraCode){
        const extraUnit=String(productImportValue(row,[`หน่วยของบาร์โค้ดสำรอง ${number}`,`หน่วยของบาร์โค้ดสำรอง${number}`,`หน่วยบาร์โค้ดเพิ่มเติม ${number}`,`หน่วยบาร์โค้ดเพิ่มเติม${number}`,`extrabarcodeunit${number}`])).trim()||unit;
        extraBarcodes.push(extraCode);
        extraBarcodeUnits.push(extraUnit);
      }

      const vendorNameAliases=[`ชื่อผู้จำหน่าย ${number}`,`ชื่อผู้จำหน่าย${number}`,`vendor${number}`];
      const vendorCodeAliases=[`บาร์โค้ดผู้จำหน่าย ${number}`,`บาร์โค้ดผู้จำหน่าย${number}`,`บาร์โค้ด vendor ${number}`,`บาร์โค้ดvendor${number}`,`vendorbarcode${number}`];
      if(number===1){ vendorNameAliases.push('ชื่อผู้จำหน่าย','vendor'); vendorCodeAliases.push('บาร์โค้ด vendor','บาร์โค้ดผู้จำหน่าย','vendorbarcode'); }
      const vendor=String(productImportValue(row,vendorNameAliases)).trim();
      const vendorCode=importBarcode(productImportValue(row,vendorCodeAliases));
      if(vendorCode) vendorBarcodes.push({vendor:vendor||'ไม่ระบุ',code:vendorCode});

      const unitAliases=[`หน่วยเพิ่มเติม ${number}`,`หน่วยเพิ่มเติม${number}`,`หน่วยย่อย ${number}`,`additionalunit${number}`];
      if(number===1) unitAliases.push('หน่วยเพิ่มเติม','หน่วยย่อย','additionalunit');
      const sub=String(productImportValue(row,unitAliases)).trim();
      {
        let hasUnitValues=false;
        const unitValue=aliases=>{const value=productImportValue(row,aliases);hasUnitValues=hasUnitValues||String(value??'').trim()!=='';return value;};
        const per=productImportNumber(unitValue([`จำนวนบรรจุ ${number}`,`จำนวนบรรจุ${number}`,`จำนวนต่อหน่วย ${number}`,`จำนวนต่อหน่วย${number}`,`บรรจุ ${number}`,`per${number}`]),0);
        const base=String(productImportValue(row,[`เทียบกับหน่วย ${number}`,`เทียบกับหน่วย${number}`,`อ้างอิงหน่วย ${number}`,`อ้างอิงหน่วย${number}`,`หน่วยฐาน ${number}`,`baseunit${number}`])).trim()||unit;
        const unitPrice=productImportMoney(unitValue([`ราคาขายหน่วยเพิ่มเติม ${number}`,`ราคาขายหน่วยเพิ่มเติม${number}`,`ราคาขายหน่วย ${number}`,`ราคาขายหน่วย${number}`,`unitprice${number}`]),0);
        const unitCost=productImportMoney(unitValue([`ราคาทุนหน่วยเพิ่มเติม ${number}`,`ราคาทุนหน่วยเพิ่มเติม${number}`,`ราคาทุนหน่วย ${number}`,`ราคาทุนหน่วย${number}`,`unitcost${number}`]),0);
        const unitBarcode=importBarcode(unitValue([`บาร์โค้ดหน่วยเพิ่มเติม ${number}`,`บาร์โค้ดหน่วยเพิ่มเติม${number}`,`บาร์โค้ดหน่วย ${number}`,`บาร์โค้ดหน่วย${number}`,`unitbarcode${number}`]));
        if(sub) rawUnitRows.push({sub,per,base,price:unitPrice,cost:unitCost,barcode:unitBarcode});
        else if(hasUnitValues||base!==unit) unitImportError=`กรุณาระบุหน่วยเพิ่มเติมลำดับที่ ${number}`;
      }
    }
    if(unitImportError){ skipped.push(`แถว ${line}: ${unitImportError}`); return; }
    if(!name||!unit||!Number.isFinite(price)){ skipped.push(`แถว ${line}: ชื่อสินค้า หน่วย หรือราคาขายไม่ครบ`); return; }

    let existing=null;
    const rowBarcodes=[barcode,...extraBarcodes,...vendorBarcodes.map(item=>item.code),...rawUnitRows.map(item=>item.barcode)].filter(Boolean);
    const normalizedRowBarcodes=rowBarcodes.map(code=>code.toLowerCase());
    if(crossStore){
      if(!sku&&!rowBarcodes.length){skipped.push(`แถว ${line} · ${name}: กรุณาระบุรหัสสินค้าหรือบาร์โค้ดสำหรับตรวจสินค้าซ้ำในคลังปลายทาง`);return;}
      const matchedSku=sku&&skuOwner.has(sku.toLowerCase());
      const matchedCode=normalizedRowBarcodes.find(code=>barcodeOwner.has(code));
      if(matchedSku||matchedCode){
        const detail=`${matchedSku?'รหัสสินค้า '+sku:'บาร์โค้ด '+matchedCode} มีอยู่แล้วใน ${warehouse.name} หรือแถวก่อนหน้า · คงข้อมูลเดิม`;
        existingCopies.push({line,name,detail,status:'ข้าม'});return;
      }
    }else{
      if(Number.isFinite(systemId)) existing=productById(systemId);
      if(!existing&&sku) existing=productById(skuOwner.get(sku.toLowerCase()));
    }
    if(existing&&seenInFile.has(existing.id)){ skipped.push(`แถว ${line}: ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน (${name})`); return; }

    if(sku){
      const owner=skuOwner.get(sku.toLowerCase());
      if(owner!==undefined&&owner!==existing?.id){ skipped.push(`แถว ${line}: รหัสสินค้า ${sku} ซ้ำกับสินค้าอื่นที่มีอยู่แล้ว`); return; }
    }
    const repeatedInRow=normalizedRowBarcodes.find((code,position)=>normalizedRowBarcodes.indexOf(code)!==position);
    if(repeatedInRow){ skipped.push(`แถว ${line}: บาร์โค้ด ${repeatedInRow} ซ้ำกันเองในแถวเดียวกัน`); return; }
    const conflictBarcode=normalizedRowBarcodes.find(code=>{ const owner=barcodeOwner.get(code); return owner!==undefined&&owner!==existing?.id; });
    if(conflictBarcode){ skipped.push(`แถว ${line}: บาร์โค้ด ${conflictBarcode} ซ้ำกับสินค้าอื่นที่มีอยู่แล้ว`); return; }

    const category=String(productImportValue(row,['หมวดสินค้า','หมวดหลัก','category'])).trim()||'ไม่ทราบหมวดหมู่';
    const brand=String(productImportValue(row,['ยี่ห้อ / หมวดย่อย','หมวดย่อย','ยี่ห้อ','brand'])).trim()||'ทั่วไป';
    const stockRaw=productImportValue(row,['จำนวนคงเหลือ (หน่วยหลัก)','จำนวนคงเหลือ','คงเหลือ','stock']);
    const targetStock=crossStore||String(stockRaw??'').trim()===''?null:productImportNumber(stockRaw,NaN);
    const stockError=targetStock!==null&&(!Number.isFinite(targetStock)||targetStock<0)?'จำนวนคงเหลือต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป':
      targetStock!==null&&existing&&existing.unit!==unit?'เปลี่ยนหน่วยหลักพร้อมปรับสต๊อกไม่ได้ กรุณาเปลี่ยนหน่วยหลักให้เรียบร้อยก่อน':'';
    const expectedStock=existing&&warehouse?warehouseStock(existing.id,warehouse.id):0;
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
      ...productImportReviewFields(reviewStatus,existing,new Date().toISOString(),currentPharmacistName()||String(loggedInUser()?.username||'').trim()),
      cost:productImportMoney(productImportValue(row,['ราคาทุน (หน่วยหลัก)','ราคาทุน','ทุน','cost']),existing?.cost||0),
      vat:parseProductVatMode(productImportValue(row,['ภาษีมูลค่าเพิ่ม','vat']),existing?.vat||'incl'),
      stock:existing?.stock||0,
      expiry:existing?.expiry||'',
      wh:warehouse.id,
      desc:String(productImportValue(row,['รายละเอียด','ข้อมูลเพิ่มเติม','description','desc'])).trim(),
      extraBarcodes,extraBarcodeUnits,vendorBarcodes,multiunit:productUnits.length>0,units:productUnits,
    };

    const structureError=productStructureValidationError(data);
    if(structureError){ skipped.push(`แถว ${line}: ${structureError}`); return; }
    const expiryRaw=productImportValue(row,['วันหมดอายุ (สำหรับดูข้อมูล)','วันหมดอายุ','expiry','expiredate']);
    const detail=crossStore?`เพิ่มสินค้าใหม่ใน ${warehouse.name} · สต๊อกเริ่มต้น 0 ${unit}${omittedPrintCode?' · เว้นบาร์โค้ดที่ระบบออกให้ร้านต้นทางไว้ เพื่อออกเลขใหม่เมื่อพิมพ์ป้าย':''}`:productImportChanges(existing,data);
    const entry={line,name,existing,detail,stockError,
      expiryNotice:String(expiryRaw??'').trim()&&productImportDate(expiryRaw)!==(existing&&warehouse?warehouseExpiry(existing.id,warehouse.id):'')?'วันหมดอายุในไฟล์ใช้สำหรับดูข้อมูล แก้ไขผ่าน LOT เท่านั้น':'',
      stockDetail:crossStore?'ไม่นำยอดคงเหลือจากร้านต้นทางมาใช้':targetStock===null?'เว้นจำนวนว่าง · คงสต๊อกเดิม':`${warehouse.name} · ${expectedStock} → ${targetStock} ${unit}`,
      targetStock,expectedStock,warehouseId:warehouse?.id,unitName:unit};
    if(existing){
      seenInFile.add(existing.id);
      skuOwner.set(finalSku.toLowerCase(),existing.id);
      normalizedRowBarcodes.forEach(code=>barcodeOwner.set(code,existing.id));
      toUpdate.push({existing,data,inventoryWarehouseId:warehouse?.id||Number(activeWarehouseId)});
      entry.product=existing;
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
      entry.product=product;
      skuOwner.set(finalSku.toLowerCase(),id);
      normalizedRowBarcodes.forEach(code=>barcodeOwner.set(code,id));
    }
    entries.push(entry);
  });

  // A different device may have added a barcode since this client last loaded.
  // Check before changing any local catalog, supplier or inventory data.
  try{
    const candidates=[...toCreate,...toUpdate.map(({existing,data})=>({...data,id:existing.id}))];
    const remoteOwners=await loadServerBarcodeOwners(candidates.flatMap(productBarcodeCodes));
    for(const collection of [toCreate,toUpdate]) for(let i=collection.length-1;i>=0;i--){
      const entry=collection[i],product=entry.data||entry,id=entry.existing?.id??entry.id;
      const codes=new Set(productBarcodeCodes(product));
      const conflict=remoteOwners.find(owner=>String(owner.product_id)!==String(id)&&codes.has(owner.barcode));
      if(conflict){
        const index=entries.findIndex(entry=>String(entry.product.id)===String(id));
        skipped.push(`แถว ${entries[index].line}: ${product.name} · ${productBarcodeConflictMessage(conflict.barcode,conflict)}`);
        collection.splice(i,1); entries.splice(index,1);
      }
    }
  }catch(error){ showToast(error.message,'danger-top'); return; }

  if(!isWorkspaceReadCurrent(context)) return;
  const sourceByLine=new Map(sourceRows.map((row,index)=>[(row.__rowNum__??index+1)+1,row]));
  const rejected=existingCopies.concat(skipped.map(detail=>{
    const line=Number(detail.match(/^แถว (\d+)/)?.[1])||'';
    return {line,name:String(productImportValue(sourceByLine.get(line)||{},['ชื่อสินค้า','สินค้า','name']))||'รายการที่ข้าม',detail,status:'ไม่สำเร็จ'};
  }));
  const choice=await showProductImportDialog(entries,rejected);
  if(!choice) return;
  if(activeWarehouseId!==importWarehouseId||!isWorkspaceReadCurrent(context)||catalogAtPreview!==JSON.stringify(products.map(productMetadataToRow))){
    showToast('ข้อมูลสินค้าเปลี่ยนระหว่างตรวจรายการ กรุณานำเข้าไฟล์ใหม่เพื่อตรวจข้อมูลล่าสุด','danger-top'); return;
  }
  const importStockTargets=choice.adjustStock?entries.filter(entry=>entry.targetStock!==null&&entry.targetStock!==entry.expectedStock)
    .map(entry=>({productId:entry.product.id,warehouseId:entry.warehouseId,expectedStock:entry.expectedStock,targetStock:entry.targetStock,unitName:entry.unitName,expiry:''})):[];
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
      const existingContact=storeContacts().find(contact=>String(contact.name||'').trim().toLowerCase()===vendorName.toLowerCase());
      if(existingContact){
        if(!Array.isArray(existingContact.types)) existingContact.types=[];
        if(!existingContact.types.includes('supplier')){
          existingContact.types.push('supplier');
          contactsChanged=true;
        }
        return;
      }
      contacts.push({
        id:generateClientRecordId(contacts),warehouseId:activeWarehouseId,name:vendorName,entity:'juristic',types:['supplier'],contactName:'',phone:'',email:'',taxId:'',creditDays:'',address:'',bank:'',bankAcc:'',note:'เพิ่มจากการนำเข้าสินค้า Excel'
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
  const desiredRows=new Map(entries.map(entry=>[entry.product.id,JSON.stringify(productToRow(entry.product))]));
  const appliedStockIds=new Set();
  let cacheSaved=false,saveError='',stockError='';
  const progress=document.createElement('div');
  progress.className='modal-overlay product-import-overlay';
  progress.innerHTML='<div class="modal"><div class="modal-body" role="status">กำลังบันทึกข้อมูลสินค้าและตรวจสอบผล กรุณารอ…</div></div>';
  document.body.appendChild(progress);
  try{
    cacheSaved=await persistWorkspaceData({productChanges:{insertedIds:toCreate.map(product=>product.id),updatedIds:toUpdate.map(entry=>entry.existing.id)}});
    if(cacheSaved) await syncCoreDataToSupabase();
    else saveError='เก็บสำเนางานในเครื่องไม่สำเร็จ กรุณาอย่าเพิ่งปิดโปรแกรม';
  }catch(error){
    saveError=error?.message||'บันทึกข้อมูลไม่สำเร็จ';
  }
  if(!isWorkspaceReadCurrent(context)){progress.remove();return;}
  const acknowledged=entry=>{
    const live=products.find(product=>product.id===entry.product.id);
    return live&&JSON.stringify(productToRow(live))===desiredRows.get(live.id)&&
      syncedTableRows.products?.get(String(live.id))===JSON.stringify(productMetadataToRow(live));
  };
  const syncedIds=new Set(entries.filter(acknowledged).map(entry=>entry.product.id));
  try{
    if(cacheSaved) await applyImportedInventoryTargets(importStockTargets.filter(target=>syncedIds.has(target.productId)),ids=>ids.forEach(id=>appliedStockIds.add(id)));
  }catch(error){
    stockError=error?.message||'ตรวจสอบผลปรับสต๊อกไม่สำเร็จ';
  }finally{progress.remove();}
  if(!isWorkspaceReadCurrent(context)) return;
  const requestedStockIds=new Set(importStockTargets.map(target=>target.productId));
  for(const entry of entries){
    const synced=syncedIds.has(entry.product.id);
    entry.status=synced?'สำเร็จ':cacheSaved?'รอซิงก์':'ไม่สำเร็จ';
    entry.detail=synced?'บันทึกข้อมูลสินค้าบนเซิร์ฟเวอร์แล้ว':saveError||syncUiLastError?.message||'ข้อมูลสินค้ารอซิงก์ กรุณาตรวจรายละเอียดการซิงก์';
    if(requestedStockIds.has(entry.product.id)){
      if(appliedStockIds.has(entry.product.id)) entry.detail+='\nปรับสต๊อกแล้ว · '+entry.stockDetail;
      else{
        if(synced) entry.status='ไม่สำเร็จ';
        entry.detail+='\n'+(synced?stockError||'ยังไม่ได้ปรับสต๊อก':'ยังไม่ได้ปรับสต๊อก กรุณาซิงก์สินค้าให้สำเร็จแล้วนำเข้าอีกครั้ง')+'\n'+entry.stockDetail;
      }
    }
    if(entry.expiryNotice) entry.detail+='\n'+entry.expiryNotice;
  }
  render();
  await showProductImportDialog(entries,rejected,{result:true});
}

async function exportProductsToExcel(){
  if(!products.length){ showToast('ยังไม่มีข้อมูลให้ส่งออก'); return; }
  let writer;
  try{ writer=await ensureProductExcelWriterLoaded(); }catch(error){ showToast(error.message||'ไม่สามารถโหลดระบบส่งออก Excel ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่'); return; }
  const counts=productExcelColumnCounts(products);
  const rows=products.map(product=>productToExcelRow(product,counts));
  const workbook=createProductExcelWorkbook(rows,writer);
  const buffer=await workbook.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');
  link.href=url;link.download=`PEPOS-รายการสินค้า-${TODAY_STR}.xlsx`;
  document.body.appendChild(link);
  link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  showToast(`ส่งออกรายการสินค้า ${rows.length} รายการแล้ว`);
}
