using Microsoft.AspNetCore.Http;

public static class SharedDeviceWelcomeUi
{
    private const string LogoMarker = "<img class=\"logo\" src=\"";
    private const string LogoToken = "__DLE_GOVERNED_LOGO__";

    public static string ExtractAuthenticatedHeaderLogo(string authenticatedShell)
    {
        var start = authenticatedShell.IndexOf(LogoMarker, StringComparison.Ordinal);
        if (start < 0)
            throw new InvalidOperationException("The authenticated DLE-OS header logo is absent.");
        start += LogoMarker.Length;
        var end = authenticatedShell.IndexOf('"', start);
        if (end < 0)
            throw new InvalidOperationException("The authenticated DLE-OS header logo is malformed.");
        var dataUri = authenticatedShell[start..end];
        if (!dataUri.StartsWith("data:image/jpeg;base64,", StringComparison.Ordinal) ||
            dataUri.Any(char.IsWhiteSpace))
            throw new InvalidOperationException("The authenticated DLE-OS header logo is not the governed JPEG asset.");
        return dataUri;
    }

    public static string Render(string governedLogoDataUri) =>
        Template.Replace(LogoToken, governedLogoDataUri, StringComparison.Ordinal);

    public static void ApplySecurityHeaders(HttpResponse response)
    {
        response.Headers["Content-Security-Policy"] =
            "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; " +
            "form-action 'self'; frame-ancestors 'none'";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["X-Frame-Options"] = "DENY";
        response.Headers["Referrer-Policy"] = "no-referrer";
    }

    private const string Template = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#07111f">
  <title>DLE-OS | De Leon Enterprises</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      color:#eaf2ff;background:#07111f;font-synthesis:none}
    *{box-sizing:border-box}
    body{min-height:100svh;margin:0;display:grid;place-items:center;overflow-x:hidden;
      background:
        linear-gradient(rgba(21,48,78,.2) 1px,transparent 1px),
        linear-gradient(90deg,rgba(21,48,78,.2) 1px,transparent 1px),
        radial-gradient(circle at 16% 18%,rgba(20,113,184,.23),transparent 34rem),
        linear-gradient(145deg,#07111f 0%,#0a1a2c 58%,#07111f 100%);
      background-size:42px 42px,42px 42px,auto,auto}
    body::before{content:"";position:fixed;inset:0;pointer-events:none;
      background:linear-gradient(110deg,transparent 0 64%,rgba(77,169,235,.05) 64% 65%,transparent 65%)}
    main{position:relative;width:min(92vw,1040px);min-height:min(72svh,620px);display:grid;
      grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);align-items:stretch;
      border:1px solid rgba(130,180,220,.24);border-radius:24px;overflow:hidden;
      background:rgba(7,17,31,.88);box-shadow:0 28px 90px rgba(0,0,0,.46);backdrop-filter:blur(18px)}
    .brand{padding:clamp(42px,7vw,82px);display:flex;flex-direction:column;justify-content:space-between;
      border-right:1px solid rgba(130,180,220,.16)}
    .logo-asset{display:block;width:clamp(164px,20vw,220px);height:auto;max-height:92px;
      object-fit:contain;object-position:left center}
    .eyebrow{margin:48px 0 14px;color:#66b9ed;font-size:12px;font-weight:750;letter-spacing:.18em;text-transform:uppercase}
    h1{margin:0;font-size:clamp(52px,8vw,92px);line-height:.92;letter-spacing:-.055em}
    .company{margin:20px 0 8px;color:#f5f9ff;font-size:clamp(18px,2.2vw,25px);font-weight:650}
    .system{margin:0;color:#9db3c9;font-size:clamp(15px,1.6vw,19px);letter-spacing:.035em}
    .status{display:flex;align-items:center;gap:9px;margin-top:50px;color:#89a3bb;font-size:13px}
    .status::before{content:"";width:8px;height:8px;border-radius:50%;background:#50c78b;
      box-shadow:0 0 0 5px rgba(80,199,139,.09)}
    .entry{padding:clamp(38px,5.5vw,72px);display:flex;flex-direction:column;justify-content:center;
      background:linear-gradient(160deg,rgba(18,44,70,.55),rgba(5,15,27,.2))}
    .entry h2{margin:0 0 12px;font-size:clamp(27px,3.5vw,38px);letter-spacing:-.035em}
    .entry p{margin:0 0 32px;color:#9eb3c8;font-size:15px;line-height:1.6}
    .signin{min-height:62px;display:flex;align-items:center;justify-content:center;padding:16px 24px;
      border:1px solid #57afe6;border-radius:14px;background:linear-gradient(180deg,#2185c4,#176da7);
      color:white;text-decoration:none;font-size:17px;font-weight:750;letter-spacing:.01em;
      box-shadow:0 14px 32px rgba(14,103,161,.28);touch-action:manipulation;transition:.16s ease}
    .signin:hover{background:linear-gradient(180deg,#2a95d8,#1978b8);transform:translateY(-1px)}
    .signin:focus-visible{outline:3px solid #a8ddff;outline-offset:4px}
    .authorized{margin-top:22px;color:#718aa1;font-size:12px;letter-spacing:.08em;text-align:center;text-transform:uppercase}
    .temporary{margin-top:30px;padding-top:22px;border-top:1px solid rgba(130,180,220,.14);
      color:#7890a7;font-size:12px;line-height:1.55}
    @media (max-width:720px),(orientation:portrait) and (max-width:900px){
      body{place-items:start center;padding:clamp(18px,5vw,42px) 0;overflow-y:auto}
      main{width:min(92vw,620px);min-height:0;grid-template-columns:1fr}
      .brand{min-height:47svh;padding:clamp(34px,8vw,58px);border-right:0;border-bottom:1px solid rgba(130,180,220,.16)}
      .eyebrow{margin-top:34px}.status{margin-top:38px}.entry{padding:clamp(34px,8vw,58px)}
    }
    @media (max-width:430px){main{border-radius:18px}.brand,.entry{padding:30px}.logo-asset{width:min(54vw,190px)}}
    @media (prefers-reduced-motion:reduce){.signin{transition:none}}
  </style>
</head>
<body>
  <main aria-labelledby="welcome-title">
    <section class="brand">
      <div>
        <img class="logo-asset" src="__DLE_GOVERNED_LOGO__" alt="De Leon Enterprises">
        <p class="eyebrow">Manufacturing operations</p>
        <h1 id="welcome-title">DLE-OS</h1>
        <p class="company">De Leon Enterprises</p>
        <p class="system">Manufacturing Operating System</p>
      </div>
      <div class="status">Secure company access</div>
    </section>
    <section class="entry" aria-label="Sign in">
      <h2>Welcome</h2>
      <p>Sign in with your authorized company identity to continue to the operating system.</p>
      <a class="signin" href="/auth/signin">Sign in to DLE-OS</a>
      <div class="authorized">Authorized personnel only</div>
      <div class="temporary">Shared-device access is protected by the current company authentication service.</div>
    </section>
  </main>
</body>
</html>
""";
}
