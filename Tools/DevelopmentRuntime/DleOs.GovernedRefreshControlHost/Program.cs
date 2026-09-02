using System.Security.Principal;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Server.HttpSys;

const string trustedCaller = @"DLE-OS-HOST\DLE-OS-DEV-FRONTEND";
const string callerPolicy = "GovernedRefreshTrustedCaller";

ControlHostRuntimeConfiguration.ValidateBoundary();
var dependencies = WorkerDependencyManifest.Verify();
var preflight = WorkerIdentityPreflight.RunIfRequested();
var hostInstance = HostInstanceIdentity.Create();

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
builder.Services.AddAuthorization(options => options.AddPolicy(callerPolicy, policy =>
{
    policy.RequireAuthenticatedUser();
    policy.RequireAssertion(context => string.Equals(
        context.User.Identity?.Name, trustedCaller, StringComparison.OrdinalIgnoreCase));
}));
builder.Services.AddTrustedRefreshIdentity();
builder.Services.AddRefreshPermissionAuthorization();
builder.Services.AddSingleton(hostInstance);
builder.Services.AddSingleton(serviceProvider => new LiveRunApprovalStore(
    serviceProvider.GetRequiredService<HostInstanceIdentity>()));
builder.Services.AddSingleton<InvoiceHistoryRefreshCenter>();
builder.Services.AddSingleton<QualificationExecutionCenter>();
builder.Services.AddSingleton<LiveApprovalQualificationCenter>();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.UseTrustedRefreshIdentity();
app.UseRefreshPermissionAuthorization();

app.MapGet("/api/platform/refresh/invoice-history/v1/status",
    (HttpContext context, InvoiceHistoryRefreshCenter center) => Results.Json(center.ReadStatus(context)))
    .RequireAuthorization(callerPolicy);
app.MapPost("/api/platform/refresh/invoice-history/v1/run",
    async (HttpContext context, InvoiceHistoryRefreshCenter center,
        QualificationExecutionCenter qualification,
        LiveApprovalQualificationCenter liveApprovalQualification) =>
        ControlHostRuntimeConfiguration.FailureQualificationEnabled
            ? await qualification.RunAsync(context)
            : ControlHostRuntimeConfiguration.LiveApprovalQualificationEnabled
                ? await liveApprovalQualification.RunAsync(context)
            : center.Start(context))
    .RequireAuthorization(callerPolicy);

app.Logger.LogInformation(
    "GovernedRefreshControlHostStarting ReleaseId={ReleaseId} Prefix={Prefix} Identity={Identity} " +
    "ExecutionMode={ExecutionMode} HostInstanceId={HostInstanceId} Dependencies={Dependencies} WorkerPreflight={WorkerPreflight}",
    ControlHostRuntimeConfiguration.ReleaseId, ControlHostRuntimeConfiguration.ControlPrefix,
    WindowsIdentity.GetCurrent().Name, ControlHostRuntimeConfiguration.ExecutionMode,
    hostInstance.HostInstanceId, dependencies.Dependencies.Count,
    preflight is null ? "NOT_REQUESTED" : "PASS");

await app.RunAsync();
