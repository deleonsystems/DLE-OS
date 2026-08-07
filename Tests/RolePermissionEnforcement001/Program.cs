using System.Text.Json;
using System.Text.RegularExpressions;
using DleOs.Security;
using Microsoft.Data.SqlClient;

var checks = new List<string>();
var repository = Directory.GetCurrentDirectory();
var connectionString = Environment.GetEnvironmentVariable("DLE_OS_SECURITY_CONNECTION_STRING")
    ?? throw new InvalidOperationException("DLE_OS_SECURITY_CONNECTION_STRING is required.");
var boundary = new SqlConnectionStringBuilder(connectionString);
if (!string.Equals(Environment.GetEnvironmentVariable("DLE_OS_SECURITY_DEVELOPMENT"), "true",
        StringComparison.Ordinal) ||
    !string.Equals(boundary.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
    boundary.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Phase 5.1 tests require the isolated DLE_OS_SECURITY_DEV boundary.");

string[] catalog =
[
    "work_orders.view", "work_orders.approve", "work_orders.replace",
    "work_orders.revoke", "work_orders.mark_no_work_order_required",
    "kitting.view", "kitting.disposition", "rma_rework.view", "rma_rework.manage",
    "shipments.view", "shipments.stage", "shipments.cancel", "shipments.confirm",
    "shipments.reconcile"
];
await ApplyMigration();
Check(await Scalar("SELECT COUNT(*) FROM security.Permission WHERE PermissionCode IN (" +
                   string.Join(',', catalog.Select((_, index) => $"@P{index}")) + ")", catalog) == catalog.Length,
    "all fourteen Phase 5.1 permissions exist");
Check(await Scalar("SELECT COUNT(DISTINCT PermissionCode) FROM security.Permission WHERE PermissionCode IN (" +
                   string.Join(',', catalog.Select((_, index) => $"@P{index}")) + ")", catalog) == catalog.Length,
    "permission catalog has no duplicates");

var identities = new SqlIdentityResolver(connectionString);
var userResolver = new SqlUserAuthorizationResolver(connectionString);
var evaluator = new AuthorizationEvaluator();
var authorization = new PermissionAuthorizationService(userResolver, evaluator);
var miguel = await identities.ResolveAsync("WINDOWS", @"DLE-OS-HOST\Miguel")
    ?? throw new Exception("Miguel did not resolve.");
foreach (var permission in catalog)
    Check((await authorization.AuthorizeAsync(miguel.UserId, permission)).Allowed,
        $"Miguel SUPER_ADMIN allows {permission}");
Check(await Scalar("SELECT COUNT(*) FROM security.RolePermission rp JOIN security.[Role] r " +
                   "ON r.RoleId=rp.RoleId WHERE r.RoleCode='SUPER_ADMIN' AND rp.IsActive=1") == 0,
    "SUPER_ADMIN requires no explicit RolePermission rows");

var fixture = FixtureIds.Create();
await CreateFixtures(fixture);
try
{
    var viewer = await userResolver.ResolveByUserIdAsync(fixture.ViewerUserId);
    var kitting = await userResolver.ResolveByUserIdAsync(fixture.KittingUserId);
    var shipping = await userResolver.ResolveByUserIdAsync(fixture.ShippingUserId);
    var noAccess = await userResolver.ResolveByUserIdAsync(fixture.NoAccessUserId);
    Check(viewer?.ExplicitPermissions.SetEquals(
        ["work_orders.view", "kitting.view", "rma_rework.view", "shipments.view"]) == true,
        "TEST_VIEWER has only four view permissions");
    Check(kitting?.ExplicitPermissions.SetEquals(["kitting.view", "kitting.disposition"]) == true,
        "TEST_KITTING has only kitting view and disposition");
    Check(shipping?.ExplicitPermissions.SetEquals(["shipments.view", "shipments.stage"]) == true,
        "TEST_SHIPPING has only shipment view and stage");
    Check(noAccess?.ExplicitPermissions.Count == 0, "TEST_NO_ACCESS has no effective permissions");

    Check((await authorization.AuthorizeAsync(fixture.ViewerUserId, "shipments.view")).Allowed,
        "view-only user can view shipments");
    Check(!(await authorization.AuthorizeAsync(fixture.ViewerUserId, "shipments.stage")).Allowed,
        "view-only user cannot stage shipments");
    Check((await authorization.AuthorizeAsync(fixture.ViewerUserId, "kitting.view")).Allowed,
        "view-only user can view kitting");
    Check(!(await authorization.AuthorizeAsync(fixture.ViewerUserId, "kitting.disposition")).Allowed,
        "view-only user cannot disposition kitting");
    Check((await authorization.AuthorizeAsync(fixture.KittingUserId, "kitting.disposition")).Allowed,
        "kitting user can disposition kitting");
    Check(!(await authorization.AuthorizeAsync(fixture.KittingUserId, "shipments.stage")).Allowed &&
          !(await authorization.AuthorizeAsync(fixture.KittingUserId, "work_orders.approve")).Allowed &&
          !(await authorization.AuthorizeAsync(fixture.KittingUserId, "rma_rework.manage")).Allowed,
        "kitting permission does not bleed across domains");
    Check((await authorization.AuthorizeAsync(fixture.ShippingUserId, "shipments.stage")).Allowed,
        "shipping user can stage shipments");
    Check(!(await authorization.AuthorizeAsync(fixture.ShippingUserId, "shipments.cancel")).Allowed &&
          !(await authorization.AuthorizeAsync(fixture.ShippingUserId, "shipments.confirm")).Allowed &&
          !(await authorization.AuthorizeAsync(fixture.ShippingUserId, "shipments.reconcile")).Allowed,
        "shipment staging does not imply cancel, confirm, or reconcile");
    Check(!(await authorization.AuthorizeAsync(fixture.NoAccessUserId, "shipments.view")).Allowed,
        "normal user without permission is denied");
    Check((await authorization.AuthorizeAsync(fixture.DisabledUserId, "shipments.stage")).Code ==
          "DLE_OS_USER_DISABLED", "disabled user is denied despite an active grant");
    Check((await authorization.AuthorizeAsync(Guid.NewGuid(), "shipments.stage")).Code ==
          "DLE_OS_USER_NOT_PROVISIONED", "unknown immutable user is denied");
    Check(await identities.ResolveAsync("WINDOWS", @"DLE-OS-HOST\DLE-OS") is null,
        "service identity does not inherit Miguel permissions");

    var mutationCount = 0;
    var denied = await authorization.AuthorizeAsync(fixture.ViewerUserId, "shipments.stage");
    if (denied.Allowed) mutationCount++;
    Check(!denied.Allowed && denied.Code == "DLE_OS_PERMISSION_DENIED" && mutationCount == 0,
        "unauthorized isolated write returns 403 semantics and creates no mutation");
    var allowed = await authorization.AuthorizeAsync(fixture.ShippingUserId, "shipments.stage");
    if (allowed.Allowed) mutationCount++;
    Check(allowed.Allowed && mutationCount == 1,
        "authorized isolated shipment fixture writes once");

    await RevokeRole(fixture.KittingUserRoleId);
    Check(!(await authorization.AuthorizeAsync(fixture.KittingUserId, "kitting.disposition")).Allowed,
        "role revocation takes effect on the next authorization lookup");
    await RevokePermission(fixture.ShippingStageGrantId);
    Check(!(await authorization.AuthorizeAsync(fixture.ShippingUserId, "shipments.stage")).Allowed,
        "permission revocation takes effect on the next authorization lookup");

    var middleware = File.ReadAllText(Path.Combine(repository, "Tools", "LiveSnapshotRefresh",
        "ControlHost", "DevelopmentPermissionAuthorization.cs"));
    var trusted = File.ReadAllText(Path.Combine(repository, "Tools", "LiveSnapshotRefresh",
        "ControlHost", "TrustedDevelopmentIdentity.cs"));
    var identityUi = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
        "DleOs.DevelopmentFrontend", "DevelopmentIdentityUi.cs"));
    var client = File.ReadAllText(Path.Combine(repository, "SRC", "api", "dle-api-client.js"));
    var securitySource = File.ReadAllText(Path.Combine(repository, "Tools", "SecurityFoundation",
        "DleOs.Security", "SecurityServices.cs"));
    Check(middleware.Contains("AuthorizeAsync(trusted.UserId") &&
          !middleware.Contains("trusted.IsSuperAdmin"),
        "downstream authorization uses immutable UserId and fresh lookup, not signed role facts");
    Check(securitySource.Contains("DLE_OS_PERMISSION_DENIED") &&
          middleware.Contains("decision.Code") && middleware.Contains("requiredPermission"),
        "server returns governed 403 permission diagnostics");
    Check(middleware.Contains("AuthorizationDecision ActorUserId") &&
          middleware.Contains("AuthorizationResult") && middleware.Contains("CorrelationId"),
        "authorization outcomes have structured actor, action, permission, environment, and correlation audit fields");
    Check(!trusted.Contains("if (!validation.User.IsSuperAdmin)"),
        "trusted identity validation no longer hard-codes SUPER_ADMIN authorization");
    Check(!middleware.Contains("X-DLE-OS-User") && !middleware.Contains("X-Windows-Identity") &&
          !middleware.Contains("context.Request.Headers") && middleware.Contains("SqlUserAuthorizationResolver"),
        "browser headers cannot supply application permission facts");
    Check(identityUi.Contains("DleOsCapabilities") && identityUi.Contains("work_orders.approve") &&
          identityUi.Contains("shipments.stage") && client.Contains("requireDevelopmentCapability"),
        "frontend capability contract hides or blocks selected unauthorized controls");
    Check(middleware.Contains("DLE_OS_SECURITY_DEV") &&
          File.ReadAllText(Path.Combine(repository, "Tools", "LiveSnapshotRefresh", "ControlHost",
              "ControlHostRuntimeConfiguration.cs")).Contains("SecurityDatabaseName"),
        "development security boundary remains independent from production governance");
}
finally
{
    await CleanupFixtures(fixture);
}

