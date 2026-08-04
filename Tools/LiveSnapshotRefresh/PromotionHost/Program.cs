using System.Diagnostics;
using System.Security.Principal;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Server.HttpSys;

const string approvedIdentity = @"DLE-OS-HOST\DLE-OS";
const string promotionScript =
    @"C:\DLE-OS\Canonical\LiveMirror\Refresh\Complete-LiveSnapshotPromotion.ps1";
const string runsRoot =
    @"C:\DLE-OS\Canonical\LiveMirror\RefreshRuns";

var identity = WindowsIdentity.GetCurrent();
var principal = new WindowsPrincipal(identity);
if (!string.Equals(
        identity.Name,
        approvedIdentity,
        StringComparison.OrdinalIgnoreCase) ||
    !principal.IsInRole(WindowsBuiltInRole.Administrator))
{
    throw new InvalidOperationException(
        "The promotion broker requires the elevated approved DLE-OS identity.");
}

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.WebHost.UseHttpSys(options =>
{
    options.UrlPrefixes.Add("http://localhost:5044");
    options.Authentication.Schemes =
        AuthenticationSchemes.Negotiate | AuthenticationSchemes.NTLM;
    options.Authentication.AllowAnonymous = true;
});
builder.Services.AddAuthentication(HttpSysDefaults.AuthenticationScheme);
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("LocalPromotionOperator", policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireAssertion(context =>
            string.Equals(
                context.User.Identity?.Name,
                approvedIdentity,
                StringComparison.OrdinalIgnoreCase));
    });
});

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

var gate = new object();
Process? activePromotion = null;

app.MapPost(
        "/api/platform/refresh/v1/promote",
        (HttpRequest request) =>
        {
            var runId = request.Query["runId"].ToString();
            var fixture = string.Equals(
                request.Query["fixture"],
                "true",
                StringComparison.OrdinalIgnoreCase);
            if (!Regex.IsMatch(
                    runId,
                    "^LIVEREFRESH-[0-9]{8}T[0-9]{6}Z-[A-F0-9]{8}$"))
            {
                return Results.BadRequest(new
                {
                    code = "invalid_run_id",
                    message = "Promotion run ID was rejected."
                });
            }
            var runRoot = Path.GetFullPath(Path.Combine(runsRoot, runId));
            if (!string.Equals(
                    Path.GetDirectoryName(runRoot),
                    runsRoot,
                    StringComparison.OrdinalIgnoreCase) ||
                !Directory.Exists(runRoot) ||
                !File.Exists(promotionScript))
            {
                return Results.BadRequest(new
                {
                    code = "invalid_run_boundary",
                    message = "Promotion run boundary is unavailable."
                });
            }

            lock (gate)
            {
                if (activePromotion is { HasExited: false })
                {
                    return Results.Conflict(new
                    {
                        code = "promotion_already_running",
                        message = "A local snapshot promotion is already running."
                    });
                }
                activePromotion?.Dispose();
                var arguments =
                    "-NoLogo -NoProfile -NonInteractive " +
                    "-ExecutionPolicy Bypass -File " +
                    $"\"{promotionScript}\" -RunId {runId}" +
                    (fixture ? " -QualificationCurrentFixture" : "");
                activePromotion = Process.Start(new ProcessStartInfo
                {
                    FileName =
                        Path.Combine(
                            Environment.GetFolderPath(
                                Environment.SpecialFolder.System),
                            @"WindowsPowerShell\v1.0\powershell.exe"),
                    Arguments = arguments,
                    WorkingDirectory = Path.GetDirectoryName(promotionScript)!,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                });
                if (activePromotion is null)
                {
                    return Results.Problem(
                        statusCode: StatusCodes.Status503ServiceUnavailable,
                        title: "The local promotion process could not be started.");
                }
                _ = CaptureAsync(activePromotion, runRoot);
            }
            return Results.Accepted(value: new
            {
                status = "PROMOTION_STARTED",
                runId,
                fixture,
                executionIdentity = identity.Name,
                elevated = true
            });
        })
    .RequireAuthorization("LocalPromotionOperator");

app.MapGet(
        "/health",
        () => Results.Json(new
        {
            status = "Ready",
            executionIdentity = identity.Name,
            elevated = true,
            browserCorsEnabled = false,
            sourceAccess = "NONE"
        }))
    .RequireAuthorization("LocalPromotionOperator");

app.Run();

static async Task CaptureAsync(Process process, string runRoot)
{
    var standardOutput = process.StandardOutput.ReadToEndAsync();
    var standardError = process.StandardError.ReadToEndAsync();
    await process.WaitForExitAsync();
    await File.WriteAllTextAsync(
        Path.Combine(runRoot, "promotion-host.stdout.log"),
        await standardOutput);
    await File.WriteAllTextAsync(
        Path.Combine(runRoot, "promotion-host.stderr.log"),
        await standardError);
}
