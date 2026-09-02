using System.Security.Principal;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Server.HttpSys;

const string trustedFrontendCaller = @"DLE-OS-HOST\DLE-OS-DEV-FRONTEND";
const string callerPolicy = "DedicatedSyncOperationsCaller";

ControlHostRuntimeConfiguration.ValidateBoundary();
var dependencies = WorkerDependencyManifest.Verify();
var workerPreflight = WorkerIdentityPreflight.RunIfRequested();

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.WebHost.UseHttpSys(options =>
{
    options.UrlPrefixes.Add(ControlHostRuntimeConfiguration.ControlPrefix);
    options.Authentication.Schemes =
        AuthenticationSchemes.Negotiate | AuthenticationSchemes.NTLM;
    options.Authentication.AllowAnonymous = true;
});
builder.Services.AddAuthentication(HttpSysDefaults.AuthenticationScheme);
builder.Services.AddAuthorization(options => options.AddPolicy(
    callerPolicy,
    policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireAssertion(context => string.Equals(
            context.User.Identity?.Name,
            trustedFrontendCaller,
            StringComparison.OrdinalIgnoreCase));
    }));
builder.Services.AddTrustedDevelopmentIdentity();
builder.Services.AddDevelopmentPermissionAuthorization();
builder.Services.AddSingleton<SyncOperationsCenter>();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.UseTrustedDevelopmentIdentity();
app.UseDevelopmentPermissionAuthorization();

// Phase-gate: qualification exercises caller, assertion, and permission checks,
// but cannot enter the state-changing Start method until a later routing phase
// supplies the explicit APPROVED_LIVE_RUN execution mode.
app.Use(async (context, next) =>
{
    if (HttpMethods.IsPost(context.Request.Method) &&
        context.Request.Path.Equals("/api/sync/operations") &&
        !ControlHostRuntimeConfiguration.ExecutionEnabled)
    {
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsJsonAsync(new
        {
            code = "SYNC_OPERATIONS_EXECUTION_DISABLED",
            message = "The dedicated host is qualified for isolation only; real synchronization is disabled.",
            releaseId = ControlHostRuntimeConfiguration.ReleaseId
        });
        return;
    }
    await next();
});

app.MapSyncOperations(callerPolicy);

app.Logger.LogInformation(
    "DedicatedSyncOperationsHostStarting ReleaseId={ReleaseId} Prefix={Prefix} " +
    "ExecutionIdentity={ExecutionIdentity} ExecutionEnabled={ExecutionEnabled} " +
    "VerifiedWorkerDependencies={VerifiedWorkerDependencies} WorkerPreflight={WorkerPreflight}",
    ControlHostRuntimeConfiguration.ReleaseId,
    ControlHostRuntimeConfiguration.ControlPrefix,
    WindowsIdentity.GetCurrent().Name,
    ControlHostRuntimeConfiguration.ExecutionEnabled,
    dependencies.Dependencies.Count,
    workerPreflight is null ? "NOT_REQUESTED" : "PASS");

await app.RunAsync();
