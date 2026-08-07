using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Server.HttpSys;

const string authorizedOperator = @"DLE-OS-HOST\DLE-OS";
string[] allowedOrigins =
    ["http://dle-os-host:5041", "http://dle-os-host:5051"];
var controlPrefix = ControlHostRuntimeConfiguration.ControlPrefix;
var isolatedDevelopment = ControlHostRuntimeConfiguration.IsIsolatedDevelopment;
const string runnerPath =
    @"C:\DLE-OS\Canonical\LiveMirror\Refresh\Invoke-LiveSnapshotRefresh.ps1";
const string erpRefreshLauncherPath =
    @"C:\DLE-OS\Repositories\DLE-OS\Tools\LiveSnapshotRefresh\Start-LiveSnapshotRefresh.cmd";
const string statePath =
    @"C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json";
const string invoiceRefreshLauncherPath =
    @"C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Start-InvoiceHistoryRefresh.cmd";
const string invoiceRefreshStatePath =
    @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json";
const string corsPolicy = "HistoricalViewerExactOrigin";

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.WebHost.UseHttpSys(options =>
{
    options.UrlPrefixes.Add(controlPrefix);
    options.Authentication.Schemes =
        AuthenticationSchemes.Negotiate | AuthenticationSchemes.NTLM;
    options.Authentication.AllowAnonymous = true;
});
builder.Services
    .AddAuthentication(HttpSysDefaults.AuthenticationScheme);
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("SnapshotRefreshOperator", policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireAssertion(context =>
            string.Equals(
                context.User.Identity?.Name,
                authorizedOperator,
                StringComparison.OrdinalIgnoreCase));
    });
});
builder.Services.AddCors(options =>
{
    options.AddPolicy(
        corsPolicy,
        policy => policy
            .WithOrigins(allowedOrigins)
            .WithMethods(HttpMethods.Get, HttpMethods.Post)
            .WithHeaders("Accept", "Content-Type")
            .AllowCredentials());
});
if (isolatedDevelopment)
{
    builder.Services.AddHostedService<ShipmentReconciliationMonitor>();
    builder.Services.AddTrustedDevelopmentIdentity();
    builder.Services.AddDevelopmentPermissionAuthorization();
}

var app = builder.Build();
app.UseCors(corsPolicy);
app.UseAuthentication();
app.UseAuthorization();
if (isolatedDevelopment)
{
    app.UseTrustedDevelopmentIdentity();
    app.UseDevelopmentPermissionAuthorization();
}
app.Use(async (context, next) =>
{
    if (!isolatedDevelopment)
    {
        await next();
        return;
    }

    var path = context.Request.Path.Value ?? "";
    string[] allowedDevelopmentPaths =
    [
        "/health",
        "/api/work-order-approvals/",
        "/api/kitting-dispositions/",
        "/api/rma-rework/",
        "/api/operational-work-order-relationships/",
        "/api/shipment-staging/",
        "/api/development/identity/"
    ];
    if (allowedDevelopmentPaths.Any(value => path.StartsWith(value, StringComparison.OrdinalIgnoreCase)))
    {
        await next();
        return;
    }

    context.Response.StatusCode = StatusCodes.Status404NotFound;
    await context.Response.WriteAsJsonAsync(new
    {
        code = "development_runtime_route_not_available",
        message = "This isolated development ControlHost exposes operational workflow routes only."
    });
});

var processGate = new object();
Process? currentProcess = null;

object ReadStatus(HttpContext context)
{
    RefreshState state;
    try
    {
        state = File.Exists(statePath)
            ? JsonSerializer.Deserialize<RefreshState>(
                File.ReadAllText(statePath),
                new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                }) ?? new RefreshState()
            : new RefreshState();
    }
    catch
    {
        state = new RefreshState
        {
            Status = "FAILED",
            LastFailureReason = "The protected refresh status could not be read."
        };
    }

    lock (processGate)
    {
        if (currentProcess is { HasExited: false })
        {
            state.Running = true;
            state.Status = "RUNNING";
        }
        else if (currentProcess is not null)
        {
            currentProcess.Dispose();
            currentProcess = null;
        }
    }

    return new
    {
        authorized = string.Equals(
            context.User.Identity?.Name,
            authorizedOperator,
            StringComparison.OrdinalIgnoreCase),
        executionIdentity = WindowsIdentity.GetCurrent().Name,
        state.Running,
        state.Status,
        state.Phase,
        state.Message,
        state.LastSourceCheckUtc,
        state.LastSuccessfulRefreshUtc,
        state.ActiveImportRunId,
        state.CurrentPackageHash,
        state.LastResult,
        state.LastFailureReason,
        state.RunId
    };
}

