const KNOWLEDGE_DEFAULT_ARTICLES=[
  {id:'receipt-printer',title:'ตั้งค่าเครื่องพิมพ์ใบเสร็จอย่างย่อ',content:'การตั้งค่าเครื่องพิมพ์ใบเสร็จอย่างย่อ สำหรับเครื่องพิมพ์ใบเสร็จ ยี่ห้อ VOZY G80\nโหลด SAPURI-POS-Setup-Windows-v2.1.rar มาติดตั้ง ในนั้นจะมีวิธีบอกการติดตั้งอยู่\nจำเป็นจะต้องทำเพื่อทำให้เครื่องพิมพ์ใบเสร็จอย่างย่อ สามารถใช้งานแบบ ไร้สายได้'},
  {id:'pos-tips',title:'POS - เทคนิคต่างๆ',content:'การกดปุ่ม CAPLOCK จะช่วยให้เปลี่ยนหน่วยได้อย่างรวดเร็ว\nหากตัวหนังสือเป็นสีฟ้าจะเป็นการบ่งบอกว่าสินค้านั้นมีโปรโมชั่น\nหลังจากกดปุ่มพัก จะเป็นพักการจ่ายเงินของคนนั้น\nเราสามารถทำต่อได้โดยการกดปุ่ม ประวัติการขาย แล้วเลือกทำต่อของออเดอร์คนๆนั้น\nรายการกรอกเอง เอาไว้ใช้เมื่อทำการ จ่ายยาชุด หรือว่า สินค้าอื่นๆ ที่ไม่ได้อยู่ในระบบ'}
];
let knowledgeState=null;
function getKnowledgeState(){
  if(!knowledgeState||!isWorkspaceReadCurrent(knowledgeState.context)){
    knowledgeState={context:captureWorkspaceRead(),articles:[],loaded:false,loading:false,error:'',selectedId:'',search:'',snapshot:null};
  }
  return knowledgeState;
}
function knowledgeArticlesFromValue(value){
  if(value==null) return KNOWLEDGE_DEFAULT_ARTICLES.map(article=>({...article}));
  if(!Array.isArray(value.articles)) throw new Error('รูปแบบข้อมูลสิ่งควรรู้ไม่ถูกต้อง');
  return value.articles.map(article=>({id:String(article.id),title:String(article.title||''),content:String(article.content||'')}));
}
async function loadKnowledgeArticles(){
  const state=getKnowledgeState();if(state.loading||!currentProfile) return;
  state.loading=true;state.error='';
  if(currentTab==='knowledge') render();
  try{
    const {data,error}=await sb.from('settings').select('value').eq('key','knowledge_articles').maybeSingle();
    if(!isWorkspaceReadCurrent(state.context))return;
    if(error)throw error;
    state.articles=knowledgeArticlesFromValue(data?.value);
    state.snapshot=JSON.stringify(stableJsonValue(data?.value??null));state.loaded=true;
    if(!state.articles.some(article=>article.id===state.selectedId))state.selectedId=state.articles[0]?.id||'';
  }catch(error){if(isWorkspaceReadCurrent(state.context))state.error=error?.message||'โหลดสิ่งควรรู้ไม่สำเร็จ';}
  finally{state.loading=false;if(isWorkspaceReadCurrent(state.context)&&currentTab==='knowledge')render();}
}
function renderKnowledge(){
  const state=getKnowledgeState(),owner=loggedInUser()?.owner===true;
  if(!state.loaded&&!state.loading&&!state.error)setTimeout(loadKnowledgeArticles,0);
  const selected=state.articles.find(article=>article.id===state.selectedId);
  const cards=state.articles.map((article,index)=>`<button type="button" class="note-list-item ${article.id===state.selectedId?'active':''}" data-knowledge-index="${index}"><span class="note-list-title">${escapeHtml(article.title)}</span></button>`).join('');
  return `<div class="notes-page knowledge-page"><div class="pagehead"><h1>สิ่งควรรู้</h1><div class="knowledge-actions"><button class="btn ghost" id="reloadKnowledge" ${state.loading?'disabled':''}>โหลดข้อมูลล่าสุด</button>${owner?`<button class="btn primary" id="addKnowledge" ${!state.loaded||state.loading||state.error?'disabled':''}>+ เพิ่มหัวข้อ</button>`:''}</div></div>
    ${state.error?`<div class="knowledge-error" role="alert">${escapeHtml(state.error)} · กดโหลดข้อมูลล่าสุดเพื่อลองอีกครั้ง</div>`:''}
    ${state.loading?'<p role="status">กำลังโหลดสิ่งควรรู้...</p>':''}
    <div class="knowledge-layout"><aside class="knowledge-list"><input id="knowledgeSearch" placeholder="ค้นหาหัวข้อหรือข้อความ" aria-label="ค้นหาสิ่งควรรู้" value="${escapeHtml(state.search)}"><div class="knowledge-list-items">${cards}</div><p id="knowledgeEmptySearch" hidden>ไม่พบหัวข้อ</p></aside>
    <article class="knowledge-detail">${selected?`<header><h2>${escapeHtml(selected.title)}</h2>${owner?`<div class="knowledge-actions"><button class="btn danger" id="deleteKnowledge" ${state.loading||state.error?'disabled':''}>ลบหัวข้อ</button><button class="btn ghost" id="editKnowledge" ${state.loading||state.error?'disabled':''}>แก้ไข</button></div>`:''}</header><div class="knowledge-content">${escapeHtml(selected.content)}</div>`:`<div class="knowledge-empty">${state.loaded?'ยังไม่มีหัวข้อ':'เลือกหัวข้อที่ต้องการอ่าน'}</div>`}</article></div></div>`;
}
async function persistKnowledgeArticles(articles,state){
  if(loggedInUser()?.owner!==true||!isWorkspaceReadCurrent(state.context))throw new Error('ไม่มีสิทธิ์แก้ไขสิ่งควรรู้');
  // Re-read before writing so a stale page does not overwrite changes from another device.
  const latest=await sb.from('settings').select('value').eq('key','knowledge_articles').maybeSingle();
  if(latest.error)throw latest.error;
  if(!isWorkspaceReadCurrent(state.context))throw new Error('บัญชีผู้ใช้เปลี่ยนแล้ว กรุณาเปิดหน้านี้ใหม่');
  if(JSON.stringify(stableJsonValue(latest.data?.value??null))!==state.snapshot)throw new Error('ข้อมูลถูกแก้ไขจากเครื่องอื่นแล้ว กรุณาคัดลอกข้อความที่แก้ไขไว้ แล้วโหลดข้อมูลล่าสุด');
  const value={articles};
  if(new Blob([JSON.stringify(value)]).size>900000)throw new Error('ข้อมูลสิ่งควรรู้มีขนาดใหญ่เกินไป กรุณาลดข้อความก่อนบันทึก');
  const {error}=await sb.rpc('owner_set_setting',{p_key:'knowledge_articles',p_value:value});
  if(error)throw error;
  if(!isWorkspaceReadCurrent(state.context))return false;
  state.articles=articles;state.snapshot=JSON.stringify(stableJsonValue(value));return true;
}
function openKnowledgeEditor(article=null){
  const state=getKnowledgeState();
  if(loggedInUser()?.owner!==true||!state.loaded||state.loading||state.error)return;
  const overlay=document.createElement('div');overlay.className='modal-overlay knowledge-editor-overlay';
  overlay.innerHTML=`<div class="modal knowledge-editor-modal" role="dialog" aria-modal="true" aria-labelledby="knowledgeEditorTitle"><div class="modal-head"><h3 id="knowledgeEditorTitle">${article?'แก้ไขหัวข้อ':'เพิ่มหัวข้อ'}สิ่งควรรู้</h3><button type="button" class="modal-close" aria-label="ปิด">×</button></div><form id="knowledgeEditorForm"><label for="knowledgeTitle">หัวข้อ</label><input id="knowledgeTitle" maxlength="160" required value="${escapeHtml(article?.title||'')}"><label for="knowledgeContent">เนื้อหา</label><textarea id="knowledgeContent" rows="14" maxlength="40000">${escapeHtml(article?.content||'')}</textarea><p id="knowledgeFeedback" role="alert"></p><div class="knowledge-actions"><button class="btn ghost" type="button" id="cancelKnowledge">ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div></form></div>`;
  document.body.appendChild(overlay);
  const title=overlay.querySelector('#knowledgeTitle'),content=overlay.querySelector('#knowledgeContent');
  let saving=false;
  const dirty=()=>title.value!==(article?.title||'')||content.value!==(article?.content||'');
  overlay.knowledgeHasUnsavedChanges=()=>saving||dirty();
  const close=()=>{if(!saving&&(!dirty()||confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการปิดหรือไม่?')))overlay.remove();};
  overlay.querySelector('.modal-close').onclick=close;overlay.querySelector('#cancelKnowledge').onclick=close;
  overlay.querySelector('form').onsubmit=async event=>{
    event.preventDefault();if(saving)return;
    if(!title.value.trim()){title.focus();return;}
    saving=true;overlay.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
    const next={id:article?.id||crypto.randomUUID(),title:title.value.trim(),content:content.value};
    const articles=article?state.articles.map(item=>item.id===article.id?next:item):[...state.articles,next];
    try{
      if(await persistKnowledgeArticles(articles,state)){
        state.selectedId=next.id;state.search='';showToast('บันทึกสิ่งควรรู้แล้ว');
      }
      overlay.remove();if(currentTab==='knowledge')render();
    }catch(error){overlay.querySelector('#knowledgeFeedback').textContent=error?.message||'บันทึกไม่สำเร็จ';}
    finally{saving=false;overlay.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);}
  };
  title.focus();
}
function attachKnowledgeEvents(){
  if(currentTab!=='knowledge')return;
  const state=getKnowledgeState();
  document.getElementById('reloadKnowledge')?.addEventListener('click',loadKnowledgeArticles);
  document.getElementById('addKnowledge')?.addEventListener('click',()=>openKnowledgeEditor());
  document.getElementById('editKnowledge')?.addEventListener('click',()=>openKnowledgeEditor(state.articles.find(article=>article.id===state.selectedId)));
  document.querySelectorAll('[data-knowledge-index]').forEach(button=>button.onclick=()=>{state.selectedId=state.articles[Number(button.dataset.knowledgeIndex)].id;render();});
  const search=document.getElementById('knowledgeSearch');
  const filter=()=>{
    state.search=search.value;const query=state.search.toLocaleLowerCase().trim();let visible=0;
    document.querySelectorAll('[data-knowledge-index]').forEach(button=>{
      const article=state.articles[Number(button.dataset.knowledgeIndex)];
      button.hidden=!`${article.title}\n${article.content}`.toLocaleLowerCase().includes(query);if(!button.hidden)visible++;
    });
    document.getElementById('knowledgeEmptySearch').hidden=visible>0;
  };
  if(search){search.oninput=filter;filter();}
  const remove=document.getElementById('deleteKnowledge');
  if(remove)remove.onclick=async()=>{
    const article=state.articles.find(item=>item.id===state.selectedId);
    if(loggedInUser()?.owner!==true||!article||!confirm(`ยืนยันลบหัวข้อ “${article.title}” หรือไม่?`))return;
    remove.disabled=true;
    try{
      if(await persistKnowledgeArticles(state.articles.filter(item=>item.id!==article.id),state)){state.selectedId=state.articles[0]?.id||'';showToast('ลบหัวข้อแล้ว');}
      if(currentTab==='knowledge')render();
    }catch(error){showToast(error?.message||'ลบไม่สำเร็จ','danger-top');remove.disabled=false;}
  };
}
window.addEventListener('beforeunload',event=>{
  if(document.querySelector('.knowledge-editor-overlay')?.knowledgeHasUnsavedChanges?.()){event.preventDefault();event.returnValue='';}
});
