using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

var checks = new List<string>();
var repository = Directory.GetCurrentDirectory();
var testRoot = Path.Combine(repository, ".tmp", "dev-auth-session-persistence", Guid.NewGuid().ToString("N"));
var keyRoot = Path.Combine(testRoot, "keys");
var ticketRoot = Path.Combine(testRoot, "tickets");
Directory.CreateDirectory(testRoot);

try
{
    var providerOne = CreateProvider(keyRoot);
    var storeOne = CreateStore(ticketRoot, providerOne);
    const string idToken = "test-id-token-must-never-appear-in-storage";
    const string accessToken = "test-access-token-must-never-appear-in-storage";
    var properties = new AuthenticationProperties
    {
        IssuedUtc = DateTimeOffset.UtcNow,
        ExpiresUtc = DateTimeOffset.UtcNow.AddMinutes(30)
    };
    properties.StoreTokens([
        new AuthenticationToken { Name = "id_token", Value = idToken },
        new AuthenticationToken { Name = "access_token", Value = accessToken }
    ]);
    var ticket = new AuthenticationTicket(
        new ClaimsPrincipal(new ClaimsIdentity([
            new Claim("sub", "fixture-miguel-subject"),
            new Claim("preferred_username", "fixture-miguel")
        ], DleOsOidcSchemes.Cookie)),
        properties,
        DleOsOidcSchemes.Cookie);

    var key = await storeOne.StoreAsync(ticket);
    Check(key.Length == 64 && key.All(Uri.IsHexDigit),
        "session store issues an unguessable path-safe ticket key");
    var ticketPath = Directory.GetFiles(ticketRoot, "*.ticket").Single();
    var storedText = Encoding.UTF8.GetString(await File.ReadAllBytesAsync(ticketPath));
    Check(!storedText.Contains(idToken, StringComparison.Ordinal) &&
          !storedText.Contains(accessToken, StringComparison.Ordinal) &&
          !storedText.Contains("fixture-miguel", StringComparison.Ordinal),
        "persistent ticket file contains no plaintext token or identity material");

    var providerTwo = CreateProvider(keyRoot);
    var storeTwo = CreateStore(ticketRoot, providerTwo);
    var restored = await storeTwo.RetrieveAsync(key);
    Check(restored?.Principal.FindFirst("sub")?.Value == "fixture-miguel-subject" &&
          restored.Properties.GetTokenValue("id_token") == idToken,
        "a new provider and ticket-store instance restores the authenticated session");

    await storeTwo.RemoveAsync(key);
    Check(await storeOne.RetrieveAsync(key) is null && !File.Exists(ticketPath),
        "explicit sign-out revokes persistent server-side session state");

    var expiredProperties = new AuthenticationProperties
    {
        IssuedUtc = DateTimeOffset.UtcNow.AddHours(-1),
        ExpiresUtc = DateTimeOffset.UtcNow.AddMinutes(-1)
    };
    var expiredKey = await storeOne.StoreAsync(new AuthenticationTicket(
        ticket.Principal, expiredProperties, DleOsOidcSchemes.Cookie));
    Check(await storeTwo.RetrieveAsync(expiredKey) is null &&
          !File.Exists(Path.Combine(ticketRoot, expiredKey + ".ticket")),
        "expired sessions fail closed and are removed");

    var tamperedKey = await storeOne.StoreAsync(ticket);
    var tamperedPath = Path.Combine(ticketRoot, tamperedKey + ".ticket");
    var tampered = await File.ReadAllBytesAsync(tamperedPath);
    tampered[tampered.Length / 2] ^= 0x5A;
    await File.WriteAllBytesAsync(tamperedPath, tampered);
    Check(await storeTwo.RetrieveAsync(tamperedKey) is null && !File.Exists(tamperedPath),
        "tampered session state fails closed and is revoked");

    var keyDocuments = Directory.GetFiles(keyRoot, "key-*.xml");
    Check(keyDocuments.Length > 0 && keyDocuments.All(path =>
          File.ReadAllText(path).Contains("Dpapi", StringComparison.OrdinalIgnoreCase)),
        "Data Protection key material is encrypted with Windows DPAPI");

    var programSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
        "DleOs.DevelopmentFrontend", "Program.cs"));
    var deploymentSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
        "Deploy-DleOsDevelopmentFrontendWindowsService.ps1"));
    var bootstrapSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
        "DleOs.DevelopmentFrontend", "DleOsWindowsServiceBootstrap.cs"));
    var runtimeInfoSource = File.ReadAllText(Path.Combine(repository, "Tools", "DevelopmentRuntime",
        "DleOs.DevelopmentFrontend", "DevRuntimeBuildInfo.cs"));

    Check(programSource.Contains("PersistKeysToFileSystem") &&
          programSource.Contains("ProtectKeysWithDpapi(protectToLocalMachine: true)"),
        "frontend explicitly persists DPAPI-protected DEV Data Protection keys");
    Check(!programSource.Contains("ProtocolMessage.Prompt = \"login\"") &&
          programSource.Contains("ProtocolMessage.RedirectUri = canonicalApplicationOrigin"),
        "normal DEV challenges allow Keycloak SSO without changing the governed callback");
    Check(programSource.Contains("[DleOsOidcSchemes.Cookie, DleOsOidcSchemes.OpenIdConnect]") &&
          programSource.Contains("PostLogoutRedirectUri = canonicalApplicationOrigin + \"/auth/signin\""),
        "explicit logout revokes the app session, invokes Keycloak end-session, and returns directly to sign-in");
    Check(bootstrapSource.Contains("DLE_OS_AUTHENTICATION_STATE_ROOT") &&
          bootstrapSource.Contains(@"C:\ProgramData\DLE-OS\DevelopmentFrontend\AuthState"),
        "authentication state is fail-closed to the isolated DEV storage root");
    Check(deploymentSource.Contains("/inheritance:r") &&
          deploymentSource.Contains("S-1-1-0") && deploymentSource.Contains("S-1-5-11") &&
          deploymentSource.Contains("S-1-5-32-545") &&
          deploymentSource.Contains("BroadLocalAccess=$false"),
        "deployment hardens and verifies the authentication-state ACL");
    Check(!runtimeInfoSource.Contains("AuthenticationStateRoot") &&
          !runtimeInfoSource.Contains("DataProtectionKeys") &&
          !runtimeInfoSource.Contains("Tickets"),
        "runtime-info response exposes no authentication storage material");

    var fetchContext = new DefaultHttpContext();
    fetchContext.Request.Path = "/SRC/workspaces/kitting/kitting-workspace.html";
    fetchContext.Request.Headers["Sec-Fetch-Mode"] = "cors";
    Check(OidcChallengeBehavior.RequiresStatusCode(fetchContext.Request),
        "same-origin fetch challenges use a status response instead of a cross-origin OIDC redirect");
    Check(OidcChallengeBehavior.IsBrowserFetch(fetchContext.Request) &&
          programSource.Contains("StatusCodes.Status403Forbidden") &&
          programSource.Contains("X-DLE-OS-Authentication-Required"),
        "browser session expiry avoids HTTP.sys native-auth negotiation and remains explicitly identifiable");
    var navigationContext = new DefaultHttpContext();
    navigationContext.Request.Path = "/";
    navigationContext.Request.Headers["Sec-Fetch-Mode"] = "navigate";
    Check(!OidcChallengeBehavior.RequiresStatusCode(navigationContext.Request),
        "interactive navigation still uses the governed Keycloak redirect");
    var apiContext = new DefaultHttpContext();
    apiContext.Request.Path = "/api/auth/me";
    Check(OidcChallengeBehavior.RequiresStatusCode(apiContext.Request),
        "API challenges remain status-code responses without login HTML");
    Check(programSource.Contains("AddPolicyScheme(DleOsOidcSchemes.Challenge") &&
          programSource.Contains("OidcChallengeBehavior.RequiresStatusCode(context.Request)") &&
          programSource.Contains("? DleOsOidcSchemes.Cookie") &&
          programSource.Contains(": DleOsOidcSchemes.OpenIdConnect"),
        "challenge selection occurs before OIDC correlation cookies are generated");

    Console.WriteLine($"PASS: {checks.Count} persistent DEV authentication session checks.");
    foreach (var check in checks) Console.WriteLine("  " + check);
}
finally
{
    if (Directory.Exists(testRoot)) Directory.Delete(testRoot, recursive: true);
}

IDataProtectionProvider CreateProvider(string path)
{
    Directory.CreateDirectory(path);
    return DataProtectionProvider.Create(new DirectoryInfo(path), builder => builder
        .SetApplicationName("DLE-OS-DevelopmentFrontend-DEV")
        .ProtectKeysWithDpapi(protectToLocalMachine: true));
}

ServerSideOidcTicketStore CreateStore(string path, IDataProtectionProvider provider) =>
    new(path, provider, NullLogger<ServerSideOidcTicketStore>.Instance);

void Check(bool condition, string name)
{
    if (!condition) throw new Exception("FAILED: " + name);
    checks.Add(name);
}
