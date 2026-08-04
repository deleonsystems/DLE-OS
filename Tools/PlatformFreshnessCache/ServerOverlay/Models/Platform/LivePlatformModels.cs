namespace DLE_OS_Server.Models.Platform;

internal sealed class LiveSnapshotRow
{
    public Guid ImportRunId { get; init; }
    public string EnvironmentId { get; init; } = string.Empty;
    public string MirrorRunId { get; init; } = string.Empty;
    public string PackageHash { get; init; } = string.Empty;
    public string ContractVersion { get; init; } = string.Empty;
    public DateTime SnapshotTimestampUtc { get; init; }
    public long SnapshotAgeSeconds { get; init; }
    public DateTime SourceCheckedAtUtc { get; init; }
    public long SourceCheckAgeSeconds { get; init; }
    public DateTime QualificationCompletedAtUtc { get; init; }
    public long QualificationAgeSeconds { get; init; }
    public string LastSourceCheckResult { get; init; } = string.Empty;
    public string SourceChangeStatus { get; init; } = string.Empty;
    public string SourceIndicatorFingerprint { get; init; } = string.Empty;
    public string LastFullExtractionRunId { get; init; } = string.Empty;
    public bool LastForceFullIntent { get; init; }
    public long BillOfMaterialCount { get; init; }
    public long InventoryItemCount { get; init; }
    public long WorkOrderCount { get; init; }
    public long GeneralLedgerAccountCount { get; init; }
    public long TotalCount { get; init; }
}

internal sealed class LiveRuntimePermissionRow
{
    public string OriginalLogin { get; init; } = string.Empty;
    public string ServerLogin { get; init; } = string.Empty;
    public string DatabaseUser { get; init; } = string.Empty;
    public string DatabaseName { get; init; } = string.Empty;
    public int IsLiveApiReader { get; init; }
    public int IsDbOwner { get; init; }
    public int IsDbDataWriter { get; init; }
    public int IsSysadmin { get; init; }
    public int IsServeradmin { get; init; }
    public int IsSecurityadmin { get; init; }
    public int IsProcessadmin { get; init; }
    public int IsSetupadmin { get; init; }
    public int IsBulkadmin { get; init; }
    public int IsDiskadmin { get; init; }
    public int IsDbcreator { get; init; }
    public int CanSelectCanonical { get; init; }
    public int CanSelectMetadata { get; init; }
    public int CanSelectPlatformDirect { get; init; }
    public int CanInsert { get; init; }
    public int CanUpdate { get; init; }
    public int CanDelete { get; init; }
    public int CanAlter { get; init; }
    public int CanControl { get; init; }
    public int CanExecute { get; init; }
}
