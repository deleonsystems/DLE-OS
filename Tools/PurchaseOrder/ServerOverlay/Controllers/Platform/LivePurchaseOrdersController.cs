using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform;
using DLE_OS_Server.Data.Platform.Live;
using Microsoft.AspNetCore.Mvc;

namespace DLE_OS_Server.Controllers.Platform.Live;

[ApiController]
[Route("api/platform/live/v1/purchase-orders")]
public sealed class LivePurchaseOrdersController : LivePlatformControllerBase
{
    private readonly PurchaseOrderRepository _repository;

    public LivePurchaseOrdersController(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _repository = new PurchaseOrderRepository(connectionFactory);
    }

    [HttpGet]
    public async Task<ActionResult<PagedResponse<PurchaseOrderLineDto>>> GetPage(
        [FromQuery] string? page,
        [FromQuery] string? pageSize,
        [FromQuery] string? purchaseOrderNumber,
        [FromQuery] string? vendorNumber,
        [FromQuery] string? vendorName,
        [FromQuery] string? status,
        [FromQuery] string? openOnly,
        [FromQuery] string? lineType,
        [FromQuery] string? itemNumber,
        [FromQuery] string? workOrderNumber,
        [FromQuery] string? salesOrderNumber,
        [FromQuery] string? requiredFrom,
        [FromQuery] string? requiredTo,
        [FromQuery] string? promisedFrom,
        [FromQuery] string? promisedTo,
        CancellationToken cancellationToken)
    {
        if (!TryCreatePageRequest(page, pageSize, out var request, out var error))
            return error!;
        purchaseOrderNumber = NormalizeNumericIdentifier(
            purchaseOrderNumber, 7);
        vendorNumber = NormalizeNumericIdentifier(vendorNumber, 6);
        workOrderNumber = NormalizeNumericIdentifier(workOrderNumber, 7);
        salesOrderNumber = NormalizeNumericIdentifier(salesOrderNumber, 7);
        vendorName = vendorName?.Trim();
        status = status?.Trim();
        lineType = lineType?.Trim();
        itemNumber = itemNumber?.Trim();
        foreach (var pair in new[]
        {
            (nameof(purchaseOrderNumber), purchaseOrderNumber),
            (nameof(vendorNumber), vendorNumber),
            (nameof(vendorName), vendorName),
            (nameof(status), status),
            (nameof(lineType), lineType),
            (nameof(itemNumber), itemNumber),
            (nameof(workOrderNumber), workOrderNumber),
            (nameof(salesOrderNumber), salesOrderNumber)
        })
        {
            if (!TryNormalizeOptionalIdentifier(
                pair.Item1, pair.Item2, out var _, out error))
                return error!;
        }
        if (!TryOptionalBoolean(openOnly, out var parsedOpenOnly))
            return Error(400, "invalid_parameter", "openOnly must be true or false.");
        if (!TryOptionalDate(requiredFrom, out var parsedRequiredFrom)
            || !TryOptionalDate(requiredTo, out var parsedRequiredTo)
            || !TryOptionalDate(promisedFrom, out var parsedPromisedFrom)
            || !TryOptionalDate(promisedTo, out var parsedPromisedTo))
            return Error(
                400, "invalid_parameter",
                "Date filters must use yyyy-MM-dd.");

        var result = await _repository.GetPageAsync(
            request,
            new PurchaseOrderFilter(
                purchaseOrderNumber, vendorNumber, vendorName, status,
                parsedOpenOnly, lineType, itemNumber, workOrderNumber,
                salesOrderNumber, parsedRequiredFrom, parsedRequiredTo,
                parsedPromisedFrom, parsedPromisedTo),
            cancellationToken);
        return Ok(ToResponse(request, result));
    }

    [HttpGet("metadata")]
    public async Task<ActionResult<PurchaseOrderMetadataDto>> GetMetadata(
        CancellationToken cancellationToken)
    {
        var metadata = await _repository.GetMetadataAsync(cancellationToken);
        return metadata is null
            ? Error(503, "not_ready", "Purchase Orders has no active baseline.")
            : Ok(metadata);
    }

    [HttpGet("{firmId}/{vendorNumber}/{purchaseOrderNumber}")]
    public async Task<ActionResult<PurchaseOrderDto>> GetHeader(
        string firmId,
        string vendorNumber,
        string purchaseOrderNumber,
        CancellationToken cancellationToken)
    {
        var result = await _repository.GetHeaderAsync(
            firmId.Trim(),
            NormalizeNumericIdentifier(vendorNumber, 6) ?? "",
            NormalizeNumericIdentifier(purchaseOrderNumber, 7) ?? "",
            cancellationToken);
        return LookupResponse(result, "PurchaseOrder");
    }

    [HttpGet("{firmId}/{vendorNumber}/{purchaseOrderNumber}/lines")]
    public async Task<ActionResult<IReadOnlyList<PurchaseOrderLineDto>>> GetLines(
        string firmId,
        string vendorNumber,
        string purchaseOrderNumber,
        CancellationToken cancellationToken)
    {
        return Ok(await _repository.GetLinesAsync(
            firmId.Trim(),
            NormalizeNumericIdentifier(vendorNumber, 6) ?? "",
            NormalizeNumericIdentifier(purchaseOrderNumber, 7) ?? "",
            cancellationToken));
    }

    [HttpGet("{firmId}/{vendorNumber}/{purchaseOrderNumber}/lines/{lineNumber}")]
    public async Task<ActionResult<PurchaseOrderLineDto>> GetLine(
        string firmId,
        string vendorNumber,
        string purchaseOrderNumber,
        string lineNumber,
        CancellationToken cancellationToken)
    {
        var result = await _repository.GetLineAsync(
            firmId.Trim(),
            NormalizeNumericIdentifier(vendorNumber, 6) ?? "",
            NormalizeNumericIdentifier(purchaseOrderNumber, 7) ?? "",
            NormalizeNumericIdentifier(lineNumber, 3) ?? "",
            cancellationToken);
        return LookupResponse(result, "PurchaseOrderLine");
    }

    private static bool TryOptionalBoolean(string? value, out bool? result)
    {
        result = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!bool.TryParse(value.Trim(), out var parsed)) return false;
        result = parsed;
        return true;
    }

    private static bool TryOptionalDate(string? value, out DateTime? result)
    {
        result = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!DateTime.TryParseExact(
            value.Trim(), "yyyy-MM-dd",
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None,
            out var parsed)) return false;
        result = parsed;
        return true;
    }

    private static string? NormalizeNumericIdentifier(string? value, int width)
    {
        if (value is null) return null;
        var trimmed = value.Trim();
        return trimmed.Length > 0
            && trimmed.Length < width
            && trimmed.All(char.IsAsciiDigit)
            ? trimmed.PadLeft(width, '0')
            : trimmed;
    }
}
