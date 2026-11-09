function passwordEyeButton(id,subject='รหัสผ่าน'){
  return `<button class="password-eye-btn" type="button" data-toggle-password="${id}" aria-controls="${id}" data-password-label="${subject}" aria-label="แสดง${subject}" title="แสดง${subject}"></button>`;
}

function setPasswordVisibility(input,button,reveal){
  input.type=reveal?'text':'password';
  button.classList.toggle('showing-password',reveal);
  const action=(reveal?'ซ่อน':'แสดง')+(button.dataset.passwordLabel||'รหัสผ่าน');
  button.setAttribute('aria-label',action);
  button.title=action;
}

function bindPasswordControls(){
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-toggle-password]');
    if(!button) return;
    const input=button.parentElement.querySelector('input');
    if(input?.id!==button.dataset.togglePassword) return;
    const reveal=input.type==='password';
    const {selectionStart,selectionEnd,selectionDirection}=input;
    setPasswordVisibility(input,button,reveal);
    input.focus({preventScroll:true});
    input.setSelectionRange(selectionStart,selectionEnd,selectionDirection);
  });
  // Login forms are reused between sessions.
  document.addEventListener('submit',event=>{
    for(const button of event.target.querySelectorAll('.password-eye-btn.showing-password')){
      const input=button.parentElement.querySelector('input');
      if(input?.id===button.dataset.togglePassword) setPasswordVisibility(input,button,false);
    }
  },true);
  const badge=document.createElement('span');
  badge.className='password-key-state';
  badge.setAttribute('role','status');
  const symbols=document.createElement('span');
  symbols.setAttribute('aria-hidden','true');
  symbols.textContent='⇪';
  const description=document.createElement('span');
  description.className='password-key-description';
  badge.append(symbols,description);

  let caps=false,shift=false;
  function display(){
    const field=document.activeElement;
    if(!(caps||shift)||!field?.matches('.password-input-wrap > input')){
      badge.remove();
      return;
    }
    const pressed=[caps?'Caps Lock':'',shift?'Shift':''].filter(Boolean).join(' + ');
    if(badge.parentNode!==field.parentNode) field.parentNode.append(badge);
    if(description.textContent!==pressed) description.textContent=pressed;
  }
  function readKeys(event){
    if(typeof event.getModifierState!=='function') return;
    caps=event.getModifierState('CapsLock');
    shift=event.shiftKey;
    display();
  }
  // Capture modifier changes even when a modal handles the keystroke itself.
  for(const type of ['keydown','keyup','mousedown']) document.addEventListener(type,readKeys,true);
  document.addEventListener('focusin',display);
  document.addEventListener('focusout',()=>badge.remove());
  window.addEventListener('blur',()=>{caps=false;shift=false;badge.remove();});
}
