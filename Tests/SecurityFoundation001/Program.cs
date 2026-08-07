using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using DleOs.Security;
using Microsoft.Data.SqlClient;

var checks = new List<string>();
var repository = Directory.GetCurrentDirectory();
var connectionString = Environment.GetEnvironmentVariable("DLE_OS_SECURITY_CONNECTION_STRING")
    ?? throw new InvalidOperationException("DLE_OS_SECURITY_CONNECTION_STRING is required.");
var boundary = new SqlConnectionStringBuilder(connectionString);
if (!string.Equals(
        Environment.GetEnvironmentVariable("DLE_OS_SECURITY_DEVELOPMENT"),
        "true",
        StringComparison.Ordinal) ||
    !string.Equals(boundary.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
    boundary.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Tests require the fixed isolated DLE_OS_SECURITY_DEV boundary.");

await ApplyMigration();
var schemaChecks = await SchemaChecks();
Check(schemaChecks.TableCount == 8, "all eight governed security tables exist");
Check(schemaChecks.ForeignKeyCount >= 12, "security foreign keys exist");
Check(schemaChecks.UniqueIndexCount >= 8, "security uniqueness indexes exist");

var bootstrapper = new SecurityBootstrapper(connectionString, new CurrentWindowsIdentitySource());
var first = await bootstrapper.BootstrapMiguelAsync();
var countsAfterFirst = await BootstrapCounts();
var second = await bootstrapper.BootstrapMiguelAsync();
var countsAfterSecond = await BootstrapCounts();
Check(first.UserId == second.UserId && first.RoleId == second.RoleId, "bootstrap returns stable immutable IDs");
Check(countsAfterFirst.Users == 1 && countsAfterSecond.Users == 1, "bootstrap creates exactly one Miguel user");
Check(countsAfterFirst.Mappings == 1 && countsAfterSecond.Mappings == 1, "bootstrap creates exactly one Windows mapping");
Check(countsAfterFirst.SuperAdminRoles == 1 && countsAfterSecond.SuperAdminRoles == 1, "bootstrap creates exactly one SUPER_ADMIN role");
Check(countsAfterFirst.Assignments == 1 && countsAfterSecond.Assignments == 1, "bootstrap creates exactly one active assignment");
Check(countsAfterFirst.Permissions == 18 && countsAfterSecond.Permissions == 18, "bootstrap permission catalog is idempotent");
Check(countsAfterFirst.RolePermissions == 0 && countsAfterSecond.RolePermissions == 0, "SUPER_ADMIN has no enumerated grants");

var resolver = new SqlIdentityResolver(connectionString);
var evaluator = new AuthorizationEvaluator();
var miguel = await resolver.ResolveAsync("WINDOWS", @"DLE-OS-HOST\Miguel")
    ?? throw new Exception("Miguel did not resolve.");
Check(miguel.UserName == "Miguel" && miguel.DisplayName == "Miguel De Leon", "Miguel internal identity resolves");
Check(miguel.AccountStatus == "ACTIVE" && miguel.IsSuperAdmin, "Miguel resolves as active SUPER_ADMIN");
Check((await resolver.ResolveAsync("windows", @"dle-os-host\miguel"))?.UserId == miguel.UserId, "Windows identity casing normalizes");
Check(await resolver.ResolveAsync("WINDOWS", @"DLE-OS-HOST\DLE-OS") is null, "service identity does not resolve to Miguel");
Check(await resolver.ResolveAsync("WINDOWS", @"DLE-OS-HOST\Unknown") is null, "unknown identity does not resolve");

var contract = CurrentUserContractFactory.Create(@"DLE-OS-HOST\Miguel", miguel);
Check(contract.IsAuthenticated && contract.User?.UserName == "Miguel" && contract.IsSuperAdmin, "safe current-user contract resolves Miguel");
Check(evaluator.Can(miguel, "future.new_permission"), "SUPER_ADMIN allows newly introduced valid permission without grant row");
Check(!evaluator.Can(miguel, "not-a-valid-code"), "invalid permission identifier is denied");

await Expect<InvalidOperationException>(
    () => new SecurityBootstrapper(connectionString, new FixedIdentity(@"DLE-OS-HOST\Other")).BootstrapMiguelAsync(),
    "arbitrary Windows caller cannot invoke bootstrap");

var fixture = await CreateFixtures();
try
{
    miguel = await resolver.ResolveAsync("WINDOWS", @"DLE-OS-HOST\Miguel")
        ?? throw new Exception("Miguel did not resolve after adding a future permission.");
    Check(evaluator.Can(miguel, "future.new_permission"),
        "SUPER_ADMIN allows a newly cataloged permission without a RolePermission row");
    Check(await SuperAdminGrantCount() == 0,
        "newly cataloged permission creates no SUPER_ADMIN grant row");
    await DisableFixtureUser(fixture.DisabledUserId);
    var disabled = await resolver.ResolveAsync("WINDOWS", fixture.DisabledSubject)
        ?? throw new Exception("Disabled fixture did not resolve.");
    Check(disabled.AccountStatus == "DISABLED" && !evaluator.Can(disabled, "system.manage"),
        "disabled user is denied despite SUPER_ADMIN assignment");

    var normal = await resolver.ResolveAsync("WINDOWS", fixture.NormalSubject)
        ?? throw new Exception("Normal fixture did not resolve.");
    Check(!evaluator.Can(normal, "widgets.view"), "normal user without permission is denied");
    await GrantFixturePermission(fixture);
    normal = await resolver.ResolveAsync("WINDOWS", fixture.NormalSubject)
        ?? throw new Exception("Normal fixture did not resolve after grant.");
    Check(evaluator.Can(normal, "widgets.view"), "normal user with explicit permission is allowed");
    await RevokeFixtureRole(fixture.NormalUserId, fixture.NormalRoleId);
    normal = await resolver.ResolveAsync("WINDOWS", fixture.NormalSubject)
        ?? throw new Exception("Normal fixture did not resolve after role revocation.");
    Check(!evaluator.Can(normal, "widgets.view"), "revoked role no longer grants permission");

    await ExpectSql(
        async connection =>
        {
            await using var command = new SqlCommand(
                "INSERT security.ExternalIdentity " +
                "(ExternalIdentityId,UserId,Provider,Subject,IsActive,CreatedBy) " +
                "VALUES (NEWID(),@UserId,'WINDOWS',N'DLE-OS-HOST\\Miguel',1,N'QUALIFICATION');",
                connection);
            command.Parameters.AddWithValue("@UserId", fixture.NormalUserId);
            await command.ExecuteNonQueryAsync();
        },
        [2601, 2627],
        "duplicate external identity is rejected by unique constraint");

    await ConflictingBootstrapTest(fixture.NormalUserId);
}
finally
{
    await CleanupFixtures(fixture);
}

await ExpectSql(
    async connection =>
    {
        await using var command = new SqlCommand(
            "UPDATE security.AuditEvent SET ActorIdentity=N'REWRITE' WHERE 1=0;",
            connection);
        await command.ExecuteNonQueryAsync();
    },
    [52020],
    "security audit log is append-only");

var audit = await AuditSummary();
Check(audit.BootstrapActors >= 8, "bootstrap audit events use SYSTEM_BOOTSTRAP attribution");
Check(audit.Timestamped == audit.Total, "all bootstrap audit events are timestamped");
Check(audit.RequiredEventTypes >= 4, "user, mapping, role, and assignment bootstrap events exist");
Check(audit.LifecycleEvents >= 2, "user disablement and role revocation are audited");

var evidence = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    server = boundary.DataSource,
    database = boundary.InitialCatalog,
    checks,
    schemaChecks,
    bootstrap = new { first, second, countsAfterFirst, countsAfterSecond },
    identity = new
    {
        inputProvider = "WINDOWS",
        inputSubject = @"DLE-OS-HOST\Miguel",
        miguel.UserId,
        miguel.UserName,
        miguel.DisplayName,
        miguel.AccountStatus,
        roles = miguel.Roles.Select(role => role.RoleCode),
        miguel.IsSuperAdmin,
        serviceIdentityResolution = "NOT_FOUND",
        unknownIdentityResolution = "NOT_FOUND"
    },
    authorization = new
    {
        disabledUser = "DENY",
        normalWithoutPermission = "DENY",
        normalWithPermission = "ALLOW",
        superAdminExistingPermission = evaluator.Can(miguel, "system.manage") ? "ALLOW" : "DENY",
        superAdminNewPermission = evaluator.Can(miguel, "future.new_permission") ? "ALLOW" : "DENY",
        explicitSuperAdminRolePermissionRows = countsAfterSecond.RolePermissions
    },
    audit
};
var evidenceDirectory = Path.Combine(repository, ".tmp", "security-foundation");
Directory.CreateDirectory(evidenceDirectory);
await File.WriteAllTextAsync(
    Path.Combine(evidenceDirectory, "phase2-tests.json"),
    JsonSerializer.Serialize(evidence, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"PASS: {checks.Count} security foundation checks.");
foreach (var check in checks) Console.WriteLine("  " + check);

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}

async Task Expect<T>(Func<Task> action, string name) where T : Exception
{
    try { await action(); throw new Exception("FAILED: " + name); }
    catch (T) { checks.Add(name); }
}

async Task ApplyMigration()
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    var directory = Path.Combine(repository, "Tools", "SecurityFoundation", "Database");
    foreach (var path in Directory.GetFiles(directory, "*.sql")
                 .Where(path => !Path.GetFileName(path).StartsWith("000_", StringComparison.Ordinal))
                 .OrderBy(path => path, StringComparer.Ordinal))
    {
        var script = await File.ReadAllTextAsync(path);
        foreach (var batch in Regex.Split(script, @"(?im)^\s*GO\s*$"))
        {
            if (string.IsNullOrWhiteSpace(batch)) continue;
            await using var command = new SqlCommand(batch, connection) { CommandTimeout = 60 };
            await command.ExecuteNonQueryAsync();
        }
    }
}

