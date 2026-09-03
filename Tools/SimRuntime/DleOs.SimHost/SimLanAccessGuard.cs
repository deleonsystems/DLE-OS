using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;

internal sealed class SimLanAccessGuard
{
    private const string CookieName = "__Host-DLEOS-SIM-LAN";
    private readonly byte[] accessCodeHash;
    private readonly string sessionToken;

    internal SimLanAccessGuard(string accessCode)
    {
        accessCodeHash = SHA256.HashData(Encoding.UTF8.GetBytes(accessCode));
        sessionToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    }

    internal async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        if (context.Request.Cookies.TryGetValue(CookieName, out var cookie) &&
            FixedTimeEquals(cookie, sessionToken))
        {
            await next(context);
            return;
        }

        string? suppliedCode = null;
        if (HttpMethods.IsPost(context.Request.Method) &&
            context.Request.Path.Equals("/sim-access", StringComparison.Ordinal) &&
            context.Request.HasFormContentType)
        {
            var form = await context.Request.ReadFormAsync();
            suppliedCode = form["sim_access"].ToString();
        }
        if (!string.IsNullOrEmpty(suppliedCode) && FixedTimeEqualsHash(suppliedCode))
        {
            context.Response.Cookies.Append(CookieName, sessionToken, new CookieOptions
            {
                HttpOnly = true,
                Secure = true,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                IsEssential = true
            });
            context.Response.Redirect(context.Request.PathBase + "/");
            return;
        }

        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        if (!HttpMethods.IsGet(context.Request.Method) ||
            !context.Request.Headers.Accept.Any(value => value?.Contains("text/html", StringComparison.OrdinalIgnoreCase) == true))
        {
            await context.Response.WriteAsJsonAsync(new
            {
                code = "DLE_OS_SIM_LAN_ACCESS_REQUIRED",
                message = "A valid LAN-mode SIM session is required."
            });
            return;
        }

        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.WriteAsync(RenderAccessPage(context.Request.PathBase + "/sim-access"));
    }

    private bool FixedTimeEqualsHash(string suppliedCode)
    {
        var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(suppliedCode));
        return CryptographicOperations.FixedTimeEquals(accessCodeHash, suppliedHash);
    }

    private static bool FixedTimeEquals(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length &&
            CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    private static string RenderAccessPage(string actionPath)
    {
        var path = HtmlEncoder.Default.Encode(actionPath);
        return $$"""
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DLE-OS SIM LAN access</title>
<style>body{margin:0;background:#08111f;color:#e5eef8;font:16px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}main{width:min(90vw,28rem);padding:1.5rem;border:1px solid #31506f;border-radius:12px;background:#101d2d}label,input,button{display:block;width:100%;box-sizing:border-box}input,button{margin-top:.5rem;padding:.75rem;border-radius:8px}button{background:#0f766e;color:white;border:0;font-weight:700}</style>
</head><body><main><h1>DLE-OS SIM</h1><p>LAN MODE · SYNTHETIC DATA</p>
<form method="post" action="{{path}}"><label for="sim_access">SIM Access Code</label>
<input id="sim_access" name="sim_access" type="password" inputmode="text" autocomplete="off" required minlength="5" maxlength="64">
<button type="submit">Open local SIM</button></form></main></body></html>
""";
    }
}
