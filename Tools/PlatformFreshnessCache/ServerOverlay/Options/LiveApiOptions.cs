namespace DLE_OS_Server.Options;

public sealed class LiveApiOptions
{
    public const string SectionName = "LiveApi";

    public string RequiredWindowsIdentity { get; init; } = string.Empty;
    public string DataEnvironment { get; init; } = string.Empty;
    public string Database { get; init; } = string.Empty;
    public string ContractVersion { get; init; } = string.Empty;
    public string StoredContractVersion { get; init; } = string.Empty;
    public Guid ExpectedImportRunId { get; init; }
    public string ExpectedMirrorRunId { get; init; } = string.Empty;
    public string ExpectedPackageHash { get; init; } = string.Empty;
    public bool AcceptLatestQualifiedOperationalSnapshot { get; init; }
    public long ExpectedBillOfMaterialCount { get; init; }
    public long ExpectedInventoryItemCount { get; init; }
    public long ExpectedWorkOrderCount { get; init; }
    public long ExpectedGeneralLedgerAccountCount { get; init; }
    public int FreshnessThresholdMinutes { get; init; }
    public int SnapshotWarningMinutes { get; init; }
    public int SourceCheckWarningMinutes { get; init; }
    public int SourceCheckHardExpirationMinutes { get; init; }
    public int QualificationWarningMinutes { get; init; }
    public int WorkOrderNumberWidth { get; init; }
    public string AllowedBrowserOrigin { get; init; } = string.Empty;
    public string StartupEvidencePath { get; init; } = string.Empty;

    public long ExpectedTotalCount =>
        ExpectedBillOfMaterialCount +
        ExpectedInventoryItemCount +
        ExpectedWorkOrderCount +
        ExpectedGeneralLedgerAccountCount;
}
