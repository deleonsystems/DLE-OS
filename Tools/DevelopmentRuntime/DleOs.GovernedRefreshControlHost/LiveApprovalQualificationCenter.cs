using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed class LiveApprovalQualificationCenter
{
    private const string EvidenceRoot =
        @"C:\ProgramData\DLE-OS\GovernedRefreshControl\Qualification\OneRunLiveGate";
    private readonly IHostApplicationLifetime lifetime;
    private int qualificationClaimed;

    public LiveApprovalQualificationCenter(IHostApplicationLifetime lifetime) => this.lifetime = lifetime;

    internal async Task<IResult> RunAsync(HttpContext context)
    {
        await Task.Yield();
        if (!ControlHostRuntimeConfiguration.LiveApprovalQualificationEnabled)
            return Disabled();
        if (Interlocked.CompareExchange(ref qualificationClaimed, 1, 0) != 0)
            return Results.Conflict(new { code = "QUALIFICATION_APPROVAL_CONSUMED" });

        var runId = "INVOICEHISTORYLIVEGATEQUAL-" + DateTimeOffset.UtcNow.ToString("yyyyMMddTHHmmssZ") +
                    "-" + Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        var root = Path.Combine(EvidenceRoot, runId);
        Directory.CreateDirectory(root);
        var evidence = new LiveApprovalQualificationEvidence
        {
            QualificationRunId = runId,
            ReleaseId = ControlHostRuntimeConfiguration.ReleaseId,
            RequestedBy = TrustedRefreshIdentity.RequireActorName(context),
            StartedAtUtc = DateTimeOffset.UtcNow,
            SourceAccess = "NONE",
            CanonicalCommitAllowed = false
        };
        try
        {
            var statusPath = Path.Combine(root, "status.json");
            File.WriteAllText(statusPath, "{\"result\":\"UNCHANGED_QUALIFICATION_FIXTURE\"}\n",
                new UTF8Encoding(false));
            var statusHash = LiveRunApprovalStore.FileSha256(statusPath);
            var started = DateTimeOffset.UtcNow.AddMinutes(-1);
            var instance = HostInstanceIdentity.ForQualification(
                ControlHostRuntimeConfiguration.ReleaseId,
                Guid.NewGuid().ToString("N").ToUpperInvariant(), started);

            evidence.OneRun = TestOneRun(root, statusPath, statusHash, instance);
            evidence.ExpiredRejected = TestRejected(root, statusPath, statusHash, instance,
                LiveRunApprovalStore.CreateForQualification(instance, statusHash,
                    DateTimeOffset.UtcNow.AddMinutes(-10), DateTimeOffset.UtcNow.AddMinutes(-1)), "TIME_INVALID");
            evidence.WrongReleaseRejected = TestRejected(root, statusPath, statusHash, instance,
                LiveRunApprovalStore.CreateForQualification(instance, statusHash,
                    DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(5), "WRONG-RELEASE"),
                "BOUNDARY_MISMATCH");
            evidence.WrongHostInstanceRejected = TestRejected(root, statusPath, statusHash, instance,
                LiveRunApprovalStore.CreateForQualification(instance, statusHash,
                    DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(5), null,
                    Guid.NewGuid().ToString("N").ToUpperInvariant()), "BOUNDARY_MISMATCH");
            evidence.MalformedRejected = TestMalformed(root, statusPath, instance);
            evidence.RestartInvalidates = TestRestart(root, statusPath, statusHash, instance);
            evidence.LaunchFailureConsumes = TestLaunchFailure(root, statusPath, statusHash, instance);
            evidence.MutualExclusion = !File.Exists(Path.Combine(
                @"C:\ProgramData\DLE-OS\GovernedRefreshControl\Approval", "pending-live-approval.json"));
            evidence.ReturnedToDisabled = evidence.OneRun.SecondClaimRejected &&
                                          evidence.LaunchFailureConsumes;
            evidence.Passed = evidence.OneRun.Passed && evidence.ExpiredRejected &&
                evidence.WrongReleaseRejected && evidence.WrongHostInstanceRejected &&
                evidence.MalformedRejected && evidence.RestartInvalidates &&
                evidence.LaunchFailureConsumes && evidence.MutualExclusion &&
                evidence.ReturnedToDisabled;
            if (!evidence.Passed) throw new InvalidOperationException("The isolated one-run gate suite failed.");
            return Results.Ok(new
            {
                authorized = true,
                status = "ONE_RUN_LIVE_APPROVAL_QUALIFICATION_SUCCEEDED",
                qualificationRunId = runId,
                executionIdentity = @"DLE-OS-HOST\DLE-OS",
                message = "The one-run live approval boundary qualified without source or SQL access."
            });
        }
        catch (Exception failure)
        {
            evidence.Error = failure.ToString();
            return Results.Json(new
            {
                code = "ONE_RUN_LIVE_APPROVAL_QUALIFICATION_FAILED",
                qualificationRunId = runId,
                message = failure.Message
            }, statusCode: 500);
        }
        finally
        {
            evidence.CompletedAtUtc = DateTimeOffset.UtcNow;
            var evidencePath = Path.Combine(EvidenceRoot, runId + ".json");
            File.WriteAllText(evidencePath, JsonSerializer.Serialize(evidence,
                new JsonSerializerOptions { WriteIndented = true }) + Environment.NewLine,
                new UTF8Encoding(false));
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
            _ = Task.Run(async () => { await Task.Delay(1000); lifetime.StopApplication(); });
        }
    }

    private static LiveApprovalOneRunEvidence TestOneRun(string parent, string statusPath,
        string statusHash, HostInstanceIdentity instance)
    {
        var root = Path.Combine(parent, "one-run");
        var store = new LiveRunApprovalStore(instance, root, statusPath);
        store.WriteQualificationApproval(LiveRunApprovalStore.CreateForQualification(instance,
            statusHash, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(5)));
        var initiallyValid = store.Inspect().Valid;
        var admissionPath = Path.Combine(root, "isolated-admission.lease");
        using (new FileStream(admissionPath, FileMode.CreateNew, FileAccess.Write,
                   FileShare.Read, 4096, FileOptions.WriteThrough)) { }
        var claim = store.TryClaim("ISOLATED-CONTROL-RUN");
        File.Delete(admissionPath);
        var second = store.TryClaim("ISOLATED-SECOND-RUN");
        store.Complete(claim, "QUALIFICATION_SUCCESS", 0, null);
        var passed = initiallyValid && claim.Claimed && !second.Claimed &&
                     !File.Exists(store.PendingPath) && File.Exists(claim.ConsumedApprovalPath);
        return new(passed, initiallyValid, claim.Claimed, !second.Claimed,
            File.Exists(claim.ConsumedApprovalPath));
    }

    private static bool TestRejected(string parent, string statusPath, string statusHash,
        HostInstanceIdentity instance, LiveRunApproval approval, string expected)
    {
        var root = Path.Combine(parent, "reject-" + Guid.NewGuid().ToString("N"));
        var store = new LiveRunApprovalStore(instance, root, statusPath);
        store.WriteQualificationApproval(approval);
        var result = store.Inspect();
        return !result.Valid && string.Equals(result.Reason, expected, StringComparison.Ordinal) &&
               !store.TryClaim("REJECTED").Claimed;
    }

    private static bool TestMalformed(string parent, string statusPath, HostInstanceIdentity instance)
    {
        var root = Path.Combine(parent, "malformed");
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "pending-live-approval.json"), "{malformed",
            new UTF8Encoding(false));
        var store = new LiveRunApprovalStore(instance, root, statusPath);
        var result = store.Inspect();
        return !result.Valid && result.Reason == "MALFORMED" && !store.TryClaim("REJECTED").Claimed;
    }

    private static bool TestRestart(string parent, string statusPath, string statusHash,
        HostInstanceIdentity instance)
    {
        var root = Path.Combine(parent, "restart");
        var original = new LiveRunApprovalStore(instance, root, statusPath);
        original.WriteQualificationApproval(LiveRunApprovalStore.CreateForQualification(instance,
            statusHash, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(5)));
        var restarted = HostInstanceIdentity.ForQualification(instance.ReleaseId,
            Guid.NewGuid().ToString("N").ToUpperInvariant(), DateTimeOffset.UtcNow);
        var result = new LiveRunApprovalStore(restarted, root, statusPath).Inspect();
        return !result.Valid && result.Reason == "BOUNDARY_MISMATCH";
    }

    private static bool TestLaunchFailure(string parent, string statusPath, string statusHash,
        HostInstanceIdentity instance)
    {
        var root = Path.Combine(parent, "launch-failure");
        var store = new LiveRunApprovalStore(instance, root, statusPath);
        store.WriteQualificationApproval(LiveRunApprovalStore.CreateForQualification(instance,
            statusHash, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddMinutes(5)));
        var claim = store.TryClaim("SIMULATED-LAUNCH-FAILURE");
        store.Complete(claim, "WORKER_LAUNCH_FAILED", null, "Fixed qualification simulation.");
        return claim.Claimed && !File.Exists(store.PendingPath) && !store.TryClaim("SECOND").Claimed;
    }

    private static IResult Disabled() => Results.Json(new
        { code = "INVOICE_HISTORY_EXECUTION_DISABLED" }, statusCode: 503);
}

