using System.Diagnostics;
using System.Text.Json.Nodes;

internal static class OperationsRefreshCenter
{
    private const string StatusPath =
        @"C:\DLE-OS\Canonical\OperationsRefresh\State\status.json";
    private const string HistoryPath =
        @"C:\DLE-OS\Canonical\OperationsRefresh\State\runs.jsonl";
    private const string Launcher =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\OperationsRefresh\Start-OperationsRefresh.cmd";
    private const string TaskName = "DLE-OS Operations Refresh";
    private static readonly string[] IncompatibleStatePaths =
    [
        @"C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\status.json",
        @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json",
        @"C:\DLE-OS\Canonical\CustomerMaster\Refresh\State\status.json",
        @"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\status.json"
    ];
    private static readonly IReadOnlyDictionary<string, string> StepStatusPaths =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["customer-master"] =
                @"C:\DLE-OS\Canonical\CustomerMaster\Refresh\State\status.json",
            ["sales-order"] =
                @"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\status.json",
            ["invoice-history"] =
                @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json"
        };
    private static readonly object Gate = new();

    internal static void MapOperationsRefresh(
        this WebApplication app,
        string authorizedOperator,
        string policy)
    {
        app.MapGet(
                "/api/platform/operations-refresh/v1/status",
                () => Results.Json(BuildStatus()))
            .RequireAuthorization(policy);
        app.MapGet(
                "/api/platform/operations-refresh/v1/runs",
                () => Results.Json(ReadRuns().TakeLast(100).Reverse()))
            .RequireAuthorization(policy);
        app.MapGet(
                "/api/platform/operations-refresh/v1/runs/{runId}",
                (string runId) =>
                {
                    var run = ReadRuns().LastOrDefault(item =>
                        string.Equals(
                            item["operationsRefreshRunId"]?.GetValue<string>(),
                            runId,
                            StringComparison.OrdinalIgnoreCase));
                    return run is null
                        ? Results.NotFound(new { code = "run_not_found", runId })
                        : Results.Json(run);
                })
            .RequireAuthorization(policy);
        app.MapPost(
                "/api/platform/operations-refresh/v1/run",
                (HttpContext context, OperationsRunRequest? request) =>
                    Start(context, authorizedOperator, request))
            .RequireAuthorization(policy);
        app.MapGet(
                "/api/platform/operations-refresh/v1/schedule",
                () => Results.Json(ReadSchedule()))
            .RequireAuthorization(policy);
        app.MapPost(
                "/api/platform/operations-refresh/v1/schedule/enable",
                () => ChangeSchedule(enable: true))
            .RequireAuthorization(policy);
        app.MapPost(
                "/api/platform/operations-refresh/v1/schedule/disable",
                () => ChangeSchedule(enable: false))
            .RequireAuthorization(policy);
    }

    private static IResult Start(
        HttpContext context,
        string authorizedOperator,
        OperationsRunRequest? request)
    {
        var pacific = TimeZoneInfo.FindSystemTimeZoneById(
            "Pacific Standard Time");
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, pacific);
        var inside = local.DayOfWeek is not (
                DayOfWeek.Saturday or DayOfWeek.Sunday) &&
            local.TimeOfDay < TimeSpan.FromHours(6);
        if (!inside && request?.QuietWindowReady != true)
        {
            return Results.BadRequest(new
            {
                code = "quiet_window_confirmation_required",
                status = "AwaitingQuietWindow"
            });
        }
        lock (Gate)
        {
            var status = ReadObject(StatusPath);
            if (string.Equals(
                    status?["overallState"]?.GetValue<string>(),
                    "Running",
                    StringComparison.OrdinalIgnoreCase))
            {
                return Results.Conflict(new
                {
                    code = "already_running",
                    status = "ALREADY_RUNNING"
                });
            }
            if (IncompatibleStatePaths.Any(path =>
                    StateIsRunning(ReadObject(path))))
            {
                return Results.Conflict(new
                {
                    code = "already_running",
                    status = "ALREADY_RUNNING",
                    message = "An incompatible governed live-source operation is already running."
                });
            }
            if (!File.Exists(Launcher))
            {
                return Results.Json(
                    new { code = "runner_unavailable", status = "Unavailable" },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            var process = Process.Start(new ProcessStartInfo
            {
                FileName = Path.Combine(
                    Environment.GetFolderPath(
                        Environment.SpecialFolder.Windows),
                    "explorer.exe"),
                Arguments = $"\"{Launcher}\"",
                UseShellExecute = true
            });
            if (process is null)
            {
                return Results.Json(
                    new { code = "runner_start_failed", status = "Unavailable" },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            return Results.Accepted(
                "/api/platform/operations-refresh/v1/status",
                new
                {
                    status = "Running",
                    triggerType = "Manual",
                    requestedBy = context.User.Identity?.Name,
                    executionIdentity = authorizedOperator,
                    quietWindowReady = inside || request?.QuietWindowReady == true
                });
        }
    }

    private static JsonObject BuildStatus()
    {
        var current = ReadObject(StatusPath) ?? new JsonObject
        {
            ["contractVersion"] = "operations-refresh-v1",
            ["overallState"] = "NeverRun",
            ["stepResults"] = new JsonArray()
        };
        var schedule = ReadSchedule();
        current["schedule"] = schedule;
        current["nextScheduledRun"] =
            schedule["nextScheduledRunUtc"]?.DeepClone();
        current["generatedAtUtc"] = DateTimeOffset.UtcNow.ToString("O");
        EnrichActiveProgress(current);
        return current;
    }

    private static void EnrichActiveProgress(JsonObject current)
    {
        var overall =
            current["OverallStatus"]?.ToString() ??
            current["OverallState"]?.ToString() ??
            current["overallStatus"]?.ToString() ??
            current["overallState"]?.ToString();
        if (!string.Equals(overall, "Running", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }
        var startedText =
            current["StartedAt"]?.ToString() ??
            current["StartedAtUtc"]?.ToString() ??
            current["startedAt"]?.ToString() ??
            current["startedAtUtc"]?.ToString();
        if (DateTimeOffset.TryParse(startedText, out var started))
        {
            current["ElapsedSeconds"] = Math.Max(
                0, (long)Math.Floor(
                    (DateTimeOffset.UtcNow - started).TotalSeconds));
        }
        var stepId =
            current["CurrentStep"]?.ToString() ??
            current["currentStep"]?.ToString() ??
            current["currentDatasetId"]?.ToString();
        if (string.IsNullOrWhiteSpace(stepId) ||
            !StepStatusPaths.TryGetValue(stepId, out var childPath))
        {
            return;
        }
        var child = ReadObject(childPath);
        if (child is null ||
            !string.Equals(
                child["Result"]?.ToString() ?? child["result"]?.ToString(),
                "RUNNING",
                StringComparison.OrdinalIgnoreCase))
        {
            return;
        }
        CopyProgress(child, current, "CurrentPhase");
        CopyProgress(child, current, "RecordsProcessed");
        CopyProgress(child, current, "RecordsExpected");
        if ((child["UpdatedAtUtc"] ?? child["updatedAtUtc"]) is JsonNode updated)
        {
            current["LastProgressAt"] = updated.DeepClone();
        }
    }

    private static void CopyProgress(
        JsonObject source,
        JsonObject destination,
        string name)
    {
        if (source[name] is JsonNode value)
        {
            destination[name] = value.DeepClone();
        }
    }

    private static JsonObject ReadSchedule()
    {
        var result = RunSchtasks("/Query", "/TN", TaskName, "/FO", "LIST", "/V");
        var enabled = result.ExitCode == 0 &&
            result.Output
                .Split(Environment.NewLine)
                .Any(line =>
                    line.StartsWith(
                        "Scheduled Task State:",
                        StringComparison.OrdinalIgnoreCase) &&
                    line.EndsWith(
                        "Enabled",
                        StringComparison.OrdinalIgnoreCase));
        var next = NextWeekdayRun();
        return new JsonObject
        {
            ["taskName"] = TaskName,
            ["automaticEnabled"] = enabled,
            ["installed"] = result.ExitCode == 0,
            ["schedule"] = "02:00 Monday-Friday",
            ["timeZone"] = "America/Los_Angeles",
            ["quietWindow"] = "00:00-05:59",
            ["latestAutomaticStart"] = "04:30",
            ["identity"] = @"DLE-OS-HOST\DLE-OS",
            ["storesCredentials"] = false,
            ["nextScheduledRunUtc"] = next.ToUniversalTime().ToString("O"),
            ["nextScheduledRunPacific"] = next.ToString("O")
        };
    }

    private static DateTimeOffset NextWeekdayRun()
    {
        var pacific = TimeZoneInfo.FindSystemTimeZoneById(
            "Pacific Standard Time");
        var now = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, pacific);
        var date = now.Date;
        if (now.TimeOfDay >= TimeSpan.FromHours(2))
        {
            date = date.AddDays(1);
        }
        while (date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
        {
            date = date.AddDays(1);
        }
        var local = DateTime.SpecifyKind(
            date.AddHours(2), DateTimeKind.Unspecified);
        var offset = pacific.GetUtcOffset(local);
        return new DateTimeOffset(local, offset);
    }

    private static IResult ChangeSchedule(bool enable)
    {
        var result = RunSchtasks(
            "/Change", "/TN", TaskName, enable ? "/ENABLE" : "/DISABLE");
        return result.ExitCode == 0
            ? Results.Json(new
            {
                taskName = TaskName,
                automaticEnabled = enable,
                result = "SUCCESS"
            })
            : Results.Json(
                new
                {
                    taskName = TaskName,
                    result = "FAILED",
                    code = "schedule_change_failed"
                },
                statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    private static (int ExitCode, string Output) RunSchtasks(
        params string[] arguments)
    {
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                "schtasks.exe"),
            Arguments = string.Join(
                " ",
                arguments.Select(value =>
                    value.Contains(' ') ? $"\"{value}\"" : value)),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        })!;
        var output = process.StandardOutput.ReadToEnd() +
            process.StandardError.ReadToEnd();
        process.WaitForExit(10000);
        return (process.ExitCode, output);
    }

    private static JsonObject? ReadObject(string path)
    {
        try
        {
            return File.Exists(path)
                ? JsonNode.Parse(File.ReadAllText(path)) as JsonObject
                : null;
        }
        catch
        {
            return null;
        }
    }

    private static bool StateIsRunning(JsonObject? state)
    {
        if (state is null)
        {
            return false;
        }
        try
        {
            if (state["running"]?.GetValue<bool>() == true)
            {
                return true;
            }
        }
        catch
        {
            // The governed string state is evaluated below.
        }
        var text =
            state["overallState"]?.ToString() ??
            state["status"]?.ToString() ??
            state["result"]?.ToString();
        return string.Equals(text, "Running", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(text, "RUNNING", StringComparison.OrdinalIgnoreCase);
    }

    private static IReadOnlyList<JsonObject> ReadRuns()
    {
        try
        {
            return File.Exists(HistoryPath)
                ? File.ReadLines(HistoryPath)
                    .Where(line => !string.IsNullOrWhiteSpace(line))
                    .Select(line => JsonNode.Parse(line) as JsonObject)
                    .Where(value => value is not null)
                    .Cast<JsonObject>()
                    .ToArray()
                : [];
        }
        catch
        {
            return [];
        }
    }
}

internal sealed class OperationsRunRequest
{
    public bool QuietWindowReady { get; set; }
}
