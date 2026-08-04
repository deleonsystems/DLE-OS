using System.Diagnostics;
using System.Text.Json.Nodes;

internal static class DailyOperationsSyncCenter
{
    private const string StatusPath =
        @"C:\DLE-OS\Canonical\DailyOperationsSync\State\status.json";
    private const string HistoryPath =
        @"C:\DLE-OS\Canonical\DailyOperationsSync\State\runs.jsonl";
    private const string LastSuccessfulPath =
        @"C:\DLE-OS\Canonical\DailyOperationsSync\State\last-successful.json";
    private const string LockPath =
        @"C:\DLE-OS\Canonical\DailyOperationsSync\State\daily-operations-sync.lock";
    private const string Launcher =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\DailyOperationsSync\Start-DailyOperationsSync.cmd";
    private static readonly string[] IncompatibleStatePaths =
    [
        @"C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json",
        @"C:\DLE-OS\Canonical\OperationsRefresh\State\status.json",
        @"C:\DLE-OS\Canonical\CustomerMaster\Refresh\State\status.json",
        @"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\status.json"
    ];
    private static readonly object Gate = new();

    internal static void MapDailyOperationsSync(
        this WebApplication app, string authorizedOperator, string policy)
    {
        app.MapGet("/api/platform/daily-operations-sync/v1/status",
                () => Results.Json(Read(StatusPath) ?? Ready()))
            .RequireAuthorization(policy);
        app.MapGet("/api/platform/daily-operations-sync/v1/latest",
                () => Results.Json(ReadLatest() ?? Ready()))
            .RequireAuthorization(policy);
        app.MapGet("/api/platform/daily-operations-sync/v1/last-successful",
                () => Read(LastSuccessfulPath) is { } value
                    ? Results.Json(value)
                    : Results.NotFound(new { code = "no_successful_synchronization" }))
            .RequireAuthorization(policy);
        app.MapPost("/api/platform/daily-operations-sync/v1/run",
                (HttpContext context) => Start(context, authorizedOperator))
            .RequireAuthorization(policy);
    }

    private static IResult Start(HttpContext context, string authorizedOperator)
    {
        lock (Gate)
        {
            var state = Read(StatusPath);
            if (File.Exists(LockPath) || string.Equals(
                    state?["OverallStatus"]?.ToString() ?? state?["overallStatus"]?.ToString(),
                    "RUNNING", StringComparison.OrdinalIgnoreCase))
            {
                return Results.Conflict(new { code = "already_running", status = "RUNNING" });
            }
            if (IncompatibleStatePaths.Any(path => StateIsRunning(Read(path))))
            {
                return Results.Conflict(new
                {
                    code = "already_running",
                    status = "RUNNING",
                    message = "An incompatible governed live-source operation is already running."
                });
            }
            if (!File.Exists(Launcher))
                return Results.Json(new { code = "runner_unavailable" }, statusCode: 503);
            var process = Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(
                    Environment.SpecialFolder.Windows), "explorer.exe"),
                Arguments = $"\"{Launcher}\"",
                UseShellExecute = true
            });
            if (process is null)
                return Results.Json(new { code = "runner_start_failed" }, statusCode: 503);
            return Results.Accepted(
                "/api/platform/daily-operations-sync/v1/status",
                new { status = "RUNNING", requestedBy = context.User.Identity?.Name,
                    executionIdentity = authorizedOperator });
        }
    }

    private static JsonObject Ready() => new()
    {
        ["ContractVersion"] = "daily-operations-sync-v1",
        ["OverallStatus"] = "READY",
        ["Components"] = new JsonArray(
            "Customer Master", "Sales Orders", "Work Orders",
            "Work Order Relationships", "Validation", "Promotion")
    };

    private static JsonObject? ReadLatest()
    {
        try
        {
            if (!File.Exists(HistoryPath)) return Read(StatusPath);
            var line = File.ReadLines(HistoryPath)
                .LastOrDefault(value => !string.IsNullOrWhiteSpace(value));
            return line is null ? Read(StatusPath) : JsonNode.Parse(line) as JsonObject;
        }
        catch { return Read(StatusPath); }
    }

    private static JsonObject? Read(string path)
    {
        try { return File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path)) as JsonObject : null; }
        catch { return null; }
    }

    private static bool StateIsRunning(JsonObject? state)
    {
        if (state is null) return false;
        try
        {
            if (state["running"]?.GetValue<bool>() == true) return true;
        }
        catch
        {
            // Governed string states are evaluated below.
        }
        var value = state["OverallStatus"]?.ToString() ??
            state["overallState"]?.ToString() ??
            state["status"]?.ToString() ??
            state["result"]?.ToString();
        return string.Equals(value, "RUNNING", StringComparison.OrdinalIgnoreCase);
    }
}
