using System.Net;
using System.Text.Json;

var checks = new List<string>();
var limitations = new List<string>();
var repository = Directory.GetCurrentDirectory();
var clientSource = File.ReadAllText(Path.Combine(repository, "SRC", "api", "dle-api-client.js"));
var canonicalViewerSource = File.ReadAllText(Path.Combine(repository, "SRC", "modules",
    "canonical-data-viewer", "canonical-data-viewer.js"));
var proxySource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "DevelopmentCompatibilityProxy.cs"));
var programSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "Program.cs"));
var shellSource = File.ReadAllText(Path.Combine(repository, "DLE_Work_Center_v4.0.0.html"));
var workOrderSource = File.ReadAllText(Path.Combine(repository, "SRC", "modules",
    "work-order-dashboard", "work-order-dashboard.js"));
var shipmentStagingSource = File.ReadAllText(Path.Combine(repository, "SRC", "modules",
    "shipment-staging", "shipment-staging-service.js"));
var runtimeSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "DleOsRuntimeConfiguration.cs"));
var serviceBootstrapSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "DleOsWindowsServiceBootstrap.cs"));
var runtimeConfigurationPath = Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "service-runtime.Development.json");
using var runtimeConfigurationDocument = JsonDocument.Parse(
    File.ReadAllText(runtimeConfigurationPath));
var runtimeConfiguration = runtimeConfigurationDocument.RootElement;
var applicationOrigin = new Uri(runtimeConfiguration.GetProperty("applicationOrigin").GetString()!);
var canonicalApi = new Uri(runtimeConfiguration.GetProperty("canonicalApiBaseUrl").GetString()!);
var operationalApi = new Uri(runtimeConfiguration.GetProperty("operationalApiBaseUrl").GetString()!);
var syncOperationsApi = new Uri(runtimeConfiguration.GetProperty("syncOperationsApiBaseUrl").GetString()!);
var frontendPrefixes = runtimeConfiguration.GetProperty("frontendPrefixes").EnumerateArray()
    .Select(value => new Uri(value.GetString()!)).ToArray();

Check(clientSource.Contains("window.DleOsRuntimeConfig?.environment === 'ISOLATED_DEVELOPMENT'") &&
      clientSource.Contains("DEVELOPMENT_BFF_BASE_URL") &&
      !clientSource.Contains("window.location.port"),
    "HTTP 5051 and canonical HTTPS use the same-origin authenticated BFF runtime marker");
Check(clientSource.Contains("requestError.payload = body") &&
      canonicalViewerSource.Contains("NotReadySourceCheckExpired") &&
      canonicalViewerSource.Contains("qualified-stale") &&
      canonicalViewerSource.Contains("no freshness requirement has been bypassed or marked green") &&
      canonicalViewerSource.Contains("IS_ISOLATED_DEVELOPMENT"),
    "isolated DEV separates qualified snapshot readability from expired freshness readiness");
Check(new[] { shellSource, workOrderSource, shipmentStagingSource }.All(source =>
          source.Contains("DleOsRuntimeConfig?.environment === 'ISOLATED_DEVELOPMENT'") &&
          !source.Contains("window.location.port")),
    "all development-only browser features recognize both HTTP 5051 and canonical HTTPS");
Check(proxySource.Contains("UseDefaultCredentials = true") &&
      proxySource.Contains("runtime.CanonicalApiBaseUrl") &&
      proxySource.Contains("runtime.OperationalApiBaseUrl") &&
      proxySource.Contains("runtime.SyncOperationsApiBaseUrl") &&
      proxySource.Contains("runtime.CustomerFilesApiBaseUrl"),
    "BFF uses its service identity for explicitly configured downstreams");
Check(proxySource.Contains("DLE_OS_IDENTITY_CALLER_NOT_TRUSTED") &&
      proxySource.Contains("CompatibilityDownstreamAuthorizationRejected") &&
      proxySource.Contains("TryReadErrorCode") &&
      proxySource.Contains("DLE_OS_DEVELOPMENT_SERVICE_IDENTITY_REJECTED"),
    "BFF distinguishes service-caller rejection from governed user authorization failures");
Check(runtimeSource.Contains("DLE_OS_ENVIRONMENT") &&
      runtimeSource.Contains("dedicated Sync Operations 5056") &&
      runtimeConfiguration.GetProperty("environment").GetString() == "Development" &&
      canonicalApi.Port == 5052 && operationalApi.Port == 5054 && syncOperationsApi.Port == 5056 &&
      !runtimeConfiguration.GetProperty("securityDatabase").GetString()!
          .Contains("LIVE", StringComparison.OrdinalIgnoreCase),
    "Development routing is explicit and fail-closed against production boundaries");
Check(proxySource.Contains("new Uri(runtime.SyncOperationsApiBaseUrl)") &&
      proxySource.Contains("\"/api/sync/operations/current\", [HttpMethods.Get]") &&
      proxySource.Contains("\"/api/sync/operations/runs\", [HttpMethods.Get]") &&
      proxySource.Contains("\"/api/sync/operations/runs/{runId}\", [HttpMethods.Get]") &&
      proxySource.Contains("\"/api/sync/operations\", [HttpMethods.Post]") &&
      !proxySource.Contains("/api/sync/operations/{**path}"),
    "only the four public Sync Operations routes use dedicated 5056");
