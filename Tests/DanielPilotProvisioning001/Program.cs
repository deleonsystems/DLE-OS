using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using DleOs.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;

var checks = new List<string>();
var repository = Directory.GetCurrentDirectory();
if (args.Contains("--static", StringComparer.OrdinalIgnoreCase))
{
    var staticMigrationSource = await File.ReadAllTextAsync(Path.Combine(repository, "Tools",
        "SecurityFoundation", "Database", "004_ProvisionDanielKittingPilot.sql"));
    Check(staticMigrationSource.Contains("IF DB_NAME() <> N'DLE_OS_SECURITY_DEV'", StringComparison.Ordinal) &&
          staticMigrationSource.Contains("Daniel pilot provisioning requires DLE_OS_SECURITY_DEV", StringComparison.Ordinal),
        "Daniel pilot migration is fail-closed to DLE_OS_SECURITY_DEV");
    Check(!Regex.IsMatch(staticMigrationSource, @"(?i)INSERT\s+security\.ExternalIdentity") &&
          !Regex.IsMatch(staticMigrationSource, @"(?i)password|CREATE\s+(LOGIN|USER)\s+\[?daniel"),
        "Daniel pilot migration creates no credential, login, Windows account, or external identity");
    Check(new[] { "kitting.view", "work_orders.view", "pick_list.view", "rma_rework.view" }
            .All(permission => staticMigrationSource.Contains(permission, StringComparison.Ordinal)) &&
          staticMigrationSource.Contains("Daniel must never receive SUPER_ADMIN", StringComparison.Ordinal),
        "Daniel pilot migration contains its exact read entitlements and explicit SUPER_ADMIN prohibition");
    Console.WriteLine($"PASS: {checks.Count} deterministic Daniel pilot provisioning checks.");
    foreach (var check in checks) Console.WriteLine("  " + check);
    return;
}
var connectionString = Environment.GetEnvironmentVariable("DLE_OS_SECURITY_CONNECTION_STRING")
    ?? throw new InvalidOperationException("DLE_OS_SECURITY_CONNECTION_STRING is required.");
