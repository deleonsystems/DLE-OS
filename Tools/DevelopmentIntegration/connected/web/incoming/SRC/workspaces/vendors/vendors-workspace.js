(function registerVendors(window, document) {
  'use strict';
  const pageSize = 20;
  let view, mount, search, results, count, previous, next, pageLabel, sourceLabel, timer;
  const state = {query:'',page:1,totalPages:0,request:0,controller:null};
  const element = (tag, text, className) => {
    const node=document.createElement(tag);
    if(text !== undefined)node.textContent=text;
    if(className)node.className=className;
    return node;
  };
  const authorized = () => document.body?.dataset?.simRuntime === 'true' &&
    window.DleOsRuntimeConfig?.rfqIntakeMode === 'SIM_PHASE1' &&
    window.DleOsSession?.user?.accountStatus === 'ACTIVE' && window.DleOsCapabilities?.isSuperAdmin === true &&
    window.DleOsCapabilities?.can?.('sync.operations') === true;
  function leave() {
    clearTimeout(timer);state.request++;state.controller?.abort();
    window.changeWorkArea?.();
  }
  function setBusy() {
    results.setAttribute('aria-busy','true');
    count.textContent='Searching vendors…';previous.disabled=next.disabled=true;
  }
  async function load() {
    clearTimeout(timer);
    if(!authorized())return render();
    const ticket=++state.request;
    state.controller?.abort();state.controller=new AbortController();
    setBusy();
    try {
      const params=new URLSearchParams({q:state.query,page:String(state.page),pageSize:String(pageSize)});
      const response=await window.DleIntegration.request('/api/quoting/v1/vendors?'+params,{credentials:'same-origin',cache:'no-store',signal:state.controller.signal});
      if(!response.ok)throw Error(response.status===403?'Vendors is unavailable for this session.':[404,501].includes(response.status)?'The vendor list is awaiting SIM activation.':'The vendor reference is unavailable. Please try again later.');
      const data=await response.json();
      if(ticket!==state.request||!view?.isConnected)return;
      if(!Array.isArray(data.items)||!Number.isInteger(data.totalItems)||!Number.isInteger(data.totalPages)||!Number.isInteger(data.page))throw Error('The vendor reference could not be read.');
      state.page=data.page;state.totalPages=data.totalPages;
      const date=String(data.snapshot?.asOfUtc||'');
      if(!/^\d{4}-\d{2}-\d{2}/.test(date))throw Error('The vendor reference date is unavailable.');
      sourceLabel.textContent='Preliminary reference · '+(window.DleDateFormat?.date(date.slice(0,10)) ?? new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date.slice(0,10)+'T00:00:00Z')));
      results.replaceChildren();
      if(!data.items.length)results.append(element('p','No vendors match your search.','vendors-empty'));
      else {
        const table=element('table'),head=element('thead'),heading=element('tr'),body=element('tbody');
        for(const name of ['Vendor','Vendor number']){const cell=element('th',name);cell.scope='col';heading.append(cell);}
        head.append(heading);
        for(const item of data.items){
          if(typeof item.vendorNumber!=='string'||typeof item.firmId!=='string'||typeof item.vendorMasterId!=='string')throw Error('The vendor reference could not be read.');
          const row=element('tr');row.dataset.vendorId=item.vendorMasterId;
          const name=String(item.vendorName||'').trim();
          const nameCell=element('td',name||'Name not provided',name?'':'vendors-unnamed');
          const numberCell=element('td',undefined,'vendors-number');
          numberCell.append(element('span',item.vendorNumber),element('small','Firm '+item.firmId));
          row.append(nameCell,numberCell);body.append(row);
        }
        table.append(head,body);results.append(table);
      }
      count.textContent=data.totalItems.toLocaleString('en-US')+(data.totalItems===1?' vendor':' vendors')+(state.query?' found':'');
      pageLabel.textContent=state.totalPages?'Page '+state.page+' of '+state.totalPages:'';
      previous.disabled=state.page<=1;next.disabled=state.page>=state.totalPages;
    } catch(error) {
      if(error.name==='AbortError'||ticket!==state.request)return;
      results.replaceChildren();const message=element('p',error.message,'vendors-empty');message.setAttribute('role','alert');results.append(message);
      count.textContent='';pageLabel.textContent='';previous.disabled=next.disabled=true;
    } finally {if(ticket===state.request)results.removeAttribute('aria-busy');}
  }
  function render() {
    mount=document.querySelector('[data-workspace-mount="vendors"]');if(!mount)return;
    if(!authorized()){
      clearTimeout(timer);state.request++;state.controller?.abort();
      mount.textContent='Vendors is unavailable for this session.';view=null;return;
    }
    if(view?.isConnected){void load();return;}
    view=element('section',undefined,'vendors-view');view.setAttribute('aria-labelledby','vendorsTitle');
    const back=element('button','Back to Home','vendors-back');back.type='button';back.onclick=leave;
    const title=element('h2','Vendors');title.id='vendorsTitle';
    sourceLabel=element('p','Preliminary reference','vendors-source');
    const label=element('label','Search vendors');label.htmlFor='vendorsSearch';
    search=element('input');search.id='vendorsSearch';search.type='search';search.maxLength=100;search.placeholder='Name or vendor number';search.value=state.query;search.autocomplete='off';
    search.oninput=()=>{clearTimeout(timer);state.query=search.value;state.page=1;state.request++;state.controller?.abort();setBusy();timer=setTimeout(load,180);};
    search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void load();}};
    const toolbar=element('div',undefined,'vendors-search');toolbar.append(label,search);
    count=element('p','','vendors-count');count.setAttribute('role','status');count.setAttribute('aria-live','polite');
    results=element('div',undefined,'vendors-results');results.tabIndex=0;results.setAttribute('role','region');results.setAttribute('aria-label','Vendor list');
    const pager=element('nav',undefined,'vendors-pager');pager.setAttribute('aria-label','Vendor pages');
    previous=element('button','Previous');next=element('button','Next');previous.type=next.type='button';
    pageLabel=element('span');
    previous.onclick=()=>{if(state.page>1){state.page--;void load();}};
    next.onclick=()=>{if(state.page<state.totalPages){state.page++;void load();}};
    pager.append(previous,pageLabel,next);view.append(back,title,sourceLabel,toolbar,count,results,pager);mount.replaceChildren(view);void load();
  }
  document.addEventListener('dle:workspace-change',event=>{if(event.detail?.workspace?.id!=='vendors'){clearTimeout(timer);state.request++;state.controller?.abort();}});
  document.addEventListener('dle:capabilities-ready',()=>{if(mount?.isConnected&&!authorized())render();});
  window.DleWorkspaces=window.DleWorkspaces||{};window.DleWorkspaces.vendors=Object.freeze({render});
})(window,document);
