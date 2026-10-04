let customerHistoryView=null;
let posCustomerHistoryModalOpen=false;
let customerPurchaseState=null;
function customerTierFromPurchases(cycleTotal,elapsedMonths){
  const months=Math.min(12,Math.max(1,Number(elapsedMonths)||1));
  const total=Math.max(0,Number(cycleTotal)||0);
  // Compare unrounded totals, not a displayed/rounded monthly average.
  const key=total>=50000*months?'special':total>=10000*months?'regular':'general';
  return {key,label:{special:'ลูกค้าพิเศษ',regular:'ลูกค้าประจำ',general:'ลูกค้าทั่วไป'}[key],average:total/months};
}
function customerTierProgress(cycleTotal,elapsedMonths){
  const months=Math.min(12,Math.max(1,Number(elapsedMonths)||1));
  const total=Math.max(0,Number(cycleTotal)||0);
  const tier=customerTierFromPurchases(total,months);
  const next=tier.key==='general'?{label:'ลูกค้าประจำ',target:10000*months}:tier.key==='regular'?{label:'ลูกค้าพิเศษ',target:50000*months}:null;
  if(!next) return {tier,remaining:0,percent:100,nextLabel:''};
  return {tier,remaining:Math.max(0,next.target-total),percent:Math.max(0,Math.min(100,total/next.target*100)),nextLabel:next.label};
}
function loyaltyRedemptionLimit(total,balance){
  return Number(total)>=1000?Math.max(0,Math.min(Math.floor(Number(total)||0),Math.floor(Number(balance)||0))):0;
}
function effectiveLoyaltyRedemption(promoResult=applyPromotions(cart)){
  if(typeof saleLoyaltySelection==='undefined'||!saleLoyaltySelection) return 0;
  const customer=activeSaleCustomer();
  if(String(customer?.id)!==String(saleLoyaltySelection.customerId)) return 0;
  const total=cartTaxSummary(promoResult,saleDiscount).total;
  return Math.min(Number(saleLoyaltySelection.points)||0,loyaltyRedemptionLimit(total,saleLoyaltySelection.points));
}
function loadCustomerLoyalty(ids,force=false){
  const key=JSON.stringify([currentProfile?.id,activeWarehouseId,ids.map(String)]);
  const now=Date.now(),previous=customerLoyaltyState;
  const expired=previous?.data?.some(row=>new Date(row.expiresAt).getTime()<=now);
  if(!force&&previous?.key===key&&!expired&&(previous.loading||now-previous.loadedAt<30000)) return previous;
  const state={key,loading:true,data:null,error:'',loadedAt:now};customerLoyaltyState=state;
  state.promise=Promise.resolve().then(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const {data,error}=await sb.rpc('get_customer_loyalty',{p_customer_ids:ids.map(String),p_warehouse_id:Number(activeWarehouseId)||null}).abortSignal(controller.signal);
      if(error) throw error;
      if(!Array.isArray(data)||data.length!==ids.length) throw new Error('Incomplete loyalty response');
      state.data=data;
    }catch(error){state.error='อ่านแต้มไม่สำเร็จ กรุณากดรีเฟรชแต้ม';console.warn('loyalty read',error?.code||error?.message);}
    finally{
      clearTimeout(timer);state.loading=false;state.loadedAt=Date.now();
      if(customerLoyaltyState===state){
        refreshCustomerLoyaltyPanel();
        refreshCustomerLoyaltyTable();
        clearTimeout(customerLoyaltyExpiryTimer);
        const expiry=Math.min(...(state.data||[]).map(row=>new Date(row.expiresAt).getTime()));
        if(Number.isFinite(expiry)) customerLoyaltyExpiryTimer=setTimeout(()=>{customerLoyaltyState=null;refreshCustomerLoyaltyPanel();},Math.max(100,Math.min(3600000,expiry-Date.now()+100)));
      }
    }
    return state;
  });
  return state;
}
function customerLoyaltyPanelHtml(customer,readOnly=false){
  if(!customer?.id) return '';
  const state=loadCustomerLoyalty([customer.id]),account=state.data?.[0];
  const tierState=readOnly||posCustomerHistoryModalOpen?null:customerPurchaseLoad([customer.id]);
  const redeemed=readOnly?0:effectiveLoyaltyRedemption();
  const eligible=!readOnly&&cartTaxSummary(applyPromotions(cart),saleDiscount).total>=1000;
  const adjustmentHtml=Number(account?.adjustmentDue)>0
    ?`<small class="loyalty-error">มีแต้มรอหักคืน ${escapeHtml(account.adjustmentDue)} แต้มจากบิลยกเลิก แต้มที่ได้รับใหม่จะชดเชยส่วนนี้ก่อน</small>`
    :'';
  let accountHtml=`<small class="${state.error?'loyalty-error':''}" role="status">${state.error||'กำลังอ่านแต้ม…'}</small>`;
  if(account){
    const balanceHtml=`<b class="loyalty-balance">${escapeHtml(account.balance)} แต้ม</b>`;
    const expiryWarning=!readOnly&&Number(account.balance)>0?loyaltyExpiryWarning(account.expiresOn):null;
    const expiryWarningHtml=expiryWarning?`<small class="loyalty-expiry-warning is-${expiryWarning.level}" role="alert">⚠ แต้มจะหมดอายุภายใน ${expiryWarning.months} เดือน</small>`:'';
    accountHtml=readOnly
      ?`${balanceHtml}<div class="loyalty-membership-dates"><div><span>สมัคร</span><strong>${escapeHtml(fmtDateShort(account.joinedOn))}</strong></div><div><span>หมดอายุ</span><strong>${escapeHtml(fmtDateShort(account.expiresOn))}</strong></div></div>${adjustmentHtml}`
      :`<div class="loyalty-account-summary">${balanceHtml}<small class="loyalty-expiry-date">/ หมดอายุ <strong>${escapeHtml(fmtDateShort(account.expiresOn))}</strong></small></div>${expiryWarningHtml}${adjustmentHtml}`;
  }
  const redeemedSummary=redeemed?`<small>ใช้ ${redeemed} แต้ม ลด ${fmtMoney(redeemed)} บาท (รวมในส่วนลดแล้ว)</small>`:'';
  const redeemHtml=readOnly?'':`<div class="loyalty-redeem-row"><button class="btn primary small loyalty-redeem-button" data-redeem-loyalty type="button" ${!account||!eligible||Number(account.balance)<=0?'disabled':''}>ใช้แต้มเป็นส่วนลด</button><button class="btn ghost small loyalty-customer-history-button" data-customer-history="${escapeHtml(customer.id)}" type="button">ประวัติลูกค้า</button>${saleLoyaltySelection?'<button class="btn ghost small" data-clear-loyalty type="button">ยกเลิกใช้แต้ม</button>':''}</div>${redeemedSummary}`;
  const titleHtml=readOnly?'<strong>แต้มสะสม</strong>':'<div class="loyalty-panel-title"><strong>แต้มสะสม</strong></div>';
  const pointsRuleHtml=readOnly?'':'<small class="loyalty-points-rule">• 100 บาท = 1 แต้ม / ใช้แต้มได้เมื่อยอดถึง 1,000 บาท</small>';
  const tierProgressHtml=readOnly?'':customerTierProgressHtml(tierState,customer.id,'pos');
  return `<div class="loyalty-panel${readOnly?' customer-history-loyalty-panel':''}" data-loyalty-customer="${escapeHtml(customer.id)}" data-loyalty-readonly="${readOnly?'true':'false'}"><div class="loyalty-panel-head">${titleHtml}<button class="btn ghost small" data-refresh-loyalty type="button">รีเฟรชแต้ม</button></div>${accountHtml}${pointsRuleHtml}${tierProgressHtml}${redeemHtml}</div>`;
}
function loyaltyExpiryWarning(expiresOn,today=currentDateStr()){
  const parse=value=>{const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return match?{year:Number(match[1]),month:Number(match[2]),day:Number(match[3])}:null;};
  const expiry=parse(expiresOn),current=parse(today);
  if(!expiry||!current) return null;
  const key=parts=>parts.year*10000+parts.month*100+parts.day;
  if(key(current)>=key(expiry)) return null;
  const subtractMonths=months=>{
    const monthIndex=expiry.year*12+expiry.month-1-months;
    const year=Math.floor(monthIndex/12),month=monthIndex-year*12+1;
    const lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    return {year,month,day:Math.min(expiry.day,lastDay)};
  };
  for(const months of [1,2,3]){
    if(key(current)>=key(subtractMonths(months))) return {months,level:months===1?'critical':months===2?'urgent':'warning'};
  }
  return null;
}
function customerLoyaltyExpiryFromJoinedAt(joinedAt,today=currentDateStr()){
  const currentMatch=String(today||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!currentMatch) return '';
  let joinedMatch=String(joinedAt||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!joinedMatch){
    const date=new Date(joinedAt);
    if(!Number.isFinite(date.getTime())) return '';
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
    joinedMatch=['',parts.year,parts.month,parts.day];
  }
  const joined={year:Number(joinedMatch[1]),month:Number(joinedMatch[2]),day:Number(joinedMatch[3])};
  const current={year:Number(currentMatch[1]),month:Number(currentMatch[2]),day:Number(currentMatch[3])};
  const anniversary=year=>{
    const lastDay=new Date(Date.UTC(year,joined.month,0)).getUTCDate();
    return `${String(year).padStart(4,'0')}-${String(joined.month).padStart(2,'0')}-${String(Math.min(joined.day,lastDay)).padStart(2,'0')}`;
  };
  let years=Math.max(0,current.year-joined.year);
  const currentKey=`${String(current.year).padStart(4,'0')}-${String(current.month).padStart(2,'0')}-${String(current.day).padStart(2,'0')}`;
  if(years>0&&anniversary(joined.year+years)>currentKey) years--;
  return anniversary(joined.year+years+1);
}
function refreshCustomerLoyaltyPanel(){
  const hosts=[...document.querySelectorAll('[data-customer-loyalty-host]')];if(!hosts.length) return;
  hosts.forEach(host=>{
    const readOnly=host.dataset.readonly==='true';
    const customer=readOnly?customersList().find(c=>String(c.id)===String(customerHistoryView?.id)):activeSaleCustomer();
    host.innerHTML=customerLoyaltyPanelHtml(customer,readOnly);
  });
  bindCustomerLoyaltyEvents();
}
function customerLoyaltyBalanceHtml(state,id){
  const account=state?.data?.find(row=>String(row.customerId)===String(id));
  const text=account?`${Number(account.balance)||0} แต้ม`:state?.loading?'กำลังโหลด…':state?.error?'อ่านแต้มไม่ได้':'—';
  return `<span class="customer-loyalty-table-balance ${state?.error?'customer-purchase-error':''}" data-customer-loyalty-balance="${escapeHtml(id)}">${escapeHtml(text)}</span>`;
}
function customerLoyaltyExpiryHtml(state,id){
  const account=state?.data?.find(row=>String(row.customerId)===String(id));
  const text=account?fmtDateShort(account.expiresOn):state?.loading?'กำลังโหลด…':state?.error?'อ่านวันหมดอายุไม่ได้':'—';
  return `<span class="customer-loyalty-table-expiry ${state?.error?'customer-purchase-error':''}" data-customer-loyalty-expiry="${escapeHtml(id)}">${escapeHtml(text)}</span>`;
}
function refreshCustomerLoyaltyTable(){
  document.querySelectorAll('[data-customer-loyalty-balance]').forEach(host=>{
    const account=customerLoyaltyState?.data?.find(row=>String(row.customerId)===String(host.dataset.customerLoyaltyBalance));
    host.textContent=account?`${Number(account.balance)||0} แต้ม`:customerLoyaltyState?.loading?'กำลังโหลด…':customerLoyaltyState?.error?'อ่านแต้มไม่ได้':'—';
    host.classList.toggle('customer-purchase-error',!!customerLoyaltyState?.error);
  });
  document.querySelectorAll('[data-customer-loyalty-expiry]').forEach(host=>{
    const account=customerLoyaltyState?.data?.find(row=>String(row.customerId)===String(host.dataset.customerLoyaltyExpiry));
    host.textContent=account?fmtDateShort(account.expiresOn):customerLoyaltyState?.loading?'กำลังโหลด…':customerLoyaltyState?.error?'อ่านวันหมดอายุไม่ได้':'—';
    host.classList.toggle('customer-purchase-error',!!customerLoyaltyState?.error);
  });
}
function bindCustomerLoyaltyEvents(){
  document.querySelectorAll('[data-refresh-loyalty]').forEach(button=>button.onclick=()=>{customerLoyaltyState=null;refreshCustomerLoyaltyPanel();});
  document.querySelectorAll('[data-clear-loyalty]').forEach(button=>button.onclick=()=>{saleLoyaltySelection=null;render();});
  document.querySelectorAll('[data-redeem-loyalty]').forEach(button=>button.onclick=openLoyaltyRedemption);
  document.querySelectorAll('[data-customer-history]').forEach(button=>button.onclick=()=>openCustomerPurchaseHistory(button.dataset.customerHistory));
}
async function openLoyaltyRedemption(){
  const customer=activeSaleCustomer();if(!customer?.id) return;
  const state=loadCustomerLoyalty([customer.id],true);await state.promise;
  if(String(activeSaleCustomer()?.id)!==String(customer.id)||currentTab!=='checkout') return;
  const account=state.data?.[0];if(!account){showToast(state.error,'danger-top');return;}
  const limit=loyaltyRedemptionLimit(cartTaxSummary(applyPromotions(cart),saleDiscount).total,account.balance);
  if(!limit){showToast('ยอดซื้อต้องถึง 1,000 บาท และมีแต้มคงเหลือก่อนใช้แต้ม','warning-top');return;}
  const overlay=document.createElement('div');overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal loyalty-modal" role="dialog" aria-modal="true" aria-labelledby="loyaltyRedeemTitle"><div class="modal-head"><h3 id="loyaltyRedeemTitle">ใช้แต้มเป็นส่วนลด</h3><button class="modal-close" aria-label="ปิด">×</button></div><div class="loyalty-modal-body"><p>${escapeHtml(customer.name)} · ใช้ได้สูงสุด ${limit} แต้ม</p><label for="loyaltyPointsInput">จำนวนแต้ม (1 แต้ม = 1 บาท)</label><input id="loyaltyPointsInput" type="number" min="0" max="${limit}" step="1" value="${Math.min(limit,Number(saleLoyaltySelection?.points)||0)}"><small>แต้มหมดอายุ ${escapeHtml(fmtDateShort(account.expiresOn))}</small><div class="form-final-actions" style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn ghost" id="loyaltyUseMax">ใช้สูงสุด</button><button class="btn primary" id="loyaltyApply">ยืนยัน</button></div></div></div>`;
  document.body.appendChild(overlay);const input=overlay.querySelector('#loyaltyPointsInput');
  overlay.querySelector('.modal-close').onclick=()=>overlay.remove();
  overlay.querySelector('#loyaltyUseMax').onclick=()=>{input.value=limit;};
  overlay.querySelector('#loyaltyApply').onclick=()=>{
    const points=Number(input.value);
    if(!Number.isInteger(points)||points<0||points>limit){showToast(`กรอกจำนวนเต็มตั้งแต่ 0 ถึง ${limit} แต้ม`,'warning-top');return;}
    if(String(activeSaleCustomer()?.id)!==String(customer.id)){overlay.remove();return;}
    saleLoyaltySelection=points?{customerId:customer.id,points,periodStart:account.periodStart}:null;
    overlay.remove();render();
  };
  input.focus();input.select();
}
function saleLoyaltySummaryHtml(sale){
  const points=sale?.loyalty;if(!points) return '';
  return `<div class="sale-loyalty-summary"><div>ได้รับ ${escapeHtml(points.earned)} แต้ม · ใช้ ${escapeHtml(points.redeemed)} แต้ม</div><div>แต้มคงเหลือหลังบิลนี้ ${escapeHtml(points.balanceAfter)} แต้ม</div><div>หมดอายุ ${escapeHtml(fmtDateShort(points.expiresOn))}</div></div>`;
}
function customerPurchaseLoad(ids,view=null){
  const today=currentDateStr();
  const posTierOnly=currentTab==='checkout'&&!view&&ids.length===1;
  const params={p_customer_ids:ids.map(String),p_year:Number(view?.year||today.slice(0,4)),p_month:view?.mode==='month'?Number(view.month):null,p_page:view?.page||1,p_include_bills:!!view,p_warehouse_id:Number(activeWarehouseId)||null};
  const key=JSON.stringify([currentProfile?.id,activeWarehouseId,pagePermissionRows,today,posTierOnly,params]);
  if(customerPurchaseState?.key===key&&Date.now()-customerPurchaseState.loadedAt<60000) return customerPurchaseState;
  const state={key,loading:ids.length>0,data:ids.length?null:{summaries:[]},error:'',loadedAt:Date.now()};
  customerPurchaseState=state;
  if(!ids.length) return state;
  Promise.resolve().then(async()=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      if(!sb||(!posTierOnly&&!canPerformPageAction('view','contacts'))) throw new Error('ไม่สามารถอ่านประวัติการซื้อได้');
      const request=posTierOnly
        ?sb.rpc('get_pos_customer_tier_progress',{p_customer_id:String(ids[0]),p_warehouse_id:Number(activeWarehouseId)||null})
        :sb.rpc('get_customer_purchase_history',params);
      const {data,error}=await request.abortSignal(controller.signal);
      if(error) throw error;
      if(!data||!Array.isArray(data.summaries)) throw new Error('ข้อมูลประวัติการซื้อไม่ครบถ้วน');
      state.data=data;
    }catch(error){
      console.warn('Customer purchase history failed',error?.code||error?.message);
      state.error='โหลดประวัติการซื้อไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อหรือสิทธิ์ แล้วกดรีเฟรชยอดซื้อ';
    }finally{
      clearTimeout(timeout);
      state.loading=false; state.loadedAt=Date.now();
      // An earlier request must never replace another customer's/current user's view.
      if(customerPurchaseState===state&&view&&posCustomerHistoryModalOpen&&document.getElementById('posCustomerHistoryContent')){
        refreshCustomerHistoryDisplay();
      }else if(customerPurchaseState===state&&currentTab==='customers'&&!editingContactId&&!editingCustomerPriceContactId){
        const focused=document.activeElement,focusId=focused?.id;
        const start=focused?.selectionStart,end=focused?.selectionEnd;
        const fields=[...document.querySelectorAll('#search,#customerHistoryYear,#customerHistoryMonth')].map(input=>[input.id,input.value]);
        render();
        fields.forEach(([id,value])=>{const input=document.getElementById(id);if(input) input.value=value;});
        const input=focusId&&document.getElementById(focusId);
        if(input){input.focus({preventScroll:true});if(input.type!=='number'&&Number.isInteger(start)&&input.setSelectionRange) input.setSelectionRange(start,end);}
      }else if(customerPurchaseState===state&&currentTab==='checkout'&&!view&&ids.length===1&&String(activeSaleCustomer()?.id)===String(ids[0])){
        refreshCustomerLoyaltyPanel();
      }
    }
  });
  return state;
}
function customerPurchaseNotice(state){
  if(!state?.error) return '';
  return `<p class="customer-purchase-notice customer-purchase-error" role="alert">${escapeHtml(state.error)}</p>`;
}
function customerTierOnlyHtml(state,id){
  const summary=state?.data?.summaries?.find(row=>String(row.customerId)===String(id));
  if(!summary) return `<span class="muted">${state?.loading?'กำลังโหลด…':state?.error?'ยังคำนวณไม่ได้':'—'}</span>`;
  const tier=customerTierFromPurchases(summary.membershipCycleTotal,summary.membershipElapsedMonths);
  return `<span class="customer-tier customer-tier-${tier.key}">${tier.label}</span>`;
}
function customerTierOverviewHtml(state,id){
  const summary=state?.data?.summaries?.find(row=>String(row.customerId)===String(id));
  const current=summary?customerTierFromPurchases(summary.membershipCycleTotal,summary.membershipElapsedMonths):null;
  const tiers=[
    {key:'general',label:'ลูกค้าทั่วไป'},
    {key:'regular',label:'ลูกค้าประจำ'},
    {key:'special',label:'ลูกค้าพิเศษ'}
  ];
  const choices=tiers.map(tier=>{
    const active=tier.key===current?.key;
    return `<div class="customer-tier-choice customer-tier-choice-${tier.key}${active?' is-current':''}"${active?' aria-current="true"':''}><span>${tier.label}</span></div>`;
  }).join('');
  const status=current?'':`<small class="customer-tier-overview-status">${state?.loading?'กำลังคำนวณระดับ…':state?.error?'ยังคำนวณระดับไม่ได้':'—'}</small>`;
  return `<div class="customer-tier-overview">${choices}</div>${status}${current?customerTierProgressHtml(state,id,'history'):''}`;
}
function customerTierProgressHtml(state,id,context='history'){
  const summary=state?.data?.summaries?.find(row=>String(row.customerId)===String(id));
  if(!summary) return `<div class="customer-tier-progress-status ${state?.error?'is-error':''}">${state?.loading?'กำลังคำนวณความคืบหน้า…':state?.error?'คำนวณความคืบหน้าไม่ได้':'—'}</div>`;
  const progress=customerTierProgress(summary.membershipCycleTotal,summary.membershipElapsedMonths);
  const message=progress.nextLabel?`ซื้ออีก ${fmtMoney(progress.remaining)} บาท ถึง${progress.nextLabel}`:'ถึงระดับสูงสุดแล้ว';
  const label=context==='pos'?progress.tier.label:'ความคืบหน้าสู่ระดับถัดไป';
  return `<div class="customer-tier-progress customer-tier-progress-${context}"><div class="customer-tier-progress-head"><span>${label}</span><strong>${message}</strong></div><div class="customer-tier-progress-track" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress.percent)}"><span style="width:${progress.percent.toFixed(2)}%"></span></div></div>`;
}
function customerMonthlyAverageHtml(state,id){
  const summary=state?.data?.summaries?.find(row=>String(row.customerId)===String(id));
  if(!summary) return `<span class="muted">${state?.loading?'กำลังโหลด…':state?.error?'ยังคำนวณไม่ได้':'—'}</span>`;
  return `${fmtMoney(customerTierFromPurchases(summary.membershipCycleTotal,summary.membershipElapsedMonths).average)} บาท`;
}
function renderCustomerPurchaseHistory(){
  const view=customerHistoryView;
  const customer=customersList().find(c=>String(c.id)===String(view?.id));
  if(!customer) return '<div class="empty">ไม่พบลูกค้า <button class="btn ghost" id="closeCustomerHistory">ย้อนกลับ</button></div>';
  const state=customerPurchaseLoad([customer.id],view),data=state.data;
  const summary=data?.summaries?.[0];
  const bills=data?.bills||[];
  const money=value=>summary?`${fmtMoney(value)} บาท`:'—';
  const monthlyAverage=summary?`${fmtMoney(customerTierFromPurchases(summary.membershipCycleTotal,summary.membershipElapsedMonths).average)} บาท`:'—';
  const page=data?.page||view.page;
  const totalPages=Math.max(1,Math.ceil(Number(data?.totalBills||0)/10));
  return `<div class="rpt customer-purchases-page">
    <div class="pagehead"><h1>${escapeHtml(customer.name)} <span class="page-title-meta">· ประวัติการซื้อ</span></h1><div class="form-final-actions" style="display:flex;gap:8px;"><button class="btn ghost" id="closeCustomerHistory">ย้อนกลับ</button><button class="btn primary" id="refreshCustomerPurchases">รีเฟรชยอดซื้อ</button></div></div>
    <div class="customer-purchase-cards">
      <section class="customer-purchase-summary-card"><div class="customer-purchase-summary-row"><span>ยอดซื้อทั้งหมด</span><strong>${money(summary?.lifetimeTotal)}</strong></div><div class="customer-purchase-summary-row"><span>${view.mode==='month'?'ยอดซื้อเดือนนี้':'ยอดซื้อต่อปี'}</span><strong>${money(summary?.periodTotal)}</strong><small>${summary?`${view.mode==='month'?String(view.month).padStart(2,'0')+'/':''}${view.year} · ${summary.periodBills} บิลสำเร็จ`:''}</small></div><div class="customer-purchase-summary-row"><span>ยอดเฉลี่ย</span><strong>${monthlyAverage}</strong><small>${summary?'ต่อเดือน':''}</small></div></section>
      <section class="customer-purchase-loyalty-card"><div id="${posCustomerHistoryModalOpen?'posCustomerHistoryLoyaltyPanel':'customerLoyaltyPanel'}" data-customer-loyalty-host data-readonly="true">${customerLoyaltyPanelHtml(customer,true)}</div></section>
      <section class="customer-purchase-tier-card"><span>ระดับปัจจุบัน</span><div>${customerTierOverviewHtml(state,customer.id)}</div></section>
    </div>
    <div class="customer-purchase-filters">
      <label>แสดงประวัติ<select id="customerHistoryMode"><option value="month" ${view.mode==='month'?'selected':''}>รายเดือน</option><option value="year" ${view.mode==='year'?'selected':''}>รายปี</option></select></label>
      <label>ปี (ค.ศ.)<input id="customerHistoryYear" type="number" min="1900" max="9998" step="1" value="${view.year}"></label>
      ${view.mode==='month'?`<label>เดือน<select id="customerHistoryMonth">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${Number(view.month)===i+1?'selected':''}>${new Intl.DateTimeFormat('th-TH',{month:'long'}).format(new Date(2026,i,1))}</option>`).join('')}</select></label>`:''}
      <button class="btn primary" id="applyCustomerHistory">แสดงผล</button><span>${data?data.totalBills+' บิล':''}</span>
    </div>
    ${customerPurchaseNotice(state)}
    <div class="doc-list-wrap seamless-table-wrap"><table class="grid-table doc-head-blue customer-purchase-table"><thead><tr><th class="customer-purchase-centered">วันที่</th><th class="customer-purchase-centered">เลขที่บิล</th><th>สินค้าที่ซื้อ</th><th class="customer-purchase-centered">ยอดบิล</th><th class="customer-purchase-centered">สถานะ</th></tr></thead><tbody>
      ${bills.map(bill=>`<tr><td class="customer-purchase-centered">${escapeHtml(fmtDateShort(bill.date))}</td><td class="mono customer-purchase-centered">${escapeHtml(bill.ref||bill.id)}</td><td class="customer-purchase-items"><details><summary>ดูสินค้า ${Array.isArray(bill.items)?bill.items.length:0} รายการ</summary>${(Array.isArray(bill.items)?bill.items:[]).map(item=>`<div><b>${escapeHtml(item.name||'-')}</b><span>${escapeHtml(item.qty)} ${escapeHtml(item.unit||'')} × ${fmtMoney(item.price||0)} บาท</span></div>`).join('')}</details></td><td class="mono customer-purchase-centered">${fmtMoney(bill.total)}</td><td class="customer-purchase-centered">${bill.status==='void'?'<span class="customer-void">ยกเลิก · ไม่นับยอดซื้อ</span>':'สำเร็จ'}</td></tr>`).join('')||`<tr><td colspan="5" class="customer-purchase-empty">${state.loading?'กำลังโหลดประวัติการซื้อ…':state.error?'ยังไม่สามารถแสดงข้อมูลได้':'ไม่มีบิลในช่วงที่เลือก'}</td></tr>`}
    </tbody></table></div>${data?pagerHtml(page,totalPages,'customerhistorypage'):''}
  </div>`;
}
function attachCustomerPurchaseEvents(){
  bindCustomerLoyaltyEvents();
  document.querySelectorAll('.navbtn').forEach(button=>{
    if(button.dataset.customerHistoryReset) return;
    button.dataset.customerHistoryReset='1';
    button.addEventListener('click',()=>{customerHistoryView=null;customerPurchaseState=null;contactPage=1;},{capture:true});
  });
  const close=document.getElementById('closeCustomerHistory');
  if(close) close.onclick=()=>{
    const overlay=close.closest('.pos-customer-history-overlay');
    customerHistoryView=null;customerPurchaseState=null;
    if(overlay){posCustomerHistoryModalOpen=false;overlay.remove();render();return;}
    render();
  };
  const refresh=document.getElementById('refreshCustomerPurchases');
  if(refresh) refresh.onclick=()=>{customerPurchaseState=null;customerLoyaltyState=null;refreshCustomerHistoryDisplay();};
  const apply=document.getElementById('applyCustomerHistory');
  const mode=document.getElementById('customerHistoryMode');
  const applyFilters=()=>{
    const year=Number(document.getElementById('customerHistoryYear')?.value);
    if(!Number.isInteger(year)||year<1900||year>9998){showToast('กรุณากรอกปี ค.ศ. ให้ถูกต้อง');return;}
    Object.assign(customerHistoryView,{mode:mode.value,year,month:Number(document.getElementById('customerHistoryMonth')?.value)||customerHistoryView.month,page:1});
    customerPurchaseState=null;refreshCustomerHistoryDisplay();
  };
  if(apply) apply.onclick=applyFilters;
  if(mode) mode.onchange=applyFilters;
  document.querySelectorAll('[data-customerhistorypage]').forEach(button=>button.onclick=()=>{
    const value=button.dataset.customerhistorypage,current=customerPurchaseState?.data?.page||customerHistoryView.page;
    customerHistoryView.page=value==='prev'?Math.max(1,current-1):value==='next'?current+1:Number(value);
    customerPurchaseState=null;refreshCustomerHistoryDisplay();
  });
}
function refreshCustomerHistoryDisplay(){
  const host=document.getElementById('posCustomerHistoryContent');
  if(!host){render();return;}
  host.innerHTML=renderCustomerPurchaseHistory();
  prepareScrollableTables(host);
  attachCustomerPurchaseEvents();
  requestAnimationFrame(()=>refreshScrollableTableHeights(host));
}
async function openCustomerPurchaseHistory(customerId){
  const today=currentDateStr(),originTab=currentTab;
  customerHistoryView={id:customerId,mode:'month',year:Number(today.slice(0,4)),month:Number(today.slice(5,7)),page:1,originTab:originTab==='checkout'?'checkout':'customers'};
  customerPurchaseState=null;
  if(originTab==='checkout'){
    document.querySelector('.pos-customer-history-overlay')?.remove();
    posCustomerHistoryModalOpen=true;
    const overlay=document.createElement('div');
    overlay.className='modal-overlay pos-customer-history-overlay';
    overlay.innerHTML='<div class="modal pos-customer-history-modal" role="dialog" aria-modal="true" aria-label="ประวัติลูกค้า"><div id="posCustomerHistoryContent"><div class="hint" role="status">กำลังโหลดประวัติลูกค้า...</div></div></div>';
    document.body.appendChild(overlay);
    try{
      // Production extracts customer-history rendering into the catalog chunk.
      // Wait for it before rendering so POS never leaves an empty modal behind.
      await ensurePageCodeLoaded('customers');
      if(!overlay.isConnected||currentTab!=='checkout'||String(customerHistoryView?.id)!==String(customerId)) return;
      refreshCustomerHistoryDisplay();
    }catch(error){
      if(!overlay.isConnected) return;
      const host=overlay.querySelector('#posCustomerHistoryContent');
      host.innerHTML=`<div class="empty" role="alert">${escapeHtml(error?.message||'เปิดประวัติลูกค้าไม่สำเร็จ')}<div class="form-final-actions"><button class="btn ghost" id="closeCustomerHistoryLoad" type="button">ปิด</button><button class="btn primary" id="retryCustomerHistoryLoad" type="button">ลองใหม่</button></div></div>`;
      host.querySelector('#closeCustomerHistoryLoad').onclick=()=>{ posCustomerHistoryModalOpen=false; customerHistoryView=null; overlay.remove(); refreshCustomerLoyaltyPanel(); };
      host.querySelector('#retryCustomerHistoryLoad').onclick=()=>{ overlay.remove(); openCustomerPurchaseHistory(customerId); };
    }
    return;
  }
  posCustomerHistoryModalOpen=false;render();
}
