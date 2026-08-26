using System.Security.Principal;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Server.HttpSys;

const string operatorIdentity = @"DLE-OS-HOST\DLE-OS";
string[] authorizedServiceCallers =
[
    operatorIdentity,
    @"DLE-OS-HOST\DLE-OS-DEV-FRONTEND"
];

ControlHostRuntimeConfiguration.ValidateBoundary();

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.WebHost.UseHttpSys(options =>
{
    options.UrlPrefixes.Add(ControlHostRuntimeConfiguration.ControlPrefix);
    options.Authentication.Schemes = AuthenticationSchemes.Negotiate | AuthenticationSchemes.NTLM;
    options.Authentication.AllowAnonymous = true;
});
builder.Services.AddAuthentication(HttpSysDefaults.AuthenticationScheme);
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("DevOperationalCaller", policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireAssertion(context => authorizedServiceCallers.Contains(
            context.User.Identity?.Name ?? "", StringComparer.OrdinalIgnoreCase));
    });
});
builder.Services.AddCors(options => options.AddPolicy("DevFrontendOnly", policy => policy
    .WithOrigins("http://dle-os-host:5051", "https://dev.dle-os.internal.dlemfg.com")
    .WithMethods(HttpMethods.Get, HttpMethods.Post, HttpMethods.Put)
    .WithHeaders("Accept", "Content-Type")
    .AllowCredentials()));
builder.Services.AddHostedService<ShipmentReconciliationMonitor>();
builder.Services.AddTrustedDevelopmentIdentity();
builder.Services.AddDevelopmentPermissionAuthorization();

var app = builder.Build();
await DevOperationalSchema.ValidateAsync();
app.UseCors("DevFrontendOnly");
app.UseAuthentication();
app.UseAuthorization();
app.UseTrustedDevelopmentIdentity();
app.UseDevelopmentPermissionAuthorization();

app.MapGet("/health", (HttpContext context) => Results.Json(new
{
    status = "Ready",
    authenticatedIdentity = context.User.Identity?.Name,
    executionIdentity = WindowsIdentity.GetCurrent().Name,
    runtimeMode = "DEV_OPERATIONAL_ONLY",
    canonicalAccess = "HTTP_READ_ONLY_VIA_5052",
    canonicalApiBaseUrl = ControlHostRuntimeConfiguration.CanonicalApiBaseUrl,
    operationalDatabase = ControlHostRuntimeConfiguration.OperationalDatabaseName,
    securityDatabase = ControlHostRuntimeConfiguration.SecurityDatabaseName,
    devDataRoot = ControlHostRuntimeConfiguration.DevDataRoot
})).RequireAuthorization("DevOperationalCaller");

app.MapWorkOrderApprovals("DevOperationalCaller");
app.MapKittingDispositions("DevOperationalCaller");
app.MapKittingCases("DevOperationalCaller");
app.MapRmaRework("DevOperationalCaller");
app.MapOperationalWorkOrderRelationships("DevOperationalCaller");
app.MapOperationsCenterVerifiedStatuses("DevOperationalCaller");
app.MapShipmentStaging("DevOperationalCaller");
app.MapDevelopmentIdentityAuditFixture("DevOperationalCaller");

app.Run();
