using Dapper;
using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform.Live;
using DLE_OS_Server.Models.Platform;

namespace DLE_OS_Server.Data.Platform;

public sealed record PurchaseOrderFilter(
    string? PurchaseOrderNumber,
    string? VendorNumber,
    string? VendorName,
    string? Status,
    bool? OpenOnly,
    string? LineType,
    string? ItemNumber,
    string? WorkOrderNumber,
    string? SalesOrderNumber,
    DateTime? RequiredFrom,
    DateTime? RequiredTo,
    DateTime? PromisedFrom,
    DateTime? PromisedTo);

public sealed class PurchaseOrderRepository
{
    private const string WhereSql = """
WHERE (@PurchaseOrderNumber IS NULL
       OR PurchaseOrderNumber = @PurchaseOrderNumber)
  AND (@VendorNumber IS NULL OR VendorNumber = @VendorNumber)
  AND (@VendorName IS NULL OR VendorName LIKE N'%' + @VendorName + N'%')
  AND (@Status IS NULL
       OR PurchaseOrderStatus = @Status OR LineStatus = @Status)
  AND (@OpenOnly IS NULL OR @OpenOnly = 0 OR IsOpen = 1)
  AND (@LineType IS NULL OR LineType = @LineType)
  AND (@ItemNumber IS NULL OR ItemNumber = @ItemNumber)
  AND (@WorkOrderNumber IS NULL OR WorkOrderNumber = @WorkOrderNumber)
  AND (@SalesOrderNumber IS NULL OR SalesOrderNumber = @SalesOrderNumber)
  AND (@RequiredFrom IS NULL OR RequiredDateIso >= @RequiredFrom)
  AND (@RequiredTo IS NULL OR RequiredDateIso <= @RequiredTo)
  AND (@PromisedFrom IS NULL OR PromisedDateIso >= @PromisedFrom)
  AND (@PromisedTo IS NULL OR PromisedDateIso <= @PromisedTo)
""";

    private const string SelectSql = """
SELECT
    PurchaseOrderLineId, FirmId, VendorNumber, VendorName,
    PurchaseOrderNumber, PurchaseOrderLineNumber, OrderDateIso,
    PurchaseOrderStatus, HoldFlag, PaymentTermsCode,
    terms.CodeDescription AS PaymentTermsDescription,
    CASE WHEN PaymentTermsCode IS NULL THEN NULL
         ELSE COALESCE(terms.ResolutionStatus, N'Unresolved') END
        AS PaymentTermsResolutionStatus,
    FreightTerms, ShippingMethod, Fob, LineCode,
    lineCode.CodeDescription AS LineCodeDescription,
    CASE WHEN LineCode IS NULL THEN NULL
         ELSE COALESCE(lineCode.ResolutionStatus, N'Unresolved') END
        AS LineCodeResolutionStatus,
    LineType, ItemNumber, ItemDescription, OrderMemo, UnitOfMeasure,
    unitCode.CodeDescription AS UnitOfMeasureDescription,
    CASE WHEN UnitOfMeasure IS NULL THEN NULL
         ELSE COALESCE(unitCode.ResolutionStatus, N'Unresolved') END
        AS UnitOfMeasureResolutionStatus,
    QuantityOrdered, QuantityReceived,
    QuantityOpen, RequiredDateIso, PromisedDateIso, WorkOrderNumber,
    CustomerNumber, SalesOrderNumber, SalesOrderLineNumber, LineStatus,
    IsOpen, IsClosed, IsCanceled, VendorResolutionStatus,
    InventoryResolutionStatus, WorkOrderResolutionStatus,
    SalesOrderResolutionStatus, PurchaseOrderImportRunId, ImportedAtUtc
FROM canonical.PurchaseOrderViewer AS purchaseOrder
OUTER APPLY
(
    SELECT TOP (1) CodeDescription, ResolutionStatus
    FROM canonical.ReferenceCodeViewer
    WHERE FirmId = purchaseOrder.FirmId
      AND CodeDomain = N'Purchasing'
      AND CodeType = N'PaymentTerms'
      AND CodeValue =
          purchaseOrder.PaymentTermsCode COLLATE Latin1_General_100_BIN2
) AS terms
OUTER APPLY
(
    SELECT TOP (1) CodeDescription, ResolutionStatus
    FROM canonical.ReferenceCodeViewer
    WHERE FirmId = purchaseOrder.FirmId
      AND CodeDomain = N'Purchasing'
      AND CodeType = N'PurchaseOrderLineType'
      AND CodeValue =
          purchaseOrder.LineCode COLLATE Latin1_General_100_BIN2
) AS lineCode
OUTER APPLY
(
    SELECT TOP (1) CodeDescription, ResolutionStatus
    FROM canonical.ReferenceCodeViewer
    WHERE FirmId = purchaseOrder.FirmId
      AND CodeDomain = N'Inventory'
      AND CodeType = N'UnitOfMeasure'
      AND CodeValue =
          purchaseOrder.UnitOfMeasure COLLATE Latin1_General_100_BIN2
) AS unitCode
""";

    private readonly LivePlatformSqlConnectionFactory _connectionFactory;

