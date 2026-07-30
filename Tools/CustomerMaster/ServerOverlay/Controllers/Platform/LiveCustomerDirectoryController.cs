using DLE_OS_Server.Contracts.Platform;
using DLE_OS_Server.Data.Platform;
using DLE_OS_Server.Data.Platform.Live;
using Microsoft.AspNetCore.Mvc;

namespace DLE_OS_Server.Controllers.Platform.Live;

[ApiController]
[Route("api/platform/live/v1/customer-directory")]
public sealed class LiveCustomerDirectoryController : LivePlatformControllerBase
{
    private const int DefaultPageSize = 25;
    private const int MaximumPageSize = 50;
    private readonly CustomerDirectoryRepository _repository;

    public LiveCustomerDirectoryController(
        LivePlatformSqlConnectionFactory connectionFactory)
    {
        _repository = new CustomerDirectoryRepository(connectionFactory);
    }

    [HttpGet("search")]
    public async Task<ActionResult<CustomerDirectorySearchResponseDto>> Search(
        [FromQuery] string? q,
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        CancellationToken cancellationToken)
    {
        var query = q?.Trim();
        if (query?.Length == 0)
            query = null;
        if (query is not null
            && (query.Length > 100 || query.Any(char.IsControl)))
            return Error(400, "invalid_query", "q is malformed or too long.");
        var resultPage = page ?? 1;
        var resultPageSize = pageSize ?? DefaultPageSize;
        if (resultPage < 1)
            return Error(400, "invalid_page", "page must be at least 1.");
        if (resultPageSize < 1 || resultPageSize > MaximumPageSize)
            return Error(
                400,
                "invalid_page_size",
                $"pageSize must be between 1 and {MaximumPageSize}.");
        return Ok(await _repository.SearchAsync(
            query, resultPage, resultPageSize, cancellationToken));
    }
}