async Task<(int TableCount, int ForeignKeyCount, int UniqueIndexCount)> SchemaChecks()
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        SELECT
          (SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='security'),
          (SELECT COUNT(*) FROM sys.foreign_keys fk JOIN sys.tables t ON t.object_id=fk.parent_object_id JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='security'),
          (SELECT COUNT(*) FROM sys.indexes i JOIN sys.tables t ON t.object_id=i.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='security' AND i.is_unique=1);
        """;
    await using var command = new SqlCommand(sql, connection);
    await using var reader = await command.ExecuteReaderAsync();
    await reader.ReadAsync();
    return (reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2));
}

async Task<(int Users, int Mappings, int SuperAdminRoles, int Assignments, int Permissions, int RolePermissions)> BootstrapCounts()
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        SELECT
          (SELECT COUNT(*) FROM security.[User] WHERE NormalizedUserName='MIGUEL'),
          (SELECT COUNT(*) FROM security.ExternalIdentity WHERE Provider='WINDOWS' AND NormalizedSubject='DLE-OS-HOST\MIGUEL'),
          (SELECT COUNT(*) FROM security.[Role] WHERE RoleCode='SUPER_ADMIN' AND IsSuperAdmin=1 AND IsActive=1),
          (SELECT COUNT(*) FROM security.UserRole ur JOIN security.[Role] r ON r.RoleId=ur.RoleId WHERE r.RoleCode='SUPER_ADMIN' AND ur.IsActive=1),
          (SELECT COUNT(*) FROM security.Permission),
          (SELECT COUNT(*) FROM security.RolePermission rp JOIN security.[Role] r ON r.RoleId=rp.RoleId WHERE r.RoleCode='SUPER_ADMIN' AND rp.IsActive=1);
        """;
    await using var command = new SqlCommand(sql, connection);
    await using var reader = await command.ExecuteReaderAsync();
    await reader.ReadAsync();
    return (reader.GetInt32(0),reader.GetInt32(1),reader.GetInt32(2),reader.GetInt32(3),reader.GetInt32(4),reader.GetInt32(5));
}