object ReadInvoiceRefreshStatus(HttpContext context)
{
    InvoiceRefreshState state;
    try
    {
        state = File.Exists(invoiceRefreshStatePath)
            ? JsonSerializer.Deserialize<InvoiceRefreshState>(
                File.ReadAllText(invoiceRefreshStatePath),
                new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                }) ?? new InvoiceRefreshState()
            : new InvoiceRefreshState();
    }
    catch
    {
        state = new InvoiceRefreshState
        {
            Result = "FAILED",
            Message = "The protected Invoice History status could not be read."
        };
    }
    return new
    {
        authorized = string.Equals(
            context.User.Identity?.Name,
            authorizedOperator,
            StringComparison.OrdinalIgnoreCase),
        executionIdentity = authorizedOperator,
        running = string.Equals(
            state.Result, "RUNNING", StringComparison.OrdinalIgnoreCase),
        status = state.Result,
        state.Message,
        state.RefreshRunId,
        state.WindowStart,
        state.WindowEnd,
        state.StartedAtUtc,
        state.UpdatedAtUtc,
        state.Details
    };
}

bool InvoiceRefreshIsRunning()
{
    try
    {
        if (!File.Exists(invoiceRefreshStatePath))
        {
            return false;
        }
        var state = JsonSerializer.Deserialize<InvoiceRefreshState>(
            File.ReadAllText(invoiceRefreshStatePath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        return string.Equals(
            state?.Result, "RUNNING", StringComparison.OrdinalIgnoreCase);
    }
    catch
    {
        return false;
    }
}

bool ErpRefreshIsRunning()
{
    try
    {
        if (!File.Exists(statePath))
        {
            return false;
        }
        var state = JsonSerializer.Deserialize<RefreshState>(
            File.ReadAllText(statePath),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        return state?.Running == true ||
            string.Equals(
                state?.Status, "RUNNING", StringComparison.OrdinalIgnoreCase);
    }
    catch
    {
        return false;
    }
}

app.MapGet(
        "/api/platform/refresh/v1/status",
        (HttpContext context) => Results.Json(ReadStatus(context)))
    .RequireAuthorization("SnapshotRefreshOperator");

app.MapPost(
        "/api/platform/refresh/v1/run",
        (HttpContext context) =>
        {
            lock (processGate)
            {
                if (
                    currentProcess is { HasExited: false } ||
                    ErpRefreshIsRunning()
                )
                {
                    return Results.Conflict(new
                    {
                        code = "already_running",
                        message = "A governed ERP snapshot refresh is already running.",
                        status = "ALREADY_RUNNING",
                        running = true
                    });
                }
                if (
                    !File.Exists(runnerPath) ||
                    !File.Exists(erpRefreshLauncherPath)
                )
                {
                    return Results.Problem(
                        statusCode: StatusCodes.Status503ServiceUnavailable,
                        title: "The governed refresh runner is unavailable.",
                        extensions: new Dictionary<string, object?>
                        {
                            ["code"] = "runner_unavailable"
                        });
                }

                currentProcess?.Dispose();
                currentProcess = Process.Start(new ProcessStartInfo
                {
                    FileName = Path.Combine(
                        Environment.GetFolderPath(
                            Environment.SpecialFolder.Windows),
                        "explorer.exe"),
                    Arguments = $"\"{erpRefreshLauncherPath}\"",
                    UseShellExecute = true
                });
                if (currentProcess is null)
                {
                    return Results.Problem(
                        statusCode: StatusCodes.Status503ServiceUnavailable,
                        title: "The governed refresh runner could not be started.");
                }
            }

            return Results.Accepted(
                "/api/platform/refresh/v1/status",
                new
                {
                    authorized = true,
                    executionIdentity = authorizedOperator,
                    status = "RUNNING",
                    phase = "STARTING",
                    running = true,
                    message =
                        "The governed ERP snapshot refresh runner was started."
                });
        })
    .RequireAuthorization("SnapshotRefreshOperator");

app.MapGet(
        "/api/platform/refresh/invoice-history/v1/status",
        (HttpContext context) =>
            Results.Json(ReadInvoiceRefreshStatus(context)))
    .RequireAuthorization("SnapshotRefreshOperator");

app.MapPost(
        "/api/platform/refresh/invoice-history/v1/run",
        (HttpContext context) =>
        {
            if (InvoiceRefreshIsRunning())
            {
                return Results.Conflict(new
                {
                    code = "already_running",
                    message = "Invoice History refresh is already running.",
                    status = "ALREADY_RUNNING",
                    running = true
                });
            }
            if (!File.Exists(invoiceRefreshLauncherPath))
            {
                return Results.Problem(
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "The Invoice History refresh launcher is unavailable.",
                    extensions: new Dictionary<string, object?>
                    {
                        ["code"] = "invoice_refresh_launcher_unavailable"
                    });
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                    "explorer.exe"),
                Arguments = $"\"{invoiceRefreshLauncherPath}\"",
                UseShellExecute = true
            });
            return Results.Accepted(
                "/api/platform/refresh/invoice-history/v1/status",
                new
                {
                    authorized = true,
                    executionIdentity = authorizedOperator,
                    status = "RUNNING",
                    running = true,
                    message = "The isolated Invoice History refresh was started."
                });
        })
    .RequireAuthorization("SnapshotRefreshOperator");

app.MapGet(
        "/health",
        (HttpContext context) => Results.Json(new
        {
            status = "Ready",
            authenticatedIdentity = context.User.Identity?.Name,
            authorized = string.Equals(
                context.User.Identity?.Name,
                authorizedOperator,
                StringComparison.OrdinalIgnoreCase),
            executionIdentity = WindowsIdentity.GetCurrent().Name,
            runtimeMode = isolatedDevelopment ? "ISOLATED_DEVELOPMENT" : "PRODUCTION",
            controlPrefix,
            canonicalApiBaseUrl = ControlHostRuntimeConfiguration.CanonicalApiBaseUrl,
            operationalDatabase = ControlHostRuntimeConfiguration.OperationalDatabaseName,
            securityDatabase = isolatedDevelopment
                ? ControlHostRuntimeConfiguration.SecurityDatabaseName : null
        }))
    .RequireAuthorization("SnapshotRefreshOperator");

app.MapPlatformRefreshCenter(
    authorizedOperator,
    "SnapshotRefreshOperator");
app.MapOperationsRefresh(
    authorizedOperator,
    "SnapshotRefreshOperator");
app.MapDailyOperationsSync(
    authorizedOperator,
    "SnapshotRefreshOperator");
app.MapWorkOrderApprovals("SnapshotRefreshOperator");
app.MapKittingDispositions("SnapshotRefreshOperator");
app.MapRmaRework("SnapshotRefreshOperator");
app.MapOperationalWorkOrderRelationships("SnapshotRefreshOperator");
if (isolatedDevelopment)
{
    app.MapShipmentStaging("SnapshotRefreshOperator");
    app.MapDevelopmentIdentityAuditFixture("SnapshotRefreshOperator");
}

app.Run();

internal sealed class RefreshState
{
    public bool Running { get; set; }
    public string Status { get; set; } = "READY";
    public string? Phase { get; set; }
    public string? Message { get; set; }
    public string? LastSourceCheckUtc { get; set; }
    public string? LastSuccessfulRefreshUtc { get; set; }
    public string? ActiveImportRunId { get; set; }
    public string? CurrentPackageHash { get; set; }
    public string? LastResult { get; set; }
    public string? LastFailureReason { get; set; }
    public string? RunId { get; set; }
}

internal sealed class InvoiceRefreshState
{
    public string Result { get; set; } = "READY";
    public string? Message { get; set; }
    public string? RefreshRunId { get; set; }
    public string? WindowStart { get; set; }
    public string? WindowEnd { get; set; }
    public string? StartedAtUtc { get; set; }
    public string? UpdatedAtUtc { get; set; }
    public JsonElement? Details { get; set; }
}
