using System.Text;

public static class DevelopmentIdentityUi
{
    public static string Inject(string html, string? embeddedIdentityJson = null)
    {
        var bodyStart = html.IndexOf("<body", StringComparison.OrdinalIgnoreCase);
        if (bodyStart < 0) throw new InvalidOperationException("The development frontend document body is absent.");
        var bodyStartEnd = html.IndexOf('>', bodyStart);
        if (bodyStartEnd < 0) throw new InvalidOperationException("The development frontend document body is incomplete.");

        var embeddedIdentity = string.IsNullOrWhiteSpace(embeddedIdentityJson)
            ? "null"
            : "JSON.parse(atob('" + Convert.ToBase64String(Encoding.UTF8.GetBytes(embeddedIdentityJson)) + "'))";
        return html.Insert(bodyStartEnd + 1,
            Markup.Replace("__DLE_EMBEDDED_IDENTITY__", embeddedIdentity, StringComparison.Ordinal));
    }

    public static string AccessStateDocument(string code) => code switch
    {
        "DLE_OS_USER_NOT_PROVISIONED" => Document("DLE-OS access is not provisioned for this Windows account."),
        "DLE_OS_AUTHENTICATION_PENDING" => Document("This DLE-OS account is awaiting an external sign-in identity."),
        "DLE_OS_USER_DISABLED" => Document("This DLE-OS account is disabled."),
        "DLE_OS_SECURITY_UNAVAILABLE" => Document("DLE-OS identity resolution is temporarily unavailable."),
        _ => Document("Windows authentication is required.")
    };

    private static string Document(string message) =>
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>DLE-OS Access</title></head>" +
        "<body><main><h1>DLE-OS</h1><p>" + System.Net.WebUtility.HtmlEncode(message) +
        "</p></main></body></html>";

