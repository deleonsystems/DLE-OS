namespace DLE_OS_Server.Contracts.Platform;

public sealed class CustomerDirectoryResultDto
{
    public required string CustomerNumber { get; init; }
    public required string CustomerName { get; init; }
    public required IReadOnlyList<string> Aliases { get; init; }
    public required IReadOnlyList<string> Sources { get; init; }
    public required int OpenOrderRecords { get; init; }
    public required int SalesOrderRecords { get; init; }
    public required int InvoiceHistoryRecords { get; init; }
    public required int CustomerMasterRecords { get; init; }
    public DateTime? MostRecentActivityDate { get; init; }
}

public sealed class CustomerDirectorySearchResponseDto
{
    public string? Query { get; init; }
    public required IReadOnlyList<CustomerDirectoryResultDto> Items { get; init; }
    public required int ReturnedCount { get; init; }
    public required long TotalItems { get; init; }
    public required int Page { get; init; }
    public required int PageSize { get; init; }
    public required long TotalPages { get; init; }
    public required bool HasMore { get; init; }
}
