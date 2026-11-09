function bindPasswordKeyState(){
  const selector='.password-key-field > input, .password-input-wrap > input';
  const badge=document.createElement('span');
  badge.className='password-key-state';
  badge.setAttribute('role','status');
  const symbols=document.createElement('span');
  symbols.setAttribute('aria-hidden','true');
  const description=document.createElement('span');
  description.className='password-key-description';
  badge.append(symbols,description);

  let known=false,caps=false,shift=false;
  function display(){
    const field=document.activeElement;
    if(!known||!field?.matches(selector)){
      badge.remove();
      return;
    }
    const pressed=[caps?'Caps Lock':'',shift?'Shift':''].filter(Boolean).join(' + ');
    const uppercase=caps!==shift;
    const label=(pressed?pressed+' · ':'')+(uppercase?'ตัวอักษรอังกฤษพิมพ์ใหญ่':'ตัวอักษรอังกฤษพิมพ์เล็ก');
    if(badge.parentNode!==field.parentNode) field.parentNode.append(badge);
    if(badge.title===label) return;
    symbols.textContent=[caps?'⇪ Caps':'',shift?'⇧ Shift':'',uppercase?'ABC':'abc'].filter(Boolean).join(' ');
    badge.classList.toggle('key-pressed',caps||shift);
    badge.classList.toggle('both-keys',caps&&shift);
    badge.title=label;
    description.textContent=label;
  }
  function readKeys(event){
    if(typeof event.getModifierState!=='function') return;
    caps=event.getModifierState('CapsLock');
    shift=event.shiftKey;
    known=true;
    display();
  }
  // Capture modifier changes even when a modal handles the keystroke itself.
  for(const type of ['keydown','keyup','mousedown']) document.addEventListener(type,readKeys,true);
  document.addEventListener('focusin',display);
  document.addEventListener('focusout',()=>badge.remove());
  window.addEventListener('blur',()=>{known=false;badge.remove();});
}