    private const string Markup = """
<style id="dle-authorization-bootstrap-style">
  html[data-dle-bootstrap-state="resolving"] body>:not(#dle-authorization-bootstrap):not(script):not(style),
  html[data-dle-bootstrap-state="restoring"] body>:not(#dle-authorization-bootstrap):not(script):not(style){display:none!important}
  #dle-authorization-bootstrap{min-height:100vh;box-sizing:border-box;display:grid;place-items:center;padding:24px;
    background:#07111f;color:#dcecff;font-family:system-ui,sans-serif}
  #dle-authorization-bootstrap[hidden]{display:none!important}
  #dle-authorization-bootstrap>div{display:grid;justify-items:center;gap:8px;text-align:center}
  #dle-authorization-bootstrap strong{font-size:24px;letter-spacing:.04em}
  #dle-authorization-bootstrap span{color:#a9bdd2;font-size:14px}
</style>
<script id="dle-authorization-bootstrap-script">
(() => {
  document.documentElement.dataset.dleBootstrapState='resolving';
  const startedAt=performance.now();
  let resolveAuthorization;
  window.DleOsAuthorizationReady=new Promise(resolve=>{resolveAuthorization=resolve});
  const timings={startedAt,authorizationReadyAt:null,workspaceReadyAt:null};
  window.DleOsBootstrap=Object.freeze({
    timings,
    authorizationReady(){
      if(timings.authorizationReadyAt===null)timings.authorizationReadyAt=performance.now();
      document.documentElement.dataset.dleBootstrapState='restoring';
      resolveAuthorization();
    },
    complete(){
      timings.workspaceReadyAt=performance.now();
      document.documentElement.dataset.dleBootstrapState='ready';
      const gate=document.getElementById('dle-authorization-bootstrap');
      if(gate)gate.hidden=true;
    },
    fail(message){
      document.documentElement.dataset.dleBootstrapState='error';
      const status=document.querySelector('#dle-authorization-bootstrap span');
      if(status)status.textContent=message||'Unable to load your workspace.';
    }
  });
})();
</script>
<div id="dle-authorization-bootstrap" role="status" aria-live="polite">
  <div><strong>DLE-OS</strong><span>Loading your workspace...</span></div>
</div>
<style id="dle-auth-identity-style">
  #dle-auth-identity{position:static;display:flex;gap:10px;
    align-items:center;padding:7px 12px;border:1px solid rgba(148,163,184,.35);border-radius:9px;
    background:rgba(15,23,42,.94);color:#f8fafc;font:600 12px/1.25 system-ui,sans-serif;
    box-shadow:0 4px 18px rgba(0,0,0,.25)}
  #dle-auth-name{font-size:13px} #dle-auth-role{color:#93c5fd;font-size:11px;letter-spacing:.06em}
  #dle-auth-identity[data-state="error"] #dle-auth-role{color:#fca5a5}
</style>
<aside id="dle-auth-identity" data-state="loading" aria-live="polite">
  <span id="dle-auth-name">Resolving identity...</span><span id="dle-auth-role">DLE-OS</span>
</aside>
<script id="dle-auth-identity-script">
(() => {
  const root=document.getElementById('dle-auth-identity');
  const name=document.getElementById('dle-auth-name');
  const role=document.getElementById('dle-auth-role');
  const rules=Object.freeze({
    '#workOrderApprovalApprove':'work_orders.approve',
    '#workOrderApprovalReplace':'work_orders.replace',
    '#workOrderApprovalRevoke':'work_orders.revoke',
    '#noWorkOrderApprove':'work_orders.mark_no_work_order_required',
    '#noWorkOrderReplace':'work_orders.mark_no_work_order_required',
    '#workOrderDashboardSetDisposition':'kitting.disposition',
    '#workOrderDashboardKitReleasedBom':'kitting.disposition',
    '#activeKittingTrialSubmit':'kitting.disposition',
    '#workOrderDispositionConfirm':'kitting.disposition',
    '#rmaReworkConfirmButton':'rma_rework.manage',
    '#shippingShipmentProcessedButton':'shipments.stage',
    '#reconcileShipmentStagingButton':'shipments.reconcile',
    '#confirmShipmentStagingMatchButton':'shipments.confirm',
    '#shipmentStagingReviewDialog button[onclick*="reject-match"]':'shipments.confirm',
    '#shipmentStagingReviewDialog button[onclick*="mark-exception"]':'shipments.confirm',
    '#shipmentStagingReviewDialog button[onclick*="cancel"]':'shipments.cancel',
    '#syncOperationsButton':'sync.operations'
  });
  const workspaceRules=Object.freeze({'dle-home':null,kitting:'kitting.view',production:'kitting.view',purchasing:'kitting.view','operations-center':'sync.operations'});
  function announceCapabilities(capabilities){
    capabilities.apply();
    document.dispatchEvent(new CustomEvent('dle:capabilities-ready',{detail:capabilities}));
  }
  function installCapabilities(body){
    const granted=new Set(Array.isArray(body.permissions)?body.permissions:[]);
    const capabilities=Object.freeze({
      isSuperAdmin:body.isSuperAdmin===true,
      permissions:Object.freeze(Array.from(granted).sort()),
      can(code){return this.isSuperAdmin||granted.has(String(code||''));},
      kittingWorkspaceAvailable:body.isSuperAdmin===true||granted.has('kitting.view'),
      pickListReadAvailable:body.isSuperAdmin===true||granted.has('pick_list.view'),
      apply(){
        Object.entries(rules).forEach(([selector,permission])=>{
          document.querySelectorAll(selector).forEach(control=>{
            const allowed=this.can(permission);
            control.dataset.dleRequiredPermission=permission;
            control.dataset.dlePermissionAllowed=String(allowed);
            if(!allowed){
              control.disabled=true;
              control.hidden=true;
              control.setAttribute('aria-disabled','true');
              control.title='Unavailable: requires '+permission;
            }
          });
        });
        const selector=document.getElementById('workspaceViewSelect');
        if(selector){
          Array.from(selector.options).forEach(option=>{
            const permission=workspaceRules[option.value];
            const allowed=option.value==='dle-home'||this.isSuperAdmin||(permission&&this.can(permission));
            option.disabled=!allowed;option.hidden=!allowed;
            option.dataset.dleRequiredPermission=permission||'SUPER_ADMIN';
          });
          if(selector.selectedOptions[0]?.disabled){
            selector.value='dle-home';
            if(typeof window.setWorkspaceView==='function')window.setWorkspaceView('dle-home');
          }
        }
      }
    });
    window.DleOsSession=Object.freeze(body);
    window.DleOsCapabilities=capabilities;
    announceCapabilities(capabilities);
    new MutationObserver(()=>capabilities.apply()).observe(document.body,{childList:true,subtree:true});
    document.addEventListener('DOMContentLoaded',()=>announceCapabilities(capabilities),{once:true});
    window.DleOsBootstrap.authorizationReady();
  }
  function showIdentity(body){
    name.textContent=body.user.displayName;
    role.textContent=body.isSuperAdmin?'SUPER_ADMIN':(body.roles[0] || 'DLE-OS USER');
    installCapabilities(body);
    root.dataset.state='ready';
  }
  function fail(error){
    const messages={DLE_OS_USER_NOT_PROVISIONED:'Access not provisioned',
      DLE_OS_AUTHENTICATION_PENDING:'Sign-in identity pending',
      DLE_OS_USER_DISABLED:'Account disabled',WINDOWS_AUTHENTICATION_REQUIRED:'Sign-in required'};
    const message=messages[error.message] || 'Security service unavailable';
    name.textContent=message;role.textContent='DLE-OS';root.dataset.state='error';
    window.DleOsBootstrap.fail(message);
  }
  const embeddedIdentity=__DLE_EMBEDDED_IDENTITY__;
  if(embeddedIdentity){
    showIdentity(embeddedIdentity);
    return;
  }
  fetch('/api/auth/me',{credentials:'same-origin',headers:{Accept:'application/json'}})
    .then(async response => {
      const body=await response.json().catch(() => ({}));
      if(!response.ok) throw new Error(body?.error?.code || 'DLE_OS_SECURITY_UNAVAILABLE');
      showIdentity(body);
    })
    .catch(fail);
})();
</script>
""";
}
