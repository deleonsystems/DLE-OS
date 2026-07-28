using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Server.HttpSys;

const string authorizedOperator = @"DLE-OS-HOST\DLE-OS";
const string allowedOrigin = "http://dle-os-host:5041";
const string controlPrefix = "http://dle-os-host:5043";
const string runnerPath =
    @"C:\DLE-OS\Canonical\LiveMirror\Refresh\Invoke-LiveSnapshotRefresh.ps1";
const string statePath =
    @"C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json";
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
            .WithOrigins(allowedOrigin)
            .WithMethods(HttpMethods.Get, HttpMethods.Post)
            .WithHeaders("Accept")
            .AllowCredentials());
});

var app = builder.Build();
app.UseCors(corsPolicy);
app.UseAuthentication();
app.UseAuthorization();

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
                if (currentProcess is { HasExited: false })
                {
                    return Results.Conflict(new
                    {
                        code = "already_running",
                        message = "A governed ERP snapshot refresh is already running.",
                        status = "ALREADY_RUNNING",
                        running = true
                    });
                }
                if (!File.Exists(runnerPath))
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
                    FileName =
                        Path.Combine(
                            Environment.GetFolderPath(
                                Environment.SpecialFolder.System),
                            @"WindowsPowerShell\v1.0\powershell.exe"),
                    Arguments =
                        "-NoLogo -NoProfile -NonInteractive " +
                        "-ExecutionPolicy Bypass -File " +
                        $"\"{runnerPath}\"",
                    WorkingDirectory = Path.GetDirectoryName(runnerPath)!,
                    UseShellExecute = false,
                    CreateNoWindow = true
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
                    executionIdentity = WindowsIdentity.GetCurrent().Name,
                    status = "RUNNING",
                    phase = "STARTING",
                    running = true,
                    message =
                        "The governed ERP snapshot refresh runner was started."
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
            executionIdentity = WindowsIdentity.GetCurrent().Name
        }))
    .RequireAuthorization("SnapshotRefreshOperator");

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
