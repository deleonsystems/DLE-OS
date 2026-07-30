namespace DLE_OS_Server.Contracts.Platform;

public sealed class PurchaseOrderLineDto
{
    public string? PurchaseOrderLineId { get; init; }
    public string? FirmId { get; init; }
    public string? VendorNumber { get; init; }
    public string? VendorName { get; init; }
    public string? PurchaseOrderNumber { get; init; }
    public string? PurchaseOrderLineNumber { get; init; }
    public DateTime? OrderDateIso { get; init; }
    public string? PurchaseOrderStatus { get; init; }
    public string? HoldFlag { get; init; }
    public string? PaymentTermsCode { get; init; }
    public string? PaymentTermsDescription { get; init; }
    public string? PaymentTermsResolutionStatus { get; init; }
    public string? FreightTerms { get; init; }
    public string? ShippingMethod { get; init; }
    public string? Fob { get; init; }
    public string? LineCode { get; init; }
    public string? LineCodeDescription { get; init; }
    public string? LineCodeResolutionStatus { get; init; }
    public string? LineType { get; init; }
    public string? ItemNumber { get; init; }
    public string? ItemDescription { get; init; }
    public string? OrderMemo { get; init; }
    public string? UnitOfMeasure { get; init; }
    public string? UnitOfMeasureDescription { get; init; }
    public string? UnitOfMeasureResolutionStatus { get; init; }
    public decimal QuantityOrdered { get; init; }
    public decimal QuantityReceived { get; init; }
    public decimal QuantityOpen { get; init; }
    public DateTime? RequiredDateIso { get; init; }
    public DateTime? PromisedDateIso { get; init; }
    public string? WorkOrderNumber { get; init; }
    public string? CustomerNumber { get; init; }
    public string? SalesOrderNumber { get; init; }
    public string? SalesOrderLineNumber { get; init; }
    public string? LineStatus { get; init; }
    public bool IsOpen { get; init; }
    public bool IsClosed { get; init; }
    public bool IsCanceled { get; init; }
    public string? VendorResolutionStatus { get; init; }
    public string? InventoryResolutionStatus { get; init; }
    public string? WorkOrderResolutionStatus { get; init; }
    public string? SalesOrderResolutionStatus { get; init; }
    public Guid PurchaseOrderImportRunId { get; init; }
    public DateTime ImportedAtUtc { get; init; }
}

public sealed class PurchaseOrderDto
{
    public string? FirmId { get; init; }
    public string? VendorNumber { get; init; }
    public string? PurchaseOrderNumber { get; init; }
    public string? VendorName { get; init; }
    public string? WarehouseId { get; init; }
    public string? WarehouseDescription { get; init; }
    public string? WarehouseResolutionStatus { get; init; }
    public string? PurchasingAddressCode { get; init; }
    public string? OrderDateRaw { get; init; }
    public DateTime? OrderDateIso { get; init; }
    public string? PromisedDateRaw { get; init; }
    public DateTime? PromisedDateIso { get; init; }
    public string? NotBeforeDateRaw { get; init; }
    public DateTime? NotBeforeDateIso { get; init; }
    public string? RequiredDateRaw { get; init; }
    public DateTime? RequiredDateIso { get; init; }
    public string? LastReceiptDateRaw { get; init; }
    public DateTime? LastReceiptDateIso { get; init; }
    public string? HoldFlag { get; init; }
    public string? PrintStatus { get; init; }
    public string? PaymentTermsCode { get; init; }
    public string? PaymentTermsDescription { get; init; }
    public string? PaymentTermsResolutionStatus { get; init; }
    public string? FreightTerms { get; init; }
    public string? ShippingMethod { get; init; }
    public string? Acknowledgment { get; init; }
    public string? Fob { get; init; }
    public string? MessageCode { get; init; }
    public string? RequisitionNumber { get; init; }
    public string? PurchaseOrderStatus { get; init; }
    public bool IsOpen { get; init; }
    public bool IsClosed { get; init; }
    public bool IsCanceled { get; init; }
    public string? VendorResolutionStatus { get; init; }
    public Guid PurchaseOrderImportRunId { get; init; }
    public DateTime ImportedAtUtc { get; init; }
}

public sealed class PurchaseOrderMetadataDto
{
    public required Guid PurchaseOrderImportRunId { get; init; }
    public required string SourceQualificationRunId { get; init; }
    public required string PackageSha256 { get; init; }
    public required string ContractVersion { get; init; }
    public required DateTime SnapshotAsOfUtc { get; init; }
    public required int HeaderCount { get; init; }
    public required int LineCount { get; init; }
    public required int SourceOrphanLineCount { get; init; }
    public required string ImportStatus { get; init; }
}
