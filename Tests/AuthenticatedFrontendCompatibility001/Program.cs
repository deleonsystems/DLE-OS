using System.Net;
using System.Text.Json;

var checks = new List<string>();
var repository = Directory.GetCurrentDirectory();
var clientSource = File.ReadAllText(Path.Combine(repository, "SRC", "api", "dle-api-client.js"));
var proxySource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "DevelopmentCompatibilityProxy.cs"));
var programSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "Program.cs"));
var shellSource = File.ReadAllText(Path.Combine(repository, "DLE_Work_Center_v4.0.0.html"));
var workOrderSource = File.ReadAllText(Path.Combine(repository, "SRC", "modules",
    "work-order-dashboard", "work-order-dashboard.js"));
var shipmentStagingSource = File.ReadAllText(Path.Combine(repository, "SRC", "modules",
    "shipment-staging", "shipment-staging-service.js"));

Check(clientSource.Contains("window.DleOsRuntimeConfig?.environment === 'ISOLATED_DEVELOPMENT'") &&
      clientSource.Contains("DEVELOPMENT_BFF_BASE_URL") &&
      !clientSource.Contains("window.location.port"),
    "HTTP 5051 and canonical HTTPS use the same-origin authenticated BFF runtime marker");
Check(new[] { shellSource, workOrderSource, shipmentStagingSource }.All(source =>
          source.Contains("DleOsRuntimeConfig?.environment === 'ISOLATED_DEVELOPMENT'") &&
          !source.Contains("window.location.port")),
    "all development-only browser features recognize both HTTP 5051 and canonical HTTPS");
Check(proxySource.Contains("UseDefaultCredentials = true") &&
      proxySource.Contains("DLE-OS-HOST:5052") && proxySource.Contains("DLE-OS-HOST:5054") &&
      proxySource.Contains("DLE-OS-HOST:5053"),
    "BFF uses its service identity for fixed development downstreams");
Check(!proxySource.Contains("DLE-OS-HOST:5043") &&
      !proxySource.Contains("/api/platform/refresh/v1") &&
      !proxySource.Contains("/api/platform/operations-refresh/v1"),
    "BFF exposes no production or administrative control route");
Check(proxySource.Contains("current.User.IsSuperAdmin") &&
      proxySource.Contains("CurrentUserStatus.Active"),
    "compatibility routes require active DLE-OS SUPER_ADMIN authorization");
Check(!proxySource.Contains("Authorization") && !proxySource.Contains("Cookie") &&
      !proxySource.Contains("X-DLE-OS-User") && !proxySource.Contains("X-Windows-Identity"),
    "BFF does not forward browser authorization or identity material");
Check(proxySource.Contains("UserId={UserId}") && proxySource.Contains("UserName={UserName}") &&
      proxySource.Contains("CorrelationId={CorrelationId}") &&
      proxySource.Contains("ISOLATED_DEVELOPMENT"),
    "compatibility requests are safely audited with internal identity and correlation");
Check(programSource.Contains(@"DLE-OS-HOST\DLE-OS") &&
      programSource.Contains("requiredRuntimeIdentity"),
    "BFF execution identity is explicitly separated from Miguel's application identity");

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
