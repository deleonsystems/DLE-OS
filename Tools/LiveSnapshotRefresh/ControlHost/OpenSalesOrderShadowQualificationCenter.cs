using System.Diagnostics;
using System.Security.AccessControl;
using System.Text.Json;

internal static class OpenSalesOrderShadowQualificationRoutes
{
    private const string Route =
        "/api/sync/operations/qualification/open-sales-order-shadow";

    internal static void MapOpenSalesOrderShadowQualification(
        this WebApplication app, string policy)
    {
        app.MapGet(Route + "/launch", () => Results.Content(
            "<html><body><main><h1>Open Sales Order shadow qualification</h1>" +
            "<p>Runs three isolated O_RDONLY full-versus-bounded samples.</p>" +
            "<form method=\"post\" action=\"" + Route + "\">" +
            "<button type=\"submit\">Start governed shadow qualification</button>" +
            "</form></main></body></html>", "text/html"))
            .RequireAuthorization(policy);
        app.MapPost(Route,
            (HttpContext context, OpenSalesOrderShadowQualificationCenter center) =>
                center.Start(context)).RequireAuthorization(policy);
        app.MapGet(Route + "/current",
            (OpenSalesOrderShadowQualificationCenter center) =>
                center.Current()).RequireAuthorization(policy);
    }
}

