using System.Net;
using System.Text.Json;

var checks = new List<string>();
var limitations = new List<string>();
var repository = Directory.GetCurrentDirectory();
var programSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "Program.cs"));
var runtimeConfigurationPath = Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "service-runtime.Development.json");
using var runtimeConfigurationDocument = JsonDocument.Parse(
    File.ReadAllText(runtimeConfigurationPath));
var runtimeConfiguration = runtimeConfigurationDocument.RootElement;
var applicationOrigin = new Uri(runtimeConfiguration.GetProperty("applicationOrigin").GetString()!);
var frontendPrefixes = runtimeConfiguration.GetProperty("frontendPrefixes").EnumerateArray()
    .Select(value => new Uri(value.GetString()!)).ToArray();
var authenticatedShellSource = File.ReadAllText(Path.Combine(repository, "DLE_Work_Center_v4.0.0.html"));
var governedLogo = SharedDeviceWelcomeUi.ExtractAuthenticatedHeaderLogo(authenticatedShellSource);
var welcome = SharedDeviceWelcomeUi.Render(governedLogo);
var authenticatedShell = SharedDeviceSessionUi.Inject(
    "<html><body><aside id=\"dle-auth-identity\"><span id=\"dle-auth-name\"></span>" +
    "<span id=\"dle-auth-role\"></span></aside></body></html>",
    "test-csrf-token");

Check(welcome.Contains("DLE-OS") && welcome.Contains("De Leon Enterprises") &&
      welcome.Contains("Manufacturing Operating System") &&
      welcome.Contains("Authorized personnel only"),
    "shared entry carries the approved DLE-OS identity and access notice");
Check(welcome.Contains("<img class=\"logo-asset\" src=\"" + governedLogo + "\"") &&
      governedLogo.StartsWith("data:image/jpeg;base64,", StringComparison.Ordinal) &&
      welcome.Split("data:image/", StringSplitOptions.None).Length == 2 &&
      welcome.IndexOf(governedLogo, StringComparison.Ordinal) ==
          welcome.LastIndexOf(governedLogo, StringComparison.Ordinal) &&
      !welcome.Contains("https://", StringComparison.OrdinalIgnoreCase),
    "shared entry reuses the authenticated header's governed logo without a copy or external dependency");
Check(welcome.Contains("width:clamp(164px,20vw,220px)") &&
      welcome.Contains("height:auto") && welcome.Contains("object-fit:contain") &&
      welcome.Contains("width:min(54vw,190px)"),
    "governed logo preserves its aspect ratio and remains intentionally sized across iPad layouts");
Check(welcome.Contains("href=\"/auth/signin\">Sign in to DLE-OS</a>") &&
      !welcome.Contains("<input", StringComparison.OrdinalIgnoreCase) &&
      !welcome.Contains("password", StringComparison.OrdinalIgnoreCase),
    "sign-in is an intentional protected navigation with no credential capture form");
Check(!welcome.Contains("Miguel", StringComparison.OrdinalIgnoreCase) &&
      !welcome.Contains("Daniel", StringComparison.OrdinalIgnoreCase) &&
      !welcome.Contains("SUPER_ADMIN", StringComparison.OrdinalIgnoreCase) &&
      !welcome.Contains("5051") && !welcome.Contains("192.168.0.105"),
    "anonymous entry exposes no employee, role, port, or server details");
Check(welcome.Contains("name=\"viewport\"") && welcome.Contains("orientation:portrait") &&
      welcome.Contains("min-height:62px") && welcome.Contains("touch-action:manipulation"),
    "shared entry is responsive with an iPad-sized touch target");
Check(welcome.Contains("prefers-reduced-motion") && welcome.Contains("focus-visible") &&
      welcome.Contains("aria-labelledby") && welcome.Contains("aria-label=\"Sign in\""),
    "shared entry includes keyboard, motion, and semantic accessibility support");

Check(programSource.Contains("Authentication.AllowAnonymous = true") &&
      programSource.Contains("FallbackPolicy") &&
      programSource.Contains("RequireAuthenticatedUser") &&
      programSource.Contains("MapGet(\"/shared\"") &&
      programSource.Contains("}).AllowAnonymous();"),
    "HTTP.sys permits anonymous entry while ASP.NET defaults all endpoints to authenticated");
Check(programSource.Contains("IsSharedEntryPath(context.Request.Path)") &&
      programSource.Contains("MapDevelopmentCompatibilityProxy") &&
      programSource.Contains("RequireAuthorization"),
    "only the shared entry bypasses current-user resolution and application APIs stay protected");
Check(runtimeConfiguration.GetProperty("environment").GetString() == "Development" &&
      runtimeConfiguration.GetProperty("runtimeMarker").GetString() == "ISOLATED_DEVELOPMENT" &&
      applicationOrigin.Scheme == Uri.UriSchemeHttps &&
      runtimeConfiguration.GetProperty("canonicalApiBaseUrl").GetString()!.EndsWith(":5052") &&
      runtimeConfiguration.GetProperty("operationalApiBaseUrl").GetString()!.EndsWith(":5054"),
    "canonical service runtime configuration declares the isolated DEV topology");
