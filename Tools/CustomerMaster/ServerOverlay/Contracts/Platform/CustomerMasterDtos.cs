namespace DLE_OS_Server.Contracts.Platform;

public sealed class CustomerMasterDto
{
    public string? CustomerMasterId { get; init; }
    public string? FirmId { get; init; }
    public string? CustomerNumber { get; init; }
    public string? CustomerName { get; init; }
    public string? CustomerStatus { get; init; }
    public bool? IsActive { get; init; }
    public string? AddressLine1 { get; init; }
    public string? AddressLine2 { get; init; }
    public string? AddressLine3 { get; init; }
    public string? AddressLine4 { get; init; }
    public string? AddressLine5 { get; init; }
    public string? PostalCode { get; init; }
    public string? Country { get; init; }
    public string? PrimaryContactName { get; init; }
    public string? PrimaryPhone { get; init; }
    public string? PrimaryPhoneExtension { get; init; }
    public string? SalespersonCode { get; init; }
    public string? SalespersonName { get; init; }
    public string? TerritoryCode { get; init; }
    public string? TerritoryName { get; init; }
    public string? PaymentTermsCode { get; init; }
    public string? PaymentTermsDescription { get; init; }
    public string? ShippingMethodCode { get; init; }
    public string? FreightTerms { get; init; }
    public string? OrderFreightTermsCode { get; init; }
    public string? CustomerTypeCode { get; init; }
    public string? CustomerTypeDescription { get; init; }
    public string? PricingClassCode { get; init; }
    public string? PricingClassDescription { get; init; }
    public string? SourceRecordIdentity { get; init; }
    public Guid CustomerMasterImportRunId { get; init; }
    public DateTime ImportedAtUtc { get; init; }
    public long AlternateShipToCount { get; init; }
}

public sealed class CustomerAddressDto
{
    public string? FirmId { get; init; }
    public string? CustomerNumber { get; init; }
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
    public string? SalespersonCode { get; init; }
    public string? SalespersonName { get; init; }
    public string? TerritoryCode { get; init; }
    public string? TerritoryName { get; init; }
    public bool IsPrimary { get; init; }
    public bool? IsActive { get; init; }
}

public sealed class CustomerMasterMetadataDto
{
    public required Guid CustomerMasterImportRunId { get; init; }
    public required string SourceQualificationRunId { get; init; }
    public required string PackageSha256 { get; init; }
    public required string ContractVersion { get; init; }
    public required DateTime SnapshotAsOfUtc { get; init; }
    public required int CustomerCount { get; init; }
    public required int CustomerAddressCount { get; init; }
    public required int OrphanAddressCount { get; init; }
    public required string ImportStatus { get; init; }
}
