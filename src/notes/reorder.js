// Mouse movement or a long press starts a move. A quick tap still opens the topic.
function bindTopicReorder(list,selector,onMove){
  if(!list||list.dataset.topicReorderBound) return;
  list.dataset.topicReorderBound='true';
  for(const card of list.querySelectorAll(selector)){
    card.classList.add('topic-movable');
    const grip=document.createElement('span');
    grip.className='topic-grip';
    grip.title='กดค้างแล้วลากเพื่อจัดลำดับ';
    card.append(grip);
  }
  let drag=null,suppressClick=false;
  function lift(){
    if(!drag||drag.active||!drag.card.isConnected)return;
    drag.active=true;
    drag.card.classList.add('topic-lifting');
  }
  function locate(event){
    const {card,y}=drag;
    card.style.setProperty('--topic-offset',(event.clientY-y)+'px');
    drag.target?.classList.remove('topic-before','topic-after');
    const hit=document.elementFromPoint(event.clientX,event.clientY)?.closest(selector);
    drag.target=hit&&hit!==card&&list.contains(hit)?hit:null;
    if(drag.target){
      const below=card.compareDocumentPosition(hit)&Node.DOCUMENT_POSITION_FOLLOWING;
      hit.classList.add(below?'topic-after':'topic-before');
    }
  }
  function finish(event,save){
    if(!drag||drag.pointer!==event.pointerId) return;
    if(save&&drag.active)locate(event);
    const {card,capture,target,active,timer,pointer}=drag;
    drag=null;
    clearTimeout(timer);
    card.classList.remove('topic-lifting');
    card.style.removeProperty('--topic-offset');
    target?.classList.remove('topic-before','topic-after');
    if(capture.hasPointerCapture(pointer))capture.releasePointerCapture(pointer);
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
    const capture=event.target;
    capture.setPointerCapture(event.pointerId);
    drag={card,capture,pointer:event.pointerId,x:event.clientX,y:event.clientY,active:false,target:null};
    drag.timer=setTimeout(lift,320);
  });
  list.addEventListener('pointermove',event=>{
    if(!drag||drag.pointer!==event.pointerId)return;
    if(!drag.active){
      if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5)return;
      if(event.pointerType==='touch'&&!drag.capture.closest('.topic-grip')){finish(event,false);return;}
      lift();
    }
    locate(event);
  });
  list.addEventListener('touchmove',event=>{if(drag?.active&&event.cancelable)event.preventDefault();},{passive:false});
  list.addEventListener('pointerup',event=>finish(event,true));
  list.addEventListener('pointercancel',event=>finish(event,false));
  list.addEventListener('lostpointercapture',event=>{if(event.target===drag?.capture)finish(event,false);});
  list.addEventListener('contextmenu',event=>{if(drag)event.preventDefault();});
  list.addEventListener('click',event=>{
    if(suppressClick&&event.detail){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}
  },true);
}
