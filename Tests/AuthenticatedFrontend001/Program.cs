using System.Security.Claims;
using System.Security.Principal;
using System.Text.Json;
using DleOs.Security;
using Microsoft.AspNetCore.Http;

var checks = new List<string>();
const string miguelWindowsSubject = @"DLE-OS-HOST\Miguel";
const string miguelKeycloakSubject = "fixture-keycloak-miguel";
var superAdminRole = new SecurityRole(
    Guid.Parse("10000000-0000-0000-0000-000000000001"), "SUPER_ADMIN", true);
var miguelUser = new ResolvedSecurityUser(
    Guid.Parse("10000000-0000-0000-0000-000000000054"),
    "Miguel", "Miguel De Leon", "ACTIVE", [superAdminRole],
    new HashSet<string>(StringComparer.Ordinal));
var devKittingRole = new SecurityRole(
    Guid.Parse("90000000-0000-4000-8000-000000000002"), "DEV_KITTING_OPERATOR", false);
var devKittingUser = new ResolvedSecurityUser(
    Guid.Parse("90000000-0000-4000-8000-000000000001"),
    "dev.kitting", "Kitting Operator", "ACTIVE", [devKittingRole],
    new HashSet<string>(
        ["kitting.view", "kitting.disposition", "work_orders.view", "pick_list.view", "rma_rework.view"],
        StringComparer.Ordinal));
var danielUser = new ResolvedSecurityUser(
    Guid.Parse("10000000-0000-0000-0000-000000000083"),
    "Daniel", "Daniel Garcia", "PENDING", [],
    new HashSet<string>(StringComparer.Ordinal));
var disabledUser = new ResolvedSecurityUser(
    Guid.Parse("10000000-0000-0000-0000-000000000099"),
    "DisabledFixture", "Disabled Fixture", "DISABLED", [superAdminRole],
    new HashSet<string>(StringComparer.Ordinal));
var resolver = new FixtureIdentityResolver(new Dictionary<string, ResolvedSecurityUser>(
    StringComparer.OrdinalIgnoreCase)
{
    [$"WINDOWS|{miguelWindowsSubject}"] = miguelUser,
    [$"KEYCLOAK|{miguelKeycloakSubject}"] = miguelUser,
    ["KEYCLOAK|fixture-keycloak-dev-kitting"] = devKittingUser,
    [@"WINDOWS|DLE-OS-HOST\Phase3-Disabled"] = disabledUser
});

var miguel = await Resolve(miguelWindowsSubject, resolver);
Check(miguel.Status == CurrentUserStatus.Active, "deterministic Miguel fixture is active");
var miguelResponse = CurrentUserResponseFactory.Create(miguel);
var miguelJson = JsonSerializer.Serialize(
    miguelResponse.Body,
    new JsonSerializerOptions(JsonSerializerDefaults.Web));
Check(miguelResponse.StatusCode == 200, "fixture current-user response is HTTP 200");
Check(miguelJson.Contains("Miguel De Leon") && miguelJson.Contains("SUPER_ADMIN") &&
      miguelJson.Contains("\"isSuperAdmin\":true"), "fixture response contains display identity and SUPER_ADMIN");
Check(!miguelJson.Contains("DLE-OS-HOST") && !miguelJson.Contains("UserId", StringComparison.OrdinalIgnoreCase),
    "normal current-user response excludes Windows identity and SQL IDs");

var devKitting = await new CurrentUserContext(
    new HttpContextAccessor { HttpContext = OidcContext("fixture-keycloak-dev-kitting", "dev.kitting") },
    resolver).ResolveAsync();
var devKittingJson = JsonSerializer.Serialize(
    CurrentUserResponseFactory.Create(devKitting).Body,
    new JsonSerializerOptions(JsonSerializerDefaults.Web));
Check(devKitting.Status == CurrentUserStatus.Active &&
      devKittingJson.Contains("\"displayName\":\"Kitting Operator\"") &&
      devKittingJson.Contains("\"roles\":[\"DEV_KITTING_OPERATOR\"]") &&
      devKittingJson.Contains("\"kitting.view\"") &&
      devKittingJson.Contains("\"isSuperAdmin\":false") &&
      !devKittingJson.Contains("SUPER_ADMIN"),
    "dev.kitting receives its Kitting identity and permission projection without SUPER_ADMIN");

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

var pendingDaniel = CurrentUserResponseFactory.Create(
    new CurrentUserResolution(CurrentUserStatus.PendingAuthentication, null, danielUser));
Check(danielUser.AccountStatus == "PENDING" && pendingDaniel.StatusCode == 403 &&
      pendingDaniel.Code == "DLE_OS_AUTHENTICATION_PENDING",
    "deterministic pending-auth user remains distinct from disabled and unmapped users");

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

var oidcSubject = miguelKeycloakSubject;
var mixedPrincipal = new ClaimsPrincipal([
    new ClaimsIdentity([new Claim(ClaimTypes.Name, @"DLE-OS-HOST\Miguel")], "Negotiate"),
    new ClaimsIdentity([
        new Claim("sub", oidcSubject),
        new Claim("preferred_username", "miguel")
    ], "AuthenticationTypes.Federation")
]);
var oidcContext = new DefaultHttpContext { User = mixedPrincipal };
var oidcRecordingResolver = new RecordingResolver(resolver);
await new CurrentUserContext(
    new HttpContextAccessor { HttpContext = oidcContext }, oidcRecordingResolver).ResolveAsync();
