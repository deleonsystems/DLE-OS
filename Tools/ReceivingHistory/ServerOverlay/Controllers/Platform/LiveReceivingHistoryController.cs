using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform;
using DLE_OS_Server.Data.Platform.Live;
using Microsoft.AspNetCore.Mvc;

namespace DLE_OS_Server.Controllers.Platform.Live;

[ApiController]
[Route("api/platform/live/v1/receiving-history")]
public sealed class LiveReceivingHistoryController : LivePlatformControllerBase
{
    private readonly ReceivingHistoryRepository _repository;

    public LiveReceivingHistoryController(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _repository = new ReceivingHistoryRepository(connectionFactory);
    }

    [HttpGet]
    public async Task<ActionResult<PagedResponse<ReceivingHistoryLineDto>>> GetPage(
        [FromQuery] string? page,
        [FromQuery] string? pageSize,
        [FromQuery] string? receiverNumber,
        [FromQuery] string? receiptFrom,
        [FromQuery] string? receiptTo,
        [FromQuery] string? purchaseOrderNumber,
        [FromQuery] string? purchaseOrderLineNumber,
        [FromQuery] string? vendorNumber,
        [FromQuery] string? vendorName,
        [FromQuery] string? itemNumber,
        [FromQuery] string? packingSlipNumber,
        [FromQuery] string? workOrderNumber,
        [FromQuery] string? warehouseId,
        [FromQuery] string? inspectionStatus,
        [FromQuery] string? rejectedOnly,
        [FromQuery] string? returnedOnly,
        CancellationToken cancellationToken)
    {
        if (!TryCreatePageRequest(page, pageSize, out var request, out var error))
            return error!;
        receiverNumber = NormalizeNumericIdentifier(receiverNumber, 7);
        purchaseOrderNumber = NormalizeNumericIdentifier(
            purchaseOrderNumber, 7);
        purchaseOrderLineNumber = NormalizeNumericIdentifier(
            purchaseOrderLineNumber, 3);
        vendorNumber = NormalizeNumericIdentifier(vendorNumber, 6);
        workOrderNumber = NormalizeNumericIdentifier(workOrderNumber, 7);
        vendorName = vendorName?.Trim();
        itemNumber = itemNumber?.Trim();
        packingSlipNumber = packingSlipNumber?.Trim();
        warehouseId = warehouseId?.Trim();
        inspectionStatus = inspectionStatus?.Trim();
        foreach (var pair in new[]
        {
            (nameof(receiverNumber), receiverNumber),
            (nameof(purchaseOrderNumber), purchaseOrderNumber),
            (nameof(purchaseOrderLineNumber), purchaseOrderLineNumber),
            (nameof(vendorNumber), vendorNumber),
            (nameof(vendorName), vendorName),
            (nameof(itemNumber), itemNumber),
            (nameof(packingSlipNumber), packingSlipNumber),
            (nameof(workOrderNumber), workOrderNumber),
            (nameof(warehouseId), warehouseId),
            (nameof(inspectionStatus), inspectionStatus)
        })
        {
            if (!TryNormalizeOptionalIdentifier(
                pair.Item1, pair.Item2, out var _, out error))
                return error!;
        }
        if (!TryOptionalDate(receiptFrom, out var parsedReceiptFrom)
            || !TryOptionalDate(receiptTo, out var parsedReceiptTo))
            return Error(
                400, "invalid_parameter",
                "Receipt date filters must use yyyy-MM-dd.");
        if (!TryOptionalBoolean(rejectedOnly, out var parsedRejectedOnly))
            return Error(
                400, "invalid_parameter",
                "rejectedOnly must be true or false.");
        if (!TryOptionalBoolean(returnedOnly, out var parsedReturnedOnly))
            return Error(
                400, "invalid_parameter",
                "returnedOnly must be true or false.");

        var result = await _repository.GetPageAsync(
            request,
            new ReceivingHistoryFilter(
                receiverNumber, parsedReceiptFrom, parsedReceiptTo,
                purchaseOrderNumber, purchaseOrderLineNumber, vendorNumber,
                vendorName, itemNumber, packingSlipNumber, workOrderNumber,
                warehouseId, inspectionStatus, parsedRejectedOnly,
                parsedReturnedOnly),
            cancellationToken);
        return Ok(ToResponse(request, result));
    }

    [HttpGet("metadata")]
    public async Task<ActionResult<ReceivingHistoryMetadataDto>> GetMetadata(
        CancellationToken cancellationToken)
    {
        var metadata = await _repository.GetMetadataAsync(cancellationToken);
        return metadata is null
            ? Error(503, "not_ready", "Receiving History has no active baseline.")
            : Ok(metadata);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<ReceivingHistoryLineDto>> GetLine(
        string id,
        CancellationToken cancellationToken)
    {
        var normalized = id.Trim();
        if (normalized.Length != 50
            || !normalized.All(Uri.IsHexDigit))
            return Error(
                400, "invalid_parameter",
                "Receiving History line ID must be the 50-character "
                    + "hexadecimal fixed-width source identity.");
        var result = await _repository.GetLineAsync(
            normalized.ToUpperInvariant(), cancellationToken);
        return LookupResponse(result, "PurchaseReceiptLine");
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
