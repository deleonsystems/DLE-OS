namespace DLE_OS_Server.Contracts.Platform;

public sealed class VendorMasterDto
{
    public string? VendorMasterId { get; init; }
    public string? FirmId { get; init; }
    public string? VendorNumber { get; init; }
    public string? VendorName { get; init; }
    public string? VendorStatus { get; init; }
    public bool? IsActive { get; init; }
    public string? VendorType { get; init; }
    public string? VendorClass { get; init; }
    public string? AddressLine1 { get; init; }
    public string? AddressLine2 { get; init; }
    public string? AddressLine3 { get; init; }
    public string? PostalCode { get; init; }
    public string? Country { get; init; }
    public string? PrimaryContactName { get; init; }
    public string? PrimaryPhone { get; init; }
    public string? PrimaryPhoneExtension { get; init; }
    public string? PaymentTermsCode { get; init; }
    public string? PaymentTermsDescription { get; init; }
    public string? ApprovedSupplierStatus { get; init; }
    public string? SourceRecordIdentity { get; init; }
    public Guid VendorMasterImportRunId { get; init; }
    public DateTime ImportedAtUtc { get; init; }
    public long PurchasingAddressCount { get; init; }
}

public sealed class VendorAddressDto
{
    public string? FirmId { get; init; }
    public string? VendorNumber { get; init; }
    public string? AddressCode { get; init; }
    public string? AddressType { get; init; }
    public string? AddressName { get; init; }
    public string? AddressLine1 { get; init; }
    public string? AddressLine2 { get; init; }
    public string? AddressLine3 { get; init; }
    public string? PostalCode { get; init; }
    public string? Country { get; init; }
    public string? ContactName { get; init; }
    public string? Phone { get; init; }
    public string? PhoneExtension { get; init; }
    public bool IsPrimary { get; init; }
    public bool? IsActive { get; init; }
}

public sealed class VendorMasterMetadataDto
{
    public required Guid VendorMasterImportRunId { get; init; }
    public required string SourceQualificationRunId { get; init; }
    public required string PackageSha256 { get; init; }
    public required string ContractVersion { get; init; }
    public required DateTime SnapshotAsOfUtc { get; init; }
    public required int VendorCount { get; init; }
    public required int VendorAddressCount { get; init; }
    public required int OrphanAddressCount { get; init; }
    public required int OrphanDetailCount { get; init; }
    public required string ImportStatus { get; init; }
}