Check(oidcRecordingResolver.Providers.Single() == "KEYCLOAK" &&
      oidcRecordingResolver.Subjects.Single() == oidcSubject,
    "validated OIDC sub takes precedence over Windows fallback identity");

var cachedResolver = new RecordingResolver(resolver);
var cachedContext = new CurrentUserContext(
    new HttpContextAccessor { HttpContext = Context(@"DLE-OS-HOST\Miguel", true) }, cachedResolver);
await cachedContext.ResolveAsync();
await cachedContext.ResolveAsync();
Check(cachedResolver.Subjects.Count == 1, "request-scoped current-user resolution is cached once");

var unavailable = new CurrentUserResolution(
    CurrentUserStatus.SecurityUnavailable, miguelWindowsSubject, null);
var unavailableResponse = CurrentUserResponseFactory.Create(unavailable);
Check(unavailable.Status == CurrentUserStatus.SecurityUnavailable && unavailableResponse.StatusCode == 503 &&
      unavailableResponse.Code == "DLE_OS_SECURITY_UNAVAILABLE",
    "security outage is distinct from anonymous identity");

var disabled = await Resolve(@"DLE-OS-HOST\Phase3-Disabled", resolver);
var disabledResponse = CurrentUserResponseFactory.Create(disabled);
Check(disabled.Status == CurrentUserStatus.Disabled && disabledResponse.StatusCode == 403 &&
      disabledResponse.Code == "DLE_OS_USER_DISABLED", "disabled mapped user receives governed 403");
Check(disabled.User?.IsSuperAdmin == false, "disabled account cannot become effective SUPER_ADMIN");

var shell = DevelopmentIdentityUi.Inject("<html><body><main>DLE-OS</main></body></html>");
Check(shell.Contains("dle-auth-identity") && shell.Contains("/api/auth/me") &&
      shell.Contains("SUPER_ADMIN") && shell.Contains("Miguel") == false,
    "frontend identity display is driven by server current-user API, not hard-coded Miguel data");
var embeddedShell = DevelopmentIdentityUi.Inject(
    "<html><body><main>DLE-OS</main></body></html>",
    miguelJson);
Check(embeddedShell.IndexOf("dle-authorization-bootstrap", StringComparison.Ordinal) <
      embeddedShell.IndexOf("<main>DLE-OS</main>", StringComparison.Ordinal) &&
      embeddedShell.Contains("window.DleOsAuthorizationReady") &&
      embeddedShell.Contains("JSON.parse(atob('") &&
      embeddedShell.Contains("Miguel") == false,
    "authenticated shell installs a neutral fail-closed bootstrap and safely embeds resolved identity before application markup");
var encodedMiguelIdentity = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(miguelJson));
Check(embeddedShell.Contains("JSON.parse(atob('" + encodedMiguelIdentity + "'))") &&
      miguelJson.Contains("\"user\":") &&
      miguelJson.Contains("\"displayName\":\"Miguel De Leon\"") &&
      miguelJson.Contains("\"roles\":[\"SUPER_ADMIN\"]") &&
      miguelJson.Contains("\"permissions\":[]") &&
      miguelJson.Contains("\"isSuperAdmin\":true"),
    "embedded bootstrap preserves the camel-case API identity, role, permission, and SUPER_ADMIN projection");
Check(DevelopmentIdentityUi.AccessStateDocument("DLE_OS_USER_NOT_PROVISIONED").Contains("not provisioned") &&
      DevelopmentIdentityUi.AccessStateDocument("DLE_OS_AUTHENTICATION_PENDING").Contains("awaiting") &&
      DevelopmentIdentityUi.AccessStateDocument("DLE_OS_USER_DISABLED").Contains("disabled") &&
      DevelopmentIdentityUi.AccessStateDocument("DLE_OS_SECURITY_UNAVAILABLE").Contains("temporarily unavailable"),
    "frontend has distinct unmapped, disabled, and unavailable access states");

var evidence = new
{
    verdict = "PASS",
    completedAtUtc = DateTimeOffset.UtcNow,
    mode = "DETERMINISTIC_IDENTITY_FIXTURE",
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

DefaultHttpContext OidcContext(string subject, string userName)
{
    var context = new DefaultHttpContext();
    context.User = new ClaimsPrincipal(new ClaimsIdentity([
        new Claim("sub", subject),
        new Claim("preferred_username", userName)
    ], "Federation"));
    return context;
}

sealed class FixtureIdentityResolver(
    IReadOnlyDictionary<string, ResolvedSecurityUser> identities) : IIdentityResolver
{
    public Task<ResolvedSecurityUser?> ResolveAsync(
        string provider,
        string subject,
        CancellationToken cancellationToken = default)
    {
        identities.TryGetValue($"{provider.Trim().ToUpperInvariant()}|{subject.Trim()}", out var user);
        return Task.FromResult(user);
    }
}

sealed class RecordingResolver(IIdentityResolver inner) : IIdentityResolver
{
    public List<string> Providers { get; } = [];
    public List<string> Subjects { get; } = [];
    public async Task<ResolvedSecurityUser?> ResolveAsync(
        string provider,
        string subject,
        CancellationToken cancellationToken = default)
    {
        Providers.Add(provider);
        Subjects.Add(subject);
        return await inner.ResolveAsync(provider, subject, cancellationToken);
    }
}
