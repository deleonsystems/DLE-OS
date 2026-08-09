public static class SharedDeviceSessionUi
{
    public static string Inject(string html, string antiforgeryToken)
    {
        const string bodyEnd = "</body>";
        var index = html.LastIndexOf(bodyEnd, StringComparison.OrdinalIgnoreCase);
        if (index < 0) throw new InvalidOperationException("The development frontend document body is absent.");
        var encodedToken = System.Net.WebUtility.HtmlEncode(antiforgeryToken);
        return html.Insert(index, Markup.Replace("__DLE_CSRF_TOKEN__", encodedToken,
            StringComparison.Ordinal));
    }

    private const string Markup = """
<style id="dle-shared-session-style">
  #dle-auth-identity{gap:12px!important;padding:8px 10px 8px 13px!important}
  #dle-auth-details{display:flex;min-width:128px;flex-direction:column;gap:2px}
  #dle-auth-name,#dle-auth-role{display:block}
  #dle-auth-signout-form{margin:0}#dle-auth-signout{min-height:34px;padding:7px 11px;border:1px solid rgba(147,197,253,.48);
    border-radius:7px;background:rgba(30,64,99,.58);color:#e8f3ff;font:700 11px/1 system-ui,sans-serif;
    letter-spacing:.025em;cursor:pointer;touch-action:manipulation}
  #dle-auth-signout:hover{background:rgba(37,99,150,.72)}
  #dle-auth-signout:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}
  #dle-auth-signout:disabled{opacity:.65;cursor:wait}
  #dle-signout-veil{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;
    background:#07111f;color:#dcecff;font:700 18px/1.4 system-ui,sans-serif}
</style>
<script id="dle-shared-session-script">
(() => {
  const root=document.getElementById('dle-auth-identity');
  const name=document.getElementById('dle-auth-name');
  const role=document.getElementById('dle-auth-role');
  if(!root||!name||!role||document.getElementById('dle-auth-signout'))return;
  const details=document.createElement('span');details.id='dle-auth-details';
  root.insertBefore(details,name);details.append(name,role);
  const form=document.createElement('form');form.id='dle-auth-signout-form';form.method='post';form.action='/auth/logout';
  const csrf=document.createElement('input');csrf.type='hidden';csrf.name='__RequestVerificationToken';csrf.value='__DLE_CSRF_TOKEN__';form.append(csrf);
  const button=document.createElement('button');button.id='dle-auth-signout';button.type='submit';
  button.textContent='Sign Out';button.setAttribute('aria-label','Sign out of DLE-OS');form.append(button);root.append(form);
  function forgetDatabase(name){
    return new Promise(resolve=>{
      try{
        const request=indexedDB.deleteDatabase(name);let finished=false;
        const done=()=>{if(!finished){finished=true;resolve();}};
        request.onsuccess=done;request.onerror=done;request.onblocked=done;setTimeout(done,500);
      }catch{resolve();}
    });
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    button.disabled=true;
    const veil=document.createElement('div');veil.id='dle-signout-veil';veil.textContent='Returning to DLE-OS sign inâ€¦';
    document.body.append(veil);
    try{sessionStorage.clear();}catch{}
    try{Object.keys(localStorage).filter(key=>key.startsWith('DLE_OS_')).forEach(key=>localStorage.removeItem(key));}catch{}
    try{window.name='';}catch{}
    try{if(window.caches){const keys=await caches.keys();await Promise.all(keys.map(key=>caches.delete(key)));}}catch{}
    try{if(window.indexedDB){await Promise.all([forgetDatabase('DLE_OS_FILE_HANDLES'),forgetDatabase('DLE_OS_SHIPMENT_STAGING_HANDLES')]);}}catch{}
    form.submit();
  });
})();
</script>
""";
}