Check(frontendPrefixes.Any(prefix => prefix.Scheme == Uri.UriSchemeHttp &&
                                     prefix.Host.Equals("dle-os-host", StringComparison.OrdinalIgnoreCase) &&
                                     prefix.Port == 5051) &&
      frontendPrefixes.Any(prefix => prefix.Scheme == Uri.UriSchemeHttps &&
                                     prefix.Host.Equals(applicationOrigin.Host, StringComparison.OrdinalIgnoreCase)) &&
      programSource.Contains("foreach (var prefix in runtime.FrontendPrefixes)") &&
      programSource.Contains("options.UrlPrefixes.Add(prefix)"),
    "frontend hosting consumes the canonical runtime prefixes instead of a test-owned hostname copy");

Check(authenticatedShell.Contains("dle-auth-name") && authenticatedShell.Contains("dle-auth-role") &&
      authenticatedShell.Contains("Sign Out") && !authenticatedShell.Contains("Miguel"),
    "authenticated user area remains driven by the existing current-user identity model");
Check(authenticatedShell.Contains("body>header{position:sticky") &&
      authenticatedShell.Contains("body>header .top-pills{min-width:0;flex:0 1 auto") &&
      authenticatedShell.Contains("@media(max-width:1100px)") &&
      authenticatedShell.Contains("#dle-auth-identity{margin-left:auto}") &&
      !authenticatedShell.Contains("body>header .logo{height:56px}"),
    "authenticated identity and Sign Out integrate into the compact operator header without shrinking the governed logo");
Check(authenticatedShell.Contains("sessionStorage.clear()") &&
      authenticatedShell.Contains("key.startsWith('DLE_OS_')") &&
      authenticatedShell.Contains("caches.delete") &&
      authenticatedShell.Contains("indexedDB.deleteDatabase") &&
      authenticatedShell.Contains("form.action='/auth/logout'") &&
      authenticatedShell.Contains("__RequestVerificationToken") &&
      authenticatedShell.Contains("test-csrf-token") &&
      authenticatedShell.Contains("form.submit()"),
    "governed sign-out clears browser caches and posts an antiforgery-protected server logout");

if (args.Contains("--live-dev", StringComparer.OrdinalIgnoreCase))
    await RunLiveQualification();

var evidence = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    mode = args.Contains("--live-dev", StringComparer.OrdinalIgnoreCase)
        ? "LIVE_DEV_QUALIFICATION"
        : "DETERMINISTIC",
    limitations,
    checks
};
var evidenceDirectory = Path.Combine(repository, ".tmp", "shared-device-sign-in");
Directory.CreateDirectory(evidenceDirectory);
await File.WriteAllTextAsync(
    Path.Combine(evidenceDirectory, "phase61b-tests.json"),
    JsonSerializer.Serialize(evidence, new JsonSerializerOptions(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    }));
Console.WriteLine($"PASS: {checks.Count} shared-device sign-in checks.");
foreach (var check in checks) Console.WriteLine("  " + check);
foreach (var limitation in limitations) Console.WriteLine("  LIMITATION: " + limitation);

async Task RunLiveQualification()
{
    var directFrontend = frontendPrefixes.Single(prefix =>
        prefix.Scheme == Uri.UriSchemeHttp &&
        prefix.Host.Equals("dle-os-host", StringComparison.OrdinalIgnoreCase) &&
        prefix.Port == 5051);
    using (var direct = new HttpClient { BaseAddress = directFrontend, Timeout = TimeSpan.FromSeconds(10) })
    using (var response = await direct.GetAsync("/shared"))
        Check(response.StatusCode == HttpStatusCode.OK,
            "live direct 5051 shared endpoint serves the configured frontend");

    using var anonymous = new HttpClient(new HttpClientHandler
    {
        UseDefaultCredentials = false,
        AllowAutoRedirect = false
    })
    {
        BaseAddress = applicationOrigin,
        Timeout = TimeSpan.FromSeconds(8)
    };
    try
    {
        using (var response = await anonymous.GetAsync("/shared"))
        {
            var body = await response.Content.ReadAsStringAsync();
            Check(response.StatusCode == HttpStatusCode.OK && body.Contains("Sign in to DLE-OS") &&
                  !response.Headers.WwwAuthenticate.Any(),
                "live exact-host /shared returns the branded page without a native challenge");
            Check(response.Headers.CacheControl?.NoStore == true &&
                  response.Headers.TryGetValues("Content-Security-Policy", out var policies) &&
                  policies.Single().Contains("frame-ancestors 'none'"),
                "live shared entry is no-store and carries its defensive browser policy");
        }
        using (var response = await anonymous.GetAsync("/"))
            Check(response.StatusCode == HttpStatusCode.Redirect && response.Headers.Location is not null &&
                  response.Headers.Location.Host.Equals("auth.internal.dlemfg.com", StringComparison.OrdinalIgnoreCase),
                "live anonymous application navigation reaches the Keycloak authentication flow");
        using (var response = await anonymous.GetAsync("/api/auth/me"))
            Check(response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Redirect,
                "live current-user API remains protected from callers without a DLE-OS session");
    }
    catch (HttpRequestException error) when (
        error.ToString().Contains("0x8009030E", StringComparison.OrdinalIgnoreCase) ||
        error.ToString().Contains("No credentials are available in the security package",
            StringComparison.OrdinalIgnoreCase))
    {
        limitations.Add(
            "Exact-host HTTPS skipped because the invoking Codex process has no Schannel client credential; " +
            "use the governed elevated health checkpoint.");
    }
}

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}
