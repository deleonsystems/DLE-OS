using System.Net;
using System.Text.Json;

var checks = new List<string>();
var repository = Directory.GetCurrentDirectory();
var programSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "Program.cs"));
var settingsSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "appsettings.json"));
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
Check(programSource.Contains("http://dle-os-host:5051") &&
      programSource.Contains("http://192.168.0.105:5051") &&
      settingsSource.Contains("DLE-OS-HOST;localhost;127.0.0.1;192.168.0.105"),
    "qualified hostname and temporary Phase 6.1A IP access remain configured");

Check(authenticatedShell.Contains("dle-auth-name") && authenticatedShell.Contains("dle-auth-role") &&
      authenticatedShell.Contains("Sign Out") && !authenticatedShell.Contains("Miguel"),
    "authenticated user area remains driven by the existing current-user identity model");
Check(authenticatedShell.Contains("sessionStorage.clear()") &&
      authenticatedShell.Contains("key.startsWith('DLE_OS_')") &&
      authenticatedShell.Contains("caches.delete") &&
      authenticatedShell.Contains("indexedDB.deleteDatabase") &&
      authenticatedShell.Contains("form.action='/auth/logout'") &&
      authenticatedShell.Contains("__RequestVerificationToken") &&
      authenticatedShell.Contains("test-csrf-token") &&
      authenticatedShell.Contains("form.submit()"),
    "governed sign-out clears browser caches and posts an antiforgery-protected server logout");

if (args.Contains("--live", StringComparer.OrdinalIgnoreCase))
    await RunLiveQualification();

var evidence = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    live = args.Contains("--live", StringComparer.OrdinalIgnoreCase),
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

async Task RunLiveQualification()
{
    using var anonymous = new HttpClient(new HttpClientHandler { UseDefaultCredentials = false })
    {
        BaseAddress = new Uri("http://192.168.0.105:5051"),
        Timeout = TimeSpan.FromSeconds(30)
    };
    using var authenticated = new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
    {
        BaseAddress = anonymous.BaseAddress,
        Timeout = anonymous.Timeout
    };

    using (var response = await anonymous.GetAsync("/shared"))
    {
        var body = await response.Content.ReadAsStringAsync();
        Check(response.StatusCode == HttpStatusCode.OK && body.Contains("Sign in to DLE-OS") &&
              !response.Headers.WwwAuthenticate.Any(),
            "live anonymous /shared returns the branded page without a native challenge");
        Check(response.Headers.CacheControl?.NoStore == true &&
              response.Headers.TryGetValues("Content-Security-Policy", out var policies) &&
              policies.Single().Contains("frame-ancestors 'none'"),
            "live shared entry is no-store and carries its defensive browser policy");
    }

    using (var response = await anonymous.GetAsync("/"))
        Check(response.StatusCode == HttpStatusCode.Unauthorized && response.Headers.WwwAuthenticate.Any(),
            "live anonymous application navigation triggers the Windows authentication challenge");
    using (var response = await anonymous.GetAsync("/api/auth/me"))
        Check(response.StatusCode == HttpStatusCode.Unauthorized,
            "live current-user API remains protected from anonymous callers");
    using (var response = await anonymous.GetAsync("/api/platform/live/v1/sales-orders?page=1&pageSize=1"))
        Check(response.StatusCode == HttpStatusCode.Unauthorized,
            "live compatibility APIs remain protected from anonymous callers");

    using (var response = await authenticated.GetAsync("/"))
    {
        var body = await response.Content.ReadAsStringAsync();
        Check(response.StatusCode == HttpStatusCode.OK && body.Contains("dle-auth-signout") &&
              body.Contains("/api/auth/me"),
            "live authenticated shell includes current-user resolution and Sign Out");
    }
    using (var response = await authenticated.GetAsync("/api/auth/me"))
    {
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Check(response.StatusCode == HttpStatusCode.OK &&
              body.GetProperty("user").GetProperty("displayName").GetString() == "Miguel De Leon" &&
              body.GetProperty("isSuperAdmin").GetBoolean() &&
              body.GetProperty("roles").EnumerateArray().Any(role => role.GetString() == "SUPER_ADMIN"),
            "live Windows identity still resolves Miguel De Leon as SUPER_ADMIN");
    }
}

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}
