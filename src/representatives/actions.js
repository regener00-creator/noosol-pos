function saveSalesRepresentative(){
  const get=id=>(document.getElementById(id)?.value||'').trim();
  const name=get('sr_name');
  if(!name){ showToast('กรุณากรอกชื่อผู้แทน'); document.getElementById('sr_name').focus(); return; }
  const data={name,phone:get('sr_phone'),line:get('sr_line'),company:get('sr_company'),note:get('sr_note')};
  if(editingSalesRepresentativeId==='new'){
    salesRepresentatives.push({id:generateClientRecordId(salesRepresentatives),...data});
    showToast(`เพิ่มรายชื่อผู้แทน “${name}” แล้ว`);
  }else{
    const rep=salesRepresentatives.find(x=>x.id===editingSalesRepresentativeId);
    if(rep){
      const oldName=rep.name;
      Object.assign(rep,data);
      purchaseOrders.forEach(doc=>{ if(doc.supplier===oldName) doc.supplier=name; });
      if(poDraft?.supplier===oldName) poDraft.supplier=name;
    }
    showToast(`บันทึกรายชื่อผู้แทน “${name}” แล้ว`);
  }
  editingSalesRepresentativeId=null;
  persistWorkspaceData();
  render();
}

function deleteSalesRepresentative(id){
  const rep=salesRepresentatives.find(x=>x.id===id); if(!rep) return;
  if(!confirm(`ยืนยันลบรายชื่อผู้แทน "${rep.name}" ?`)) return;
  salesRepresentatives=salesRepresentatives.filter(x=>x.id!==id);
  removeRepresentativesFromManagedProductIndex([id]);
  persistWorkspaceData();
  showToast(`ลบรายชื่อผู้แทน "${rep.name}" แล้ว`);
  render();
}