async Task<Fixture> CreateFixtures()
{
    var disabledUser = Guid.NewGuid();
    var normalUser = Guid.NewGuid();
    var normalRole = Guid.NewGuid();
    var permission = Guid.NewGuid();
    var futurePermission = Guid.NewGuid();
    var disabledSubject = @"DLE-OS-HOST\Phase2-Disabled";
    var normalSubject = @"DLE-OS-HOST\Phase2-Normal";
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        DECLARE @SuperAdminRoleId uniqueidentifier=(SELECT RoleId FROM security.[Role] WHERE RoleCode='SUPER_ADMIN');
        INSERT security.[User](UserId,UserName,DisplayName,AccountStatus,IsSystemAccount,CreatedBy)
          VALUES(@DisabledUser,N'Phase2Disabled',N'Phase 2 Disabled','ACTIVE',0,N'QUALIFICATION'),
                (@NormalUser,N'Phase2Normal',N'Phase 2 Normal','ACTIVE',0,N'QUALIFICATION');
        INSERT security.ExternalIdentity(ExternalIdentityId,UserId,Provider,Subject,IsActive,CreatedBy)
          VALUES(NEWID(),@DisabledUser,'WINDOWS',@DisabledSubject,1,N'QUALIFICATION'),
                (NEWID(),@NormalUser,'WINDOWS',@NormalSubject,1,N'QUALIFICATION');
        INSERT security.[Role](RoleId,RoleCode,DisplayName,Description,IsSystemRole,IsSuperAdmin,IsActive,CreatedBy)
          VALUES(@NormalRole,'PHASE2_NORMAL',N'Phase 2 Normal',N'Qualification role.',0,0,1,N'QUALIFICATION');
        INSERT security.Permission(PermissionId,PermissionCode,DisplayName,Description,Category,IsActive,CreatedBy)
          VALUES(@Permission,'widgets.view',N'View widgets',N'Qualification permission.','qualification',1,N'QUALIFICATION'),
                (@FuturePermission,'future.new_permission',N'Future permission',N'Newly introduced qualification permission.','qualification',1,N'QUALIFICATION');
        INSERT security.UserRole(UserRoleId,UserId,RoleId,IsActive,AssignedByActor)
          VALUES(NEWID(),@DisabledUser,@SuperAdminRoleId,1,N'QUALIFICATION'),
                (NEWID(),@NormalUser,@NormalRole,1,N'QUALIFICATION');
        """;
    await using var command = new SqlCommand(sql, connection);
    command.Parameters.AddWithValue("@DisabledUser", disabledUser);
    command.Parameters.AddWithValue("@NormalUser", normalUser);
    command.Parameters.AddWithValue("@NormalRole", normalRole);
    command.Parameters.AddWithValue("@Permission", permission);
    command.Parameters.AddWithValue("@FuturePermission", futurePermission);
    command.Parameters.AddWithValue("@DisabledSubject", disabledSubject);
    command.Parameters.AddWithValue("@NormalSubject", normalSubject);
    await command.ExecuteNonQueryAsync();
    return new Fixture(disabledUser, normalUser, normalRole, permission, futurePermission, disabledSubject, normalSubject);
}

async Task<int> SuperAdminGrantCount()
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new SqlCommand(
        "SELECT COUNT(*) FROM security.RolePermission rp " +
        "JOIN security.[Role] r ON r.RoleId=rp.RoleId " +
        "WHERE r.RoleCode='SUPER_ADMIN' AND rp.IsActive=1;",
        connection);
    return Convert.ToInt32(await command.ExecuteScalarAsync());
}

async Task GrantFixturePermission(Fixture fixture)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new SqlCommand(
        "INSERT security.RolePermission " +
        "(RolePermissionId,RoleId,PermissionId,IsActive,GrantedByActor) " +
        "VALUES(NEWID(),@RoleId,@PermissionId,1,N'QUALIFICATION');",
        connection);
    command.Parameters.AddWithValue("@RoleId", fixture.NormalRoleId);
    command.Parameters.AddWithValue("@PermissionId", fixture.PermissionId);
    await command.ExecuteNonQueryAsync();
}

async Task DisableFixtureUser(Guid userId)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new SqlCommand(
        "UPDATE security.[User] SET AccountStatus='DISABLED',ModifiedAtUtc=SYSUTCDATETIME()," +
        "ModifiedByActor=N'QUALIFICATION' WHERE UserId=@UserId;",
        connection);
    command.Parameters.AddWithValue("@UserId", userId);
    await command.ExecuteNonQueryAsync();
}

async Task RevokeFixtureRole(Guid userId, Guid roleId)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new SqlCommand(
        "UPDATE security.UserRole SET IsActive=0,RevokedAtUtc=SYSUTCDATETIME()," +
        "RevokedByActor=N'QUALIFICATION' WHERE UserId=@UserId AND RoleId=@RoleId AND IsActive=1;",
        connection);
    command.Parameters.AddWithValue("@UserId", userId);
    command.Parameters.AddWithValue("@RoleId", roleId);
    await command.ExecuteNonQueryAsync();
}

async Task ConflictingBootstrapTest(Guid conflictingUserId)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var transaction = await connection.BeginTransactionAsync();
    try
    {
        await using (var update = new SqlCommand(
            "UPDATE security.ExternalIdentity SET UserId=@UserId WHERE Provider='WINDOWS' AND NormalizedSubject='DLE-OS-HOST\\MIGUEL';",
            connection,
            (SqlTransaction)transaction))
        {
            update.Parameters.AddWithValue("@UserId", conflictingUserId);
            await update.ExecuteNonQueryAsync();
        }
        try
        {
            await using var bootstrap = new SqlCommand(
                "security.usp_BootstrapMiguelSuperAdmin",
                connection,
                (SqlTransaction)transaction) { CommandType=CommandType.StoredProcedure };
            await bootstrap.ExecuteNonQueryAsync();
            throw new Exception("FAILED: conflicting mapping bootstrap rejection");
        }
        catch (SqlException error) when (error.Number == 52004)
        {
            checks.Add("conflicting mapping bootstrap is rejected");
        }
    }
    finally
    {
        if (transaction.Connection is not null) await transaction.RollbackAsync();
    }
}

async Task ExpectSql(Func<SqlConnection,Task> action, int[] expectedNumbers, string name)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    try { await action(connection); throw new Exception("FAILED: " + name); }
    catch (SqlException error) when (expectedNumbers.Contains(error.Number)) { checks.Add(name); }
}

async Task CleanupFixtures(Fixture fixture)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        DELETE FROM security.RolePermission WHERE RoleId=@NormalRole;
        DELETE FROM security.UserRole WHERE UserId IN (@DisabledUser,@NormalUser);
        DELETE FROM security.ExternalIdentity WHERE UserId IN (@DisabledUser,@NormalUser);
        DELETE FROM security.Permission WHERE PermissionId IN (@Permission,@FuturePermission);
        DELETE FROM security.[Role] WHERE RoleId=@NormalRole;
        DELETE FROM security.[User] WHERE UserId IN (@DisabledUser,@NormalUser);
        """;
    await using var command = new SqlCommand(sql, connection);
    command.Parameters.AddWithValue("@DisabledUser", fixture.DisabledUserId);
    command.Parameters.AddWithValue("@NormalUser", fixture.NormalUserId);
    command.Parameters.AddWithValue("@NormalRole", fixture.NormalRoleId);
    command.Parameters.AddWithValue("@Permission", fixture.PermissionId);
    command.Parameters.AddWithValue("@FuturePermission", fixture.FuturePermissionId);
    await command.ExecuteNonQueryAsync();
}

