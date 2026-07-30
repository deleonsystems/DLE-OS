using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform;
using DLE_OS_Server.Data.Platform.Live;
using Microsoft.AspNetCore.Mvc;

namespace DLE_OS_Server.Controllers.Platform.Live;

[ApiController]
[Route("api/platform/live/v1/employee-reference")]
public sealed class LiveEmployeeReferenceController : LivePlatformControllerBase
{
    private static readonly HashSet<string> CodeTypes =
        new(StringComparer.Ordinal)
        {
            "Buyer", "Salesperson", "Operator"
        };

    private readonly EmployeeReferenceRepository _repository;

    public LiveEmployeeReferenceController(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _repository = new EmployeeReferenceRepository(connectionFactory);
    }

    [HttpGet]
    public async Task<ActionResult<PagedResponse<EmployeeReferenceDto>>> GetPage(
        [FromQuery] string? page,
        [FromQuery] string? pageSize,
        [FromQuery] string? employeeNumber,
        [FromQuery] string? employeeName,
        [FromQuery] string? department,
        [FromQuery] string? jobTitle,
        [FromQuery] string? isActive,
        [FromQuery] string? operationalCode,
        [FromQuery] string? codeType,
        CancellationToken cancellationToken)
    {
        if (!TryCreatePageRequest(page, pageSize, out var request, out var error))
            return error!;
        employeeNumber = NormalizeNumericIdentifier(employeeNumber, 9);
        employeeName = employeeName?.Trim();
        department = department?.Trim();
        jobTitle = jobTitle?.Trim();
        operationalCode = operationalCode?.Trim();
        codeType = codeType?.Trim();
        foreach (var pair in new[]
        {
            (nameof(employeeNumber), employeeNumber),
            (nameof(employeeName), employeeName),
            (nameof(department), department),
            (nameof(jobTitle), jobTitle),
            (nameof(operationalCode), operationalCode),
            (nameof(codeType), codeType)
        })
        {
            if (!TryNormalizeOptionalIdentifier(
                pair.Item1, pair.Item2, out var _, out error))
                return error!;
        }
        if (!TryOptionalBoolean(isActive, out var parsedIsActive))
            return Error(
                400, "invalid_parameter",
                "isActive must be true or false.");
        if (codeType is not null && !CodeTypes.Contains(codeType))
            return Error(
                400, "invalid_parameter",
                "codeType must be Buyer, Salesperson, or Operator.");

        var result = await _repository.GetPageAsync(
            request,
            new EmployeeReferenceFilter(
                employeeNumber, employeeName, department, jobTitle,
                parsedIsActive, operationalCode, codeType),
            cancellationToken);
        return Ok(ToResponse(request, result));
    }

    [HttpGet("metadata")]
    public async Task<ActionResult<EmployeeReferenceMetadataDto>> GetMetadata(
        CancellationToken cancellationToken)
    {
        var metadata = await _repository.GetMetadataAsync(cancellationToken);
        return metadata is null
            ? Error(503, "not_ready", "Employee Reference has no active baseline.")
            : Ok(metadata);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<EmployeeReferenceDto>> GetEmployee(
        string id,
        CancellationToken cancellationToken)
    {
        var normalized = id.Trim();
        if (normalized.Length != 11 || !normalized.All(char.IsAsciiDigit))
            return Error(
                400, "invalid_parameter",
                "Employee Reference ID must be the 11-digit firm and "
                    + "employee number.");
        var result = await _repository.GetEmployeeAsync(
            normalized, cancellationToken);
        return LookupResponse(result, "EmployeeReference");
    }

    [HttpGet("{id}/codes")]
    public async Task<ActionResult<IReadOnlyList<EmployeeOperationalCodeDto>>>
        GetCodes(string id, CancellationToken cancellationToken)
    {
        var normalized = id.Trim();
        if (normalized.Length != 11 || !normalized.All(char.IsAsciiDigit))
            return Error(
                400, "invalid_parameter",
                "Employee Reference ID must be the 11-digit firm and "
                    + "employee number.");
        var codes = await _repository.GetCodesAsync(
            normalized[..2], normalized[2..], cancellationToken);
        return Ok(codes);
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

    private static bool TryOptionalBoolean(string? value, out bool? result)
    {
        result = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!bool.TryParse(value.Trim(), out var parsed)) return false;
        result = parsed;
        return true;
    }
}
