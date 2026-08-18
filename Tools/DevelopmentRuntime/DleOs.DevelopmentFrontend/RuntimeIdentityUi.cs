public static class RuntimeIdentityUi
{
    public static string Inject(string html, DevRuntimeBuildInfo build)
    {
        build.Validate();
        const string headEnd = "</head>";
        const string bodyEnd = "</body>";
        var headIndex = html.LastIndexOf(headEnd, StringComparison.OrdinalIgnoreCase);
        var bodyIndex = html.LastIndexOf(bodyEnd, StringComparison.OrdinalIgnoreCase);
        if (headIndex < 0 || bodyIndex < 0)
            throw new InvalidOperationException("The development frontend document shell is incomplete.");

        Func<string, string> encode = System.Net.WebUtility.HtmlEncode;
        var dirtyLabel = build.SourceDirty ? "dirty source" : "clean source";
        var title = encode(
            $"DEV release {build.ReleaseId}; Git {build.GitHead}; {dirtyLabel}; " +
            $"source SHA-256 {build.SourceDigestSha256.ToUpperInvariant()}");
        var badge = $$"""
<span id="dle-dev-build" hidden
      data-release-id="{{encode(build.ReleaseId)}}"
      data-git-head="{{encode(build.GitHead)}}"
      data-source-dirty="{{build.SourceDirty.ToString().ToLowerInvariant()}}"
      data-source-digest="{{encode(build.SourceDigestSha256.ToUpperInvariant())}}"
      title="{{title}}" aria-label="DEV release {{encode(build.ReleaseId)}}">
  DEV <span aria-hidden="true">•</span> {{encode(build.ReleaseId)}}
</span>
<script id="dle-dev-build-script">
(() => {
  const badge=document.getElementById('dle-dev-build');
  const controls=document.getElementById('dleDevBuildDetails');
  if(!badge||!controls)return;
  controls.append(badge);
  badge.hidden=false;
})();
</script>
""";
        const string style = """
<style id="dle-dev-build-style">
  #dle-dev-build{position:static;display:inline-flex;flex:0 0 auto;white-space:nowrap;padding:4px 7px;border:1px solid rgba(148,163,184,.24);
    border-radius:999px;color:rgba(219,234,254,.72);background:rgba(15,23,42,.28);font:600 10px/1.1 system-ui,sans-serif;
    letter-spacing:.035em;cursor:help}
  @media(max-width:760px){#dle-dev-build{font-size:9px;padding:4px 6px}}
</style>
""";
        html = html.Insert(headIndex, style);
        bodyIndex = html.LastIndexOf(bodyEnd, StringComparison.OrdinalIgnoreCase);
        return html.Insert(bodyIndex, badge);
    }
}