async Task<(int Total, int BootstrapActors, int Timestamped, int RequiredEventTypes, int LifecycleEvents)> AuditSummary()
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        SELECT COUNT(*),
          SUM(CASE WHEN ActorIdentity=N'SYSTEM_BOOTSTRAP' THEN 1 ELSE 0 END),
          SUM(CASE WHEN RecordedAtUtc IS NOT NULL THEN 1 ELSE 0 END),
          COUNT(DISTINCT CASE WHEN EventType IN
            ('USER_CREATED','EXTERNAL_IDENTITY_MAPPED','ROLE_CREATED','ROLE_ASSIGNED') THEN EventType END),
          SUM(CASE WHEN EventType IN ('USER_STATUS_CHANGED','ROLE_REVOKED') THEN 1 ELSE 0 END)
        FROM security.AuditEvent;
        """;
    await using var command = new SqlCommand(sql, connection);
    await using var reader = await command.ExecuteReaderAsync();
    await reader.ReadAsync();
    return (reader.GetInt32(0),reader.GetInt32(1),reader.GetInt32(2),reader.GetInt32(3),reader.GetInt32(4));
}

sealed record Fixture(
    Guid DisabledUserId,
    Guid NormalUserId,
    Guid NormalRoleId,
    Guid PermissionId,
    Guid FuturePermissionId,
    string DisabledSubject,
    string NormalSubject);

sealed class FixedIdentity(string name) : IWindowsIdentitySource
{
    public string Name { get; } = name;
}
