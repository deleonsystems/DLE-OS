(function(document) {
  'use strict';
  function mount(root,options={}) {
  const byId=id=>root.getElementById?root.getElementById(id):root.querySelector('#'+id);
  const rows=Array.from(root.querySelectorAll('tbody tr[data-quantity]'));
  const selected=new Set();let anchor=null;
  function sum(indices) {
    let value=0n,places=0,missing=0;
    for(const index of indices){
      const text=rows[index].dataset.quantity.trim();
      if(!/^\d+(?:\.\d+)?$/.test(text)){missing++;continue;}
      const [whole,fraction='']=text.split('.');
      if(fraction.length>places){value*=10n**BigInt(fraction.length-places);places=fraction.length;}
      value+=BigInt(whole+fraction)*10n**BigInt(places-fraction.length);
    }
    const digits=value.toString().padStart(places+1,'0');
    const result=places?(digits.slice(0,-places)+'.'+digits.slice(-places)).replace(/\.?0+$/,''):digits;
    return result+(missing?' ('+missing+' quantities unavailable)':'');
  }
  function update(){
    rows.forEach((row,index)=>row.setAttribute('aria-selected',String(selected.has(index))));
    byId('bom-selection').textContent='Selected: '+selected.size+' lines · '+sum(selected)+' components';
    byId('bom-clear').disabled=selected.size===0;
  }
  function clear(){selected.clear();anchor=null;update();}
  function select(index,event){
    const additive=event.ctrlKey||event.metaKey||options.touchToggle===true;
    if(event.shiftKey&&anchor!==null){
      if(!additive)selected.clear();
      for(let i=Math.min(anchor,index);i<=Math.max(anchor,index);i++)selected.add(i);
    }else{
      if(!additive)selected.clear();
      if(additive&&selected.has(index))selected.delete(index);else selected.add(index);
      anchor=index;
    }
    update();
  }
  rows.forEach((row,index)=>{
    row.addEventListener('click',event=>select(index,event));
    row.addEventListener('mousedown',event=>{if(event.shiftKey)event.preventDefault();});
    row.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();select(index,event);}
    });
  });
  byId('bom-clear').addEventListener('click',clear);
  root.addEventListener('keydown',event=>{if(event.key==='Escape')clear();});
  byId('bom-total').textContent=sum(rows.keys());
  update();
  }
  if(typeof window!=='undefined')window.DleBomReference=Object.freeze({mount});
  if(document.getElementById('bom-total'))mount(document);
})(document);