    public PurchaseOrderRepository(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<PagedQueryResult<PurchaseOrderLineDto>> GetPageAsync(
        PageRequest page,
        PurchaseOrderFilter filter,
        CancellationToken cancellationToken)
    {
        var parameters = new
        {
            filter.PurchaseOrderNumber,
            filter.VendorNumber,
            filter.VendorName,
            filter.Status,
            filter.OpenOnly,
            filter.LineType,
            filter.ItemNumber,
            filter.WorkOrderNumber,
            filter.SalesOrderNumber,
            filter.RequiredFrom,
            filter.RequiredTo,
            filter.PromisedFrom,
            filter.PromisedTo,
            page.Offset,
            page.PageSize
        };
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT_BIG(*) FROM canonical.PurchaseOrderViewer\n"
                    + WhereSql,
                parameters,
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<PurchaseOrderLineDto>(
            new CommandDefinition(
                SelectSql + "\n" + WhereSql
                    + "\nORDER BY IsOpen DESC, RequiredDateIso, "
                    + "PurchaseOrderNumber, PurchaseOrderLineNumber "
                    + "OFFSET @Offset ROWS "
                    + "FETCH NEXT @PageSize ROWS ONLY;",
                parameters,
                cancellationToken: cancellationToken));
        return new PagedQueryResult<PurchaseOrderLineDto>(
            rows.AsList(), total);
    }

    public async Task<CanonicalLookupResult<PurchaseOrderDto>> GetHeaderAsync(
        string firmId,
        string vendorNumber,
        string purchaseOrderNumber,
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    purchaseOrder.FirmId, VendorNumber, PurchaseOrderNumber, VendorName,
    WarehouseId, warehouse.CodeDescription AS WarehouseDescription,
    CASE WHEN WarehouseId IS NULL THEN NULL
         ELSE COALESCE(warehouse.ResolutionStatus, N'Unresolved') END
        AS WarehouseResolutionStatus,
    PurchasingAddressCode, OrderDateRaw, OrderDateIso, PromisedDateRaw,
    PromisedDateIso, NotBeforeDateRaw, NotBeforeDateIso, RequiredDateRaw,
    RequiredDateIso, LastReceiptDateRaw, LastReceiptDateIso, HoldFlag,
    PrintStatus, PaymentTermsCode,
    terms.CodeDescription AS PaymentTermsDescription,
    CASE WHEN PaymentTermsCode IS NULL THEN NULL
         ELSE COALESCE(terms.ResolutionStatus, N'Unresolved') END
        AS PaymentTermsResolutionStatus,
    FreightTerms, ShippingMethod,
    Acknowledgment, Fob, MessageCode, RequisitionNumber,
    PurchaseOrderStatus, IsOpen, IsClosed, IsCanceled,
    VendorResolutionStatus, PurchaseOrderImportRunId, ImportedAtUtc
FROM canonical.PurchaseOrder AS purchaseOrder
OUTER APPLY
(
    SELECT TOP (1) CodeDescription, ResolutionStatus
    FROM canonical.ReferenceCodeViewer
    WHERE FirmId = purchaseOrder.FirmId
      AND CodeDomain = N'Inventory'
      AND CodeType = N'Warehouse'
      AND CodeValue =
          purchaseOrder.WarehouseId COLLATE Latin1_General_100_BIN2
) AS warehouse
OUTER APPLY
(
    SELECT TOP (1) CodeDescription, ResolutionStatus
    FROM canonical.ReferenceCodeViewer
    WHERE FirmId = purchaseOrder.FirmId
      AND CodeDomain = N'Purchasing'
      AND CodeType = N'PaymentTerms'
      AND CodeValue =
          purchaseOrder.PaymentTermsCode COLLATE Latin1_General_100_BIN2
) AS terms
WHERE purchaseOrder.FirmId = @FirmId
  AND VendorNumber = @VendorNumber
  AND PurchaseOrderNumber = @PurchaseOrderNumber;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<PurchaseOrderDto>(
            new CommandDefinition(
                sql,
                new { FirmId = firmId, VendorNumber = vendorNumber,
                    PurchaseOrderNumber = purchaseOrderNumber },
                cancellationToken: cancellationToken));
        return new CanonicalLookupResult<PurchaseOrderDto>(rows.AsList());
    }

    public async Task<IReadOnlyList<PurchaseOrderLineDto>> GetLinesAsync(
        string firmId,
        string vendorNumber,
        string purchaseOrderNumber,
        CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<PurchaseOrderLineDto>(
            new CommandDefinition(
                SelectSql + """

WHERE FirmId = @FirmId
  AND VendorNumber = @VendorNumber
  AND PurchaseOrderNumber = @PurchaseOrderNumber
ORDER BY PurchaseOrderLineNumber;
""",
                new
                {
                    FirmId = firmId,
                    VendorNumber = vendorNumber,
                    PurchaseOrderNumber = purchaseOrderNumber
                },
                cancellationToken: cancellationToken));
        return rows.AsList();
    }

    public async Task<CanonicalLookupResult<PurchaseOrderLineDto>> GetLineAsync(
        string firmId,
        string vendorNumber,
        string purchaseOrderNumber,
        string lineNumber,
        CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<PurchaseOrderLineDto>(
            new CommandDefinition(
                SelectSql + """

WHERE FirmId = @FirmId
  AND VendorNumber = @VendorNumber
  AND PurchaseOrderNumber = @PurchaseOrderNumber
  AND PurchaseOrderLineNumber = @LineNumber;
""",
                new
                {
                    FirmId = firmId,
                    VendorNumber = vendorNumber,
                    PurchaseOrderNumber = purchaseOrderNumber,
                    LineNumber = lineNumber
                },
                cancellationToken: cancellationToken));
        return new CanonicalLookupResult<PurchaseOrderLineDto>(rows.AsList());
    }

    public async Task<PurchaseOrderMetadataDto?> GetMetadataAsync(
        CancellationToken cancellationToken)
    {
        const string sql = """
SELECT
    PurchaseOrderImportRunId, SourceQualificationRunId, PackageSha256,
    ContractVersion, SnapshotAsOfUtc, HeaderCount, LineCount,
    SourceOrphanLineCount, ImportStatus
FROM liveapi.PurchaseOrderMetadata;
""";
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<
            PurchaseOrderMetadataDto>(
            new CommandDefinition(sql, cancellationToken: cancellationToken));
    }
}
