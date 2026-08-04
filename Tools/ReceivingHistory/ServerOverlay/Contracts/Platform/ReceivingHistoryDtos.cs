namespace DLE_OS_Server.Contracts.Platform;

public sealed class ReceivingHistoryLineDto
{
    public string? PurchaseReceiptLineId { get; init; }
    public string? FirmId { get; init; }
    public string? ReceiverNumber { get; init; }
    public string? ReceiptDateRaw { get; init; }
    public DateTime? ReceiptDateIso { get; init; }
    public string? ReceiptDateResolutionStatus { get; init; }
    public string? ReceiptDateResolutionReason { get; init; }
    public string? OrderDateRaw { get; init; }
    public DateTime? OrderDateIso { get; init; }
    public string? OrderDateResolutionStatus { get; init; }
    public string? OrderDateResolutionReason { get; init; }
    public string? PurchaseOrderNumber { get; init; }
    public string? PurchaseOrderLineNumber { get; init; }
    public string? RequiredDateRaw { get; init; }
    public DateTime? RequiredDateIso { get; init; }
    public string? RequiredDateResolutionStatus { get; init; }
    public string? RequiredDateResolutionReason { get; init; }
    public string? VendorNumber { get; init; }
    public string? VendorName { get; init; }
    public string? LineCode { get; init; }
    public string? LineType { get; init; }
    public string? ItemNumber { get; init; }
    public string? ItemDescription { get; init; }
    public string? OrderMemo { get; init; }
    public string? UnitOfMeasure { get; init; }
    public decimal QuantityPostedSigned { get; init; }
    public decimal QuantityReceived { get; init; }
    public decimal QuantityAccepted { get; init; }
    public decimal QuantityRejected { get; init; }
    public decimal QuantityReturned { get; init; }
    public decimal QuantityInvoiced { get; init; }
    public string? PackingSlipNumber { get; init; }
    public string? WarehouseId { get; init; }
    public string? InventoryLocation { get; init; }
    public string? WorkOrderNumber { get; init; }
    public string? SalesOrderNumber { get; init; }
    public string? SalesOrderLineNumber { get; init; }
    public string? QuantityDispositionStatus { get; init; }
    public string? InspectionStatus { get; init; }
    public string? VendorResolutionStatus { get; init; }
    public string? PurchaseOrderResolutionStatus { get; init; }
    public string? InventoryResolutionStatus { get; init; }
    public string? WorkOrderResolutionStatus { get; init; }
    public Guid ReceivingHistoryImportRunId { get; init; }
    public DateTime ImportedAtUtc { get; init; }
}

public sealed class ReceivingHistoryMetadataDto
{
    public required Guid ReceivingHistoryImportRunId { get; init; }
    public required string SourceQualificationRunId { get; init; }
    public required string PackageSha256 { get; init; }
    public required string ContractVersion { get; init; }
    public required DateTime SnapshotAsOfUtc { get; init; }
    public required int HeaderCount { get; init; }
    public required int LineCount { get; init; }
    public required int RejectionCount { get; init; }
    public required int MalformedOrderDateCount { get; init; }
    public required int MalformedReceiptDateCount { get; init; }
    public required int MalformedRequiredDateCount { get; init; }
    public required int MissingPurchaseOrderCount { get; init; }
    public required string ImportStatus { get; init; }
}
