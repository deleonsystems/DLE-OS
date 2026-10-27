(function registerAssemblyLibrary(window, document) {
  'use strict';
  const id = 'assembly-library';
  const display = value => String(value ?? '').trimEnd();
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  async function loadPreparation() {
    if(window.DleLibraryPreparation)return;
    if(!window.DleLibraryPreparationLoading)window.DleLibraryPreparationLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/assembly-library/library-preparation.js';script.onload=resolve;script.onerror=()=>{window.DleLibraryPreparationLoading=null;reject(Error('Preparation workspace could not load.'));};document.head.append(script);});
    await window.DleLibraryPreparationLoading;
  }
  async function loadPartRequests() {
    if(window.DleMaterialPartRequestReview)return;
    if(!window.DleMaterialPartRequestReviewLoading)window.DleMaterialPartRequestReviewLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='SRC/workspaces/technical-review/material-part-request-review.js';
      script.onload=resolve;script.onerror=()=>{window.DleMaterialPartRequestReviewLoading=null;reject(Error('Part requests could not load.'));};document.head.append(script);
    });await window.DleMaterialPartRequestReviewLoading;
  }
  async function loadBom() {
    if(window.DleLibraryBom)return;
    if(!window.DleLibraryBomLoading)window.DleLibraryBomLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='SRC/workspaces/assembly-library/library-bom.js';script.onload=resolve;script.onerror=()=>{window.DleLibraryBomLoading=null;reject(Error('Library editor could not load.'));};document.head.append(script);
    });
    await window.DleLibraryBomLoading;
  }
  async function loadPackages(){if(window.DleLibraryPackages)return;if(!window.DleLibraryPackagesLoading)window.DleLibraryPackagesLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/assembly-library/library-packages.js';script.onload=resolve;script.onerror=()=>{window.DleLibraryPackagesLoading=null;reject(Error('Package summary could not load.'));};document.head.append(script);});await window.DleLibraryPackagesLoading;}
  async function loadEstimates(){
    if(window.DleLibraryEstimates)return;
    window.DleLibraryEstimatesLoading??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/assembly-library/library-estimates.js';script.onload=resolve;script.onerror=()=>{script.remove();window.DleLibraryEstimatesLoading=null;reject(Error('Estimate history could not load.'));};document.head.append(script);});await window.DleLibraryEstimatesLoading;
  }
  async function renderAssembly(mount, onBack) {
    if (!mount) return;
    if (!['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment) || window.DleOsCapabilities?.can?.('assembly_library.view') !== true) {
      mount.textContent = 'Assembly Library is unavailable for this session.';
      delete mount.dataset.libraryLoaded;
      return;
    }
    if (mount.dataset.libraryLoaded === 'true' && mount.querySelector('#assemblyLibraryView')) {await window.DleLibraryPackages?.refresh?.();await mount._libraryPartQueue?.refresh?.();return;}
    mount._libraryPartQueue?.destroy?.();mount._libraryPartDetail?.destroy?.();
    const view = element('section', undefined, 'assembly-library-view');
    view.id = 'assemblyLibraryView'; view.setAttribute('aria-labelledby','assemblyLibraryTitle');
    const back = element('button','Back to Library'); back.type = 'button'; back.onclick = onBack;
    const title = element('h2','Assembly Library'); title.id = 'assemblyLibraryTitle';
    view.append(back, title);
    const status = element('p','Loading verified snapshot…'); status.setAttribute('role','status');
    view.append(status); mount.replaceChildren(view);
    try {
      const response = await window.fetch('/api/sim/assembly-library/preliminary', {cache:'no-store',credentials:'same-origin'});
      if (!response.ok) throw new Error(response.status === 404 ? 'The Library snapshot is installed but awaits SIM activation.' : response.status === 403 ? 'Your current persona cannot browse this Library.' : 'The verified snapshot is unavailable. Try again after the SIM administrator checks it.');
      const snapshot = await response.json();
      if (!Array.isArray(snapshot.items) || snapshot.preliminary !== true) throw new Error('Unexpected snapshot response.');
      const provenance = element('details'); provenance.append(element('summary','Preliminary snapshot source'),element('p','Preliminary snapshot · July 29, 2026','library-snapshot-label'),element('p','Historical BMM headers and Library-managed assemblies. Snapshot headers do not establish complete BOMs or approval. This is not the current ERP master.','library-muted'));
      provenance.append(element('p',`Run ${snapshot.runId}`), element('p',`CSV SHA-256 ${snapshot.sourceSha256}`),
        element('p','An August 3 run reports different content fingerprints. The snapshot portion contains July 29 headers only; Library-managed identities remain separate. No component rows or drawing links are imported from the snapshot.'));
      const toolbar = element('div',undefined,'library-toolbar');
      const label = element('label','Search assemblies, drawings or revisions');
      const search = element('input'); search.type='search'; search.id='assemblyLibrarySearch'; search.maxLength=100; label.htmlFor=search.id; search.placeholder='Assembly or drawing number';
      const blankLabel = element('label',undefined,'library-checkbox'); const blank=element('input'); blank.type='checkbox'; blankLabel.append(blank,document.createTextNode('Without drawing number'));
      toolbar.append(label,search,blankLabel);
      const scroller = element('div',undefined,'library-table-scroll'); scroller.tabIndex=0; scroller.setAttribute('role','region');scroller.setAttribute('aria-label','Assembly headers');
      const table=element('table'); const head=element('thead'); const heading=element('tr');
      for(const text of ['Assembly','Drawing number','Drawing rev','BOM rev','Source']) { const th=element('th',text);th.scope='col';heading.append(th); }
      head.append(heading);const body=element('tbody');table.append(head,body);scroller.append(table);
      const pager=element('div',undefined,'library-pager');const prev=element('button','Previous'),next=element('button','Next'),pageLabel=element('span');prev.type=next.type='button';pager.append(prev,pageLabel,next);
      let page=1; const size=10;
      const listView = element('div');
      function openAssembly(row, trigger, preparationContext=null, returnContext=null) {
        const scroll = {x:window.scrollX,y:window.scrollY};
        const managed=row.contractVersion==='LIBRARY_MANAGED_V1';
        let bomScreen=null,productionScreen=null,quoteScreen=null,packageSummary=null,revisionPanel=null;
        const shell = element('section',undefined,'library-assembly-shell');
        shell.id='assemblyRecordWorkspace';shell.dataset.sourceKey=row.sourceKeyRaw;
        shell.setAttribute('aria-labelledby','libraryAssemblyTitle');
        const returnButton=element('button',returnContext?'Back to request':'Back to Assembly Library');returnButton.type='button';
        returnButton.onclick=()=>{
          if(productionScreen?.dataset.dirty==='true'&&!window.confirm('Discard unsaved document changes?'))return;productionScreen?.remove();bomScreen?.remove();quoteScreen?.remove();shell.remove();(returnContext?.screen||listView).hidden=false;view.setAttribute('aria-labelledby',returnContext?.titleId||'assemblyLibraryTitle');
          trigger.focus({preventScroll:true});window.scrollTo(scroll.x,scroll.y);if(returnContext)trigger.dispatchEvent(new Event('dle-library-records-return'));
        };
        const assemblyNumber=display(row.billNumber)||'Assembly number not provided';
        const drawingRevision=display(row.drawingRevision),bomRevision=display(row.bomRevision);
        const sourceTitle=assemblyNumber+' \u00b7 '+(drawingRevision&&drawingRevision===bomRevision?'Rev '+drawingRevision:'Drawing '+(drawingRevision||'Not provided')+' \u00b7 BOM '+(bomRevision||'Not provided'));
        const recordHeader=element('div',undefined,'library-record-heading');
        const heading=element('h2',sourceTitle,'library-literal');
        heading.id='libraryAssemblyTitle';heading.tabIndex=-1;
        const sourceLine=element('p',(managed?'Library source: ':'VPRO5 source: ')+assemblyNumber+' \u00b7 Drawing revision '+(drawingRevision||'Not provided')+' \u00b7 BOM revision '+(bomRevision||'Not provided'),'library-record-source');
        recordHeader.append(element('p','Assembly Records','library-record-kicker'),heading,sourceLine);
        shell.append(returnButton,recordHeader);
        const revisionName=element('div');shell.append(revisionName);if(window.DleOsCapabilities?.can?.('assembly_library.edit')===true)void loadPreparation().then(()=>window.DleLibraryPreparation.revisionName(revisionName,row.sourceKeyRaw,{suggestion:preparationContext?.incomingRevision,showSource:false,expectedSource:{assemblyNumber:row.billNumber,drawingRevision:row.drawingRevision,bomRevision:row.bomRevision},onView:data=>{if(heading.isConnected)heading.textContent=data?.record?.displayName?assemblyNumber+' \u00b7 '+data.record.displayName:sourceTitle;}})).then(value=>revisionPanel=value).catch(error=>revisionName.append(element('p',error.message)));
        const folder=element('section');shell.append(folder);void loadBom().then(()=>window.DleLibraryBom.folderPanel?.(folder,row)).catch(error=>folder.append(element('p',error.message)));
        if(row.normalizedKeyCollision) shell.append(element('p','Whitespace-sensitive source key: a separate header has a similar assembly number. These records remain distinct.','library-key-flag'));
        const source=element('details');source.append(element('summary','Source details'));
        for(const [label,value] of [['Drawing number',display(row.drawingNumber)||'Not provided'],['Raw source key',JSON.stringify(row.sourceKeyRaw)],['Record SHA-256',row.sourceRecordHash],['Contract',row.contractVersion],['BOM revision date (raw hex)',row.bomRevisionDate],['Snapshot run',managed?'Not from BMM snapshot':snapshot.runId],['CSV SHA-256',managed?'Not applicable':snapshot.sourceSha256]]) source.append(element('p',`${label}: ${value}`));
        const sections=element('div',undefined,'library-assembly-sections');
        for(const [title,copy] of [
          ['Materials','Open the BOM workspace to build, edit or review this assembly’s materials.'],
          ['Production / Drawings / Prints','Identify linked-folder files and save production references. Slides are not connected yet.'],
          ['Notes / Images','No notes or images are stored here. Later entries will identify their author or department and may relate to a document or BOM item.']
        ]) {
          const section=element('section',undefined,'library-assembly-section');section.append(element('h3',title),element('p',copy,'library-muted'));sections.append(section);
        }
        const materials=sections.firstElementChild;
        const openMaterials=element('button','Open Materials / BOM');openMaterials.type='button';
        openMaterials.dataset.libraryPreserveBom=row.sourceKeyRaw;
        materials.append(openMaterials);
        openMaterials.onclick=()=>{
          if(!bomScreen){
            bomScreen=element('section',undefined,'library-bom-workspace');bomScreen.id='libraryBomWorkspace';
            bomScreen.dataset.sourceKey=row.sourceKeyRaw;bomScreen.setAttribute('aria-labelledby','libraryBomTitle');
            const back=element('button','Back to Assembly');back.type='button';back.dataset.libraryPreserveBom=row.sourceKeyRaw;
            back.onclick=()=>{bomScreen.hidden=true;shell.hidden=false;void packageSummary?.refresh();void revisionPanel?.refresh();view.setAttribute('aria-labelledby','libraryAssemblyTitle');openMaterials.focus({preventScroll:true});window.scrollTo(0,0);};
            const title=element('h2',`${display(row.billNumber)||'Assembly'} · Materials / BOM`,'library-literal');title.id='libraryBomTitle';title.tabIndex=-1;
            const context=element('p',`Source drawing rev ${display(row.drawingRevision)||'not provided'} · Source BOM rev ${display(row.bomRevision)||'not provided'} · ${managed?'Library-managed identity':'Preliminary July 29, 2026'}`,'library-muted');
            const editor=element('div');bomScreen.append(back,title,context,editor);view.append(bomScreen);
            void loadBom().then(()=>window.DleLibraryBom.mount(editor,row)).catch(error=>editor.append(element('p',error.message)));
          }
          shell.hidden=true;bomScreen.hidden=false;view.setAttribute('aria-labelledby','libraryBomTitle');
          bomScreen.querySelector('h2').focus({preventScroll:true});window.scrollTo(0,0);
        };
        const openProduction=element('button','Open Production / Drawings / Prints');openProduction.type='button';sections.children[1].append(openProduction);
        openProduction.onclick=async()=>{
          if(productionScreen){productionScreen.hidden=false;shell.hidden=true;return;}
          productionScreen=element('section',undefined,'library-production-workspace');
          const back=element('button','Back to Assembly');back.type='button';
          back.onclick=()=>{if(productionScreen.dataset.dirty==='true'&&!window.confirm('Discard unsaved document changes?'))return;productionScreen.remove();productionScreen=null;shell.hidden=false;void packageSummary?.refresh();void revisionPanel?.refresh();openProduction.focus({preventScroll:true});};
          const host=element('div');productionScreen.append(back,element('h2',display(row.billNumber)+' — Production / Drawings / Prints'),host);view.append(productionScreen);shell.hidden=true;
          try{await loadBom();if(!window.DleLibraryDocuments){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/assembly-library/library-documents.js';script.onload=resolve;script.onerror=()=>reject(Error('Production workspace could not load.'));document.head.append(script);});}await window.DleLibraryDocuments.mount(host,row,productionScreen);}catch(error){host.textContent=error.message;}
        };
        if(snapshot.estimateHistoryContractVersion===1&&(window.DleOsCapabilities?.can?.('rfq.view')===true||window.DleOsCapabilities?.can?.('technical_review.view')===true)){
          const quotes=element('section',undefined,'library-assembly-section'),openQuotes=element('button','Open Quotes');openQuotes.type='button';quotes.append(element('h3','Quotes'),element('p','Current estimates and review history.','library-muted'),openQuotes);sections.append(quotes);
          openQuotes.onclick=async()=>{
            if(openQuotes.disabled)return;openQuotes.disabled=true;
            if(!quoteScreen){quoteScreen=element('section',undefined,'library-estimates-screen');const back=element('button','Back to Assembly Records');back.type='button';back.onclick=()=>{quoteScreen.remove();quoteScreen=null;shell.hidden=false;view.setAttribute('aria-labelledby','libraryAssemblyTitle');openQuotes.focus({preventScroll:true});};const title=element('h2',assemblyNumber+' \u00b7 Quotes');title.id='libraryQuotesTitle';title.tabIndex=-1;quoteScreen.append(back,title);view.append(quoteScreen);}
            const host=element('div');quoteScreen.append(host);shell.hidden=true;view.setAttribute('aria-labelledby','libraryQuotesTitle');quoteScreen.querySelector('h2').focus({preventScroll:true});
            try{await loadEstimates();if(host.isConnected)await window.DleLibraryEstimates.mount(host,{key:row.sourceKeyRaw,drawingRevision:display(row.drawingRevision),bomRevision:display(row.bomRevision),onEditMaterials:request=>window.DleWorkspaceShell.navigate({workspaceId:'rfqs',requestedState:{intakeId:request.rfqId,open:'materials',materialsTarget:request.target||null}})});}
            catch(error){if(host.isConnected)host.textContent=error.message;}finally{if(openQuotes.isConnected)openQuotes.disabled=false;}
          };
        }
        const packageHost=element('section');shell.append(sections,packageHost,source);void loadPackages().then(async()=>{packageSummary=await window.DleLibraryPackages.mount(packageHost,row.sourceKeyRaw,{...preparationContext,onChanged:()=>{void revisionPanel?.refresh();bomScreen?.remove();bomScreen=null;productionScreen?.remove();productionScreen=null;}});}).catch(e=>packageHost.textContent=e.message);(returnContext?.screen||listView).hidden=true;view.append(shell);view.setAttribute('aria-labelledby','libraryAssemblyTitle');
        heading.focus({preventScroll:true});window.scrollTo(0,0);
      }
      const draw=()=>{
        const query=search.value.toLocaleLowerCase();
        const rows=snapshot.items.filter(row => (!blank.checked || !display(row.drawingNumber)) && (!query || [row.billNumber,row.drawingNumber,row.drawingRevision,row.bomRevision].some(v=>String(v).toLocaleLowerCase().includes(query))));
        const pages=Math.max(1,Math.ceil(rows.length/size));page=Math.min(page,pages);
        body.replaceChildren();
        for(const row of rows.slice((page-1)*size,page*size)) {
          const tr=element('tr');tr.dataset.sourceKey=row.sourceKeyRaw;
          const bill=element('td',undefined,'library-literal');
          const open=element('button',display(row.billNumber)||'Assembly number not provided','library-assembly-open');open.type='button';
          open.setAttribute('aria-label',`Open assembly ${display(row.billNumber)||'without number'}`);
          open.onclick=()=>openAssembly(row,open);bill.append(open);
          if(row.normalizedKeyCollision) {const flag=element('span','Whitespace-sensitive key','library-key-flag');bill.append(flag);}
          tr.append(bill,element('td',display(row.drawingNumber)||'—','library-literal'),element('td',display(row.drawingRevision)||'—'),element('td',display(row.bomRevision)||'—'));
          const cell=element('td');const details=element('details');details.append(element('summary','Details'));
          for(const [name,value] of [['Raw source key',JSON.stringify(row.sourceKeyRaw)],['Record SHA-256',row.sourceRecordHash],['Contract',row.contractVersion],['BOM revision date (raw hex)',row.bomRevisionDate]])details.append(element('p',`${name}: ${value}`));
          cell.append(details);tr.append(cell);body.append(tr);
        }
        status.textContent=`${rows.length.toLocaleString()} of ${snapshot.totalHeaders.toLocaleString()} headers · ${snapshot.blankDrawingCount} without drawing numbers`;
        if(!rows.length){const tr=element('tr'),td=element('td','No matching headers.');td.colSpan=5;tr.append(td);body.append(tr);}
        pageLabel.textContent=`Page ${page} of ${pages}`;prev.disabled=page===1;next.disabled=page===pages;
      };
      const showPage=()=>{draw();scroller.scrollTop=0;};
      search.addEventListener('input',()=>{page=1;showPage();});blank.addEventListener('change',()=>{page=1;showPage();});prev.onclick=()=>{page--;showPage();};next.onclick=()=>{page++;showPage();};
      const lookup=element('section',undefined,'library-home-section library-home-lookup');
      lookup.setAttribute('aria-label','Find an Assembly');
      lookup.append(element('h3','Find an Assembly'),toolbar,status,scroller,pager,provenance);
      view.append(lookup);draw();
      listView.append(...Array.from(view.childNodes));view.append(listView);mount.dataset.libraryLoaded='true';
      const preparation=element('section',undefined,'library-home-section library-home-requests');
      preparation.setAttribute('aria-label','Library Requests');if(window.DleOsCapabilities?.can?.('assembly_library.edit')===true)listView.append(preparation);
      const requestScreen=element('section',undefined,'library-request-workspace');requestScreen.id='libraryRequestWorkspace';requestScreen.hidden=true;view.append(requestScreen);
      let homeScroll={x:0,y:0};
      if(window.DleOsCapabilities?.can?.('assembly_library.edit')===true)void loadPreparation().then(()=>window.DleLibraryPreparation.queue(preparation,async (key,context,trigger)=>{
        if(trigger?.disabled)return;if(trigger)trigger.disabled=true;
        try{
          const latest=await window.fetch('/api/sim/assembly-library/preliminary',{cache:'no-store',credentials:'same-origin'});if(!latest.ok)throw Error('Library identity could not be loaded.');const data=await latest.json();
          if(!requestScreen.getClientRects().length||!trigger?.isConnected||requestScreen.querySelector('[data-preparation-id]')?.dataset.preparationId!==context?.preparationId)return;
          const row=data.items.find(r=>r.sourceKeyRaw===key);if(!row)throw Error('Library identity not found.');snapshot.items=data.items;snapshot.totalHeaders=data.totalHeaders;snapshot.blankDrawingCount=data.blankDrawingCount;draw();openAssembly(row,trigger,context,{screen:requestScreen,titleId:'libraryRequestTitle'});
        }finally{if(trigger?.isConnected)trigger.disabled=false;}
      },{workspace:requestScreen,titleId:'libraryRequestTitle',onOpen:entering=>{
        if(entering)homeScroll={x:window.scrollX,y:window.scrollY};listView.hidden=true;requestScreen.hidden=false;view.setAttribute('aria-labelledby','libraryRequestTitle');if(entering)window.scrollTo(0,0);
      },onBack:()=>{requestScreen.hidden=true;listView.hidden=false;view.setAttribute('aria-labelledby','assemblyLibraryTitle');window.scrollTo(homeScroll.x,homeScroll.y);}})).catch(error=>preparation.textContent=error.message);
      const partRequests=element('section',undefined,'library-home-section');partRequests.hidden=true;partRequests.setAttribute('aria-label','Part requests');if(window.DleOsCapabilities?.can?.('assembly_library.edit')===true)listView.append(partRequests);
      if(window.DleOsCapabilities?.can?.('assembly_library.edit')===true)void loadPartRequests().then(async()=>{
        mount._libraryPartQueue=await window.DleMaterialPartRequestReview.queue(partRequests,{role:'assembly-library',onOpen:async(item,trigger)=>{
          if(mount._libraryPartDetail?.canLeave?.()===false)return;
          mount._libraryPartDetail?.destroy?.();const activeRequest={id:item.id};mount._libraryPartActive=activeRequest;homeScroll={x:window.scrollX,y:window.scrollY};listView.hidden=true;requestScreen.hidden=false;
          view.setAttribute('aria-labelledby','libraryPartRequestTitle');window.scrollTo(0,0);
          const detail=await window.DleMaterialPartRequestReview.open(requestScreen,item.id,{role:'assembly-library',titleId:'libraryPartRequestTitle',back:()=>{
            mount._libraryPartActive=null;mount._libraryPartDetail?.destroy?.();mount._libraryPartDetail=null;requestScreen.hidden=true;listView.hidden=false;view.setAttribute('aria-labelledby','assemblyLibraryTitle');
            trigger?.focus({preventScroll:true});window.scrollTo(homeScroll.x,homeScroll.y);
          },onOpenAssembly:async batch=>{
            const button=requestScreen.querySelector('[data-request-assembly]');if(!button||button.disabled)return;button.disabled=true;
            requestScreen.querySelector('[data-part-library-error]')?.remove();
            try{
              const response=await window.fetch('/api/sim/assembly-library/preliminary',{cache:'no-store',credentials:'same-origin'});
              if(!response.ok)throw Error('Assembly Records could not be loaded.');const latest=await response.json();
              if(!button.isConnected||requestScreen.hidden||mount._libraryPartActive!==activeRequest)return;
              const row=latest.items?.find(r=>r.sourceKeyRaw===batch.baseline?.libraryPackage?.libraryKey);if(!row)throw Error('The exact assembly record is unavailable. The request was retained.');
              snapshot.items=latest.items;snapshot.totalHeaders=latest.totalHeaders;snapshot.blankDrawingCount=latest.blankDrawingCount;draw();
              openAssembly(row,button,null,{screen:requestScreen,titleId:'libraryPartRequestTitle'});
            }catch(error){if(requestScreen.hidden||mount._libraryPartActive!==activeRequest)return;const message=element('p',error.message,'part-request-error');message.dataset.partLibraryError='';message.setAttribute('role','alert');requestScreen.append(message);}
            finally{if(button.isConnected)button.disabled=false;}
          }});
          if(mount._libraryPartActive!==activeRequest){detail?.destroy?.();return;}mount._libraryPartDetail=detail;
          const heading=requestScreen.querySelector('h2');if(heading)heading.id='libraryPartRequestTitle';
        }});
      }).catch(error=>{partRequests.hidden=false;partRequests.append(element('p',error.message,'library-muted'));});
    } catch(error) {
      status.textContent=error.message || 'Assembly Library could not load.';
      const retry=element('button','Retry');retry.type='button';retry.onclick=()=>renderAssembly(mount,onBack);view.append(retry);
    }
  }
  async function loadLaborTemplates(){
    if(!window.DleLaborTemplates){window.DleLaborTemplatesLoading??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='SRC/workspaces/rfqs/labor-templates.js';script.onload=resolve;script.onerror=()=>{script.remove();window.DleLaborTemplatesLoading=null;reject(Error('Templates unavailable. Reload to retry.'));};document.head.append(script);});await window.DleLaborTemplatesLoading;}return window.DleLaborTemplates;
  }
  let currentShell=null;
  function canReturnToLibrary() {
    const state=currentShell;
    return !!state?.mount.isConnected && (state.active==='forms' ||
      state.active==='assembly' && !!state.assembly.querySelector('.library-home-lookup')?.getClientRects().length);
  }
  function returnToLibrary(){if(canReturnToLibrary())return currentShell.show('home');return false;}
  async function render() {
    const mount=document.querySelector('[data-workspace-mount="assembly-library"]');
    if(!mount)return;
    if(!['SIM','SIMULATION'].includes(window.DleOsRuntimeConfig?.environment) || window.DleOsCapabilities?.can?.('assembly_library.view')!==true){
      mount.textContent='Library is unavailable for this session.';currentShell=null;return;
    }
    if(currentShell?.mount===mount && currentShell.home.isConnected){
      if(currentShell.active==='assembly'&&!currentShell.pending)await currentShell.show('assembly',false);
      return;
    }
    const home=element('section',undefined,'dle-library-home');home.setAttribute('aria-labelledby','dleLibraryTitle');
    const back=element('button','Back to Home');back.type='button';back.onclick=()=>window.changeWorkArea?.();
    const title=element('h2','Library');title.id='dleLibraryTitle';title.tabIndex=-1;
    const cards=element('div',undefined,'dle-library-cards');
    function entry(name,description,pane){
      const cell=element('section',undefined,'dle-library-card'),heading=element('h3',name),text=element('p',description),button=element('button','Open '+name);
      button.type='button';button.onclick=()=>void state.show(pane);cell.append(heading,text,button);cards.append(cell);return button;
    }
    const formsButton=entry('Forms Library','Reusable forms and Labor templates.','forms');
    const assemblyButton=entry('Assembly Library','Find an assembly or work a Library request.','assembly');
    home.append(back,title,cards);
    const forms=element('section',undefined,'dle-library-home');forms.hidden=true;forms.setAttribute('aria-labelledby','formsLibraryTitle');
    const formsBack=element('button','Back to Library');formsBack.type='button';formsBack.onclick=()=>void state.show('home');
    const formsTitle=element('h2','Forms Library');formsTitle.id='formsLibraryTitle';formsTitle.tabIndex=-1;
    const templateHost=element('div');forms.append(formsBack,formsTitle,templateHost);
    const assembly=element('div');assembly.hidden=true;assembly.dataset.libraryAssemblyHost='';
    const state={mount,home,forms,assembly,active:'home',pending:false,async show(pane,focus=true){
      if(pane==='assembly'&&state.pending)return;
      const prior=state.active;state.active=pane;
      home.hidden=pane!=='home';forms.hidden=pane!=='forms';assembly.hidden=pane!=='assembly';
      window.DleWorkspaceShell?.refreshBackButton?.();
      if(pane==='forms'&&!state.formsPending){
        state.formsPending=true;formsButton.disabled=true;
        try{const templates=await loadLaborTemplates();await templates.mount(templateHost);}
        catch(error){templateHost.textContent=error.message;}
        finally{state.formsPending=false;formsButton.disabled=false;}
      }
      if(pane==='assembly'){
        state.pending=true;assemblyButton.disabled=true;
        try{await renderAssembly(assembly,()=>void state.show('home'));}
        finally{state.pending=false;assemblyButton.disabled=false;window.DleWorkspaceShell?.refreshBackButton?.();}
      }
      if(focus&&state.active===pane){const target=pane==='home'?(prior==='forms'?formsButton:assemblyButton):pane==='forms'?formsTitle:assembly.querySelector('#assemblyLibraryTitle');target?.focus({preventScroll:true});}
    }};
    currentShell=state;mount.replaceChildren(home,forms,assembly);
  }
  window.DleWorkspaces=window.DleWorkspaces||{};
  window.DleWorkspaces[id]=Object.freeze({id,render,canReturnToLibrary,returnToLibrary});
})(window,document);
