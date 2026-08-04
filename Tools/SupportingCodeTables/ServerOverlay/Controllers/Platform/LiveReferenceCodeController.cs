using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform;
using DLE_OS_Server.Data.Platform.Live;
using Microsoft.AspNetCore.Mvc;

namespace DLE_OS_Server.Controllers.Platform.Live;

[ApiController]
[Route("api/platform/live/v1/reference-codes")]
public sealed class LiveReferenceCodeController : LivePlatformControllerBase
{
    private static readonly HashSet<string> ResolutionStatuses =
        new(StringComparer.Ordinal)
        {
            "Resolved", "Unresolved", "Ambiguous", "GenericSystem",
            "Deprecated", "CanonicalEnum"
        };

    private readonly ReferenceCodeRepository _repository;

    public LiveReferenceCodeController(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _repository = new ReferenceCodeRepository(connectionFactory);
    }

    [HttpGet]
    public async Task<ActionResult<PagedResponse<ReferenceCodeDto>>> GetPage(
        [FromQuery] string? page,
        [FromQuery] string? pageSize,
        [FromQuery] string? codeDomain,
        [FromQuery] string? codeType,
        [FromQuery] string? codeValue,
        [FromQuery] string? description,
        [FromQuery] string? resolutionStatus,
        [FromQuery] string? sourceType,
        CancellationToken cancellationToken)
    {
        if (!TryCreatePageRequest(page, pageSize, out var request, out var error))
            return error!;
        codeDomain = codeDomain?.Trim();
        codeType = codeType?.Trim();
        codeValue = codeValue?.Trim();
        description = description?.Trim();
        resolutionStatus = resolutionStatus?.Trim();
        sourceType = sourceType?.Trim();
        foreach (var pair in new[]
        {
            (nameof(codeDomain), codeDomain), (nameof(codeType), codeType),
            (nameof(codeValue), codeValue), (nameof(description), description),
            (nameof(resolutionStatus), resolutionStatus),
            (nameof(sourceType), sourceType)
        })
        {
            if (!TryNormalizeOptionalIdentifier(
                pair.Item1, pair.Item2, out var _, out error))
                return error!;
        }
        if (
            resolutionStatus is not null
            && !ResolutionStatuses.Contains(resolutionStatus)
        )
            return Error(
                400, "invalid_parameter",
                "resolutionStatus is outside the qualified value set.");
        var result = await _repository.GetPageAsync(
            request,
            new ReferenceCodeFilter(
                codeDomain, codeType, codeValue, description,
                resolutionStatus, sourceType),
            cancellationToken);
        return Ok(ToResponse(request, result));
    }

    [HttpGet("metadata")]
    public async Task<ActionResult<ReferenceCodeMetadataDto>> GetMetadata(
        CancellationToken cancellationToken)
    {
        var metadata = await _repository.GetMetadataAsync(cancellationToken);
        return metadata is null
            ? Error(503, "not_ready", "Code References has no active baseline.")
            : Ok(metadata);
    }

    [HttpGet("{domain}/{type}/{value}")]
    public async Task<ActionResult<ReferenceCodeDto>> GetCode(
        string domain,
        string type,
        string value,
        [FromQuery] string? firmId,
        CancellationToken cancellationToken)
    {
        domain = domain.Trim();
        type = type.Trim();
        value = value.Trim();
        firmId = string.IsNullOrWhiteSpace(firmId) ? "01" : firmId.Trim();
        foreach (var pair in new[]
        {
            (nameof(domain), domain), (nameof(type), type),
            (nameof(value), value), (nameof(firmId), firmId)
        })
        {
            if (!TryNormalizeOptionalIdentifier(
                pair.Item1, pair.Item2, out var _, out var error))
                return error!;
        }
        var result = await _repository.GetCodeAsync(
            firmId, domain, type, value, cancellationToken);
        return LookupResponse(result, "ReferenceCode");
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<ReferenceCodeDto>> GetCodeById(
        long id,
        CancellationToken cancellationToken)
    {
        if (id < 1)
            return Error(
                400, "invalid_parameter",
                "Reference Code identifier must be a positive integer.");
        var result = await _repository.GetCodeByIdAsync(id, cancellationToken);
        return LookupResponse(result, "ReferenceCode");
    }
}
