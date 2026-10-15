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
    byId('bom-selection').textContent='Selected: '+selected.size+' lines · '+sum(selected)+' components'+((root.body||root.ownerDocument?.body)?.dataset.sharedBom==='quote'?' / assy':'');
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
  async function report(url,compact=false){
    if(!window.DleLaborBomSlides){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/SRC/workspaces/rfqs/labor-bom-slides.js';script.onload=resolve;script.onerror=()=>reject(Error('BOM renderer unavailable.'));document.head.append(script);});}
    return window.DleLaborBomSlides.quoteDocument(url,compact);
  }
  window.DleBomReference=Object.freeze({mount,report});
  if(document.getElementById('bom-total')){
    if(document.body.dataset.sharedBom==='quote')mount(document);
    else if(/^\/api\/sim\/rfqs\/[^/]+\/bom-reference$/.test(location.pathname))report(location.pathname).then(html=>{
      const source=new DOMParser().parseFromString(html,'text/html');document.head.querySelectorAll('style').forEach(n=>n.remove());document.head.append(source.querySelector('style'));document.body.replaceChildren(...source.body.childNodes);document.body.dataset.sharedBom='quote';mount(document);
    }).catch(()=>{mount(document);const p=document.createElement('p');p.textContent='Shared BOM format unavailable. Original read-only reference shown; retry after refresh.';document.body.prepend(p);});
    else mount(document);
  }
})(document);
