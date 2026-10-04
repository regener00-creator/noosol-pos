// ---------- Page renderers ----------
function normalizeNoteColor(value){
  const color=String(value||'').trim();
  if(!/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color)) return '';
  const probe=document.createElement('span');
  probe.style.color=color;
  return probe.style.color||'';
}
function sanitizeNoteHtml(value){
  const template=document.createElement('template');
  template.innerHTML=String(value||'');
  const allowed=new Set(['b','strong','u','s','strike','span','font','div','p','br']);
  const blocked=new Set(['script','style','iframe','object','embed','svg','math','link','meta']);
  [...template.content.querySelectorAll('*')].forEach(element=>{
    const tag=element.tagName.toLowerCase();
    if(blocked.has(tag)){ element.remove(); return; }
    if(!allowed.has(tag)){ element.replaceWith(...element.childNodes); return; }
    const color=normalizeNoteColor(element.getAttribute('color')||element.style?.color||'');
    [...element.attributes].forEach(attribute=>element.removeAttribute(attribute.name));
    if(tag==='font'){
      const span=document.createElement('span');
      if(color) span.style.color=color;
      span.append(...element.childNodes);
      element.replaceWith(span);
      return;
    }
    if(tag==='span'){
      if(color) element.style.color=color;
      else element.replaceWith(...element.childNodes);
    }
  });
  return template.innerHTML;
}
function notePlainText(contentHtml){
  const wrapper=document.createElement('div');
  wrapper.innerHTML=sanitizeNoteHtml(contentHtml);
  return String(wrapper.textContent||'').replace(/\s+/g,' ').trim();
}
function mapNoteRow(row={}){
  const activityRows=Array.isArray(row.representative_activity_items)?row.representative_activity_items:[];
  return {
    id:String(row.id||''),title:String(row.title||''),contentHtml:sanitizeNoteHtml(row.content_html||''),
    hiddenFromLevel2:row.hidden_from_level2===true,createdBy:String(row.created_by||''),updatedBy:String(row.updated_by||''),
    representativeId:row.representative_id==null?null:Number(row.representative_id),productId:row.product_id==null?null:Number(row.product_id),
    activityType:String(row.activity_type||''),eventDate:String(row.event_date||''),validFrom:String(row.valid_from||''),validTo:String(row.valid_to||''),
    quotedPrice:row.quoted_price==null?null:Number(row.quoted_price),minimumQuantity:row.minimum_quantity==null?null:Number(row.minimum_quantity),
    unit:String(row.unit||''),reminderDate:String(row.reminder_date||''),createdAt:row.created_at||'',updatedAt:row.updated_at||'',
    activityItems:activityRows.sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)).map(item=>({
      id:item.id==null?'':Number(item.id),productId:item.product_id==null?null:Number(item.product_id),name:String(item.product_name||''),
      quotedPrice:item.quoted_price==null?null:Number(item.quoted_price),minimumQuantity:item.minimum_quantity==null?null:Number(item.minimum_quantity),
      unit:String(item.unit||''),conditionNote:String(item.condition_note||''),sortOrder:Number(item.sort_order||0)
    }))
  };
}
function noteDraftFromRow(note){
  return note?{title:note.title,contentHtml:sanitizeNoteHtml(note.contentHtml),hiddenFromLevel2:note.hiddenFromLevel2,updatedAt:note.updatedAt}:null;
}
function noteUpdatedText(value){
  const date=new Date(value||'');
  return Number.isNaN(date.getTime())?'-':date.toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'});
}
function canEditNote(note){
  return !!note&&(loggedInUser()?.owner===true||(String(note.createdBy)===String(currentProfile?.id)&&canPerformPageAction('edit','notes')));
}
function canDeleteNote(note){
  return !!note&&(loggedInUser()?.owner===true||(String(note.createdBy)===String(currentProfile?.id)&&canPerformPageAction('delete','notes')));
}
function isStandaloneNote(note){ return !!note&&!note.activityType&&!note.representativeId; }
function sortNotes(){ notes.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))); }
async function loadNotes({append=false,reset=false}={}){
  if(notesLoading||!sb||!currentProfile) return;
  if(reset){ notes=[]; notesLoaded=false; notesHasMore=false; notePageCursor=null; }
  notesLoading=true;
  noteLoadError='';
  if(currentTab==='notes') render();
  try{
    const standaloneNotes=notes.filter(isStandaloneNote);
    const cursor=append?notePageCursor:null;
    const {data,error}=await sb.rpc('get_notes_page',{
      p_search:String(noteSearchQuery||'').trim()||null,
      p_cursor_updated_at:cursor?.updatedAt||null,
      p_cursor_id:cursor?.id||null,
      p_limit:NOTE_PAGE_SIZE
    }).select(NOTE_ROW_SELECT);
    if(error) throw error;
    const fetched=(data||[]).map(mapNoteRow).filter(isStandaloneNote);
    const rows=fetched.slice(0,NOTE_PAGE_SIZE);
    if(append){
      const merged=new Map(standaloneNotes.map(note=>[note.id,note]));
      rows.forEach(note=>merged.set(note.id,note));
      notes=[...merged.values()];
    }else notes=rows;
    sortNotes();
    notesLoaded=true;
    notesHasMore=fetched.length>NOTE_PAGE_SIZE;
    const last=rows.at(-1);
    notePageCursor=last?{updatedAt:last.updatedAt,id:last.id}:null;
    if(editingNoteId&&editingNoteId!=='new'){
      const selected=notes.find(note=>note.id===editingNoteId);
      if(selected&&!noteDraftDirty) noteDraft=noteDraftFromRow(selected);
    }
  }catch(error){
    noteLoadError=error?.message||'โหลดโน้ตไม่สำเร็จ';
  }finally{
    notesLoading=false;
    if(currentTab==='notes') render();
  }
}
function selectNote(note){
  if(!note) return;
  if(noteDraftDirty&&!confirm('มีโน้ตที่ยังไม่ได้บันทึก ต้องการเปลี่ยนไปเปิดโน้ตอื่นหรือไม่?')) return;
  editingNoteId=note.id;
  noteDraft=noteDraftFromRow(note);
  noteDraftDirty=false;
  render();
}
function startNewNote(){
  if(!canPerformPageAction('create','notes')){ showToast('บัญชีนี้ไม่มีสิทธิ์สร้างโน้ต','danger'); return; }
  if(noteDraftDirty&&!confirm('มีโน้ตที่ยังไม่ได้บันทึก ต้องการสร้างโน้ตใหม่หรือไม่?')) return;
  editingNoteId='new';
  noteDraft={title:'',contentHtml:'',hiddenFromLevel2:false,updatedAt:''};
  noteDraftDirty=false;
  render();
  setTimeout(()=>document.getElementById('noteTitle')?.focus(),0);
}
function renderNotes(){
  if(!notesLoaded&&!notesLoading&&!noteLoadError) setTimeout(()=>loadNotes(),0);
  const standaloneNotes=notes.filter(isStandaloneNote);
  if(editingNoteId&&editingNoteId!=='new'&&!standaloneNotes.some(note=>note.id===editingNoteId)){
    editingNoteId=null; noteDraft=null; noteDraftDirty=false;
  }
  if(editingNoteId===null&&standaloneNotes.length){
    editingNoteId=standaloneNotes[0].id;
    noteDraft=noteDraftFromRow(standaloneNotes[0]);
  }
  const selected=editingNoteId==='new'?null:standaloneNotes.find(note=>note.id===editingNoteId)||null;
  const draft=noteDraft||noteDraftFromRow(selected);
  const canCreate=canPerformPageAction('create','notes');
  const canEdit=editingNoteId==='new'?canCreate:canEditNote(selected);
  const canDelete=canDeleteNote(selected);
  const list=standaloneNotes.map(note=>{
    const preview=notePlainText(note.contentHtml)||'ยังไม่มีข้อความ';
    const activityRepresentative=representativeForActivityId(note.representativeId),activityProduct=productForActivityId(note.productId);
    return `<button type="button" class="note-list-item ${String(note.id)===String(editingNoteId)?'active':''}" data-note-id="${escapeHtml(note.id)}">
      <span class="note-list-title">${escapeHtml(note.title)}</span>${note.activityType?`<span class="note-activity-context">${escapeHtml(representativeActivityTypeLabel(note.activityType))}${activityRepresentative?` · ${escapeHtml(activityRepresentative.name)}`:''}${activityProduct?` · ${escapeHtml(activityProduct.name)}`:''}</span>`:''}
      <span class="note-list-preview">${escapeHtml(preview.slice(0,110))}</span>
      <span class="note-list-meta"><time>${escapeHtml(noteUpdatedText(note.updatedAt))}</time>${note.hiddenFromLevel2?'<b class="note-private-badge">ซ่อนจาก LEVEL 2</b>':''}</span>
    </button>`;
  }).join('');
  const editor=draft?`<form class="note-editor-panel" id="noteEditorForm">
    <div class="note-editor-heading">
      <label for="noteTitle">ชื่อโน้ต</label>
      <input id="noteTitle" maxlength="160" autocomplete="off" value="${escapeHtml(draft.title)}" ${canEdit?'':'readonly'} placeholder="ตั้งชื่อโน้ต">
    </div>
    <div class="note-toolbar" role="toolbar" aria-label="จัดรูปแบบข้อความ">
      <button type="button" data-note-command="bold" title="ตัวหนา" aria-label="ตัวหนา" ${canEdit?'':'disabled'}><b>B</b></button>
      <button type="button" data-note-command="underline" title="ขีดเส้นใต้" aria-label="ขีดเส้นใต้" ${canEdit?'':'disabled'}><u>U</u></button>
      <button type="button" data-note-command="strikeThrough" title="ขีดฆ่า" aria-label="ขีดฆ่า" ${canEdit?'':'disabled'}><s>S</s></button>
      <span class="note-toolbar-divider"></span>
      <span class="note-color-label">สีข้อความ</span>
      <span class="note-color-list">${NOTE_COLORS.map(([color,label])=>`<button type="button" class="note-color-swatch" data-note-color="${color}" style="--note-color:${color}" title="${escapeHtml(label)}" aria-label="สี${escapeHtml(label)}" ${canEdit?'':'disabled'}></button>`).join('')}</span>
    </div>
    <div id="noteContentEditor" class="note-content-editor ${canEdit?'':'readonly'}" contenteditable="${canEdit?'true':'false'}" role="textbox" aria-multiline="true" data-placeholder="เขียนข้อความที่นี่…">${sanitizeNoteHtml(draft.contentHtml)}</div>
    ${loggedInUser()?.owner===true?`<label class="note-visibility-option"><input id="noteHiddenFromLevel2" type="checkbox" ${draft.hiddenFromLevel2?'checked':''} ${canEdit?'':'disabled'}><span><b>ซ่อนโน้ตนี้จาก LEVEL 2</b><small>ผู้ใช้งาน LEVEL 2 จะไม่สามารถเห็นโน้ตนี้ได้</small></span></label>`:''}
    <div class="note-editor-footer">
      <span>${selected?`แก้ไขล่าสุด ${escapeHtml(noteUpdatedText(selected.updatedAt))}`:'โน้ตใหม่'}</span>
      <div>${canDelete?'<button class="btn danger" id="deleteNoteBtn" type="button">ลบโน้ต</button>':''}${canEdit?'<button class="btn primary" id="saveNoteBtn" type="submit">บันทึกโน้ต</button>':''}</div>
    </div>
  </form>`:`<div class="note-empty-editor"><div class="note-empty-icon">NOTE</div><h2>เลือกโน้ตที่ต้องการเปิด</h2><p>หรือสร้างโน้ตใหม่เพื่อจดข้อความที่ต้องการ</p>${canCreate?'<button class="btn primary" id="emptyAddNoteBtn" type="button">+ เพิ่มโน้ต</button>':''}</div>`;
  return `<div class="notes-page">
    <div class="notes-page-head"><div><h1>NOTE <span class="notes-page-subtitle">• พื้นที่จดบันทึกสำหรับร้าน</span></h1></div>${canCreate?'<button class="btn primary" id="addNoteBtn" type="button">+ เพิ่มโน้ต</button>':''}</div>
    ${noteLoadError?`<div class="notice danger note-load-error">${escapeHtml(noteLoadError)} <button class="btn ghost" id="retryNotesBtn" type="button">ลองใหม่</button></div>`:''}
    <div class="notes-layout">
      <aside class="note-list-panel" aria-label="รายการโน้ต">
        <div class="note-list-search"><input id="noteServerSearch" value="${escapeHtml(noteSearchQuery)}" placeholder="ค้นหาชื่อหรือข้อความใน NOTE"><button class="btn ghost" id="searchNotesBtn" type="button">ค้นหา</button></div>
        ${!notesLoaded&&notesLoading?'<div class="note-list-status">กำลังโหลดโน้ต…</div>':list||'<div class="note-list-status">ยังไม่มีโน้ต</div>'}
        ${notesHasMore?`<button class="btn ghost note-load-more" id="loadMoreNotesBtn" type="button" ${notesLoading?'disabled':''}>${notesLoading?'กำลังโหลด…':'โหลดโน้ตเพิ่มเติม'}</button>`:''}
      </aside>
      ${editor}
    </div>
  </div>`;
}
function updateNoteDraftFromEditor(){
  if(!noteDraft) return;
  noteDraft={
    ...noteDraft,
    title:document.getElementById('noteTitle')?.value||'',
    contentHtml:sanitizeNoteHtml(document.getElementById('noteContentEditor')?.innerHTML||''),
    hiddenFromLevel2:loggedInUser()?.owner===true&&document.getElementById('noteHiddenFromLevel2')?.checked===true
  };
  noteDraftDirty=true;
}
async function saveNote(event){
  event?.preventDefault();
  if(!noteDraft) return;
  updateNoteDraftFromEditor();
  const title=String(noteDraft.title||'').trim();
  const contentHtml=sanitizeNoteHtml(noteDraft.contentHtml||'');
  if(!title){ showToast('กรุณาใส่ชื่อโน้ต','danger'); document.getElementById('noteTitle')?.focus(); return; }
  const button=document.getElementById('saveNoteBtn');
  if(button){ button.disabled=true; button.textContent='กำลังบันทึก…'; }
  const payload={title,content_html:contentHtml,hidden_from_level2:loggedInUser()?.owner===true&&noteDraft.hiddenFromLevel2===true};
  try{
    let result;
    if(editingNoteId==='new') result=await sb.from('notes').insert(payload).select(NOTE_ROW_SELECT).single();
    else result=await sb.from('notes').update(payload).eq('id',editingNoteId).eq('updated_at',noteDraft.updatedAt).select(NOTE_ROW_SELECT).maybeSingle();
    if(result.error) throw result.error;
    if(!result.data) throw new Error('โน้ตนี้ถูกแก้ไขหรือลบจากอีกเครื่อง กรุณาโหลดหน้า NOTE ใหม่');
    const saved=mapNoteRow(result.data);
    const index=notes.findIndex(note=>note.id===saved.id);
    if(index>=0) notes[index]=saved; else notes.push(saved);
    sortNotes();
    editingNoteId=saved.id;
    noteDraft=noteDraftFromRow(saved);
    noteDraftDirty=false;
    notesLoaded=true;
    showToast('บันทึกโน้ตแล้ว');
    render();
  }catch(error){
    showToast(error?.message||'บันทึกโน้ตไม่สำเร็จ','danger');
    if(button){ button.disabled=false; button.textContent='บันทึกโน้ต'; }
  }
}
async function deleteSelectedNote(){
  const note=notes.find(item=>item.id===editingNoteId);
  if(!note||!canDeleteNote(note)) return;
  if(!confirm(`ลบโน้ต “${note.title}” หรือไม่?`)) return;
  const button=document.getElementById('deleteNoteBtn');
  if(button){ button.disabled=true; button.textContent='กำลังลบ…'; }
  try{
    const {data,error}=await sb.from('notes').delete().eq('id',note.id).eq('updated_at',note.updatedAt).select('id').maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('โน้ตนี้ถูกแก้ไขหรือลบจากอีกเครื่อง กรุณาโหลดหน้า NOTE ใหม่');
    notes=notes.filter(item=>item.id!==note.id);
    editingNoteId=null; noteDraft=null; noteDraftDirty=false;
    showToast('ลบโน้ตแล้ว');
    render();
  }catch(error){
    showToast(error?.message||'ลบโน้ตไม่สำเร็จ','danger');
    if(button){ button.disabled=false; button.textContent='ลบโน้ต'; }
  }
}
function attachNoteEvents(){
  if(currentTab!=='notes') return;
  document.getElementById('addNoteBtn')?.addEventListener('click',startNewNote);
  document.getElementById('emptyAddNoteBtn')?.addEventListener('click',startNewNote);
  document.getElementById('retryNotesBtn')?.addEventListener('click',()=>{ noteLoadError=''; notesLoaded=false; loadNotes(); });
  document.getElementById('loadMoreNotesBtn')?.addEventListener('click',()=>loadNotes({append:true}));
  const noteSearch=document.getElementById('noteServerSearch');
  const searchNotes=()=>{
    if(noteDraftDirty&&!confirm('มีโน้ตที่ยังไม่ได้บันทึก ต้องการค้นหาและละทิ้งการแก้ไขหรือไม่?')) return;
    noteSearchQuery=noteSearch?.value||'';
    editingNoteId=null; noteDraft=null; noteDraftDirty=false;
    loadNotes({reset:true});
  };
  document.getElementById('searchNotesBtn')?.addEventListener('click',searchNotes);
  noteSearch?.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); searchNotes(); } });
  document.querySelectorAll('[data-note-id]').forEach(button=>button.addEventListener('click',()=>selectNote(notes.find(note=>note.id===button.dataset.noteId))));
  document.getElementById('noteEditorForm')?.addEventListener('submit',saveNote);
  document.getElementById('deleteNoteBtn')?.addEventListener('click',deleteSelectedNote);
  const markDirty=()=>{ noteDraftDirty=true; };
  document.getElementById('noteTitle')?.addEventListener('input',markDirty);
  document.getElementById('noteHiddenFromLevel2')?.addEventListener('change',markDirty);
  const editor=document.getElementById('noteContentEditor');
  editor?.addEventListener('input',markDirty);
  editor?.addEventListener('paste',event=>{
    event.preventDefault();
    const html=event.clipboardData?.getData('text/html');
    const plain=event.clipboardData?.getData('text/plain')||'';
    const safe=html?sanitizeNoteHtml(html):escapeHtml(plain).replace(/\r?\n/g,'<br>');
    document.execCommand('insertHTML',false,safe);
    noteDraftDirty=true;
  });
  document.querySelectorAll('[data-note-command]').forEach(button=>{
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>{ if(button.disabled||!editor) return; document.execCommand(button.dataset.noteCommand,false,null); editor.focus(); noteDraftDirty=true; });
  });
  document.querySelectorAll('[data-note-color]').forEach(button=>{
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>{ if(button.disabled||!editor) return; document.execCommand('foreColor',false,button.dataset.noteColor); editor.focus(); noteDraftDirty=true; });
  });
}

function representativeHistoryKey(context=representativeHistoryContext){
  if(!context) return '';
  return `${context.central?'central':'detail'}:rep:${Number(context.representativeId)||0}:product:${Number(context.productId)||0}:filters:${JSON.stringify(representativeHistoryFilter)}`;
}