internal sealed class LiveApprovalQualificationEvidence
{
    public string Schema { get; set; } = "dle-os.governed-refresh.one-live-run-gate-qualification.v1";
    public string QualificationRunId { get; set; } = "";
    public string ReleaseId { get; set; } = "";
    public string RequestedBy { get; set; } = "";
    public DateTimeOffset StartedAtUtc { get; set; }
    public DateTimeOffset CompletedAtUtc { get; set; }
    public string SourceAccess { get; set; } = "NONE";
    public bool CanonicalCommitAllowed { get; set; }
    public LiveApprovalOneRunEvidence OneRun { get; set; } = new(false, false, false, false, false);
    public bool ExpiredRejected { get; set; }
    public bool WrongReleaseRejected { get; set; }
    public bool WrongHostInstanceRejected { get; set; }
    public bool MalformedRejected { get; set; }
    public bool RestartInvalidates { get; set; }
    public bool LaunchFailureConsumes { get; set; }
    public bool MutualExclusion { get; set; }
    public bool ReturnedToDisabled { get; set; }
    public bool Passed { get; set; }
    public string? Error { get; set; }
}

internal sealed record LiveApprovalOneRunEvidence(bool Passed, bool InitiallyValid,
    bool FirstClaimAccepted, bool SecondClaimRejected, bool ConsumedEvidencePresent);
