function bindUnitRowEvents(){
  decorateMobileProductUnitRows();
  // ลบแถว
  document.querySelectorAll('#unitRows .u_del').forEach(b=>{
    b.onclick = ()=>{
      const mainUnit=(document.getElementById('f_unit')||{}).value||'หน่วยหลัก';
      const mainStock=Number(document.getElementById('f_stock')?.value)||0;
      let rawData=collectUnitRowsFromDOM({preserveInput:true});
      const idx=[...document.querySelectorAll('#unitRows .unitrow')].indexOf(b.closest('.unitrow'));
      rawData.splice(idx,1);
      if(rawData.length===0) rawData=[{sub:'',per:'',base:mainUnit,price:'',cost:'',barcode:''}];
      const data=computeUnitRowsWithStock(rawData,mainUnit,mainStock);
      const names=data.map(d=>d.sub);
      document.getElementById('unitRows').innerHTML=data.map(u=>unitRowHtml(u,mainUnit,names)).join('');
      bindUnitRowEvents();
      refreshExtraBarcodeUnitOptions();
    };
  });
  // เปลี่ยนชื่อหน่วย → รีเฟรช base dropdown ของแถวอื่น (แต่ปล่อยให้ combo-select "เพิ่มใหม่/จัดการ" ทำงานก่อน)
  document.querySelectorAll('#unitRows .u_sub').forEach(sel=>{
    sel.onchange=()=>{ setTimeout(()=>{ if(sel.isConnected) refreshUnitRows(); },0); };
  });
}
function bindUnitDelete(){ bindUnitRowEvents(); }

function bindBcDelete(){
  document.querySelectorAll('.bc_del').forEach(b=>{
    b.onclick = ()=>{ b.closest('.bcrow').remove(); };
  });
}
