public static class EmployeeDirectoryUi
{
    public static string Inject(string html)
    {
        const string bodyEnd = "</body>";
        var index = html.LastIndexOf(bodyEnd, StringComparison.OrdinalIgnoreCase);
        if (index < 0) throw new InvalidOperationException("The development frontend document body is absent.");
        return html.Insert(index, Markup);
    }

    private const string Markup = """
<style id="dle-employee-directory-style">
  #dle-employee-directory-open{position:fixed;top:58px;right:18px;z-index:9999;border:1px solid #60a5fa;
    border-radius:8px;background:#1d4ed8;color:#fff;padding:8px 13px;font:600 12px system-ui,sans-serif;
    box-shadow:0 4px 16px rgba(0,0,0,.22);cursor:pointer}
  #dle-employee-directory[hidden],#dle-employee-directory-open[hidden]{display:none!important}
  #dle-employee-directory{position:fixed;inset:0;z-index:12000;background:rgba(2,6,23,.78);padding:4vh 3vw;
    font:13px/1.4 system-ui,sans-serif;color:#e2e8f0}
  .dle-employee-directory-card{height:92vh;box-sizing:border-box;overflow:auto;background:#0f172a;
    border:1px solid #334155;border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .dle-employee-directory-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
  .dle-employee-directory-head h2{margin:0 0 5px;color:#f8fafc}.dle-employee-directory-head p{margin:0;color:#94a3b8}
  #dle-employee-directory-close{border:1px solid #64748b;border-radius:7px;background:#1e293b;color:#fff;padding:7px 11px;cursor:pointer}
  .dle-employee-directory-controls{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:18px 0 12px}
  #dle-employee-directory-summary{color:#93c5fd;font-weight:600}
  .dle-employee-directory-table-wrap{overflow:auto;border:1px solid #334155;border-radius:9px}
  #dle-employee-directory-table{width:100%;border-collapse:collapse;white-space:nowrap}
  #dle-employee-directory-table th{position:sticky;top:0;background:#1e293b;color:#cbd5e1;text-align:left;padding:10px;border-bottom:1px solid #475569}
  #dle-employee-directory-table td{padding:9px 10px;border-bottom:1px solid #1e293b;color:#e2e8f0}
  #dle-employee-directory-table tr[data-status="HISTORICAL_RETAINED"] td{color:#cbd5e1;background:#172033}
  #dle-employee-directory-table tr[data-status="SOURCE_REVIEW"] td{background:#3f2a18;color:#fde68a}
  .dle-dir-yes{color:#86efac}.dle-dir-no{color:#cbd5e1}.dle-dir-error{color:#fca5a5;padding:14px 0}
</style>
<button id="dle-employee-directory-open" type="button" hidden>Employee Directory</button>
<section id="dle-employee-directory" role="dialog" aria-modal="true" aria-labelledby="dle-employee-directory-title" hidden>
  <div class="dle-employee-directory-card">
    <header class="dle-employee-directory-head"><div>
      <h2 id="dle-employee-directory-title">Employee Directory</h2>
      <p>Development workforce identity and preliminary provisioning — no account activation.</p>
    </div><button id="dle-employee-directory-close" type="button">Close</button></header>
    <div class="dle-employee-directory-controls">
      <label><input id="dle-employee-directory-historical" type="checkbox"> Include historical retained</label>
      <output id="dle-employee-directory-summary" aria-live="polite">Loading…</output>
    </div>
    <div id="dle-employee-directory-error" class="dle-dir-error" hidden></div>
    <div class="dle-employee-directory-table-wrap"><table id="dle-employee-directory-table">
      <thead><tr><th>Employee #</th><th>Employee</th><th>Department</th><th>Job Title</th>
      <th>Workforce Status</th><th>Training Eligible</th><th>Provisioning</th>
      <th>Proposed Username</th><th>DLE-OS User</th></tr></thead><tbody></tbody>
    </table></div>
  </div>
</section>
<script id="dle-employee-directory-script">
(()=>{
  const open=document.getElementById('dle-employee-directory-open');
  const dialog=document.getElementById('dle-employee-directory');
  const close=document.getElementById('dle-employee-directory-close');
  const historical=document.getElementById('dle-employee-directory-historical');
  const summary=document.getElementById('dle-employee-directory-summary');
  const error=document.getElementById('dle-employee-directory-error');
  const body=document.querySelector('#dle-employee-directory-table tbody');
  const words=value=>String(value||'').toLowerCase().replace(/(^|_)([a-z])/g,(_,space,letter)=>(space?' ':'')+letter.toUpperCase());
  const cell=(row,value,className)=>{const td=document.createElement('td');td.textContent=value??'—';if(className)td.className=className;row.appendChild(td)};
  async function load(){
    error.hidden=true;summary.textContent='Loading…';body.replaceChildren();
    try{
      const response=await fetch('/api/development/employees/v1/directory?includeHistorical='+historical.checked,
        {credentials:'same-origin',headers:{Accept:'application/json'}});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result?.message||result?.code||'Employee Directory unavailable.');
      result.items.forEach(item=>{
        const row=document.createElement('tr');row.dataset.status=item.dleWorkforceStatus;
        cell(row,item.employeeNumber);cell(row,item.displayName);cell(row,item.departmentName);cell(row,item.jobTitle);
        cell(row,words(item.dleWorkforceStatus));cell(row,item.trainingEligible?'Yes':'No',item.trainingEligible?'dle-dir-yes':'dle-dir-no');
        cell(row,words(item.provisioningStatus));cell(row,item.proposedUserName);
        cell(row,item.dleOsUserDisplayName||item.dleOsUserName);
        body.appendChild(row);
      });
      summary.textContent=`${result.totalEmployees} employees · ${result.currentEmployees} current · ${result.linkedUsers} linked · ${result.unprovisionedEmployees} unprovisioned`;
    }catch(failure){error.textContent=failure.message;error.hidden=false;summary.textContent='Unavailable';}
  }
  document.addEventListener('dle:capabilities-ready',event=>{if(event.detail?.isSuperAdmin)open.hidden=false});
  open.addEventListener('click',()=>{dialog.hidden=false;load()});close.addEventListener('click',()=>{dialog.hidden=true});
  historical.addEventListener('change',load);dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.hidden=true});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.hidden)dialog.hidden=true});
})();
</script>
""";
}
