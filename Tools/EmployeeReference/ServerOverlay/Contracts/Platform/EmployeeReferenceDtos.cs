namespace DLE_OS_Server.Contracts.Platform;

public sealed class EmployeeReferenceDto
{
    public string? EmployeeReferenceId { get; init; }
    public string? FirmId { get; init; }
    public string? EmployeeNumber { get; init; }
    public string? DisplayName { get; init; }
    public string? FirstName { get; init; }
    public string? LastName { get; init; }
    public string? DepartmentCode { get; init; }
    public string? DepartmentName { get; init; }
    public string? JobTitleCode { get; init; }
    public string? JobTitle { get; init; }
    public string? EmployeeStatus { get; init; }
    public bool IsActive { get; init; }
    public long OperationalCodeCount { get; init; }
    public string? SourceSystem { get; init; }
    public string? SourceRecordIdentity { get; init; }
    public Guid EmployeeReferenceImportRunId { get; init; }
    public DateTime ImportedAtUtc { get; init; }
}

public sealed class EmployeeOperationalCodeDto
{
    public string? CodeScope { get; init; }
    public string? FirmId { get; init; }
    public string? EmployeeNumber { get; init; }
    public string? CodeType { get; init; }
    public string? OperationalCode { get; init; }
    public string? CodeDescription { get; init; }
    public string? ResolutionStatus { get; init; }
    public bool? IsActive { get; init; }
    public string? SourceSystem { get; init; }
    public string? SourceRecordIdentity { get; init; }
    public Guid EmployeeReferenceImportRunId { get; init; }
    public DateTime ImportedAtUtc { get; init; }
}

public sealed class EmployeeReferenceMetadataDto
{
    public required Guid EmployeeReferenceImportRunId { get; init; }
    public required string SourceQualificationRunId { get; init; }
    public required string PackageSha256 { get; init; }
    public required string ContractVersion { get; init; }
    public required DateTime SnapshotAsOfUtc { get; init; }
    public required int EmployeeCount { get; init; }
    public required int OperationalCodeCount { get; init; }
    public required int DepartmentCount { get; init; }
    public required int JobTitleCount { get; init; }
    public required int ActiveEmployeeCount { get; init; }
    public required int InactiveEmployeeCount { get; init; }
    public required int UnresolvedCodeCount { get; init; }
    public required int AmbiguousCodeCount { get; init; }
    public required int GenericSystemCodeCount { get; init; }
    public required string ImportStatus { get; init; }
}