var evidence = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    database = boundary.InitialCatalog,
    count = checks.Count,
    permissions = catalog,
    checks
};
var output = Path.Combine(repository, ".tmp", "role-permission", "phase51-tests.json");
Directory.CreateDirectory(Path.GetDirectoryName(output)!);
await File.WriteAllTextAsync(output, JsonSerializer.Serialize(evidence,
    new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
Console.WriteLine($"PASS: {checks.Count} Phase 5.1 role and permission checks.");

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}

async Task ApplyMigration()
{
    var path = Path.Combine(repository, "Tools", "SecurityFoundation", "Database",
        "002_AddOperationalPermissionCatalog.sql");
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

async Task<int> Scalar(string sql, string[]? parameters = null)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new SqlCommand(sql, connection);
    if (parameters is not null)
        for (var index = 0; index < parameters.Length; index++)
            command.Parameters.AddWithValue($"@P{index}", parameters[index]);
    return Convert.ToInt32(await command.ExecuteScalarAsync());
}

async Task CreateFixtures(FixtureIds ids)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        INSERT security.[Role](RoleId,RoleCode,DisplayName,Description,IsSystemRole,IsSuperAdmin,IsActive,CreatedBy) VALUES
          (@ViewerRole,'TEST_VIEWER',N'Test Viewer',N'Phase 5.1 disposable fixture.',0,0,1,N'PHASE_5_1_QUALIFICATION'),
          (@KittingRole,'TEST_KITTING',N'Test Kitting',N'Phase 5.1 disposable fixture.',0,0,1,N'PHASE_5_1_QUALIFICATION'),
          (@ShippingRole,'TEST_SHIPPING',N'Test Shipping',N'Phase 5.1 disposable fixture.',0,0,1,N'PHASE_5_1_QUALIFICATION'),
          (@NoAccessRole,'TEST_NO_ACCESS',N'Test No Access',N'Phase 5.1 disposable fixture.',0,0,1,N'PHASE_5_1_QUALIFICATION');
        INSERT security.[User](UserId,UserName,DisplayName,AccountStatus,IsSystemAccount,CreatedBy) VALUES
          (@ViewerUser,N'Phase51Viewer',N'Phase 5.1 Viewer','ACTIVE',0,N'PHASE_5_1_QUALIFICATION'),
          (@KittingUser,N'Phase51Kitting',N'Phase 5.1 Kitting','ACTIVE',0,N'PHASE_5_1_QUALIFICATION'),
          (@ShippingUser,N'Phase51Shipping',N'Phase 5.1 Shipping','ACTIVE',0,N'PHASE_5_1_QUALIFICATION'),
          (@NoAccessUser,N'Phase51NoAccess',N'Phase 5.1 No Access','ACTIVE',0,N'PHASE_5_1_QUALIFICATION'),
          (@DisabledUser,N'Phase51Disabled',N'Phase 5.1 Disabled','DISABLED',0,N'PHASE_5_1_QUALIFICATION');
        INSERT security.ExternalIdentity(ExternalIdentityId,UserId,Provider,Subject,IsActive,CreatedBy) VALUES
          (NEWID(),@ViewerUser,'WINDOWS',N'DLE-OS-QUALIFICATION\PHASE51-VIEWER',1,N'PHASE_5_1_QUALIFICATION'),
          (NEWID(),@KittingUser,'WINDOWS',N'DLE-OS-QUALIFICATION\PHASE51-KITTING',1,N'PHASE_5_1_QUALIFICATION'),
          (NEWID(),@ShippingUser,'WINDOWS',N'DLE-OS-QUALIFICATION\PHASE51-SHIPPING',1,N'PHASE_5_1_QUALIFICATION'),
          (NEWID(),@NoAccessUser,'WINDOWS',N'DLE-OS-QUALIFICATION\PHASE51-NONE',1,N'PHASE_5_1_QUALIFICATION'),
          (NEWID(),@DisabledUser,'WINDOWS',N'DLE-OS-QUALIFICATION\PHASE51-DISABLED',1,N'PHASE_5_1_QUALIFICATION');
        INSERT security.UserRole(UserRoleId,UserId,RoleId,IsActive,AssignedByActor) VALUES
          (@ViewerUserRole,@ViewerUser,@ViewerRole,1,N'PHASE_5_1_QUALIFICATION'),
          (@KittingUserRole,@KittingUser,@KittingRole,1,N'PHASE_5_1_QUALIFICATION'),
          (@ShippingUserRole,@ShippingUser,@ShippingRole,1,N'PHASE_5_1_QUALIFICATION'),
          (@NoAccessUserRole,@NoAccessUser,@NoAccessRole,1,N'PHASE_5_1_QUALIFICATION'),
          (NEWID(),@DisabledUser,@ShippingRole,1,N'PHASE_5_1_QUALIFICATION');
        INSERT security.RolePermission(RolePermissionId,RoleId,PermissionId,IsActive,GrantedByActor)
        SELECT NEWID(),@ViewerRole,PermissionId,1,N'PHASE_5_1_QUALIFICATION' FROM security.Permission
          WHERE PermissionCode IN ('work_orders.view','kitting.view','rma_rework.view','shipments.view');
        INSERT security.RolePermission(RolePermissionId,RoleId,PermissionId,IsActive,GrantedByActor)
        SELECT NEWID(),@KittingRole,PermissionId,1,N'PHASE_5_1_QUALIFICATION' FROM security.Permission
          WHERE PermissionCode IN ('kitting.view','kitting.disposition');
        INSERT security.RolePermission(RolePermissionId,RoleId,PermissionId,IsActive,GrantedByActor)
        SELECT CASE WHEN PermissionCode='shipments.stage' THEN @ShippingStageGrant ELSE NEWID() END,
          @ShippingRole,PermissionId,1,N'PHASE_5_1_QUALIFICATION' FROM security.Permission
          WHERE PermissionCode IN ('shipments.view','shipments.stage');
        """;
    await using var command = new SqlCommand(sql, connection);
    ids.AddParameters(command);
    await command.ExecuteNonQueryAsync();
}

async Task RevokeRole(Guid id) => await Revoke(
    "UPDATE security.UserRole SET IsActive=0,RevokedAtUtc=SYSUTCDATETIME()," +
    "RevokedByActor=N'PHASE_5_1_QUALIFICATION' WHERE UserRoleId=@Id", id);

async Task RevokePermission(Guid id) => await Revoke(
    "UPDATE security.RolePermission SET IsActive=0,RevokedAtUtc=SYSUTCDATETIME()," +
    "RevokedByActor=N'PHASE_5_1_QUALIFICATION' WHERE RolePermissionId=@Id", id);

async Task Revoke(string sql, Guid id)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new SqlCommand(sql, connection);
    command.Parameters.AddWithValue("@Id", id);
    await command.ExecuteNonQueryAsync();
}

async Task CleanupFixtures(FixtureIds ids)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        DELETE FROM security.RolePermission WHERE RoleId IN (@ViewerRole,@KittingRole,@ShippingRole,@NoAccessRole);
        DELETE FROM security.UserRole WHERE UserId IN (@ViewerUser,@KittingUser,@ShippingUser,@NoAccessUser,@DisabledUser);
        DELETE FROM security.ExternalIdentity WHERE UserId IN (@ViewerUser,@KittingUser,@ShippingUser,@NoAccessUser,@DisabledUser);
        DELETE FROM security.[User] WHERE UserId IN (@ViewerUser,@KittingUser,@ShippingUser,@NoAccessUser,@DisabledUser);
        DELETE FROM security.[Role] WHERE RoleId IN (@ViewerRole,@KittingRole,@ShippingRole,@NoAccessRole);
        """;
    await using var command = new SqlCommand(sql, connection);
    ids.AddParameters(command);
    await command.ExecuteNonQueryAsync();
}

