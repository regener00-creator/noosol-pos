// Presentation only: never render(), write business settings, or touch a draft.
function applySapuriTheme(value, persist=false){
  const theme=value==='classic'?'classic':'mac';
  document.documentElement.dataset.sapuriTheme=theme;
  document.querySelectorAll('[data-sapuri-theme-choice]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.sapuriThemeChoice===theme));
  });
  if(persist){
    try{localStorage.setItem('sapuri_ui_theme_v1',theme);}
    catch(_){toast('เปลี่ยนธีมแล้ว แต่เครื่องนี้บันทึกธีมไว้ไม่ได้');}
  }
}
document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-sapuri-theme-choice]');
  if(button){
    event.preventDefault();
    event.stopPropagation(); // Do not trigger the legacy document-menu re-render.
    applySapuriTheme(button.dataset.sapuriThemeChoice,true);
  }
},true);
window.addEventListener('storage',event=>{
  if(event.key==='sapuri_ui_theme_v1') applySapuriTheme(event.newValue);
});
applySapuriTheme(document.documentElement.dataset.sapuriTheme);
