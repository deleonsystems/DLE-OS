using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform;
using DLE_OS_Server.Data.Platform.Live;
using Microsoft.AspNetCore.Mvc;

namespace DLE_OS_Server.Controllers.Platform.Live;

[ApiController]
[Route("api/platform/live/v1/customer-master")]
public sealed class LiveCustomerMasterController : LivePlatformControllerBase
{
    private readonly CustomerMasterRepository _repository;

    public LiveCustomerMasterController(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _repository = new CustomerMasterRepository(connectionFactory);
    }

    [HttpGet]
    public async Task<ActionResult<PagedResponse<CustomerMasterDto>>> GetPage(
        [FromQuery] string? page,
        [FromQuery] string? pageSize,
        [FromQuery] string? customerNumber,
        [FromQuery] string? customerName,
        [FromQuery] string? postalCode,
        [FromQuery] string? contactName,
        [FromQuery] string? salespersonCode,
        [FromQuery] string? territoryCode,
        CancellationToken cancellationToken)
    {
        if (!TryCreatePageRequest(page, pageSize, out var request, out var error))
            return error!;

        customerNumber = NormalizeNumericIdentifier(customerNumber, 6);
        customerName = customerName?.Trim();
        postalCode = postalCode?.Trim();
        contactName = contactName?.Trim();
        salespersonCode = salespersonCode?.Trim();
        territoryCode = territoryCode?.Trim();
        if (
            !TryNormalizeOptionalIdentifier(
                nameof(customerNumber),
                customerNumber,
                out customerNumber,
                out error) ||
            !TryNormalizeOptionalIdentifier(
                nameof(customerName),
                customerName,
                out customerName,
                out error) ||
            !TryNormalizeOptionalIdentifier(
                nameof(postalCode),
                postalCode,
                out postalCode,
                out error) ||
            !TryNormalizeOptionalIdentifier(
                nameof(contactName),
                contactName,
                out contactName,
                out error) ||
            !TryNormalizeOptionalIdentifier(
                nameof(salespersonCode),
                salespersonCode,
                out salespersonCode,
                out error) ||
            !TryNormalizeOptionalIdentifier(
                nameof(territoryCode),
                territoryCode,
                out territoryCode,
                out error)
        )
            return error!;

        var result = await _repository.GetPageAsync(
            request,
            new CustomerMasterFilter(
                customerNumber,
                customerName,
                postalCode,
                contactName,
                salespersonCode,
                territoryCode),
            cancellationToken);
        return Ok(ToResponse(request, result));
    }

    [HttpGet("metadata")]
    public async Task<ActionResult<CustomerMasterMetadataDto>> GetMetadata(
        CancellationToken cancellationToken)
    {
        var metadata = await _repository.GetMetadataAsync(cancellationToken);
        return metadata is null
            ? Error(503, "not_ready", "Customer Master has no active baseline.")
            : Ok(metadata);
    }

    [HttpGet("{customerMasterId}")]
    public async Task<ActionResult<CustomerMasterDto>> GetById(
        string customerMasterId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(customerMasterId))
            return Error(
                400,
                "invalid_identifier",
                "customerMasterId must not be empty.");
        var result = await _repository.GetByIdAsync(
            customerMasterId.Trim(), cancellationToken);
        return LookupResponse(result, "CustomerMaster");
    }

    [HttpGet("{customerMasterId}/addresses")]
    public async Task<ActionResult<IReadOnlyList<CustomerAddressDto>>>
        GetAddresses(
            string customerMasterId,
            CancellationToken cancellationToken)
    {
        var normalized = customerMasterId.Trim();
        if (normalized.Length != 8)
            return Error(
                400,
                "invalid_identifier",
                "customerMasterId must contain FirmId and CustomerNumber.");
        var rows = await _repository.GetAddressesAsync(
            normalized[..2],
            normalized[2..],
            cancellationToken);
        return Ok(rows);
    }

    private static string? NormalizeNumericIdentifier(
        string? value,
        int width)
    {
        if (value is null)
            return null;
        var trimmed = value.Trim();
        return trimmed.Length > 0
            && trimmed.Length < width
            && trimmed.All(char.IsAsciiDigit)
            ? trimmed.PadLeft(width, '0')
            : trimmed;
    }
}