var boundary = new SqlConnectionStringBuilder(connectionString);
if (!string.Equals(Environment.GetEnvironmentVariable("DLE_OS_SECURITY_DEVELOPMENT"), "true",
        StringComparison.Ordinal) ||
    !string.Equals(boundary.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
    boundary.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Daniel pilot tests require the isolated DLE_OS_SECURITY_DEV boundary.");

await ApplyMigration();
var firstSnapshot = await Snapshot();
await ApplyMigration();
var secondSnapshot = await Snapshot();
Check(firstSnapshot == secondSnapshot, "Daniel provisioning replay is idempotent");

var userResolver = new SqlUserAuthorizationResolver(connectionString);
var identities = new SqlIdentityResolver(connectionString);
var evaluator = new AuthorizationEvaluator();
var authorization = new PermissionAuthorizationService(userResolver, evaluator);
var danielId = await GuidScalar(
    "SELECT UserId FROM security.[User] WHERE NormalizedUserName=N'DANIEL';");
var daniel = await userResolver.ResolveByUserIdAsync(danielId)
    ?? throw new Exception("Daniel did not resolve by immutable UserId.");
Check(daniel.UserName == "daniel" && daniel.DisplayName == "Daniel Miranda" &&
      daniel.AccountStatus == "PENDING", "Daniel is a real pending-auth internal DLE-OS user");
Check(daniel.Roles.Count == 1 && daniel.Roles.Single().RoleCode == "KITTING_PILOT" &&
      !daniel.Roles.Single().IsSuperAdmin, "Daniel has only the non-admin KITTING_PILOT role");

string[] expectedPermissions =
[
    "kitting.view", "work_orders.view", "pick_list.view", "rma_rework.view"
];
Check(daniel.ExplicitPermissions.SetEquals(expectedPermissions),
    "Daniel has exactly four required read permissions");
var simulatedActiveDaniel = daniel with { AccountStatus = "ACTIVE" };
foreach (var permission in new[] { "kitting.view", "work_orders.view", "pick_list.view" })
    Check(evaluator.Can(simulatedActiveDaniel, permission),
        $"Daniel pilot entitlement simulation allows {permission}");
Check(evaluator.Can(simulatedActiveDaniel, "rma_rework.view"),
    "Daniel receives the technically required RMA/Rework membership read dependency");

string[] deniedPermissions =
[
    "work_orders.approve", "kitting.disposition", "shipments.stage", "shipments.cancel",
    "shipments.confirm", "rma_rework.manage", "system.manage", "system.sync.daily",
    "system.sync.full", "employees.manage", "roles.manage", "users.manage"
];
foreach (var permission in deniedPermissions)
    Check(!evaluator.Can(simulatedActiveDaniel, permission),
        $"Daniel pilot entitlement simulation denies {permission}");

var pendingDecision = await authorization.AuthorizeAsync(danielId, "kitting.view");
Check(!pendingDecision.Allowed && pendingDecision.Code == "DLE_OS_AUTHENTICATION_PENDING",
    "pending-auth Daniel cannot use a live route before external sign-in exists");
var revokedSimulation = simulatedActiveDaniel with
{
    Roles = [], ExplicitPermissions = new HashSet<string>(StringComparer.Ordinal)
};
Check(!evaluator.Can(revokedSimulation, "kitting.view"),
    "KITTING_PILOT revocation simulation removes Daniel access");
Check(!evaluator.Can(simulatedActiveDaniel with { AccountStatus = "DISABLED" }, "kitting.view"),
    "disabled Daniel simulation denies Kitting access");

Check(await IntScalar(
    "SELECT COUNT(*) FROM security.[User] WHERE NormalizedUserName=N'DANIEL';") == 1,
    "there is no duplicate Daniel user");
Check(await IntScalar(
    "SELECT COUNT(*) FROM security.UserEmployeeLink l JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId " +
    "WHERE e.EmployeeNumber='0083' AND l.UserId=@UserId AND l.IsActive=1;", danielId) == 1,
    "employee 0083 has exactly one active Daniel link");
Check(await IntScalar(
    "SELECT COUNT(*) FROM security.ExternalIdentity WHERE UserId=@UserId;", danielId) == 0,
    "Daniel has no external identity mapping");
Check(await IntScalar(
    "SELECT COUNT(*) FROM security.UserRole ur JOIN security.[Role] r ON r.RoleId=ur.RoleId " +
    "WHERE ur.UserId=@UserId AND ur.IsActive=1 AND r.IsSuperAdmin=1;", danielId) == 0,
    "Daniel cannot receive SUPER_ADMIN through pilot provisioning");
Check(await TextScalar(
    "SELECT LinkEvidenceCode FROM security.UserEmployeeLink WHERE UserId=@UserId AND IsActive=1;",
    danielId) == "PILOT_KITTING_USER_PROVISIONING",
    "Daniel employee link records the governed pilot reason");

var directory = await new EmployeeDirectoryService(connectionString).GetAsync(true);
var employee = directory.Items.Single(item => item.EmployeeNumber == "0083");
Check(employee.DleWorkforceStatus == "CURRENT" && employee.TrainingEligible &&
      employee.ProvisioningStatus == "PROVISIONED_PENDING_AUTH",
    "employee 0083 is current, training eligible, and pending authentication");
Check(employee.ProposedUserName == "daniel" && employee.DleOsUserName == "daniel" &&
      employee.DleOsUserDisplayName == "Daniel Miranda" &&
      employee.DleOsRoleCode == "KITTING_PILOT",
    "Employee Directory exposes Daniel username, user, and KITTING_PILOT role");
Check(!employee.HasDleOsAccess && employee.AccessReadiness == "NOT_YET_SIGN_IN_READY",
    "Employee Directory reports Daniel as not yet sign-in ready");
Check(directory.TotalEmployees == 11 && directory.LinkedUsers == 2 &&
      directory.UnprovisionedEmployees == 8 && directory.HistoricalRetainedEmployees == 1,
    "employee population is 11 total, 2 linked, 8 current unprovisioned, and 1 historical retained");
Check(directory.Items.Single(item => item.EmployeeNumber == "0001").DleOsUserName is null,
    "historical employee 0001 remains unlinked");
Check(directory.Items.Where(item => item.EmployeeNumber is not ("0001" or "0054" or "0083"))
        .All(item => item.ProvisioningStatus == "NOT_PROVISIONED" && item.DleOsUserName is null),
    "the other eight current employees remain unprovisioned and unlinked");

var miguel = await identities.ResolveAsync("WINDOWS", @"DLE-OS-HOST\Miguel")
    ?? throw new Exception("Miguel no longer resolves.");
Check(miguel.AccountStatus == "ACTIVE" && miguel.IsSuperAdmin &&
      miguel.Roles.Any(role => role.RoleCode == "SUPER_ADMIN"),
    "Miguel remains active SUPER_ADMIN");
Check(await IntScalar("SELECT COUNT(*) FROM security.[User];") == 2,
    "security.User contains only Miguel and Daniel");

var frontendSource = await File.ReadAllTextAsync(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "DevelopmentCompatibilityProxy.cs"));
var identityUiSource = await File.ReadAllTextAsync(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "DevelopmentIdentityUi.cs"));
var directoryUiSource = await File.ReadAllTextAsync(Path.Combine(repository, "Tools", "DevelopmentRuntime",
    "DleOs.DevelopmentFrontend", "EmployeeDirectoryUi.cs"));
