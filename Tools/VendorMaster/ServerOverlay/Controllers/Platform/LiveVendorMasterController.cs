using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform;
using DLE_OS_Server.Data.Platform.Live;
using Microsoft.AspNetCore.Mvc;

namespace DLE_OS_Server.Controllers.Platform.Live;

[ApiController]
[Route("api/platform/live/v1/vendor-master")]
public sealed class LiveVendorMasterController : LivePlatformControllerBase
{
    private readonly VendorMasterRepository _repository;

    public LiveVendorMasterController(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _repository = new VendorMasterRepository(connectionFactory);
    }

    [HttpGet]
    public async Task<ActionResult<PagedResponse<VendorMasterDto>>> GetPage(
        [FromQuery] string? page,
        [FromQuery] string? pageSize,
        [FromQuery] string? vendorNumber,
        [FromQuery] string? vendorName,
        [FromQuery] string? postalCode,
        [FromQuery] string? contactName,
        [FromQuery] string? paymentTermsCode,
        CancellationToken cancellationToken)
    {
        if (!TryCreatePageRequest(page, pageSize, out var request, out var error))
            return error!;

        vendorNumber = NormalizeNumericIdentifier(vendorNumber, 6);
        vendorName = vendorName?.Trim();
        postalCode = postalCode?.Trim();
        contactName = contactName?.Trim();
        paymentTermsCode = paymentTermsCode?.Trim();
        foreach (var pair in new[]
        {
            (nameof(vendorNumber), vendorNumber),
            (nameof(vendorName), vendorName),
            (nameof(postalCode), postalCode),
            (nameof(contactName), contactName),
            (nameof(paymentTermsCode), paymentTermsCode)
        })
        {
            if (!TryNormalizeOptionalIdentifier(
                pair.Item1, pair.Item2, out var _, out error))
                return error!;
        }

        var result = await _repository.GetPageAsync(
            request,
            new VendorMasterFilter(
                vendorNumber,
                vendorName,
                postalCode,
                contactName,
                paymentTermsCode),
            cancellationToken);
        return Ok(ToResponse(request, result));
    }

    [HttpGet("metadata")]
    public async Task<ActionResult<VendorMasterMetadataDto>> GetMetadata(
        CancellationToken cancellationToken)
    {
        var metadata = await _repository.GetMetadataAsync(cancellationToken);
        return metadata is null
            ? Error(503, "not_ready", "Vendor Master has no active baseline.")
            : Ok(metadata);
    }

    [HttpGet("{vendorMasterId}")]
    public async Task<ActionResult<VendorMasterDto>> GetById(
        string vendorMasterId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(vendorMasterId))
            return Error(
                400, "invalid_identifier",
                "vendorMasterId must not be empty.");
        var result = await _repository.GetByIdAsync(
            vendorMasterId.Trim(), cancellationToken);
        return LookupResponse(result, "VendorMaster");
    }

    [HttpGet("{vendorMasterId}/addresses")]
    public async Task<ActionResult<IReadOnlyList<VendorAddressDto>>>
        GetAddresses(
            string vendorMasterId,
            CancellationToken cancellationToken)
    {
        var normalized = vendorMasterId.Trim();
        if (normalized.Length != 8)
            return Error(
                400, "invalid_identifier",
                "vendorMasterId must contain FirmId and VendorNumber.");
        return Ok(await _repository.GetAddressesAsync(
            normalized[..2], normalized[2..], cancellationToken));
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
