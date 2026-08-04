using Dapper;
using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform.Live;
using DLE_OS_Server.Models.Platform;

namespace DLE_OS_Server.Data.Platform;

public sealed record ReceivingHistoryFilter(
    string? ReceiverNumber,
    DateTime? ReceiptFrom,
    DateTime? ReceiptTo,
    string? PurchaseOrderNumber,
    string? PurchaseOrderLineNumber,
    string? VendorNumber,
    string? VendorName,
    string? ItemNumber,
    string? PackingSlipNumber,
    string? WorkOrderNumber,
    string? WarehouseId,
    string? InspectionStatus,
    bool? RejectedOnly,
    bool? ReturnedOnly);

public sealed class ReceivingHistoryRepository
{
    private const string WhereSql = """
WHERE (@ReceiverNumber IS NULL OR ReceiverNumber = @ReceiverNumber)
  AND (@ReceiptFrom IS NULL OR ReceiptDateIso >= @ReceiptFrom)
  AND (@ReceiptTo IS NULL OR ReceiptDateIso <= @ReceiptTo)
  AND (@PurchaseOrderNumber IS NULL
       OR PurchaseOrderNumber = @PurchaseOrderNumber)
  AND (@PurchaseOrderLineNumber IS NULL
       OR PurchaseOrderLineNumber = @PurchaseOrderLineNumber)
  AND (@VendorNumber IS NULL OR VendorNumber = @VendorNumber)
  AND (@VendorName IS NULL OR VendorName LIKE N'%' + @VendorName + N'%')
  AND (@ItemNumber IS NULL OR ItemNumber = @ItemNumber)
  AND (@PackingSlipNumber IS NULL
       OR PackingSlipNumber = @PackingSlipNumber)
  AND (@WorkOrderNumber IS NULL OR WorkOrderNumber = @WorkOrderNumber)
  AND (@WarehouseId IS NULL OR WarehouseId = @WarehouseId)
  AND (@InspectionStatus IS NULL OR InspectionStatus = @InspectionStatus)
  AND (@RejectedOnly IS NULL OR @RejectedOnly = 0 OR QuantityRejected <> 0)
  AND (@ReturnedOnly IS NULL OR @ReturnedOnly = 0 OR QuantityReturned <> 0)
""";

    private const string SelectSql = """
SELECT
    PurchaseReceiptLineId, FirmId, ReceiverNumber, ReceiptDateRaw,
    ReceiptDateIso, ReceiptDateResolutionStatus, ReceiptDateResolutionReason,
    OrderDateRaw, OrderDateIso, OrderDateResolutionStatus,
    OrderDateResolutionReason,
    PurchaseOrderNumber, PurchaseOrderLineNumber, RequiredDateRaw,
    RequiredDateIso, RequiredDateResolutionStatus, RequiredDateResolutionReason,
    VendorNumber, VendorName,
    LineCode, LineType, ItemNumber, ItemDescription, OrderMemo, UnitOfMeasure,
    QuantityPostedSigned, QuantityReceived, QuantityAccepted,
    QuantityRejected, QuantityReturned, QuantityInvoiced, PackingSlipNumber,
    WarehouseId, InventoryLocation, WorkOrderNumber, SalesOrderNumber,
    SalesOrderLineNumber, QuantityDispositionStatus, InspectionStatus,
    VendorResolutionStatus, PurchaseOrderResolutionStatus,
    InventoryResolutionStatus, WorkOrderResolutionStatus,
    ReceivingHistoryImportRunId, ImportedAtUtc
FROM canonical.ReceivingHistoryViewer
""";

    private readonly LivePlatformSqlConnectionFactory _connectionFactory;

    public ReceivingHistoryRepository(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<PagedQueryResult<ReceivingHistoryLineDto>> GetPageAsync(
        PageRequest page,
        ReceivingHistoryFilter filter,
        CancellationToken cancellationToken)
    {
        var parameters = new
        {
            filter.ReceiverNumber,
            filter.ReceiptFrom,
            filter.ReceiptTo,
            filter.PurchaseOrderNumber,
            filter.PurchaseOrderLineNumber,
            filter.VendorNumber,
            filter.VendorName,
            filter.ItemNumber,
            filter.PackingSlipNumber,
            filter.WorkOrderNumber,
            filter.WarehouseId,
            filter.InspectionStatus,
            filter.RejectedOnly,
            filter.ReturnedOnly,
            page.Offset,
            page.PageSize
        };
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT_BIG(*) FROM canonical.ReceivingHistoryViewer\n"
                    + WhereSql,
                parameters,
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<ReceivingHistoryLineDto>(
            new CommandDefinition(
                SelectSql + "\n" + WhereSql
                    + "\nORDER BY ReceiptDateIso DESC, ReceiverNumber, "
                    + "PurchaseOrderNumber, PurchaseOrderLineNumber "
                    + "OFFSET @Offset ROWS "
                    + "FETCH NEXT @PageSize ROWS ONLY;",
                parameters,
                cancellationToken: cancellationToken));
        return new PagedQueryResult<ReceivingHistoryLineDto>(
            rows.AsList(), total);
    }

    public async Task<CanonicalLookupResult<ReceivingHistoryLineDto>>
        GetLineAsync(string id, CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<ReceivingHistoryLineDto>(
            new CommandDefinition(
                SelectSql + """

WHERE PurchaseReceiptLineId = @Id;
""",
                new { Id = id },
                cancellationToken: cancellationToken));
        return new CanonicalLookupResult<ReceivingHistoryLineDto>(
            rows.AsList());
    }

    public async Task<ReceivingHistoryMetadataDto?> GetMetadataAsync(
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    ReceivingHistoryImportRunId, SourceQualificationRunId, PackageSha256,
    ContractVersion, SnapshotAsOfUtc, HeaderCount, LineCount,
    RejectionCount, MalformedOrderDateCount, MalformedReceiptDateCount,
    MalformedRequiredDateCount, MissingPurchaseOrderCount, ImportStatus
FROM liveapi.ReceivingHistoryMetadata;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<
            ReceivingHistoryMetadataDto>(
            new CommandDefinition(sql, cancellationToken: cancellationToken));
    }
}
