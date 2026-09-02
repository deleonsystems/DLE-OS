using System.Net;
using System.Text.Json;
using Microsoft.Extensions.FileProviders;

SimRuntimeOptions runtime;
try
{
    runtime = SimRuntimeOptions.Create(
        args,
        Environment.GetEnvironmentVariables(),
        Directory.GetCurrentDirectory());
}
catch (InvalidOperationException exception)
{
    Console.Error.WriteLine("DLE-OS SIM startup rejected: " + exception.Message);
    Environment.ExitCode = 2;
    return;
}

var lanCertificate = runtime.LanMode ? runtime.LoadLanCertificate() : null;
var applicationOrigin = runtime.ApplicationOrigin;

Directory.CreateDirectory(runtime.StateRoot);
var personaSessions = new SimPersonaSessionStore();
var simFaults = new SimFaultStore();
var simState = new SimStateStore(runtime.StateRoot);
await simState.InitializeAsync();
var simDocuments = new SimDocumentStore(runtime.RepositoryRoot, runtime.StateRoot);
if (simState.Current.IsHealthy)
    await simDocuments.InitializeAsync();
var operationsData = new SimOperationsDataStore(runtime.RepositoryRoot, runtime.StateRoot);
if (simState.Current.IsHealthy)
    await operationsData.InitializeAsync(simState.Current.Metadata!);
var runtimeMetadataPath = SimRuntimeOptions.ResolveStatePath(runtime.StateRoot, "runtime", "runtime.json");
await File.WriteAllTextAsync(runtimeMetadataPath, JsonSerializer.Serialize(new
{
    environment = "SIM",
    syntheticData = true,
    processId = Environment.ProcessId,
    startedAtUtc = DateTimeOffset.UtcNow,
    binding = applicationOrigin,
    networkBoundary = runtime.LanMode ? "PRIVATE_LAN_HTTPS" : "LOOPBACK_ONLY",
    lanHostName = runtime.LanHostName
}, new JsonSerializerOptions { WriteIndented = true }));

var builder = WebApplication.CreateBuilder();
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(options => options.SingleLine = true);
builder.WebHost.ConfigureKestrel(options =>
{
    if (runtime.LanMode)
        options.Listen(runtime.BindAddress, runtime.Port, listen => listen.UseHttps(lanCertificate!));
    else
        options.Listen(IPAddress.Loopback, runtime.Port);
});

var app = builder.Build();
var sourceProvider = new PhysicalFileProvider(Path.Combine(runtime.RepositoryRoot, "SRC"));
var assetProvider = new PhysicalFileProvider(Path.Combine(runtime.RepositoryRoot, "ASSETS"));
app.Lifetime.ApplicationStopped.Register(sourceProvider.Dispose);
app.Lifetime.ApplicationStopped.Register(assetProvider.Dispose);

app.Use(async (context, next) =>
{
    context.Response.Headers.ContentSecurityPolicy =
        "default-src 'self' data: blob:; " +
        "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; " +
        "font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Permissions-Policy"] =
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()";
    context.Response.Headers.CacheControl = "no-store";
    await next();
});

var allowedHosts = runtime.LanMode
    ? new HashSet<string>([runtime.LanHostName!], StringComparer.OrdinalIgnoreCase)
    : new HashSet<string>(["127.0.0.1", "localhost", "[::1]"], StringComparer.OrdinalIgnoreCase);
app.Use(async (context, next) =>
{
    if (!allowedHosts.Contains(context.Request.Host.Host))
    {
        context.Response.StatusCode = StatusCodes.Status421MisdirectedRequest;
        await context.Response.WriteAsJsonAsync(new
        {
            code = "DLE_OS_SIM_HOST_REJECTED",
            message = "The request Host is not approved for this SIM listener."
        });
        return;
    }
    await next();
});

if (runtime.LanMode)
{
    var lanAccess = new SimLanAccessGuard(runtime.AccessCode!);
    app.Use(lanAccess.InvokeAsync);
}

app.UseStaticFiles(new StaticFileOptions
{
    RequestPath = "/SRC",
    FileProvider = sourceProvider,
    OnPrepareResponse = context =>
        context.Context.Response.Headers.CacheControl = "no-store"
});
app.UseStaticFiles(new StaticFileOptions
{
    RequestPath = "/ASSETS",
    FileProvider = assetProvider,
    OnPrepareResponse = context =>
        context.Context.Response.Headers.CacheControl = "no-store"
});

