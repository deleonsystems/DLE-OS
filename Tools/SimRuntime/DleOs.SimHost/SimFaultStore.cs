internal sealed record SimFaultProfile(
    string Id,
    string Label,
    string Scope,
    string Occurrence,
    string Description);

internal sealed record SelectSimFaultRequest(string? FaultId);

internal sealed class SimFaultStore
{
    internal const string None = "none";
    internal const string VerifiedStatusResponseLost = "verified-status-response-lost";
    internal const string VerifiedStatusWriteUnavailable = "verified-status-write-unavailable";
    internal const string VerifiedStatusReadUnavailable = "verified-status-read-unavailable";

    internal static readonly IReadOnlyList<SimFaultProfile> Profiles = new[]
    {
        new SimFaultProfile(None, "None", "SIM", "INACTIVE",
            "Normal deterministic baseline behavior."),
        new SimFaultProfile(VerifiedStatusResponseLost, "Verified Status — Lost Response",
            "VERIFIED_STATUS_WRITE_RESPONSE", "NEXT_SUCCESS_ONCE",
            "Commits the next new Verified Status event, then returns an ambiguous failure exactly once."),
        new SimFaultProfile(VerifiedStatusWriteUnavailable, "Verified Status — Storage Unavailable",
            "VERIFIED_STATUS_WRITE_PRECOMMIT", "PERSISTENT",
            "Rejects valid Verified Status writes before sequence allocation or commit."),
        new SimFaultProfile(VerifiedStatusReadUnavailable, "Verified Status — Read Unavailable",
            "VERIFIED_STATUS_READ", "PERSISTENT",
            "Rejects Verified Status latest/history reads while leaving canonical modules healthy.")
    };

    private readonly object gate = new();
    private string activeFaultId = None;
    private string status = "INACTIVE";
    private int triggerCount;

    internal object CatalogContract()
    {
        lock (gate)
            return new
            {
                activeFaultId,
                state = StateContractCore(),
                profiles = Profiles.Select(profile => new
                {
                    id = profile.Id,
                    label = profile.Label,
                    scope = profile.Scope,
                    occurrence = profile.Occurrence,
                    description = profile.Description
                }).ToArray(),
                environment = "SIM"
            };
    }

    internal object StateContract()
    {
        lock (gate) return StateContractCore();
    }

    internal bool TrySelect(string? faultId)
    {
        var normalized = Convert.ToString(faultId ?? "")!.Trim();
        if (!Profiles.Any(profile => string.Equals(profile.Id, normalized, StringComparison.Ordinal)))
            return false;
        lock (gate)
        {
            activeFaultId = normalized;
            status = normalized == None ? "INACTIVE" : "ARMED";
            triggerCount = 0;
        }
        return true;
    }

    internal void Reset() => TrySelect(None);

    internal bool TriggerPersistent(string faultId)
    {
        lock (gate)
        {
            if (!string.Equals(activeFaultId, faultId, StringComparison.Ordinal)) return false;
            triggerCount += 1;
            status = "TRIGGERED";
            return true;
        }
    }

    internal bool ConsumeOnce(string faultId)
    {
        lock (gate)
        {
            if (!string.Equals(activeFaultId, faultId, StringComparison.Ordinal) || status != "ARMED")
                return false;
            triggerCount += 1;
            status = "CONSUMED";
            return true;
        }
    }

    private object StateContractCore()
    {
        var profile = Profiles.Single(item => item.Id == activeFaultId);
        return new
        {
            faultId = activeFaultId,
            profile.Label,
            profile.Scope,
            profile.Occurrence,
            status,
            triggerCount,
            remainingOccurrences = profile.Occurrence == "NEXT_SUCCESS_ONCE"
                ? Math.Max(0, 1 - triggerCount) : (int?)null,
            localOnly = true,
            deterministic = true
        };
    }
}
