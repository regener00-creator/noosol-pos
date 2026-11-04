// A short click opens the article. Holding a card or its touch grip starts a move.
function bindTopicReorder(list,selector,onMove){
  if(!list) return;
  for(const card of list.querySelectorAll(selector)){
    card.classList.add('topic-movable');
    const grip=document.createElement('span');
    grip.className='topic-grip';
    grip.title='กดค้างแล้วลากเพื่อจัดลำดับ';
    card.append(grip);
  }
  let drag=null,suppressClick=false;
  function finish(event,save){
    if(!drag||drag.pointer!==event.pointerId) return;
    const {card,target,active,timer,pointer}=drag;
    drag=null;
    clearTimeout(timer);
    card.classList.remove('topic-lifting');
    target?.classList.remove('topic-before','topic-after');
    if(list.hasPointerCapture(pointer))list.releasePointerCapture(pointer);
    if(active){
      suppressClick=true;
      if(save&&target)onMove(card,target);
    }
  }
  list.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0)return;
    suppressClick=false;
    const card=event.target.closest(selector);
    if(!card||drag)return;
    drag={card,pointer:event.pointerId,x:event.clientX,y:event.clientY,active:false,target:null};
    drag.timer=setTimeout(()=>{
      if(!card.isConnected)return;
      list.setPointerCapture(event.pointerId);
      card.classList.add('topic-lifting');
      drag.active=true;
    },320);
  });
  list.addEventListener('pointermove',event=>{
    if(!drag||drag.pointer!==event.pointerId)return;
    if(!drag.active){
      if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>8)finish(event,false);
      return;
    }
    drag.target?.classList.remove('topic-before','topic-after');
    const hit=document.elementFromPoint(event.clientX,event.clientY)?.closest(selector);
    drag.target=hit&&hit!==drag.card&&list.contains(hit)?hit:null;
    if(drag.target){
      const below=drag.card.compareDocumentPosition(hit)&Node.DOCUMENT_POSITION_FOLLOWING;
      hit.classList.add(below?'topic-after':'topic-before');
    }
  });
  list.addEventListener('pointerleave',event=>{if(drag&&!drag.active)finish(event,false);});
  list.addEventListener('pointerup',event=>finish(event,true));
  list.addEventListener('pointercancel',event=>finish(event,false));
  list.addEventListener('lostpointercapture',event=>finish(event,false));
  list.addEventListener('contextmenu',event=>{if(drag)event.preventDefault();});
  list.addEventListener('click',event=>{
    if(suppressClick&&event.detail){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}
  },true);
}
