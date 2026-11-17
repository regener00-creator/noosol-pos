let cashBillPageCache=null;

function standaloneCashBillRow(row){
  const d=row.data;
  return {...d,id:'manual:'+row.id,number:row.number,issuedAt:row.issued_at,warehouseId:row.warehouse_id,standalone:true,status:'done',
    cashReceiptA4Meta:{number:row.number,saleDate:d.date,issuedAt:row.issued_at,customer:d.customer,printLog:row.printed?[{}]:[]}};
}

function standaloneCashBillPage(){
  const limit=docListPage.cashbill*DOC_LIST_PAGE_SIZE;
  const range=documentPeriodRange('cashbill'),sort=documentSort.cashbill;
  const key=[range.from,range.to,sort.key,sort.dir].join('|');
  if(!cashBillPageCache||cashBillPageCache.key!==key||!isStoreViewCurrent(cashBillPageCache.view)){
    cashBillPageCache={key,view:captureStoreView(),rows:[],count:0,loaded:0,at:0,busy:false,error:false};
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
          let query=sb.from('standalone_cash_bills').select('*',{count:'exact'}).eq('warehouse_id',cache.view.store)
            .gte('data->>date',range.from).lte('data->>date',range.to)
            .order(sort.key==='date'?'data->>date':'number',{ascending:sort.dir===1});
          if(sort.key==='date')query=query.order('number');
          const result=await query.range(rows.length,end);
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
    printA4CashReceipt(receipt.id,win,receipt);
    doc.cashReceiptA4Meta.printLog=[{}];
    if(cashBillPageCache)cashBillPageCache.at=0;
  }catch(error){win.close();console.warn('print standalone cash bill',error);showToast('เปิดบิลเงินสดเพื่อพิมพ์ไม่สำเร็จ กรุณาลองใหม่','danger-top');}
}
