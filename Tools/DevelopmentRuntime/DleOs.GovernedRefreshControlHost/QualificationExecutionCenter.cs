using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed class QualificationExecutionCenter
{
    private const string EvidenceRoot =
        @"C:\ProgramData\DLE-OS\GovernedRefreshControl\Qualification\FailurePreservation";
    private const string SharedLease = @"C:\ProgramData\DLE-OS\SyncOperations\lease.json";
    private const string InvoiceLock =
        @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\invoice-history-refresh.lock";
    private static readonly string[] ConflictingLocks =
    [
        InvoiceLock,
        @"C:\DLE-OS\Canonical\DailyOperationsSync\State\daily-operations-sync.lock",
        @"C:\DLE-OS\Canonical\CustomerMaster\Refresh\State\customer-master-refresh.lock",
        @"C:\DLE-OS\Canonical\OpenSalesOrders\Refresh\State\open-sales-order-refresh.lock",
        @"C:\ProgramData\DLE-OS\LiveSnapshotRefresh\State\refresh.lock"
    ];
    private readonly IHostApplicationLifetime lifetime;
    private readonly JsonSerializerOptions json = new() { WriteIndented = true };
    private int approvalClaimed;

    public QualificationExecutionCenter(IHostApplicationLifetime lifetime) => this.lifetime = lifetime;

    internal async Task<IResult> RunAsync(HttpContext context)
    {
        if (!ControlHostRuntimeConfiguration.FailureQualificationEnabled)
            return Results.Json(new { code = "INVOICE_HISTORY_EXECUTION_DISABLED" }, statusCode: 503);
        if (Interlocked.CompareExchange(ref approvalClaimed, 1, 0) != 0)
            return Results.Conflict(new { code = "QUALIFICATION_APPROVAL_CONSUMED" });

        var now = DateTimeOffset.UtcNow;
        var runId = "INVOICEHISTORYQUAL-" + now.ToString("yyyyMMddTHHmmssZ") + "-" +
                    Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        Directory.CreateDirectory(EvidenceRoot);
        var childEvidencePath = Path.Combine(EvidenceRoot, runId + "-worker.json");
        var hostEvidencePath = Path.Combine(EvidenceRoot, runId + "-host.json");
        var evidence = new QualificationHostEvidence
        {
            QualificationRunId = runId,
            StartedAtUtc = now,
            ReleaseId = ControlHostRuntimeConfiguration.ReleaseId,
            RequestedBy = TrustedRefreshIdentity.RequireActorName(context),
            ExecutionMode = ControlHostRuntimeConfiguration.ExecutionMode,
            SharedLeaseInitiallyPresent = File.Exists(SharedLease),
            ConflictingLocksInitiallyPresent = ConflictingLocks.Where(File.Exists).ToArray()
        };

        try
        {
            if (evidence.SharedLeaseInitiallyPresent || evidence.ConflictingLocksInitiallyPresent.Length != 0)
                throw new InvalidOperationException("A live canonical-changing workflow or lock is active.");

            // Re-verify the real qualified chain first. The deliberate mismatch uses a
            // release-contained fixture and cannot alter any real dependency.
            evidence.RealDependencies = WorkerDependencyManifest.Verify().Dependencies.Count;
            evidence.DependencyMismatch = WorkerDependencyManifest.VerifyQualificationMismatch();
            evidence.DependencyMismatchBeforeState =
                !File.Exists(SharedLease) && !ConflictingLocks.Any(File.Exists);
            if (!evidence.DependencyMismatchBeforeState)
                throw new InvalidOperationException("Dependency mismatch qualification created live state.");

            evidence.Admission = RunIsolatedAdmissionSuite(runId);

            WriteOwnedState(SharedLease, runId, "QUALIFICATION_FAILURE_PRESERVATION", now);
            WriteOwnedState(InvoiceLock, runId, "QUALIFICATION_FAILURE_PRESERVATION", now);
            evidence.OwnedLeaseCreated = true;
            evidence.OwnedInvoiceLockCreated = true;

            var script = Path.Combine(AppContext.BaseDirectory,
                "Invoke-InvoiceHistoryFailureQualification.ps1");
            using var process = NormalUserProcess.Start("powershell.exe",
            [
                "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-File", script, "-QualificationRunId", runId,
                "-EvidencePath", childEvidencePath
            ], AppContext.BaseDirectory);
            evidence.WorkerProcessId = process.Id;
            evidence.WorkerStarted = true;
            var exited = await Task.Run(() => process.WaitForExit(120_000));
            if (!exited)
            {
                process.Kill(entireProcessTree: true);
                throw new InvalidOperationException("The fixed failure-qualification worker timed out.");
            }
            if (!File.Exists(childEvidencePath))
                throw new InvalidOperationException("The failure-qualification worker produced no evidence.");
            evidence.WorkerEvidencePath = childEvidencePath;
            evidence.WorkerEvidenceSha256 = FileSha256(childEvidencePath);
            evidence.Worker = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(childEvidencePath));
            if (!evidence.Worker.Value.TryGetProperty("Verdict", out var verdict) ||
                !string.Equals(verdict.GetString(), "PASS", StringComparison.Ordinal))
                throw new InvalidOperationException("The fixed failure-qualification worker failed.");
            evidence.Verdict = "PASS";
            return Results.Ok(new
            {
                authorized = true,
                status = "QUALIFICATION_SUCCEEDED",
                qualificationRunId = runId,
                executionIdentity = @"DLE-OS-HOST\DLE-OS",
                message = "Failure preservation qualified; no live source refresh was executed."
            });
        }
        catch (Exception failure)
        {
            evidence.Error = failure.ToString();
            evidence.Verdict = "FAIL";
            return Results.Json(new
            {
                code = "FAILURE_PRESERVATION_QUALIFICATION_FAILED",
                qualificationRunId = runId,
                message = failure.Message
            }, statusCode: 500);
        }
        finally
        {
            evidence.LeaseReleased = DeleteOwnedState(SharedLease, runId);
            evidence.InvoiceLockReleased = DeleteOwnedState(InvoiceLock, runId);
            evidence.SharedLeasePresentAfter = File.Exists(SharedLease);
            evidence.InvoiceLockPresentAfter = File.Exists(InvoiceLock);
            evidence.CompletedAtUtc = DateTimeOffset.UtcNow;
            File.WriteAllText(hostEvidencePath, JsonSerializer.Serialize(evidence, json) + Environment.NewLine,
                new UTF8Encoding(false));
            // The launcher consumed the one-shot approval before startup. Stop this
            // process after the response drains; a subsequent task start has no
            // approval and therefore returns to the disabled mode.
            _ = Task.Run(async () =>
            {
                await Task.Delay(1000);
                lifetime.StopApplication();
            });
        }
    }

    private QualificationAdmissionEvidence RunIsolatedAdmissionSuite(string runId)
    {
        var root = Path.Combine(EvidenceRoot, runId + "-admission");
        Directory.CreateDirectory(root);
        var path = Path.Combine(root, "lease.json");
        try
        {
            var first = TryCreateIsolated(path, runId);
            var concurrent = TryCreateIsolated(path, runId + "-SECOND");
            var ownedDeleted = DeleteOwnedState(path, runId);

            WriteIsolated(path, "FOREIGN-LIVE", DateTimeOffset.UtcNow, "RUNNING");
            var foreignBlocked = !TryCreateIsolated(path, runId);
            var foreignPreserved = !DeleteOwnedState(path, runId) && File.Exists(path);
            File.Delete(path);

            File.WriteAllText(path, "{unreadable", new UTF8Encoding(false));
            var unreadableBlocked = !TryCreateIsolated(path, runId);
            var unreadablePreserved = !DeleteOwnedState(path, runId) && File.Exists(path);
            File.Delete(path);

            WriteIsolated(path, "FOREIGN-STALE", DateTimeOffset.UtcNow.AddDays(-30), "RUNNING");
            var staleBlocked = !TryCreateIsolated(path, runId);
            var stalePreserved = !DeleteOwnedState(path, runId) && File.Exists(path);
            File.Delete(path);

            WriteIsolated(path, runId, DateTimeOffset.UtcNow, "RUNNING");
            var exactOwnedDeleted = DeleteOwnedState(path, runId) && !File.Exists(path);
            var passed = first && !concurrent && ownedDeleted && foreignBlocked && foreignPreserved &&
                         unreadableBlocked && unreadablePreserved && staleBlocked && stalePreserved &&
                         exactOwnedDeleted;
            if (!passed) throw new InvalidOperationException("The isolated admission suite failed.");
            return new(true, true, foreignBlocked, unreadableBlocked, staleBlocked,
                foreignPreserved && unreadablePreserved && stalePreserved, exactOwnedDeleted, true);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private void WriteOwnedState(string path, string runId, string operation, DateTimeOffset created)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var value = new QualificationLeaseState
        {
            RunId = runId, Operation = operation, CreatedAtUtc = created,
            HeartbeatAtUtc = created, Status = "RUNNING", OwnerProcessId = Environment.ProcessId
        };
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write,
            FileShare.Read, 4096, FileOptions.WriteThrough);
        JsonSerializer.Serialize(stream, value, json);
    }

    private bool TryCreateIsolated(string path, string runId)
    {
        if (File.Exists(path)) return false;
        try
        {
            WriteIsolated(path, runId, DateTimeOffset.UtcNow, "RUNNING", createNew: true);
            return true;
        }
        catch (IOException) { return false; }
    }

    private void WriteIsolated(string path, string runId, DateTimeOffset created,
        string status, bool createNew = false)
    {
        var state = new QualificationLeaseState
        {
            RunId = runId, Operation = "ISOLATED_QUALIFICATION",
            CreatedAtUtc = created, HeartbeatAtUtc = created, Status = status
        };
        using var stream = new FileStream(path, createNew ? FileMode.CreateNew : FileMode.Create,
            FileAccess.Write, FileShare.Read, 4096, FileOptions.WriteThrough);
        JsonSerializer.Serialize(stream, state, json);
    }

    private bool DeleteOwnedState(string path, string runId)
    {
        if (!File.Exists(path)) return true;
        try
        {
            var state = JsonSerializer.Deserialize<QualificationLeaseState>(File.ReadAllText(path), json);
            if (state is null || !string.Equals(state.RunId, runId, StringComparison.Ordinal)) return false;
            File.Delete(path);
            return true;
        }
        catch { return false; }
    }

    private static string FileSha256(string path) =>
        Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
}