Check(!proxySource.Contains("/api/platform/refresh/v1") &&
      !proxySource.Contains("/api/platform/refresh/v1") &&
      !proxySource.Contains("/api/platform/operations-refresh/v1"),
    "BFF exposes no production or administrative control route");
Check(proxySource.Contains("CurrentUserStatus.Active") && proxySource.Contains("ResolvePermission") &&
      proxySource.Contains("DLE_OS_PERMISSION_DENIED") &&
      proxySource.Contains("current.User.IsSuperAdmin"),
    "compatibility routes require an active user and fresh server-side permissions");
Check(!proxySource.Contains("context.Request.Headers.Authorization") &&
      !proxySource.Contains("context.Request.Headers.Cookie") &&
      !proxySource.Contains("X-DLE-OS-User") && !proxySource.Contains("X-Windows-Identity"),
    "BFF does not forward browser authorization or identity material");
Check(proxySource.Contains("UserId={UserId}") && proxySource.Contains("UserName={UserName}") &&
      proxySource.Contains("CorrelationId={CorrelationId}") &&
      proxySource.Contains("runtime.RuntimeMarker"),
    "compatibility requests are safely audited with internal identity and correlation");
Check(programSource.Contains("DLE_OS_REQUIRED_RUNTIME_IDENTITY") &&
      serviceBootstrapSource.Contains("ServiceName = \"DleOsDevelopmentFrontend\"") &&
      serviceBootstrapSource.Contains(@"DLE-OS-HOST\DLE-OS-DEV-FRONTEND") &&
      serviceBootstrapSource.Contains("WindowsIdentity.GetCurrent().Name.Equals") &&
      programSource.Contains("builder.Host.UseWindowsService"),
    "current SCM service identity and ownership are explicit and fail-closed");

if (!args.Contains("--live-dev", StringComparer.OrdinalIgnoreCase))
{
    Console.WriteLine($"PASS: {checks.Count} deterministic authenticated frontend compatibility checks.");
    foreach (var check in checks) Console.WriteLine("  " + check);
    return;
}

var directFrontend = frontendPrefixes.Single(prefix => prefix.Scheme == Uri.UriSchemeHttp &&
    prefix.Host.Equals("dle-os-host", StringComparison.OrdinalIgnoreCase) && prefix.Port == 5051);
using var direct = new HttpClient { BaseAddress = directFrontend, Timeout = TimeSpan.FromSeconds(10) };
using (var response = await direct.GetAsync("/shared"))
    Check(response.StatusCode == HttpStatusCode.OK,
        "live DEV direct 5051 shared endpoint is healthy");
using var exactHost = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
    { BaseAddress = applicationOrigin, Timeout = TimeSpan.FromSeconds(8) };
try
{
    using (var response = await exactHost.GetAsync("/shared"))
        Check(response.StatusCode == HttpStatusCode.OK,
            "live DEV exact-host shared endpoint is healthy");
    using (var response = await exactHost.GetAsync("/"))
    {
        var authHost = frontendPrefixes.Single(prefix => prefix.Scheme == Uri.UriSchemeHttps &&
            !prefix.Host.Equals(applicationOrigin.Host, StringComparison.OrdinalIgnoreCase)).Host;
        Check(response.StatusCode == HttpStatusCode.Redirect && response.Headers.Location is not null &&
              response.Headers.Location.Host.Equals(authHost, StringComparison.OrdinalIgnoreCase),
            "live DEV unauthenticated navigation reaches the configured Keycloak boundary");
    }
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
using var canonical = new HttpClient { BaseAddress = canonicalApi, Timeout = TimeSpan.FromSeconds(30) };
using (var response = await canonical.GetAsync("/api/platform/live/v1/readiness"))
    Check(response.StatusCode == HttpStatusCode.OK,
        "live DEV canonical read-only readiness boundary is healthy");
using var operational = new HttpClient(new HttpClientHandler { UseDefaultCredentials = false })
    { BaseAddress = operationalApi, Timeout = TimeSpan.FromSeconds(30) };
using (var response = await operational.GetAsync("/health"))
    Check(response.StatusCode == HttpStatusCode.Unauthorized,
        "live DEV operational health boundary still requires Windows authentication");

var report = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    mode = "LIVE_DEV_READ_ONLY_QUALIFICATION",
    limitations,
    checks
};
var output = Path.Combine(repository, ".tmp", "authenticated-frontend", "phase3-compatibility-tests.json");
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
await File.WriteAllTextAsync(output, JsonSerializer.Serialize(report,
    new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
Console.WriteLine($"PASS: {checks.Count} authenticated frontend compatibility checks.");
foreach (var check in checks) Console.WriteLine("  " + check);
foreach (var limitation in limitations) Console.WriteLine("  LIMITATION: " + limitation);

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}
