function openMedicineLabelEditor(lineId){
  const line=cart.find(item=>String(item.lineId)===String(lineId)); if(!line||line.autoFreeFromPromo) return;
  document.querySelector('.medicine-label-modal')?.closest('.modal-overlay')?.remove();
  const existing=normalizeDispensingLabel(line.dispensingLabel);
  const otherPatient=cart.map(item=>normalizeDispensingLabel(item.dispensingLabel)?.patientName).find(Boolean)||'';
  const savedDoseUnits=getMedicineLabelDoseUnits(),lineUnit=String(line.unit||'').trim();
  const draft={
    drugName:existing?.drugName||String(line.name||'').trim(),
    patientName:existing?.patientName||otherPatient||medicineLabelMemberName(),
    indication:existing?.indication||'',
    doseAmount:existing?.doseAmount||'1',
    doseUnit:existing?.doseUnit||(savedDoseUnits.includes(lineUnit)?lineUnit:(savedDoseUnits.includes('เม็ด')?'เม็ด':savedDoseUnits[0])),
    durationMode:existing?.durationMode||'days',
    durationDays:existing?.durationDays||'',
    mealTiming:existing?.mealTiming||'none',
    intervalValue:existing?.intervalValue||'',
    intervalUnit:existing?.intervalUnit||'hours',
    doseTimes:existing?.doseTimes||[],
    warning:existing?.warning||'',
    pharmacistName:existing?.pharmacistName||currentPharmacistName(),
  };
  const doseUnits=savedDoseUnits.includes(draft.doseUnit)?savedDoseUnits:[draft.doseUnit,...savedDoseUnits];
  const overlay=document.createElement('div'); overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal medicine-label-modal"><div class="modal-head"><h3>จัดทำฉลากยา</h3><button class="modal-close" type="button">×</button></div>
    <div class="medicine-label-product"><b>${escapeHtml(line.name||'รายการยา')}</b><span>จำนวน ${escapeHtml(line.qty)} ${escapeHtml(line.unit||'หน่วย')}</span></div>
    <form class="medicine-label-form" id="medicineLabelForm">
      <div class="medicine-label-grid">
        <label class="medicine-label-field wide"><span>ชื่อยา *</span><input id="medicineLabelDrugName" value="${escapeHtml(draft.drugName)}" autocomplete="off" required></label>
        <label class="medicine-label-field"><span>ชื่อผู้รับยา *</span><input id="medicineLabelPatient" value="${escapeHtml(draft.patientName)}" autocomplete="off" required></label>
        <label class="medicine-label-field"><span>เภสัชกร *</span><input id="medicineLabelPharmacist" value="${escapeHtml(draft.pharmacistName)}" autocomplete="off" required></label>
        <label class="medicine-label-field"><span>ข้อบ่งใช้ *</span><input id="medicineLabelIndication" value="${escapeHtml(draft.indication)}" placeholder="เช่น แก้ปวด ลดไข้" autocomplete="off" required></label>
        <label class="medicine-label-field"><span>ขนาดฉลาก</span><select id="medicineLabelSize">${Object.entries(MEDICINE_LABEL_SIZES).map(([value,option])=>`<option value="${value}" ${value===medicineLabelSize?'selected':''}>${option.label}</option>`).join('')}</select></label>
        <div class="medicine-label-dose-fields">
          <label class="medicine-label-field"><span>ขนาดรับประทานต่อครั้ง *</span><input id="medicineLabelDoseAmount" type="number" min="0.01" step="0.01" value="${escapeHtml(draft.doseAmount)}" inputmode="decimal" required></label>
          <div class="medicine-label-field"><label for="medicineLabelDoseUnit">หน่วยรับประทาน *</label><div class="medicine-label-unit-select-wrap"><select id="medicineLabelDoseUnit" required>${doseUnits.map(unit=>`<option data-dose-unit-option value="${escapeHtml(unit)}" ${unit===draft.doseUnit?'selected':''}>${escapeHtml(unit)}</option>`).join('')}<option class="medicine-label-dose-unit-divider" disabled>──────────</option><option class="medicine-label-dose-unit-manage-option" value="__manage_dose_units__">⚙ จัดการหน่วยรับประทาน</option></select></div></div>
          <label class="medicine-label-field"><span>ระยะเวลา *</span><select id="medicineLabelDurationMode" required>${MEDICINE_LABEL_DURATION_OPTIONS.map(option=>`<option value="${option.value}" ${option.value===draft.durationMode?'selected':''}>${option.label}</option>`).join('')}</select></label>
          <label class="medicine-label-field" id="medicineLabelDurationDaysField" ${draft.durationMode==='days'?'':'hidden'}><span>จำนวนวัน *</span><input id="medicineLabelDurationDays" type="number" min="1" step="1" value="${escapeHtml(draft.durationDays)}" inputmode="numeric" ${draft.durationMode==='days'?'required':''}></label>
        </div>
        <fieldset class="medicine-label-option-group medicine-label-meal-group"><legend>มื้ออาหาร / ช่วงเวลารับประทาน</legend>
          <div class="medicine-label-options medicine-label-meal-row">${MEDICINE_LABEL_MEAL_OPTIONS.map(option=>`<label class="medicine-label-option"><input type="checkbox" name="medicineLabelMealTiming" value="${option.value}" ${draft.mealTiming===option.value?'checked':''}>${option.label}</label>`).join('')}</div>
          <div class="medicine-label-options medicine-label-meal-row medicine-label-meal-row-secondary">
            ${MEDICINE_LABEL_TIME_OPTIONS.map(option=>`<label class="medicine-label-option"><input type="checkbox" name="medicineLabelDoseTime" value="${option.value}" ${draft.doseTimes.includes(option.value)?'checked':''}>${option.label}</label>`).join('')}
            <span class="medicine-label-or">หรือ</span><span class="medicine-label-every-hours"><label class="medicine-label-option"><input type="checkbox" id="medicineLabelEveryIntervalEnabled" ${draft.intervalValue?'checked':''}>ทุก</label><input class="medicine-label-inline-number" id="medicineLabelIntervalValue" type="number" min="1" step="1" value="${escapeHtml(draft.intervalValue)}" inputmode="numeric" aria-label="จำนวนช่วงเวลา" ${draft.intervalValue?'required':'disabled'}><select class="medicine-label-inline-unit" id="medicineLabelIntervalUnit" aria-label="หน่วยช่วงเวลา" ${draft.intervalValue?'':'disabled'}><option value="hours" ${draft.intervalUnit==='hours'?'selected':''}>ชั่วโมง</option><option value="minutes" ${draft.intervalUnit==='minutes'?'selected':''}>นาที</option></select></span>
          </div>
        </fieldset>
        <fieldset class="medicine-label-option-group medicine-label-warning-group"><legend>เพิ่มเติม / ข้อควรระวัง</legend>
          <textarea id="medicineLabelWarning" placeholder="พิมพ์ข้อความเพิ่มเติมหรือข้อควรระวังของฉลากนี้">${escapeHtml(draft.warning)}</textarea>
          <div class="medicine-label-quick-list" id="medicineLabelWarningQuickList"></div>
          <div class="medicine-label-warning-quick-head"><button class="medicine-label-warning-popup-open" id="medicineLabelWarningPresetOpen" type="button">เพิ่มข้อความ</button></div>
        </fieldset>
      </div>
      <div class="medicine-label-safety">เภสัชกรต้องตรวจสอบชื่อยา ขนาดต่อครั้ง หน่วย ระยะเวลา ช่วงรับประทานหรือความถี่เป็นชั่วโมง/นาที และคำเตือนก่อนพิมพ์ ระบบจะไม่กำหนดวิธีใช้ยาให้เอง</div>
      <div class="medicine-label-actions">${existing?'<button class="btn ghost" type="button" id="removeMedicineLabelBtn">นำฉลากออก</button>':''}<button class="btn ghost" type="button" id="cancelMedicineLabelBtn">ยกเลิก</button><button class="btn primary" type="submit">บันทึกฉลากยา</button></div>
    </form></div>`;
  document.body.appendChild(overlay);
  let doseUnitPopup=null,warningPresetPopup=null;
  const close=()=>{ doseUnitPopup?.remove(); warningPresetPopup?.remove(); doseUnitPopup=null; warningPresetPopup=null; overlay.remove(); };
  overlay.querySelector('.modal-close').onclick=close;
  overlay.querySelector('#cancelMedicineLabelBtn').onclick=close;
  const doseUnitManageValue='__manage_dose_units__',doseUnitSelect=overlay.querySelector('#medicineLabelDoseUnit');
  let selectedDoseUnit=String(draft.doseUnit||doseUnits[0]||'').trim();
  const renderDoseUnitSelect=(preferredUnit='')=>{
    const stored=getMedicineLabelDoseUnits(),current=String(preferredUnit||selectedDoseUnit||stored[0]||'').trim();
    const selectable=stored.includes(current)?stored:[current,...stored].filter(Boolean);
    selectedDoseUnit=selectable.includes(current)?current:(stored[0]||'');
    doseUnitSelect.innerHTML=`${selectable.map(unit=>`<option data-dose-unit-option value="${escapeHtml(unit)}">${escapeHtml(unit)}</option>`).join('')}<option class="medicine-label-dose-unit-divider" disabled>──────────</option><option class="medicine-label-dose-unit-manage-option" value="${doseUnitManageValue}">⚙ จัดการหน่วยรับประทาน</option>`;
    doseUnitSelect.value=selectedDoseUnit;
  };
  const openMedicineLabelDoseUnitPopup=()=>{
    if(doseUnitPopup) return;
    const stored=getMedicineLabelDoseUnits();
    if(selectedDoseUnit&&!stored.includes(selectedDoseUnit)) saveMedicineLabelDoseUnits([selectedDoseUnit,...stored]);
    const popup=document.createElement('div');
    popup.className='modal-overlay medicine-label-dose-unit-overlay';
    popup.innerHTML=`<div class="modal medicine-label-dose-unit-modal" role="dialog" aria-modal="true" aria-labelledby="medicineLabelDoseUnitPopupTitle">
      <div class="modal-head"><div><h3 id="medicineLabelDoseUnitPopupTitle">จัดการหน่วยรับประทาน</h3><div class="medicine-label-unit-popup-sub">เพิ่ม ลบ หรือจัดเรียงหน่วยสำหรับรายการเลือก</div></div><button class="modal-close" id="medicineLabelDoseUnitPopupClose" type="button" aria-label="ปิด">×</button></div>
      <div class="medicine-label-unit-popup-body">
        <div class="medicine-label-unit-add"><input id="medicineLabelDoseUnitNew" maxlength="40" placeholder="เช่น หลอด หรือ ซีซี" autocomplete="off"><button id="medicineLabelDoseUnitAdd" type="button">เพิ่มหน่วย</button></div>
        <div class="medicine-label-unit-list" id="medicineLabelDoseUnitList"></div>
      </div>
      <div class="medicine-label-unit-popup-actions"><button class="btn ghost" id="medicineLabelDoseUnitPopupDone" type="button">ปิด</button></div>
    </div>`;
    document.body.appendChild(popup); doseUnitPopup=popup;
    const popupList=popup.querySelector('#medicineLabelDoseUnitList'),popupInput=popup.querySelector('#medicineLabelDoseUnitNew');
    const closePopup=()=>{ popup.remove(); if(doseUnitPopup===popup) doseUnitPopup=null; doseUnitSelect.focus(); };
    const renderPopupList=()=>{
      const units=getMedicineLabelDoseUnits();
      popupList.innerHTML=units.map((unit,index)=>`<div class="medicine-label-unit-row" data-dose-unit-index="${index}"><span>${escapeHtml(unit)}</span><div class="medicine-label-unit-row-actions"><button type="button" data-dose-unit-action="up" title="เลื่อน ${escapeHtml(unit)} ขึ้น" aria-label="เลื่อน ${escapeHtml(unit)} ขึ้น" ${index===0?'disabled':''}>↑</button><button type="button" data-dose-unit-action="down" title="เลื่อน ${escapeHtml(unit)} ลง" aria-label="เลื่อน ${escapeHtml(unit)} ลง" ${index===units.length-1?'disabled':''}>↓</button><button class="delete" type="button" data-dose-unit-action="delete" aria-label="ลบ ${escapeHtml(unit)}">ลบ</button></div></div>`).join('');
    };
    const addDoseUnit=()=>{
      const unit=normalizeMedicineLabelDoseUnits([popupInput.value])[0]||'';
      if(!unit){ showToast('กรุณากรอกชื่อหน่วยรับประทาน','danger-top'); popupInput.focus(); return; }
      const units=getMedicineLabelDoseUnits(),existingUnit=units.find(value=>value.toLocaleLowerCase('th-TH')===unit.toLocaleLowerCase('th-TH'));
      if(existingUnit){ renderDoseUnitSelect(existingUnit); showToast('มีหน่วยรับประทานนี้อยู่แล้ว'); }
      else{ saveMedicineLabelDoseUnits([...units,unit]); renderDoseUnitSelect(unit); renderPopupList(); showToast(`เพิ่มหน่วย “${unit}” แล้ว`); }
      popupInput.value=''; popupInput.focus();
    };
    popup.querySelector('#medicineLabelDoseUnitAdd').onclick=addDoseUnit;
    popupInput.onkeydown=event=>{ if(event.key==='Enter'){ event.preventDefault(); addDoseUnit(); } };
    popupList.onclick=event=>{
      const button=event.target.closest('[data-dose-unit-action]'); if(!button||button.disabled) return;
      const row=button.closest('[data-dose-unit-index]'),index=Number(row?.dataset.doseUnitIndex),action=button.dataset.doseUnitAction,units=getMedicineLabelDoseUnits();
      if(!Number.isInteger(index)||index<0||index>=units.length) return;
      let nextSelected=selectedDoseUnit;
      if(action==='delete'){
        if(units.length===1){ showToast('ต้องมีหน่วยรับประทานอย่างน้อย 1 หน่วย','danger-top'); return; }
        if(!confirm(`ลบหน่วยรับประทาน “${units[index]}” หรือไม่?`)) return;
        const removed=units.splice(index,1)[0];
        if(nextSelected===removed) nextSelected=units[Math.min(index,units.length-1)];
      }else{
        const target=action==='up'?index-1:index+1;
        if(target<0||target>=units.length) return;
        [units[index],units[target]]=[units[target],units[index]];
      }
      saveMedicineLabelDoseUnits(units); renderDoseUnitSelect(nextSelected); renderPopupList();
    };
    popup.querySelector('#medicineLabelDoseUnitPopupClose').onclick=closePopup;
    popup.querySelector('#medicineLabelDoseUnitPopupDone').onclick=closePopup;
    popup.onclick=event=>{ if(event.target===popup) closePopup(); };
    renderPopupList(); setTimeout(()=>popupInput.focus(),0);
  };
  doseUnitSelect.onchange=()=>{
    if(doseUnitSelect.value===doseUnitManageValue){ renderDoseUnitSelect(selectedDoseUnit); openMedicineLabelDoseUnitPopup(); }
    else selectedDoseUnit=doseUnitSelect.value;
  };
  renderDoseUnitSelect(draft.doseUnit);
  const durationModeField=overlay.querySelector('#medicineLabelDurationMode'),durationDaysField=overlay.querySelector('#medicineLabelDurationDaysField'),durationDaysInput=overlay.querySelector('#medicineLabelDurationDays');
  const mealTimingInputs=[...overlay.querySelectorAll('input[name="medicineLabelMealTiming"]')];
  mealTimingInputs.forEach(input=>input.onchange=()=>{ if(input.checked) mealTimingInputs.forEach(other=>{ if(other!==input) other.checked=false; }); });
  const syncDurationDaysField=()=>{ const usesDays=durationModeField.value==='days'; durationDaysField.hidden=!usesDays; durationDaysInput.disabled=!usesDays; durationDaysInput.required=usesDays; };
  durationModeField.onchange=syncDurationDaysField; syncDurationDaysField();
  const everyIntervalToggle=overlay.querySelector('#medicineLabelEveryIntervalEnabled'),intervalValueInput=overlay.querySelector('#medicineLabelIntervalValue'),intervalUnitField=overlay.querySelector('#medicineLabelIntervalUnit');
  const syncIntervalField=()=>{ intervalValueInput.disabled=!everyIntervalToggle.checked; intervalValueInput.required=everyIntervalToggle.checked; intervalUnitField.disabled=!everyIntervalToggle.checked; if(!everyIntervalToggle.checked) intervalValueInput.value=''; };
  everyIntervalToggle.onchange=()=>{ syncIntervalField(); if(everyIntervalToggle.checked) intervalValueInput.focus(); }; syncIntervalField();
  const warningField=overlay.querySelector('#medicineLabelWarning'),warningQuickList=overlay.querySelector('#medicineLabelWarningQuickList'),warningPresetOpenButton=overlay.querySelector('#medicineLabelWarningPresetOpen');
  const renderMedicineLabelWarningPresets=()=>{
    const stored=getMedicineLabelWarningPresets();
    warningQuickList.innerHTML=stored.length
      ?stored.map((text,index)=>`<button class="medicine-label-quick" type="button" data-medicine-warning-preset="${index}">${escapeHtml(text)}</button>`).join('')
      :'<div class="medicine-label-warning-preset-empty">ยังไม่มีคำเตือน Quick Use</div>';
  };
  const appendMedicineLabelWarning=text=>{
    const warning=String(text||'').trim(); if(!warning) return;
    const values=String(warningField.value||'').split('\n').map(value=>value.trim()).filter(Boolean);
    if(!values.some(value=>value.toLocaleLowerCase('th-TH')===warning.toLocaleLowerCase('th-TH'))) values.push(warning);
    warningField.value=values.join('\n'); warningField.focus();
  };
  const openMedicineLabelWarningPresetPopup=()=>{
    if(warningPresetPopup) return;
    const popup=document.createElement('div');
    popup.className='modal-overlay medicine-label-warning-preset-overlay';
    popup.innerHTML=`<div class="modal medicine-label-warning-preset-modal" role="dialog" aria-modal="true" aria-labelledby="medicineLabelWarningPresetPopupTitle">
      <div class="modal-head"><div><h3 id="medicineLabelWarningPresetPopupTitle">ข้อความ Quick Use</h3><div class="medicine-label-warning-preset-sub">เพิ่ม ลบ หรือจัดเรียงข้อความที่ใช้บ่อย</div></div><button class="modal-close" id="medicineLabelWarningPresetPopupClose" type="button" aria-label="ปิด">×</button></div>
      <div class="medicine-label-warning-preset-popup-body">
        <div class="medicine-label-warning-preset-add"><input id="medicineLabelWarningPresetNew" maxlength="180" placeholder="พิมพ์ข้อความใหม่" autocomplete="off"><button class="add" id="medicineLabelWarningPresetAdd" type="button">เพิ่มข้อความ</button></div>
        <div class="medicine-label-warning-preset-list" id="medicineLabelWarningPresetList"></div>
      </div>
      <div class="medicine-label-warning-preset-popup-actions"><button class="btn ghost" id="medicineLabelWarningPresetPopupDone" type="button">ปิด</button></div>
    </div>`;
    document.body.appendChild(popup); warningPresetPopup=popup;
    const popupList=popup.querySelector('#medicineLabelWarningPresetList'),popupInput=popup.querySelector('#medicineLabelWarningPresetNew');
    const closePopup=()=>{ popup.remove(); if(warningPresetPopup===popup) warningPresetPopup=null; warningPresetOpenButton.focus(); };
    const renderPopupList=()=>{
      const stored=getMedicineLabelWarningPresets();
      popupList.innerHTML=stored.length
        ?stored.map((text,index)=>`<div class="medicine-label-warning-preset-row" data-medicine-warning-preset-row="${index}"><span>${escapeHtml(text)}</span><div class="medicine-label-warning-preset-row-actions"><button type="button" data-medicine-warning-preset-action="up" aria-label="เลื่อนคำเตือนขึ้น" ${index===0?'disabled':''}>↑</button><button type="button" data-medicine-warning-preset-action="down" aria-label="เลื่อนคำเตือนลง" ${index===stored.length-1?'disabled':''}>↓</button><button class="delete" type="button" data-medicine-warning-preset-action="delete" aria-label="ลบคำเตือน">ลบ</button></div></div>`).join('')
        :'<div class="medicine-label-warning-preset-empty">ยังไม่มีคำเตือน Quick Use</div>';
    };
    const addPreset=()=>{
      const warning=normalizeMedicineLabelWarningPresets([popupInput.value])[0]||'';
      if(!warning){ showToast('กรุณาพิมพ์คำเตือน Quick Use','danger-top'); popupInput.focus(); return; }
      const stored=getMedicineLabelWarningPresets(),existingPreset=stored.find(value=>value.toLocaleLowerCase('th-TH')===warning.toLocaleLowerCase('th-TH'));
      if(existingPreset) showToast('มีคำเตือน Quick Use นี้อยู่แล้ว');
      else{ saveMedicineLabelWarningPresets([...stored,warning]); renderMedicineLabelWarningPresets(); renderPopupList(); showToast(`บันทึก Quick Use “${warning}” แล้ว`); }
      popupInput.value=''; popupInput.focus();
    };
    popup.querySelector('#medicineLabelWarningPresetAdd').onclick=addPreset;
    popupInput.onkeydown=event=>{ if(event.key==='Enter'){ event.preventDefault(); addPreset(); } };
    popupList.onclick=event=>{
      const button=event.target.closest('[data-medicine-warning-preset-action]'); if(!button||button.disabled) return;
      const row=button.closest('[data-medicine-warning-preset-row]'),index=Number(row?.dataset.medicineWarningPresetRow),action=button.dataset.medicineWarningPresetAction,stored=getMedicineLabelWarningPresets();
      if(!Number.isInteger(index)||index<0||index>=stored.length) return;
      if(action==='delete') stored.splice(index,1);
      else{
        const target=action==='up'?index-1:index+1; if(target<0||target>=stored.length) return;
        [stored[index],stored[target]]=[stored[target],stored[index]];
      }
      saveMedicineLabelWarningPresets(stored); renderMedicineLabelWarningPresets(); renderPopupList();
    };
    popup.querySelector('#medicineLabelWarningPresetPopupClose').onclick=closePopup;
    popup.querySelector('#medicineLabelWarningPresetPopupDone').onclick=closePopup;
    popup.onclick=event=>{ if(event.target===popup) closePopup(); };
    renderPopupList(); setTimeout(()=>popupInput.focus(),0);
  };
  warningPresetOpenButton.onclick=openMedicineLabelWarningPresetPopup;
  warningQuickList.onclick=event=>{
    const button=event.target.closest('[data-medicine-warning-preset]'); if(!button) return;
    appendMedicineLabelWarning(getMedicineLabelWarningPresets()[Number(button.dataset.medicineWarningPreset)]||'');
  };
  renderMedicineLabelWarningPresets();
  const removeButton=overlay.querySelector('#removeMedicineLabelBtn');
  if(removeButton) removeButton.onclick=()=>{ delete line.dispensingLabel; close(); showToast(`นำฉลากยา “${line.name}” ออกจากบิลแล้ว`); render(); };
  overlay.querySelector('#medicineLabelForm').onsubmit=event=>{
    event.preventDefault();
    const doseAmount=overlay.querySelector('#medicineLabelDoseAmount').value,doseUnit=overlay.querySelector('#medicineLabelDoseUnit').value,durationMode=durationModeField.value,durationDays=durationMode==='days'?durationDaysInput.value:'';
    const mealTiming=overlay.querySelector('input[name="medicineLabelMealTiming"]:checked')?.value||'none';
    const intervalValue=everyIntervalToggle.checked?intervalValueInput.value:'',intervalUnit=intervalUnitField.value;
    const doseTimes=[...overlay.querySelectorAll('input[name="medicineLabelDoseTime"]:checked')].map(input=>input.value);
    const durationValid=durationMode!=='days'||(Number.isInteger(Number(durationDays))&&Number(durationDays)>=1);
    const intervalValid=!everyIntervalToggle.checked||(Number.isInteger(Number(intervalValue))&&Number(intervalValue)>=1&&['hours','minutes'].includes(intervalUnit));
    if(!(Number(doseAmount)>0)||!doseUnit||!MEDICINE_LABEL_DURATION_OPTIONS.some(option=>option.value===durationMode)||!durationValid||!intervalValid||(!doseTimes.length&&!intervalValue)){ showToast('กรุณาระบุขนาดต่อครั้ง หน่วย ระยะเวลา และเลือกช่วงเวลารับประทานหรือกรอกความถี่เป็นชั่วโมง/นาที','danger-top'); return; }
    const label=normalizeDispensingLabel({
      enabled:true,
      drugName:overlay.querySelector('#medicineLabelDrugName').value,
      patientName:overlay.querySelector('#medicineLabelPatient').value,
      indication:overlay.querySelector('#medicineLabelIndication').value,
      doseAmount,
      doseUnit,
      durationMode,
      durationDays,
      mealTiming,
      intervalValue,
      intervalUnit,
      doseTimes,
      warning:warningField.value,
      pharmacistName:overlay.querySelector('#medicineLabelPharmacist').value,
    });
    if(!label){ showToast('กรุณากรอกข้อมูลฉลากยาให้ครบ','danger-top'); return; }
    const selectedSize=overlay.querySelector('#medicineLabelSize').value;
    if(!medicineLabelFitsSize(label,selectedSize)){ showToast('ข้อความยาวเกินขนาดฉลากที่เลือก กรุณาใช้ขนาด 80 × 50 มม. หรือย่อข้อความ','danger-top'); return; }
    const oversizedOther=cart.find(item=>String(item.lineId)!==String(line.lineId)&&normalizeDispensingLabel(item.dispensingLabel)&&!medicineLabelFitsSize(item.dispensingLabel,selectedSize));
    if(oversizedOther){ showToast(`ฉลาก “${oversizedOther.name}” ยาวเกินขนาดที่เลือก กรุณาใช้ขนาด 80 × 50 มม.`,'danger-top'); return; }
    line.dispensingLabel=label; setMedicineLabelSize(selectedSize); close(); showToast(`บันทึกฉลากยา “${line.name}” แล้ว`); render();
  };
  setTimeout(()=>overlay.querySelector(existing?'#medicineLabelIndication':'#medicineLabelPatient')?.focus(),0);
}
