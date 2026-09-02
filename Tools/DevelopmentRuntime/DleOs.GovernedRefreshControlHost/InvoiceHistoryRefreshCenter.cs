using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;

internal sealed class InvoiceHistoryRefreshCenter
{
    private const string Launcher =
        @"C:\DLE-OS\Repositories\DLE-OS\Tools\InvoiceHistory\Start-InvoiceHistoryRefresh.cmd";
    private const string StatusPath =
        @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json";
    private const string InvoiceLock =
        @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\invoice-history-refresh.lock";
    private const string SharedLease = @"C:\ProgramData\DLE-OS\SyncOperations\lease.json";
    private readonly object gate = new();
    private readonly JsonSerializerOptions json = new() { WriteIndented = true };
    private readonly LiveRunApprovalStore approvals;

    public InvoiceHistoryRefreshCenter(LiveRunApprovalStore approvals) => this.approvals = approvals;

    internal object ReadStatus(HttpContext context)
    {
        InvoiceRefreshState state;
        try
        {
            state = File.Exists(StatusPath)
                ? JsonSerializer.Deserialize<InvoiceRefreshState>(File.ReadAllText(StatusPath),
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new()
                : new();
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
            authorized = true,
            executionIdentity = WindowsIdentity.GetCurrent().Name,
            executionMode = ControlHostRuntimeConfiguration.ExecutionMode,
            qualificationApprovalActive = ControlHostRuntimeConfiguration.FailureQualificationEnabled,
            oneRunGateQualificationActive = ControlHostRuntimeConfiguration.LiveApprovalQualificationEnabled,
            liveApprovalPending = approvals.Inspect().Valid,
            hostInstanceId = approvals.HostInstance.HostInstanceId,
            running = string.Equals(state.Result, "RUNNING", StringComparison.OrdinalIgnoreCase),
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

    internal IResult Start(HttpContext context)
    {
        lock (gate)
        {
            var approvalInspection = approvals.Inspect();
            if (!approvalInspection.Valid)
                return ExecutionDisabled(approvalInspection.Reason);
            if (File.Exists(SharedLease))
                return Results.Conflict(new { code = "ALREADY_RUNNING", conflictingLock = SharedLease });
            var conflict = ConflictingLock();
            if (conflict is not null)
                return Results.Conflict(new { code = "ALREADY_RUNNING", conflictingLock = conflict });
            if (!File.Exists(Launcher))
                return Results.Json(new { code = "invoice_refresh_launcher_unavailable" }, statusCode: 503);

            // Re-attest every fixed worker/runtime dependency at the final
            // admission boundary, immediately before any lease or child exists.
            WorkerDependencyManifest.Verify();

            var now = DateTimeOffset.UtcNow;
            var requestId = "INVOICEHISTORYCONTROL-" + now.ToString("yyyyMMddTHHmmssZ") + "-" +
                            Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
            var actor = TrustedRefreshIdentity.RequireActorName(context);
            Directory.CreateDirectory(Path.GetDirectoryName(SharedLease)!);
            WriteLease(new CanonicalChangeLease
            {
                RunId = requestId,
                Operation = "INVOICE_HISTORY_REFRESH_V1",
                RequestedBy = actor,
                CreatedAtUtc = now,
                HeartbeatAtUtc = now,
                Status = "QUEUED"
            }, createNew: true);
            LiveRunApprovalClaim? approvalClaim = null;
            try
            {
                conflict = ConflictingLock();
                if (conflict is not null)
                    throw new InvalidOperationException("ALREADY_RUNNING: " + conflict);
                approvalClaim = approvals.TryClaim(requestId);
                if (!approvalClaim.Claimed)
                {
                    DeleteOwnedLease(requestId);
                    return ExecutionDisabled(approvalClaim.Reason);
                }
                var priorRun = Environment.GetEnvironmentVariable("DLE_OS_SYNC_OPERATIONS_RUN_ID");
                Environment.SetEnvironmentVariable("DLE_OS_SYNC_OPERATIONS_RUN_ID", requestId);
                Process process;
                try
                {
                    process = NormalUserProcess.Start("cmd.exe", ["/d", "/c", Launcher],
                        @"C:\DLE-OS\Repositories\DLE-OS");
                }
                finally
                {
                    Environment.SetEnvironmentVariable("DLE_OS_SYNC_OPERATIONS_RUN_ID", priorRun);
                }
                if (process.WaitForExit(500))
                    throw new InvalidOperationException("The governed Invoice History worker exited during startup.");
                var lease = ReadLease() ?? throw new InvalidOperationException("The canonical-change lease disappeared.");
                lease.OwnerProcessId = process.Id;
                lease.OwnerProcessStartedAtUtc = process.StartTime.ToUniversalTime();
                lease.Status = "RUNNING";
                WriteLease(lease);
                _ = MonitorAsync(process, requestId, approvalClaim);
                return Results.Accepted("/api/platform/refresh/invoice-history/v1/status", new
                {
                    authorized = true,
                    executionIdentity = @"DLE-OS-HOST\DLE-OS",
                    status = "RUNNING",
                    running = true,
                    refreshControlRunId = requestId,
                    message = "The isolated Invoice History refresh was started."
                });
            }
            catch (Exception failure)
            {
                DeleteOwnedLease(requestId);
                if (approvalClaim is not null && approvalClaim.Claimed)
                    approvals.Complete(approvalClaim, "WORKER_LAUNCH_FAILED", null, failure.Message);
                throw;
            }
        }
    }

    private async Task MonitorAsync(Process process, string requestId, LiveRunApprovalClaim approvalClaim)
    {
        try
        {
            await process.WaitForExitAsync();
            approvals.Complete(approvalClaim,
                process.ExitCode == 0 ? "WORKER_COMPLETED" : "WORKER_FAILED",
                process.ExitCode, process.ExitCode == 0 ? null : "The governed worker returned a nonzero exit code.");
        }
        finally { lock (gate) { DeleteOwnedLease(requestId); process.Dispose(); } }
    }

    private static IResult ExecutionDisabled(string reason) => Results.Json(new
    {
        code = "INVOICE_HISTORY_EXECUTION_DISABLED",
        message = "Invoice History execution is disabled until one valid local approval is claimed.",
        reason,
        releaseId = ControlHostRuntimeConfiguration.ReleaseId
    }, statusCode: 503);

    private static string? ConflictingLock()
    {
        string[] locks =
        [
            InvoiceLock,
            @"C:\DLE-OS\Canonical\DailyOperationsSync\State\daily-operations-sync.lock",
            @"C:\DLE-OS\Canonical\CustomerMaster\Refresh\State\customer-master-refresh.lock",
            @"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\open-sales-order-refresh.lock",
            @"C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\refresh.lock"
        ];
        return locks.FirstOrDefault(File.Exists);
    }

    private CanonicalChangeLease? ReadLease()
    {
        try { return File.Exists(SharedLease)
            ? JsonSerializer.Deserialize<CanonicalChangeLease>(File.ReadAllText(SharedLease), json) : null; }
        catch { return new CanonicalChangeLease { RunId = "UNREADABLE", Status = "UNKNOWN" }; }
    }

    private void WriteLease(CanonicalChangeLease lease, bool createNew = false)
    {
        if (createNew)
        {
            using var stream = new FileStream(SharedLease, FileMode.CreateNew, FileAccess.Write,
                FileShare.Read, 4096, FileOptions.WriteThrough);
            JsonSerializer.Serialize(stream, lease, json);
            return;
        }
        var stage = SharedLease + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(stage, JsonSerializer.Serialize(lease, json));
        File.Move(stage, SharedLease, true);
    }

    private void DeleteOwnedLease(string requestId)
    {
        var current = ReadLease();
        if (current is not null && string.Equals(current.RunId, requestId, StringComparison.Ordinal))
            File.Delete(SharedLease);
    }
}

internal sealed class CanonicalChangeLease
{
    public string RunId { get; set; } = "";
    public string Operation { get; set; } = "";
    public string RequestedBy { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset HeartbeatAtUtc { get; set; }
    public int OwnerProcessId { get; set; }
    public DateTimeOffset? OwnerProcessStartedAtUtc { get; set; }
    public string Status { get; set; } = "";
}

internal sealed class InvoiceRefreshState
{
    public string Result { get; set; } = "NEVER_RUN";
    public string Message { get; set; } = "Invoice History refresh has not run.";
    public string RefreshRunId { get; set; } = "";
    public string WindowStart { get; set; } = "";
    public string WindowEnd { get; set; } = "";
    public string StartedAtUtc { get; set; } = "";
    public string UpdatedAtUtc { get; set; } = "";
    public object? Details { get; set; }
}
