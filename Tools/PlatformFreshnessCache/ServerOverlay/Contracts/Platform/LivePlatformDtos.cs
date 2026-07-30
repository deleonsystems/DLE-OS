namespace DLE_OS_Server.Contracts.Platform;

public sealed class LiveSnapshotMetadataDto
{
    public required string DataEnvironment { get; init; }
    public required string Database { get; init; }
    public required string ContractVersion { get; init; }
    public required string ApiContractVersion { get; init; }
    public required string ReadinessVerdict { get; init; }
    public required string ReadinessState { get; init; }
    public required string ReadinessReason { get; init; }
    public required Guid CurrentImportRunId { get; init; }
    public required string MirrorRunId { get; init; }
    public required string PackageHash { get; init; }
    public required DateTime SnapshotTimestampUtc { get; init; }
    public required DateTime SnapshotAsOfUtc { get; init; }
    public required long SnapshotAgeSeconds { get; init; }
    public required DateTime SourceCheckedAtUtc { get; init; }
    public required long SourceCheckAgeSeconds { get; init; }
    public required DateTime QualificationCompletedAtUtc { get; init; }
    public required long QualificationAgeSeconds { get; init; }
    public required string SourceChangeStatus { get; init; }
    public required string LastSourceCheckResult { get; init; }
    public required string FreshnessStatus { get; init; }
    public required IReadOnlyList<string> Warnings { get; init; }
    public required IReadOnlyList<string> HardFailures { get; init; }
    public required SnapshotEntityCountsDto EntityCounts { get; init; }
    public required long TotalCount { get; init; }
}

public sealed class LiveApiReadinessDto
{
    public required string DataEnvironment { get; init; }
    public required string Database { get; init; }
    public required string ContractVersion { get; init; }
    public required string ApiContractVersion { get; init; }
    public required string ReadinessVerdict { get; init; }
    public required string ReadinessState { get; init; }
    public required string ReadinessReason { get; init; }
    public Guid? CurrentImportRunId { get; init; }
    public string? MirrorRunId { get; init; }
    public string? PackageHash { get; init; }
    public DateTime? SnapshotTimestampUtc { get; init; }
    public DateTime? SnapshotAsOfUtc { get; init; }
    public long? SnapshotAgeSeconds { get; init; }
    public DateTime? SourceCheckedAtUtc { get; init; }
    public long? SourceCheckAgeSeconds { get; init; }
    public DateTime? QualificationCompletedAtUtc { get; init; }
    public long? QualificationAgeSeconds { get; init; }
    public required string SourceChangeStatus { get; init; }
    public required string LastSourceCheckResult { get; init; }
    public required string FreshnessStatus { get; init; }
    public required IReadOnlyList<string> Warnings { get; init; }
    public required IReadOnlyList<string> HardFailures { get; init; }
    public required SnapshotEntityCountsDto EntityCounts { get; init; }
    public required long TotalCount { get; init; }
    public required IReadOnlyList<ApiReadinessCheckDto> Checks { get; init; }
}