var kittingSource = await File.ReadAllTextAsync(Path.Combine(repository, "SRC", "workspaces", "kitting",
    "kitting-workspace.js"));
Check(frontendSource.Contains("ResolvePermission") && frontendSource.Contains("kitting.view") &&
      frontendSource.Contains("work_orders.view") && frontendSource.Contains("DLE_OS_PERMISSION_DENIED"),
    "BFF enforces Kitting pilot permissions server-side");
Check(kittingSource.Contains("loadActiveRmaReworkMemberships") &&
      kittingSource.Contains("getRmaReworkCases"),
    "RMA/Rework read grant is documented by the current Kitting Workspace dependency");
Check(identityUiSource.Contains("kittingWorkspaceAvailable") &&
      identityUiSource.Contains("pickListReadAvailable") &&
      identityUiSource.Contains("workspaceRules"),
    "frontend capability simulation exposes Kitting and Pick List reads while restricting workspaces");
Check(directoryUiSource.Contains("dleOsRoleCode") && directoryUiSource.Contains("accessReadiness") &&
      directoryUiSource.Contains("data.employeeNumber") == false,
    "Employee Directory UI renders role and sign-in readiness without activation controls");
Check(!frontendSource.Contains("X-DLE-OS-User") && !frontendSource.Contains("X-Windows-Identity"),
    "BFF authorization cannot be supplied by browser identity headers");

Check(ResolveBffPermission("GET", "/api/platform/live/v1/sales-orders") == "kitting.view" &&
      ResolveBffPermission("GET", "/api/platform/live/v1/work-orders") == "work_orders.view" &&
      ResolveBffPermission("GET", "/api/kitting-dispositions/v1/work-orders/0115621") == "kitting.view",
    "Kitting Workspace read routes map to Daniel pilot permissions");
Check(ResolveBffPermission("POST", "/api/kitting-dispositions/v1/work-orders/0115621") ==
      "kitting.disposition" && !evaluator.Can(simulatedActiveDaniel, "kitting.disposition"),
    "direct Kitting mutation requests remain denied to Daniel");

var migrationSource = await File.ReadAllTextAsync(Path.Combine(repository, "Tools", "SecurityFoundation",
    "Database", "004_ProvisionDanielKittingPilot.sql"));
