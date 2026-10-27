(function(window,document){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function style(){
    if(document.getElementById('rfq-previous-quotes-style'))return;
    const s=document.createElement('style');s.id='rfq-previous-quotes-style';s.textContent=`
    .rfq-previous-quotes{color:#e4edf4;background:#121c27;border:1px solid #344858;border-radius:10px;padding:14px;max-width:1260px;margin:0 auto;min-width:0}
    .rfq-previous-quotes *{box-sizing:border-box}.rfq-previous-quotes button{font:inherit;color:#e8f1f6;background:#233747;border:1px solid #536d81;border-radius:5px;padding:6px 11px;min-height:34px;cursor:pointer}.rfq-previous-quotes button:disabled{opacity:.55;cursor:default}.rfq-previous-quotes button:focus-visible{outline:2px solid #79d3e1;outline-offset:2px}
    .rfq-pq-heading{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.rfq-pq-heading h1{font-size:21px;margin:0}.rfq-pq-context{font-size:13px;color:#b8cbd8;margin:0 0 6px;overflow-wrap:anywhere}.rfq-pq-address{font-size:12px;color:#9fb5c5;margin:0 0 12px;overflow-wrap:anywhere}
    .rfq-pq-selection{border:1px solid #3d5869;border-radius:6px;background:#1b2d3b;padding:9px 11px;margin:0 0 10px;font-size:13px;overflow-wrap:anywhere}.rfq-pq-selection strong{font-weight:650}.rfq-pq-open{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:7px}.rfq-pq-open small{color:#b8cbd8;font-size:12px}.rfq-pq-selection p{margin:3px 0 0;color:#b8cbd8}.rfq-pq-selection .rfq-pq-issue{color:#f4cd92}.rfq-pq-toolbar{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:8px 0}.rfq-pq-crumbs{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0}.rfq-pq-crumbs button{padding:4px 8px;min-height:30px;overflow-wrap:anywhere;text-align:left}
    .rfq-pq-message{min-height:20px;color:#c7d9e5;font-size:13px;margin:6px 0;overflow-wrap:anywhere}.rfq-pq-message[data-error=true]{color:#ffc1af}.rfq-pq-table-wrap{overflow-x:auto;border:1px solid #344858;border-radius:6px}.rfq-pq-table{width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed}.rfq-pq-table th{text-align:left;background:#203241;color:#bbcfdd;font-weight:600;padding:8px 10px}.rfq-pq-table td{padding:7px 10px;border-top:1px solid #314452;vertical-align:middle;overflow-wrap:anywhere}.rfq-pq-table th:nth-child(2){width:180px}.rfq-pq-table th:nth-child(3){width:90px}.rfq-pq-table th:nth-child(4){width:120px}.rfq-pq-folder{background:transparent!important;border-color:transparent!important;text-align:left;padding:2px 0!important;color:#a9e3ed!important}.rfq-pq-empty{padding:18px!important;color:#b9cbd8}.rfq-pq-footnote{font-size:12px;color:#9eb3c3;margin:10px 0 0}
    @media(max-width:650px){.rfq-previous-quotes{padding:10px}.rfq-pq-heading{gap:8px}.rfq-pq-heading h1{font-size:19px}.rfq-previous-quotes button{min-height:40px}.rfq-pq-table th:nth-child(2),.rfq-pq-table td:nth-child(2){display:none}.rfq-pq-table th:nth-child(3),.rfq-pq-table td:nth-child(3){display:none}.rfq-pq-table th:nth-child(4){width:104px}.rfq-pq-table td{padding:7px}.rfq-pq-crumbs button{min-height:38px}.rfq-pq-mobile-date{display:block;color:#a9bfce;font-size:11px;margin-top:3px}}
    @media(min-width:651px){.rfq-pq-mobile-date{display:none}}
    `;document.head.append(s);
  }
  function date(value){if(window.DleDateFormat)return window.DleDateFormat.dateTime(value);if(!value)return '-';const d=new Date(value);return Number.isNaN(d.getTime())?'-':d.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
  function size(value){const n=Number(value);if(!Number.isFinite(n)||n<0)return '-';return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';}
  async function open({workbench,rfq,department,trigger}){
    if(!workbench?.isConnected||!['materials','labor'].includes(department))return;
    style();
    const label=department==='materials'?'Materials':'Labor',base='/api/sim/rfqs/'+encodeURIComponent(rfq.intakeId)+'/previous-quotes';
    const main=workbench.closest('main'),savedMain={top:main?.scrollTop||0,left:main?.scrollLeft||0},display=workbench.style.display;
    const scrolls=Array.from(workbench.querySelectorAll('*')).filter(e=>e.scrollTop||e.scrollLeft).map(e=>({e,top:e.scrollTop,left:e.scrollLeft}));
    const screen=document.createElement('section');screen.className='rfq-previous-quotes';screen.tabIndex=-1;screen.setAttribute('aria-label','Previous Quotes');
    workbench.after(screen);workbench.style.display='none';if(main)main.scrollTop=0;
    let state=null,closed=false,loading=false,describing=false,saving=false,opening=false,requestNumber=0,controller=null,message='',error=false;
    const query=values=>new URLSearchParams({department,...values}).toString();
    async function request(url,options={}){const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let data;try{data=await response.json();}catch{throw Error('Previous quotes could not be read. Retry.');}if(!response.ok)throw Error(data.message||'Previous quotes are unavailable.');return data;}
    function close(){if(saving||closed)return;closed=true;controller?.abort();screen.remove();workbench.style.display=display;for(const s of scrolls){s.e.scrollTop=s.top;s.e.scrollLeft=s.left;}if(main){main.scrollTop=savedMain.top;main.scrollLeft=savedMain.left;}trigger?.focus({preventScroll:true});}
    function render(){
      if(closed)return;
      const restoreFocus=screen.contains(document.activeElement);
      const assembly=rfq.assemblies?.[0],entries=(state?.entries||[]).filter(e=>e.isDirectory||(!String(e.name).startsWith('~$')&&/\.(xls|xlsx)$/i.test(e.name)));
      const segments=String(state?.path||'').split(/[\\/]/).filter(Boolean),separator=String(state?.path||'').includes('\\')?'\\':'/';
      const crumbs=[{name:'Quote',path:''},...segments.map((name,i)=>({name,path:segments.slice(0,i+1).join(separator)}))];
      const blocked=loading||describing||saving||opening;
      screen.innerHTML='<div class="rfq-pq-heading"><button type="button" data-pq-action="back" '+(saving?'disabled':'')+'>Back to '+label+'</button><h1>Previous Quotes</h1></div><p class="rfq-pq-context">'+esc(rfq.libraryRfq?.displayId||rfq.intakeId)+' &middot; '+esc(assembly?.assemblyNumber||state?.folder?.assembly||'')+' &middot; '+label+'</p>'+
        (state?.folder?.address?'<p class="rfq-pq-address">'+esc(state.folder.address)+'</p>':'')+
        '<div class="rfq-pq-selection" data-pq-selection><strong>Selected for '+label+': </strong>'+(state?.selection?esc(state.selection.name)+'<p>'+esc(state.selection.path)+'</p>':state?'None':loading?'Loading...':'Unavailable')+(state?.selectionIssue?'<p class="rfq-pq-issue">'+esc(state.selectionIssue)+'</p>':'')+(state?.openWorksheetContractVersion===1?'<div class="rfq-pq-open"><button type="button" data-pq-action="open" '+(blocked||!state.available||!state.selection||!state.selectionCurrent||!state.selectionToken?'disabled':'')+'>Open worksheet</button><small>Downloads a copy to open in Excel.</small></div>':'')+'</div>'+
        '<div class="rfq-pq-toolbar"><nav class="rfq-pq-crumbs" aria-label="Quote folder">'+crumbs.map((c,i)=>'<button type="button" data-pq-action="folder" data-path="'+esc(c.path)+'" '+(blocked?'disabled':'')+' '+(i===crumbs.length-1?'aria-current="location"':'')+'>'+esc(c.name)+'</button>').join('<span aria-hidden="true">/</span>')+'</nav><button type="button" data-pq-action="refresh" '+(blocked?'disabled':'')+'>Refresh</button></div>'+
        '<p class="rfq-pq-message" role="status" data-error="'+error+'">'+esc(opening?'Preparing worksheet copy...':saving?'Selecting workbook...':describing?'Checking workbook...':loading?'Loading quote folder...':message)+'</p>'+
        '<div class="rfq-pq-table-wrap"><table class="rfq-pq-table"><thead><tr><th>Filename</th><th>Modified</th><th>Size</th><th></th></tr></thead><tbody>'+
        (state?.available===false?'<tr><td colspan="4" class="rfq-pq-empty">'+esc(state.unavailableReason||'No linked Quote folder is available.')+'</td></tr>':entries.length?entries.map(e=>'<tr data-pq-entry="'+esc(e.path)+'"><td>'+(e.isDirectory?'<button type="button" class="rfq-pq-folder" data-pq-action="folder" data-path="'+esc(e.path)+'" '+(blocked?'disabled':'')+'>'+esc(e.name)+'</button>':esc(e.name))+'<small class="rfq-pq-mobile-date">'+esc(date(e.modifiedUtc))+'</small></td><td>'+esc(date(e.modifiedUtc))+'</td><td>'+esc(e.isDirectory?'-':size(e.size))+'</td><td>'+(!e.isDirectory?'<button type="button" data-pq-action="select" data-path="'+esc(e.path)+'" '+(blocked||!state.canSelect||!e.selectable?'disabled':'')+'>'+((state.selection?.path===e.path&&state.selectionCurrent!==false)?'Selected':'Select')+'</button>':'')+'</td></tr>').join(''):'<tr><td colspan="4" class="rfq-pq-empty">'+(loading?'Loading...':'No Excel workbooks or folders here.')+'</td></tr>')+'</tbody></table></div>'+
        '<p class="rfq-pq-footnote">'+(state&&!state.canSelect?'View only. ':'')+'Select a workbook for later analysis. Estimate values stay unchanged.'+(state?.truncated?' This folder list is limited; open a subfolder to browse further.':'')+'</p>';
      if(restoreFocus)screen.focus({preventScroll:true});
    }
    async function browse(path='',successMessage=''){
      if(closed||describing||saving||opening)return;controller?.abort();controller=new AbortController();const number=++requestNumber;loading=true;error=false;message='';render();
      try{const result=await request(base+'?'+query({path}),{signal:controller.signal});if(closed||number!==requestNumber)return;if(result.contractVersion!==1)throw Error('Previous Quotes is not active on this server yet.');state=result;message=successMessage;}
      catch(e){if(e.name==='AbortError'||closed||number!==requestNumber)return;message=e.message;error=true;}
      finally{if(!closed&&number===requestNumber){loading=false;render();}}
    }
    async function select(path){
      if(closed||loading||describing||saving||opening||!state?.canSelect)return;
      const entry=state.entries?.find(e=>e.path===path&&!e.isDirectory&&e.selectable&&!String(e.name).startsWith('~$')&&/\.(xls|xlsx)$/i.test(e.name));if(!entry)return;
      describing=true;controller=new AbortController();error=false;message='';render();
      try{
        const description=await request(base+'/describe?'+query({folderToken:state.folderToken,path}),{signal:controller.signal});
        if(closed)return;describing=false;saving=true;render();
        const result=await request(base+'/selection',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({department,expectedToken:state.selectionToken,folderToken:description.folderToken,path,sourceToken:description.source?.sourceToken})});
        state={...state,...result};message='Workbook selected for '+label+'.';
      }catch(e){if(closed||e.name==='AbortError')return;error=true;message=e.message+' Refresh to check the saved selection before trying again.';}
      finally{describing=false;saving=false;if(!closed){render();screen.querySelector('[data-pq-action="back"]')?.focus({preventScroll:true});}}
    }
    async function openWorksheet(){
      if(closed||loading||describing||saving||opening||state?.openWorksheetContractVersion!==1||!state.available||!state.selection||!state.selectionCurrent||!state.selectionToken)return;
      const selected=state.selection,token=state.selectionToken;
      opening=true;controller=new AbortController();error=false;message='';render();
      try{
        const response=await fetch(base+'/file?'+query({selectionToken:token}),{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(!response.ok){let detail;try{detail=await response.json();}catch{}throw Error(detail?.message||'The worksheet could not be opened. Refresh to check the selected file.');}
        const type=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
        if(!['application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(type))throw Error('The worksheet response was not an Excel file. Refresh and try again.');
        const blob=await response.blob();
        if(closed)return;
        if(!blob.size||blob.size>20*1024*1024)throw Error('The worksheet copy is empty or too large to open.');
        const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=selected.name;link.dataset.previousQuoteDownload='true';document.body.append(link);
        try{link.click();}finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),30000);}
        message='Download requested. Open the downloaded copy in Excel.';
      }catch(e){if(closed||e.name==='AbortError')return;error=true;message=e.message;}
      finally{opening=false;if(!closed){render();screen.querySelector('[data-pq-action="open"]')?.focus({preventScroll:true});}}
    }
    screen.onclick=event=>{event.stopPropagation();const b=event.target.closest('button[data-pq-action]');if(!b||b.disabled)return;const action=b.dataset.pqAction;if(action==='back')close();else if(action==='folder')browse(b.dataset.path);else if(action==='refresh')browse(state?.path||'');else if(action==='select')select(b.dataset.path);else if(action==='open')openWorksheet();};
    screen.onkeydown=event=>{if(event.key==='Escape'&&!saving){event.preventDefault();event.stopPropagation();close();}};
    render();screen.querySelector('[data-pq-action="back"]')?.focus({preventScroll:true});await browse();
    return {close};
  }
  window.DleRfqPreviousQuotes=Object.freeze({open});
})(window,document);