app.MapGet("/", (HttpContext context) =>
{
    return Results.Text(
        SimShellRenderer.Render(runtime.RepositoryRoot, applicationOrigin,
            runtime.LanMode, runtime.LanMode ? applicationOrigin : null),
        "text/html; charset=utf-8");
});

app.MapGet("/api/runtime/info", () => Results.Json(new
{
    environment = "SIM",
    runtimeMarker = SimRuntimeOptions.EnvironmentMarker,
    environmentLabel = SimRuntimeOptions.EnvironmentLabel,
    syntheticData = true,
    authentication = "SYNTHETIC_PERSONA",
    networkBoundary = runtime.LanMode ? "PRIVATE_LAN_HTTPS" : "LOOPBACK_ONLY",
    lanMode = runtime.LanMode,
    safeUrl = runtime.LanMode ? applicationOrigin : null,
    businessApis = "STATEFUL_VERIFIED_STATUS"
}));

app.MapGet("/api/auth/me", (HttpContext context) =>
{
    var persona = personaSessions.Resolve(context);
    return persona.IsActive
        ? Results.Json(persona.CurrentUserContract())
        : Results.Json(new
        {
            isAuthenticated = true,
            synthetic = true,
            environment = "SIM",
            personaId = persona.Id,
            error = new
            {
                code = "DLE_OS_USER_DISABLED",
                message = "This synthetic DLE-OS persona is disabled."
            }
        }, statusCode: StatusCodes.Status403Forbidden);
});

app.MapGet("/api/sim/personas", (HttpContext context) => Results.Json(new
{
    defaultPersonaId = SimPersonaCatalog.DefaultPersonaId,
    currentPersonaId = personaSessions.Resolve(context).Id,
    personas = SimPersonaCatalog.All.Select(persona => persona.CatalogContract()).ToArray()
}));

app.MapGet("/api/sim/faults", () => Results.Json(simFaults.CatalogContract()));

app.MapPost("/api/sim/fault", (SelectSimFaultRequest request, HttpContext context) =>
{
    var persona = personaSessions.Resolve(context);
    if (!persona.IsActive)
        return Results.Json(new
        {
            code = "DLE_OS_USER_DISABLED",
            message = "The selected synthetic persona is disabled.",
            environment = "SIM"
        }, statusCode: StatusCodes.Status403Forbidden);
    if (!simFaults.TrySelect(request.FaultId))
        return Results.Json(new
        {
            code = "DLE_OS_SIM_FAULT_UNKNOWN",
            message = "The requested SIM fault profile is not defined.",
            environment = "SIM"
        }, statusCode: StatusCodes.Status400BadRequest);
    return Results.Json(new { selectedFaultId = request.FaultId, state = simFaults.StateContract() });
});

app.MapGet("/api/sim/state", () =>
{
    var snapshot = simState.Current;
    return Results.Json(simState.StatusContract(), statusCode: snapshot.IsHealthy
        ? StatusCodes.Status200OK
        : StatusCodes.Status409Conflict);
});

app.MapPost("/api/sim/reset", async (ResetSimStateRequest request, HttpContext context) =>
{
    var reset = await simState.ResetAsync(request, personaSessions, context, async metadata =>
    {
        await simDocuments.RebuildAsync();
        await operationsData.RebuildAsync(metadata);
    });
    if (reset.Result is not null)
    {
        simFaults.Reset();
        return Results.Json(reset.Result);
    }
    var statusCode = reset.ErrorCode switch
    {
        "DLE_OS_SIM_RESET_IN_PROGRESS" => StatusCodes.Status409Conflict,
        "DLE_OS_SIM_STATE_RESET_FAILED" => StatusCodes.Status500InternalServerError,
        _ => StatusCodes.Status400BadRequest
    };
    return Results.Json(new
    {
        code = reset.ErrorCode,
        message = reset.Message,
        environment = "SIM"
    }, statusCode: statusCode);
});

