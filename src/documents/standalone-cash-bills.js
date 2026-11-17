let cashBillPageCache=null;

function standaloneCashBillRow(row){
  const d=row.data;
  return {...d,id:'manual:'+row.id,number:row.number,issuedAt:row.issued_at,warehouseId:row.warehouse_id,standalone:true,status:'done',
    cashReceiptA4Meta:{number:row.number,saleDate:d.date,issuedAt:row.issued_at,customer:d.customer,printLog:row.printed?[{}]:[]}};
}

function standaloneCashBillPage(){
  const limit=docListPage.cashbill*DOC_LIST_PAGE_SIZE;
  if(!cashBillPageCache||!isStoreViewCurrent(cashBillPageCache.view)){
    cashBillPageCache={view:captureStoreView(),rows:[],count:0,loaded:0,at:0,busy:false,error:false};
  }
  const cache=cashBillPageCache;
  if(!cache.busy&&!cache.error&&(Date.now()-cache.at>60000||cache.loaded<Math.min(limit,cache.count))){
    cache.busy=true;
    (async()=>{
      try{
        const rows=[];
        let count=0;
        do{
          const end=Math.min(limit,rows.length+100)-1;
          const result=await sb.from('standalone_cash_bills').select('*',{count:'exact'}).eq('warehouse_id',cache.view.store)
            .order('issued_at',{ascending:false}).order('id').range(rows.length,end);
          if(result.error)throw result.error;
          count=result.count??result.data.length;
          rows.push(...result.data.map(standaloneCashBillRow));
          if(!result.data.length)break;
        }while(rows.length<Math.min(count,limit));
        Object.assign(cache,{rows,count,loaded:limit,at:Date.now()});
      }catch(error){cache.error=true;console.warn('load standalone cash bills',error);}
      finally{
        cache.busy=false;
        if(cache===cashBillPageCache&&isStoreViewCurrent(cache.view)&&currentTab==='cashbill'&&!cashBillLookupOpen&&editingTaxInvoiceSaleId===null)render();
      }
    })();
  }
  return cache;
}

async function saveManualCashBill(d,doc){
  if(d.saving)return null;
  d.saving=true;
  d.requestId||=crypto.randomUUID();
  try{
    const result=await sb.from('standalone_cash_bills').insert({id:d.requestId,warehouse_id:d.warehouseId,data:doc}).select('number').single();
    if(!result.error)return result.data.number;
    // A retry can follow a successful insert whose response was lost.
    if(result.error.code!=='23505')throw result.error;
    const prior=await sb.from('standalone_cash_bills').select('number').eq('id',d.requestId).eq('warehouse_id',d.warehouseId).single();
    if(prior.error)throw prior.error;
    return prior.data.number;
  }catch(error){console.warn('save standalone cash bill',error);showToast('บันทึกบิลเงินสดไม่สำเร็จ กรุณาลองใหม่','danger-top');return null;}
  finally{d.saving=false;}
}

async function deleteManualCashBill(doc){
  const result=await sb.from('standalone_cash_bills').delete().eq('id',doc.id.slice(7)).eq('warehouse_id',doc.warehouseId).select('id').single();
  if(result.error)throw result.error;
  cashBillPageCache=null;
}

async function printManualCashBill(doc){
  const win=window.open('','_blank');
  if(!win){showToast('เบราว์เซอร์บล็อกหน้าต่างเอกสาร','danger-top');return;}
  const view=captureStoreView();
  try{
    const query=()=>sb.from('standalone_cash_bills');
    const first=await query().update({printed:true}).eq('id',doc.id.slice(7)).eq('warehouse_id',view.store).eq('printed',false).select('*').maybeSingle();
    if(first.error)throw first.error;
    const saved=first.data?first:await query().select('*').eq('id',doc.id.slice(7)).eq('warehouse_id',view.store).single();
    if(saved.error)throw saved.error;
    if(!isStoreViewCurrent(view)){win.close();return;}
    const receipt=standaloneCashBillRow(saved.data);
    receipt.cashReceiptA4Meta.printLog=first.data?[]:[{}];
    printA4CashReceipt(receipt.id,win,receipt);
    doc.cashReceiptA4Meta.printLog=[{}];
    if(cashBillPageCache)cashBillPageCache.at=0;
  }catch(error){win.close();console.warn('print standalone cash bill',error);showToast('เปิดบิลเงินสดเพื่อพิมพ์ไม่สำเร็จ กรุณาลองใหม่','danger-top');}
}