internal sealed class OpenSalesOrderShadowQualificationCenter
{
    private const string Script =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\OperationsRefresh\Invoke-OpenSalesOrderBoundedShadowQualification.ps1";
    private const string ArtifactRuns =
        @"C:\DLE-OS\Qualification\OpenSalesOrderBoundedShadow\Runs";
    private readonly object gate = new();
    private readonly JsonSerializerOptions json = new() { WriteIndented = true };
    private readonly string root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "DLE-OS", "OpenSalesOrderShadowQualification");

    internal IResult Start(HttpContext context)
    {
        lock (gate)
        {
            Directory.CreateDirectory(root);
            Directory.CreateDirectory(RunsRoot);
            Directory.CreateDirectory(ArtifactRuns);
            EnsureWorkerStateAccess();
            var active = ReadLease();
            if (active is not null && OwnerIsAlive(active))
                return Results.Conflict(new { code = "QUALIFICATION_ALREADY_RUNNING", active });
            if (active is not null)
                RecoverStale(active);
            var conflict = Conflict();
            if (conflict is not null)
                return Results.Conflict(new { code = "QUALIFICATION_CONFLICT", conflict });
            if (Process.GetProcessesByName("vpro5").Any())
                return Results.Conflict(new { code = "VPRO_ALREADY_RUNNING" });
            if (!File.Exists(Script))
                return Results.Problem(statusCode: 503, title: "Qualification worker absent");

            var now = DateTimeOffset.UtcNow;
            var runId = "OPENSOSHADOW-" + now.ToString("yyyyMMddTHHmmssZ") + "-" +
                        Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
            var actor = TrustedDevelopmentIdentity.RequireActorName(context);
            var state = new OpenSalesOrderShadowState
            {
                RunId = runId, Status = "QUEUED", CurrentStep = "Queued",
                RequestedBy = actor, RequestedAtUtc = now, HeartbeatAtUtc = now,
                ExecutionIdentity = @"DLE-OS-HOST\DLE-OS",
                ArtifactRoot = Path.Combine(ArtifactRuns, runId)
            };
            WriteJson(RunPath(runId), state, createNew: true);
            WriteJson(CurrentPath, state);
            var lease = new OpenSalesOrderShadowLease
            {
                RunId = runId, CreatedAtUtc = now, Status = "QUEUED"
            };
            WriteJson(LeasePath, lease, createNew: true);
            try
            {
                conflict = Conflict();
                if (conflict is not null)
                    throw new InvalidOperationException("A conflicting workflow began: " + conflict);
                var process = NormalUserProcess.Start("powershell.exe",
                [
                    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                    "-File", Script, "-RunId", runId, "-RunRoot", state.ArtifactRoot,
                    "-StatePath", RunPath(runId), "-CurrentPath", CurrentPath,
                    "-LeasePath", LeasePath, "-RequestedBy", actor, "-Samples", "3"
                ], @"C:\DLE-OS\Repositories\DLE-OS");
                if (process.WaitForExit(500))
                    throw new InvalidOperationException(
                        "The qualification worker exited during startup.");
                lease.OwnerProcessId = process.Id;
                lease.OwnerProcessStartedAtUtc = process.StartTime.ToUniversalTime();
                lease.Status = "RUNNING";
                WriteJson(LeasePath, lease);
                state.OwnerProcessId = process.Id;
                state.Status = "RUNNING";
                state.CurrentStep = "Running three isolated samples";
                state.StartedAtUtc = now;
                WriteJson(RunPath(runId), state);
                WriteJson(CurrentPath, state);
                return Results.Json(state, statusCode: StatusCodes.Status202Accepted);
            }
            catch (Exception error)
            {
                state.Status = "FAILED_TO_START";
                state.CompletedAtUtc = DateTimeOffset.UtcNow;
                state.Result = error.Message;
                WriteJson(RunPath(runId), state);
                WriteJson(CurrentPath, state);
                File.Delete(LeasePath);
                throw;
            }
        }
    }

    internal IResult Current()
    {
        lock (gate)
        {
            var lease = ReadLease();
            if (lease is not null && !OwnerIsAlive(lease))
                RecoverStale(lease);
            var snapshot = SyncOperationsStatusSnapshot.ReadOptional(CurrentPath);
            return snapshot is null
                ? Results.Json(new { status = "NEVER_RUN" })
                : Results.Bytes(snapshot, "application/json");
        }
    }

    private string RunsRoot => Path.Combine(root, "Runs");
    private string CurrentPath => Path.Combine(root, "current.json");
    private string LeasePath => Path.Combine(root, "lease.json");
    private string RunPath(string runId) => Path.Combine(RunsRoot, runId + ".json");

    private void EnsureWorkerStateAccess()
    {
        var directory = new DirectoryInfo(root);
        var security = directory.GetAccessControl();
        security.AddAccessRule(new FileSystemAccessRule(
            @"DLE-OS-HOST\DLE-OS",
            FileSystemRights.Modify | FileSystemRights.Synchronize,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow));
        directory.SetAccessControl(security);
    }

    private static string? Conflict()
    {
        string[] paths =
        [
            @"C:\ProgramData\DLE-OS\SyncOperations\lease.json",
            @"C:\DLE-OS\Canonical\DailyOperationsSync\State\daily-operations-sync.lock",
            @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\invoice-history-refresh.lock",
            @"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\open-sales-order-refresh.lock"
        ];
        return paths.FirstOrDefault(File.Exists);
    }

    private OpenSalesOrderShadowLease? ReadLease()
    {
        try
        {
            return File.Exists(LeasePath)
                ? JsonSerializer.Deserialize<OpenSalesOrderShadowLease>(
                    File.ReadAllText(LeasePath), json)
                : null;
        }
        catch { return new OpenSalesOrderShadowLease { RunId = "UNREADABLE" }; }
    }

    private static bool OwnerIsAlive(OpenSalesOrderShadowLease lease)
    {
        if (lease.OwnerProcessId <= 0)
            return DateTimeOffset.UtcNow - lease.CreatedAtUtc < TimeSpan.FromMinutes(1);
        try
        {
            using var process = Process.GetProcessById(lease.OwnerProcessId);
            return !process.HasExited && lease.OwnerProcessStartedAtUtc is not null &&
                   Math.Abs((process.StartTime.ToUniversalTime() -
                       lease.OwnerProcessStartedAtUtc.Value.UtcDateTime).TotalSeconds) < 2;
        }
        catch { return false; }
    }

    private void RecoverStale(OpenSalesOrderShadowLease lease)
    {
        if (lease.RunId.StartsWith("OPENSOSHADOW-", StringComparison.Ordinal) &&
            File.Exists(RunPath(lease.RunId)))
        {
            var state = JsonSerializer.Deserialize<OpenSalesOrderShadowState>(
                File.ReadAllText(RunPath(lease.RunId)), json);
            if (state is not null)
            {
                state.Status = "ABANDONED_STALE_OWNER";
                state.CompletedAtUtc = DateTimeOffset.UtcNow;
                state.Result = "The qualification worker no longer exists.";
                WriteJson(RunPath(lease.RunId), state);
                WriteJson(CurrentPath, state);
            }
        }
        File.Delete(LeasePath);
    }

    private void WriteJson(string path, object value, bool createNew = false)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        if (createNew)
        {
            using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write,
                FileShare.Read, 4096, FileOptions.WriteThrough);
            JsonSerializer.Serialize(stream, value, json);
            return;
        }
        var stage = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(stage, JsonSerializer.Serialize(value, json));
        File.Move(stage, path, true);
    }
}

internal sealed class OpenSalesOrderShadowLease
{
    public string RunId { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
    public int OwnerProcessId { get; set; }
    public DateTimeOffset? OwnerProcessStartedAtUtc { get; set; }
    public string Status { get; set; } = "";
}

internal sealed class OpenSalesOrderShadowState
{
    public string RunId { get; set; } = "";
    public string Status { get; set; } = "";
    public string CurrentStep { get; set; } = "";
    public string RequestedBy { get; set; } = "";
    public DateTimeOffset RequestedAtUtc { get; set; }
    public DateTimeOffset? StartedAtUtc { get; set; }
    public DateTimeOffset? CompletedAtUtc { get; set; }
    public DateTimeOffset HeartbeatAtUtc { get; set; }
    public int OwnerProcessId { get; set; }
    public string ExecutionIdentity { get; set; } = "";
    public string ArtifactRoot { get; set; } = "";
    public string? Result { get; set; }
}
