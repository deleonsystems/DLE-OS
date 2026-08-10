using System.Net;
using System.Text.Json;

var checks = new List<string>();
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
var startupSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "Start-DevelopmentFrontend.ps1"));
var serviceBootstrapSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "DleOsWindowsServiceBootstrap.cs"));

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
      proxySource.Contains("runtime.CustomerFilesApiBaseUrl"),
    "BFF uses its service identity for explicitly configured downstreams");
Check(runtimeSource.Contains("DLE_OS_ENVIRONMENT") &&
      runtimeSource.Contains("Development isolation requires 5052, 5054") &&
      startupSource.Contains("DLE_OS_CANONICAL_API_BASE_URL = 'http://DLE-OS-HOST:5052'") &&
      startupSource.Contains("DLE_OS_OPERATIONAL_API_BASE_URL = 'http://DLE-OS-HOST:5054'") &&
      !startupSource.Contains("DLE_OS_CANONICAL_API_BASE_URL = 'http://DLE-OS-HOST:5042'") &&
      !startupSource.Contains("DLE_OS_OPERATIONAL_API_BASE_URL = 'http://DLE-OS-HOST:5043'"),
    "Development routing is explicit and fail-closed against production boundaries");
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
      startupSource.Contains(@"DLE-OS-HOST\DLE-OS") &&
      serviceBootstrapSource.Contains(@"DLE-OS-HOST\DLE-OS") &&
      serviceBootstrapSource.Contains("WindowsIdentity.GetCurrent().Name.Equals"),
    "legacy rollback and SCM service identities are explicit and fail-closed");

if (args.Contains("--static", StringComparer.OrdinalIgnoreCase))
{
    Console.WriteLine($"PASS: {checks.Count} static authenticated frontend compatibility checks.");
    foreach (var check in checks) Console.WriteLine("  " + check);
    return;
}

using var authenticated = new HttpClient(new HttpClientHandler { UseDefaultCredentials = true })
{
    BaseAddress = new Uri("http://dle-os-host:5051"), Timeout = TimeSpan.FromSeconds(30)
};
using var anonymous = new HttpClient(new HttpClientHandler { UseDefaultCredentials = false })
{
    BaseAddress = authenticated.BaseAddress, Timeout = authenticated.Timeout
};

var me = await GetJson(authenticated, "/api/auth/me");
Check(Text(me, "user", "displayName") == "Miguel De Leon" &&
      Text(me, "user", "userName") == "Miguel" &&
      me.GetProperty("isSuperAdmin").GetBoolean(),
    "live service-hosted BFF resolves Miguel as SUPER_ADMIN");

using (var spoof = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me?user=Other"))
{
    spoof.Headers.TryAddWithoutValidation("X-DLE-OS-User", "Other");
    spoof.Headers.TryAddWithoutValidation("X-Windows-Identity", @"DLE-OS-HOST\Other");
    using var response = await authenticated.SendAsync(spoof);
    var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
    Check(response.StatusCode == HttpStatusCode.OK && Text(body, "user", "userName") == "Miguel",
        "browser headers and query parameters cannot spoof the BFF user");
}

using (var response = await anonymous.GetAsync("/api/auth/me"))
    Check(response.StatusCode == HttpStatusCode.Unauthorized,
        "anonymous compatibility access remains challenged");

var sales = await GetJson(authenticated,
    "/api/platform/live/v1/sales-orders?page=1&pageSize=2");
var salesItems = sales.GetProperty("items");
Check(salesItems.GetArrayLength() > 0, "canonical Sales Orders load through 5051");
var workOrders = await GetJson(authenticated,
    "/api/platform/live/v1/work-orders?page=1&pageSize=2");
Check(workOrders.GetProperty("items").GetArrayLength() > 0,
    "canonical Work Orders load through 5051");
using (var readinessResponse = await authenticated.GetAsync(
    "/api/platform/live/v1/readiness"))
{
    var readinessBody = JsonDocument.Parse(
        await readinessResponse.Content.ReadAsStringAsync()).RootElement;
    Check(readinessResponse.StatusCode == HttpStatusCode.ServiceUnavailable &&
          readinessBody.GetProperty("readinessState").GetString() ==
              "NotReadySourceCheckExpired",
        "DEV BFF preserves the expired freshness readiness response without weakening it");
}
var snapshot = await GetJson(authenticated, "/api/platform/live/v1/snapshot");
Check(snapshot.GetProperty("sourceChangeStatus").GetString() == "Qualified" &&
      snapshot.GetProperty("totalCount").GetInt32() > 0,
    "DEV BFF exposes the still-qualified read-only canonical snapshot");
var line = salesItems[0];
var customer = line.GetProperty("customerNumber").GetString()!;
var order = line.GetProperty("salesOrderNumber").GetString()!;
var lineNumber = line.GetProperty("lineNumber").GetString()!;

var relationships = await GetJson(authenticated,
    "/api/platform/live/v1/sales-order-work-order-relationships?page=1&pageSize=50");
var actionable = relationships.GetProperty("items").EnumerateArray()
    .First(item => item.TryGetProperty("actionableWorkOrderNumber", out var value) &&
                   value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()));