internal sealed class QualificationLeaseState
{
    public string RunId { get; set; } = "";
    public string Operation { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset HeartbeatAtUtc { get; set; }
    public string Status { get; set; } = "";
    public int OwnerProcessId { get; set; }
}

internal sealed record QualificationAdmissionEvidence(bool FirstAdmissionAccepted,
    bool ConcurrentAdmissionRejected, bool ForeignLiveLeaseBlocked,
    bool UnreadableStateBlocked, bool StaleForeignStateBlocked,
    bool ForeignStatePreserved, bool ExactOwnedStateCleaned, bool FixtureCleaned);

internal sealed class QualificationHostEvidence
{
    public string Schema { get; set; } = "dle-os.governed-refresh-host-failure-qualification.v1";
    public string QualificationRunId { get; set; } = "";
    public DateTimeOffset StartedAtUtc { get; set; }
    public DateTimeOffset CompletedAtUtc { get; set; }
    public string ReleaseId { get; set; } = "";
    public string RequestedBy { get; set; } = "";
    public string ExecutionMode { get; set; } = "";
    public bool SharedLeaseInitiallyPresent { get; set; }
    public string[] ConflictingLocksInitiallyPresent { get; set; } = [];
    public int RealDependencies { get; set; }
    public QualificationDependencyMismatchEvidence? DependencyMismatch { get; set; }
    public bool DependencyMismatchBeforeState { get; set; }
    public QualificationAdmissionEvidence? Admission { get; set; }
    public bool OwnedLeaseCreated { get; set; }
    public bool OwnedInvoiceLockCreated { get; set; }
    public bool WorkerStarted { get; set; }
    public int WorkerProcessId { get; set; }
    public string WorkerEvidencePath { get; set; } = "";
    public string WorkerEvidenceSha256 { get; set; } = "";
    public JsonElement? Worker { get; set; }
    public bool LeaseReleased { get; set; }
    public bool InvoiceLockReleased { get; set; }
    public bool SharedLeasePresentAfter { get; set; }
    public bool InvoiceLockPresentAfter { get; set; }
    public string Verdict { get; set; } = "FAIL";
    public string? Error { get; set; }
}