app.MapPost("/api/sim/persona", (SelectSimPersonaRequest request, HttpContext context) =>
{
    var persona = SimPersonaCatalog.Get(request.PersonaId);
    if (persona is null)
    {
        return Results.Json(new
        {
            code = "DLE_OS_SIM_PERSONA_UNKNOWN",
            message = "The requested synthetic persona is not defined."
        }, statusCode: StatusCodes.Status400BadRequest);
    }
    personaSessions.Select(context, persona);
    return Results.Json(new
    {
        selectedPersonaId = persona.Id,
        synthetic = true,
        reloadRequired = true
    });
});

app.MapGet("/api/sim/status", (HttpContext context) => Results.Json(new
{
    status = "READY",
    environment = "SIM",
    syntheticData = true,
    binding = applicationOrigin,
    networkBoundary = runtime.LanMode ? "PRIVATE_LAN_HTTPS" : "LOOPBACK_ONLY",
    lanMode = runtime.LanMode,
    safeUrl = runtime.LanMode ? applicationOrigin : null,
    stateRoot = runtime.StateRoot,
    outboundProviders = Array.Empty<string>(),
    businessApis = "STATEFUL_VERIFIED_STATUS",
    currentPersonaId = personaSessions.Resolve(context).Id,
    fault = simFaults.StateContract(),
    state = simState.StatusContract(),
    operationsCenterData = operationsData.StatusContract(),
    invoiceHistoryData = operationsData.StatusContract(),
    homeOperationsData = operationsData.StatusContract()
}));

app.MapGet("/favicon-32x32.png", () => Results.File(
    Path.Combine(runtime.RepositoryRoot, "ASSETS", "ICONS", "favicon-32x32.png"),
    "image/png"));
app.MapGet("/apple-touch-icon.png", () => Results.File(
    Path.Combine(runtime.RepositoryRoot, "ASSETS", "ICONS", "apple-touch-icon.png"),
    "image/png"));
app.MapGet("/site.webmanifest", () => Results.File(
    Path.Combine(runtime.RepositoryRoot, "ASSETS", "ICONS", "site.webmanifest"),
    "application/manifest+json"));

SimOperationsEndpoints.Map(app, simState, operationsData, personaSessions, simFaults);
SimDocumentEndpoints.Map(app, simState, personaSessions, simDocuments);

app.MapMethods("/api/{**path}",
    [HttpMethods.Get, HttpMethods.Post, HttpMethods.Put, HttpMethods.Delete, HttpMethods.Patch],
    (HttpContext context) =>
    {
        if (!simState.Current.IsHealthy)
        {
            return Results.Json(new
            {
                code = simState.Current.ErrorCode,
                message = simState.Current.Message,
                environment = "SIM",
                resetAvailable = true
            }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        var persona = personaSessions.Resolve(context);
        if (!persona.IsActive)
        {
            return Results.Json(new
            {
                code = "DLE_OS_USER_DISABLED",
                message = "The selected synthetic persona is disabled.",
                environment = "SIM"
            }, statusCode: StatusCodes.Status403Forbidden);
        }
        var requiredPermission = SimAuthorization.ResolvePermission(context.Request);
        if (requiredPermission is not null && !persona.Can(requiredPermission))
        {
            return Results.Json(new
            {
                code = "DLE_OS_PERMISSION_DENIED",
                message = "The selected synthetic persona does not have the required DLE-OS permission.",
                requiredPermission,
                environment = "SIM"
            }, statusCode: StatusCodes.Status403Forbidden);
        }
        return Results.Json(new
        {
            code = "DLE_OS_SIM_BUSINESS_CONTRACT_UNAVAILABLE",
            message = "This DLE-OS application contract is intentionally unavailable in the current SIM phase.",
            path = context.Request.Path.Value,
            requiredPermission,
            environment = "SIM"
        }, statusCode: StatusCodes.Status501NotImplemented);
    });

app.Logger.LogInformation(
    "DLE-OS SIM starting. Environment={Environment}; SyntheticData={SyntheticData}; " +
    "Binding={Binding}; NetworkBoundary={NetworkBoundary}; BusinessApis={BusinessApis}",
    "SIM", true, applicationOrigin,
    runtime.LanMode ? "PRIVATE_LAN_HTTPS" : "LOOPBACK_ONLY", "STATEFUL_VERIFIED_STATUS");

await app.RunAsync();
