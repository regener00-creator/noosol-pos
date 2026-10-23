// Enter is a form-navigation shortcut, not a synthetic Tab or form submission.
// Run after element/document handlers so scanners, searches and payment shortcuts
// that preventDefault() keep their existing behaviour, including lazy-loaded pages.
function enterNavigationControls(root){
  const controls=[...root.querySelectorAll('input,select,textarea,button,a[href],[tabindex],[contenteditable="true"]')]
    .filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&!el.closest('[inert]')&&
      el.getClientRects().length&&getComputedStyle(el).visibility==='visible');
  // Match native Tab order, including explicitly positive tabindex values.
  const ordered=controls.sort((a,b)=>(a.tabIndex||Infinity)-(b.tabIndex||Infinity));
  return ordered.filter(el=>{
    if(!el.matches('input[type="radio"]')||!el.name) return true;
    const group=ordered.filter(other=>other.matches('input[type="radio"]')&&other.name===el.name&&other.form===el.form);
    return el===(group.find(other=>other.checked)||group[0]);
  });
}

function handleEnterFieldNavigation(event){
  if(event.key!=='Enter'||event.defaultPrevented||event.isComposing||event.keyCode===229||
    event.ctrlKey||event.altKey||event.metaKey||event.shiftKey) return;
  const source=event.target;
  // Keep multiline editing, buttons, checkboxes and native pickers unchanged.
  if(!(source instanceof HTMLInputElement)||
    !['text','search','number','email','tel','url','password'].includes(source.type)||
    source.closest('[data-enter-navigation="off"],[contenteditable="true"]')) return;
  event.preventDefault();
  if(event.repeat) return;
  const modal=source.closest('.modal-overlay,[role="dialog"],dialog');
  const root=source.closest('form')||modal||source.closest('#main,.login-screen,.warehouse-choice-screen')||document.body;
  const controls=enterNavigationControls(root),index=controls.indexOf(source);
  const next=index<0?null:controls[index+1];
  if(!next) return; // Never submit implicitly or wrap into an unrelated page.
  const rootId=root.id,nextId=next.id;
  source.blur(); // Commit existing change/blur handlers before moving focus.
  if(document.activeElement!==document.body&&document.activeElement!==source) return;
  // Some change handlers render the form again. Resolve the replacement control
  // instead of focusing its detached predecessor; never escape a closed modal.
  const liveRoot=root.isConnected?root:rootId?document.getElementById(rootId):null;
  if(!liveRoot||(modal&&!modal.isConnected)) return;
  const liveControls=enterNavigationControls(liveRoot);
  const target=next.isConnected&&liveControls.includes(next)?next:
    nextId?liveControls.find(el=>el.id===nextId):liveControls[index+1];
  target?.focus();
}

window.addEventListener('keydown',handleEnterFieldNavigation);
