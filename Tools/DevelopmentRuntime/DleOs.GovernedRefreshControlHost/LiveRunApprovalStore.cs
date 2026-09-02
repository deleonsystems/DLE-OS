using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed class LiveRunApprovalStore
{
    internal const string DefaultRoot =
        @"C:\ProgramData\DLE-OS\GovernedRefreshControl\Approval";
    internal const string DefaultStatusPath =
        @"C:\DLE-OS\Canonical\InvoiceHistory\Refresh\State\status.json";
    private const string Schema = "dle-os.governed-refresh.one-live-run-approval.v1";
    private const string Module = "INVOICE_HISTORY";
    private const string RequiredIssuer = @"DLE-OS-HOST\Miguel";
    private readonly HostInstanceIdentity instance;
    private readonly string root;
    private readonly string statusPath;
    private readonly JsonSerializerOptions json = new() { WriteIndented = true };

    internal LiveRunApprovalStore(HostInstanceIdentity instance) :
        this(instance, DefaultRoot, DefaultStatusPath) { }

    internal LiveRunApprovalStore(HostInstanceIdentity instance, string root, string statusPath)
    {
        this.instance = instance;
        this.root = root;
        this.statusPath = statusPath;
    }

    internal string PendingPath => Path.Combine(root, "pending-live-approval.json");
    internal HostInstanceIdentity HostInstance => instance;

    internal LiveRunApprovalInspection Inspect(DateTimeOffset? observedAt = null)
    {
        var now = observedAt ?? DateTimeOffset.UtcNow;
        if (!File.Exists(PendingPath)) return LiveRunApprovalInspection.Rejected("MISSING");
        LiveRunApproval? approval;
        try
        {
            approval = JsonSerializer.Deserialize<LiveRunApproval>(File.ReadAllText(PendingPath),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch { return LiveRunApprovalInspection.Rejected("MALFORMED"); }
        if (approval is null) return LiveRunApprovalInspection.Rejected("MALFORMED");
        if (!string.Equals(approval.Schema, Schema, StringComparison.Ordinal) ||
            !string.Equals(approval.Module, Module, StringComparison.Ordinal) ||
            !string.Equals(approval.ReleaseId, instance.ReleaseId, StringComparison.Ordinal) ||
            !string.Equals(approval.HostInstanceId, instance.HostInstanceId, StringComparison.Ordinal) ||
            approval.MaximumRuns != 1 ||
            !Guid.TryParseExact(approval.ApprovalId, "N", out _) ||
            !string.Equals(approval.Issuer, RequiredIssuer, StringComparison.OrdinalIgnoreCase))
            return LiveRunApprovalInspection.Rejected("BOUNDARY_MISMATCH");
        if (!DateTimeOffset.TryParse(approval.CreatedAtUtc, out var created) ||
            !DateTimeOffset.TryParse(approval.ExpiresAtUtc, out var expires) ||
            created < instance.StartedAtUtc || created > now.AddMinutes(1) ||
            expires <= created || expires > created.AddMinutes(15) || expires <= now)
            return LiveRunApprovalInspection.Rejected("TIME_INVALID");
        if (!File.Exists(statusPath)) return LiveRunApprovalInspection.Rejected("DURABLE_STATE_UNAVAILABLE");
        var statusHash = FileSha256(statusPath);
        if (!string.Equals(statusHash, approval.DurableStatusSha256, StringComparison.Ordinal))
            return LiveRunApprovalInspection.Rejected("DURABLE_STATE_CHANGED");
        var expectedEvidence = ComputeEvidenceHash(approval);
        if (!string.Equals(expectedEvidence, approval.EvidenceSha256, StringComparison.Ordinal))
            return LiveRunApprovalInspection.Rejected("EVIDENCE_HASH_MISMATCH");
        return new(true, "VALID", approval, "");
    }

    internal LiveRunApprovalClaim TryClaim(string controlRunId)
    {
        var inspection = Inspect();
        if (!inspection.Valid || inspection.Approval is null)
            return LiveRunApprovalClaim.Rejected(inspection.Reason);
        Directory.CreateDirectory(root);
        var consumed = Path.Combine(root,
            $"consumed-live-approval-{inspection.Approval.ApprovalId.ToUpperInvariant()}.json");
        try { File.Move(PendingPath, consumed); }
        catch (IOException) { return LiveRunApprovalClaim.Rejected("ALREADY_CLAIMED"); }
        var claim = new LiveRunApprovalClaimEvidence
        {
            Schema = "dle-os.governed-refresh.one-live-run-claim.v1",
            ApprovalId = inspection.Approval.ApprovalId,
            ReleaseId = instance.ReleaseId,
            HostInstanceId = instance.HostInstanceId,
            ControlRunId = controlRunId,
            ClaimedAtUtc = DateTimeOffset.UtcNow,
            ApprovalEvidenceSha256 = inspection.Approval.EvidenceSha256,
            ConsumedApprovalPath = consumed
        };
        var claimPath = Path.Combine(root,
            $"claim-{inspection.Approval.ApprovalId.ToUpperInvariant()}.json");
        WriteAtomic(claimPath, claim);
        return new(true, "CLAIMED", inspection.Approval, consumed, claimPath);
    }

    internal void Complete(LiveRunApprovalClaim claim, string outcome, int? workerExitCode, string? error)
    {
        if (!claim.Claimed || claim.Approval is null) return;
        var path = Path.Combine(root,
            $"completion-{claim.Approval.ApprovalId.ToUpperInvariant()}.json");
        WriteAtomic(path, new
        {
            schema = "dle-os.governed-refresh.one-live-run-completion.v1",
            claim.Approval.ApprovalId,
            releaseId = instance.ReleaseId,
            hostInstanceId = instance.HostInstanceId,
            completedAtUtc = DateTimeOffset.UtcNow,
            outcome,
            workerExitCode,
            error,
            returnedToExecutionDisabled = !File.Exists(PendingPath)
        });
    }

    internal static string ComputeEvidenceHash(LiveRunApproval approval)
    {
        var material = string.Join('|', approval.Schema, approval.Module, approval.ReleaseId,
            approval.HostInstanceId, approval.CreatedAtUtc, approval.ExpiresAtUtc,
            approval.MaximumRuns.ToString(System.Globalization.CultureInfo.InvariantCulture),
            approval.ApprovalId, approval.Issuer, approval.DurableStatusSha256);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
    }

    internal static LiveRunApproval CreateForQualification(HostInstanceIdentity instance,
        string durableStatusSha256, DateTimeOffset createdAt, DateTimeOffset expiresAt,
        string? releaseId = null, string? hostInstanceId = null)
    {
        var approval = new LiveRunApproval
        {
            Schema = Schema, Module = Module,
            ReleaseId = releaseId ?? instance.ReleaseId,
            HostInstanceId = hostInstanceId ?? instance.HostInstanceId,
            CreatedAtUtc = createdAt.ToString("O"), ExpiresAtUtc = expiresAt.ToString("O"),
            MaximumRuns = 1, ApprovalId = Guid.NewGuid().ToString("N").ToUpperInvariant(),
            Issuer = RequiredIssuer, DurableStatusSha256 = durableStatusSha256
        };
        approval.EvidenceSha256 = ComputeEvidenceHash(approval);
        return approval;
    }

    internal void WriteQualificationApproval(LiveRunApproval approval)
    {
        Directory.CreateDirectory(root);
        WriteAtomic(PendingPath, approval);
    }

    private void WriteAtomic(string path, object value)
    {
        var stage = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(stage, JsonSerializer.Serialize(value, json) + Environment.NewLine,
            new UTF8Encoding(false));
        File.Move(stage, path, true);
    }

    internal static string FileSha256(string path) =>
        Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
}

internal sealed class LiveRunApproval
{
    public string Schema { get; set; } = "";
    public string Module { get; set; } = "";
    public string ReleaseId { get; set; } = "";
    public string HostInstanceId { get; set; } = "";
    public string CreatedAtUtc { get; set; } = "";
    public string ExpiresAtUtc { get; set; } = "";
    public int MaximumRuns { get; set; }
    public string ApprovalId { get; set; } = "";
    public string Issuer { get; set; } = "";
    public string DurableStatusSha256 { get; set; } = "";
    public string EvidenceSha256 { get; set; } = "";
}

internal sealed record LiveRunApprovalInspection(bool Valid, string Reason,
    LiveRunApproval? Approval, string Detail)
{
    internal static LiveRunApprovalInspection Rejected(string reason) => new(false, reason, null, "");
}

internal sealed record LiveRunApprovalClaim(bool Claimed, string Reason,
    LiveRunApproval? Approval, string ConsumedApprovalPath, string ClaimEvidencePath)
{
    internal static LiveRunApprovalClaim Rejected(string reason) => new(false, reason, null, "", "");
}

internal sealed class LiveRunApprovalClaimEvidence
{
    public string Schema { get; set; } = "";
    public string ApprovalId { get; set; } = "";
    public string ReleaseId { get; set; } = "";
    public string HostInstanceId { get; set; } = "";
    public string ControlRunId { get; set; } = "";
    public DateTimeOffset ClaimedAtUtc { get; set; }
    public string ApprovalEvidenceSha256 { get; set; } = "";
    public string ConsumedApprovalPath { get; set; } = "";
}
