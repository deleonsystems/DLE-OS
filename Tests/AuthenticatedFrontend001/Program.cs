using System.Security.Claims;
using System.Security.Principal;
using System.Text.Json;
using DleOs.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;

var checks = new List<string>();
const string connectionString =
    @"Server=lpc:.\SQLEXPRESS;Database=DLE_OS_SECURITY_DEV;Integrated Security=True;" +
    "Encrypt=False;TrustServerCertificate=True;ApplicationIntent=ReadWrite;";
var boundary = new SqlConnectionStringBuilder(connectionString);
if (!string.Equals(boundary.InitialCatalog, "DLE_OS_SECURITY_DEV", StringComparison.Ordinal) ||
    boundary.InitialCatalog.Contains("LIVE", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Authenticated frontend tests require DLE_OS_SECURITY_DEV.");

var resolver = new SqlIdentityResolver(connectionString);

var miguel = await Resolve(@"DLE-OS-HOST\Miguel", resolver);
Check(miguel.Status == CurrentUserStatus.Active, "authenticated Miguel is active");
var miguelResponse = CurrentUserResponseFactory.Create(miguel);
var miguelJson = JsonSerializer.Serialize(
    miguelResponse.Body,
    new JsonSerializerOptions(JsonSerializerDefaults.Web));
Check(miguelResponse.StatusCode == 200, "Miguel current-user response is HTTP 200");
Check(miguelJson.Contains("Miguel De Leon") && miguelJson.Contains("SUPER_ADMIN") &&
      miguelJson.Contains("\"isSuperAdmin\":true"), "Miguel response contains display identity and SUPER_ADMIN");
Check(!miguelJson.Contains("DLE-OS-HOST") && !miguelJson.Contains("UserId", StringComparison.OrdinalIgnoreCase),
    "normal current-user response excludes Windows identity and SQL IDs");

var caseNormalized = await Resolve(@"dle-os-host\miguel", resolver);
Check(caseNormalized.Status == CurrentUserStatus.Active &&
      caseNormalized.User?.UserId == miguel.User?.UserId, "Windows subject casing resolves consistently");

var unknown = await Resolve(@"DLE-OS-HOST\Unknown", resolver);
var unknownResponse = CurrentUserResponseFactory.Create(unknown);
Check(unknown.Status == CurrentUserStatus.NotProvisioned && unknownResponse.StatusCode == 403 &&
      unknownResponse.Code == "DLE_OS_USER_NOT_PROVISIONED", "unknown authenticated user receives governed 403");

var service = await Resolve(@"DLE-OS-HOST\DLE-OS", resolver);
Check(service.Status == CurrentUserStatus.NotProvisioned && service.User is null,
    "DLE-OS service identity remains unmapped and receives no Miguel rights");

var anonymousContext = Context(null, false);
var anonymous = await new CurrentUserContext(
    new HttpContextAccessor { HttpContext = anonymousContext }, resolver).ResolveAsync();
var anonymousResponse = CurrentUserResponseFactory.Create(anonymous);
Check(anonymous.Status == CurrentUserStatus.Unauthenticated && anonymousResponse.StatusCode == 401,
    "unauthenticated request is distinct from unmapped Windows caller");

var spoofContext = Context(@"DLE-OS-HOST\Unknown", true);
spoofContext.Request.Headers["X-DLE-OS-User"] = "Miguel";
spoofContext.Request.Headers["X-Windows-Identity"] = @"DLE-OS-HOST\Miguel";
spoofContext.Request.QueryString = new QueryString("?user=Miguel&windowsIdentity=DLE-OS-HOST%5CMiguel");
var recordingResolver = new RecordingResolver(resolver);
var spoofResult = await new CurrentUserContext(
    new HttpContextAccessor { HttpContext = spoofContext }, recordingResolver).ResolveAsync();
Check(spoofResult.Status == CurrentUserStatus.NotProvisioned &&
      recordingResolver.Subjects.Single() == @"DLE-OS-HOST\Unknown",
    "client headers and query parameters cannot override the authenticated server principal");

var cachedResolver = new RecordingResolver(resolver);
var cachedContext = new CurrentUserContext(
    new HttpContextAccessor { HttpContext = Context(@"DLE-OS-HOST\Miguel", true) }, cachedResolver);
await cachedContext.ResolveAsync();
await cachedContext.ResolveAsync();
Check(cachedResolver.Subjects.Count == 1, "request-scoped current-user resolution is cached once");

var unavailableResolver = new SqlIdentityResolver(
    @"Server=lpc:.\DLE_OS_PHASE3_UNAVAILABLE;Database=DLE_OS_SECURITY_DEV;" +
    "Integrated Security=True;Encrypt=False;Connect Timeout=1;");
var unavailable = await Resolve(@"DLE-OS-HOST\Miguel", unavailableResolver);
var unavailableResponse = CurrentUserResponseFactory.Create(unavailable);
Check(unavailable.Status == CurrentUserStatus.SecurityUnavailable && unavailableResponse.StatusCode == 503 &&
      unavailableResponse.Code == "DLE_OS_SECURITY_UNAVAILABLE",
    "security outage is distinct from anonymous identity");

var fixture = await CreateDisabledFixture();
try
{
    var disabled = await Resolve(fixture.Subject, resolver);
    var disabledResponse = CurrentUserResponseFactory.Create(disabled);
    Check(disabled.Status == CurrentUserStatus.Disabled && disabledResponse.StatusCode == 403 &&
          disabledResponse.Code == "DLE_OS_USER_DISABLED", "disabled mapped user receives governed 403");
    Check(disabled.User?.IsSuperAdmin == false, "disabled account cannot become effective SUPER_ADMIN");
}
finally
{
    await CleanupDisabledFixture(fixture);
}

var shell = DevelopmentIdentityUi.Inject("<html><body><main>DLE-OS</main></body></html>");
Check(shell.Contains("dle-auth-identity") && shell.Contains("/api/auth/me") &&
      shell.Contains("SUPER_ADMIN") && shell.Contains("Miguel") == false,
    "frontend identity display is driven by server current-user API, not hard-coded Miguel data");
Check(DevelopmentIdentityUi.AccessStateDocument("DLE_OS_USER_NOT_PROVISIONED").Contains("not provisioned") &&
      DevelopmentIdentityUi.AccessStateDocument("DLE_OS_USER_DISABLED").Contains("disabled") &&
      DevelopmentIdentityUi.AccessStateDocument("DLE_OS_SECURITY_UNAVAILABLE").Contains("temporarily unavailable"),
    "frontend has distinct unmapped, disabled, and unavailable access states");

var evidence = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    server = boundary.DataSource,
    database = boundary.InitialCatalog,
    checks
};
var evidenceDirectory = Path.Combine(Directory.GetCurrentDirectory(), ".tmp", "authenticated-frontend");
Directory.CreateDirectory(evidenceDirectory);
await File.WriteAllTextAsync(
    Path.Combine(evidenceDirectory, "phase3-tests.json"),
    JsonSerializer.Serialize(evidence, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"PASS: {checks.Count} authenticated frontend checks.");
foreach (var check in checks) Console.WriteLine("  " + check);

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}

async Task<CurrentUserResolution> Resolve(string subject, IIdentityResolver identityResolver)
{
    var context = Context(subject, true);
    return await new CurrentUserContext(
        new HttpContextAccessor { HttpContext = context }, identityResolver).ResolveAsync();
}

DefaultHttpContext Context(string? name, bool authenticated)
{
    var context = new DefaultHttpContext();
    IIdentity identity = authenticated
        ? new GenericIdentity(name ?? string.Empty, "Negotiate")
        : new ClaimsIdentity();
    context.User = new ClaimsPrincipal(identity);
    return context;
}

async Task<DisabledFixture> CreateDisabledFixture()
{
    var userId = Guid.NewGuid();
    var roleAssignmentId = Guid.NewGuid();
    var subject = @"DLE-OS-HOST\Phase3-Disabled";
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        DECLARE @RoleId uniqueidentifier=(SELECT RoleId FROM security.[Role] WHERE RoleCode='SUPER_ADMIN');
        INSERT security.[User](UserId,UserName,DisplayName,AccountStatus,IsSystemAccount,CreatedBy)
          VALUES(@UserId,N'Phase3Disabled',N'Phase 3 Disabled','DISABLED',0,N'QUALIFICATION');
        INSERT security.ExternalIdentity(ExternalIdentityId,UserId,Provider,Subject,IsActive,CreatedBy)
          VALUES(NEWID(),@UserId,'WINDOWS',@Subject,1,N'QUALIFICATION');
        INSERT security.UserRole(UserRoleId,UserId,RoleId,IsActive,AssignedByActor)
          VALUES(@AssignmentId,@UserId,@RoleId,1,N'QUALIFICATION');
        """;
    await using var command = new SqlCommand(sql, connection);
    command.Parameters.AddWithValue("@UserId", userId);
    command.Parameters.AddWithValue("@AssignmentId", roleAssignmentId);
    command.Parameters.AddWithValue("@Subject", subject);
    await command.ExecuteNonQueryAsync();
    return new DisabledFixture(userId, roleAssignmentId, subject);
}

async Task CleanupDisabledFixture(DisabledFixture fixture)
{
    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    const string sql = """
        DELETE FROM security.UserRole WHERE UserRoleId=@AssignmentId;
        DELETE FROM security.ExternalIdentity WHERE UserId=@UserId;
        DELETE FROM security.[User] WHERE UserId=@UserId;
        """;
    await using var command = new SqlCommand(sql, connection);
    command.Parameters.AddWithValue("@UserId", fixture.UserId);
    command.Parameters.AddWithValue("@AssignmentId", fixture.AssignmentId);
    await command.ExecuteNonQueryAsync();
}

sealed record DisabledFixture(Guid UserId, Guid AssignmentId, string Subject);

sealed class RecordingResolver(IIdentityResolver inner) : IIdentityResolver
{
    public List<string> Subjects { get; } = [];
    public async Task<ResolvedSecurityUser?> ResolveAsync(
        string provider,
        string subject,
        CancellationToken cancellationToken = default)
    {
        Subjects.Add(subject);
        return await inner.ResolveAsync(provider, subject, cancellationToken);
    }
}
