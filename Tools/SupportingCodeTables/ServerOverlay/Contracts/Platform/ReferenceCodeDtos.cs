namespace DLE_OS_Server.Contracts.Platform;

public sealed class ReferenceCodeDto
{
    public long ReferenceCodeId { get; init; }
    public required string FirmId { get; init; }
    public required string CodeDomain { get; init; }
    public required string CodeType { get; init; }
    public required string CodeValue { get; init; }
    public string? CodeDescription { get; init; }
    public string? ShortDescription { get; init; }
    public string? ParentCodeValue { get; init; }
    public int? SortOrder { get; init; }
    public bool? IsActive { get; init; }
    public required string SourceType { get; init; }
    public required string AccessClassification { get; init; }
    public required string ResolutionStatus { get; init; }
    public string? SourceRecordIdentity { get; init; }
    public long UsageCount { get; init; }
    public Guid ReferenceCodeImportRunId { get; init; }
    public DateTime ImportedAtUtc { get; init; }
}

public sealed class ReferenceCodeMetadataDto
{
    public required Guid ReferenceCodeImportRunId { get; init; }
    public required string SourceQualificationRunId { get; init; }
    public required string PackageSha256 { get; init; }
    public required string ContractVersion { get; init; }
    public required DateTime SnapshotAsOfUtc { get; init; }
    public required int ReferenceCodeCount { get; init; }
    public required int RelationshipCount { get; init; }
    public required int UsageEvidenceCount { get; init; }
    public required int ResolvedCount { get; init; }
    public required int UnresolvedCount { get; init; }
    public required int AmbiguousCount { get; init; }
    public required int GenericSystemCount { get; init; }
    public required int CanonicalEnumCount { get; init; }
    public required int RestrictedSourceRecordCount { get; init; }
    public required string ImportStatus { get; init; }
}
