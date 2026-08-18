public static class TestIdentitiesUi
{
    public static string Inject(string html)
    {
        const string bodyEnd = "</body>";
        var index = html.LastIndexOf(bodyEnd, StringComparison.OrdinalIgnoreCase);
        if (index < 0) throw new InvalidOperationException("The development frontend document body is absent.");
        return html.Insert(index, Markup);
    }

    private const string Markup = """
<style id="dle-test-identities-style">
  #dle-test-identities-open{position:static;flex:0 0 auto;border:1px solid #8b5cf6;border-radius:8px;background:#4c1d95;color:#fff;padding:8px 13px;font:600 12px system-ui;box-shadow:none;cursor:pointer}
  #dle-test-identities[hidden],#dle-test-identities-open[hidden]{display:none!important}
  #dle-test-identities{position:fixed;inset:0;z-index:12000;background:#020617c7;padding:7vh 5vw;font:13px/1.4 system-ui;color:#e2e8f0}
  .dle-test-identities-card{max-width:900px;max-height:86vh;margin:auto;box-sizing:border-box;overflow:auto;background:#0f172a;border:1px solid #475569;border-radius:12px;padding:20px;box-shadow:0 20px 60px #0008}
  .dle-test-identities-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.dle-test-identities-head h2{margin:0 0 5px;color:#f8fafc}.dle-test-identities-head p{margin:0;color:#94a3b8}
  .dle-test-identities-close,.dle-test-identity-copy{min-height:40px;border:1px solid #64748b;border-radius:7px;background:#1e293b;color:#fff;padding:7px 11px;cursor:pointer;touch-action:manipulation}
  .dle-test-identities-list{display:grid;gap:12px;margin-top:18px}.dle-test-identity{border:1px solid #334155;border-radius:10px;background:#0b1220;padding:15px}
  .dle-test-identity h3{margin:0;color:#c4b5fd}.dle-test-identity-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:8px 18px;margin-top:12px}
  .dle-test-identity-field{display:grid;grid-template-columns:105px minmax(0,1fr);gap:8px}.dle-test-identity-field dt{color:#94a3b8}.dle-test-identity-field dd{margin:0;color:#f8fafc;font-weight:650;overflow-wrap:anywhere}
  .dle-test-identity-actions{display:flex;align-items:center;gap:10px;margin-top:14px}.dle-test-identity-copy-state{color:#86efac;font-size:12px}
  @media(max-width:700px){#dle-test-identities{padding:3vh 3vw}.dle-test-identity-grid{grid-template-columns:1fr}}
</style>
<button id="dle-test-identities-open" type="button" hidden>Test Identities</button>
<section id="dle-test-identities" role="dialog" aria-modal="true" aria-labelledby="dle-test-identities-title" hidden>
  <div class="dle-test-identities-card">
    <header class="dle-test-identities-head"><div><h2 id="dle-test-identities-title">Test Identities</h2><p>Synthetic DEV personas for permission and operator-experience testing. These are not employees.</p></div><button id="dle-test-identities-close" class="dle-test-identities-close" type="button">Close</button></header>
    <div id="dle-test-identities-list" class="dle-test-identities-list"></div>
  </div>
</section>
<script id="dle-test-identities-script">
(()=>{
  const registry=Object.freeze([
    Object.freeze({name:'Kitting Operator',username:'dev.kitting',type:'DEV TEST PERSONA',workspace:'Kitting',privilege:'Operator',superAdmin:'No',status:'Active',purpose:'Simulates a normal Kitting operator during development.'})
  ]);
  const open=document.getElementById('dle-test-identities-open'),dialog=document.getElementById('dle-test-identities'),close=document.getElementById('dle-test-identities-close'),list=document.getElementById('dle-test-identities-list');
  const headerControls=document.getElementById('dleDevControlsUtilities');if(headerControls)headerControls.append(open);
  function field(label,value){const root=document.createElement('div');root.className='dle-test-identity-field';const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;root.append(term,description);return root}
  async function copyUsername(persona,state){try{await navigator.clipboard.writeText(persona.username)}catch{const input=document.createElement('textarea');input.value=persona.username;input.setAttribute('readonly','');input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();document.execCommand('copy');input.remove()}state.textContent='Username copied';window.setTimeout(()=>state.textContent='',1800)}
  function render(){list.replaceChildren(...registry.map(persona=>{const article=document.createElement('article');article.className='dle-test-identity';const title=document.createElement('h3');title.textContent=persona.name;const grid=document.createElement('dl');grid.className='dle-test-identity-grid';[['Username',persona.username],['Type',persona.type],['Workspace',persona.workspace],['Privilege',persona.privilege],['SUPER_ADMIN',persona.superAdmin],['Status',persona.status],['Purpose',persona.purpose]].forEach(item=>grid.append(field(...item)));const actions=document.createElement('div');actions.className='dle-test-identity-actions';const copy=document.createElement('button'),state=document.createElement('span');copy.type='button';copy.className='dle-test-identity-copy';copy.textContent='Copy Username';copy.onclick=()=>copyUsername(persona,state);state.className='dle-test-identity-copy-state';state.setAttribute('aria-live','polite');actions.append(copy,state);article.append(title,grid,actions);return article}))}
  document.addEventListener('dle:capabilities-ready',event=>{open.hidden=event.detail?.isSuperAdmin!==true});
  open.onclick=()=>{render();dialog.hidden=false};close.onclick=()=>dialog.hidden=true;
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.hidden=true});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.hidden)dialog.hidden=true});
  window.DleTestIdentityRegistry=registry;
})();
</script>
""";
}
