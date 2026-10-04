async function doCheckout(payMethod,options={}){
  const pendingRequestBeforeCheckout=readPendingCheckoutRequest();
  if(cart.length===0&&pendingRequestBeforeCheckout){ restorePendingCheckoutUi(pendingRequestBeforeCheckout); render(); }
  if(cart.length===0) return;
  if(checkoutInFlight){ showToast('กำลังบันทึกการชำระเงิน กรุณารอสักครู่','warning-top'); return; }
  if(!currentCashShift){ showToast('กรุณาเปิดระบบชำระก่อนรับชำระเงิน','danger-top'); currentTab='cashshift'; render(); return; }
  const cashShiftId=currentCashShift.id;
  const promoResult=applyPromotions(cart);
  const vatRegistered=isBusinessVatRegistered();
  const items=[];
  cart.forEach((l,idx)=>{
    const p=products.find(x=>x.id===l.pid);
    const costSnapshot=saleLineCostSnapshot(l,p);
    const promoLine=promoResult.lines[idx];
    const lineTotal=promoLine.promoId?promoLine.promoLineTotal:l.price*l.qty;
    const vatMode=l.custom?(vatRegistered?'incl':'none'):effectiveProductVatMode(p);
    const lineTotalGross=grossAmountForVatMode(lineTotal,vatMode,vatRegistered);
    items.push({lineKey:String(idx+1),productId:l.pid||null,warehouseId:Number(activeWarehouseId)||null,name:l.name,qty:l.qty,baseQty:(Number(l.qty)||0)*(Number(l.factor)||1),price:Number(l.price)||0,regularPrice:Number(l.regularPrice??l.price)||0,priceSource:l.priceSource||'standard',customerPriceRuleId:l.customerPriceRuleId||null,sourceQuotationId:l.sourceQuotationId||null,sourceQuotationLineIndex:l.sourceQuotationLineIndex??null,cost:costSnapshot.cost,costTotal:costSnapshot.costTotal,costSource:costSnapshot.costSource,unit:l.unit,factor:l.factor||0,custom:!!l.custom,
      promoId:promoLine.promoId||null,promoName:promoLine.promoName||'',lineTotal,lineTotalGross,vatMode,promoFreeQty:promoLine.promoFreeQty||0,dispensingLabel:normalizeDispensingLabel(l.dispensingLabel)});
  });
  const loyaltyRedeemed=effectiveLoyaltyRedemption(promoResult);
  const itemTaxSummary=calculateSaleTaxSummary(items.map(item=>({amount:item.lineTotal,vatMode:item.vatMode})),Number(saleDiscount)+loyaltyRedeemed,vatRegistered);
  const fee = Math.max(0,Number(options.fee)||0);
  const feeTaxSummary=calculateSaleTaxSummary(fee?[{amount:fee,vatMode:vatRegistered?'incl':'none'}]:[],0,vatRegistered);
  const roundMoney=value=>Math.round((Number(value)||0)*100)/100;
  const taxSummary={registered:vatRegistered,subtotal:roundMoney(itemTaxSummary.subtotal+feeTaxSummary.subtotal),discount:itemTaxSummary.discount,beforeVat:roundMoney(itemTaxSummary.beforeVat+feeTaxSummary.beforeVat),vat:roundMoney(itemTaxSummary.vat+feeTaxSummary.vat),total:roundMoney(itemTaxSummary.total+feeTaxSummary.total)};
  const discount=taxSummary.discount;
  const costTotal=items.reduce((sum,item)=>sum+(Number(item.costTotal)||0),0);
  const grand=taxSummary.total;
  const selectedCustomer=activeSaleCustomer();
  const saleDraft={warehouseId:Number(activeWarehouseId)||null,warehouseName:activeWarehouse()?.name||'',cashier:loggedInUser()?.firstName||employees[0],member:saleMember,customerId:selectedCustomer?.id||saleMember?.id||null,customerName:selectedCustomer?.name||saleMember?.name||'',defaultDocument:customerDefaultDocument(selectedCustomer||saleMember),sourceQuotationId:saleSourceQuotationId||null,status:'done',payMethod:payMethod||'เงินสด',items,medicineLabelSize,discount,vat:taxSummary.vat,vatRegistered,taxSummary,businessSnapshot:businessDocumentSnapshot(),fee,costTotal,grossProfit:roundMoney(taxSummary.beforeVat-costTotal),cashReceived:options.cashReceived||0,cashChange:options.cashChange||0,total:grand};
  checkoutInFlight=true;
  saleDraft.loyaltyRedeemed=loyaltyRedeemed;
  saleDraft.loyaltyPeriodStart=loyaltyRedeemed?saleLoyaltySelection?.periodStart:null;
  const checkoutButton=document.getElementById('checkoutBtn');
  if(checkoutButton){ checkoutButton.disabled=true; checkoutButton.textContent='กำลังบันทึก...'; }
  let completedSale;
  let requestContext=null;
  let checkoutPayload=null;
  try{
    const rpcItems=items.map(item=>({lineKey:item.lineKey,productId:item.productId,warehouseId:item.warehouseId,qty:item.qty,factor:item.factor||1,baseQty:item.baseQty,custom:item.custom,name:item.name,price:item.price,regularPrice:item.regularPrice,priceSource:item.priceSource,customerPriceRuleId:item.customerPriceRuleId,sourceQuotationId:item.sourceQuotationId,sourceQuotationLineIndex:item.sourceQuotationLineIndex,cost:item.cost,costTotal:item.costTotal,costSource:item.costSource,unit:item.unit,promoId:item.promoId,promoName:item.promoName,lineTotal:item.lineTotal,lineTotalGross:item.lineTotalGross,vatMode:item.vatMode,promoFreeQty:item.promoFreeQty,dispensingLabel:item.dispensingLabel}));
    const currentCheckoutPayload={warehouseId:Number(activeWarehouseId),sale:saleDraft,items:rpcItems};
    requestContext=await checkoutRequestContext(currentCheckoutPayload,checkoutUiSnapshot(payMethod,options));
    checkoutPayload=requestContext.payload||currentCheckoutPayload;
    if(requestContext.payloadMismatch&&requestContext.payload) restorePendingCheckoutUi(requestContext);
    const {data,error}=await sb.rpc('complete_sale',{p_request_id:requestContext.id,p_ref_prefix:documentPrefixes.sale,p_warehouse_id:Number(checkoutPayload.warehouseId),p_sale:checkoutPayload.sale,p_items:checkoutPayload.items,p_payload_hash:requestContext.payloadHash});
    if(error) throw error;
    completedSale={...(data?.sale||{}),cashShiftId};
    if(!completedSale?.id) throw new Error('completed sale was not returned');
    await clearCheckoutRequestId(requestContext.id);
  }catch(error){
    console.warn('complete sale',error);
    const message=String(error?.message||'');
    const lowerMessage=message.toLowerCase();
    // A PostgREST/PostgreSQL error code means the server returned a definite
    // transaction failure, so the payload may be corrected with a new id.
    // Fetch/network failures have no database code and remain ambiguous: keep
    // the durable request and exact payload so a retry can never double-sell.
    const definitiveFailure=/^[0-9A-Z]{5}$/.test(String(error?.code||''))||['PGRST202','PGRST301','PGRST302'].includes(String(error?.code||''))||message.includes('cash shift required')||message.includes('is inactive');
    if(definitiveFailure) await clearCheckoutRequestId(requestContext?.id||'');
    else restorePendingCheckoutUi(requestContext);
    const loyaltyFailure=definitiveFailure&&message.includes('LOYALTY_');
    if(loyaltyFailure){saleLoyaltySelection=null;customerLoyaltyState=null;}
    if(message.includes('cash shift required')){ currentCashShift=null; currentTab='cashshift'; await loadCashShiftsFromSupabase(); }
    checkoutInFlight=false;
    render();
const checkoutErrorMessage=error?.code==='LOCAL_STORAGE_UNAVAILABLE'?message:message.includes('cash shift required')?'ระบบชำระถูกปิดไปแล้ว กรุณาเปิดระบบใหม่':message.includes('is inactive')?'มีสินค้าถูกปิดใช้งาน กรุณารีเฟรชและลบสินค้านั้นออกจากบิล':lowerMessage.includes('quotation')?'ข้อมูลใบเสนอราคาไม่ตรงกับรายการชำระ กรุณาโหลดข้อมูลล่าสุดแล้วเปิดใบเสนอราคาไปยัง POS อีกครั้ง โดยใช้ลูกค้าและราคาตามใบเสนอราคา':lowerMessage.includes('customer special price')?'ราคาพิเศษของลูกค้ายังไม่ตรงกับข้อมูลบนระบบ กรุณาเปิดสมุดรายชื่อแล้วบันทึกราคาพิเศษอีกครั้ง':lowerMessage.includes('product price changed')?'ราคาสินค้าเปลี่ยนแล้ว กรุณาล้างรายการเดิมและยิงสินค้าใหม่':lowerMessage.includes('payload')?'มีคำขอชำระเดิมค้างอยู่ ระบบจะไม่สร้างคำขอใหม่ กรุณาตรวจสอบบิลเดิม':definitiveFailure?(message||'ระบบปฏิเสธรายการ กรุณาตรวจข้อมูลแล้วลองใหม่'):'ยังไม่ได้รับการยืนยันจากระบบ กรุณากดชำระซ้ำ ระบบจะใช้คำขอเดิมและไม่สร้างบิลซ้ำ';
    showToast(loyaltyFailure?'ใช้แต้มไม่สำเร็จ ยอดแต้มอาจเปลี่ยนหรือหมดอายุ กรุณาตรวจแต้มและเลือกใหม่อีกครั้ง':checkoutErrorMessage,'danger-top');
    return;
  }
  const existingSaleIndex=salesHistory.findIndex(sale=>sale.id===completedSale.id);
  if(existingSaleIndex>=0) salesHistory[existingSaleIndex]=completedSale; else salesHistory.unshift(completedSale);
  if(completedSale.sourceQuotationId){
    const quotation=quotations.find(item=>item.id===completedSale.sourceQuotationId);
    if(quotation){ quotation.status='ขายแล้ว'; quotation.saleId=completedSale.id; quotation.soldAt=auditNow(); persistQuotations(); }
  }
  cart = []; saleDiscount = 0; saleMember = null; saleSourceQuotationId=null; pendingQty = 1;
  saleLoyaltySelection=null;customerLoyaltyState=null;customerPurchaseState=null;
  saleRef = nextSaleRef();
  checkoutInFlight=false;
  const pendingLotQty=(completedSale.items||[]).flatMap(item=>item.lotAllocations||[]).filter(allocation=>allocation.pendingLot).reduce((sum,allocation)=>sum+(Number(allocation.baseQty)||0),0);
  const completedTotal=Number(completedSale.total)||grand;
  const completedPayMethod=completedSale.payMethod||checkoutPayload?.sale?.payMethod||payMethod||'เงินสด';
  showToast(pendingLotQty>0?`ชำระเงินสำเร็จ · มี ${inventoryMovementRound(pendingLotQty)} หน่วยหลักรอจัด LOT และสต๊อกอาจติดลบ`:`ชำระเงินสำเร็จ (${completedPayMethod}) ${fmtMoney(completedTotal)} บาท`,pendingLotQty>0?'warning-top':undefined);
  render();
  setTimeout(()=>openPostPaymentModal(completedSale.id),0);
  refreshDocumentInventory(completedSale);
}