var workOrder = actionable.GetProperty("actionableWorkOrderNumber").GetString()!;
Check(relationships.GetProperty("totalItems").GetInt32() > 0,
    "canonical Work Order relationships load through 5051");

var rma = await GetJson(authenticated, "/api/rma-rework/v1/cases?status=ACTIVE&page=1&pageSize=2");
Check(rma.TryGetProperty("items", out var rmaItems) && rmaItems.ValueKind == JsonValueKind.Array,
    "RMA/Rework state loads through the governed development path");

await GetJson(authenticated, $"/api/work-order-approvals/v1/sales-order-lines/{customer}/{order}/{lineNumber}");
Check(true, "Work Order approval review loads through the governed development path");
await GetJson(authenticated,
    $"/api/operational-work-order-relationships/v1/sales-order-lines/{customer}/{order}/{lineNumber}");
Check(true, "operational Work Order relationship state loads through 5051");
await GetJson(authenticated, $"/api/kitting-dispositions/v1/work-orders/{workOrder}");
await GetJson(authenticated, $"/api/kitting-dispositions/v1/work-orders/{workOrder}/history");
Check(true, "Kitting disposition and history load through 5051");
var shipments = await GetJson(authenticated, "/api/shipment-staging/v1/shipments?page=1&pageSize=2");
Check(shipments.TryGetProperty("items", out var shipmentItems) &&
      shipmentItems.ValueKind == JsonValueKind.Array,
    "Shipment Staging state loads through 5051");
var customerFolder = await GetJson(authenticated,
    $"/api/customer-files/v1/customers/{customer}/folder");
Check(customerFolder.GetProperty("customerNumber").GetString() == customer,
    "Customer Files status loads through 5051");

using (var response = await authenticated.GetAsync("/api/platform/refresh/v1/status"))
    Check(response.StatusCode == HttpStatusCode.NotFound,
        "production and administrative refresh controls are not exposed by 5051");

var report = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    checks,
    representative = new { customer, order, lineNumber, workOrder }
};
var output = Path.Combine(repository, ".tmp", "authenticated-frontend", "phase3-compatibility-tests.json");
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
await File.WriteAllTextAsync(output, JsonSerializer.Serialize(report,
    new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
Console.WriteLine($"PASS: {checks.Count} authenticated frontend compatibility checks.");
foreach (var check in checks) Console.WriteLine("  " + check);

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}

static async Task<JsonElement> GetJson(HttpClient client, string path)
{
    using var response = await client.GetAsync(path);
    var body = await response.Content.ReadAsStringAsync();
    if (!response.IsSuccessStatusCode)
        throw new Exception($"GET {path} returned {(int)response.StatusCode}: {body}");
    return JsonDocument.Parse(body).RootElement.Clone();
}

static string? Text(JsonElement root, string parent, string property) =>
    root.GetProperty(parent).GetProperty(property).GetString();
