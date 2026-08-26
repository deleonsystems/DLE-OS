using System.Security.Principal;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Server.HttpSys;

const string operatorIdentity = @"DLE-OS-HOST\DLE-OS";
string[] authorizedServiceCallers =
[
    operatorIdentity,
    @"DLE-OS-HOST\DLE-OS-DEV-FRONTEND"
];

var serviceBootstrap = Dev5054WindowsServiceBootstrap.Apply(args);
ControlHostRuntimeConfiguration.ValidateBoundary();

var builder = WebApplication.CreateBuilder(serviceBootstrap.ApplicationArguments);
if (serviceBootstrap.IsWindowsService)
    builder.Host.UseWindowsService(options => options.ServiceName = serviceBootstrap.ServiceName);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
var releaseId = Environment.GetEnvironmentVariable("DLE_OS_RELEASE_ID") ?? "UNKNOWN_RELEASE";
var sourceIdentity = Environment.GetEnvironmentVariable("DLE_OS_SOURCE_IDENTITY") ?? "UNKNOWN_SOURCE";
var logRoot = Environment.GetEnvironmentVariable("DLE_OS_DEV_LOG_ROOT") ??
    @"C:\ProgramData\DLE-OS\DevelopmentOperationalControl\DevOnly\Logs";
builder.Logging.AddProvider(new DevJsonFileLoggerProvider(logRoot, releaseId, sourceIdentity));
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
var lifecycleLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("DleOs.Dev5054.Lifecycle");
if (serviceBootstrap.IsWindowsService)
    lifecycleLogger.LogInformation(new EventId(1004, "WindowsServiceModeEnabled"),
        "WindowsServiceModeEnabled ServiceName={ServiceName} ReleaseId={ReleaseId} ProcessId={ProcessId}",
        serviceBootstrap.ServiceName, releaseId, Environment.ProcessId);
AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) => lifecycleLogger.LogCritical(
    new EventId(9001, "UnhandledException"), eventArgs.ExceptionObject as Exception,
    "UnhandledException IsTerminating={IsTerminating}", eventArgs.IsTerminating);
TaskScheduler.UnobservedTaskException += (_, eventArgs) =>
{
    lifecycleLogger.LogError(new EventId(9002, "UnobservedTaskException"), eventArgs.Exception,
        "UnobservedTaskException");
    eventArgs.SetObserved();
};
app.Lifetime.ApplicationStarted.Register(() => lifecycleLogger.LogInformation(
    new EventId(1001, "ApplicationStarted"),
    "ApplicationStarted ReleaseId={ReleaseId} SourceIdentity={SourceIdentity} ExecutionIdentity={ExecutionIdentity} ProcessId={ProcessId}",
    releaseId, sourceIdentity, WindowsIdentity.GetCurrent().Name, Environment.ProcessId));
app.Lifetime.ApplicationStopping.Register(() => lifecycleLogger.LogInformation(
    new EventId(1002, "ApplicationStopping"), "ApplicationStopping ReleaseId={ReleaseId} ProcessId={ProcessId}",
    releaseId, Environment.ProcessId));
app.Lifetime.ApplicationStopped.Register(() => lifecycleLogger.LogInformation(
    new EventId(1003, "ApplicationStopped"), "ApplicationStopped ReleaseId={ReleaseId} ProcessId={ProcessId}",
    releaseId, Environment.ProcessId));

try
{
    lifecycleLogger.LogInformation(new EventId(1000, "StartupValidationBeginning"),
        "StartupValidationBeginning ReleaseId={ReleaseId} SourceIdentity={SourceIdentity}", releaseId, sourceIdentity);
    await DevOperationalSchema.ValidateAsync();
    lifecycleLogger.LogInformation(new EventId(1010, "DatabaseValidationPassed"),
        "DatabaseValidationPassed OperationalDatabase={OperationalDatabase} SecurityDatabase={SecurityDatabase}",
        ControlHostRuntimeConfiguration.OperationalDatabaseName, ControlHostRuntimeConfiguration.SecurityDatabaseName);
}
catch (Exception exception)
{
    lifecycleLogger.LogCritical(new EventId(9500, "StartupValidationFailed"), exception,
        "StartupValidationFailed Classification={Classification}", DevRequestLogging.Classify(exception));
    throw;
}
app.Use((context, next) => DevRequestLogging.InvokeAsync(
    context, next, context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("DleOs.Dev5054.Request")));
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
    devDataRoot = ControlHostRuntimeConfiguration.DevDataRoot,
    releaseId,
    sourceIdentity,
    durableLogRoot = logRoot,
    logRetentionDays = DevJsonFileLoggerProvider.RetentionDays,
    logMaximumFileBytes = DevJsonFileLoggerProvider.MaximumFileBytes,
    logMaximumTotalBytes = DevJsonFileLoggerProvider.MaximumTotalBytes,
    logMaximumArchiveFiles = DevJsonFileLoggerProvider.MaximumArchiveFiles
})).RequireAuthorization("DevOperationalCaller");

app.MapWorkOrderApprovals("DevOperationalCaller");
app.MapKittingDispositions("DevOperationalCaller");
app.MapKittingCases("DevOperationalCaller");
app.MapRmaRework("DevOperationalCaller");
app.MapOperationalWorkOrderRelationships("DevOperationalCaller");
app.MapOperationsCenterVerifiedStatuses("DevOperationalCaller");
app.MapShipmentStaging("DevOperationalCaller");
app.MapDevelopmentIdentityAuditFixture("DevOperationalCaller");

try
{
    await app.RunAsync();
}
catch (Exception exception)
{
    lifecycleLogger.LogCritical(new EventId(9999, "ApplicationFatal"), exception,
        "ApplicationFatal Classification={Classification} ReleaseId={ReleaseId}",
        DevRequestLogging.Classify(exception), releaseId);
    throw;
}
finally
{
    lifecycleLogger.LogInformation(new EventId(1099, "ProcessExit"),
        "ProcessExit ReleaseId={ReleaseId} ProcessId={ProcessId}", releaseId, Environment.ProcessId);
}