Check(!Regex.IsMatch(migrationSource, @"(?i)INSERT\s+security\.ExternalIdentity") &&
      !Regex.IsMatch(migrationSource, @"(?i)password|CREATE\s+(LOGIN|USER)\s+\[?daniel"),
    "pilot provisioning creates no password, SQL login, Windows account, or external identity");

var report = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    database = boundary.InitialCatalog,
    user = new { daniel.UserId, daniel.UserName, daniel.DisplayName, daniel.AccountStatus },
    role = "KITTING_PILOT",
    permissions = expectedPermissions,
    deniedPermissions,
    checks
};
var output = Path.Combine(repository, ".tmp", "daniel-pilot", "phase52c-tests.json");
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
await File.WriteAllTextAsync(output, JsonSerializer.Serialize(report,
    new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
Console.WriteLine($"PASS: {checks.Count} Daniel pilot provisioning checks.");
foreach (var check in checks) Console.WriteLine("  " + check);

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}

async Task ApplyMigration()
{
    var path = Path.Combine(repository, "Tools", "SecurityFoundation", "Database",
        "004_ProvisionDanielKittingPilot.sql");
    var script = await File.ReadAllTextAsync(path);
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    foreach (var batch in Regex.Split(script, @"(?im)^\s*GO\s*$"))
    {
        if (string.IsNullOrWhiteSpace(batch)) continue;
        await using var command = new SqlCommand(batch, connection) { CommandTimeout = 60 };
        await command.ExecuteNonQueryAsync();
    }
}

async Task<string> Snapshot()
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        SELECT
          (SELECT COUNT(*) FROM security.[User] WHERE NormalizedUserName=N'DANIEL'),
          (SELECT COUNT(*) FROM security.UserEmployeeLink l JOIN hr.Employee e ON e.EmployeeId=l.EmployeeId
             WHERE e.EmployeeNumber='0083' AND l.IsActive=1),
          (SELECT COUNT(*) FROM security.UserRole ur JOIN security.[User] u ON u.UserId=ur.UserId
             WHERE u.NormalizedUserName=N'DANIEL' AND ur.IsActive=1),
          (SELECT COUNT(*) FROM security.RolePermission rp JOIN security.[Role] r ON r.RoleId=rp.RoleId
             WHERE r.RoleCode='KITTING_PILOT' AND rp.IsActive=1),
          (SELECT COUNT(*) FROM security.AuditEvent WHERE ActorIdentity=N'PHASE_5_2C_MIGUEL');
        """;
    await using var command = new SqlCommand(sql, connection);
    await using var reader = await command.ExecuteReaderAsync();
    await reader.ReadAsync();
    return string.Join('|', Enumerable.Range(0, 5).Select(index => reader.GetInt32(index)));
}

async Task<int> IntScalar(string sql, Guid? userId = null)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new SqlCommand(sql, connection);
    if (userId.HasValue) command.Parameters.AddWithValue("@UserId", userId.Value);
    return Convert.ToInt32(await command.ExecuteScalarAsync());
}

async Task<Guid> GuidScalar(string sql)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new SqlCommand(sql, connection);
    return (Guid)(await command.ExecuteScalarAsync() ?? throw new Exception("Expected GUID is absent."));
}

async Task<string?> TextScalar(string sql, Guid userId)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new SqlCommand(sql, connection);
    command.Parameters.AddWithValue("@UserId", userId);
    return (string?)await command.ExecuteScalarAsync();
}

string? ResolveBffPermission(string method, string path)
{
    var context = new DefaultHttpContext();
    context.Request.Method = method;
    context.Request.Path = path;
    var resolver = typeof(DevelopmentCompatibilityProxy).GetMethod(
        "ResolvePermission", BindingFlags.Static | BindingFlags.NonPublic)
        ?? throw new Exception("BFF permission resolver is absent.");
    return (string?)resolver.Invoke(null, [context.Request]);
}