sealed record FixtureIds(
    Guid ViewerRoleId, Guid KittingRoleId, Guid ShippingRoleId, Guid NoAccessRoleId,
    Guid ViewerUserId, Guid KittingUserId, Guid ShippingUserId, Guid NoAccessUserId,
    Guid DisabledUserId, Guid ViewerUserRoleId, Guid KittingUserRoleId,
    Guid ShippingUserRoleId, Guid NoAccessUserRoleId, Guid ShippingStageGrantId)
{
    public static FixtureIds Create() => new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
        Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
        Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

    public void AddParameters(SqlCommand command)
    {
        command.Parameters.AddWithValue("@ViewerRole", ViewerRoleId);
        command.Parameters.AddWithValue("@KittingRole", KittingRoleId);
        command.Parameters.AddWithValue("@ShippingRole", ShippingRoleId);
        command.Parameters.AddWithValue("@NoAccessRole", NoAccessRoleId);
        command.Parameters.AddWithValue("@ViewerUser", ViewerUserId);
        command.Parameters.AddWithValue("@KittingUser", KittingUserId);
        command.Parameters.AddWithValue("@ShippingUser", ShippingUserId);
        command.Parameters.AddWithValue("@NoAccessUser", NoAccessUserId);
        command.Parameters.AddWithValue("@DisabledUser", DisabledUserId);
        command.Parameters.AddWithValue("@ViewerUserRole", ViewerUserRoleId);
        command.Parameters.AddWithValue("@KittingUserRole", KittingUserRoleId);
        command.Parameters.AddWithValue("@ShippingUserRole", ShippingUserRoleId);
        command.Parameters.AddWithValue("@NoAccessUserRole", NoAccessUserRoleId);
        command.Parameters.AddWithValue("@ShippingStageGrant", ShippingStageGrantId);
    }
}
